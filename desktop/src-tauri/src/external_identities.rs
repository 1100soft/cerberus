use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path, process::{Command, Stdio}};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAccounts {
    #[serde(default)] pub default_accounts: BTreeMap<String, Option<String>>,
    #[serde(default)] pub repositories: BTreeMap<String, BTreeMap<String, Option<String>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalIdentity {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub connected: bool,
    pub detail: String,
}

fn executable(provider: &str) -> Result<&'static str, String> {
    match provider { "cursor" => Ok("cursor-agent"), "claude" => Ok("claude"), _ => Err("Unknown identity provider".into()) }
}
fn program(root: &Path, provider: &str) -> Result<std::path::PathBuf, String> {
    let tool = executable(provider)?;
    let resolved = if provider == "cursor" { "cursor-agent" } else { tool };
    crate::provider_paths::resolve(root, resolved)?.ok_or_else(|| format!("Install {tool} in provider setup first"))
}
fn status(root: &Path, provider: &str) -> Result<Option<ExternalIdentity>, String> {
    let exe = executable(provider)?;
    let program = program(root, provider)?;
    let args: &[&str] = if provider == "claude" { &["auth", "status"] } else { &["status"] };
    let output = Command::new(&program).args(args).output().map_err(|e| format!("{exe} is unavailable: {e}"))?;
    let detail = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let json: serde_json::Value = serde_json::from_str(&detail).unwrap_or_default();
    let connected = if provider == "claude" { json["loggedIn"].as_bool().unwrap_or(false) } else {
        output.status.success() && !detail.to_lowercase().contains("not authenticated") && !detail.to_lowercase().contains("not logged in")
    };
    if !connected { return Ok(None); }
    let email = json["email"].as_str().or_else(|| json["account"]["email"].as_str())
        .or_else(|| detail.lines().find_map(|line| line.split_whitespace().find(|word| word.contains('@') && word.contains('.'))));
    let label = email.map(|s| s.trim_matches(|c:char| c == ',' || c == '"').to_string()).unwrap_or_else(|| format!("{} account", if provider == "cursor" {"Cursor"} else {"Claude"}));
    Ok(Some(ExternalIdentity { id: format!("{provider}:{}", label.to_lowercase()), provider:provider.into(), label, connected:true, detail }))
}
pub fn identities(root: &Path) -> Vec<ExternalIdentity> {
    std::thread::scope(|scope| {
        let cursor=scope.spawn(||status(root,"cursor").ok().flatten());
        let claude=scope.spawn(||status(root,"claude").ok().flatten());
        [cursor.join().ok().flatten(),claude.join().ok().flatten()].into_iter().flatten().collect()
    })
}
pub fn login(root: &Path, provider: &str) -> Result<(), String> {
    let exe = executable(provider)?;
    let program = program(root, provider)?;
    let args: &[&str] = if provider == "claude" { &["auth", "login"] } else { &["login"] };
    let mut child = Command::new(&program).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
        .map_err(|e| format!("Could not start {exe} login: {e}"))?;
    std::thread::spawn(move || { let _ = child.wait(); });
    Ok(())
}
pub fn logout(root: &Path, provider: &str) -> Result<(), String> {
    let exe = executable(provider)?;
    let program = program(root, provider)?;
    let args: &[&str] = if provider == "claude" { &["auth", "logout"] } else { &["logout"] };
    let output = Command::new(&program).args(args).output().map_err(|e| format!("Could not run {exe} logout: {e}"))?;
    if output.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&output.stderr).to_string()) }
}
fn path(root: &Path) -> std::path::PathBuf {root.join("external-identity-assignments.json")}
pub fn settings(root: &Path) -> Result<ProviderAccounts,String> {
    settings_for(root,&identities(root))
}
pub fn settings_for(root:&Path,accounts:&[ExternalIdentity])->Result<ProviderAccounts,String>{
    let mut value:ProviderAccounts=if path(root).exists(){
        serde_json::from_slice(&std::fs::read(path(root)).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?
    }else{ProviderAccounts::default()};
    let mut changed=false;
    for provider in ["cursor","claude"] {
        let connected=accounts.iter().filter(|account|account.provider==provider).map(|account|account.id.clone()).collect::<Vec<_>>();
        changed|=crate::identity_defaults::reconcile(value.default_accounts.entry(provider.into()).or_default(),&connected);
    }
    if changed {write(root,&value)?;}
    Ok(value)
}
pub fn assign(root: &Path, provider: &str, repository: &str, account: Option<String>, inherit: bool) -> Result<ProviderAccounts,String> {
    executable(provider)?;
    if repository.is_empty() || repository.len()>2000 { return Err("Invalid repository".into()); }
    if let Some(ref id)=account {if !identities(root).iter().any(|item| &item.id==id && item.provider==provider) {return Err("Connect this account first".into());}}
    let mut value=settings(root)?;
    if inherit { value.repositories.entry(provider.into()).or_default().remove(repository); }
    else { value.repositories.entry(provider.into()).or_default().insert(repository.into(),account); }
    write(root,&value)?;
    Ok(value)
}
pub fn set_default(root:&Path,provider:&str,account:Option<String>) -> Result<ProviderAccounts,String> {
    executable(provider)?;
    if let Some(ref id)=account {if !identities(root).iter().any(|item| &item.id==id && item.provider==provider) {return Err("Connect this account first".into());}}
    let mut value=settings(root)?;
    value.default_accounts.insert(provider.into(),account);
    write(root,&value)?;
    Ok(value)
}
fn write(root:&Path,value:&ProviderAccounts)->Result<(),String>{
    let pending=root.join("external-identity-assignments.pending.json");
    std::fs::write(&pending,serde_json::to_vec_pretty(value).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    std::fs::rename(pending,path(root)).map_err(|e|e.to_string())
}
