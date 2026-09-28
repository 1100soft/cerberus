use github_copilot_sdk::{Client, ClientOptions};
use serde_json::{json,Value};

async fn start_client(data_dir:&std::path::Path,identity_id:&str)->Result<Client,String>{
    let options=client_options(data_dir,identity_id)?;
    Client::start(options).await.map_err(|error|{
        if matches!(error.kind(), github_copilot_sdk::ErrorKind::BinaryNotFound { .. }) {
            format!("Copilot runtime is not available in this app build ({error}). The connected GitHub account is already saved.")
        } else {
            format!("Copilot runtime stopped during startup: {error}")
        }
    })
}

pub async fn repository_snapshot(data_dir:&std::path::Path,identity_id:&str, _repository:&str) -> Result<Value,String> {
    let client=start_client(data_dir,identity_id).await?;
    let quota=client.call("account.getQuota",Some(json!({}))).await;
    let _=client.stop().await;
    Ok(json!({"quota":quota.map_err(|e|e.to_string())?}))
}

fn client_options(_data_dir:&std::path::Path,identity_id:&str)->Result<ClientOptions,String>{
    let token=crate::oauth::github_token(identity_id)?;
    // The SDK starts its own protocol-matched runtime. A `copilot` binary from
    // npm or PATH is a different program and exits under `--server`. The
    // connected GitHub token is the account; there is no second sign-in.
    Ok(ClientOptions::default().with_github_token(token).with_use_logged_in_user(false))
}
#[cfg(test)]
fn event_messages(result:&Value)->Vec<crate::codex::Message>{
    result["events"].as_array().into_iter().flatten().filter_map(|event|{
        let role=match event["type"].as_str()?{"user.message"=>"user","assistant.message"=>"assistant",_=>return None};
        let text=event["data"]["content"].as_str()?.trim();if text.is_empty(){return None}
        Some(crate::codex::Message{id:event["id"].as_str().unwrap_or_default().into(),role:role.into(),text:text.into(),edits:vec![]})
    }).collect()
}
#[cfg(test)] mod tests {
    use super::*;
    #[test]
    fn runtime_starts_with_the_connected_github_token() {
        let started = tauri::async_runtime::block_on(async {
            match Client::start(ClientOptions::default().with_github_token("fixture-github-token").with_use_logged_in_user(false)).await {
                Ok(client) => { let _ = client.stop().await; Ok(()) }
                Err(error) => Err(error.to_string()),
            }
        });
        started.expect("Copilot runtime should start with the saved GitHub token");
    }
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
