//! Run subscription turns in the same app-server process that verified the account.
use crate::{agents::Profile, codex::Client, setup_terminal::SetupOutput};
use serde_json::{json, Value};
use std::{
    path::Path,
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::ipc::Channel;
fn emit(output: &Channel<SetupOutput>, value: Value) -> Result<(), String> {
    output
        .send(SetupOutput {
            text: format!("{value}\n"),
        })
        .map_err(|e| e.to_string())
}
fn settings(path: &Path, mode: &str, model: Option<&str>) -> Value {
    let mut value = json!({"cwd":path,"modelProvider":"openai","approvalPolicy":"never","sandbox":if mode=="full"{"danger-full-access"}else if mode=="edit"{"workspace-write"}else{"read-only"}});
    if let Some(model) = model {
        value["model"] = json!(model);
    }
    value
}
pub fn run(
    command: Command,
    profile: &Profile,
    path: &Path,
    mode: &str,
    prompt: &str,
    resume: Option<&str>,
    model: Option<&str>,
    reasoning_effort: Option<&str>,
    rollout: Option<&Path>,
    cancel: Arc<AtomicBool>,
    output: Channel<SetupOutput>,
) -> Result<(), String> {
    let mut client = Client::start_command(command)?;
    client.capture_events();
    let account = client.request("account/read", json!({"refreshToken":false}))?;
    verify_account(&account, profile)?;
    if cancel.load(Ordering::SeqCst) {
        return Err("Run stopped.".into());
    }
    let mut params = settings(path, mode, model);
    let method = if let Some(id) = resume {
        params["threadId"] = json!(id);
        if let Some(path)=rollout {params["path"]=json!(path);}
        "thread/resume"
    } else {
        "thread/start"
    };
    let response = client.request(method, params)?;
    let thread = response["thread"]["id"]
        .as_str()
        .ok_or("Codex returned no conversation identifier")?
        .to_owned();
    if resume.is_some_and(|id| id != thread) {
        return Err("Codex returned a different conversation; no turn was started".into());
    }
    emit(&output, json!({"type":"thread.started","thread_id":thread}))?;
    if cancel.load(Ordering::SeqCst) {
        return Err("Run stopped.".into());
    }
    let policy = if mode == "full" {
        json!({"type":"dangerFullAccess"})
    } else if mode == "edit" {
        json!({"type":"workspaceWrite","writableRoots":[path],"networkAccess":false})
    } else {
        json!({"type":"readOnly"})
    };
    let mut turn_params=json!({"threadId":thread,"input":[{"type":"text","text":prompt}],"cwd":path,"approvalPolicy":"never","sandboxPolicy":policy});
    if let Some(effort)=reasoning_effort {turn_params["effort"]=json!(effort);}
    let started=client.request("turn/start",turn_params)?;
    let turn = started["turn"]["id"]
        .as_str()
        .ok_or("Codex returned no turn identifier")?
        .to_owned();
    emit(&output, json!({"type":"turn.started"}))?;
    let mut deadline=crate::awake::ActiveDeadline::new(std::time::Duration::from_secs(900));
    loop {
        if deadline.expired(){client.interrupt(&thread,&turn);return Err("Codex timed out after 15 minutes of active execution. The conversation is preserved.".into());}
        if cancel.load(Ordering::SeqCst) {
            client.interrupt(&thread, &turn);
            return Err("Run stopped. Any edits already made remain in the checkout.".into());
        }
        let Some(event) = client.next_event()? else {
            continue;
        };
        if let Some(id) = event.get("id") {
            if event.get("method").is_some() {
                client.reject_request(id.clone())?;
            }
            continue;
        }
        let p = &event["params"];
        if p["threadId"].as_str().is_some_and(|id| id != thread) {
            continue;
        }
        if p["turnId"].as_str().is_some_and(|id| id != turn) {
            continue;
        }
        match event["method"].as_str().unwrap_or("") {
            "turn/diff/updated" => {emit(&output,json!({"type":"turn.diff","diff":p["diff"]}))?;}
            "item/fileChange/patchUpdated" => {emit(&output,json!({"type":"file.patch","changes":p["changes"]}))?;}
            "turn/plan/updated" => {emit(&output,json!({"type":"turn.plan","plan":p["plan"]}))?;}
            "item/completed" => {
                if let Some(item) = completed_item(&p["item"]) {
                    emit(&output, json!({"type":"item.completed","item":item}))?;
                }
            }
            "error" => {
                let message = p["error"]["message"]
                    .as_str()
                    .unwrap_or("Codex request failed");
                if message.contains("401") || message.contains("Unauthorized") {
                    client.interrupt(&thread, &turn);
                    return Err("ChatGPT authentication was rejected. Reconnect this identity and retry; the conversation is preserved.".into());
                }
                if !p["willRetry"].as_bool().unwrap_or(false) {
                    return Err(message.into());
                }
                emit(
                    &output,
                    json!({"type":"item.completed","item":{"type":"error","message":message}}),
                )?;
            }
            "turn/completed" => {
                if p["turn"]["id"].as_str() != Some(&turn) {
                    continue;
                }
                return match p["turn"]["status"].as_str() {
                    Some("completed") => emit(&output, json!({"type":"turn.completed"})),
                    Some("interrupted") => {
                        Err("Run stopped. Any edits already made remain in the checkout.".into())
                    }
                    _ => Err(p["turn"]["error"]["message"]
                        .as_str()
                        .unwrap_or("Codex turn failed")
                        .into()),
                };
            }
            _ => {}
        }
    }
}
fn verify_account(value: &Value, profile: &Profile) -> Result<(), String> {
    let account = &value["account"];
    if account["type"] != "chatgpt" {
        return Err(
            crate::codex::missing_account_error(),
        );
    }
    if profile
        .email
        .as_deref()
        .is_some_and(|email| account["email"].as_str() != Some(email))
    {
        return Err("The saved ChatGPT login does not match the assigned identity. Reconnect it before sending.".into());
    }
    Ok(())
}
fn completed_item(item: &Value) -> Option<Value> {
    Some(match item["type"].as_str()? {
        "agentMessage" => json!({"id":item["id"],"type":"agent_message","text":item["text"],"phase":item["phase"]}),
        "commandExecution" => {
            json!({"id":item["id"],"type":"command_execution","command":item["command"],"aggregated_output":item["aggregatedOutput"],"exit_code":item["exitCode"],"status":item["status"]})
        }
        "fileChange" => {
            json!({"id":item["id"],"type":"file_change","changes":item["changes"],"status":item["status"]})
        }
        _ => return None,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_and_permissions_are_explicit() {
        let profile = Profile {
            subscription: true,
            email: Some("fixture@example.test".into()),
            ..Profile::default()
        };
        assert!(verify_account(&json!({"account":null}), &profile).is_err());
        assert!(verify_account(&json!({"account":{"type":"apiKey"}}), &profile).is_err());
        assert!(verify_account(
            &json!({"account":{"type":"chatgpt","email":"other@example.test"}}),
            &profile
        )
        .is_err());
        assert!(verify_account(
            &json!({"account":{"type":"chatgpt","email":"fixture@example.test"}}),
            &profile
        )
        .is_ok());
        let params = settings(Path::new("/repo"), "edit", Some("recorded-model"));
        assert_eq!(params["sandbox"], "workspace-write");
        assert_eq!(params["approvalPolicy"], "never");
        assert_eq!(params["model"], "recorded-model");
    }
    #[test]
    fn completed_messages_and_edits_match_existing_stream() {
        assert_eq!(
            completed_item(&json!({"type":"agentMessage","text":"Done","id":"one"})).unwrap()
                ["type"],
            "agent_message"
        );
        assert_eq!(completed_item(&json!({"type":"fileChange","status":"completed","changes":[{"path":"a","kind":{"type":"update"},"diff":"+a"}]})).unwrap()["changes"][0]["diff"],"+a");
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    #[test]
    fn authenticated_process_resumes_and_keeps_early_notifications() {
        authenticated_transport("edit");
        authenticated_transport("full");
    }
    fn authenticated_transport(mode:&str) {
        let mut command = Command::new("python3");
        command.args(["-u","-c",r#"
import sys,json
mode=sys.argv[1]
verified=False
for line in sys.stdin:
 r=json.loads(line); m=r['method']; p=r.get('params',{})
 if 'id' not in r:continue
 if m=='initialize': result={}
 elif m=='account/read':
  verified=True;result={'account':{'type':'chatgpt','email':'fixture@example.test'}}
 elif m=='thread/resume':
  assert verified and p['threadId']=='session-test'
  assert p['approvalPolicy']=='never' and p['sandbox']==('danger-full-access' if mode=='full' else 'workspace-write') and p['model']=='recorded-model'
  result={'thread':{'id':'session-test'}}
 elif m=='turn/start':
  assert verified and p['input'][0]['text']=='fixture prompt' and p['effort']=='high'
  if mode=='full': assert p['sandboxPolicy']=={'type':'dangerFullAccess'}
  else: assert p['sandboxPolicy']['type']=='workspaceWrite' and p['sandboxPolicy']['networkAccess']==False
  for method,params in [('item/completed',{'item':{'type':'agentMessage','id':'answer','text':'Done'}}),('item/fileChange/patchUpdated',{'itemId':'edit','changes':[{'path':'file','kind':{'type':'update'},'diff':'+test'}]}),('turn/diff/updated',{'diff':'diff --git a/file b/file\\n+test'}),('item/completed',{'item':{'type':'fileChange','id':'edit','status':'completed','changes':[{'path':'file','kind':{'type':'update'},'diff':'+test'}]}}),('turn/completed',{'turn':{'id':'turn-test','status':'completed'}})]:
   print(json.dumps({'method':method,'params':dict(threadId='session-test',turnId='turn-test',**params)}),flush=True)
  result={'turn':{'id':'turn-test'}}
 else:raise Exception('Unexpected request '+m)
 print(json.dumps({'id':r['id'],'result':result}),flush=True)
"#]);
        command.arg(mode);
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let capture = events.clone();
        let output = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                capture.lock().unwrap().push(text);
            }
            Ok(())
        });
        let profile = Profile {
            subscription: true,
            email: Some("fixture@example.test".into()),
            ..Profile::default()
        };
        run(
            command,
            &profile,
            Path::new("/repo"),
            mode,
            "fixture prompt",
            Some("session-test"),
            Some("recorded-model"),
            Some("high"),
            None,
            Arc::new(AtomicBool::new(false)),
            output,
        )
        .unwrap();
        let events = events.lock().unwrap().join("\n");
        assert!(events.contains("agent_message"));
        assert!(events.contains("file_change"));
        assert!(events.contains("file.patch"));
        assert!(events.contains("turn.diff"));
        assert!(events.contains("turn.completed"));
    }
    #[test]
    fn authentication_rejection_stops_retrying() {
        let mut command=Command::new("python3");
        command.args(["-u","-c",r#"
import sys,json
for line in sys.stdin:
 r=json.loads(line);m=r['method']
 if 'id' not in r:continue
 if m=='initialize':result={}
 elif m=='account/read':result={'account':{'type':'chatgpt'}}
 elif m=='thread/start':result={'thread':{'id':'session-test'}}
 elif m=='turn/start':
  result={'turn':{'id':'turn-test'}}
  print(json.dumps({'method':'error','params':{'threadId':'session-test','turnId':'turn-test','willRetry':True,'error':{'message':'401 Unauthorized: Missing bearer authentication'}}}),flush=True)
 else:break
 print(json.dumps({'id':r['id'],'result':result}),flush=True)
"#]);
        let error=run(command,&Profile::default(),Path::new("/repo"),"analyze","task",None,None,None,None,Arc::new(AtomicBool::new(false)),Channel::new(|_|Ok(()))).unwrap_err();
        assert!(error.contains("ChatGPT authentication was rejected"));
    }
    #[test]
    fn missing_login_does_not_start_a_thread() {
        let mut command = Command::new("python3");
        command.args([
            "-u",
            "-c",
            r#"
import sys,json
for line in sys.stdin:
 r=json.loads(line)
 if 'id' not in r:continue
 assert r['method'] in ['initialize','account/read']
 print(json.dumps({'id':r['id'],'result':{'account':None}}),flush=True)
"#,
        ]);
        let error = run(
            command,
            &Profile::default(),
            Path::new("/repo"),
            "analyze",
            "task",
            None,
            None,
            None,
            None,
            Arc::new(AtomicBool::new(false)),
            Channel::new(|_| Ok(())),
        )
        .unwrap_err();
        // Headless Linux may require storage repair before reconnecting.
        assert_eq!(error, crate::codex::missing_account_error());
    }
}
