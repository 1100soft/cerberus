//! Submit a saved prompt only when the selected history ID belongs to a resumable runtime.
//! Editor history is never modified to manufacture a conversation turn.
use crate::{codex::CodexService, cursor::CursorService, provider_paths};
use serde::Serialize;
use serde_json::{json,Value};
use std::{collections::HashSet, io::Read, path::Path, process::{Command, Stdio}, sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}}, time::Duration};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capability { pub automatic: bool, pub reason: String }

fn cli_args(provider:&str,id:&str,prompt:&str)->Vec<String>{
    if provider=="claude" {vec!["--print","--resume",id,"--permission-prompts","none","--output-format","json",prompt].into_iter().map(str::to_owned).collect()}
    else {vec!["--resume",id,"--print","--output-format","json",prompt].into_iter().map(str::to_owned).collect()}
}

fn valid_id(id: &str) -> bool {
    id.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric) && id.len() <= 128 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
fn assigned_cli_identity(root:&Path,provider:&str,repository_key:&str)->Result<String,String>{
    let identities=crate::external_identities::identities(root);
    let settings=crate::external_identities::settings_for(root,&identities)?;
    let assigned=settings.repositories.get(provider).and_then(|items|items.get(repository_key)).cloned().unwrap_or_else(||settings.default_accounts.get(provider).cloned().unwrap_or(None));
    let Some(id)=assigned else{return Err(format!("Assign a {provider} identity to this repository before scheduling prompts."));};
    if identities.iter().any(|identity|identity.provider==provider&&identity.id==id&&identity.connected){Ok(id)}
    else{Err(format!("The assigned {provider} identity is not the active CLI account. Reconnect it before sending."))}
}
static ACTIVE:OnceLock<Mutex<HashSet<String>>>=OnceLock::new();
struct SessionLock(String);
impl SessionLock {
    fn acquire(provider:&str,id:&str)->Result<Self,String>{
        let key=format!("{provider}:{id}");
        let mut active=ACTIVE.get_or_init(||Mutex::new(HashSet::new())).lock().map_err(|e|e.to_string())?;
        if !active.insert(key.clone()){return Err("A saved prompt is already running in this conversation".into());}
        Ok(Self(key))
    }
}
impl Drop for SessionLock {fn drop(&mut self){if let Some(active)=ACTIVE.get(){if let Ok(mut active)=active.lock(){active.remove(&self.0);}}}}

fn drain(mut input:impl Read+Send+'static,limit:usize,output:Option<tauri::ipc::Channel<Value>>,stream:&'static str)->std::thread::JoinHandle<String>{
    std::thread::spawn(move||{let mut retained=Vec::new();let mut buffer=[0u8;4096];while let Ok(size)=input.read(&mut buffer){if size==0{break;}
        if let Some(output)=&output{let _=output.send(json!({"stream":stream,"text":String::from_utf8_lossy(&buffer[..size])}));}let remaining=limit.saturating_sub(retained.len());retained.extend_from_slice(&buffer[..size.min(remaining)]);}String::from_utf8_lossy(&retained).trim().to_owned()})
}

fn response_text(value:&Value)->Option<&str>{
    for key in ["result","message","text","content"] {
        if let Some(text)=value.get(key).and_then(Value::as_str).filter(|text|!text.trim().is_empty()){return Some(text);}
    }
    for key in ["result","message","content"] {
        if let Some(nested)=value.get(key){
            if let Some(text)=response_text(nested){return Some(text);}
            if let Some(items)=nested.as_array(){for item in items.iter().rev(){if let Some(text)=response_text(item){return Some(text);}}}
        }
    }
    None
}

