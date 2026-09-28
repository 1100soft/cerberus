//! Read-only VS Code Copilot Chat sessions. The Copilot CLI session store does not contain these chats.
use crate::codex::{Message, MessagePage, ThreadPage, ThreadSummary};
use serde_json::Value;
use std::{fs, io::{BufRead, BufReader}, path::{Path, PathBuf}};

fn editor_roots() -> Vec<PathBuf> {
    if let Some(path) = std::env::var_os("GITCERBERUS_COPILOT_CHAT_DIR") {
        return vec![PathBuf::from(path)];
    }
    let Some(config) = config_home() else { return vec![] };
    ["Code", "Cursor"].into_iter().map(|name| config.join(name).join("User")).filter(|path| path.is_dir()).collect()
}
fn config_home() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    { return std::env::var_os("APPDATA").map(PathBuf::from); }
    #[cfg(target_os = "macos")]
    { return std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support")); }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Some(path) = std::env::var_os("XDG_CONFIG_HOME") { return Some(PathBuf::from(path)); }
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config"))
    }
}
fn workspace_dirs(root: &Path, repository: &Path) -> Vec<PathBuf> {
    let expected = repository.canonicalize().ok();
    fs::read_dir(root.join("workspaceStorage")).into_iter().flatten().filter_map(Result::ok).filter_map(|entry| {
        let value: Value = serde_json::from_slice(&fs::read(entry.path().join("workspace.json")).ok()?).ok()?;
        let folder = url::Url::parse(value["folder"].as_str()?).ok()?.to_file_path().ok()?.canonicalize().ok()?;
        (Some(folder) == expected).then(|| entry.path())
    }).collect()
}
fn session_files(repository: &Path) -> Vec<PathBuf> {
    editor_roots().into_iter().flat_map(|root| workspace_dirs(&root, repository)).flat_map(|dir| {
        fs::read_dir(dir.join("chatSessions")).into_iter().flatten().filter_map(Result::ok).map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl")).collect::<Vec<_>>()
    }).collect()
}
fn set_path(node: &mut Value, path: &[Value], value: Value) {
    if path.is_empty() { *node = value; return; }
    let key = &path[0];
    if path.len() == 1 {
        match key {
            Value::String(name) => {
                if !node.is_object() { *node = serde_json::json!({}); }
                node.as_object_mut().unwrap().insert(name.clone(), value);
            }
            Value::Number(index) => {
                let index = index.as_u64().unwrap_or(0) as usize;
                if !node.is_array() { *node = serde_json::json!([]); }
                let items = node.as_array_mut().unwrap();
                if index >= items.len() { items.resize(index + 1, Value::Null); }
                items[index] = value;
            }
            _ => {}
        }
        return;
    }
    match key {
        Value::String(name) => {
            if !node.is_object() { *node = serde_json::json!({}); }
            let object = node.as_object_mut().unwrap();
            if !object.contains_key(name) { object.insert(name.clone(), Value::Null); }
            set_path(object.get_mut(name).unwrap(), &path[1..], value);
        }
        Value::Number(index) => {
            let index = index.as_u64().unwrap_or(0) as usize;
            if !node.is_array() { *node = serde_json::json!([]); }
            let items = node.as_array_mut().unwrap();
            if index >= items.len() { items.resize(index + 1, Value::Null); }
            set_path(&mut items[index], &path[1..], value);
        }
        _ => {}
    }
}
fn push_path(node: &mut Value, path: &[Value], value: &Value) {
    if path.is_empty() { return; }
    if path.len() == 1 {
        let key = &path[0];
        let target = match key {
            Value::String(name) => {
                if !node.is_object() { *node = serde_json::json!({}); }
                let object = node.as_object_mut().unwrap();
                object.entry(name.clone()).or_insert_with(|| serde_json::json!([]));
                object.get_mut(name).unwrap()
            }
            _ => return,
        };
        if !target.is_array() { *target = serde_json::json!([]); }
        if let Some(items) = value.as_array() { target.as_array_mut().unwrap().extend(items.iter().cloned()); }
        return;
    }
    match &path[0] {
        Value::String(name) => {
            if !node.is_object() { *node = serde_json::json!({}); }
            let object = node.as_object_mut().unwrap();
            if !object.contains_key(name) { object.insert(name.clone(), Value::Null); }
            push_path(object.get_mut(name).unwrap(), &path[1..], value);
        }
        _ => {}
    }
}
fn replay(file: &Path) -> Option<Value> {
    let reader = fs::File::open(file).ok().map(BufReader::new)?;
    let mut state = Value::Null;
    for line in reader.lines().map_while(Result::ok) {
        let Ok(entry) = serde_json::from_str::<Value>(&line) else { continue };
        match entry["kind"].as_i64() {
            Some(0) => state = entry["v"].clone(),
            Some(1) => set_path(&mut state, entry["k"].as_array().map(Vec::as_slice).unwrap_or(&[]), entry["v"].clone()),
            Some(2) => push_path(&mut state, entry["k"].as_array().map(Vec::as_slice).unwrap_or(&[]), &entry["v"]),
            Some(3) => set_path(&mut state, entry["k"].as_array().map(Vec::as_slice).unwrap_or(&[]), Value::Null),
            _ => {}
        }
    }
    state.is_object().then_some(state)
}
fn assistant_text(response: &Value) -> String {
    response.as_array().into_iter().flatten().filter_map(|part| {
        if part["kind"].as_str().is_some() { return None; }
        part["value"].as_str().map(str::trim).filter(|text| !text.is_empty()).map(str::to_owned)
    }).collect::<Vec<_>>().join("\n\n")
}
fn messages_from(state: &Value) -> (Vec<Message>, i64) {
    let mut data = Vec::new();
    let mut updated = state["creationDate"].as_i64().unwrap_or(0);
    for request in state["requests"].as_array().into_iter().flatten() {
        updated = updated.max(request["timestamp"].as_i64().unwrap_or(0)).max(request["responseTimestamp"].as_i64().unwrap_or(0));
        let id = request["requestId"].as_str().unwrap_or("request");
        if let Some(text) = request["message"]["text"].as_str().map(str::trim).filter(|text| !text.is_empty()) {
            data.push(Message { id: format!("{id}:user"), role: "user".into(), text: text.into(), edits: vec![] });
        }
        let text = assistant_text(&request["response"]);
        if !text.is_empty() {
            data.push(Message { id: format!("{id}:assistant"), role: "assistant".into(), text, edits: vec![] });
        }
    }
    (data, if updated > 10_000_000_000 { updated / 1000 } else { updated })
}
fn session_id(file: &Path) -> Option<&str> {
    let id = file.file_stem()?.to_str()?;
    (id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).then_some(id)
}
pub fn threads(repository: &Path, archived: bool) -> Result<ThreadPage, String> {
    if archived { return Ok(ThreadPage { data: vec![], next_cursor: None }); }
    let mut data = Vec::new();
    for file in session_files(repository) {
        let Some(id) = session_id(&file) else { continue };
        let Some(state) = replay(&file) else { continue };
        let (messages, updated_at) = messages_from(&state);
        if messages.is_empty() { continue; }
        let preview = messages.iter().find(|message| message.role == "user").unwrap_or(&messages[0]).text.chars().take(160).collect();
        let name = state["customTitle"].as_str().map(str::trim).filter(|name| !name.is_empty()).map(str::to_owned);
        data.push(ThreadSummary {
            id: id.into(), name, preview, cwd: repository.to_string_lossy().into_owned(), updated_at, git_info: None, working: false,
        });
    }
    data.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.id.cmp(&b.id)));
    Ok(ThreadPage { data, next_cursor: None })
}
pub fn messages(repository: &Path, id: &str) -> Result<MessagePage, String> {
    if session_id(Path::new(id)).is_none() { return Err("Invalid Copilot session ID".into()); }
    let file = session_files(repository).into_iter().find(|file| session_id(file) == Some(id)).ok_or("Copilot chat not found in this directory")?;
    let state = replay(&file).ok_or("Copilot chat could not be read")?;
    let (data, _) = messages_from(&state);
    Ok(MessagePage { data, next_cursor: None })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replays_vscode_chat_sessions_for_the_workspace() {
        let root = tempfile::tempdir().unwrap();
        let repo = tempfile::tempdir().unwrap();
        let dir = root.path().join("workspaceStorage/ws/chatSessions");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(root.path().join("workspaceStorage/ws/workspace.json"), serde_json::json!({"folder": url::Url::from_directory_path(repo.path()).unwrap()}).to_string()).unwrap();
        let lines = [
            serde_json::json!({"kind":0,"v":{"version":3,"creationDate":1000,"customTitle":"Review","sessionId":"session-1","requests":[]}}),
            serde_json::json!({"kind":2,"k":["requests"],"v":[{"requestId":"r1","timestamp":1700000005000i64,"message":{"text":"Hello"},"response":[{"kind":"thinking","value":"hidden"},{"value":"Done"}]}]}),
        ];
        std::fs::write(dir.join("session-1.jsonl"), lines.iter().map(|line| line.to_string()).collect::<Vec<_>>().join("\n")).unwrap();
        let previous = std::env::var_os("GITCERBERUS_COPILOT_CHAT_DIR");
        std::env::set_var("GITCERBERUS_COPILOT_CHAT_DIR", root.path());
        let page = threads(repo.path(), false).unwrap();
        let messages = messages(repo.path(), "session-1").unwrap();
        match previous { Some(value) => std::env::set_var("GITCERBERUS_COPILOT_CHAT_DIR", value), None => std::env::remove_var("GITCERBERUS_COPILOT_CHAT_DIR") }
        assert_eq!(page.data.len(), 1);
        assert_eq!(page.data[0].name.as_deref(), Some("Review"));
        assert_eq!(page.data[0].updated_at, 1_700_000_005);
        assert_eq!(messages.data.iter().map(|message| (message.role.as_str(), message.text.as_str())).collect::<Vec<_>>(), vec![("user", "Hello"), ("assistant", "Done")]);
    }
}
