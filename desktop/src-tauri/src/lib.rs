mod terminal_text;
mod provider_paths;
mod agents;
mod subscription_run;
mod chatgpt_accounts;
mod external_identities;
mod identity_defaults;
mod agent_sessions;
mod agent_edits;
mod codex;
mod codex_models;
mod cursor;
mod cursor_editor;
mod cursor_launch;
mod cursor_notifications;
mod copilot;
mod draft_runs;
mod copilot_history;
mod claude_history;
mod prompt_delivery;
mod shell_automation;
mod automation_logs;
mod handoffs;
mod repository_watcher;
mod repository_changes;
mod setup_terminal;
mod db;
mod git;
mod github;
mod repository_creation;
mod github_credentials;
mod branch_removal;
mod automation_worktrees;
mod conversation_store;
mod awake;
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
    conversations:Arc<conversation_store::ConversationStore>,
    agents: Arc<agents::Agents>,
    drafts: Arc<draft_runs::DraftRuns>,
    repository_watchers: Arc<repository_watcher::RepositoryWatchers>,
    chatgpt: Arc<chatgpt_accounts::ChatgptAccounts>,
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
        repository.last_commit_at = Some(date.trim().to_owned());
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

#[tauri::command]
fn provider_setup_status(provider: String, state: State<AppState>) -> Result<Vec<provider_paths::ToolStatus>, String> { provider_paths::status(&state.data_dir, &provider) }
#[tauri::command]
async fn set_provider_path(tool: String, path: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    let (file, _, _) = provider_paths::specification(&tool)?;
    let root = state.data_dir.clone(); let codex = state.codex.clone(); let cursor = state.cursor.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(path) = path {
            if tool == "codex" { codex.configure(Path::new(&path)) }
            else if tool == "cursor" { cursor.configure(Path::new(&path)) }
            else { provider_paths::save(&root, &tool, Path::new(&path)) }
        } else {
            if tool == "codex" { codex.disconnect()?; }
            match std::fs::remove_file(root.join(file)) { Ok(()) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(e) => Err(e.to_string()) }
        }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn chatgpt_settings(state:State<AppState>)->Result<chatgpt_accounts::AccountSettings,String>{state.chatgpt.ensure_default(&state.data_dir,&state.agents)}
#[tauri::command]
fn external_identities(state:State<AppState>) -> Vec<external_identities::ExternalIdentity> { external_identities::identities(&state.data_dir) }
#[tauri::command]
async fn copilot_repository_snapshot(identity_id:String,repository:String,state:State<'_,AppState>) -> Result<Value,String> {
    let data_dir = state.data_dir.clone();
    copilot::repository_snapshot(&data_dir,&identity_id,&repository).await
}
#[tauri::command]
async fn external_identity_snapshot(state:State<'_,AppState>)->Result<Value,String>{
    let root=state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move||{
        let identities=external_identities::identities(&root);
        let settings=external_identities::settings_for(&root,&identities)?;
        Ok(serde_json::json!({"identities":identities,"settings":settings}))
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn external_identity_settings(state:State<AppState>) -> Result<external_identities::ProviderAccounts,String> { external_identities::settings(&state.data_dir) }
#[tauri::command]
fn assign_external_identity(provider:String,repository:String,account:Option<String>,inherit:bool,state:State<AppState>) -> Result<external_identities::ProviderAccounts,String> { external_identities::assign(&state.data_dir,&provider,&repository,account,inherit) }
#[tauri::command]
fn default_external_identity(provider:String,account:Option<String>,state:State<AppState>) -> Result<external_identities::ProviderAccounts,String> { external_identities::set_default(&state.data_dir,&provider,account) }
#[tauri::command]
fn login_external_identity(provider:String,state:State<AppState>) -> Result<(),String> { external_identities::login(&state.data_dir,&provider) }
#[tauri::command]
fn logout_external_identity(provider:String,state:State<AppState>) -> Result<(),String> { external_identities::logout(&state.data_dir,&provider) }
#[tauri::command]
fn assign_chatgpt_account(repository:Option<String>,account:Option<String>,inherit:bool,state:State<AppState>)->Result<chatgpt_accounts::AccountSettings,String>{
 if inherit {state.chatgpt.inherit(&state.data_dir,repository.as_deref().ok_or("Repository required")?)}else{state.chatgpt.assign(&state.data_dir,&state.agents,repository,account)}
}
#[tauri::command]
async fn begin_chatgpt_login(id:Option<String>,state:State<'_,AppState>)->Result<String,String>{let service=state.chatgpt.clone();let agents=state.agents.clone();let root=state.data_dir.clone();tauri::async_runtime::spawn_blocking(move||service.begin(&root,&agents,id)).await.map_err(|e|e.to_string())?}
#[tauri::command]
async fn poll_chatgpt_login(id:String,state:State<'_,AppState>)->Result<Option<agents::Profile>,String>{let service=state.chatgpt.clone();let agents=state.agents.clone();let root=state.data_dir.clone();tauri::async_runtime::spawn_blocking(move||service.poll(&root,&agents,&id)).await.map_err(|e|e.to_string())?}
#[tauri::command]
async fn cancel_chatgpt_login(id:String,state:State<'_,AppState>)->Result<(),String>{let service=state.chatgpt.clone();tauri::async_runtime::spawn_blocking(move||service.cancel(&id)).await.map_err(|e|e.to_string())?}
#[tauri::command]
async fn disconnect_chatgpt(id:String,state:State<'_,AppState>)->Result<(),String>{let service=state.chatgpt.clone();let agents=state.agents.clone();let root=state.data_dir.clone();tauri::async_runtime::spawn_blocking(move||service.disconnect(&root,&agents,&id)).await.map_err(|e|e.to_string())?}
#[tauri::command]
fn agent_profiles(state: State<AppState>) -> Result<Vec<agents::Profile>, String> { state.agents.profiles(&state.data_dir) }
#[tauri::command]
async fn chatgpt_capabilities(profile_id:String,state:State<'_,AppState>)->Result<serde_json::Value,String>{
 let root=state.data_dir.clone();let agents=state.agents.clone();
 tauri::async_runtime::spawn_blocking(move||{
  let profile=agents.profiles(&root)?.into_iter().find(|p|p.id==profile_id && p.subscription && !p.disconnected).ok_or("Connect this ChatGPT identity first")?;
  let client=codex::CodexService::for_account(root.join("codex-executable.txt"),chatgpt_accounts::account_home(&root,&profile.id)?);
  codex_capabilities(|method,params|client.request(method,params),profile.email.as_deref(),||codex_models::catalog(&chatgpt_accounts::account_home(&root,&profile.id)?))
 }).await.map_err(|e|e.to_string())?
}
fn codex_capabilities(mut request:impl FnMut(&str,serde_json::Value)->Result<serde_json::Value,String>,email:Option<&str>,live_catalog:impl FnOnce()->Result<serde_json::Value,String>)->Result<serde_json::Value,String>{
  let account=request("account/read",serde_json::json!({"refreshToken":true}));
  let account_error=match account{Ok(account) if account["account"]["type"]=="chatgpt" && !email.is_some_and(|email|account["account"]["email"].as_str()!=Some(email))=>None,Ok(_)=>Some(codex::missing_account_error()),Err(error)=>Some(error)};
  let mut models=Vec::new();let mut cursor:Option<String>=None;let mut seen=std::collections::HashSet::new();
  loop {let page=request("model/list",serde_json::json!({"limit":100,"cursor":cursor,"includeHidden":false}))?;if let Some(data)=page["data"].as_array(){models.extend(data.clone());}cursor=page["nextCursor"].as_str().map(String::from);match &cursor{Some(value) if seen.insert(value.clone())=>{},_=>break}}
  let live=if let Some(error)=&account_error{Err(error.clone())}else{live_catalog()};
  let models=live.as_ref().map(|catalog|codex_models::selectable(catalog,&models)).unwrap_or_default();
  let usage=match account_error{Some(error)=>Err(error),None=>request("account/rateLimits/read",serde_json::json!({}))};
  Ok(serde_json::json!({"models":models,"modelsError":live.err(),"usage":usage.as_ref().ok(),"usageError":usage.err()}))
}
#[tauri::command]
async fn save_agent_profile(label: String, provider: String, executable: String, key: String, state: State<'_, AppState>) -> Result<agents::Profile, String> {
    let agents = state.agents.clone(); let root = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || agents.save(&root, label, provider, executable, key)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn remove_agent_profile(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let agents = state.agents.clone(); let root = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || agents.remove(&root, &id)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_agent_conversation(chat:Value,state:State<'_,AppState>)->Result<(),String>{let store=state.conversations.clone();tauri::async_runtime::spawn_blocking(move||store.save(chat)).await.map_err(|e|e.to_string())?}
#[tauri::command]
async fn agent_conversations(state:State<'_,AppState>)->Result<Vec<Value>,String>{let store=state.conversations.clone();tauri::async_runtime::spawn_blocking(move||store.list()).await.map_err(|e|e.to_string())?}
#[tauri::command]
fn local_activity_presence(active:bool){awake::presence(active);}
#[tauri::command]
async fn cleanup_automation_checkout(repository_id:String,run_id:String,state:State<'_,AppState>)->Result<bool,String>{let repo=state.db.repository_path(&repository_id)?;let root=state.data_dir.clone();tauri::async_runtime::spawn_blocking(move||automation_worktrees::cleanup(&root,&repo,&repository_id,&run_id)).await.map_err(|e|e.to_string())?}
#[tauri::command]
async fn run_agent(profile_id: String, repository_id: String, prompt: String, mode: String, model: Option<String>, reasoning_effort: Option<String>, resume: Option<agent_sessions::ResumeTarget>, automation_run_id:Option<String>, automation_commit:Option<String>, output: tauri::ipc::Channel<setup_terminal::SetupOutput>, state: State<'_, AppState>) -> Result<(), String> {
    let _awake=awake::acquire();
    let _checkout_activity=automation_run_id.as_deref().map(automation_worktrees::activate);
    let mut repo = state.db.list()?.into_iter().find(|r| r.id == repository_id).ok_or("Repository not found")?;
    let agents = state.agents.clone(); let root = state.data_dir.clone();
    let codex = state.codex.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(run_id)=automation_run_id{repo.local_path=automation_worktrees::prepare(&root,Path::new(&repo.local_path),&repository_id,&run_id,automation_commit.as_deref())?.to_string_lossy().into_owned();}
        agents.run(&root, &profile_id, &repo, &prompt, &mode, model.as_deref(), reasoning_effort.as_deref(), resume.as_ref(), &codex, output)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn agent_resume_status(profile_id: String, repository_id: String, target: agent_sessions::ResumeTarget, automation_run_id:Option<String>, automation_commit:Option<String>, state: State<'_, AppState>) -> Result<agent_sessions::ResumeStatus, String> {
    let repo = state.db.list()?.into_iter().find(|r| r.id == repository_id).ok_or("Repository not found")?;
    let profile = state.agents.profiles(&state.data_dir)?.into_iter().find(|p| p.id == profile_id).ok_or("API account not found")?;
    let root = state.data_dir.clone(); let codex = state.codex.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _checkout_activity=automation_run_id.as_deref().map(automation_worktrees::activate);
        let path=if let Some(run_id)=automation_run_id{match automation_worktrees::prepare(&root,Path::new(&repo.local_path),&repository_id,&run_id,automation_commit.as_deref()){Ok(path)=>path,Err(reason)=>return agent_sessions::ResumeStatus{available:false,reason}}}else{PathBuf::from(&repo.local_path)};
        match agent_sessions::resolve(&root, &profile, &path, &target, &codex) {
        Ok(_) => agent_sessions::ResumeStatus {available:true, reason:"Continue this conversation".into()},
        Err(reason) => agent_sessions::ResumeStatus {available:false, reason},
    }}).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn prompt_capability(repository_id:String,provider:String,thread_id:String,state:State<'_,AppState>)->Result<prompt_delivery::Capability,String>{
    let record=state.db.list()?.into_iter().find(|item|item.id==repository_id).ok_or("Repository not found")?;
    let repo=state.db.repository_path(&repository_id)?;let key=prompt_repository_key(&record);let root=state.data_dir.clone();let codex=state.codex.clone();let cursor=state.cursor.clone();
    tauri::async_runtime::spawn_blocking(move||prompt_delivery::capability(&root,&repo,&key,&provider,&thread_id,&codex,&cursor)).await.map_err(|e|e.to_string())
}

#[tauri::command]
async fn submit_saved_prompt(repository_id:String,provider:String,thread_id:String,prompt:String,state:State<'_,AppState>)->Result<String,String>{
    let record=state.db.list()?.into_iter().find(|item|item.id==repository_id).ok_or("Repository not found")?;
    let repo=state.db.repository_path(&repository_id)?;let key=prompt_repository_key(&record);let root=state.data_dir.clone();let codex=state.codex.clone();let cursor=state.cursor.clone();
    tauri::async_runtime::spawn_blocking(move||prompt_delivery::submit(&root,&repo,&key,&provider,&thread_id,&prompt,&codex,&cursor)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn run_new_agent_conversation(repository_id:String,provider:String,identity_id:String,mode:String,prompt:String,session_id:Option<String>,request_id:Option<String>,automation_run_id:Option<String>,automation_commit:Option<String>,output:tauri::ipc::Channel<serde_json::Value>,state:State<'_,AppState>)->Result<serde_json::Value,String>{
    let _awake=awake::acquire();
    let _checkout_activity=automation_run_id.as_deref().map(automation_worktrees::activate);
    let record=state.db.list()?.into_iter().find(|item|item.id==repository_id).ok_or("Repository not found")?;
    let mut repo=state.db.repository_path(&repository_id)?;
    let key=prompt_repository_key(&record);
    let root=state.data_dir.clone();
    if let Some(run_id)=automation_run_id{let worktree_root=root.clone();let path=repo.clone();let id=repository_id.clone();repo=tauri::async_runtime::spawn_blocking(move||automation_worktrees::prepare(&worktree_root,&path,&id,&run_id,automation_commit.as_deref())).await.map_err(|error|error.to_string())??;}
    let registration=request_id.map(|id|state.drafts.register(id)).transpose()?;
    let cancelled=registration.as_ref().map(|item|item.cancelled.clone());
    if provider=="copilot" {
        if record.identity.as_ref().map(|item|item.id.as_str())!=Some(identity_id.as_str()){return Err("Assign the selected GitHub identity to this repository first".into());}
        return copilot::new_conversation(&root,&identity_id,&repo,&mode,&prompt,session_id.as_deref(),cancelled,Some(output)).await;
    }
    tauri::async_runtime::spawn_blocking(move||prompt_delivery::new_cli_conversation(&root,&repo,&key,&provider,&identity_id,&mode,&prompt,session_id.as_deref(),cancelled,Some(output))).await.map_err(|e|e.to_string())?
}
#[tauri::command]
fn cancel_draft(request_id:String,state:State<AppState>)->Result<(),String>{state.drafts.cancel(&request_id)}
#[tauri::command]
async fn run_automation_shell(repository_id:String,script:String,output:tauri::ipc::Channel<shell_automation::ShellChunk>,handoff_input_path:Option<String>,handoff_output_paths:std::collections::HashMap<String,String>,context:Option<std::collections::HashMap<String,String>>,state:State<'_,AppState>)->Result<shell_automation::ShellRun,String>{
    let _awake=awake::acquire();
    let repository=state.db.repository_path(&repository_id)?;
    tauri::async_runtime::spawn_blocking(move||shell_automation::run_stream_with_context(&repository,&script,Some(output),handoff_input_path.as_deref(),&handoff_output_paths,&context.unwrap_or_default())).await.map_err(|error|error.to_string())?
}
#[tauri::command]
async fn watch_automation_repositories(repository_ids:Vec<String>,state:State<'_,AppState>,app:tauri::AppHandle)->Result<Vec<String>,String>{
    let mut errors=Vec::new();
    let desired=repository_ids.into_iter().filter_map(|id|match state.db.repository_path(&id){Ok(path)=>Some((id,path)),Err(error)=>{errors.push(format!("{id}: {error}"));None}}).collect::<Vec<_>>();
    let watchers=state.repository_watchers.clone();
    errors.extend(tauri::async_runtime::spawn_blocking(move||watchers.sync(desired,app)).await.map_err(|error|error.to_string())??);
    Ok(errors)
}
#[tauri::command]
async fn repository_changed_lines(repository_id:String,state:State<'_,AppState>)->Result<u64,String>{
    let path=state.db.repository_path(&repository_id)?;
    tauri::async_runtime::spawn_blocking(move||repository_changes::changed_lines(&path)).await.map_err(|error|error.to_string())?
}
#[tauri::command]
async fn repository_changed_lines_batch(repository_ids:Vec<String>,state:State<'_,AppState>)->Result<std::collections::HashMap<String,u64>,String>{
    let paths=repository_ids.into_iter().filter_map(|id|state.db.repository_path(&id).ok().map(|path|(id,path))).collect::<Vec<_>>();
    tauri::async_runtime::spawn_blocking(move||paths.into_iter().filter_map(|(id,path)|repository_changes::changed_lines(&path).ok().map(|count|(id,count))).collect()).await.map_err(|error|error.to_string())
}
#[tauri::command]
async fn repository_change_summary(repository_id:String,state:State<'_,AppState>)->Result<repository_changes::ChangeSummary,String>{
    let path=state.db.repository_path(&repository_id)?;
    tauri::async_runtime::spawn_blocking(move||repository_changes::summary(&path)).await.map_err(|error|error.to_string())?
}
#[tauri::command]
async fn repository_commit_state(repository_id:String,state:State<'_,AppState>)->Result<repository_changes::CommitState,String>{
    let path=state.db.repository_path(&repository_id)?;
    tauri::async_runtime::spawn_blocking(move||repository_changes::commit_state(&path)).await.map_err(|error|error.to_string())?
}
#[tauri::command]
async fn repository_commit_states_batch(repository_ids:Vec<String>,state:State<'_,AppState>)->Result<std::collections::HashMap<String,repository_changes::CommitState>,String>{
    let paths=repository_ids.into_iter().filter_map(|id|state.db.repository_path(&id).ok().map(|path|(id,path))).collect::<Vec<_>>();
    tauri::async_runtime::spawn_blocking(move||paths.into_iter().filter_map(|(id,path)|repository_changes::commit_state(&path).ok().map(|state|(id,state))).collect()).await.map_err(|error|error.to_string())
}
#[tauri::command]
fn handoff_output_path(repository_id:String,name:String,run_id:String,state:State<AppState>)->Result<String,String>{handoffs::output_path(&state.db.repository_path(&repository_id)?,&name,&run_id)}
#[tauri::command]
fn publish_handoff(repository_id:String,name:String,run_id:String,payload:Option<String>,state:State<AppState>)->Result<bool,String>{let repository=state.db.repository_path(&repository_id)?;if let Some(payload)=payload{handoffs::write_payload(&repository,&name,&run_id,&payload)?;}handoffs::publish(&repository,&name,&run_id)}
#[tauri::command]
fn has_pending_handoff(repository_id:String,name:String,variables:Option<Vec<String>>,state:State<AppState>)->Result<bool,String>{handoffs::has_pending_matching(&state.db.repository_path(&repository_id)?,&name,&variables.unwrap_or_default())}
#[tauri::command]
fn claim_handoff(repository_id:String,name:String,variables:Option<Vec<String>>,state:State<AppState>)->Result<Option<handoffs::Claim>,String>{handoffs::claim_matching(&state.db.repository_path(&repository_id)?,&name,&variables.unwrap_or_default())}
fn retention_hours(state:&AppState)->u64{std::fs::read_to_string(state.data_dir.join("handoff-retention-hours")).ok().and_then(|text|text.trim().parse::<u64>().ok()).filter(|hours|(1..=8760).contains(hours)).unwrap_or(24)}
#[tauri::command]
fn handoff_settings(state:State<AppState>)->serde_json::Value{serde_json::json!({"retentionHours":retention_hours(&state)})}
#[tauri::command]
fn save_handoff_settings(retention_hours:u64,state:State<AppState>)->Result<(),String>{
    use std::io::Write;
    if !(1..=8760).contains(&retention_hours){return Err("Retention must be 1–8760 hours.".into());}
    let mut file=tempfile::NamedTempFile::new_in(&state.data_dir).map_err(|error|error.to_string())?;
    write!(file,"{retention_hours}").map_err(|error|error.to_string())?;
    file.persist(state.data_dir.join("handoff-retention-hours")).map_err(|error|error.to_string())?;Ok(())
}
#[tauri::command]
fn list_matching_handoffs(repository_id:String,name:String,variables:Vec<String>,state:State<AppState>)->Result<Vec<handoffs::Selection>,String>{handoffs::cleanup_with_retention(&state.db.repository_path(&repository_id)?,retention_hours(&state))?;handoffs::selections(&state.db.repository_path(&repository_id)?,&name,&variables)}
#[tauri::command]
fn claim_selected_handoff(repository_id:String,name:String,id:String,variables:Vec<String>,state:State<AppState>)->Result<handoffs::Claim,String>{handoffs::cleanup_with_retention(&state.db.repository_path(&repository_id)?,retention_hours(&state))?;handoffs::claim_selected(&state.db.repository_path(&repository_id)?,&name,&id,&variables)}
#[tauri::command]
fn retry_handoff(repository_id:String,name:String,id:String,state:State<AppState>)->Result<handoffs::Claim,String>{handoffs::retry_with_retention(&state.db.repository_path(&repository_id)?,&name,&id,retention_hours(&state))}
#[tauri::command]
fn handoff_retained(repository_id:String,name:String,id:String,state:State<AppState>)->Result<bool,String>{handoffs::retained(&state.db.repository_path(&repository_id)?,&name,&id,retention_hours(&state))}
#[tauri::command]
fn finish_handoff(repository_id:String,name:String,id:String,state:State<AppState>)->Result<(),String>{handoffs::finish(&state.db.repository_path(&repository_id)?,&name,&id)}
#[tauri::command]
fn release_handoff(repository_id:String,name:String,id:String,state:State<AppState>)->Result<(),String>{handoffs::release(&state.db.repository_path(&repository_id)?,&name,&id)}
#[tauri::command]
async fn cleanup_stale_handoffs(repository_ids:Vec<String>,state:State<'_,AppState>)->Result<usize,String>{
    let paths=repository_ids.into_iter().filter_map(|id|state.db.repository_path(&id).ok()).collect::<Vec<_>>();
    let hours=retention_hours(&state);
    tauri::async_runtime::spawn_blocking(move||{
        let mut removed=0;let mut errors=Vec::new();
        for path in paths{match handoffs::cleanup_with_retention(&path,hours){Ok(count)=>removed+=count,Err(error)=>errors.push(format!("{}: {error}",path.display()))}}
        if errors.is_empty(){Ok(removed)}else{Err(errors.join("; "))}
    }).await.map_err(|error|error.to_string())?
}
#[tauri::command]
async fn delete_automation_log(automation_id:String,repository_id:String,run_id:String,state:State<'_,AppState>)->Result<(),String>{let root=state.data_dir.clone();tauri::async_runtime::spawn_blocking(move||automation_logs::delete(&root,&automation_id,&repository_id,&run_id)).await.map_err(|e|e.to_string())?}
#[tauri::command]
async fn sweep_automation_checkouts(repository_ids:Vec<String>,protected_run_ids:Vec<String>,state:State<'_,AppState>)->Result<usize,String>{let root=state.data_dir.clone();let repos=repository_ids.iter().map(|id|state.db.repository_path(id).map(|path|(id.clone(),path))).collect::<Result<Vec<_>,_>>()?;tauri::async_runtime::spawn_blocking(move||{let mut count=0;for(id,path)in repos{count+=automation_worktrees::sweep(&root,&path,&id,&protected_run_ids)?;}Ok(count)}).await.map_err(|e|e.to_string())?}
#[tauri::command]
fn write_automation_log(entry:automation_logs::Entry,state:State<AppState>)->Result<(),String>{automation_logs::write(&state.data_dir,&entry)}
#[tauri::command]
async fn list_automation_logs(automation_id:String,state:State<'_,AppState>)->Result<Vec<automation_logs::Summary>,String>{let root=state.data_dir.clone();tauri::async_runtime::spawn_blocking(move||automation_logs::list(&root,&automation_id)).await.map_err(|error|error.to_string())?}
#[tauri::command]
async fn read_automation_log(automation_id:String,repository_id:String,run_id:String,state:State<'_,AppState>)->Result<automation_logs::Entry,String>{let root=state.data_dir.clone();tauri::async_runtime::spawn_blocking(move||automation_logs::read(&root,&automation_id,&repository_id,&run_id)).await.map_err(|error|error.to_string())?}
fn prompt_repository_key(repository:&Repository)->String{
    repository.canonical_remote.as_deref().and_then(|remote|url::Url::parse(remote).ok()).map(|url|format!("{}{}",url.host_str().unwrap_or_default(),url.path().trim_end_matches('/').trim_end_matches(".git")).to_lowercase()).filter(|value|!value.is_empty()).unwrap_or_else(||repository.id.clone())
}
#[tauri::command]
fn cancel_agent(repository_id: String, automation_run_id:Option<String>, state: State<AppState>) -> Result<(), String> {
    let primary=state.db.repository_path(&repository_id)?;
    let path=if let Some(run_id)=automation_run_id{automation_worktrees::existing(&state.data_dir,&primary,&repository_id,&run_id)?}else{primary};
    state.agents.cancel_checkout(&repository_id,&path)
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
async fn github_ci_runs(repository_id: String, state: State<'_, AppState>) -> Result<Vec<github::CiRun>, github::CiPollError> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || github::ci_runs(&db, &repository_id)).await.map_err(|e| github::CiPollError::from(e.to_string()))?
}
#[tauri::command]
async fn github_repository_events(repository_id:String,state:State<'_,AppState>)->Result<Vec<github::RepositoryEvent>,String>{
    let db=state.db.clone();
    tauri::async_runtime::spawn_blocking(move||github::repository_events(&db,&repository_id)).await.map_err(|error|error.to_string())?
}
#[tauri::command]
async fn clone_github_repository(identity_id: String, full_name: String, parent: String, state: State<'_, AppState>) -> Result<ImportResult, String> {
    let db = state.db.clone();
    let git = state.git.clone();
    tauri::async_runtime::spawn_blocking(move || github::clone_repository(&db, &git, &identity_id, &full_name, Path::new(&parent))).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn open_in_cursor(repository_id: String, conversation_id: Option<String>, state: State<AppState>) -> Result<(), String> {
    let path = state.db.repository_path(&repository_id)?;
    let steps = cursor_launch::plan(&path, conversation_id.as_deref());
    launch_cursor(&steps[0])?;
    let later = steps.into_iter().skip(1).collect::<Vec<_>>();
    std::thread::spawn(move || {
        for step in later {
            std::thread::sleep(std::time::Duration::from_millis(800));
            let _ = launch_cursor(&step);
        }
    });
    Ok(())
}
fn launch_cursor(args: &[String]) -> Result<(), String> {
    Command::new("cursor").args(args).spawn().map(|_| ()).map_err(|e| format!("Could not launch Cursor: {e}. Install the cursor shell command and make it available on PATH."))
}

#[tauri::command]
fn list_repositories(state: State<AppState>) -> Result<Vec<Repository>, String> { state.db.list() }
#[tauri::command]
async fn sync_repository_remotes(state:State<'_,AppState>)->Result<Vec<Repository>,String>{
    let db=state.db.clone();let git=state.git.clone();
    tauri::async_runtime::spawn_blocking(move||{
        for repo in db.list()?{
            let path=Path::new(&repo.local_path);
            if git.root(path).is_err(){continue}
            let origin=git.remote_url(path);
            let canonical=origin.as_deref().map(canonical_remote);
            let host=host_type(origin.as_deref());
            if canonical!=repo.canonical_remote || host!=repo.host_type {db.save_remote(&repo.id,canonical.as_deref(),host)?;}
        }
        db.list()
    }).await.map_err(|e|e.to_string())?
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
        if provider == "codex" { codex.configure(&executable) } else if provider == "cursor" { cursor.configure(&executable) } else { provider_paths::save(&root, &provider, &executable) }
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
async fn cursor_archive_thread(repository_id: String, thread_id: String, archived: bool, state: State<'_, AppState>) -> Result<(), String> {
    let path = state.db.repository_path(&repository_id)?;
    let service = state.cursor.clone();
    tauri::async_runtime::spawn_blocking(move || service.archive_thread(&path, &thread_id, archived)).await.map_err(|e| e.to_string())?
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
async fn copilot_threads(repository_id:String,archived:bool,state:State<'_,AppState>)->Result<codex::ThreadPage,String>{
    let path=state.db.repository_path(&repository_id)?;
    tauri::async_runtime::spawn_blocking(move||copilot_history::threads(&path,archived)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn copilot_messages(repository_id:String,thread_id:String,state:State<'_,AppState>)->Result<codex::MessagePage,String>{
    let path=state.db.repository_path(&repository_id)?;
    tauri::async_runtime::spawn_blocking(move||copilot_history::messages(&path,&thread_id)).await.map_err(|e|e.to_string())?
}

#[tauri::command]
async fn claude_threads(repository_id:String, archived:bool, state:State<'_,AppState>)->Result<codex::ThreadPage,String>{
    let path=state.db.repository_path(&repository_id)?;
    tauri::async_runtime::spawn_blocking(move||claude_history::threads(&path,archived)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn claude_messages(repository_id:String,thread_id:String,state:State<'_,AppState>)->Result<codex::MessagePage,String>{
    let path=state.db.repository_path(&repository_id)?;
    tauri::async_runtime::spawn_blocking(move||claude_history::messages(&path,&thread_id)).await.map_err(|e|e.to_string())?
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
async fn codex_update_thread(repository_id: String, thread_id: String, action: String, name: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    let path = state.db.repository_path(&repository_id)?;
    let service = state.codex.clone();
    tauri::async_runtime::spawn_blocking(move || service.update_thread(&path, &thread_id, &action, name.as_deref())).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn list_identities(state: State<AppState>) -> Result<Vec<Identity>, String> {
    let mut identities = state.db.identities()?;
    let connected = std::thread::scope(|scope| {
        let checks = identities.iter().map(|identity| {
            let id = identity.id.clone();
            scope.spawn(move || oauth::github_connected(&id))
        }).collect::<Vec<_>>();
        checks.into_iter().map(|check| check.join().unwrap_or(false)).collect::<Vec<_>>()
    });
    for (identity, connected) in identities.iter_mut().zip(connected) { identity.connected = connected; }
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
    if !identity_id.trim().is_empty() {
        let remote = state
            .db
            .list()?
            .into_iter()
            .find(|repo| repo.id == repository_id)
            .and_then(|repo| repo.canonical_remote);
        github::ensure_identity_access(&identity_id, remote.as_deref())?;
    }
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
async fn branch_removal_plan(repository_id:String,branch:String,state:State<'_,AppState>)->Result<branch_removal::Plan,String>{
    let path=state.db.repository_path(&repository_id)?;
    let remote=std::env::var("REMOTE").ok().filter(|value|!value.is_empty()).unwrap_or_else(||"origin".into());
    tauri::async_runtime::spawn_blocking(move||branch_removal::plan(&path,&branch,Some(&remote))).await.map_err(|error|error.to_string())?
}
#[tauri::command]
async fn remove_branch(repository_id:String,plan:branch_removal::Plan,confirmed_unmerged_head:Option<String>,state:State<'_,AppState>)->Result<branch_removal::ResultDetails,String>{
    let path=state.db.repository_path(&repository_id)?;
    tauri::async_runtime::spawn_blocking(move||branch_removal::remove(&path,plan,confirmed_unmerged_head.as_deref())).await.map_err(|error|error.to_string())?
}

#[tauri::command]
async fn commit_history(repository_id: String, branch: Option<String>, skip: u32, state: State<'_,AppState>) -> Result<Vec<models::Commit>, String> {
    let path = state.db.repository_path(&repository_id)?;
    let git=state.git.clone();
    tauri::async_runtime::spawn_blocking(move||git.history(&path, branch.as_deref(), skip).map_err(|e| e.to_string())).await.map_err(|error|error.to_string())?
}

#[tauri::command]
fn reorder_repositories(repository_ids: Vec<String>, state: State<AppState>) -> Result<(), String> {
    state.db.reorder(&repository_ids)
}

#[tauri::command]
async fn update_repository(repository_id:String,update:RepositoryUpdate,state:State<'_,AppState>)->Result<Repository,String>{
    let db=state.db.clone();let git=state.git.clone();
    tauri::async_runtime::spawn_blocking(move||repository_creation::configure(&db,&git,&repository_id,update)).await.map_err(|error|error.to_string())?
}

#[tauri::command]
fn remove_repository(repository_id: String, state: State<AppState>) -> Result<(), String> {
    state.db.remove(&repository_id)
}

#[tauri::command]
async fn create_repository(update:RepositoryUpdate,state:State<'_,AppState>)->Result<ImportResult,String>{
    let db=state.db.clone();let git=state.git.clone();
    tauri::async_runtime::spawn_blocking(move||repository_creation::create(&db,&git,update)).await.map_err(|error|error.to_string())?
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
    if !permitted_external_url(&url) {
        return Err("External URL is not permitted".into());
    }
    open_url::that(url).map_err(|e| e.to_string())
}

fn permitted_external_url(url:&str)->bool{
    permitted_github_url(url) || matches!(url, "https://platform.openai.com/settings/organization/billing/" | "https://platform.openai.com/api-keys" | "https://cursor.com/dashboard" | "https://cursor.com/dashboard/spending" | "https://claude.ai/settings/usage" | "https://developers.openai.com/codex/cli/" | "https://cursor.com/docs/cli/installation" | "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli" | "https://code.claude.com/docs/en/setup")
}

#[cfg(test)]
mod external_url_tests {
    use super::permitted_external_url;
    #[test]
    fn usage_pages_are_permitted(){
        for url in ["https://cursor.com/dashboard/spending","https://claude.ai/settings/usage","https://github.com/settings/copilot","https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli","https://code.claude.com/docs/en/setup"]{
            assert!(permitted_external_url(url),"{url}");
        }
        assert!(!permitted_external_url("https://cursor.com/dashboard/spending?redirect=https://example.com"));
    }
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
            cursor_notifications::start(app.handle().clone());
            app.manage(AppState {
                conversations:Arc::new(conversation_store::ConversationStore::open(&data).map_err(std::io::Error::other)?),
                db: Arc::new(db),
                git: GitService::default(),
                agents: Arc::new(agents::Agents::default()),
                drafts: Arc::new(draft_runs::DraftRuns::default()),
                repository_watchers: Arc::new(repository_watcher::RepositoryWatchers::default()),
                chatgpt:Arc::new(chatgpt_accounts::ChatgptAccounts::default()),
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
            provider_setup_status, set_provider_path,
            chatgpt_settings, assign_chatgpt_account, begin_chatgpt_login, poll_chatgpt_login, cancel_chatgpt_login, disconnect_chatgpt,
            external_identities, external_identity_snapshot, external_identity_settings, assign_external_identity, default_external_identity, login_external_identity, logout_external_identity,
            copilot_repository_snapshot,
            save_agent_conversation, agent_conversations, local_activity_presence, cleanup_automation_checkout, agent_profiles, chatgpt_capabilities, save_agent_profile, remove_agent_profile, run_agent, agent_resume_status, cancel_agent, prompt_capability, submit_saved_prompt, run_new_agent_conversation, cancel_draft, run_automation_shell, watch_automation_repositories, repository_changed_lines, repository_changed_lines_batch, repository_change_summary, repository_commit_state, repository_commit_states_batch, delete_automation_log, sweep_automation_checkouts, write_automation_log, list_automation_logs, read_automation_log, handoff_output_path, publish_handoff, has_pending_handoff, handoff_settings, save_handoff_settings, list_matching_handoffs, claim_selected_handoff, claim_handoff, retry_handoff, handoff_retained, finish_handoff, release_handoff, cleanup_stale_handoffs,
            install_provider,
            cancel_provider_install,
            configure_cursor,
            claude_threads, claude_messages, copilot_threads, copilot_messages,
            cursor_threads,
            cursor_messages,
            cursor_archive_thread,
            configure_codex,
            codex_account,
            codex_login,
            codex_cancel_login,
            codex_threads,
            codex_messages,
            codex_update_thread,
            list_repositories, sync_repository_remotes,
            github_repositories,
            github_ci_runs,
            github_repository_events,
            link_repository_folder,
            clone_github_repository,
            open_in_cursor,
            list_branches, branch_removal_plan, remove_branch,
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
        .build(tauri::generate_context!())
        .expect("error while building GitCerberus")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) { app.state::<AppState>().agents.cancel_all(); }
        });
}

#[cfg(test)] mod codex_catalog_tests {
 use super::*;
 #[test] fn signed_out_account_hides_unverified_catalog_without_reading_usage(){
  let mut calls=Vec::new();
  let result=codex_capabilities(|method,_|{calls.push(method.to_owned());match method{"account/read"=>Ok(serde_json::json!({"account":null})),"model/list"=>Ok(serde_json::json!({"data":[{"model":"available-model"}],"nextCursor":null})),_=>panic!("Usage must not be read for an unverified account")}},None,||panic!("Signed out accounts must not query the live catalog")).unwrap();
  assert!(result["models"].as_array().unwrap().is_empty());assert!(result["usage"].is_null());assert!(!result["usageError"].as_str().unwrap().is_empty());assert_eq!(calls,vec!["account/read","model/list"]);
 }
 #[test] fn verified_account_retains_paginated_catalog_and_usage(){
  let result=codex_capabilities(|method,params|Ok(match method{"account/read"=>serde_json::json!({"account":{"type":"chatgpt","email":"test@example.test"}}),"model/list" if params["cursor"].is_null()=>serde_json::json!({"data":[{"model":"first"}],"nextCursor":"page-two"}),"model/list"=>serde_json::json!({"data":[{"model":"second"}],"nextCursor":null}),"account/rateLimits/read"=>serde_json::json!({"rateLimits":{}}),_=>panic!("Unexpected request")}),Some("test@example.test"),||Ok(serde_json::json!({"models":[{"slug":"first","visibility":"list"},{"slug":"second","visibility":"list"}]}))).unwrap();
  assert_eq!(result["models"].as_array().unwrap().len(),2);assert!(!result["usage"].is_null());assert!(result["usageError"].is_null());
 }
}
