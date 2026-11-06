use crate::{
    db::Database,
    git::GitService,
    github,
    models::{ImportResult, Repository, RepositoryUpdate},
    scan,
};
use std::path::PathBuf;

fn snapshot(db: &Database, git: &GitService, id: &str) -> Result<Repository, String> {
    let repository = db
        .list()?
        .into_iter()
        .find(|repository| repository.id == id)
        .ok_or("Repository not found")?;
    let repository = scan(git, repository)?;
    db.save_snapshot(id, &repository)?;
    Ok(repository)
}
fn plan(db: &Database, update: &RepositoryUpdate) -> Result<Option<github::CreationPlan>, String> {
    match &update.github_create {
        Some(options) => {
            if update.host_type != "github" {
                return Err("Remote creation is available for GitHub repositories only.".into());
            }
            Ok(Some(github::prepare_creation(
                db,
                update.identity_id.as_deref().unwrap_or(""),
                update.canonical_remote.as_deref().unwrap_or(""),
                options.private,
            )?))
        }
        None => {
            github::ensure_identity_access(
                update.identity_id.as_deref().unwrap_or(""),
                update.canonical_remote.as_deref(),
            )?;
            Ok(None)
        }
    }
}
pub fn configure(
    db: &Database,
    git: &GitService,
    id: &str,
    mut update: RepositoryUpdate,
) -> Result<Repository, String> {
    // Validate the checkout before any remote write.
    git.root(std::path::Path::new(&update.local_path))
        .map_err(|error| error.to_string())?;
    db.repository_path(id)?;
    let created = if let Some(plan) = plan(db, &update)? {
        let remote = plan.create()?;
        update.canonical_remote = Some(remote.clone());
        Some(remote)
    } else {
        None
    };
    db.update(id,git,update).map_err(|error|match &created{Some(remote)=>format!("GitHub repository created at {remote}, but local linking failed: {error}. Turn off remote creation and save again to link it."),None=>error})?;
    snapshot(db, git, id)
}
pub fn create(
    db: &Database,
    git: &GitService,
    update: RepositoryUpdate,
) -> Result<ImportResult, String> {
    if update.display_name.trim().is_empty() {
        return Err("Display name is required".into());
    }
    let path = PathBuf::from(update.local_path.trim());
    if path.as_os_str().is_empty() {
        return Err("Local path is required".into());
    }
    if git.root(&path).is_ok() {
        return Err("That folder is already a Git repository. Import it instead.".into());
    }
    if !["github", "gitlab", "bitbucket", "local", "custom"].contains(&update.host_type.as_str()) {
        return Err("Unsupported host type".into());
    }
    if let Some(id) = &update.identity_id {
        if !id.is_empty() && !db.identities()?.iter().any(|identity| &identity.id == id) {
            return Err("Identity not found".into());
        }
    }
    let remote = plan(db, &update)?
        .map(|plan| Box::new(move || plan.create()) as Box<dyn FnOnce() -> Result<String, String>>);
    create_prepared(db, git, update, remote)
}
fn initial_commit(
    db: &Database,
    git: &GitService,
    path: &std::path::Path,
    identity_id: Option<&str>,
) -> Result<(), String> {
    if git.text(path, &["rev-parse", "--verify", "HEAD"]).is_ok() {
        return Err("Repository already has a commit".into());
    }
    let identity = db
        .identities()?
        .into_iter()
        .find(|identity| Some(identity.id.as_str()) == identity_id);
    // An empty-tree commit never stages existing project files or secrets.
    let tree = git.text(path, &["mktree"]).map_err(|e| e.to_string())?;
    let mut args = Vec::new();
    if let Some(identity) = identity {
        args.extend([
            "-c".to_owned(),
            format!("user.name={}", identity.git_name),
            "-c".into(),
            format!("user.email={}", identity.git_email),
        ]);
    }
    args.extend([
        "commit-tree".into(),
        tree,
        "-m".into(),
        "Initial commit".into(),
    ]);
    let args = args.iter().map(String::as_str).collect::<Vec<_>>();
    let hash=git.text(path,&args).map_err(|e|format!("Could not create initial commit. Choose a Git identity or configure Git user.name and user.email: {e}"))?;
    git.mutate(path, &["update-ref", "HEAD", &hash, ""])
        .map_err(|e| e.to_string())
}
fn create_prepared(
    db: &Database,
    git: &GitService,
    mut update: RepositoryUpdate,
    remote: Option<Box<dyn FnOnce() -> Result<String, String>>>,
) -> Result<ImportResult, String> {
    let path = PathBuf::from(update.local_path.trim());
    let branch = update
        .default_branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("main");
    git.init(&path, branch).map_err(|error| error.to_string())?;
    let id = db.import(git, &path)?;
    let mut warnings = Vec::new();
    let mut local = update.clone();
    local.canonical_remote = None;
    local.github_create = None;
    db.update(&id, git, local)?;
    if let Err(error) = initial_commit(db, git, &path, update.identity_id.as_deref()) {
        warnings.push(format!(
            "Local repository preserved; {error} No remote repository was created."
        ));
        return Ok(ImportResult {
            repository: snapshot(db, git, &id)?,
            warnings,
        });
    }

    if let Some(create_remote) = remote {
        match create_remote() {
            Ok(remote) => update.canonical_remote = Some(remote),
            Err(error) => {
                warnings.push(format!("Local repository preserved; {error} Configure this repository to retry remote creation or link an existing remote."));
                return Ok(ImportResult {
                    repository: snapshot(db, git, &id)?,
                    warnings,
                });
            }
        }
    }
    if let Err(error) = db.update(&id, git, update) {
        warnings.push(format!("Repository initialized but configuration could not be completed: {error}. Configure it to finish linking."));
    }
    Ok(ImportResult {
        repository: snapshot(db, git, &id)?,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn update(path: &std::path::Path) -> RepositoryUpdate {
        RepositoryUpdate {
            github_create: None,
            display_name: "New repo".into(),
            local_path: path.to_string_lossy().into(),
            canonical_remote: None,
            host_type: "local".into(),
            default_branch: Some("main".into()),
            identity_id: None,
            tags: vec![],
        }
    }
    #[test]
    fn failed_remote_keeps_local_files_and_identity() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("app");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("notes.txt"), "keep me").unwrap();
        let db = Database::open(root.path().join("app.db")).unwrap();
        let git = GitService::default();
        let identity = db
            .save_github_identity("owner", "Owner", "owner@example.test")
            .unwrap();
        let mut data = update(&path);
        data.host_type = "github".into();
        data.identity_id = Some(identity.id.clone());
        data.canonical_remote = Some("https://github.com/owner/new.git".into());
        let result =
            create_prepared(&db, &git, data, Some(Box::new(|| Err("HTTP 403".into())))).unwrap();
        assert!(result.warnings[0].contains("Local repository preserved"));
        assert_eq!(result.repository.identity.unwrap().id, identity.id);
        assert!(result.repository.canonical_remote.is_none());
        assert!(git.remote_url(&path).is_none());
        assert_eq!(
            std::fs::read_to_string(path.join("notes.txt")).unwrap(),
            "keep me"
        );
        assert_eq!(db.list().unwrap().len(), 1);
        assert!(git
            .text(&path, &["ls-tree", "--name-only", "HEAD"])
            .unwrap()
            .is_empty());
        assert!(git
            .text(&path, &["status", "--porcelain"])
            .unwrap()
            .contains("notes.txt"));
    }
    #[test]
    fn created_remote_has_empty_initial_commit_without_push() {
        let _test = crate::awake::TEST_ACTIVITY_LOCK.lock().unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("app");
        let db = Database::open(root.path().join("app.db")).unwrap();
        let git = GitService::default();
        let mut data = update(&path);
        data.host_type = "github".into();
        data.identity_id = Some(
            db.save_github_identity("owner", "Owner", "owner@example.test")
                .unwrap()
                .id,
        );
        let result = create_prepared(
            &db,
            &git,
            data,
            Some(Box::new(|| Ok("https://github.com/owner/new.git".into()))),
        )
        .unwrap();
        assert!(result.warnings.is_empty());
        assert_eq!(
            git.remote_url(&path).as_deref(),
            Some("https://github.com/owner/new.git")
        );
        let commits = git.history(&path, None, 0).unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].summary, "Initial commit");
        git.change_branch(&path, "wip", true, "main").unwrap();
        assert_eq!(git.branches(&path).unwrap(), vec!["main", "wip"]);
    }
    #[test]
    fn invalid_branch_does_not_initialize_a_checkout() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("app");
        let db = Database::open(root.path().join("app.db")).unwrap();
        let git = GitService::default();
        let mut data = update(&path);
        data.default_branch = Some("invalid branch".into());
        assert!(create(&db, &git, data).is_err());
        assert!(!path.exists());
        assert!(db.list().unwrap().is_empty());
    }
}
