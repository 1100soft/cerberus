//! Editable proposals, kept separate from active configuration until reviewed in-app.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
fn write(path: &Path, text: &str) -> Result<(), String> {
    use std::io::Write;
    let mut file =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing configuration directory")?)
            .map_err(|e| e.to_string())?;
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub path: String,
    pub current: Value,
    pub draft: String,
    pub guide: String,
    pub schema: Value,
}
pub fn sync(root: &Path, automations: Value, catalog: Value) -> Result<Workspace, String> {
    if !automations.is_array() {
        return Err("Expected an automation array".into());
    }
    let dir = root.join("automation-config");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let current_path = dir.join("current.json");
    let draft_path = dir.join("workflows.json");
    let old = std::fs::read_to_string(&current_path).ok();
    let previous: Option<Value> = old.as_deref().and_then(|s| serde_json::from_str(s).ok());
    let current = if previous
        .as_ref()
        .is_some_and(|v| v["automations"] == automations)
    {
        previous.unwrap()
    } else {
        json!({"schemaVersion":1,"revision":uuid::Uuid::new_v4().to_string(),"automations":automations})
    };
    let text = serde_json::to_string_pretty(&current).map_err(|e| e.to_string())?;
    // Mirror UI changes only while the proposal is untouched. Preserve external edits.
    let draft = std::fs::read_to_string(&draft_path).ok();
    if draft.is_none() || draft.as_deref() == old.as_deref() {
        write(&draft_path, &text)?;
    }
    if let Some(previous) = std::fs::read_to_string(&current_path)
        .ok()
        .filter(|old| old != &text)
    {
        let backups = root.join("automation-config/backups");
        std::fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
        write(
            &backups.join(format!("{}.json", uuid::Uuid::new_v4())),
            &previous,
        )?;
    }
    write(&current_path, &text)?;
    write(
        &dir.join("catalog.json"),
        &serde_json::to_string_pretty(&catalog).map_err(|e| e.to_string())?,
    )?;
    write(
        &dir.join("README.md"),
        include_str!("../../docs/automation-config.md"),
    )?;
    write(
        &dir.join("schema.json"),
        include_str!("../../docs/automation-config.schema.json"),
    )?;
    write(
        &dir.join("handoffs.md"),
        include_str!("../../docs/handoffs.md"),
    )?;
    // Bound snapshot history to the latest twenty revisions.
    if let Ok(entries) = std::fs::read_dir(dir.join("backups")) {
        let mut entries = entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .collect::<Vec<_>>();
        entries.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
        let excess = entries.len().saturating_sub(20);
        for entry in entries.into_iter().take(excess) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    read(root)
}
pub fn read(root: &Path) -> Result<Workspace, String> {
    let dir = root.join("automation-config");
    let current = serde_json::from_str(
        &std::fs::read_to_string(dir.join("current.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let path = dir.join("workflows.json");
    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024 {
        return Err("Workflow proposals must be at most 8 MiB".into());
    }
    let draft = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(Workspace {
        path: dir.to_string_lossy().into_owned(),
        current,
        draft,
        guide: format!(
            "{}\n\n{}",
            include_str!("../../docs/automation-config.md"),
            include_str!("../../docs/handoffs.md")
        ),
        schema: serde_json::from_str(include_str!("../../docs/automation-config.schema.json"))
            .map_err(|e| e.to_string())?,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_external_edits_and_advances_revision() {
        let dir = tempfile::tempdir().unwrap();
        let a = sync(dir.path(), json!([]), json!({})).unwrap();
        std::fs::write(
            dir.path().join("automation-config/workflows.json"),
            "external edits",
        )
        .unwrap();
        let b = sync(dir.path(), json!([{"id":"new"}]), json!({})).unwrap();
        assert_ne!(a.current["revision"], b.current["revision"]);
        assert_eq!(b.draft, "external edits");
        assert_eq!(b.current["automations"], json!([{"id":"new"}]));
    }
    #[test]
    fn stable_revision_and_bounded_backups() {
        let dir = tempfile::tempdir().unwrap();
        let a = sync(dir.path(), json!([]), json!({})).unwrap();
        let b = sync(dir.path(), json!([]), json!({})).unwrap();
        assert_eq!(a.current["revision"], b.current["revision"]);
        for n in 0..24 {
            sync(dir.path(), json!([{"id":n}]), json!({})).unwrap();
        }
        assert_eq!(
            std::fs::read_dir(dir.path().join("automation-config/backups"))
                .unwrap()
                .count(),
            20
        );
    }
    #[test]
    fn oversized_proposal_is_rejected_without_replacing_it() {
        let dir = tempfile::tempdir().unwrap();
        sync(dir.path(), json!([]), json!({})).unwrap();
        let path = dir.path().join("automation-config/workflows.json");
        std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(8 * 1024 * 1024 + 1)
            .unwrap();
        assert!(read(dir.path()).is_err());
        assert_eq!(std::fs::metadata(path).unwrap().len(), 8 * 1024 * 1024 + 1);
    }
    #[test]
    fn untouched_proposal_tracks_configuration() {
        let dir = tempfile::tempdir().unwrap();
        sync(dir.path(), json!([]), json!({})).unwrap();
        let b = sync(dir.path(), json!([{"id":"new"}]), json!({})).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&b.draft).unwrap(), b.current);
    }
}
