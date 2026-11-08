//! Filesystem hints for external agent activity. Never read credentials or emit file contents.
use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::mpsc,
    time::{Duration, Instant},
};
use tauri::Emitter;
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Hint {
    provider: &'static str,
    repository_path: Option<String>,
    thread_id: Option<String>,
    working: Option<bool>,
}

fn provider(event: &Event) -> Option<&'static str> {
    if !matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    ) {
        return None;
    }
    for path in &event.paths {
        let name = path.file_name()?.to_string_lossy();
        if name == "state.vscdb" || name == "state.vscdb-wal" {
            return Some("cursor");
        }
        if name.ends_with(".jsonl") {
            return Some("codex");
        }
    }
    None
}
fn roots(data: &Path) -> Vec<(PathBuf, RecursiveMode)> {
    let mut paths = vec![(data.join("agent-homes"), RecursiveMode::Recursive)];
    if let Ok(home) = crate::agent_sessions::codex_home() {
        paths.extend([
            (home.clone(), RecursiveMode::NonRecursive),
            (home.join("sessions"), RecursiveMode::Recursive),
            (home.join("archived_sessions"), RecursiveMode::Recursive),
        ]);
    }
    if let Ok(history) = crate::agent_sessions::shared_history_home() {
        paths.push((history, RecursiveMode::NonRecursive));
    }
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home = PathBuf::from(home);
        let config = if cfg!(target_os = "macos") {
            home.join("Library/Application Support")
        } else if cfg!(windows) {
            std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join("AppData/Roaming"))
        } else {
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config"))
        };
        paths.extend([
            (
                config.join("Cursor/User/globalStorage"),
                RecursiveMode::NonRecursive,
            ),
            (
                config.join("Cursor/User/workspaceStorage"),
                RecursiveMode::Recursive,
            ),
        ]);
    }
    paths
}
pub fn start(app: tauri::AppHandle, data: PathBuf) {
    std::thread::spawn(move || {
        let (send, receive) = mpsc::channel();
        let Ok(mut watcher) = notify::recommended_watcher(move |event: notify::Result<Event>| {
            if let Ok(event) = event {
                if let Some(provider) = provider(&event) {
                    let _ = send.send((provider, event.paths));
                }
            }
        }) else {
            return;
        };
        let mut watched = HashSet::new();
        let mut pending = HashSet::new();
        let mut last = Instant::now();
        let mut states = std::collections::HashMap::new();
        let mut roots_checked: Option<Instant> = None;
        loop {
            // Retry absent directories, including newly created account homes.
            if roots_checked.is_none_or(|time| time.elapsed() >= Duration::from_secs(2)) {
                for (path, mode) in roots(&data) {
                    if !watched.contains(&path)
                        && path.is_dir()
                        && watcher.watch(&path, mode).is_ok()
                    {
                        watched.insert(path);
                    }
                }
                roots_checked = Some(Instant::now());
            }
            match receive.recv_timeout(Duration::from_millis(200)) {
                Ok((provider, paths)) => {
                    for path in paths {
                        pending.insert((provider, path));
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            // A fixed upper bound prevents continuous token writes from starving notifications.
            if last.elapsed() >= Duration::from_millis(300) {
                let mut cursor = false;
                for (provider, path) in pending.drain() {
                    if provider == "cursor" {
                        cursor = true;
                        continue;
                    }
                    use std::io::{BufRead, BufReader};
                    let meta = std::fs::File::open(&path)
                        .ok()
                        .and_then(|file| BufReader::new(file).lines().next()?.ok())
                        .and_then(|line| serde_json::from_str::<serde_json::Value>(&line).ok());
                    let Some(meta) = meta.filter(|meta| meta["type"] == "session_meta") else {
                        continue;
                    };
                    let working = crate::codex::rollout_working(&path);
                    if states.insert(path, working) == Some(working) {
                        continue;
                    }
                    let hint = Hint {
                        provider,
                        repository_path: meta["payload"]["cwd"].as_str().map(str::to_owned),
                        thread_id: meta["payload"]["id"].as_str().map(str::to_owned),
                        working: Some(working),
                    };
                    let _ = app.emit("agent-history-changed", hint);
                }
                if cursor {
                    let _ = app.emit(
                        "agent-history-changed",
                        Hint {
                            provider: "cursor",
                            repository_path: None,
                            thread_id: None,
                            working: None,
                        },
                    );
                }
                last = Instant::now();
            }
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn activity_hints_exclude_credentials_and_access_events() {
        for name in ["rollout-thread.jsonl"] {
            assert_eq!(
                provider(
                    &Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
                        .add_path(PathBuf::from(name))
                ),
                Some("codex")
            );
        }
        assert_eq!(
            provider(
                &Event::new(EventKind::Modify(notify::event::ModifyKind::Any))
                    .add_path("state.vscdb-wal".into())
            ),
            Some("cursor")
        );
        for name in [
            "auth.json",
            "config.toml",
            "keyring",
            "output.log",
            "state_5.sqlite-wal",
            "thread_history_1.sqlite-wal",
        ] {
            assert_eq!(
                provider(
                    &Event::new(EventKind::Create(notify::event::CreateKind::File))
                        .add_path(name.into())
                ),
                None
            );
        }
        assert_eq!(
            provider(
                &Event::new(EventKind::Access(notify::event::AccessKind::Any))
                    .add_path("rollout.jsonl".into())
            ),
            None
        );
    }
}
