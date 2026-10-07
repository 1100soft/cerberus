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
    // Keep the branch/worktree after completion, including uncommitted agent edits.
    // Normal worktree-aware branch removal can clean it after review.
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