pub fn new_cli_conversation(root:&Path,repo:&Path,repository_key:&str,provider:&str,identity_id:&str,mode:&str,prompt:&str,session_id:Option<&str>,cancelled:Option<Arc<AtomicBool>>,output:Option<tauri::ipc::Channel<Value>>)->Result<Value,String>{
    if !matches!(provider,"cursor"|"claude")||!matches!(mode,"analyze"|"edit"|"full") {return Err("Unsupported provider or permission mode".into());}
    if prompt.trim().is_empty()||prompt.len()>100_000{return Err("Enter a prompt of at most 100,000 characters".into());}
    if session_id.is_some_and(|id|!valid_id(id)){return Err("Invalid session ID".into());}
    let assigned=assigned_cli_identity(root,provider,repository_key)?;
    if assigned!=identity_id{return Err("The selected account is no longer assigned to this repository".into());}
    let tool=if provider=="cursor"{"cursor-agent"}else{"claude"};
    let program=provider_paths::resolve(root,tool)?.ok_or_else(||format!("Install {tool} in provider setup first"))?;
    let mut command=Command::new(program);
    command.current_dir(repo).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if provider=="cursor"{
        command.args(["--print","--output-format","json"]);
        if mode=="analyze"{command.args(["--mode","ask"]);}else{command.arg("--force");}
        if let Some(id)=session_id{command.args(["--resume",id]);}
    }else{
        command.args(["--print","--output-format","json","--permission-prompts","none","--permission-mode",if mode=="analyze"{"plan"}else if mode=="full"{"bypassPermissions"}else{"acceptEdits"}]);
        if let Some(id)=session_id{command.args(["--resume",id]);}
    }
    command.arg(prompt);
    let mut child=command.spawn().map_err(|e|format!("Could not start {tool}: {e}"))?;
    let stdout=drain(child.stdout.take().ok_or("Agent output unavailable")?,200_000,output.clone(),"stdout");
    let stderr=drain(child.stderr.take().ok_or("Agent diagnostic stream unavailable")?,2_000,output,"stderr");
    let mut deadline=crate::awake::ActiveDeadline::new(Duration::from_secs(900));
    let status=loop{
        if cancelled.as_ref().is_some_and(|flag|flag.load(Ordering::SeqCst)){let _=child.kill();let _=child.wait();let _=stdout.join();let _=stderr.join();return Err("Draft stopped".into());}
        if let Some(status)=child.try_wait().map_err(|e|e.to_string())?{break status;}
        if deadline.expired(){let _=child.kill();let _=child.wait();let _=stdout.join();let _=stderr.join();return Err(format!("{tool} timed out after 15 minutes. Check the app conversation before retrying."));}
        std::thread::sleep(Duration::from_millis(250));
    };
    let output=stdout.join().unwrap_or_default();let diagnostic=stderr.join().unwrap_or_default();
    if !status.success(){return Err(format!("{tool} exited with {status}. {diagnostic}"));}
    let parsed:Value=serde_json::from_str(&output).map_err(|_|format!("{tool} completed but returned unreadable JSON. Check its conversation before retrying."))?;
    if parsed["is_error"].as_bool()==Some(true) || parsed["isError"].as_bool()==Some(true) {
        return Err(format!("{tool} reported an error: {}",parsed["result"].as_str().or_else(||parsed["message"].as_str()).unwrap_or("unknown error")));
    }
    let text=response_text(&parsed).ok_or_else(||format!("{tool} completed without a text response. Inspect its conversation and try again."))?;
    let session_id=parsed["session_id"].as_str().or_else(||parsed["sessionId"].as_str());
    Ok(json!({"text":text,"sessionId":session_id}))
}

pub fn capability(root: &Path, repo: &Path, repository_key:&str, provider: &str, id: &str, codex: &CodexService, cursor: &CursorService) -> Capability {
    let available = || -> Result<&'static str, String> {
        if !valid_id(id) { return Err("This history entry has no supported session ID.".into()); }
        match provider {
            "codex" => { codex.can_append(repo, id)?; Ok("Codex App Server can append a turn to this thread.") }
            "claude" => {
                assigned_cli_identity(root,provider,repository_key)?;
                crate::claude_history::messages(repo, id)?;
                provider_paths::resolve(root, "claude")?.ok_or("Claude Code CLI is unavailable")?;
                Ok("Claude Code CLI can resume this session by ID.")
            }
            "cursor" => {
                assigned_cli_identity(root,provider,repository_key)?;
                // Editor composer IDs and Cursor CLI chat IDs live in different stores.
                // A coincidental-looking editor ID must never become a different CLI chat.
                provider_paths::resolve(root, "cursor-agent")?.ok_or("Cursor Agent CLI is unavailable")?;
                if !crate::agent_sessions::cursor_session_exists(id) { return Err("This Cursor editor conversation has no matching Cursor CLI session. Open it in Cursor and paste the prompt there.".into()); }
                cursor.messages(repo,id.to_owned())?;
                Ok("A matching Cursor CLI session exists. Cursor print mode can edit files.")
            }
            "copilot" => Err("VS Code Copilot chats are separate from Copilot SDK sessions. Open this chat in VS Code and paste the prompt there.".into()),
            _ => Err("Unknown agent provider".into()),
        }
    };
    match available() { Ok(reason) => Capability {automatic:true,reason:reason.into()}, Err(reason) => Capability {automatic:false,reason} }
}

