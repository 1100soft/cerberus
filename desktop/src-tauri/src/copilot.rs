use github_copilot_sdk::{Client, ClientOptions, types::SessionListFilter};
use serde_json::{json,Value};

async fn start_client(identity_id:&str)->Result<Client,String>{
    let options=client_options(identity_id)?;
    Client::start(options).await.map_err(|error|{
        if error.is_transport_failure(){
            "Copilot CLI stopped during startup. Check that the Copilot CLI is installed, up to date, and signed in; then retry.".into()
        }else{format!("Copilot CLI could not start: {error}")}
    })
}

pub async fn repository_snapshot(identity_id:&str, _repository:&str) -> Result<Value,String> {
    let client=start_client(identity_id).await?;
    let quota=client.call("account.getQuota",Some(json!({}))).await;
    let _=client.stop().await;
    Ok(json!({"quota":quota.map_err(|e|e.to_string())?}))
}

fn client_options(identity_id:&str)->Result<ClientOptions,String>{
    let token=crate::oauth::github_token(identity_id)?;
    Ok(ClientOptions::default().with_program(std::path::PathBuf::from("copilot")).with_github_token(token))
}
pub async fn threads(identity_id:&str,repository:&str,cwd:&std::path::Path)->Result<crate::codex::ThreadPage,String>{
    let client=start_client(identity_id).await?;
    let result=client.list_sessions(Some(SessionListFilter{repository:Some(repository.into()),..Default::default()})).await;
    let mut data=Vec::new();
    if let Ok(sessions)=result {
        for (index,session) in sessions.into_iter().enumerate() {
            let working=index<10 && client.call("session.metadata.isProcessing",Some(json!({"sessionId":session.session_id.to_string()}))).await
                .ok().and_then(|value|value["processing"].as_bool()).unwrap_or(false);
            data.push(crate::codex::ThreadSummary{
                id:session.session_id.to_string(),name:session.summary.clone(),preview:session.summary.unwrap_or_else(||"Copilot conversation".into()),
                cwd:cwd.to_string_lossy().into_owned(),updated_at:chrono::DateTime::parse_from_rfc3339(&session.modified_time).map(|date|date.timestamp()).unwrap_or(0),
                git_info:None,working,
            });
        }
    } else {
        let _=client.stop().await;
        return Err(result.unwrap_err().to_string());
    }
    let _=client.stop().await;
    Ok(crate::codex::ThreadPage{data,next_cursor:None})
}
pub async fn messages(identity_id:&str,session_id:&str)->Result<crate::codex::MessagePage,String>{
    let client=start_client(identity_id).await?;
    let result=client.call("session.getMessages",Some(json!({"sessionId":session_id}))).await;
    let _=client.stop().await;
    let result=result.map_err(|e|e.to_string())?;
    let data=event_messages(&result);
    Ok(crate::codex::MessagePage{data,next_cursor:None})
}

fn event_messages(result:&Value)->Vec<crate::codex::Message>{
    result["events"].as_array().into_iter().flatten().filter_map(|event|{
        let role=match event["type"].as_str()?{"user.message"=>"user","assistant.message"=>"assistant",_=>return None};
        let text=event["data"]["content"].as_str()?.trim();if text.is_empty(){return None}
        Some(crate::codex::Message{id:event["id"].as_str().unwrap_or_default().into(),role:role.into(),text:text.into(),edits:vec![]})
    }).collect()
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn maps_only_complete_conversation_messages(){
        let input=json!({"events":[
            {"id":"1","type":"user.message","data":{"content":"Review this"}},
            {"id":"2","type":"tool.execution_start","data":{"content":"private command"}},
            {"id":"3","type":"assistant.message","data":{"content":"  Done  "}},
            {"id":"4","type":"assistant.message_delta","data":{"content":"duplicate"}}
        ]});
        let messages=event_messages(&input);
        assert_eq!(messages.iter().map(|message|(message.role.as_str(),message.text.as_str())).collect::<Vec<_>>(),vec![("user","Review this"),("assistant","Done")]);
    }
}
