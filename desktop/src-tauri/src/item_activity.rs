//! Reference-only attribution for mailbox/issue tools; never store message bodies.
use crate::feedback::MailRef;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemActivity {
    pub run_id: String,
    pub at: u64,
    pub email: Option<MailRef>,
    pub issue: Option<u64>,
}
fn valid(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
}
fn file(root: &Path, project: &str, run: &str) -> Result<std::path::PathBuf, String> {
    if !valid(project) || !valid(run) {
        return Err("Invalid item activity scope".into());
    }
    Ok(root
        .join("automation-commits")
        .join(project)
        .join(run)
        .join("item-activity.json"))
}
pub fn record(root: &Path, project: &str, email: Option<MailRef>, issue: Option<u64>) {
    let Ok(run) = std::env::var("CERBERUS_ACTIVITY_RUN_ID") else {
        return;
    };
    // Activity is best effort: metadata failure must never repeat a remote write.
    let _ = (|| -> Result<(), String> {
        let target = file(root, project, &run)?;
        fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
        let at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let item = ItemActivity {
            run_id: run,
            at,
            email,
            issue,
        };
        let temp = target.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        fs::write(&temp, serde_json::to_vec(&item).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&temp, fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
        fs::rename(temp, target).map_err(|e| e.to_string())
    })();
}
pub fn read(root: &Path, project: &str, runs: &[String]) -> Result<Vec<ItemActivity>, String> {
    if runs.len() > 100 {
        return Err("Too many active runs".into());
    }
    let mut items = Vec::new();
    for run in runs {
        let target = file(root, project, run)?;
        if let Ok(bytes) = fs::read(target) {
            let item: ItemActivity =
                serde_json::from_slice(&bytes).map_err(|_| "Invalid item activity")?;
            if item.run_id == *run {
                items.push(item);
            }
        }
    }
    Ok(items)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scoped_reads_reject_paths_and_ignore_commit_markers() {
        let root = tempfile::tempdir().unwrap();
        assert!(read(root.path(), "../other", &["run".into()]).is_err());
        assert!(read(root.path(), "project", &["../run".into()]).is_err());
        let path = file(root.path(), "project", "run").unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            path,
            serde_json::to_vec(&ItemActivity {
                run_id: "run".into(),
                at: 5,
                email: None,
                issue: Some(9),
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            read(root.path(), "project", &["run".into()]).unwrap()[0].issue,
            Some(9)
        );
        assert!(crate::commit_provenance::commits(root.path(), "project", "run").is_empty());
        assert!(read(root.path(), "other", &["run".into()])
            .unwrap()
            .is_empty());
    }
}
