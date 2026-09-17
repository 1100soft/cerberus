mod codex;
mod cursor;
mod cursor_editor;
mod setup_terminal;
mod db;
mod git;
mod github;
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
    codex: Arc<codex::CodexService>,
    cursor: Arc<cursor::CursorService>,
    setup_terminal: Arc<setup_terminal::SetupTerminal>,
    data_dir: std::path::PathBuf,
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
async fn link_repository_folder(expected_remote: String, path: String, repository_id: Option<String>, state: State<'_, AppState>) -> Result<ImportResult, String> {
    let db = state.db.clone();
    let git = state.git.clone();
    tauri::async_runtime::spawn_blocking(move || github::link_existing(&db, &git, &expected_remote, Path::new(&path), repository_id.as_deref())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn github_repositories(state: State<'_, AppState>) -> Result<github::Catalog, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || github::catalog(&db)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn clone_github_repository(identity_id: String, full_name: String, parent: String, state: State<'_, AppState>) -> Result<ImportResult, String> {
    let db = state.db.clone();
    let git = state.git.clone();
    tauri::async_runtime::spawn_blocking(move || github::clone_repository(&db, &git, &identity_id, &full_name, Path::new(&parent))).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn open_in_cursor(repository_id: String, state: State<AppState>) -> Result<(), String> {
    let path = state.db.repository_path(&repository_id)?;
    Command::new("cursor").arg(&path).spawn().map(|_| ()).map_err(|e| format!("Could not launch Cursor: {e}. Install the cursor shell command and make it available on PATH."))
}

#[tauri::command]
fn list_repositories(state: State<AppState>) -> Result<Vec<Repository>, String> {
    sync_origin_urls(&state)?;
    state.db.list()
}

#[tauri::command]
async fn configure_codex(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let service = state.codex.clone();
    tauri::async_runtime::spawn_blocking(move || service.configure(Path::new(&path))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn install_provider(provider: String, approved: bool, output: tauri::ipc::Channel<setup_terminal::SetupOutput>, state: State<'_, AppState>) -> Result<(), String> {
    let terminal = state.setup_terminal.clone(); let root = state.data_dir.clone();
    let codex = state.codex.clone(); let cursor = state.cursor.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let executable = terminal.install(&root, &provider, approved, output)?;
        if provider == "codex" { codex.configure(&executable) } else { cursor.configure(&executable) }
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn cancel_provider_install(state: State<'_, AppState>) { state.setup_terminal.cancel(); }

#[tauri::command]
async fn configure_cursor(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let service = state.cursor.clone();
    tauri::async_runtime::spawn_blocking(move || service.configure(Path::new(&path))).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn cursor_threads(repository_id: String, cursor: Option<String>, archived: bool, state: State<'_, AppState>) -> Result<codex::ThreadPage, String> {
    let path = state.db.repository_path(&repository_id)?;
    let service = state.cursor.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let editor = cursor_editor::threads(&path, archived);
        match service.threads(&path, cursor.clone(), archived) {
            Ok(mut page) => { if cursor.is_none() { if let Ok(editor) = editor { page.data.extend(editor.data); } } Ok(page) }
            Err(error) => editor.map(|page| if cursor.is_none() { page } else { codex::ThreadPage { data: vec![], next_cursor: None } }).map_err(|editor_error| format!("{error}\n{editor_error}")),
        }
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn cursor_messages(repository_id: String, thread_id: String, state: State<'_, AppState>) -> Result<codex::MessagePage, String> {
    let path = state.db.repository_path(&repository_id)?;
    let service = state.cursor.clone();
    tauri::async_runtime::spawn_blocking(move || if let Some(id) = thread_id.strip_prefix("editor:") { cursor_editor::messages(&path, id) } else { service.messages(&path, thread_id) }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn codex_account(state: State<'_, AppState>) -> Result<Value, String> {
    let service = state.codex.clone();
    tauri::async_runtime::spawn_blocking(move || service.request("account/read", serde_json::json!({"refreshToken":false}))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn codex_login(state: State<'_, AppState>) -> Result<String, String> {
    let service = state.codex.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let login = service.request("account/login/start", serde_json::json!({"type":"chatgpt"}))?;
        let url = login["authUrl"].as_str().ok_or("Codex did not return a sign-in URL")?;
        let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
        if parsed.scheme() != "https" || !matches!(parsed.host_str(), Some("auth.openai.com" | "auth0.openai.com" | "chatgpt.com")) {
            return Err("Codex returned an unexpected sign-in URL".into());
        }
        open_url::that(url.to_owned()).map_err(|e| e.to_string())?;
        Ok(login["loginId"].as_str().ok_or("Codex did not return a login ID")?.to_owned())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn codex_cancel_login(login_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let service = state.codex.clone();
    tauri::async_runtime::spawn_blocking(move || service.request("account/login/cancel", serde_json::json!({"loginId":login_id})).map(|_| ())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn codex_threads(repository_id: String, cursor: Option<String>, archived: bool, state: State<'_, AppState>) -> Result<codex::ThreadPage, String> {
    let path = state.db.repository_path(&repository_id)?;
    let service = state.codex.clone();
    tauri::async_runtime::spawn_blocking(move || service.threads(&path, cursor, archived)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn codex_messages(repository_id: String, thread_id: String, cursor: Option<String>, state: State<'_, AppState>) -> Result<codex::MessagePage, String> {
    let path = state.db.repository_path(&repository_id)?;
    let service = state.codex.clone();
    tauri::async_runtime::spawn_blocking(move || service.messages(&path, thread_id, cursor)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_identities(state: State<AppState>) -> Result<Vec<Identity>, String> {
    let mut identities = state.db.identities()?;
    for identity in &mut identities {
        identity.connected = oauth::github_connected(&identity.id);
    }
    Ok(identities)
}

#[tauri::command]
fn disconnect_github_identity(identity_id: String) -> Result<(), String> {
    oauth::disconnect_github_identity(&identity_id)
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
fn list_branches(repository_id: String, state: State<AppState>) -> Result<Vec<String>, String> {
    let path = state.db.repository_path(&repository_id)?;
    state.git.branches(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn commit_history(repository_id: String, branch: Option<String>, skip: u32, state: State<AppState>) -> Result<Vec<models::Commit>, String> {
    let path = state.db.repository_path(&repository_id)?;
    state.git.history(&path, branch.as_deref(), skip).map_err(|e| e.to_string())
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
    if parsed.query().is_none() && parsed.fragment().is_none() && parsed.username().is_empty() && parsed.password().is_none() {
        let parts: Vec<_> = parsed.path().trim_matches('/').split('/').collect();
        if parts.len() == 2 && parts.iter().all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))) {
            return true;
        }
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
                setup_terminal: Arc::new(setup_terminal::SetupTerminal::default()),
                data_dir: data.clone(),
                cursor: Arc::new(cursor::CursorService::new(data.join("cursor-executable.txt"))),
                codex: Arc::new(codex::CodexService::new(data.join("codex-executable.txt"))),
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
            install_provider,
            cancel_provider_install,
            configure_cursor,
            cursor_threads,
            cursor_messages,
            configure_codex,
            codex_account,
            codex_login,
            codex_cancel_login,
            codex_threads,
            codex_messages,
            list_repositories,
            github_repositories,
            link_repository_folder,
            clone_github_repository,
            open_in_cursor,
            list_branches,
            commit_history,
            list_identities,
            disconnect_github_identity,
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
