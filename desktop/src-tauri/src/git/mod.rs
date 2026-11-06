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

    /// User-requested checkout only: never carry edits across branches or force.
    pub fn change_branch(&self, repo: &Path, branch: &str, create: bool, base: &str) -> Result<(), String> {
        let _sync=crate::awake::try_explicit_change().ok_or("Another branch update is in progress. Retry shortly.")?;
        if branch.starts_with('-') || branch.contains("@{") { return Err("Invalid branch name".into()); }
        self.text(repo, &["check-ref-format", "--branch", branch]).map_err(|e| e.to_string())?;
        if !self.text(repo, &["status", "--porcelain", "--untracked-files=all"]).map_err(|e| e.to_string())?.is_empty() {
            return Err("Commit or stash pending changes before switching branches".into());
        }
        for marker in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "BISECT_LOG"] {
            let path=self.text(repo, &["rev-parse", "--git-path", marker]).map_err(|e|e.to_string())?;
            let path=PathBuf::from(path);
            if (if path.is_absolute(){path}else{repo.join(path)}).exists(){return Err("Finish the current Git operation first".into());}
        }
        if create {
            let reference=format!("refs/heads/{base}");
            let hash=match self.text(repo, &["rev-parse", "--verify", "--end-of-options", &format!("{reference}^{{commit}}")]) {
                Ok(hash)=>hash,
                Err(error)=>{
                    // A new repository has a symbolic HEAD but no branch ref yet.
                    if self.text(repo,&["symbolic-ref","-q","HEAD"]).ok().as_deref()==Some(reference.as_str())
                        && self.text(repo,&["show-ref","--verify",&reference]).is_err() {
                        return Err(format!("Create the first commit on {base} before creating another branch. Without a commit, Git can only change the initial branch name."));
                    }
                    return Err(error.to_string());
                }
            };
            self.mutate(repo, &["switch", "-c", branch, &hash]).map_err(|e| e.to_string())
        } else {
            self.text(repo, &["show-ref", "--verify", &format!("refs/heads/{branch}")]).map_err(|e|e.to_string())?;
            self.mutate(repo, &["switch", "--no-guess", branch]).map_err(|e| e.to_string())
        }
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
        let tags=crate::git_tags::by_commit(repo).map_err(GitError::Command)?;
        Ok(fields.chunks_exact(5).map(|fields| crate::models::Commit {
            tags: tags.get(fields[0]).cloned().unwrap_or_default(),
            hash: fields[0].into(), author: fields[1].into(), email: fields[2].into(),
            committed_at: fields[3].into(), summary: fields[4].into(),
        }).collect())
    }

    pub fn init(&self, path: &Path, branch: &str) -> Result<(), GitError> {
        let checked=Command::new("git").args(["check-ref-format","--branch",branch]).output()?;
        if !checked.status.success(){return Err(GitError::Command("Invalid initial branch name".into()));}
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
    fn creating_before_first_commit_preserves_initial_branch() {
        let _test=crate::awake::TEST_ACTIVITY_LOCK.lock().unwrap();
        let dir=tempfile::tempdir().unwrap();let git=GitService::default();
        git.init(dir.path(),"main").unwrap();
        let _other=crate::awake::acquire();
        assert!(git.change_branch(dir.path(),"first",true,"main").unwrap_err().contains("first commit"));
        assert_eq!(git.text(dir.path(),&["branch","--show-current"]).unwrap(),"main");
        assert!(git.history(dir.path(),None,0).unwrap().is_empty());
    }
    #[test]
    fn checkout_actions_preserve_dirty_and_other_worktrees() {
        let _test=crate::awake::TEST_ACTIVITY_LOCK.lock().unwrap();
        let dir=tempfile::tempdir().unwrap();let git=GitService::default();let path=dir.path();
        git.init(path,"main").unwrap();
        git.text(path,&["config","user.name","Test"]).unwrap();
        git.text(path,&["config","user.email","test@example.test"]).unwrap();
        git.mutate(path,&["commit","--allow-empty","-m","initial"]).unwrap();
        git.change_branch(path,"feature/test",true,"main").unwrap();
        assert_eq!(git.text(path,&["branch","--show-current"]).unwrap(),"feature/test");
        git.change_branch(path,"main",false,"").unwrap();
        std::fs::write(path.join("pending"),"preserve").unwrap();
        assert!(git.change_branch(path,"feature/test",false,"").unwrap_err().contains("pending"));
        assert!(git.change_branch(path,"new",true,"main").is_err());
        std::fs::remove_file(path.join("pending")).unwrap();
        let linked=tempfile::tempdir().unwrap();let worktree=linked.path().join("worktree");
        git.mutate(path,&["worktree","add",worktree.to_str().unwrap(),"feature/test"]).unwrap();
        assert!(git.change_branch(path,"feature/test",false,"").is_err());
        assert_eq!(git.text(path,&["branch","--show-current"]).unwrap(),"main");
        assert!(git.change_branch(path,"-bad",true,"main").is_err());
        assert!(git.change_branch(path,"main",true,"main").is_err());
        assert!(git.change_branch(path,"new",true,"missing").is_err());
    }
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
