//! Filter the runtime catalog using explicit account or runtime rejections.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
#[derive(Serialize, Deserialize)]
struct Denial {
    model: String,
    at: u64,
    #[serde(default)]
    runtime: String,
    #[serde(default)]
    account_restriction: bool,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn runtime_key(executable: &Path) -> String {
    let path = executable
        .canonicalize()
        .unwrap_or_else(|_| executable.into());
    let metadata = std::fs::metadata(&path).ok();
    let modified = metadata
        .as_ref()
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    format!(
        "{}:{}:{modified}",
        path.display(),
        metadata.map(|value| value.len()).unwrap_or_default()
    )
}
fn records(home: &Path) -> Vec<Denial> {
    std::fs::read(home.join("rejected-models.json"))
        .ok()
        .and_then(|data| serde_json::from_slice(&data).ok())
        .unwrap_or_default()
}
pub fn denied(home: &Path, runtime: &str) -> Vec<String> {
    records(home)
        .into_iter()
        .filter(|item| {
            (item.account_restriction || item.runtime == runtime)
                && now().saturating_sub(item.at) < 86400
        })
        .map(|item| item.model)
        .collect()
}
pub fn selectable(models: &[Value], denied: &[String]) -> Vec<Value> {
    models
        .iter()
        .filter(|item| item["hidden"] != true)
        .filter(|item| {
            item["model"]
                .as_str()
                .is_some_and(|model| !denied.iter().any(|value| value == model))
        })
        .cloned()
        .collect()
}
fn is_rejection(model: &str, error: &str) -> bool {
    let lower = error.to_lowercase();
    error.contains(model)
        && (lower.contains("not supported")
            || lower.contains("unsupported model")
            || lower.contains("do not have access to model"))
}
pub fn validate(home: &Path, model: &str, runtime: &str) -> Result<(), String> {
    if denied(home, runtime).iter().any(|value| value == model) {
        Err(format!("Model {model} was rejected for this Codex configuration. Choose another listed model or Provider default. The automation remains enabled."))
    } else {
        Ok(())
    }
}
pub fn remember_rejection(
    home: &Path,
    model: &str,
    error: &str,
    runtime: &str,
) -> Result<(), String> {
    if !is_rejection(model, error) {
        return Ok(());
    }
    static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = WRITE_LOCK.lock().map_err(|error| error.to_string())?;
    let mut entries = records(home)
        .into_iter()
        .filter(|entry| {
            now().saturating_sub(entry.at) < 86400
                && !(entry.model == model && entry.runtime == runtime)
        })
        .collect::<Vec<_>>();
    let account_restriction = error.to_lowercase().contains("chatgpt account");
    entries.push(Denial {
        model: model.into(),
        at: now(),
        runtime: runtime.into(),
        account_restriction,
    });
    let pending = home.join("rejected-models.pending");
    std::fs::write(
        &pending,
        serde_json::to_vec(&entries).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    std::fs::rename(pending, home.join("rejected-models.json")).map_err(|error| error.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_controls_choices_without_hardcoded_models_or_history() {
        let catalog = vec![
            serde_json::json!({"model":"gpt-6.1-sol"}),
            serde_json::json!({"model":"gpt-6-luna"}),
            serde_json::json!({"model":"future-model"}),
            serde_json::json!({"model":"hidden","hidden":true}),
        ];
        assert_eq!(selectable(&catalog, &[]).len(), 3);
        assert_eq!(selectable(&catalog, &["gpt-6-luna".into()]).len(), 2);
        assert!(selectable(&[], &[]).is_empty());
    }
    #[test]
    fn chatgpt_restriction_survives_runtime_upgrade_without_hiding_sol() {
        let account = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let error = r#"{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account."}}"#;
        remember_rejection(account.path(), "gpt-6-luna", error, "old").unwrap();
        assert!(validate(account.path(), "gpt-6-luna", "new").is_err());
        assert!(validate(other.path(), "gpt-6-luna", "new").is_ok());
        let catalog = vec![
            serde_json::json!({"model":"gpt-6-luna"}),
            serde_json::json!({"model":"gpt-6.1-sol"}),
        ];
        assert_eq!(
            selectable(&catalog, &denied(account.path(), "new")),
            vec![catalog[1].clone()]
        );
        let mut entries = records(account.path());
        entries[0].at = now().saturating_sub(86401);
        std::fs::write(
            account.path().join("rejected-models.json"),
            serde_json::to_vec(&entries).unwrap(),
        )
        .unwrap();
        assert!(validate(account.path(), "gpt-6-luna", "new").is_ok());
    }
    #[test]
    fn rejections_are_account_and_runtime_scoped() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        remember_rejection(first.path(), "model", "network unavailable", "old").unwrap();
        assert!(denied(first.path(), "old").is_empty());
        remember_rejection(first.path(), "model", "unsupported model: model", "old").unwrap();
        assert!(validate(first.path(), "model", "old").is_err());
        assert!(validate(first.path(), "model", "new").is_ok());
        assert!(validate(second.path(), "model", "old").is_ok());
    }
}
