//! Compatibility reader for Cursor editor's local history. Never writes its databases.
use crate::codex::{FileEdit, Message, MessagePage, ThreadPage, ThreadSummary};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::Value;
use std::path::{Path, PathBuf};
fn user_dir() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("GITCERBERUS_CURSOR_USER_DIR") {
        return Some(path.into());
    }
    #[cfg(target_os = "windows")]
    let root = PathBuf::from(std::env::var_os("APPDATA")?);
    #[cfg(target_os = "macos")]
    let root = PathBuf::from(std::env::var_os("HOME")?).join("Library/Application Support");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let root = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or(PathBuf::from(std::env::var_os("HOME")?).join(".config"));
    Some(root.join("Cursor/User"))
}
fn open(root: &Path) -> Result<Connection, String> {
    let db = Connection::open_with_flags(
        root.join("globalStorage/state.vscdb"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("Cursor editor history: {e}"))?;
    db.busy_timeout(std::time::Duration::from_secs(2))
        .map_err(|e| e.to_string())?;
    Ok(db)
}
fn workspace_ids(root: &Path, path: &Path) -> Vec<String> {
    let expected = path.canonicalize().ok();
    std::fs::read_dir(root.join("workspaceStorage"))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let value: Value =
                serde_json::from_slice(&std::fs::read(entry.path().join("workspace.json")).ok()?)
                    .ok()?;
            let folder = url::Url::parse(value["folder"].as_str()?)
                .ok()?
                .to_file_path()
                .ok()?
                .canonicalize()
                .ok()?;
            (Some(folder) == expected).then(|| entry.file_name().to_string_lossy().into_owned())
        })
        .collect()
}
fn headers(root: &Path, path: &Path, archived: bool) -> Result<Vec<ThreadSummary>, String> {
    let db = open(root)?;
    let ids = workspace_ids(root, path);
    let mut stmt=db.prepare("SELECT composerId,value,lastUpdatedAt,createdAt FROM composerHeaders WHERE workspaceId=?1 AND coalesce(isArchived,0)=?2 AND coalesce(isSubagent,0)=0 ORDER BY lastUpdatedAt DESC").map_err(|e|format!("Unsupported Cursor editor history schema: {e}"))?;
    let mut data = Vec::new();
    for workspace in ids {
        let rows = stmt
            .query_map(rusqlite::params![workspace, archived], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, raw, updated, created) = row.map_err(|e| e.to_string())?;
            let value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            if value["isDraft"] == true || value["isEphemeral"] == true {
                continue;
            }
            let (working, composer_clock) = composer_activity(&db, &id);
            let checkpoint = value["conversationCheckpointLastUpdatedAt"].as_i64().unwrap_or(0);
            data.push(ThreadSummary {
                id: format!("editor:{id}"),
                name: value["name"].as_str().map(str::to_owned),
                preview: "Cursor editor conversation".into(),
                cwd: path.to_string_lossy().into_owned(),
                updated_at: checkpoint.max(composer_clock).max(updated.or(created).unwrap_or(0)) / 1000,
                git_info: None,
                working,
            });
        }
    }
    Ok(data)
}
pub fn threads(path: &Path, archived: bool) -> Result<ThreadPage, String> {
    let root = user_dir().ok_or("Cursor editor user directory not found")?;
    threads_at(&root, path, archived)
}
fn threads_at(root: &Path, path: &Path, archived: bool) -> Result<ThreadPage, String> {
    let db = open(root)?;
    let mut data = Vec::new();
    for mut thread in headers(root, path, archived)? {
        let id = thread.id.strip_prefix("editor:").unwrap();
        // Listing must not read every bubble. One open conversation can hold hundreds.
        let Some(preview) = first_user_text(&db, id) else { continue };
        thread.preview = preview.chars().take(160).collect();
        thread.name = thread.name.filter(|name| !name.trim().is_empty());
        data.push(thread);
    }
    data.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.id.cmp(&b.id)));
    Ok(ThreadPage {
        data,
        next_cursor: None,
    })
}
pub fn messages(path: &Path, id: &str) -> Result<MessagePage, String> {
    messages_at(
        &user_dir().ok_or("Cursor editor user directory not found")?,
        path,
        id,
    )
}
fn messages_at(root: &Path, path: &Path, id: &str) -> Result<MessagePage, String> {
    let allowed = headers(root, path, false)?
        .into_iter()
        .chain(headers(root, path, true)?)
        .any(|t| t.id == format!("editor:{id}"));
    if !allowed {
        return Err("Cursor editor conversation belongs to another directory".into());
    }
    let db = open(root)?;
    let data = stored_messages(&db, id)?;
    Ok(MessagePage {
        data,
        next_cursor: None,
    })
}
fn flush_edits(data: &mut Vec<Message>, start: usize, edits: &mut Vec<FileEdit>) {
    if edits.is_empty() { return; }
    let edits = std::mem::take(edits);
    if let Some(message) = data[start..].iter_mut().rev().find(|message| message.role == "assistant") { message.edits = edits; }
    else { data.push(Message {id:format!("edits-{start}"),role:"assistant".into(),text:String::new(),edits}); }
}
fn bubble_edit(value: &Value) -> Option<FileEdit> {
    let tool = &value["toolFormerData"];
    if tool["name"] != "edit_file_v2" || tool["status"] != "completed" { return None; }
    let decode = |value: &Value| -> Value { value.as_str().and_then(|text| serde_json::from_str(text).ok()).unwrap_or_else(|| value.clone()) };
    let params = decode(&tool["params"]); let result = decode(&tool["result"]);
    result["afterContentId"].as_str()?;
    Some(FileEdit {path:params["relativeWorkspacePath"].as_str()?.into(),kind:if result["beforeContentId"].is_string() {"update"} else {"add"}.into(),diff:None})
}
fn composer_activity(db: &Connection, id: &str) -> (bool, i64) {
    let row: Option<(Option<String>, Option<i64>, Option<i64>, Option<i64>)> = db
        .query_row(
            "SELECT json_extract(value,'$.status'), json_extract(value,'$.conversationCheckpointLastUpdatedAt'), json_extract(value,'$.unfinishedRunAt'), json_array_length(json_extract(value,'$.generatingBubbleIds')) FROM cursorDiskKV WHERE key=?1",
            [format!("composerData:{id}")],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .ok()
        .flatten();
    let Some((status, clock, unfinished, generating)) = row else { return (false, 0) };
    let clock = clock.unwrap_or(0);
    let status = status.unwrap_or_default();
    if generating.unwrap_or(0) > 0 || matches!(status.to_ascii_lowercase().as_str(), "generating" | "running" | "in_progress") {
        return (true, clock);
    }
    // Cursor often leaves status as "aborted" while it is still writing bubbles.
    // A fresh checkpoint on an unfinished run is the stored sign that work continues.
    if status.eq_ignore_ascii_case("completed") {
        return (false, clock);
    }
    let unfinished = unfinished.unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    let working = unfinished > 0 && clock > 0 && now.saturating_sub(clock) < 180_000;
    (working, clock)
}
fn first_user_text(db: &Connection, id: &str) -> Option<String> {
    for index in 0..8 {
        let bubble_id: Option<String> = db
            .query_row(
                &format!("SELECT json_extract(value,'$.fullConversationHeadersOnly[{index}].bubbleId') FROM cursorDiskKV WHERE key=?1"),
                [format!("composerData:{id}")],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
            .flatten();
        let Some(bubble_id) = bubble_id else { break };
        if !bubble_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            continue;
        }
        let kind: Option<i64> = db
            .query_row(
                &format!("SELECT json_extract(value,'$.fullConversationHeadersOnly[{index}].type') FROM cursorDiskKV WHERE key=?1"),
                [format!("composerData:{id}")],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
            .flatten();
        if kind.is_some_and(|kind| kind != 1) {
            continue;
        }
        let text: Option<String> = db
            .query_row(
                "SELECT json_extract(value,'$.text') FROM cursorDiskKV WHERE key=?1",
                [format!("bubbleId:{id}:{bubble_id}")],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
            .flatten()
            .filter(|text: &String| !text.is_empty());
        if let Some(text) = text.filter(|text| !crate::cursor::is_system_notification(text)) {
            return Some(text);
        }
        let mapped: Option<String> = db
            .query_row(
                "SELECT json_extract(value, ?2) FROM cursorDiskKV WHERE key=?1",
                (format!("composerData:{id}"), format!("$.conversationMap.\"{bubble_id}\".text")),
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
            .flatten()
            .filter(|text: &String| !text.is_empty());
        if mapped.is_some() {
            return mapped;
        }
    }
    let length: i64 = db
        .query_row("SELECT length(value) FROM cursorDiskKV WHERE key=?1", [format!("composerData:{id}")], |row| row.get(0))
        .optional()
        .ok()
        .flatten()
        .unwrap_or(0);
    // Large composers stay indexed above. Small inline transcripts are the compatibility shapes.
    if length == 0 || length > 300_000 {
        return None;
    }
    stored_messages(db, id).ok()?.into_iter().find(|message| message.role == "user" && !message.text.is_empty() && !crate::cursor::is_system_notification(&message.text)).map(|message| message.text)
}
fn stored_messages(db: &Connection, id: &str) -> Result<Vec<Message>, String> {
    let raw: Option<String> = db
        .query_row(
            "SELECT value FROM cursorDiskKV WHERE key=?1",
            [format!("composerData:{id}")],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let composer: Value = raw
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or(Value::Null);
    let mut conversation = composer["fullConversationHeadersOnly"]
        .as_array()
        .filter(|items| !items.is_empty())
        .cloned()
        .or_else(|| composer["conversation"].as_array().cloned())
        .unwrap_or_default();
    if conversation.is_empty() {
        // Older editor versions can store bubbles inline without a separate index.
        if let Some(map) = composer["conversationMap"].as_object() {
            for (id, value) in map {
                let mut value = value.clone();
                if let Some(object) = value.as_object_mut() {
                    object.insert("bubbleId".into(), Value::String(id.clone()));
                    conversation.push(value);
                }
            }
            conversation.sort_by(|a, b| a["createdAt"].as_str().cmp(&b["createdAt"].as_str()));
        }
    }
    let mut data = Vec::new();
    let mut edits = Vec::new();
    let mut turn_start = 0;
    for header in &conversation {
        let Some(bubble) = header["bubbleId"].as_str() else {
            continue;
        };
        let raw: Option<String> = db
            .query_row(
                "SELECT value FROM cursorDiskKV WHERE key=?1",
                [format!("bubbleId:{id}:{bubble}")],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let value = match raw {
            Some(raw) => serde_json::from_str::<Value>(&raw).map_err(|e| e.to_string())?,
            None => composer["conversationMap"]
                .get(bubble)
                .unwrap_or(header)
                .clone(),
        };
        let role = match value["type"].as_i64().or(header["type"].as_i64()) {
            Some(1) => "user",
            Some(2) => "assistant",
            _ => continue,
        };
        if role == "user" && !crate::cursor::is_system_notification(value["text"].as_str().unwrap_or("")) {
            flush_edits(&mut data, turn_start, &mut edits); turn_start = data.len();
        }
        if role == "assistant" { if let Some(edit) = bubble_edit(&value) { if !edits.iter().any(|prior: &FileEdit| prior.path == edit.path) { edits.push(edit); } } }
        if let Some(text) = value["text"].as_str().filter(|text| !text.is_empty()) {
            if role == "user" && crate::cursor::is_system_notification(text) {
                continue;
            }
            data.push(Message {
                id: bubble.into(),
                role: role.into(),
                text: text.into(), edits:Vec::new(),
            });
        }
    }
    flush_edits(&mut data, turn_start, &mut edits);
    Ok(data)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "reads local Cursor editor history for GITCERBERUS_TEST_REPOSITORY"]
    fn live_editor_history() {
        let path = PathBuf::from(std::env::var_os("GITCERBERUS_TEST_REPOSITORY").unwrap());
        let page = threads(&path, false).unwrap();
        assert!(!page.data.is_empty(), "Expected existing editor history");
        let mut count = 0;
        for thread in &page.data {
            count += messages(&path, thread.id.strip_prefix("editor:").unwrap())
                .unwrap()
                .data
                .len();
        }
        assert!(count > 0, "Expected stored messages");
        println!(
            "Read {} editor conversations and {} messages",
            page.data.len(),
            count
        );
    }
    #[test]
    fn editor_edits_require_a_completed_write_and_belong_to_turn() {
        let value = serde_json::json!({"toolFormerData":{"name":"edit_file_v2","status":"completed","params":"{\"relativeWorkspacePath\":\"src/a.ts\"}","result":{"beforeContentId":"old","afterContentId":"new"}}});
        let edit = bubble_edit(&value).unwrap(); assert_eq!(edit.path,"src/a.ts"); assert_eq!(edit.kind,"update");
        let mut failed = value; failed["toolFormerData"]["status"] = "error".into(); assert!(bubble_edit(&failed).is_none());
        let mut data = vec![Message {id:"final".into(),role:"assistant".into(),text:"Done".into(),edits:vec![]}];
        flush_edits(&mut data,0,&mut vec![edit]); assert_eq!(data[0].edits.len(),1);
    }
    #[test]
    fn editor_messages_are_repository_scoped() {
        let root = tempfile::tempdir().unwrap();
        let repo = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("globalStorage")).unwrap();
        std::fs::create_dir_all(root.path().join("workspaceStorage/ws")).unwrap();
        std::fs::write(
            root.path().join("workspaceStorage/ws/workspace.json"),
            serde_json::json!({"folder":url::Url::from_directory_path(repo.path()).unwrap()})
                .to_string(),
        )
        .unwrap();
        let db = Connection::open(root.path().join("globalStorage/state.vscdb")).unwrap();
        db.execute_batch("CREATE TABLE composerHeaders(composerId TEXT,value TEXT,lastUpdatedAt INTEGER,createdAt INTEGER,workspaceId TEXT,isArchived INTEGER,isSubagent INTEGER);CREATE TABLE cursorDiskKV(key TEXT,value TEXT);INSERT INTO composerHeaders VALUES('one','{}',1000,1000,'ws',0,0);INSERT INTO cursorDiskKV VALUES('composerData:one','{\"fullConversationHeadersOnly\":[{\"bubbleId\":\"a\",\"type\":1},{\"bubbleId\":\"b\",\"type\":2}]}');INSERT INTO cursorDiskKV VALUES('bubbleId:one:a','{\"type\":1,\"text\":\"prompt\"}');INSERT INTO cursorDiskKV VALUES('bubbleId:one:b','{\"type\":2,\"text\":\"answer\"}');").unwrap();
        assert_eq!(
            messages_at(root.path(), repo.path(), "one")
                .unwrap()
                .data
                .len(),
            2
        );
        assert!(messages_at(root.path(), other.path(), "one").is_err());
        db.execute("UPDATE cursorDiskKV SET value=?1 WHERE key='bubbleId:one:a'", [serde_json::json!({"type":1,"text":"<system_notification><task>done</task></system_notification>"}).to_string()]).unwrap();
        assert_eq!(
            messages_at(root.path(), repo.path(), "one")
                .unwrap()
                .data
                .len(),
            1
        );
        db.execute("DELETE FROM cursorDiskKV WHERE key='bubbleId:one:b'", [])
            .unwrap();
        assert!(threads_at(root.path(), repo.path(), false)
            .unwrap()
            .data
            .is_empty());
        db.execute("DELETE FROM cursorDiskKV", []).unwrap();
        assert!(messages_at(root.path(), repo.path(), "one")
            .unwrap()
            .data
            .is_empty());
        assert!(threads_at(root.path(), repo.path(), false)
            .unwrap()
            .data
            .is_empty());
        db.execute(
            "UPDATE composerHeaders SET value=?1, lastUpdatedAt=1000 WHERE composerId='one'",
            [serde_json::json!({"conversationCheckpointLastUpdatedAt":5000}).to_string()],
        ).unwrap();
        db.execute(
            "INSERT INTO cursorDiskKV VALUES('composerData:one',?1)",
            [serde_json::json!({"status":"generating","generatingBubbleIds":["b"],"fullConversationHeadersOnly":[{"bubbleId":"a","type":1}],"conversationMap":{"a":{"type":1,"text":"still working"}}}).to_string()],
        ).unwrap();
        let working = threads_at(root.path(), repo.path(), false).unwrap();
        assert_eq!(working.data.len(), 1);
        assert!(working.data[0].working);
        assert_eq!(working.data[0].updated_at, 5);
        db.execute(
            "UPDATE cursorDiskKV SET value=?1 WHERE key='composerData:one'",
            [serde_json::json!({"status":"completed","generatingBubbleIds":[],"fullConversationHeadersOnly":[{"bubbleId":"a","type":1}],"conversationMap":{"a":{"type":1,"text":"finished"}}}).to_string()],
        ).unwrap();
        assert!(!threads_at(root.path(), repo.path(), false).unwrap().data[0].working);
        let fresh = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
        db.execute(
            "UPDATE cursorDiskKV SET value=?1 WHERE key='composerData:one'",
            [serde_json::json!({"status":"aborted","unfinishedRunAt":fresh,"conversationCheckpointLastUpdatedAt":fresh,"fullConversationHeadersOnly":[{"bubbleId":"a","type":1}],"conversationMap":{"a":{"type":1,"text":"still writing"}}}).to_string()],
        ).unwrap();
        assert!(threads_at(root.path(), repo.path(), false).unwrap().data[0].working);
        db.execute(
            "UPDATE cursorDiskKV SET value=?1 WHERE key='composerData:one'",
            [serde_json::json!({"status":"aborted","unfinishedRunAt":1,"conversationCheckpointLastUpdatedAt":1,"fullConversationHeadersOnly":[{"bubbleId":"a","type":1}],"conversationMap":{"a":{"type":1,"text":"quiet"}}}).to_string()],
        ).unwrap();
        assert!(!threads_at(root.path(), repo.path(), false).unwrap().data[0].working);
        db.execute("DELETE FROM cursorDiskKV", []).unwrap();
        db.execute("UPDATE composerHeaders SET value='{}', lastUpdatedAt=1000 WHERE composerId='one'", []).unwrap();
        for composer in [
            serde_json::json!({"conversation":[{"bubbleId":"a","type":1,"text":"inline prompt"}]}),
            serde_json::json!({"conversationMap":{"a":{"type":1,"text":"inline prompt"}}}),
            serde_json::json!({"fullConversationHeadersOnly":[{"bubbleId":"a","type":1}],"conversationMap":{"a":{"type":1,"text":"inline prompt"}}}),
        ] {
            db.execute(
                "INSERT INTO cursorDiskKV VALUES('composerData:one',?1)",
                [composer.to_string()],
            )
            .unwrap();
            let page = messages_at(root.path(), repo.path(), "one").unwrap();
            assert_eq!(page.data.len(), 1);
            assert_eq!(page.data[0].text, "inline prompt");
            let listed = threads_at(root.path(), repo.path(), false).unwrap();
            assert_eq!(listed.data.len(), 1);
            assert_eq!(listed.data[0].preview, "inline prompt");
            db.execute("DELETE FROM cursorDiskKV", []).unwrap();
        }
    }
}
