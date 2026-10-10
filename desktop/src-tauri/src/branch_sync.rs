//! Conservative, worktree-aware fast-forwarding to a configured upstream.
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::Command,
};
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub upstream: Option<String>,
    pub ahead: u64,
    pub behind: u64,
    pub safe: bool,
    pub reason: String,
}
fn git(repo: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}
fn checkout(repo: &Path, branch: &str) -> Result<Option<PathBuf>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["worktree", "list", "--porcelain", "-z"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into());
    }
    let mut current = None;
    let reference = format!("refs/heads/{branch}");
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
        }
        if field.strip_prefix(b"branch ") == Some(reference.as_bytes()) {
            return Ok(current);
        }
    }
    Ok(None)
}
pub fn status(repo: &Path, branch: &str) -> Result<Status, String> {
    git(repo, &["check-ref-format", "--branch", branch])?;
    let reference = format!("refs/heads/{branch}");
    git(repo, &["show-ref", "--verify", &reference])?;
    let upstream = git(repo, &["for-each-ref", "--format=%(upstream)", &reference])?;
    let mut result = Status {
        upstream: None,
        ahead: 0,
        behind: 0,
        safe: false,
        reason: "No upstream configured for this branch.".into(),
    };
    if upstream.is_empty() {
        return Ok(result);
    }
    result.upstream = Some(upstream.clone());
    let counts = match git(
        repo,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{reference}...{upstream}"),
        ],
    ) {
        Ok(value) => value,
        Err(_) => {
            result.reason = "Upstream is unavailable locally. Fetch the repository first.".into();
            return Ok(result);
        }
    };
    let mut parts = counts.split_whitespace();
    result.ahead = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    result.behind = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    if result.behind == 0 {
        result.reason = if result.ahead > 0 {
            "Branch is ahead of upstream."
        } else {
            "Branch is up to date."
        }
        .into();
        return Ok(result);
    }
    if result.ahead > 0 {
        result.reason = "Branch has diverged from upstream; fast-forward is unavailable.".into();
        return Ok(result);
    }
    if let Some(path) = checkout(repo, branch)? {
        if !git(&path, &["status", "--porcelain", "--untracked-files=all"])?.is_empty() {
            result.reason = format!(
                "Local changes in worktree {}. Commit or stash them first.",
                path.display()
            );
            return Ok(result);
        }
        for name in [
            "MERGE_HEAD",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
            "rebase-merge",
            "rebase-apply",
            "BISECT_LOG",
        ] {
            let state = git(&path, &["rev-parse", "--git-path", name])?;
            if path.join(state).exists() {
                result.reason = format!(
                    "An unfinished Git operation is active in {}.",
                    path.display()
                );
                return Ok(result);
            }
        }
    }
    result.safe = true;
    result.reason = "Fast-forward from upstream (fetches and rechecks first).".into();
    Ok(result)
}
pub fn advance(repo: &Path, branch: &str) -> Result<Status, String> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    git(repo, &["check-ref-format", "--branch", branch])?;
    let remote = git(
        repo,
        &["config", "--get", &format!("branch.{branch}.remote")],
    )?;
    git(repo, &["fetch", "--", &remote])?;
    let plan = status(repo, branch)?;
    if !plan.safe {
        return Err(plan.reason);
    }
    let upstream = plan.upstream.as_deref().ok_or("No upstream configured")?;
    if let Some(path) = checkout(repo, branch)? {
        if git(&path, &["symbolic-ref", "--quiet", "HEAD"])? != format!("refs/heads/{branch}") {
            return Err("Worktree checkout changed; refresh and retry.".into());
        }
        git(
            &path,
            &[
                "-c",
                "merge.autostash=false",
                "merge",
                "--ff-only",
                "--no-edit",
                upstream,
            ],
        )?;
    } else {
        // Git refuses non-fast-forwards and branches checked out by any worktree.
        git(
            repo,
            &[
                "fetch",
                "--no-write-fetch-head",
                ".",
                &format!("{upstream}:refs/heads/{branch}"),
            ],
        )?;
    }
    status(repo, branch)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn advances_clean_linked_worktree_and_refuses_dirty_and_diverged() {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        std::fs::create_dir(&repo).unwrap();
        git(&repo, &["init", "-b", "main"]).unwrap();
        git(&repo, &["config", "user.name", "Test"]).unwrap();
        git(&repo, &["config", "user.email", "test@example.test"]).unwrap();
        git(&repo, &["commit", "--allow-empty", "-m", "base"]).unwrap();
        git(&repo, &["branch", "target"]).unwrap();
        git(&repo, &["branch", "--set-upstream-to=main", "target"]).unwrap();
        let work = root.path().join("linked");
        git(
            &repo,
            &["worktree", "add", work.to_str().unwrap(), "target"],
        )
        .unwrap();
        git(&repo, &["commit", "--allow-empty", "-m", "remote"]).unwrap();
        assert!(status(&repo, "target").unwrap().safe);
        std::fs::write(work.join("untracked"), "keep").unwrap();
        assert!(!status(&repo, "target").unwrap().safe);
        assert!(advance(&repo, "target").is_err());
        std::fs::remove_file(work.join("untracked")).unwrap();
        assert_eq!(advance(&repo, "target").unwrap().behind, 0);
        git(&work, &["commit", "--allow-empty", "-m", "local"]).unwrap();
        git(&repo, &["commit", "--allow-empty", "-m", "other"]).unwrap();
        assert!(!status(&repo, "target").unwrap().safe);
        assert!(advance(&repo, "target").is_err());
    }
    #[test]
    fn fetch_rechecks_remote_and_never_moves_diverged_branch() {
        let root = tempfile::tempdir().unwrap();
        let upstream = root.path().join("source");
        let bare = root.path().join("remote.git");
        let local = root.path().join("local");
        std::fs::create_dir(&upstream).unwrap();
        git(&upstream, &["init", "-b", "main"]).unwrap();
        git(&upstream, &["config", "user.name", "Test"]).unwrap();
        git(&upstream, &["config", "user.email", "test@example.test"]).unwrap();
        git(&upstream, &["commit", "--allow-empty", "-m", "base"]).unwrap();
        git(
            root.path(),
            &[
                "clone",
                "--bare",
                upstream.to_str().unwrap(),
                bare.to_str().unwrap(),
            ],
        )
        .unwrap();
        git(
            root.path(),
            &["clone", bare.to_str().unwrap(), local.to_str().unwrap()],
        )
        .unwrap();
        git(&upstream, &["commit", "--allow-empty", "-m", "next"]).unwrap();
        git(&upstream, &["push", bare.to_str().unwrap(), "main"]).unwrap();
        assert_eq!(status(&local, "main").unwrap().behind, 0);
        assert_eq!(advance(&local, "main").unwrap().behind, 0);
        assert_eq!(
            git(&local, &["rev-parse", "HEAD"]).unwrap(),
            git(&upstream, &["rev-parse", "HEAD"]).unwrap()
        );
        git(&local, &["config", "user.name", "Test"]).unwrap();
        git(&local, &["config", "user.email", "test@example.test"]).unwrap();
        git(&local, &["commit", "--allow-empty", "-m", "local"]).unwrap();
        let head = git(&local, &["rev-parse", "HEAD"]).unwrap();
        git(&upstream, &["commit", "--allow-empty", "-m", "remote"]).unwrap();
        git(&upstream, &["push", bare.to_str().unwrap(), "main"]).unwrap();
        assert!(advance(&local, "main").is_err());
        assert_eq!(git(&local, &["rev-parse", "HEAD"]).unwrap(), head);
    }
    #[test]
    fn unchecked_branch_advances_and_missing_upstream_is_visible() {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path();
        git(repo, &["init", "-b", "main"]).unwrap();
        git(repo, &["config", "user.name", "Test"]).unwrap();
        git(repo, &["config", "user.email", "test@example.test"]).unwrap();
        git(repo, &["commit", "--allow-empty", "-m", "base"]).unwrap();
        assert!(status(repo, "main").unwrap().reason.contains("No upstream"));
        git(repo, &["branch", "target"]).unwrap();
        git(repo, &["branch", "--set-upstream-to=main", "target"]).unwrap();
        git(repo, &["commit", "--allow-empty", "-m", "next"]).unwrap();
        assert_eq!(advance(repo, "target").unwrap().behind, 0);
    }
}
