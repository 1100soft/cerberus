use crate::{agents::Profile, codex::CodexService};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{io::{BufRead, BufReader}, path::{Path, PathBuf}};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeTarget { pub session_id: String, pub provider: String, pub source: String }
#[derive(Serialize)]
pub struct ResumeStatus { pub available: bool, pub reason: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord { pub session_id: String, pub provider: String, pub profile_id: String, pub repository: PathBuf, pub home: PathBuf }
fn valid_id(id: &str) -> bool { id.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric) && id.len() <= 128 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') }
fn record_path(root: &Path, profile: &str, id: &str) -> Result<PathBuf, String> {
    if !valid_id(profile) || !valid_id(id) { return Err("Invalid session identifier".into()); }
    Ok(root.join("agent-sessions").join(profile).join(format!("{id}.json")))
}
pub fn save(root: &Path, record: &SessionRecord) -> Result<(), String> {
    let path = record_path(root, &record.profile_id, &record.session_id)?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let temporary = path.with_extension(format!("{}.pending", uuid::Uuid::new_v4()));
    std::fs::write(&temporary, serde_json::to_vec(record).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(temporary, path).map_err(|e| e.to_string())
}
pub fn session_event(text: &str) -> Option<String> {
    let value: Value = serde_json::from_str(text).ok()?;
    let id = if value["type"] == "thread.started" { value["thread_id"].as_str()? }
      else if value["type"] == "system" && value["subtype"] == "init" { value["session_id"].as_str()? }
      else { return None; };
    valid_id(id).then(|| id.to_string())
}
pub fn validate_rollout(file: &Path, id: &str, repository: &Path) -> Result<(), String> {
    let line = BufReader::new(std::fs::File::open(file).map_err(|_| "The stored Codex session is unavailable")?).lines().next().ok_or("Empty Codex session")?.map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_str(&line).map_err(|_| "Unreadable Codex session")?;
    if value["payload"]["history_mode"] == "paginated" { return Err("This Codex conversation uses paginated history, which the installed app-server cannot resume yet. Start a new chat".into()); }
    let cwd = value["payload"]["cwd"].as_str().ok_or("The session has no repository location")?;
    if value["type"] != "session_meta" || value["payload"]["id"].as_str() != Some(id) || Path::new(cwd).canonicalize().ok() != Some(repository.canonicalize().map_err(|e| e.to_string())?) {
        return Err("This session does not belong to the selected repository".into());
    }
    Ok(())
}
fn find_rollout(dir: &Path, id: &str, depth: u8) -> Option<PathBuf> {
    if depth == 0 { return None; }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let kind = entry.file_type().ok()?;
        if kind.is_dir() { if let Some(path) = find_rollout(&entry.path(), id, depth-1) { return Some(path); } }
        else if kind.is_file() && entry.file_name().to_string_lossy().ends_with(&format!("{id}.jsonl")) { return Some(entry.path()); }
    }
    None
}
pub fn rollout_path(home:&Path,id:&str,repository:&Path)->Result<PathBuf,String>{
 let file=find_rollout(&home.join("sessions"),id,6).or_else(||find_rollout(&home.join("archived_sessions"),id,6)).ok_or("Stored conversation unavailable")?;
 validate_rollout(&file,id,repository)?;Ok(file)
}
pub fn copy_for_account(source: &Path, destination: &Path, id: &str, repository: &Path) -> Result<(),String> {
    if source == destination { return Ok(()); }
    if let Some(existing)=find_rollout(&destination.join("sessions"),id,6) { return validate_rollout(&existing,id,repository); }
    let file=find_rollout(&source.join("sessions"),id,6).or_else(||find_rollout(&source.join("archived_sessions"),id,6)).ok_or("Stored conversation is unavailable")?;
    validate_rollout(&file,id,repository)?;
    let target=destination.join("sessions").join(file.file_name().ok_or("Invalid session path")?);
    std::fs::create_dir_all(target.parent().unwrap()).map_err(|e|e.to_string())?;
    let temporary=target.with_extension("pending");std::fs::copy(&file,&temporary).map_err(|e|e.to_string())?;
    std::fs::rename(temporary,target).map_err(|e|e.to_string())
}
pub fn recorded_model(home: &Path, id: &str) -> Option<String> {
    let file = find_rollout(&home.join("sessions"), id, 6).or_else(|| find_rollout(&home.join("archived_sessions"), id, 6))?;
    let reader = BufReader::new(std::fs::File::open(file).ok()?);
    model_from_lines(reader.lines().map_while(Result::ok))
}
fn model_from_lines(lines: impl Iterator<Item=String>) -> Option<String> {
    let mut first = None; let mut current = None; let mut completed = None;
    for line in lines {
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue; };
        if value["type"] == "turn_context" {
            if let Some(model) = value["payload"]["model"].as_str().filter(|m| !m.is_empty() && m.len() <= 200 && !m.contains(char::is_control)) {
                current = Some(model.to_string()); if first.is_none() { first = current.clone(); }
            }
        }
        if value["type"] == "event_msg" && value["payload"]["type"] == "task_complete" { completed = current.clone(); }
    }
    completed.or(first)
}
fn cursor_store_in(config: &Path, id: &str) -> Option<PathBuf> {
    for bucket in std::fs::read_dir(config.join("chats")).ok()?.flatten() {
        if !bucket.file_type().ok()?.is_dir() { continue; }
        let file = bucket.path().join(id).join("store.db");
        if file.is_file() { return Some(file); }
    }
    None
}
fn cursor_store(id: &str) -> Option<PathBuf> {
    let config = std::env::var_os("CURSOR_CONFIG_DIR").filter(|value| !value.is_empty()).map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty()).map(|root| PathBuf::from(root).join("cursor")))
        .or_else(|| std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(|root| PathBuf::from(root).join(".cursor")))?;
    cursor_store_in(&config, id)
}
pub fn cursor_session_exists(id: &str) -> bool { valid_id(id) && cursor_store(id).is_some() }
pub fn resolve(root: &Path, profile: &Profile, repository: &Path, target: &ResumeTarget, codex: &CodexService) -> Result<PathBuf, String> {
    if target.provider != profile.provider { return Err("Choose an account for this conversation’s agent to continue it".into()); }
    if target.source != "app" && target.source != "codex-history" { return Err("This Cursor history entry is not a resumable CLI session. Start a new chat with the loaded messages".into()); }
    if !valid_id(&target.session_id) { return Err("This conversation has no resumable CLI session identifier".into()); }
    let repository = repository.canonicalize().map_err(|e| e.to_string())?;
    if target.source == "codex-history" && target.provider == "codex" {
        return codex.resume_home(&repository, &target.session_id);
    }
    if target.source != "app" { return Err("This Cursor history entry is not a resumable CLI session. Start a new chat with the loaded messages".into()); }
    let file = record_path(root, &profile.id, &target.session_id)?;
    let record: SessionRecord = serde_json::from_slice(&std::fs::read(file).map_err(|_| "The saved session is unavailable for this API account")?).map_err(|e| e.to_string())?;
    if record.profile_id != profile.id || record.provider != profile.provider || record.session_id != target.session_id || record.repository != repository { return Err("The session belongs to another account or repository".into()); }
    if profile.provider == "codex" {
        let file = find_rollout(&record.home.join("sessions"), &target.session_id, 6).or_else(|| find_rollout(&record.home.join("archived_sessions"), &target.session_id, 6)).ok_or("The stored Codex session was removed. Start a new chat")?;
        validate_rollout(&file, &target.session_id, &repository)?;
    }
    if profile.provider == "cursor" && cursor_store(&target.session_id).is_none() { return Err("The Cursor CLI session is missing from local storage. Start a new chat".into()); }
    Ok(record.home)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_preserves_last_completed_turn_not_failed_resume_default() {
        let lines = [r#"{"type":"turn_context","payload":{"model":"original-model"}}"#,r#"{"type":"event_msg","payload":{"type":"task_complete"}}"#,r#"{"type":"turn_context","payload":{"model":"wrong-default"}}"#];
        assert_eq!(model_from_lines(lines.into_iter().map(String::from)).as_deref(),Some("original-model"));
    }
    #[test]
    fn session_events_are_validated() {
        assert_eq!(session_event(r#"{"type":"thread.started","thread_id":"abc-123"}"#).as_deref(), Some("abc-123"));
        assert_eq!(session_event(r#"{"type":"system","subtype":"init","session_id":"cursor-123"}"#).as_deref(), Some("cursor-123"));
        assert!(session_event(r#"{"type":"thread.started","thread_id":"../../escape"}"#).is_none());
        assert!(session_event(r#"{"type":"thread.started","thread_id":"--force"}"#).is_none());
        assert!(session_event(r#"{"type":"result","session_id":"not-init"}"#).is_none());
    }
    #[test]
    fn cursor_resume_requires_an_existing_session_store() {
        let config = tempfile::tempdir().unwrap();
        assert!(cursor_store_in(config.path(), "chat123").is_none());
        let dir = config.path().join("chats/workspace-hash/chat123"); std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("store.db"), b"fixture").unwrap();
        assert_eq!(cursor_store_in(config.path(), "chat123"), Some(dir.join("store.db")));
        assert!(cursor_store_in(config.path(), "different-session").is_none());
    }
    #[test]
    fn session_resolution_checks_account_repository_and_rollout() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("repo"); std::fs::create_dir(&repo).unwrap();
        let home = dir.path().join("profile-home"); std::fs::create_dir_all(home.join("sessions/2026/09/21")).unwrap();
        let file = home.join("sessions/2026/09/21/rollout-session123.jsonl");
        std::fs::write(&file, serde_json::json!({"type":"session_meta","payload":{"id":"session123","cwd":repo}}).to_string()).unwrap();
        let profile = Profile {id:"profile123".into(),provider:"codex".into(),label:"Work".into(),executable:"codex".into(),..Profile::default()};
        let record = SessionRecord {session_id:"session123".into(),profile_id:profile.id.clone(),provider:"codex".into(),repository:repo.canonicalize().unwrap(),home:home.clone()};
        save(dir.path(), &record).unwrap();
        let target = ResumeTarget {session_id:record.session_id.clone(),provider:"codex".into(),source:"app".into()};
        let codex = CodexService::new(dir.path().join("unused"));
        assert_eq!(resolve(dir.path(), &profile, &repo, &target, &codex).unwrap(),home);
        let other = dir.path().join("other"); std::fs::create_dir(&other).unwrap();
        assert!(resolve(dir.path(), &profile, &other, &target, &codex).is_err());
        let other_profile = Profile {id:"otherprofile".into(),..profile.clone()};
        assert!(resolve(dir.path(), &other_profile, &repo, &target, &codex).is_err());
        let private_home=dir.path().join("private");
        copy_for_account(&home,&private_home,"session123",&repo).unwrap();
        let private_file=private_home.join("sessions/rollout-session123.jsonl");
        assert_eq!(std::fs::read(&file).unwrap(),std::fs::read(&private_file).unwrap());
        let original=std::fs::read_to_string(&file).unwrap();
        std::fs::write(&private_file,format!("{original}\ncontinued")).unwrap();
        copy_for_account(&home,&private_home,"session123",&repo).unwrap();
        assert!(std::fs::read_to_string(&private_file).unwrap().ends_with("continued"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(),original);
        assert!(copy_for_account(&home,&dir.path().join("wrong"),"session123",&other).is_err());
        std::fs::write(&file,serde_json::json!({"type":"session_meta","payload":{"id":"session123","cwd":repo,"history_mode":"paginated"}}).to_string()).unwrap();
        assert!(resolve(dir.path(), &profile, &repo, &target, &codex).unwrap_err().contains("paginated history"));
        std::fs::remove_file(file).unwrap();
        assert!(resolve(dir.path(), &profile, &repo, &target, &codex).unwrap_err().contains("removed"));
    }
}
