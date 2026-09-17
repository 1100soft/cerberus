//! Compatibility reader for Cursor editor's local history. Never writes its databases.
use crate::codex::{Message, MessagePage, ThreadPage, ThreadSummary};
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
            data.push(ThreadSummary {
                id: format!("editor:{id}"),
                name: value["name"].as_str().map(str::to_owned),
                preview: "Cursor editor conversation".into(),
                cwd: path.to_string_lossy().into_owned(),
                updated_at: updated.or(created).unwrap_or(0) / 1000,
                git_info: None,
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
        let messages = stored_messages(&db, thread.id.strip_prefix("editor:").unwrap())?;
        if messages.is_empty() {
            continue;
        }
        // Unnamed conversations should be identifiable by their actual content.
        thread.preview = messages
            .iter()
            .find(|message| message.role == "user")
            .unwrap_or(&messages[0])
            .text
            .chars()
            .take(160)
            .collect();
        thread.name = thread.name.filter(|name| !name.trim().is_empty());
        data.push(thread);
    }
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
        if let Some(text) = value["text"].as_str().filter(|text| !text.is_empty()) {
            if role == "user" && crate::cursor::is_system_notification(text) {
                continue;
            }
            data.push(Message {
                id: bubble.into(),
                role: role.into(),
                text: text.into(),
            });
        }
    }
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
