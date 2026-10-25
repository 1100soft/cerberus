use std::{io::Read,path::Path,process::{Command,Stdio},time::Duration};
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
    run_stream_with_runtime(repository,script,channel,input,outgoing,context,&crate::script_runtime::Runtime{preset:"bash".into(),..Default::default()})
}
pub fn run_stream_with_runtime(repository:&Path,script:&str,channel:Option<Channel<ShellChunk>>,input:Option<&str>,outgoing:&std::collections::HashMap<String,String>,context:&std::collections::HashMap<String,String>,runtime:&crate::script_runtime::Runtime)->Result<ShellRun,String>{
    if script.trim().is_empty()||script.len()>100_000{return Err("Enter a script of at most 100,000 characters.".into());}
    if !repository.is_dir(){return Err("The repository folder is unavailable.".into());}
    let (executable,args,extension)=crate::script_runtime::resolve(repository,runtime)?;
    let mut file=tempfile::Builder::new().prefix("cerberus-script-").suffix(&format!(".{extension}")).tempfile().map_err(|e|e.to_string())?;
    use std::io::Write;
    #[cfg(windows)] if runtime.preset=="powershell"{file.write_all(b"\xef\xbb\xbf").map_err(|error|error.to_string())?;}
    file.write_all(script.as_bytes()).map_err(|e|e.to_string())?;file.flush().map_err(|e|e.to_string())?;
    let mut command=Command::new(&executable);
    command.args(args).arg(file.path()).current_dir(repository).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for (name,_) in std::env::vars_os(){if name.to_string_lossy().starts_with("CERBERUS_"){command.env_remove(name);}}
    let state=crate::repository_changes::checkout_state(repository)?;
    for name in ["CERBERUS_REPOSITORY_ID","CERBERUS_REPOSITORY_NAME","CERBERUS_AUTOMATION_ID","CERBERUS_AUTOMATION_NAME","CERBERUS_RUN_ID","CERBERUS_CONDITIONS","CERBERUS_CI_RUN_URL","CERBERUS_CI_CONCLUSION"] {command.env(name,context.get(name).map(String::as_str).unwrap_or(""));}
    for (name,value) in context {
        if let Some(suffix)=name.strip_prefix("CERBERUS_INPUT_") {
            if !suffix.is_empty() && suffix.bytes().all(|byte|byte.is_ascii_uppercase()||byte.is_ascii_digit()||byte==b'_') {
                command.env(name,value);
            }
        }
    }
    if context.contains_key("CERBERUS_TRACK_RECORDS") {for (key,value) in context {if key.starts_with("CERBERUS_TRACK_")||key.starts_with("CERBERUS_FEEDBACK_")||key=="PATH"||key=="GIT_CONFIG_COUNT"||key.starts_with("GIT_CONFIG_KEY_")||key.starts_with("GIT_CONFIG_VALUE_"){command.env(key,value);}}}
    command.env("CERBERUS_REPOSITORY_PATH",repository);
    if runtime.preset=="python"{
        let mut paths=vec![repository.to_path_buf()];
        if let Some(existing)=std::env::var_os("PYTHONPATH"){paths.extend(std::env::split_paths(&existing));}
        command.env("PYTHONPATH",std::env::join_paths(paths).map_err(|error|error.to_string())?);
    }
    command.env("CERBERUS_BRANCH",context.get("CERBERUS_BRANCH").filter(|value|!value.is_empty()).unwrap_or(&state.branch));
    command.env("CERBERUS_COMMIT_SHA",context.get("CERBERUS_COMMIT_SHA").filter(|value|!value.is_empty()).unwrap_or(&state.head));
    command.env_remove("CERBERUS_HANDOFF_INPUT");
    if let Some(path)=input{command.env("CERBERUS_HANDOFF_INPUT",path);}
    for (name,path) in outgoing {if crate::handoffs::valid_name(name){command.env(format!("CERBERUS_HANDOFF_{}",name.replace('-',"_").to_ascii_uppercase()),path);}}
    #[cfg(unix)] {use std::os::unix::process::CommandExt;command.process_group(0);}
    let mut child=command.spawn().map_err(|error|format!("Could not start script interpreter {}: {error}",executable.display()))?;
    let stdout=drain(child.stdout.take().ok_or("Script output unavailable")?,1_900_000,"stdout",channel.clone());
    let stderr=drain(child.stderr.take().ok_or("Script error output unavailable")?,1_900_000,"stderr",channel);
    let mut deadline=crate::awake::ActiveDeadline::new(Duration::from_secs(900));
    let status=loop{
        if let Some(status)=child.try_wait().map_err(|error|error.to_string())?{break status;}
        if deadline.expired(){
            #[cfg(unix)] unsafe{libc::killpg(child.id() as i32,libc::SIGKILL);}
            crate::setup_terminal::stop_process_tree(&mut child);let _=child.wait();let _=stdout.join();let _=stderr.join();
            return Err("Script timed out after 15 minutes.".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let output=stdout.join().unwrap_or_default();let errors=stderr.join().unwrap_or_default();
    if !status.success(){return Err(format!("Script exited with {status}. {}",if errors.is_empty(){output.trim()}else{errors.trim()}));}
    let result=if output.trim().is_empty(){"Script completed.".into()}else{output.trim().to_owned()};
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
        let inputs=std::collections::HashMap::from([("CERBERUS_INPUT_VERSION".into(),"minor".into()),("CERBERUS_INPUT_NOTES".into(),value.into()),("CERBERUS_INPUT_bad-name".into(),"unsafe".into())]);
        let manual=run_stream_with_context(root.path(),"printf '%s|%s|%s' \"$CERBERUS_INPUT_VERSION\" \"$CERBERUS_INPUT_NOTES\" \"${CERBERUS_INPUT_bad-unset}\"",None,None,&Default::default(),&inputs).unwrap();
        assert_eq!(manual.stdout,format!("minor|{value}|unset"));
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
#[cfg(test)]mod runtime_tests{
 use super::*;
 #[test]fn python_preserves_repository_context_inputs_and_handoffs(){
  let repo=tempfile::tempdir().unwrap();let root=repo.path();
  assert!(Command::new("git").arg("-C").arg(root).args(["init","-q"]).status().unwrap().success());
  assert!(Command::new("git").arg("-C").arg(root).args(["-c","user.name=Fixture","-c","user.email=fixture@example.test","commit","--allow-empty","-qm","base"]).status().unwrap().success());
  let output=root.join("handoff.json");let outgoing=std::collections::HashMap::from([("release".into(),output.to_string_lossy().into())]);
  let context=std::collections::HashMap::from([("CERBERUS_INPUT_LEVEL".into(),"patch ; $(unsafe)".into())]);
  let runtime=crate::script_runtime::Runtime{preset:"python".into(),..Default::default()};
  let result=run_stream_with_runtime(root,"import os,json\nfrom pathlib import Path\nassert Path.cwd()==Path(os.environ['CERBERUS_REPOSITORY_PATH'])\nPath(os.environ['CERBERUS_HANDOFF_RELEASE']).write_text(json.dumps({'level':os.environ['CERBERUS_INPUT_LEVEL']}))\nprint('runtime works')\n",None,None,&outgoing,&context,&runtime).unwrap();
  assert_eq!(result.stdout.trim(),"runtime works");assert!(std::fs::read_to_string(output).unwrap().contains("patch ; $(unsafe)"));
 }
}
