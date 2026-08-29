use crate::{
    git::{canonical_remote, host_type, GitService},
    models::{Identity, Repository, RepositoryUpdate},
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;

pub struct Database {
    connection: Mutex<Connection>,
    pub device_id: String,
}

impl Database {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection
            .execute_batch(include_str!("../../../migrations/0001_initial.sql"))
            .map_err(|e| e.to_string())?;
        let device_id = device_id(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
            device_id,
        })
    }

    pub fn import(&self, git: &GitService, input: &Path) -> Result<String, String> {
        let root = git.root(input).map_err(|e| e.to_string())?;
        let remote = git.remote_url(&root);
        let canonical = remote.as_deref().map(canonical_remote);
        let id = Uuid::new_v4().to_string();
        let name = root
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("Repository path has no valid name")?;
        let now = Utc::now().to_rfc3339();
        let conn = self.connection.lock().map_err(|e| e.to_string())?;
        let existing: Option<String> = conn.query_row("SELECT r.id FROM repositories r JOIN repository_devices d ON d.repository_id=r.id WHERE d.device_id=?1 AND d.local_path=?2", params![self.device_id, root.to_string_lossy()], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
        if let Some(existing) = existing {
            return Ok(existing);
        }
        conn.execute("INSERT INTO repositories(id,display_name,canonical_remote,host_type,manual_order,created_at,updated_at) VALUES(?1,?2,?3,?4,(SELECT COUNT(*) FROM repositories),?5,?5)", params![id, name, canonical, host_type(remote.as_deref()), now]).map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO repository_devices(repository_id,device_id,local_path,availability) VALUES(?1,?2,?3,'available')", params![id, self.device_id, root.to_string_lossy()]).map_err(|e| e.to_string())?;
        Ok(id)
    }

    pub fn repository_path(&self, id: &str) -> Result<PathBuf, String> {
        self.connection
            .lock()
            .map_err(|e| e.to_string())?
            .query_row(
                "SELECT local_path FROM repository_devices WHERE repository_id=?1 AND device_id=?2",
                params![id, self.device_id],
                |r| r.get::<_, String>(0),
            )
            .map(PathBuf::from)
            .map_err(|e| e.to_string())
    }

    pub fn identities(&self) -> Result<Vec<Identity>, String> {
        let conn = self.connection.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn.prepare("SELECT id,label,git_name,git_email,provider_username FROM identities ORDER BY label COLLATE NOCASE").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Identity {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    git_name: row.get(2)?,
                    git_email: row.get(3)?,
                    color: Some("#8b7cf6".into()),
                    provider_username: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn save_github_identity(
        &self,
        login: &str,
        name: &str,
        email: &str,
    ) -> Result<Identity, String> {
        let conn = self.connection.lock().map_err(|e| e.to_string())?;
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM identities WHERE provider_type='github' AND provider_username=?1",
                [login],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let id = existing.unwrap_or_else(|| Uuid::new_v4().to_string());
        conn.execute("INSERT INTO identities(id,label,git_name,git_email,provider_type,provider_username) VALUES(?1,?2,?3,?4,'github',?5) ON CONFLICT(id) DO UPDATE SET label=excluded.label,git_name=excluded.git_name,git_email=excluded.git_email,provider_username=excluded.provider_username", params![id, login, name, email, login]).map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO device_identity_bindings(identity_id,device_id,credential_reference) VALUES(?1,?2,?3) ON CONFLICT(identity_id,device_id) DO UPDATE SET credential_reference=excluded.credential_reference", params![id,self.device_id,format!("keyring:github:{id}")]).map_err(|e| e.to_string())?;
        Ok(Identity {
            id,
            label: login.into(),
            git_name: name.into(),
            git_email: email.into(),
            color: Some("#8b7cf6".into()),
            provider_username: Some(login.into()),
        })
    }

    pub fn assign_identity(&self, repository_id: &str, identity_id: &str) -> Result<(), String> {
        if identity_id.trim().is_empty() {
            return self.unassign_identity(repository_id);
        }
        self.connection.lock().map_err(|e|e.to_string())?.execute("INSERT INTO repository_identity(repository_id,identity_id) VALUES(?1,?2) ON CONFLICT(repository_id) DO UPDATE SET identity_id=excluded.identity_id",params![repository_id,identity_id]).map_err(|e|e.to_string())?;
        Ok(())
    }

    pub fn unassign_identity(&self, repository_id: &str) -> Result<(), String> {
        self.connection
            .lock()
            .map_err(|e| e.to_string())?
            .execute("DELETE FROM repository_identity WHERE repository_id=?1", [repository_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_remote(
        &self,
        id: &str,
        canonical_remote: Option<&str>,
        host: &str,
    ) -> Result<(), String> {
        self.connection
            .lock()
            .map_err(|e| e.to_string())?
            .execute(
                "UPDATE repositories SET canonical_remote=?1, host_type=?2, updated_at=?3 WHERE id=?4",
                params![canonical_remote, host, Utc::now().to_rfc3339(), id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update(&self, id: &str, git: &GitService, update: RepositoryUpdate) -> Result<(), String> {
        let display_name = update.display_name.trim();
        if display_name.is_empty() {
            return Err("Display name is required".into());
        }
        let host_type = match update.host_type.as_str() {
            value @ ("github" | "gitlab" | "bitbucket" | "local" | "custom") => value,
            _ => return Err("Unsupported host type".into()),
        };
        let root = git.root(Path::new(&update.local_path)).map_err(|e| e.to_string())?;
        let requested_remote = update
            .canonical_remote
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        git.apply_origin(&root, requested_remote)
            .map_err(|e| e.to_string())?;
        let remote = requested_remote.map(canonical_remote);
        let default_branch = update
            .default_branch
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let tags: Vec<String> = {
            let mut seen = std::collections::HashSet::new();
            update
                .tags
                .into_iter()
                .map(|tag| tag.trim().to_string())
                .filter(|tag| !tag.is_empty() && seen.insert(tag.to_lowercase()))
                .collect()
        };
        let now = Utc::now().to_rfc3339();
        let mut conn = self.connection.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let changed = tx
            .execute(
                "UPDATE repositories SET display_name=?1, canonical_remote=?2, host_type=?3, default_branch=?4, updated_at=?5 WHERE id=?6",
                params![display_name, remote, host_type, default_branch, now, id],
            )
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("Repository not found".into());
        }
        tx.execute(
            "UPDATE repository_devices SET local_path=?1 WHERE repository_id=?2 AND device_id=?3",
            params![root.to_string_lossy(), id, self.device_id],
        )
        .map_err(|e| e.to_string())?;
        match update.identity_id.as_deref().filter(|value| !value.is_empty()) {
            Some(identity_id) => {
                tx.execute(
                    "INSERT INTO repository_identity(repository_id,identity_id) VALUES(?1,?2) ON CONFLICT(repository_id) DO UPDATE SET identity_id=excluded.identity_id",
                    params![id, identity_id],
                )
                .map_err(|e| e.to_string())?;
            }
            None => {
                tx.execute("DELETE FROM repository_identity WHERE repository_id=?1", [id])
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.execute("DELETE FROM repository_tags WHERE repository_id=?1", [id])
            .map_err(|e| e.to_string())?;
        for name in tags {
            tx.execute(
                "INSERT INTO tags(id,name) VALUES(?1,?2) ON CONFLICT(name) DO NOTHING",
                params![Uuid::new_v4().to_string(), name],
            )
            .map_err(|e| e.to_string())?;
            let tag_id: String = tx
                .query_row("SELECT id FROM tags WHERE name=?1", [&name], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO repository_tags(repository_id,tag_id) VALUES(?1,?2)",
                params![id, tag_id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let changed = self
            .connection
            .lock()
            .map_err(|e| e.to_string())?
            .execute("DELETE FROM repositories WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("Repository not found".into());
        }
        Ok(())
    }

    pub fn save_snapshot(&self, id: &str, repo: &Repository) -> Result<(), String> {
        self.connection.lock().map_err(|e| e.to_string())?.execute("INSERT INTO repository_snapshots(repository_id,branch,detached,staged_count,modified_count,untracked_count,ahead,behind,last_commit_summary,last_commit_at,scanned_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(repository_id) DO UPDATE SET branch=excluded.branch,detached=excluded.detached,staged_count=excluded.staged_count,modified_count=excluded.modified_count,untracked_count=excluded.untracked_count,ahead=excluded.ahead,behind=excluded.behind,last_commit_summary=excluded.last_commit_summary,last_commit_at=excluded.last_commit_at,scanned_at=excluded.scanned_at", params![id,repo.branch,repo.detached,repo.staged_count,repo.modified_count,repo.untracked_count,repo.ahead,repo.behind,repo.last_commit_summary,repo.last_commit_at,Utc::now().to_rfc3339()]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<Repository>, String> {
        let conn = self.connection.lock().map_err(|e| e.to_string())?;
        let mut repositories = {
            let mut stmt = conn.prepare("SELECT r.id,r.display_name,d.local_path,r.canonical_remote,r.host_type,r.default_branch,r.manual_order,s.branch,COALESCE(s.detached,0),COALESCE(s.staged_count,0),COALESCE(s.modified_count,0),COALESCE(s.untracked_count,0),COALESCE(s.ahead,0),COALESCE(s.behind,0),s.last_commit_summary,s.last_commit_at,i.id,i.label,i.git_name,i.git_email,i.provider_username FROM repositories r JOIN repository_devices d ON d.repository_id=r.id AND d.device_id=?1 LEFT JOIN repository_snapshots s ON s.repository_id=r.id LEFT JOIN repository_identity ri ON ri.repository_id=r.id LEFT JOIN identities i ON i.id=ri.identity_id ORDER BY r.manual_order,r.display_name").map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([&self.device_id], |row| {
                    let identity_id: Option<String> = row.get(16)?;
                    Ok(Repository {
                        id: row.get(0)?,
                        display_name: row.get(1)?,
                        local_path: row.get(2)?,
                        canonical_remote: row.get(3)?,
                        host_type: row.get(4)?,
                        default_branch: row.get(5)?,
                        manual_order: row.get(6)?,
                        branch: row.get(7)?,
                        detached: row.get::<_, i64>(8)? != 0,
                        staged_count: row.get(9)?,
                        modified_count: row.get(10)?,
                        untracked_count: row.get(11)?,
                        ahead: row.get(12)?,
                        behind: row.get(13)?,
                        last_commit_summary: row.get(14)?,
                        last_commit_at: row.get(15)?,
                        identity: identity_id.map(|id| Identity {
                            id,
                            label: row.get(17).unwrap_or_default(),
                            git_name: row.get(18).unwrap_or_default(),
                            git_email: row.get(19).unwrap_or_default(),
                            color: None,
                            provider_username: row.get(20).ok(),
                        }),
                        identity_mismatch: false,
                        tags: Vec::new(),
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        let mut tag_stmt = conn
            .prepare("SELECT rt.repository_id, t.name FROM repository_tags rt JOIN tags t ON t.id=rt.tag_id ORDER BY t.name COLLATE NOCASE")
            .map_err(|e| e.to_string())?;
        let tag_rows = tag_stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut tags: HashMap<String, Vec<String>> = HashMap::new();
        for row in tag_rows {
            let (repository_id, name) = row.map_err(|e| e.to_string())?;
            tags.entry(repository_id).or_default().push(name);
        }
        for repository in &mut repositories {
            repository.tags = tags.remove(&repository.id).unwrap_or_default();
        }
        Ok(repositories)
    }

    pub fn reorder(&self, ids: &[String]) -> Result<(), String> {
        let mut conn = self.connection.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for (position, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE repositories SET manual_order=?1 WHERE id=?2",
                params![position as i64, id],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }
}

fn device_id(conn: &Connection) -> Result<String, String> {
    if let Some(id) = conn
        .query_row("SELECT id FROM devices LIMIT 1", [], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?
    {
        return Ok(id);
    }
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO devices(id,label,platform,last_seen_at) VALUES(?1,?2,?3,?4)",
        params![
            id,
            "This device",
            std::env::consts::OS,
            Utc::now().to_rfc3339()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}
