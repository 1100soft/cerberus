//! Tags shared by commit history and branch presentation; reads never change refs.
use std::{collections::HashMap, path::Path, process::Command};
pub fn by_commit(repo: &Path) -> Result<HashMap<String, Vec<String>>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["show-ref", "--tags", "--dereference"])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(String::from_utf8_lossy(&output.stderr).into());
    }
    let mut tags: HashMap<String, Vec<String>> = HashMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Some((sha, reference)) = line.split_once(' ') else {
            continue;
        };
        let Some(name) = reference.strip_prefix("refs/tags/") else {
            continue;
        };
        tags.entry(sha.into())
            .or_default()
            .push(name.strip_suffix("^{}").unwrap_or(name).into());
    }
    for names in tags.values_mut() {
        names.sort();
        names.dedup();
    }
    Ok(tags)
}
/// Git describe's nearest reachable tag, including lightweight tags.
pub fn latest(repo: &Path, branch: &str) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args([
            "describe",
            "--tags",
            "--abbrev=0",
            &format!("refs/heads/{branch}"),
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn annotated_and_lightweight_tags_follow_branch_ancestry() {
        let repo = tempfile::tempdir().unwrap();
        let git = crate::git::GitService::default();
        let path = repo.path();
        for args in [
            vec!["init", "-b", "main"],
            vec!["config", "user.name", "Test"],
            vec!["config", "user.email", "test@example.test"],
            vec!["commit", "--allow-empty", "-m", "base"],
        ] {
            git.mutate(path, &args).unwrap();
        }
        assert!(by_commit(path).unwrap().is_empty());
        assert_eq!(latest(path, "main"), None);
        git.mutate(path, &["tag", "v1"]).unwrap();
        git.mutate(path, &["tag", "-a", "release/base", "-m", "annotated"])
            .unwrap();
        let head = git.text(path, &["rev-parse", "HEAD"]).unwrap();
        assert_eq!(by_commit(path).unwrap()[&head], vec!["release/base", "v1"]);
        git.mutate(path, &["branch", "older"]).unwrap();
        git.mutate(path, &["commit", "--allow-empty", "-m", "next"])
            .unwrap();
        git.mutate(path, &["tag", "-a", "v2", "-m", "release"])
            .unwrap();
        git.mutate(path, &["commit", "--allow-empty", "-m", "after release"])
            .unwrap();
        assert_eq!(latest(path, "main").as_deref(), Some("v2"));
        assert_ne!(latest(path, "older").as_deref(), Some("v2"));
        let history = git.history(path, Some("main"), 0).unwrap();
        assert!(history[0].tags.is_empty());
        assert_eq!(history[1].tags, vec!["v2"]);
        assert_eq!(history[2].tags, vec!["release/base", "v1"]);
    }
}
