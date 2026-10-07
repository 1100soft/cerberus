//! Persistent isolated checkouts for agent automation contexts and later resume.
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
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
    let revision = revision.filter(|value| !value.is_empty()).unwrap_or("HEAD");
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
    let branch = format!("private/automation-{run_id}");
    let current = git(&checkout, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if current != "HEAD" && current != branch {
        return Ok(false);
    }
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
        .any(|name| !name.starts_with("refs/heads/private/automation-"))
    {
        return Ok(false);
    }
    let reference = format!("refs/heads/{branch}");
    let tip = git(repository, &["rev-parse", "--verify", &reference]).ok();
    // An agent can detach or switch branches. Never discard a different branch tip.
    if tip.as_ref().is_some_and(|tip| tip != &head) {
        return Ok(false);
    }
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
        assert!(cleanup(root.path(), repo.path(), "repo", "unique").unwrap());
    }
}
