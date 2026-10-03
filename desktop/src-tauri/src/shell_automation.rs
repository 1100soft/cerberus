use std::{io::Read,path::Path,process::{Command,Stdio},time::{Duration,Instant}};
use serde::Serialize;
use tauri::ipc::Channel;

#[derive(Clone,Serialize)]
pub struct ShellChunk { pub stream:String,pub text:String }
#[derive(Serialize)]
pub struct ShellRun { pub result:String,pub stdout:String,pub stderr:String }

fn drain(mut input:impl Read+Send+'static,limit:usize,stream:&'static str,channel:Option<Channel<ShellChunk>>)->std::thread::JoinHandle<String>{
    std::thread::spawn(move||{let mut output=Vec::new();let mut buffer=[0u8;4096];let mut truncated=false;while let Ok(size)=input.read(&mut buffer){if size==0{break;}let remaining=limit.saturating_sub(output.len());output.extend_from_slice(&buffer[..size.min(remaining)]);truncated|=size>remaining;if let Some(channel)=&channel{let _=channel.send(ShellChunk{stream:stream.into(),text:String::from_utf8_lossy(&buffer[..size]).into_owned()});}}let mut text=String::from_utf8_lossy(&output).into_owned();if truncated{text.push_str("\n[output truncated at 1.9 MB]\n");}text})
}

