//! Persistent isolated checkouts for agent automation contexts and later resume.
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
fn active_runs() -> &'static std::sync::Mutex<std::collections::HashMap<String, usize>> {
    static RUNS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, usize>>> =
        std::sync::OnceLock::new();
    RUNS.get_or_init(Default::default)
}
pub fn is_active(run_id: &str) -> bool {
    active_runs()
        .lock()
        .map(|runs| runs.contains_key(run_id))
        .unwrap_or(true)
}
pub struct Activity(String);
pub fn activate(run_id: &str) -> Activity {
    *active_runs()
        .lock()
        .unwrap()
        .entry(run_id.into())
        .or_default() += 1;
    Activity(run_id.into())
}
impl Drop for Activity {
    fn drop(&mut self) {
        let mut runs = active_runs().lock().unwrap();
        if let Some(count) = runs.get_mut(&self.0) {
            *count -= 1;
            if *count == 0 {
                runs.remove(&self.0);
            }
        }
    }
}
fn valid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}
fn git(repository: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}
pub fn path(root: &Path, repository_id: &str, run_id: &str) -> Result<PathBuf, String> {
    if !valid(repository_id) || !valid(run_id) {
        return Err("Invalid automation checkout identifier.".into());
    }
    Ok(root
        .join("automation-worktrees")
        .join(repository_id)
        .join(run_id))
}
pub fn existing(
    root: &Path,
    repository: &Path,
    repository_id: &str,
    run_id: &str,
) -> Result<PathBuf, String> {
    let path = path(root, repository_id, run_id)?;
    if path
        .symlink_metadata()
        .is_ok_and(|meta| meta.file_type().is_symlink())
    {
        return Err("Automation checkout cannot be a symbolic link.".into());
    }
    let common = git(
        repository,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    if git(
        &path,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )? != common
    {
        return Err("Automation checkout belongs to another repository.".into());
    }
    Ok(path)
}
pub fn prepare(
    root: &Path,
    repository: &Path,
    repository_id: &str,
    run_id: &str,
    revision: Option<&str>,
) -> Result<PathBuf, String> {
    let path = path(root, repository_id, run_id)?;
    if path.exists() {
        return existing(root, repository, repository_id, run_id);
    }
    // The agent may have committed after its triggering revision. Restore the
    // final checkout state on continuation, even after safe cleanup.
    let restored = match fs::read_to_string(path.with_extension("revision")) {
        Ok(value) => {
            let value = value.trim();
            if !matches!(value.len(), 40 | 64) || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("Invalid saved automation checkout revision.".into());
            }
            Some(value.to_owned())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.to_string()),
    };
    let revision = restored
        .as_deref()
        .or(revision.filter(|value| !value.is_empty()))
        .unwrap_or("HEAD");
    let commit = git(
        repository,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{revision}^{{commit}}"),
        ],
    )?;
    let area = root.join("automation-worktrees");
    if area
        .symlink_metadata()
        .is_ok_and(|meta| meta.file_type().is_symlink())
    {
        return Err("Automation checkout storage cannot be a symbolic link.".into());
    }
    let parent = path.parent().ok_or("Invalid automation checkout path")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    if parent
        .symlink_metadata()
        .is_ok_and(|meta| meta.file_type().is_symlink())
    {
        return Err("Automation checkout storage cannot be a symbolic link.".into());
    }
    // Keep this checkout for execution and resume. Successful runs may clean it
    // only after their transcript is saved and their commits are referenced elsewhere.
    git(
        repository,
        &[
            "worktree",
            "add",
            "-b",
            &format!("private/automation-{run_id}"),
            path.to_str().ok_or("Invalid checkout path")?,
            &commit,
        ],
    )?;
    existing(root, repository, repository_id, run_id)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn contexts_are_isolated_resumable_and_preserve_dirty_edits() {
        let repo = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        git(repo.path(), &["init", "-q"]).unwrap();
        git(
            repo.path(),
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.test",
                "commit",
                "--allow-empty",
                "-qm",
                "base",
            ],
        )
        .unwrap();
        let first = prepare(root.path(), repo.path(), "repo", "first", None).unwrap();
        let second = prepare(root.path(), repo.path(), "repo", "second", None).unwrap();
        assert_ne!(first, second);
        fs::write(first.join("dirty.txt"), "kept").unwrap();
        assert!(!second.join("dirty.txt").exists());
        assert!(!repo.path().join("dirty.txt").exists());
        assert_eq!(
            prepare(root.path(), repo.path(), "repo", "first", None).unwrap(),
            first
        );
        assert_eq!(fs::read_to_string(first.join("dirty.txt")).unwrap(), "kept");
        assert!(path(root.path(), "repo", "../escape").is_err());
        assert!(prepare(root.path(), repo.path(), "repo", "bad", Some("--help")).is_err());
    }
}

