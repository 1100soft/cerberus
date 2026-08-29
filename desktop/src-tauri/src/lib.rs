mod db;
mod git;
mod models;
mod oauth;

use db::Database;
use git::{canonical_remote, host_type, GitService};
use models::{GithubAuthStatus, GithubDeviceFlow, Identity, ImportResult, Repository, RepositoryUpdate};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State, WindowEvent,
};

struct AppState {
    db: Arc<Database>,
    git: GitService,
}

fn scan(git: &GitService, mut repository: Repository) -> Result<Repository, String> {
    let path = Path::new(&repository.local_path);
    let status = git
        .text(path, &["status", "--porcelain=v2", "--branch"])
        .map_err(|e| e.to_string())?;
    repository.staged_count = 0;
    repository.modified_count = 0;
    repository.untracked_count = 0;
    repository.ahead = 0;
    repository.behind = 0;
    for line in status.lines() {
        if let Some(branch) = line.strip_prefix("# branch.head ") {
            repository.detached = branch == "(detached)";
            repository.branch = (!repository.detached).then(|| branch.to_owned());
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            for part in ab.split_whitespace() {
                if let Some(v) = part.strip_prefix('+') {
                    repository.ahead = v.parse().unwrap_or(0);
                }
                if let Some(v) = part.strip_prefix('-') {
                    repository.behind = v.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("? ") {
            repository.untracked_count += 1;
        } else if line.starts_with("1 ") || line.starts_with("2 ") || line.starts_with("u ") {
            if let Some(xy) = line.split_whitespace().nth(1) {
                let mut chars = xy.chars();
                if chars.next() != Some('.') {
                    repository.staged_count += 1;
                }
                if chars.next() != Some('.') {
                    repository.modified_count += 1;
                }
            }
        }
    }
    let log = git
        .text(path, &["log", "-1", "--format=%s%x1f%cI"])
        .unwrap_or_default();
    if let Some((summary, date)) = log.split_once('\u{1f}') {
        repository.last_commit_summary = Some(summary.to_owned());
        repository.last_commit_at = Some(date.to_owned());
    }
    if let Some(identity) = &repository.identity {
        let name = git
            .text(path, &["config", "--get", "user.name"])
            .unwrap_or_default();
        let email = git
            .text(path, &["config", "--get", "user.email"])
            .unwrap_or_default();
        repository.identity_mismatch = (!name.is_empty() && name != identity.git_name)
            || (!email.is_empty() && email != identity.git_email);
    }
    if git.root(path).is_ok() {
        let origin = git.remote_url(path);
        repository.canonical_remote = origin.as_deref().map(canonical_remote);
        repository.host_type = host_type(origin.as_deref()).to_string();
    }
    Ok(repository)
}

fn sync_origin_urls(state: &AppState) -> Result<(), String> {
    for repo in state.db.list()? {
        let path = Path::new(&repo.local_path);
        if state.git.root(path).is_err() {
            continue;
        }
        let origin = state.git.remote_url(path);
        let canonical = origin.as_deref().map(canonical_remote);
        let host = host_type(origin.as_deref());
        if canonical != repo.canonical_remote || host != repo.host_type {
            state
                .db
                .save_remote(&repo.id, canonical.as_deref(), host)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn list_repositories(state: State<AppState>) -> Result<Vec<Repository>, String> {
    sync_origin_urls(&state)?;
    state.db.list()
}

#[tauri::command]
fn list_identities(state: State<AppState>) -> Result<Vec<Identity>, String> {
    state.db.identities()
}

#[tauri::command]
fn github_auth_status() -> GithubAuthStatus {
    oauth::auth_status()
}

#[tauri::command]
fn begin_github_oauth(client_id: Option<String>) -> Result<GithubDeviceFlow, String> {
    oauth::begin(client_id.as_deref().unwrap_or(""))
}

#[tauri::command]
fn complete_github_oauth(
    client_id: String,
    device_code: String,
    state: State<AppState>,
) -> Result<Option<Identity>, String> {
    oauth::complete(&state.db, &client_id, &device_code)
}

#[tauri::command]
fn complete_github_token(token: String, state: State<AppState>) -> Result<Identity, String> {
    oauth::identity_from_token(&state.db, token.trim())
}

#[tauri::command]
fn import_github_cli_identity(state: State<AppState>) -> Result<Identity, String> {
    let token = oauth::github_cli_token()?;
    oauth::identity_from_token(&state.db, &token)
}

#[tauri::command]
fn assign_repository_identity(
    repository_id: String,
    identity_id: String,
    state: State<AppState>,
) -> Result<(), String> {
    state.db.assign_identity(&repository_id, &identity_id)
}

#[tauri::command]
fn import_repository(path: String, state: State<AppState>) -> Result<ImportResult, String> {
    let id = state.db.import(&state.git, Path::new(&path))?;
    let repository = refresh_repository(id, state)?;
    let mut warnings = Vec::new();
    if repository.canonical_remote.is_none() {
        warnings.push("Imported without a remote; hosted actions are unavailable.".into());
    }
    Ok(ImportResult {
        repository,
        warnings,
    })
}

#[tauri::command]
fn refresh_repository(repository_id: String, state: State<AppState>) -> Result<Repository, String> {
    let repository = state
        .db
        .list()?
        .into_iter()
        .find(|r| r.id == repository_id)
        .ok_or("Repository not found")?;
    let previous_remote = repository.canonical_remote.clone();
    let previous_host = repository.host_type.clone();
    let repository = scan(&state.git, repository)?;
    if repository.canonical_remote != previous_remote || repository.host_type != previous_host {
        state.db.save_remote(
            &repository_id,
            repository.canonical_remote.as_deref(),
            &repository.host_type,
        )?;
    }
    state.db.save_snapshot(&repository_id, &repository)?;
    Ok(repository)
}

#[tauri::command]
fn reorder_repositories(repository_ids: Vec<String>, state: State<AppState>) -> Result<(), String> {
    state.db.reorder(&repository_ids)
}

#[tauri::command]
fn update_repository(
    repository_id: String,
    update: RepositoryUpdate,
    state: State<AppState>,
) -> Result<Repository, String> {
    state.db.update(&repository_id, &state.git, update)?;
    refresh_repository(repository_id, state)
}

#[tauri::command]
fn remove_repository(repository_id: String, state: State<AppState>) -> Result<(), String> {
    state.db.remove(&repository_id)
}

#[tauri::command]
fn create_repository(
    update: RepositoryUpdate,
    state: State<AppState>,
) -> Result<ImportResult, String> {
    if update.display_name.trim().is_empty() {
        return Err("Display name is required".into());
    }
    let path = PathBuf::from(update.local_path.trim());
    if path.as_os_str().is_empty() {
        return Err("Local path is required".into());
    }
    if state.git.root(&path).is_ok() {
        return Err("That folder is already a Git repository. Import it instead.".into());
    }
    let branch = update
        .default_branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("main");
    state.git.init(&path, branch).map_err(|e| e.to_string())?;
    let id = state.db.import(&state.git, &path)?;
    state.db.update(&id, &state.git, update)?;
    let repository = refresh_repository(id, state)?;
    Ok(ImportResult {
        repository,
        warnings: Vec::new(),
    })
}

#[tauri::command]
fn run_git_action(
    repository_id: String,
    operation: String,
    args: Value,
    state: State<AppState>,
) -> Result<(), String> {
    let path = state.db.repository_path(&repository_id)?;
    let owned: Vec<String> = match operation.as_str() {
        "fetch" => vec!["fetch".into(), "--prune".into()],
        "pull" => vec!["pull".into(), "--ff-only".into()],
        "push" => vec!["push".into()],
        "stage" => vec![
            "add".into(),
            "--".into(),
            args.get("path")
                .and_then(Value::as_str)
                .ok_or("stage requires a path")?
                .into(),
        ],
        "unstage" => vec![
            "restore".into(),
            "--staged".into(),
            "--".into(),
            args.get("path")
                .and_then(Value::as_str)
                .ok_or("unstage requires a path")?
                .into(),
        ],
        "commit" => vec![
            "commit".into(),
            "-m".into(),
            args.get("message")
                .and_then(Value::as_str)
                .ok_or("commit requires a message")?
                .into(),
        ],
        other => return Err(format!("Unsupported Git operation: {other}")),
    };
    let refs: Vec<&str> = owned.iter().map(String::as_str).collect();
    state.git.mutate(&path, &refs).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_in_editor(repository_id: String, state: State<AppState>) -> Result<(), String> {
    let path = state.db.repository_path(&repository_id)?;
    Command::new("code").arg(path).spawn().map(|_|()).map_err(|e|format!("Could not launch VS Code: {e}. Configure an identity editor binding in a future settings build."))
}

#[tauri::command]
fn open_hosted_repository(repository_id: String, state: State<AppState>) -> Result<(), String> {
    let repo = state
        .db
        .list()?
        .into_iter()
        .find(|r| r.id == repository_id)
        .ok_or("Repository not found")?;
    let url = repo
        .canonical_remote
        .ok_or("This repository has no hosted remote")?;
    open_url::that(url).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_local_folder(repository_id: String, state: State<AppState>) -> Result<(), String> {
    let path = state.db.repository_path(&repository_id)?;
    open_url::that(path.to_string_lossy().into_owned()).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !permitted_github_url(&url) {
        return Err("External URL is not permitted".into());
    }
    open_url::that(url).map_err(|e| e.to_string())
}

fn permitted_github_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" || parsed.host_str() != Some("github.com") {
        return false;
    }
    matches!(
        parsed.path(),
        "/login/device" | "/login/device/" | "/settings/tokens" | "/settings/tokens/" | "/settings/tokens/new"
    )
}

mod open_url {
    use std::process::Command;
    pub fn that(url: String) -> std::io::Result<()> {
        #[cfg(target_os = "windows")]
        {
            Command::new("cmd")
                .args(["/C", "start", "", &url])
                .spawn()?;
        }
        #[cfg(target_os = "macos")]
        {
            Command::new("open").arg(url).spawn()?;
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            Command::new("xdg-open").arg(url).spawn()?;
        }
        Ok(())
    }
}

fn show_dashboard(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let db = Database::open(data.join("gitcerberus.db")).map_err(std::io::Error::other)?;
            app.manage(AppState {
                db: Arc::new(db),
                git: GitService::default(),
            });

            let open = MenuItem::with_id(app, "open", "Open GitCerberus", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let tray = TrayIconBuilder::with_id("main")
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .expect("application icon missing"),
                )
                .tooltip("GitCerberus — repository guardian")
                .menu(&menu);
            // Linux tray hosts (including Plasma and AppIndicator-compatible GNOME
            // extensions) own click/menu behavior. Keep the default menu-on-click
            // there; other platforms use a direct left-click to restore the window.
            #[cfg(not(target_os = "linux"))]
            let tray = tray.show_menu_on_left_click(false);
            tray.on_menu_event(|app, event| match event.id().as_ref() {
                "open" => show_dashboard(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_dashboard(tray.app_handle());
                }
            })
            .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_repositories,
            list_identities,
            begin_github_oauth,
            complete_github_oauth,
            complete_github_token,
            import_github_cli_identity,
            github_auth_status,
            assign_repository_identity,
            import_repository,
            create_repository,
            refresh_repository,
            reorder_repositories,
            update_repository,
            remove_repository,
            run_git_action,
            open_in_editor,
            open_hosted_repository,
            open_local_folder,
            open_external_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitCerberus");
}