pub fn run(repository:&Path,script:&str)->Result<String,String>{
    run_stream(repository,script,None).map(|output|output.result)
}
pub fn run_stream(repository:&Path,script:&str,channel:Option<Channel<ShellChunk>>)->Result<ShellRun,String>{
    run_stream_with_handoffs(repository,script,channel,None,&std::collections::HashMap::new())
}
pub fn run_stream_with_handoffs(repository:&Path,script:&str,channel:Option<Channel<ShellChunk>>,input:Option<&str>,outgoing:&std::collections::HashMap<String,String>)->Result<ShellRun,String>{
    run_stream_with_context(repository,script,channel,input,outgoing,&std::collections::HashMap::new())
}
pub fn run_stream_with_context(repository:&Path,script:&str,channel:Option<Channel<ShellChunk>>,input:Option<&str>,outgoing:&std::collections::HashMap<String,String>,context:&std::collections::HashMap<String,String>)->Result<ShellRun,String>{
    if script.trim().is_empty()||script.len()>100_000{return Err("Enter a shell command or script of at most 100,000 characters.".into());}
    if !repository.is_dir(){return Err("The repository folder is unavailable.".into());}
    let mut command=Command::new("bash");
    command.arg("-c").arg(script).current_dir(repository).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for (name,_) in std::env::vars_os(){if name.to_string_lossy().starts_with("CERBERUS_"){command.env_remove(name);}}
    let state=crate::repository_changes::commit_state(repository)?;
    for name in ["CERBERUS_REPOSITORY_ID","CERBERUS_REPOSITORY_NAME","CERBERUS_AUTOMATION_ID","CERBERUS_AUTOMATION_NAME","CERBERUS_RUN_ID","CERBERUS_CONDITIONS","CERBERUS_CI_RUN_URL","CERBERUS_CI_CONCLUSION"] {command.env(name,context.get(name).map(String::as_str).unwrap_or(""));}
    command.env("CERBERUS_REPOSITORY_PATH",repository);
    command.env("CERBERUS_BRANCH",context.get("CERBERUS_BRANCH").filter(|value|!value.is_empty()).unwrap_or(&state.branch));
    command.env("CERBERUS_COMMIT_SHA",context.get("CERBERUS_COMMIT_SHA").filter(|value|!value.is_empty()).unwrap_or(&state.head));
    command.env_remove("CERBERUS_HANDOFF_INPUT");
    if let Some(path)=input{command.env("CERBERUS_HANDOFF_INPUT",path);}
    for (name,path) in outgoing {if crate::handoffs::valid_name(name){command.env(format!("CERBERUS_HANDOFF_{}",name.replace('-',"_").to_ascii_uppercase()),path);}}
    #[cfg(unix)] {use std::os::unix::process::CommandExt;command.process_group(0);}
    let mut child=command.spawn().map_err(|error|format!("Could not start shell: {error}"))?;
    let stdout=drain(child.stdout.take().ok_or("Shell output unavailable")?,1_900_000,"stdout",channel.clone());
    let stderr=drain(child.stderr.take().ok_or("Shell error output unavailable")?,1_900_000,"stderr",channel);
    let deadline=Instant::now()+Duration::from_secs(900);
    let status=loop{
        if let Some(status)=child.try_wait().map_err(|error|error.to_string())?{break status;}
        if Instant::now()>=deadline{
            #[cfg(unix)] unsafe{libc::killpg(child.id() as i32,libc::SIGKILL);}
            let _=child.kill();let _=child.wait();let _=stdout.join();let _=stderr.join();
            return Err("Shell script timed out after 15 minutes.".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let output=stdout.join().unwrap_or_default();let errors=stderr.join().unwrap_or_default();
    if !status.success(){return Err(format!("Shell exited with {status}. {}",if errors.is_empty(){output.trim()}else{errors.trim()}));}
    let result=if output.trim().is_empty(){"Shell command completed.".into()}else{output.trim().to_owned()};
    Ok(ShellRun{result,stdout:output,stderr:errors})
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn context_is_exported_without_interpolating_shell_code(){
        let root=tempfile::tempdir().unwrap();
        assert!(Command::new("git").args(["init","-q","-b","context-branch"]).arg(root.path()).status().unwrap().success());
        assert!(Command::new("git").current_dir(root.path()).args(["-c","user.name=Test","-c","user.email=test@example.invalid","commit","-q","--allow-empty","-m","Context"]).status().unwrap().success());
        let state=crate::repository_changes::commit_state(root.path()).unwrap();
        let checkout=run_stream_with_context(root.path(),"printf '%s|%s' \"$CERBERUS_BRANCH\" \"$CERBERUS_COMMIT_SHA\"",None,None,&Default::default(),&Default::default()).unwrap();
        assert_eq!(checkout.stdout,format!("context-branch|{}",state.head));
        let value="feature/space ; $(printf unsafe)";
        let context=std::collections::HashMap::from([("CERBERUS_BRANCH".into(),value.into()),("CERBERUS_COMMIT_SHA".into(),"event-sha".into()),("CERBERUS_REPOSITORY_PATH".into(),"wrong-path".into()),("PATH".into(),"wrong-path".into())]);
        let output=run_stream_with_context(root.path(),"printf '%s|%s|%s' \"$CERBERUS_BRANCH\" \"$CERBERUS_COMMIT_SHA\" \"$CERBERUS_REPOSITORY_PATH\"",None,None,&Default::default(),&context).unwrap();
        assert_eq!(output.stdout,format!("{value}|event-sha|{}",root.path().display()));
        let fallback=run_stream_with_context(root.path(),"printf '%s' \"$CERBERUS_CI_RUN_URL\"",None,None,&Default::default(),&Default::default()).unwrap();
        assert_eq!(fallback.stdout,"");
    }
    #[test] fn runs_in_selected_repository_and_reports_failures(){
        let root=std::env::temp_dir().join(format!("gitcerberus-shell-test-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(run(&root,"pwd").unwrap(),root.display().to_string());
        let output=run_stream(&root,"printf 'hello'; printf 'warning' >&2",None).unwrap();
        assert_eq!(output.stdout,"hello");
        assert_eq!(output.stderr,"warning");
        assert!(run(&root,"printf 'failure' >&2; exit 7").unwrap_err().contains("failure"));
        assert!(run(&root," ").is_err());
        let paths=std::collections::HashMap::from([("review-needed".to_owned(),"/tmp/review-payload".to_owned())]);
        let handoff=run_stream_with_handoffs(&root,"printf '%s|%s' \"$CERBERUS_HANDOFF_INPUT\" \"$CERBERUS_HANDOFF_REVIEW_NEEDED\"",None,Some("/tmp/incoming-payload"),&paths).unwrap();
        assert_eq!(handoff.stdout,"/tmp/incoming-payload|/tmp/review-payload");
        std::fs::remove_dir_all(root).unwrap();
    }
}
