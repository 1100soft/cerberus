//! Durable per-conversation storage, independent of the WebView quota.
use rusqlite::{params, Connection};
use serde_json::Value;
use std::{path::Path, sync::Mutex};
pub struct ConversationStore(Mutex<Connection>);
impl ConversationStore {
    pub fn open(root: &Path) -> Result<Self, String> {
        let connection =
            Connection::open(root.join("agent-conversations.db")).map_err(|e| e.to_string())?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, updated INTEGER NOT NULL, payload TEXT NOT NULL);").map_err(|e|e.to_string())?;
        Ok(Self(Mutex::new(connection)))
    }
    pub fn save(&self, chat: Value) -> Result<(), String> {
        let id = chat["id"].as_str().ok_or("Missing conversation ID")?;
        if id.is_empty()
            || id.len() > 128
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("Invalid conversation ID".into());
        }
        if !chat["messages"].is_array()
            || !chat["repositoryId"].is_string()
            || !chat["profile"].is_object()
        {
            return Err("Invalid conversation record".into());
        }
        let updated = chat["updatedAt"]
            .as_i64()
            .ok_or("Missing conversation timestamp")?;
        let payload = serde_json::to_string(&chat).map_err(|e| e.to_string())?;
        if payload.len() > 16_000_000 {
            return Err("Conversation exceeds the 16 MB record limit".into());
        }
        self.0.lock().map_err(|e|e.to_string())?.execute("INSERT INTO conversations VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET updated=excluded.updated,payload=excluded.payload WHERE excluded.updated >= conversations.updated",params![id,updated,payload]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn list(&self) -> Result<Vec<Value>, String> {
        let connection = self.0.lock().map_err(|e| e.to_string())?;
        let mut query = connection
            .prepare("SELECT payload FROM conversations ORDER BY updated DESC")
            .map_err(|e| e.to_string())?;
        let rows = query
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|row| {
            serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        })
        .collect()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_completed_records_survive_reopen_and_late_stream_updates() {
        let root = tempfile::tempdir().unwrap();
        let store = ConversationStore::open(root.path()).unwrap();
        let chat = serde_json::json!({"id":"chat","repositoryId":"repo","profile":{},"messages":[],"updatedAt":20,"status":"Completed","activity":"a".repeat(6_000_000)});
        store.save(chat.clone()).unwrap();
        let mut stale = chat.clone();
        stale["updatedAt"] = 10.into();
        stale["status"] = "Working".into();
        store.save(stale).unwrap();
        drop(store);
        assert_eq!(
            ConversationStore::open(root.path())
                .unwrap()
                .list()
                .unwrap(),
            vec![chat]
        );
    }
}
