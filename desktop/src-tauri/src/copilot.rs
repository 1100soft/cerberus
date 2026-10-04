use github_copilot_sdk::{Client, ClientOptions};
use serde_json::{json,Value};
use github_copilot_sdk::types::{MessageOptions, PermissionRequestData, PermissionRequestKind, SessionConfig, ResumeSessionConfig, SessionId};
use std::{time::Duration, sync::{Arc, atomic::{AtomicBool,Ordering}}};

fn response_text(data:&Value)->Option<&str>{
    ["content","message","text"].iter().find_map(|key|data.get(*key).and_then(Value::as_str).filter(|text|!text.trim().is_empty()))
}
fn editing_permission(mode:&str)->Result<bool,String>{match mode{"analyze"=>Ok(false),"edit"|"full"=>Ok(true),_=>Err("Unsupported Copilot permission mode".into())}}
fn draft_permission_allowed(request:&PermissionRequestData)->bool{matches!(request.kind,Some(PermissionRequestKind::Read))}

pub async fn new_conversation(data_dir:&std::path::Path,identity_id:&str,repository:&std::path::Path,mode:&str,prompt:&str,session_id:Option<&str>,cancelled:Option<Arc<AtomicBool>>,output:Option<tauri::ipc::Channel<Value>>)->Result<Value,String>{
    if prompt.trim().is_empty() || prompt.len()>100_000{return Err("Enter a prompt of at most 100,000 characters".into());}
    let editing=editing_permission(mode)?;
    let client=start_client(data_dir,identity_id).await?;
    let result=async {
        let config=SessionConfig::default().with_working_directory(repository);
        let config=if editing{config.approve_all_permissions()}else{config.with_available_tools(["view","read_file"]).approve_permissions_if(draft_permission_allowed)};
        let session=if let Some(id)=session_id{
            let resume=ResumeSessionConfig::new(SessionId::new(id)).with_working_directory(repository);
            let resume=if editing{resume.approve_all_permissions()}else{resume.with_available_tools(["view","read_file"]).approve_permissions_if(draft_permission_allowed)};
            client.resume_session(resume).await.map_err(|e|e.to_string())?
        }else{client.create_session(config).await.map_err(|e|e.to_string())?};
        let id=session.id().as_str().to_owned();
        let mut events=session.subscribe();
        let reply_future=async {let reply=if let Some(flag)=cancelled{
            tokio::select! {
                result=session.send_and_wait(MessageOptions::new(prompt).with_wait_timeout(Duration::from_secs(900)))=>result.map_err(|e|e.to_string())?,
                _=async {while !flag.load(Ordering::SeqCst){tokio::time::sleep(Duration::from_millis(100)).await;}}=>{let _=session.abort().await;let _=session.disconnect().await;return Err("Draft stopped".into());}
            }
        }else{session.send_and_wait(MessageOptions::new(prompt).with_wait_timeout(Duration::from_secs(900))).await.map_err(|e|e.to_string())?};Ok::<_,String>(reply)};
        tokio::pin!(reply_future);
        let reply=loop{tokio::select!{reply=&mut reply_future=>break reply?,event=events.recv(),if output.is_some()=>{match event{Ok(event)=>{if let Some(output)=&output{let _=output.send(serde_json::to_value(event).map_err(|error|error.to_string())?);}},Err(_)=>{tokio::time::sleep(Duration::from_millis(10)).await;}}}}};
        let direct=reply.as_ref().and_then(|event|response_text(&event.data));
        let (text,diagnostic)=if let Some(text)=direct{(text.to_owned(),String::new())}else{
            let messages=session.get_events().await.map_err(|e|e.to_string())?;
            let text=messages.iter().rev().filter(|event|event.event_type=="assistant.message").find_map(|event|response_text(&event.data)).unwrap_or("").to_owned();
            let diagnostic=messages.iter().rev().take(8).map(|event|format!("{}({})",event.event_type,event.data.as_object().map(|item|item.keys().cloned().collect::<Vec<_>>().join(",")).unwrap_or_default())).collect::<Vec<_>>().join("; ");
            (text,diagnostic)
        };
        let _=session.disconnect().await;
        if text.trim().is_empty(){
            eprintln!("Copilot draft had no text response; event summary: {}",if diagnostic.is_empty(){"none"}else{&diagnostic});
            return Err(if diagnostic.contains("permission."){"Copilot could not finish the draft with the available read-only tools."}else{"Copilot completed without a text response."}.into());
        }
        Ok(json!({"text":text,"sessionId":id}))
    }.await;
    let _=client.stop().await;
    result
}

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
    fn full_permissions_are_supported_without_widening_analyze(){
        assert!(editing_permission("full").unwrap());assert!(editing_permission("edit").unwrap());
        assert!(!editing_permission("analyze").unwrap());assert!(editing_permission("unknown").is_err());
    }
    #[test]
    fn extracts_copilot_final_message_shapes(){
        assert_eq!(response_text(&json!({"message":"Draft script"})),Some("Draft script"));
        assert_eq!(response_text(&json!({"content":"Draft prompt"})),Some("Draft prompt"));
        assert_eq!(response_text(&json!({"content":" ","message":"Fallback"})),Some("Fallback"));
    }
    #[test]
    fn drafting_allows_file_reads_only(){
        let read=PermissionRequestData{kind:Some(PermissionRequestKind::Read),..Default::default()};
        let write=PermissionRequestData{kind:Some(PermissionRequestKind::Write),..Default::default()};
        let shell=PermissionRequestData{kind:Some(PermissionRequestKind::Shell),..Default::default()};
        assert!(draft_permission_allowed(&read));
        assert!(!draft_permission_allowed(&write));
        assert!(!draft_permission_allowed(&shell));
        assert!(!draft_permission_allowed(&PermissionRequestData::default()));
    }
    #[test]
    #[ignore = "requires a connected GitHub identity and consumes a Copilot request"]
    fn live_reply_shape(){
        let root=std::env::var("CERBERUS_COPILOT_TEST_DATA").expect("data dir");
        let identity=std::env::var("CERBERUS_COPILOT_TEST_ID").expect("identity id");
        let repo=std::env::var("CERBERUS_COPILOT_TEST_REPO").expect("repository path");
        let prompt=std::env::var("CERBERUS_COPILOT_TEST_PROMPT").unwrap_or_else(|_|"Reply with exactly READY.".into());
        let result=tauri::async_runtime::block_on(new_conversation(std::path::Path::new(&root),&identity,std::path::Path::new(&repo),"analyze",&prompt,None,None,None));
        assert!(result.as_ref().ok().and_then(|reply|reply["text"].as_str()).is_some_and(|text|!text.trim().is_empty()),"{result:?}");
    }
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