/// Remove only clean app-owned checkouts, preserving every uniquely referenced commit.
pub fn cleanup(
    root: &Path,
    repository: &Path,
    repository_id: &str,
    run_id: &str,
) -> Result<bool, String> {
    let active = active_runs().lock().map_err(|e| e.to_string())?;
    if active.contains_key(run_id) {
        return Ok(false);
    }
    let checkout = path(root, repository_id, run_id)?;
    if !checkout.exists() {
        return Ok(false);
    }
    let checkout = existing(root, repository, repository_id, run_id)?;
    if !git(
        &checkout,
        &["status", "--porcelain", "--untracked-files=all"],
    )?
    .is_empty()
    {
        return Ok(false);
    }
    let owned_branch = format!("private/automation-{run_id}");
    let current = git(&checkout, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if current != "HEAD" && !crate::branch_listing::temporary(&current) {
        return Ok(false);
    }
    let branch = if current == "HEAD" {
        owned_branch
    } else {
        current
    };
    let reference = format!("refs/heads/{branch}");
    let head = git(&checkout, &["rev-parse", "HEAD"])?;
    let refs = git(
        repository,
        &[
            "for-each-ref",
            "--format=%(refname)",
            &format!("--contains={head}"),
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    if !refs
        .lines()
        .any(|name| name != reference && !name.starts_with("refs/heads/private/automation-"))
    {
        return Ok(false);
    }
    let tip = git(repository, &["rev-parse", "--verify", &reference]).ok();
    // An agent can detach or switch branches. Never discard a different branch tip.
    if tip.as_ref().is_some_and(|tip| tip != &head) {
        return Ok(false);
    }
    // Persist before deletion so a crash cannot lose the state needed to resume.
    let mut marker =
        tempfile::NamedTempFile::new_in(checkout.parent().ok_or("Invalid checkout path")?)
            .map_err(|e| e.to_string())?;
    use std::io::Write;
    marker
        .write_all(head.as_bytes())
        .map_err(|e| e.to_string())?;
    marker.as_file().sync_all().map_err(|e| e.to_string())?;
    marker
        .persist(checkout.with_extension("revision"))
        .map_err(|e| e.to_string())?;
    git(
        repository,
        &[
            "worktree",
            "remove",
            checkout.to_str().ok_or("Invalid checkout path")?,
        ],
    )?;
    if let Some(tip) = tip {
        git(repository, &["update-ref", "-d", &reference, &tip])?;
    }
    Ok(true)
}
#[cfg(test)]
mod cleanup_tests {
    use super::*;
    #[test]
    fn agent_named_temporary_branch_cleanup_preserves_unique_and_permanent_work() {
        let root = tempfile::tempdir().unwrap();
        let repo = tempfile::tempdir().unwrap();
        git(repo.path(), &["init", "-q"]).unwrap();
        git(
            repo.path(),
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.test",
                "commit",
                "--allow-empty",
                "-qm",
                "base",
            ],
        )
        .unwrap();
        let checkout = prepare(root.path(), repo.path(), "repo", "renamed", None).unwrap();
        git(&checkout, &["checkout", "-b", "correction/fixture"]).unwrap();
        git(
            &checkout,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.test",
                "commit",
                "--allow-empty",
                "-qm",
                "unique",
            ],
        )
        .unwrap();
        assert!(!cleanup(root.path(), repo.path(), "repo", "renamed").unwrap());
        git(repo.path(), &["branch", "preserved", "correction/fixture"]).unwrap();
        assert!(cleanup(root.path(), repo.path(), "repo", "renamed").unwrap());
        assert!(git(
            repo.path(),
            &["show-ref", "--verify", "refs/heads/correction/fixture"]
        )
        .is_err());
        assert!(git(
            repo.path(),
            &["show-ref", "--verify", "refs/heads/preserved"]
        )
        .is_ok());
        let other = prepare(root.path(), repo.path(), "repo", "permanent", None).unwrap();
        git(&other, &["checkout", "-b", "test-rebase"]).unwrap();
        assert!(!cleanup(root.path(), repo.path(), "repo", "permanent").unwrap());
        assert!(other.exists());
    }
    #[test]
    fn retention_deadline_controls_periodic_cleanup() {
        let root = tempfile::tempdir().unwrap();
        let repo = tempfile::tempdir().unwrap();
        git(repo.path(), &["init", "-q"]).unwrap();
        git(
            repo.path(),
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.test",
                "commit",
                "--allow-empty",
                "-qm",
                "base",
            ],
        )
        .unwrap();
        let checkout = prepare(root.path(), repo.path(), "repo", "scheduled", None).unwrap();
        let deadline = cleanup_at(root.path(), &checkout).unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        assert!(deadline > now + 23 * 3_600_000);
        assert_eq!(sweep(root.path(), repo.path(), "repo", &[]).unwrap(), 0);
        assert!(checkout.exists());
        fs::write(root.path().join("handoff-retention-hours"), "1").unwrap();
        assert_eq!(
            cleanup_at(root.path(), &checkout).unwrap() + 23 * 3_600_000,
            deadline
        );
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(7200);
        fs::OpenOptions::new()
            .write(true)
            .open(checkout.join(".git"))
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(old))
            .unwrap();
        assert_eq!(
            sweep(root.path(), repo.path(), "repo", &["scheduled".into()]).unwrap(),
            0
        );
        assert!(checkout.exists());
        assert_eq!(sweep(root.path(), repo.path(), "repo", &[]).unwrap(), 1);
        assert!(!checkout.exists());
    }
    #[test]
    fn clean_referenced_checkouts_are_removed_but_dirty_and_unique_work_are_kept() {
        let repo = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        git(repo.path(), &["init", "-q"]).unwrap();
        git(
            repo.path(),
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.test",
                "commit",
                "--allow-empty",
                "-qm",
                "base",
            ],
        )
        .unwrap();
        let clean = prepare(root.path(), repo.path(), "repo", "clean", None).unwrap();
        let lease = activate("clean");
        assert!(!cleanup(root.path(), repo.path(), "repo", "clean").unwrap());
        drop(lease);
        assert_eq!(
            sweep(root.path(), repo.path(), "repo", &["clean".into()]).unwrap(),
            0
        );
        assert!(cleanup(root.path(), repo.path(), "repo", "clean").unwrap());
        assert!(!clean.exists());
        let dirty = prepare(root.path(), repo.path(), "repo", "dirty", None).unwrap();
        fs::write(dirty.join("kept.txt"), "keep").unwrap();
        assert!(!cleanup(root.path(), repo.path(), "repo", "dirty").unwrap());
        let unique = prepare(root.path(), repo.path(), "repo", "unique", None).unwrap();
        git(
            &unique,
            &[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.test",
                "commit",
                "--allow-empty",
                "-qm",
                "unique",
            ],
        )
        .unwrap();
        assert!(!cleanup(root.path(), repo.path(), "repo", "unique").unwrap());
        git(
            repo.path(),
            &[
                "branch",
                "correction/retained",
                &git(&unique, &["rev-parse", "HEAD"]).unwrap(),
            ],
        )
        .unwrap();
        let final_revision = git(&unique, &["rev-parse", "HEAD"]).unwrap();
        assert!(cleanup(root.path(), repo.path(), "repo", "unique").unwrap());
        let resumed = prepare(root.path(), repo.path(), "repo", "unique", Some("HEAD")).unwrap();
        assert_eq!(
            git(&resumed, &["rev-parse", "HEAD"]).unwrap(),
            final_revision
        );
    }
}