pub fn submit(root:&Path,repo:&Path,repository_key:&str,provider:&str,id:&str,prompt:&str,codex:&CodexService,cursor:&CursorService) -> Result<String,String> {
    let prompt=prompt.trim();
    if prompt.is_empty() || prompt.len()>100_000 {return Err("Enter a prompt of at most 100,000 characters".into());}
    let status=capability(root,repo,repository_key,provider,id,codex,cursor);
    if !status.automatic {return Err(status.reason);}
    let _lock=SessionLock::acquire(provider,id)?;
    match provider {
        "codex" => {
            codex.submit_saved_turn(repo,id,prompt)?;
            Ok("Codex completed the selected thread turn.".into())
        }
        "claude" | "cursor" => {
            let tool=if provider=="claude" {"claude"} else {"cursor-agent"};
            let executable=provider_paths::resolve(root,tool)?.ok_or_else(||format!("{tool} is unavailable"))?;
            let mut command=Command::new(executable);
            command.current_dir(repo).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
            command.args(cli_args(provider,id,prompt));
            let mut child=command.spawn().map_err(|e|format!("Could not start {tool}: {e}"))?;
            let mut stderr=child.stderr.take().ok_or("Agent diagnostic stream is unavailable")?;
            let diagnostic=std::thread::spawn(move||{
                let mut retained=Vec::new();let mut buffer=[0u8;4096];
                while let Ok(size)=stderr.read(&mut buffer){if size==0{break;}let remaining=1024usize.saturating_sub(retained.len());retained.extend_from_slice(&buffer[..size.min(remaining)]);}
                String::from_utf8_lossy(&retained).trim().to_owned()
            });
            let mut deadline=crate::awake::ActiveDeadline::new(Duration::from_secs(900));
            loop {
                if let Some(status)=child.try_wait().map_err(|e|e.to_string())? {
                    let detail=diagnostic.join().unwrap_or_default();
                    if status.success() {return Ok(format!("{tool} completed the selected session turn."));}
                    return Err(format!("{tool} exited with {status}. {}",if detail.is_empty(){"Inspect the selected conversation before retrying.".into()}else{detail}));
                }
                if deadline.expired() {let _=child.kill();let _=child.wait();let _=diagnostic.join();return Err(format!("{tool} timed out after 15 minutes; inspect the conversation before retrying."));}
                std::thread::sleep(Duration::from_millis(250));
            }
        }
        _ => Err("This editor conversation has no supported automatic submission path.".into()),
    }
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn rejects_ambiguous_or_unsafe_session_ids() {
        assert!(valid_id("abc-123"));
        for id in ["", "editor:abc", "../other", "a/b", "--force"] {assert!(!valid_id(id),"{id}");}
    }
    #[test] fn copilot_editor_chat_is_handoff_only() {
        let service=CodexService::new("/missing".into());let cursor=CursorService::new("/missing".into());
        let status=capability(Path::new("/missing"),Path::new("/missing"),"missing","copilot","abc",&service,&cursor);
        assert!(!status.automatic);
        assert!(status.reason.contains("VS Code"));
    }
    #[test] fn cli_delivery_resumes_the_exact_id_without_shell_interpolation(){
        let text="Review `$(touch /tmp/never)` and explain";
        for provider in ["cursor","claude"] {
            let args=cli_args(provider,"session-42",text);
            assert_eq!(args.iter().filter(|arg|arg.as_str()=="session-42").count(),1);
            assert_eq!(args.last().map(String::as_str),Some(text));
            assert!(args.iter().any(|arg|arg=="--resume"));
        }
        assert!(cli_args("claude","session-42",text).windows(2).any(|pair|pair==["--permission-prompts","none"]));
    }
    #[test] fn one_delivery_at_a_time_per_session(){
        let first=SessionLock::acquire("codex","session-42").unwrap();
        assert!(SessionLock::acquire("codex","session-42").is_err());
        drop(first);
        assert!(SessionLock::acquire("codex","session-42").is_ok());
    }
    #[test] fn extracts_text_from_cli_response_shapes(){
        assert_eq!(response_text(&json!({"result":"script"})),Some("script"));
        assert_eq!(response_text(&json!({"message":{"content":[{"type":"text","text":"prompt"}]}})),Some("prompt"));
        assert_eq!(response_text(&json!({"result":"  ","text":"fallback"})),Some("fallback"));
        assert_eq!(response_text(&json!({"result":{}})),None);
    }
}
