//! Read-only Claude Code transcript reader. Claude stores one JSONL transcript per local session.
use crate::codex::{Message, MessagePage, ThreadPage, ThreadSummary};
use serde_json::Value;
use std::{fs, io::{BufRead, BufReader}, path::{Path, PathBuf}};

fn root() -> Option<PathBuf> {
    std::env::var_os("GITCERBERUS_CLAUDE_PROJECTS_DIR").map(PathBuf::from)
        .or_else(|| std::env::var_os("CLAUDE_CONFIG_DIR").map(|p| PathBuf::from(p).join("projects")))
        .or_else(|| std::env::var_os("HOME").or_else(||std::env::var_os("USERPROFILE")).map(|p| PathBuf::from(p).join(".claude/projects")))
}
fn same_directory(a: &str, b: &Path) -> bool {
    let a=Path::new(a);
    a==b || a.canonicalize().ok().is_some_and(|path| Some(path)==b.canonicalize().ok())
}
fn content(value: &Value) -> String {
    if let Some(text)=value.as_str(){return text.to_owned()}
    value.as_array().into_iter().flatten()
        .filter(|block| block["type"]=="text")
        .filter_map(|block| block["text"].as_str())
        .collect::<Vec<_>>().join("\n")
}
fn transcript(file: &Path, cwd: &Path) -> Vec<Message> {
    let Ok(reader)=fs::File::open(file).map(BufReader::new) else {return vec![]};
    reader.lines().map_while(Result::ok).filter_map(|line|serde_json::from_str::<Value>(&line).ok()).enumerate()
        .filter_map(|(index,event)| {
            let role=event["type"].as_str()?;
            if !matches!(role,"user"|"assistant") || !same_directory(event["cwd"].as_str()?,cwd) {return None}
            let text=content(&event["message"]["content"]);
            if text.trim().is_empty(){return None}
            Some(Message{id:event["uuid"].as_str().map(str::to_owned).unwrap_or_else(||format!("{index}")),role:role.into(),text,edits:vec![]})
        }).collect()
}
fn files() -> Vec<PathBuf> {
    let Some(root)=root() else {return vec![]};
    fs::read_dir(root).into_iter().flatten().filter_map(Result::ok)
        .filter(|entry|entry.path().is_dir())
        .flat_map(|entry|fs::read_dir(entry.path()).into_iter().flatten().filter_map(Result::ok))
        .map(|entry|entry.path()).filter(|path|path.extension().is_some_and(|ext|ext=="jsonl"))
        .collect()
}
pub fn threads(cwd:&Path, archived:bool)->Result<ThreadPage,String>{
    if archived{return Ok(ThreadPage{data:vec![],next_cursor:None})}
    let mut data=Vec::new();
    for file in files(){
        let messages=transcript(&file,cwd);if messages.is_empty(){continue}
        let Some(id)=file.file_stem().and_then(|name|name.to_str()) else{continue};
        let preview=messages.iter().find(|message|message.role=="user").map(|message|message.text.chars().take(180).collect()).unwrap_or_default();
        let updated_at=file.metadata().and_then(|meta|meta.modified()).ok().and_then(|time|time.duration_since(std::time::UNIX_EPOCH).ok()).map(|time|time.as_secs() as i64).unwrap_or(0);
        data.push(ThreadSummary{id:id.into(),name:None,preview,cwd:cwd.to_string_lossy().into_owned(),updated_at,git_info:None,working:false});
    }
    data.sort_by(|a,b|b.updated_at.cmp(&a.updated_at));
    Ok(ThreadPage{data,next_cursor:None})
}
pub fn messages(cwd:&Path,id:&str)->Result<MessagePage,String>{
    if id.contains('/') || id.contains('\\') || id.contains("..") {return Err("Invalid Claude session ID".into())}
    let file=files().into_iter().find(|file|file.file_stem().is_some_and(|name|name==id) && !transcript(file,cwd).is_empty()).ok_or("Claude session not found in this directory")?;
    Ok(MessagePage{data:transcript(&file,cwd),next_cursor:None})
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn reads_only_text_blocks(){assert_eq!(content(&serde_json::json!([{"type":"text","text":"hello"},{"type":"tool_use","name":"Bash"}])),"hello")}
    #[test] fn transcript_scopes_messages_to_repository(){
        let dir=tempfile::tempdir().unwrap();
        let repo=dir.path().join("repo");std::fs::create_dir(&repo).unwrap();
        let other=dir.path().join("other");std::fs::create_dir(&other).unwrap();
        let file=dir.path().join("session.jsonl");
        let events=[
            serde_json::json!({"type":"user","cwd":repo,"uuid":"u1","message":{"content":"Build it"}}),
            serde_json::json!({"type":"assistant","cwd":repo,"uuid":"a1","message":{"content":[{"type":"text","text":"Done"},{"type":"tool_use","name":"Bash"}]}}),
            serde_json::json!({"type":"user","cwd":other,"uuid":"u2","message":{"content":"Private"}}),
        ];
        std::fs::write(&file,events.iter().map(|event|event.to_string()).collect::<Vec<_>>().join("\n")).unwrap();
        let messages=transcript(&file,&repo);
        assert_eq!(messages.iter().map(|message|message.text.as_str()).collect::<Vec<_>>(),vec!["Build it","Done"]);
    }
}