/// Earliest periodic cleanup attempt; active/blocked leases and Git safety still apply.
pub fn cleanup_at(root: &Path, checkout: &Path) -> Option<u64> {
    let hours = fs::read_to_string(root.join("handoff-retention-hours"))
        .ok()
        .and_then(|text| text.trim().parse::<u64>().ok())
        .filter(|hours| (1..=8760).contains(hours))
        .unwrap_or(24);
    let created = fs::metadata(checkout.join(".git"))
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some(created.saturating_add(hours * 3_600_000))
}
/// Revisit retained checkouts after their active/blocked lease ends. Never force removal.
pub fn sweep(
    root: &Path,
    repository: &Path,
    repository_id: &str,
    protected: &[String],
) -> Result<usize, String> {
    let parent = path(root, repository_id, "scan")?
        .parent()
        .unwrap()
        .to_path_buf();
    if !parent.exists() {
        return Ok(0);
    }
    let mut removed = 0;
    for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let id = entry.file_name().to_string_lossy().to_string();
        if !valid(&id)
            || protected.contains(&id)
            || !entry.file_type().map_err(|e| e.to_string())?.is_dir()
        {
            continue;
        }
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        if cleanup_at(root, &entry.path()).is_none_or(|deadline| now < deadline) {
            continue;
        }
        match cleanup(root, repository, repository_id, &id) {
            Ok(true) => removed += 1,
            Ok(false) => {}
            Err(error) => eprintln!("Retained automation checkout {id}: {error}"),
        }
    }
    Ok(removed)
}
