//! Explicit local CLI runs. Provider credentials never come from a GitHub identity.
use crate::{models::Repository, setup_terminal::SetupOutput};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::ipc::Channel;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub executable: String,
    #[serde(default)] pub subscription: bool,
    #[serde(default)] pub disconnected: bool,
    #[serde(default)] pub email: Option<String>,
    #[serde(default)] pub plan: Option<String>,
}
struct ActiveRun {
    repository_id: String,
    profile_id: String,
    cancel: Arc<AtomicBool>,
}
#[derive(Default)]
pub struct Agents {
    active: Mutex<HashMap<PathBuf, ActiveRun>>,
    profiles_lock: Mutex<()>,
    stopping: AtomicBool,
}
fn entry(id: &str) -> Result<keyring::Entry, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid agent profile")?;
    keyring::Entry::new("dev.gitcerberus.agents", id).map_err(|e| e.to_string())
}
impl Agents {
    pub fn profiles(&self, root: &Path) -> Result<Vec<Profile>, String> {
        let path = root.join("agent-profiles.json");
        if !path.exists() {
            return Ok(vec![]);
        }
        serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    }
    pub fn store_subscription(&self, root: &Path, profile: Profile) -> Result<(),String> {
        let _lock=self.profiles_lock.lock().map_err(|e|e.to_string())?;
        let mut profiles=self.profiles(root)?;
        profiles.retain(|p|p.id!=profile.id);profiles.push(profile);
        write_profiles(root,&profiles).map_err(|e|e.to_string())
    }
    pub fn save(
        &self,
        root: &Path,
        label: String,
        provider: String,
        executable: String,
        key: String,
    ) -> Result<Profile, String> {
        let _lock = self.profiles_lock.lock().map_err(|e| e.to_string())?;
        if !matches!(provider.as_str(), "codex" | "cursor")
            || label.trim().is_empty()
            || key.trim().is_empty()
        {
            return Err("Provider, name and API key are required".into());
        }
        let profile = Profile {
            id: uuid::Uuid::new_v4().to_string(),
            label: label.trim().into(),
            provider,
            executable: executable.trim().into(), ..Profile::default()
        };
        let mut profiles = self.profiles(root)?;
        entry(&profile.id)?
            .set_password(key.trim())
            .map_err(|e| format!("Could not save API key in the OS keychain: {e}"))?;
        profiles.push(profile.clone());
        if let Err(error) = write_profiles(root, &profiles) {
            let _ = entry(&profile.id)?.delete_credential();
            return Err(error.to_string());
        }
        Ok(profile)
    }
    pub fn remove(&self, root: &Path, id: &str) -> Result<(), String> {
        let _lock = self.profiles_lock.lock().map_err(|e| e.to_string())?;
        let mut profiles = self.profiles(root)?;
        if profiles.iter().any(|profile|profile.id==id && profile.subscription) {return Err("Disconnect ChatGPT accounts from Identities".into());}
        match entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => (),
            Err(e) => return Err(e.to_string()),
        }
        profiles.retain(|p| p.id != id);
        write_profiles(root, &profiles).map_err(|e| e.to_string())
    }
    pub fn profile_running(&self,id:&str)->Result<bool,String>{Ok(self.active.lock().map_err(|e|e.to_string())?.values().any(|run|run.profile_id==id))}
    pub fn cancel_checkout(&self,repository_id:&str,path:&Path)->Result<(),String>{
        let path=path.canonicalize().map_err(|error|error.to_string())?;
        if let Some(run)=self.active.lock().map_err(|error|error.to_string())?.get(&path){if run.repository_id==repository_id{run.cancel.store(true,Ordering::SeqCst);}}
        Ok(())
    }
    pub fn cancel_all(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        if let Ok(active) = self.active.lock() {
            for run in active.values() {
                run.cancel.store(true, Ordering::SeqCst);
            }
        }
        for _ in 0..50 {
            if self.active.lock().map(|a| a.is_empty()).unwrap_or(true) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    pub fn run(
        &self,
        root: &Path,
        profile_id: &str,
        repo: &Repository,
        prompt: &str,
        mode: &str,
        selected_model: Option<&str>,
        reasoning_effort: Option<&str>,
        resume: Option<&crate::agent_sessions::ResumeTarget>,
        codex: &crate::codex::CodexService,
        output: Channel<SetupOutput>,
    ) -> Result<(), String> {
        if prompt.trim().is_empty() || prompt.len() > 100_000 {
            return Err("Enter a task of at most 100,000 bytes".into());
        }
        let mut profile = self
            .profiles(root)?
            .into_iter()
            .find(|p| p.id == profile_id)
            .ok_or("Agent profile not found")?;
        profile.executable = crate::provider_paths::resolve(
            root,
            if profile.provider == "codex" {
                "codex"
            } else {
                "cursor-agent"
            },
        )?
        .ok_or("Agent executable not found. Open provider setup to install it.")?
        .to_string_lossy()
        .into_owned();
        if profile.disconnected { return Err("This ChatGPT identity is disconnected. Reconnect it in Identities.".into()); }
        let key = if profile.subscription { String::new() } else { entry(profile_id)?.get_password().map_err(|e| format!("Agent key is unavailable: {e}"))? };
        let path = Path::new(&repo.local_path)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut active = self.active.lock().map_err(|e| e.to_string())?;
            if self.stopping.load(Ordering::SeqCst) {
                return Err("Application is shutting down".into());
            }
            if active.contains_key(&path) {
                return Err("An agent is already running in this checkout".into());
            }
            active.insert(
                path.clone(),
                ActiveRun {
                    repository_id: repo.id.clone(), profile_id:profile_id.into(),
                    cancel: cancel.clone(),
                },
            );
        }
        let result = (|| {
            let source_home = if let Some(target) = resume { crate::agent_sessions::resolve(root, &profile, &path, target, codex)? } else { root.join("agent-homes").join(profile_id) };
            let home = if profile.subscription {
                let account_home = root.join("agent-homes").join(profile_id);

                account_home
            } else { source_home.clone() };
            std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
            let mut command = command(&profile, &path, &home, mode, prompt, &key, resume.map(|target| target.session_id.as_str()))?;
            if profile.provider == "codex" && !profile.subscription {
                if let Some(model) = resume.and_then(|target| crate::agent_sessions::recorded_model(&home, &target.session_id)) { command.args(["--model", &model]); }
            }
            let root = root.to_path_buf();
            let template = crate::agent_sessions::SessionRecord {session_id:String::new(), provider:profile.provider.clone(), profile_id:profile.id.clone(), repository:path.clone(), home:if resume.is_some() {source_home.clone()} else {home.clone()}};
            let expected = resume.map(|target| target.session_id.clone());
            let session_cancel = cancel.clone();
            let output = Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(body) = body {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&body) {
                        if let Some(text) = value["text"].as_str() {
                            if let Some(id) = crate::agent_sessions::session_event(text) {
                                if expected.as_ref().is_some_and(|expected| expected != &id) {
                                    session_cancel.store(true, Ordering::SeqCst);
                                    return output.send(SetupOutput {text:"Resume failed: the provider returned a different session. Run stopped; choose Start new chat explicitly.\n".into()});
                                }
                                let mut record = template.clone(); record.session_id = id;
                                if let Err(error) = crate::agent_sessions::save(&root, &record) {
                                    let _ = output.send(SetupOutput {text:format!("Could not save session for resuming: {error}\n")});
                                }
                            }
                            return output.send(SetupOutput {text:text.to_string()});
                        }
                    }
                }
                Ok(())
            });
            if let Some(identity) = &repo.identity {
                command
                    .env("GIT_AUTHOR_NAME", &identity.git_name)
                    .env("GIT_COMMITTER_NAME", &identity.git_name)
                    .env("GIT_AUTHOR_EMAIL", &identity.git_email)
                    .env("GIT_COMMITTER_EMAIL", &identity.git_email);
            }
            let before = crate::agent_edits::snapshot(&path);
            let summary_output = output.clone();
            let result = if profile.subscription {
                let model=selected_model.map(String::from).or_else(||resume.and_then(|target|crate::agent_sessions::recorded_model(&source_home,&target.session_id)));
                let rollout=resume.map(|target|crate::agent_sessions::rollout_path(&source_home,&target.session_id,&path)).transpose()?;
                crate::subscription_run::run(command,&profile,&path,mode,prompt,resume.map(|target|target.session_id.as_str()),model.as_deref(),reasoning_effort,rollout.as_deref(),cancel,output)
            } else { execute(
                command,
                if profile.provider == "codex" {
                    Some(prompt)
                } else {
                    None
                },
                cancel,
                output,
                &key,
            ) };
            match before.and_then(|before| crate::agent_edits::snapshot(&path).map(|after| crate::agent_edits::changes(&before, &after))) {
                Ok(changes) => { let _ = summary_output.send(SetupOutput {text:format!("{}\n", serde_json::json!({"type":"workspace_changes","repository":path,"changes":changes}))}); }
                Err(error) => { let _ = summary_output.send(SetupOutput {text:format!("Workspace change summary unavailable: {error}\n")}); }
            }
            result
        })();
        self.active.lock().map_err(|e| e.to_string())?.remove(&path);
        if profile.subscription && result.as_ref().err().is_some_and(|error|error.contains("ChatGPT authentication was rejected") || error.contains("ChatGPT credentials are unavailable") || error.contains("does not match the assigned identity")) {
            profile.disconnected=true;
            let _=self.store_subscription(root,profile);
        }
        result
    }
}
fn write_profiles(root: &Path, profiles: &[Profile]) -> std::io::Result<()> {
    let temporary = root.join("agent-profiles.pending.json");
    std::fs::write(&temporary, serde_json::to_vec_pretty(profiles)?)?;
    std::fs::rename(temporary, root.join("agent-profiles.json"))
}
fn command(
    profile: &Profile,
    path: &Path,
    home: &Path,
    mode: &str,
    prompt: &str,
    key: &str,
    session_id: Option<&str>,
) -> Result<Command, String> {
    if !matches!(mode, "analyze" | "edit" | "full") {
        return Err("Unknown agent mode".into());
    }
    let mut command = Command::new(&profile.executable);
    command
        .current_dir(path)
        .env_remove("OPENAI_API_KEY")
        .env_remove("CODEX_API_KEY")
        .env_remove("CODEX_ACCESS_TOKEN")
        .env_remove("CURSOR_API_KEY")
        .env_remove("GH_TOKEN")
        .env_remove("GITHUB_TOKEN");
    match profile.provider.as_str() {
        "codex" => {
            command.env("CODEX_HOME", home);
            if profile.subscription { command.args(["app-server","-c","forced_login_method=\"chatgpt\"","-c","cli_auth_credentials_store=\"keyring\"","-c","model_provider=\"openai\""]); return Ok(command); }
            else { command.env("CODEX_API_KEY", key); }
            command.args(["exec", "--json", "--color", "never", "--sandbox", if mode == "full" { "danger-full-access" } else if mode == "edit" { "workspace-write" } else { "read-only" }, "-c", "approval_policy=\"never\"", "-c", "shell_environment_policy.exclude=[\"CODEX_API_KEY\",\"OPENAI_API_KEY\",\"CURSOR_API_KEY\"]"]);
            if let Some(id) = session_id { command.args(["resume", id]); }
            command.arg("-");
        }
        "cursor" => {
            if let Some(id) = session_id { command.args(["--resume", id]); }
            if mode != "analyze" {
                command.arg("--force");
            } else {
                command.args(["--mode", "ask"]);
            }
            command
                .env("CURSOR_API_KEY", key)
                .args([
                    "--print",
                    "--output-format",
                    "stream-json",
                    "--sandbox",
                    if mode == "full" { "disabled" } else { "enabled" },
                    "--workspace",
                ])
                .arg(path)
                .arg("--")
                .arg(prompt);
        }
        _ => return Err("Unknown provider".into()),
    }
    Ok(command)
}
fn exhausted_credits(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    let diagnostic = match serde_json::from_str::<serde_json::Value>(line) {
        Ok(event) => event["type"] == "error" || event["type"] == "turn.failed" || event["item"]["type"] == "error",
        Err(_) => lower.contains("stream disconnected") || lower.starts_with("error:") || lower.contains("reconnecting"),
    };
    diagnostic && (lower.contains("no credits remaining") || lower.contains("insufficient_quota"))
}
fn execute(
    mut command: Command,
    prompt: Option<&str>,
    cancel: Arc<AtomicBool>,
    output: Channel<SetupOutput>,
    key: &str,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .stdin(if prompt.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start agent CLI: {e}. Check the profile executable."))?;
    if let Some(prompt) = prompt {
        let prompt = prompt.to_owned();
        let mut input = child.stdin.take().unwrap();
        // Keep cancellation responsive even if a CLI delays reading its input.
        std::thread::spawn(move || {
            let _ = input.write_all(prompt.as_bytes());
        });
    }
    let billing_failure = Arc::new(AtomicBool::new(false));
    let diagnostics = Arc::new(Mutex::new(String::new()));
    let mut readers = Vec::new();
    for pipe in [
        Box::new(child.stdout.take().unwrap()) as Box<dyn std::io::Read + Send>,
        Box::new(child.stderr.take().unwrap()),
    ] {
        let output = output.clone();
        let key = key.to_owned();
        let diagnostics = diagnostics.clone();
        let billing_failure = billing_failure.clone();
        readers.push(std::thread::spawn(move || {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let line = if key.is_empty() { line } else { line.replace(&key, "[redacted]") };
                if exhausted_credits(&line) { billing_failure.store(true, Ordering::SeqCst); }
                if let Ok(mut tail) = diagnostics.lock() { tail.push_str(&line); tail.push('\n'); if tail.len() > 8000 { let mut start = tail.len()-8000; while !tail.is_char_boundary(start) { start += 1; } tail.drain(..start); } }
                let _ = output.send(SetupOutput {text:format!("{line}\n")});
            }
        }));
    }
    loop {
        if billing_failure.load(Ordering::SeqCst) {
            crate::setup_terminal::stop_process_tree(&mut child); let _ = child.wait();
            for reader in readers { let _ = reader.join(); }
            return Err("The selected API account has no credits remaining. Add API credits or choose another funded account. Your conversation is preserved.".into());
        }
        if cancel.load(Ordering::SeqCst) {
            crate::setup_terminal::stop_process_tree(&mut child);
            let _ = child.wait();
            for reader in readers { let _ = reader.join(); }
            return Err("Run stopped. Any edits already made remain in the checkout.".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                crate::setup_terminal::stop_process_tree(&mut child);
                for reader in readers { let _ = reader.join(); }
                return if status.success() {
                    Ok(())
                } else {
                    Err(format!("Agent exited with {status}: {}", diagnostics.lock().map(|tail| tail.trim().to_string()).unwrap_or_default()))
                };
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(100)),
            Err(e) => {
                crate::setup_terminal::stop_process_tree(&mut child);
                let _ = child.wait();
                for reader in readers { let _ = reader.join(); }
                return Err(e.to_string());
            }
        }
    }
}
#[cfg(test)]
mod tests {
    #[test] fn cancelling_one_checkout_does_not_stop_another_context(){
        let agents=super::Agents::default();let left=tempfile::tempdir().unwrap();let right=tempfile::tempdir().unwrap();
        let first=std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));let second=std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        for (path,cancel) in [(left.path(),first.clone()),(right.path(),second.clone())]{agents.active.lock().unwrap().insert(path.canonicalize().unwrap(),super::ActiveRun{repository_id:"repo".into(),profile_id:"profile".into(),cancel});}
        agents.cancel_checkout("repo",left.path()).unwrap();assert!(first.load(std::sync::atomic::Ordering::SeqCst));assert!(!second.load(std::sync::atomic::Ordering::SeqCst));
    }

    use super::*;
    #[test]
    fn only_provider_diagnostics_stop_credit_retries() {
        assert!(exhausted_credits("Reconnecting... (stream disconnected: You have no credits remaining.)"));
        assert!(!exhausted_credits(r#"{"type":"item.completed","item":{"type":"agent_message","text":"Explain no credits remaining"}}"#));
    }
    #[test]
    fn explicit_credentials_and_permissions() {
        let mut profile = Profile {
            id: "test".into(),
            label: "Work".into(),
            provider: "codex".into(),
            executable: "codex".into(), ..Profile::default()
        };
        let cmd = command(
            &profile,
            Path::new("/repo"),
            Path::new("/profile"),
            "analyze",
            "--bad;echo secret",
            "key",
            None,
        )
        .unwrap();
        let args: Vec<_> = cmd.get_args().map(|a| a.to_str().unwrap()).collect();
        assert!(args.contains(&"read-only"));
        assert!(!args.contains(&"--bad;echo secret"));
        assert!(cmd
            .get_envs()
            .any(|(k, v)| k == "CODEX_HOME" && v == Some(std::ffi::OsStr::new("/profile"))));
        profile.subscription=true;
        let subscription=command(&profile,Path::new("/repo"),Path::new("/account-home"),"edit","task","must-not-be-used",None).unwrap();
        let subscription_args:Vec<_>=subscription.get_args().map(|a|a.to_str().unwrap()).collect();
        assert!(subscription_args.contains(&"forced_login_method=\"chatgpt\""));
        assert!(subscription_args.contains(&"app-server"));
        assert!(!subscription_args.contains(&"exec"));
        assert!(subscription.get_envs().any(|(key,value)|key=="CODEX_API_KEY" && value.is_none()));
        profile.subscription=false;
        profile.provider = "cursor".into();
        let edit = command(
            &profile,
            Path::new("/repo"),
            Path::new("/profile"),
            "edit",
            "task",
            "key",
            None,
        )
        .unwrap();
        let edit_args: Vec<_> = edit.get_args().map(|a| a.to_str().unwrap()).collect();
        assert!(edit_args.contains(&"--force"));
        assert!(edit_args
            .windows(2)
            .any(|pair| pair == ["--sandbox", "enabled"]));
        let cmd = command(
            &profile,
            Path::new("/repo"),
            Path::new("/profile"),
            "analyze",
            "--bad",
            "key",
            None,
        )
        .unwrap();
        let args: Vec<_> = cmd.get_args().map(|a| a.to_str().unwrap()).collect();
        assert!(args.ends_with(&["--", "--bad"]));
        assert!(!args.contains(&"--force"));
    }
    #[test]
    fn resume_commands_keep_session_and_permissions_explicit() {
        for provider in ["codex", "cursor"] {
            let profile = Profile {id:"p".into(),label:"Work".into(),provider:provider.into(),executable:provider.into(),..Profile::default()};
            let command = command(&profile, Path::new("/repo"), Path::new("/home/profile"), "analyze", "next message", "secret", Some("session123")).unwrap();
            let args: Vec<_> = command.get_args().map(|arg| arg.to_str().unwrap()).collect();
            assert!(args.windows(2).any(|pair| pair == [if provider == "codex" {"resume"} else {"--resume"}, "session123"]));
            assert!(args.windows(2).any(|pair| pair == ["--sandbox", if provider == "codex" {"read-only"} else {"enabled"}]));
            assert!(!args.contains(&"--last") && !args.contains(&"--continue") && !args.contains(&"secret"));
        }
    }
    #[cfg(unix)]
    #[test]
    fn streams_output_redacts_keys_and_reports_failure() {
        let (send, receive) = std::sync::mpsc::channel();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(body) = body {
                let _ = send.send(body);
            }
            Ok(())
        });
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "cat; printf 'provider-secret\n' >&2; exit 7"]);
        let result = execute(
            cmd,
            Some("a literal prompt; $(not executed)"),
            Arc::new(AtomicBool::new(false)),
            channel,
            "provider-secret",
        );
        let error = result.unwrap_err();
        assert!(error.contains("7")); assert!(error.contains("[redacted]")); assert!(!error.contains("provider-secret"));
        let mut text = String::new();
        for _ in 0..2 {
            text.push_str(
                &receive
                    .recv_timeout(std::time::Duration::from_secs(2))
                    .unwrap(),
            );
        }
        assert!(text.contains("a literal prompt; $(not executed)"));
        assert!(text.contains("[redacted]"));
        assert!(!text.contains("provider-secret"));
    }
    #[cfg(unix)]
    #[test]
    fn exhausted_credit_diagnostic_stops_retries_with_specific_reason() {
        let mut cmd = Command::new("sh"); cmd.args(["-c", "printf 'Reconnecting: stream disconnected: You have no credits remaining.\n'; sleep 30"]);
        let start = std::time::Instant::now();
        let error = execute(cmd,None,Arc::new(AtomicBool::new(false)),Channel::new(|_|Ok(())),"secret").unwrap_err();
        assert!(error.contains("no credits remaining")); assert!(!error.contains("Run stopped")); assert!(start.elapsed().as_secs()<3);
    }
    #[cfg(unix)]
    #[test]
    fn cancellation_reaps_process() {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", "sleep 30"]);
        let start = std::time::Instant::now();
        assert!(execute(
            cmd,
            None,
            Arc::new(AtomicBool::new(true)),
            Channel::new(|_| Ok(())),
            "secret"
        )
        .is_err());
        assert!(start.elapsed().as_secs() < 3);
    }
}
