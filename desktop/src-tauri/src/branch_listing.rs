//! Branch presentation state: ordinary refs and temporary automation/worktree refs.
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Command,
};
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub kind: &'static str,
    pub worktree: Option<PathBuf>,
    pub cleanup_at: Option<u64>,
    pub cleanup_note: Option<String>,
}
pub(crate) fn temporary(name: &str) -> bool {
    [
        "private/",
        "correction/",
        "integration/",
        "revision/",
        "temp/",
        "tmp/",
    ]
    .iter()
    .any(|prefix| name.starts_with(prefix))
}
fn kind(name: &str, checkout: Option<&Path>, managed: &Path, active: bool) -> &'static str {
    if !temporary(name) {
        return "permanent";
    }
    if checkout.is_some_and(|path| !path.starts_with(managed) || active) {
        "used"
    } else {
        "retained"
    }
}
pub fn list(root: &Path, repo: &Path, id: &str, names: Vec<String>) -> Result<Vec<Branch>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["worktree", "list", "--porcelain", "-z"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into());
    }
    let mut worktrees = HashMap::new();
    let mut current = None;
    for field in output.stdout.split(|b| *b == 0) {
        if let Some(value) = field.strip_prefix(b"worktree ") {
            #[cfg(unix)]
            {
                use std::os::unix::ffi::OsStrExt;
                current = Some(PathBuf::from(std::ffi::OsStr::from_bytes(value)));
            }
            #[cfg(not(unix))]
            {
                current = Some(PathBuf::from(String::from_utf8_lossy(value).as_ref()));
            }
        } else if let Some(value) = field.strip_prefix(b"branch refs/heads/") {
            if let Some(path) = &current {
                worktrees.insert(String::from_utf8_lossy(value).into_owned(), path.clone());
            }
        }
    }
    let managed = root.join("automation-worktrees").join(id);
    Ok(names
        .into_iter()
        .map(|name| {
            let worktree = worktrees.get(&name).cloned();
            let active = worktree
                .as_ref()
                .and_then(|path| path.strip_prefix(&managed).ok())
                .and_then(|path| path.components().next())
                .is_some_and(|part| {
                    crate::automation_worktrees::is_active(&part.as_os_str().to_string_lossy())
                });
            let kind = kind(&name, worktree.as_deref(), &managed, active);
            let cleanup_at=if kind=="retained"{worktree.as_deref().filter(|path|path.starts_with(&managed)).and_then(|path|crate::automation_worktrees::cleanup_at(root,path))}else{None};
            let cleanup_note=if kind=="retained"{Some(if cleanup_at.is_some(){"Automatic cleanup after this time, when the app is running. Active or retry-protected runs, dirty worktrees, and unique commits are preserved."}else{"No automatic deletion scheduled: this branch has no app-managed worktree. Remove it manually when no longer needed."}.into())}else{None};
            Branch {
                cleanup_at,cleanup_note,
                name,
                kind,
                worktree,
            }
        })
        .collect())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn listing_tracks_real_managed_worktree_activity() {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        std::fs::create_dir(&repo).unwrap();
        let run = "branch-list-fixture";
        let checkout = root
            .path()
            .join("automation-worktrees/repository")
            .join(run);
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Test"],
            vec!["config", "user.email", "test@example.test"],
            vec!["commit", "--allow-empty", "-m", "base"],
        ] {
            assert!(Command::new("git")
                .arg("-C")
                .arg(&repo)
                .args(args)
                .output()
                .unwrap()
                .status
                .success());
        }
        std::fs::create_dir_all(checkout.parent().unwrap()).unwrap();
        assert!(Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args([
                "worktree",
                "add",
                "-b",
                "private/automation-branch-list-fixture"
            ])
            .arg(&checkout)
            .output()
            .unwrap()
            .status
            .success());
        let names = vec!["private/automation-branch-list-fixture".into()];
        assert_eq!(
            list(root.path(), &repo, "repository", names.clone()).unwrap()[0].kind,
            "retained"
        );
        assert!(
            list(root.path(), &repo, "repository", names.clone()).unwrap()[0]
                .cleanup_at
                .is_some()
        );
        let activity = crate::automation_worktrees::activate(run);
        assert_eq!(
            list(root.path(), &repo, "repository", names.clone()).unwrap()[0].kind,
            "used"
        );
        assert!(
            list(root.path(), &repo, "repository", names.clone()).unwrap()[0]
                .cleanup_at
                .is_none()
        );
        drop(activity);
        assert_eq!(
            list(root.path(), &repo, "repository", names).unwrap()[0].kind,
            "retained"
        );
    }
    #[test]
    fn retained_managed_checkout_is_not_a_running_branch() {
        let managed = Path::new("/app/automation-worktrees/repo");
        let owned = managed.join("run");
        assert_eq!(kind("main", Some(&owned), managed, true), "permanent");
        assert_eq!(
            kind("private/automation-run", Some(&owned), managed, false),
            "retained"
        );
        assert_eq!(
            kind("private/automation-run", Some(&owned), managed, true),
            "used"
        );
        assert_eq!(kind("correction/ci", None, managed, false), "retained");
        assert_eq!(
            kind(
                "correction/ci",
                Some(Path::new("/external/worktree")),
                managed,
                false
            ),
            "used"
        );
        assert_eq!(kind("feature/login", None, managed, false), "permanent");
    }
}
