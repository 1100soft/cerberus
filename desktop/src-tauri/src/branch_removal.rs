//! Worktrees are never forced; deleting unmerged branches requires exact confirmation.
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::Mutex,
};
static REMOVAL: Mutex<()> = Mutex::new(());
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub branch: String,
    pub head: String,
    pub merged: bool,
    pub worktrees: Vec<PathBuf>,
    pub remote: Option<String>,
    pub remote_head: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultDetails {
    pub completed: bool,
    pub steps: Vec<String>,
    pub error: Option<String>,
}
fn output(repo: &Path, args: &[&std::ffi::OsStr]) -> Result<Output, String> {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|error| error.to_string())
}
fn git(repo: &Path, args: &[&str]) -> Result<Output, String> {
    output(
        repo,
        &args.iter().map(std::ffi::OsStr::new).collect::<Vec<_>>(),
    )
}
fn checked(result: Output) -> Result<Output, String> {
    if result.status.success() {
        Ok(result)
    } else {
        Err(String::from_utf8_lossy(&result.stderr).trim().to_owned())
    }
}
fn text(repo: &Path, args: &[&str]) -> Result<String, String> {
    Ok(String::from_utf8_lossy(&checked(git(repo, args)?)?.stdout)
        .trim()
        .to_owned())
}
fn path(bytes: &[u8]) -> PathBuf {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        PathBuf::from(std::ffi::OsStr::from_bytes(bytes))
    }
    #[cfg(not(unix))]
    {
        PathBuf::from(String::from_utf8_lossy(bytes).as_ref())
    }
}
fn worktrees(repo: &Path, branch: &str) -> Result<Vec<PathBuf>, String> {
    let listing = checked(git(repo, &["worktree", "list", "--porcelain", "-z"])?)?;
    let reference = format!("refs/heads/{branch}");
    let mut current = PathBuf::new();
    let mut first = true;
    let mut primary = false;
    let mut found = Vec::new();
    for field in listing.stdout.split(|byte| *byte == 0) {
        if let Some(value) = field.strip_prefix(b"worktree ") {
            current = path(value);
            primary = first;
            first = false;
        }
        if field.strip_prefix(b"branch ") == Some(reference.as_bytes()) {
            if primary {
                return Err("This branch is checked out in the primary worktree. Switch that checkout to another branch before removing it.".into());
            }
            if current == repo || current.canonicalize().is_ok_and(|path| path == repo) {
                return Err("This branch is checked out in the repository folder linked to the app. Switch that checkout to another branch before removing it.".into());
            }
            found.push(current.clone());
        }
    }
    Ok(found)
}
fn remote_head(repo: &Path, remote: &str, branch: &str) -> Result<Option<String>, String> {
    let reference = format!("refs/heads/{branch}");
    let result = git(
        repo,
        &[
            "ls-remote",
            "--exit-code",
            "--heads",
            "--",
            remote,
            &reference,
        ],
    )?;
    if result.status.code() == Some(2) {
        return Ok(None);
    }
    let result =
        checked(result).map_err(|error| format!("Could not check remote branch: {error}"))?;
    Ok(String::from_utf8_lossy(&result.stdout)
        .lines()
        .find_map(|line| {
            let (sha, name) = line.split_once('\t')?;
            (name == reference).then(|| sha.to_owned())
        }))
}
fn is_merged(repo: &Path, branch: &str) -> Result<bool, String> {
    let reference = format!("refs/heads/{branch}");
    let upstream = text(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{reference}@{{upstream}}^{{commit}}"),
        ],
    )
    .unwrap_or_else(|_| "HEAD".into());
    let result = git(
        repo,
        &["merge-base", "--is-ancestor", &reference, &upstream],
    )?;
    match result.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => checked(result).map(|_| true),
    }
}
pub fn plan(repo: &Path, branch: &str, remote: Option<&str>) -> Result<Plan, String> {
    let _guard = REMOVAL
        .lock()
        .map_err(|_| "Branch removal lock unavailable")?;
    inspect(repo, branch, remote)
}
fn inspect(repo: &Path, branch: &str, remote: Option<&str>) -> Result<Plan, String> {
    let repo = repo.canonicalize().map_err(|error| error.to_string())?;
    if branch.starts_with('-') {
        return Err("Invalid local branch name".into());
    }
    let reference = format!("refs/heads/{branch}");
    checked(git(&repo, &["check-ref-format", &reference])?)
        .map_err(|_| "Invalid local branch name")?;
    let head = text(
        &repo,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{reference}^{{commit}}"),
        ],
    )
    .map_err(|_| format!("Local branch does not exist: {branch}"))?;
    let worktrees = worktrees(&repo, branch)?;
    let merged = is_merged(&repo, branch)?;
    let remotes = text(&repo, &["remote"])?;
    if let Some(name) = remote {
        if name != "origin" && !remotes.lines().any(|item| item == name) {
            return Err(format!("Configured remote does not exist: {name}"));
        }
    }
    let remote = remote
        .filter(|name| remotes.lines().any(|item| item == *name))
        .map(str::to_owned);
    let remote_head = remote
        .as_deref()
        .map(|name| remote_head(&repo, name, branch))
        .transpose()?
        .flatten();
    Ok(Plan {
        branch: branch.into(),
        head,
        merged,
        worktrees,
        remote,
        remote_head,
    })
}
pub fn remove(
    repo: &Path,
    expected: Plan,
    confirmed_unmerged_head: Option<&str>,
) -> Result<ResultDetails, String> {
    let _guard = REMOVAL
        .lock()
        .map_err(|_| "Branch removal lock unavailable")?;
    let repo = repo.canonicalize().map_err(|error| error.to_string())?;
    let actual = inspect(&repo, &expected.branch, expected.remote.as_deref())?;
    if actual.merged != expected.merged
        || actual.head != expected.head
        || actual.worktrees != expected.worktrees
        || actual.remote != expected.remote
        || actual.remote_head != expected.remote_head
    {
        return Err(
            "Branch, worktrees, or remote changed since confirmation. Review the removal again."
                .into(),
        );
    }
    if !actual.merged && confirmed_unmerged_head != Some(actual.head.as_str()) {
        return Err("This branch is unmerged. Forced deletion requires a second confirmation of this exact commit.".into());
    }
    let mut steps = Vec::new();
    let result = (|| -> Result<(), String> {
        for worktree in &actual.worktrees {
            let args = [
                OsString::from("worktree"),
                OsString::from("remove"),
                OsString::from("--"),
                worktree.as_os_str().to_owned(),
            ];
            checked(output(
                &repo,
                &args.iter().map(OsString::as_os_str).collect::<Vec<_>>(),
            )?)?;
            steps.push(format!("Removed worktree: {}", worktree.display()));
        }
        // Recheck the tip after worktree removal; Git performs its own merged check.
        let reference = format!("refs/heads/{}", actual.branch);
        if text(
            &repo,
            &["rev-parse", "--verify", "--end-of-options", &reference],
        )? != actual.head
        {
            return Err("Local branch changed during removal. Its ref was preserved.".into());
        }
        checked(git(
            &repo,
            &[
                "branch",
                if actual.merged { "-d" } else { "-D" },
                "--",
                &actual.branch,
            ],
        )?)?;
        steps.push(format!(
            "{} local branch: {}",
            if actual.merged {
                "Deleted"
            } else {
                "Force-deleted"
            },
            actual.branch
        ));
        if let Some(remote) = actual.remote.as_deref() {
            if let Some(sha) = actual.remote_head.as_deref() {
                if remote_head(&repo, remote, &actual.branch)?.as_deref() != Some(sha) {
                    return Err("Remote branch changed during removal. It was preserved.".into());
                }
                checked(git(&repo, &["push", remote, "--delete", "--", &reference])?)?;
                steps.push(format!("Deleted remote branch: {remote}/{}", actual.branch));
            } else {
                steps.push(format!(
                    "Remote branch does not exist: {remote}/{}",
                    actual.branch
                ));
            }
            checked(git(&repo, &["fetch", "--prune", "--", remote])?)?;
            steps.push(format!("Fetched and pruned {remote}"));
        }
        Ok(())
    })();
    Ok(ResultDetails {
        completed: result.is_ok(),
        steps,
        error: result.err(),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn remove(repo: &Path, plan: Plan) -> Result<ResultDetails, String> {
        super::remove(repo, plan, None)
    }
    fn run(repo: &Path, args: &[&str]) {
        text(repo, args).unwrap();
    }
    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        run(dir.path(), &["init", "-q", "-b", "main"]);
        run(
            dir.path(),
            &["config", "user.email", "fixture@example.test"],
        );
        run(dir.path(), &["config", "user.name", "Fixture"]);
        run(dir.path(), &["commit", "--allow-empty", "-qm", "Initial"]);
        run(dir.path(), &["branch", "correction/test"]);
        dir
    }
    #[test]
    fn removes_merged_branch_worktree_and_exact_remote() {
        let dir = fixture();
        let remote = tempfile::tempdir().unwrap();
        run(remote.path(), &["init", "--bare", "-q"]);
        run(
            dir.path(),
            &["remote", "add", "origin", remote.path().to_str().unwrap()],
        );
        run(
            dir.path(),
            &["push", "-q", "origin", "main", "correction/test"],
        );
        let trees = tempfile::tempdir().unwrap();
        let tree = trees.path().join("tree with spaces");
        run(
            dir.path(),
            &[
                "worktree",
                "add",
                "-q",
                tree.to_str().unwrap(),
                "correction/test",
            ],
        );
        let plan = plan(dir.path(), "correction/test", Some("origin")).unwrap();
        assert!(plan.remote_head.is_some());
        assert_eq!(plan.worktrees, vec![tree.clone()]);
        let result = remove(dir.path(), plan).unwrap();
        assert!(result.completed, "{:?}", result.error);
        assert!(!tree.exists());
        assert!(text(
            dir.path(),
            &["show-ref", "--verify", "refs/heads/correction/test"]
        )
        .is_err());
        assert!(remote_head(dir.path(), "origin", "correction/test")
            .unwrap()
            .is_none());
    }
    #[test]
    fn dirty_worktree_is_preserved() {
        let dir = fixture();
        let trees = tempfile::tempdir().unwrap();
        let tree = trees.path().join("linked");
        run(
            dir.path(),
            &[
                "worktree",
                "add",
                "-q",
                tree.to_str().unwrap(),
                "correction/test",
            ],
        );
        std::fs::write(tree.join("untracked"), "keep").unwrap();
        let plan = plan(dir.path(), "correction/test", None).unwrap();
        let result = remove(dir.path(), plan).unwrap();
        assert!(!result.completed && result.steps.is_empty());
        assert!(tree.exists());
        assert!(text(
            dir.path(),
            &["show-ref", "--verify", "refs/heads/correction/test"]
        )
        .is_ok());
    }
    #[test]
    fn unmerged_and_primary_branches_are_refused() {
        let dir = fixture();
        assert!(plan(dir.path(), "main", None).is_err());
        run(dir.path(), &["checkout", "-q", "correction/test"]);
        run(dir.path(), &["commit", "--allow-empty", "-qm", "Unmerged"]);
        run(dir.path(), &["checkout", "-q", "main"]);
        let unmerged = plan(dir.path(), "correction/test", None).unwrap();
        assert!(!unmerged.merged);
        assert!(remove(dir.path(), unmerged)
            .unwrap_err()
            .contains("unmerged"));
    }
    #[test]
    fn stale_confirmation_is_refused() {
        let dir = fixture();
        let plan = plan(dir.path(), "correction/test", None).unwrap();
        run(dir.path(), &["commit", "--allow-empty", "-qm", "New main"]);
        run(dir.path(), &["branch", "-f", "correction/test", "main"]);
        assert!(remove(dir.path(), plan).is_err());
    }
    #[test]
    fn absent_remote_branch_still_prunes() {
        let dir = fixture();
        let remote = tempfile::tempdir().unwrap();
        run(remote.path(), &["init", "--bare", "-q"]);
        run(
            dir.path(),
            &["remote", "add", "origin", remote.path().to_str().unwrap()],
        );
        run(dir.path(), &["push", "-q", "origin", "main"]);
        let plan = plan(dir.path(), "correction/test", Some("origin")).unwrap();
        assert!(plan.remote_head.is_none());
        let result = remove(dir.path(), plan).unwrap();
        assert!(result.completed);
        assert!(result.steps.iter().any(|step| step.contains("pruned")));
    }
    #[test]
    fn remote_access_failure_preserves_local_branch() {
        let dir = fixture();
        run(
            dir.path(),
            &["remote", "add", "origin", "/nonexistent/cerberus-remote"],
        );
        assert!(plan(dir.path(), "correction/test", Some("origin")).is_err());
        assert!(text(
            dir.path(),
            &["show-ref", "--verify", "refs/heads/correction/test"]
        )
        .is_ok());
    }
    #[test]
    fn locked_worktree_is_preserved() {
        let dir = fixture();
        let trees = tempfile::tempdir().unwrap();
        let tree = trees.path().join("locked");
        run(
            dir.path(),
            &[
                "worktree",
                "add",
                "-q",
                tree.to_str().unwrap(),
                "correction/test",
            ],
        );
        run(dir.path(), &["worktree", "lock", tree.to_str().unwrap()]);
        let result = remove(
            dir.path(),
            plan(dir.path(), "correction/test", None).unwrap(),
        )
        .unwrap();
        assert!(!result.completed && result.steps.is_empty());
        assert!(tree.exists());
    }
    #[test]
    fn unmerged_branch_requires_exact_confirmation_and_then_can_be_deleted() {
        let dir = fixture();
        run(dir.path(), &["checkout", "-q", "correction/test"]);
        run(
            dir.path(),
            &["commit", "--allow-empty", "-qm", "Alternate correction"],
        );
        run(dir.path(), &["checkout", "-q", "main"]);
        let trees = tempfile::tempdir().unwrap();
        let tree = trees.path().join("correction");
        run(
            dir.path(),
            &[
                "worktree",
                "add",
                "-q",
                tree.to_str().unwrap(),
                "correction/test",
            ],
        );
        let plan = plan(dir.path(), "correction/test", None).unwrap();
        assert!(!plan.merged);
        assert!(super::remove(dir.path(), plan.clone(), None).is_err());
        assert!(tree.exists());
        assert!(super::remove(dir.path(), plan.clone(), Some("wrong commit")).is_err());
        assert!(tree.exists());
        let head = plan.head.clone();
        let result = super::remove(dir.path(), plan, Some(&head)).unwrap();
        assert!(result.completed);
        assert!(!tree.exists());
        assert!(text(
            dir.path(),
            &["show-ref", "--verify", "refs/heads/correction/test"]
        )
        .is_err());
    }
    #[test]
    fn force_confirmation_never_forces_dirty_worktree_removal() {
        let dir = fixture();
        run(dir.path(), &["checkout", "-q", "correction/test"]);
        run(
            dir.path(),
            &["commit", "--allow-empty", "-qm", "Alternate correction"],
        );
        run(dir.path(), &["checkout", "-q", "main"]);
        let trees = tempfile::tempdir().unwrap();
        let tree = trees.path().join("dirty");
        run(
            dir.path(),
            &[
                "worktree",
                "add",
                "-q",
                tree.to_str().unwrap(),
                "correction/test",
            ],
        );
        std::fs::write(tree.join("untracked"), "preserve").unwrap();
        let plan = plan(dir.path(), "correction/test", None).unwrap();
        let head = plan.head.clone();
        let result = super::remove(dir.path(), plan, Some(&head)).unwrap();
        assert!(!result.completed && result.steps.is_empty());
        assert!(tree.exists());
        assert!(text(
            dir.path(),
            &["show-ref", "--verify", "refs/heads/correction/test"]
        )
        .is_ok());
    }
    #[test]
    fn rejected_remote_deletion_reports_partial_success() {
        let dir = fixture();
        let remote = tempfile::tempdir().unwrap();
        run(remote.path(), &["init", "--bare", "-q"]);
        run(
            dir.path(),
            &["remote", "add", "origin", remote.path().to_str().unwrap()],
        );
        run(
            dir.path(),
            &["push", "-q", "origin", "main", "correction/test"],
        );
        // Explicitly identify the bare Git directory, including when Git's
        // safe.bareRepository policy disables implicit bare-repository discovery.
        run(
            remote.path(),
            &["--git-dir", ".", "config", "receive.denyDeletes", "true"],
        );
        let result = remove(
            dir.path(),
            plan(dir.path(), "correction/test", Some("origin")).unwrap(),
        )
        .unwrap();
        assert!(!result.completed && result.error.is_some());
        assert_eq!(result.steps, vec!["Deleted local branch: correction/test"]);
        assert!(remote_head(dir.path(), "origin", "correction/test")
            .unwrap()
            .is_some());
    }
}
