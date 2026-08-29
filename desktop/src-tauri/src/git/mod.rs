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
