use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::{Arc, Mutex},
};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GitError {
    #[error("Git is not installed or could not be started: {0}")]
    Io(#[from] std::io::Error),
    #[error("Git command failed: {0}")]
    Command(String),
    #[error("Path is not a Git repository: {0}")]
    NotRepository(String),
}

#[derive(Clone, Default)]
pub struct GitService {
    locks: Arc<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>>,
}

impl GitService {
    fn output(&self, repo: &Path, args: &[&str]) -> Result<Output, GitError> {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()?;
        if output.status.success() {
            Ok(output)
        } else {
            Err(GitError::Command(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ))
        }
    }

    pub fn text(&self, repo: &Path, args: &[&str]) -> Result<String, GitError> {
        Ok(String::from_utf8_lossy(&self.output(repo, args)?.stdout)
            .trim()
            .to_owned())
    }

    pub fn root(&self, path: &Path) -> Result<PathBuf, GitError> {
        let root = self
            .text(path, &["rev-parse", "--show-toplevel"])
            .map_err(|_| GitError::NotRepository(path.display().to_string()))?;
        Ok(PathBuf::from(root))
    }

    pub fn mutate(&self, repo: &Path, args: &[&str]) -> Result<(), GitError> {
        let lock = {
            let mut locks = self.locks.lock().expect("repository lock map poisoned");
            locks.entry(repo.to_path_buf()).or_default().clone()
        };
        let _guard = lock.lock().expect("repository lock poisoned");
        self.output(repo, args).map(|_| ())
    }

    pub fn branches(&self, repo: &Path) -> Result<Vec<String>, GitError> {
        Ok(self.text(repo, &["for-each-ref", "--format=%(refname:strip=2)", "refs/heads/"])?
            .lines().map(str::to_owned).collect())
    }

    pub fn history(&self, repo: &Path, branch: Option<&str>, skip: u32) -> Result<Vec<crate::models::Commit>, GitError> {
        let revision = branch.map(|name| format!("refs/heads/{name}")).unwrap_or_else(|| "HEAD".into());
        // An unborn branch has no commits; other resolution failures remain errors.
        let resolved = self.text(repo, &["rev-parse", "--verify", "--end-of-options", &format!("{revision}^{{commit}}")]);
        let hash = match resolved {
            Ok(hash) => hash,
            Err(error) => {
                let head = self.text(repo, &["symbolic-ref", "-q", "HEAD"]).ok();
                if head.as_deref().is_some_and(|head| revision == "HEAD" || head == revision)
                    && self.text(repo, &["show-ref", "--verify", head.as_deref().unwrap()]).is_err() {
                    return Ok(Vec::new());
                }
                return Err(error);
            }
        };
        let output = self.output(repo, &["log", "--date-order", "--max-count=50", &format!("--skip={skip}"), "--format=%H%x00%an%x00%ae%x00%cI%x00%s", "-z", &hash, "--"])?;
        let text = String::from_utf8_lossy(&output.stdout);
        let fields: Vec<_> = text.split_terminator('\0').collect();
        Ok(fields.chunks_exact(5).map(|fields| crate::models::Commit {
            hash: fields[0].into(), author: fields[1].into(), email: fields[2].into(),
            committed_at: fields[3].into(), summary: fields[4].into(),
        }).collect())
    }

    pub fn init(&self, path: &Path, branch: &str) -> Result<(), GitError> {
        std::fs::create_dir_all(path)?;
        let with_branch = Command::new("git")
            .args(["init", "-b", branch])
            .current_dir(path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()?;
        if with_branch.status.success() {
            return Ok(());
        }
        let init = Command::new("git")
            .arg("init")
            .current_dir(path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()?;
        if !init.status.success() {
            return Err(GitError::Command(
                String::from_utf8_lossy(&init.stderr).trim().to_owned(),
            ));
        }
        let _ = Command::new("git")
            .args(["symbolic-ref", "HEAD", &format!("refs/heads/{branch}")])
            .current_dir(path)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output();
        Ok(())
    }

    pub fn remote_url(&self, repo: &Path) -> Option<String> {
        self.text(repo, &["remote", "get-url", "origin"])
            .ok()
            .filter(|s| !s.is_empty())
    }

    pub fn apply_origin(&self, repo: &Path, remote: Option<&str>) -> Result<(), GitError> {
        let current = self.remote_url(repo);
        match (remote.map(str::trim).filter(|value| !value.is_empty()), current.as_deref()) {
            (None, None) => Ok(()),
            (None, Some(_)) => self.mutate(repo, &["remote", "remove", "origin"]),
            (Some(url), None) => self.mutate(repo, &["remote", "add", "origin", url]),
            (Some(url), Some(existing)) if existing == url => Ok(()),
            (Some(url), Some(_)) => self.mutate(repo, &["remote", "set-url", "origin", url]),
        }
    }
}

pub fn canonical_remote(remote: &str) -> String {
    let trimmed = remote.trim_end_matches('/').trim_end_matches(".git");
    if let Some(rest) = trimmed.strip_prefix("git@") {
        if let Some((host, path)) = rest.split_once(':') {
            return format!("https://{host}/{path}");
        }
    }
    if let Some(rest) = trimmed.strip_prefix("ssh://git@") {
        return format!("https://{rest}");
    }
    trimmed.to_owned()
}

pub fn host_type(remote: Option<&str>) -> &'static str {
    match remote.unwrap_or_default() {
        value if value.contains("github.com") => "github",
        value if value.contains("gitlab.com") => "gitlab",
        value if value.contains("bitbucket.org") => "bitbucket",
        "" => "local",
        _ => "custom",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn branch_history_preserves_worktree() {
        let dir = tempfile::tempdir().unwrap();
        let git = GitService::default();
        let path = dir.path();
        git.init(path, "main").unwrap();
        assert!(git.history(path, Some("main"), 0).unwrap().is_empty());
        git.text(path, &["config", "user.name", "Test Author"]).unwrap();
        git.text(path, &["config", "user.email", "test@example.com"]).unwrap();
        std::fs::write(path.join("file.txt"), "main").unwrap();
        git.mutate(path, &["add", "file.txt"]).unwrap();
        git.mutate(path, &["commit", "-m", "Initial commit"]).unwrap();
        git.mutate(path, &["branch", "feature/test"]).unwrap();
        git.mutate(path, &["switch", "feature/test"]).unwrap();
        std::fs::write(path.join("file.txt"), "feature").unwrap();
        git.mutate(path, &["commit", "-am", "Feature commit"]).unwrap();
        let history = git.history(path, Some("feature/test"), 0).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].summary, "Feature commit");
        assert_eq!(history[1].author, "Test Author");
        assert_eq!(git.history(path, Some("main"), 0).unwrap().len(), 1);
        assert_eq!(git.history(path, None, 1).unwrap()[0].summary, "Initial commit");
        assert!(git.history(path, Some("missing"), 0).is_err());
        assert_eq!(git.branches(path).unwrap(), vec!["feature/test", "main"]);
        std::fs::write(path.join("file.txt"), "unsaved changes").unwrap();
        let head_before = git.text(path, &["rev-parse", "HEAD"]).unwrap();
        let status_before = git.text(path, &["status", "--porcelain=v2"]).unwrap();
        let main_history = git.history(path, Some("main"), 0).unwrap();
        assert_eq!(main_history[0].summary, "Initial commit");
        assert_eq!(git.text(path, &["rev-parse", "HEAD"]).unwrap(), head_before);
        assert_eq!(git.text(path, &["status", "--porcelain=v2"]).unwrap(), status_before);
        assert_eq!(std::fs::read_to_string(path.join("file.txt")).unwrap(), "unsaved changes");
        assert_eq!(git.text(path, &["branch", "--show-current"]).unwrap(), "feature/test");
    }

    #[test]
    fn canonicalizes_scp_remote() {
        assert_eq!(
            canonical_remote("git@github.com:openai/example.git"),
            "https://github.com/openai/example"
        );
    }
    #[test]
    fn recognizes_hosts() {
        assert_eq!(host_type(Some("ssh://git@gitlab.com/a/b")), "gitlab");
        assert_eq!(host_type(None), "local");
    }

    #[test]
    fn apply_origin_updates_without_polling() {
        let dir = tempfile::tempdir().unwrap();
        let git = GitService::default();
        git.init(dir.path(), "main").unwrap();
        git.apply_origin(dir.path(), Some("git@github.com:acme/app.git"))
            .unwrap();
        assert_eq!(
            git.remote_url(dir.path()).as_deref(),
            Some("git@github.com:acme/app.git")
        );
        git.apply_origin(dir.path(), Some("https://github.com/acme/app.git"))
            .unwrap();
        assert_eq!(
            git.remote_url(dir.path()).as_deref(),
            Some("https://github.com/acme/app.git")
        );
        git.apply_origin(dir.path(), None).unwrap();
        assert_eq!(git.remote_url(dir.path()), None);
    }
}
