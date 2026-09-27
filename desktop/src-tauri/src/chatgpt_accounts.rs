use crate::{
    agents::{Agents, Profile},
    codex::CodexService,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSettings {
    pub default_account: Option<String>,
    #[serde(default)]
    pub initialized: bool,
    #[serde(default)]
    pub repositories: BTreeMap<String, Option<String>>,
}
struct Login {
    account_id: String,
    login_id: String,
    service: Arc<CodexService>,
    expires: Instant,
}
#[derive(Default)]
pub struct ChatgptAccounts {
    pending: Mutex<Option<Login>>,
    settings_lock: Mutex<()>,
}
fn read_settings(root: &Path) -> Result<AccountSettings, String> {
    let path = root.join("chatgpt-accounts.json");
    if !path.exists() {
        return Ok(AccountSettings::default());
    }
    serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}
fn write_settings(root: &Path, settings: &AccountSettings) -> Result<(), String> {
    let path = root.join("chatgpt-accounts.pending");
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(path, root.join("chatgpt-accounts.json")).map_err(|e| e.to_string())
}
pub fn account_home(root: &Path, id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid ChatGPT account")?;
    let home = root.join("agent-homes").join(id);
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    Ok(home)
}
fn service(root: &Path, id: &str) -> Result<Arc<CodexService>, String> {
    Ok(Arc::new(CodexService::for_account(
        root.join("codex-executable.txt"),
        account_home(root, id)?,
    )))
}
impl ChatgptAccounts {
    pub fn ensure_default(&self, root:&Path, agents:&Agents)->Result<AccountSettings,String>{
        let _lock=self.settings_lock.lock().map_err(|e|e.to_string())?;
        let mut settings=read_settings(root)?;
        let connected=agents.profiles(root)?.into_iter().filter(|profile|profile.subscription&&!profile.disconnected).map(|profile|profile.id).collect::<Vec<_>>();
        if crate::identity_defaults::reconcile(&mut settings.default_account,&connected){
            settings.initialized=true;
            write_settings(root,&settings)?;
        }
        Ok(settings)
    }
    pub fn settings(&self, root: &Path) -> Result<AccountSettings, String> {
        let _lock = self.settings_lock.lock().map_err(|e| e.to_string())?;
        read_settings(root)
    }
    pub fn assign(
        &self,
        root: &Path,
        agents: &Agents,
        repository: Option<String>,
        account: Option<String>,
    ) -> Result<AccountSettings, String> {
        let _lock = self.settings_lock.lock().map_err(|e| e.to_string())?;
        if let Some(id) = &account {
            if !agents
                .profiles(root)?
                .iter()
                .any(|p| p.id == *id && p.subscription && !p.disconnected)
            {
                return Err("Choose a connected ChatGPT identity".into());
            }
        }
        let mut settings = read_settings(root)?;
        if let Some(repo) = repository {
            if repo.is_empty() || repo.len() > 2000 {
                return Err("Invalid repository".into());
            }
            settings.repositories.insert(repo, account);
        } else {
            settings.default_account = account;
            settings.initialized = true;
        }
        write_settings(root, &settings)?;
        Ok(settings)
    }
    pub fn inherit(&self, root: &Path, repository: &str) -> Result<AccountSettings, String> {
        let _lock = self.settings_lock.lock().map_err(|e| e.to_string())?;
        let mut settings = read_settings(root)?;
        settings.repositories.remove(repository);
        write_settings(root, &settings)?;
        Ok(settings)
    }
    pub fn begin(
        &self,
        root: &Path,
        agents: &Agents,
        id: Option<String>,
    ) -> Result<String, String> {
        let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
        if let Some(previous) = pending.take() {
            let _ = previous
                .service
                .request("account/login/cancel", json!({"loginId":previous.login_id}));
        }
        let id = if let Some(id) = id {
            if !agents
                .profiles(root)?
                .iter()
                .any(|p| p.id == id && p.subscription)
            {
                return Err("ChatGPT identity not found".into());
            }
            if agents.profile_running(&id)? {
                return Err("Stop this account's running chats before reconnecting".into());
            }
            id
        } else {
            uuid::Uuid::new_v4().to_string()
        };
        let service = service(root, &id)?;
        let login = service.request("account/login/start", json!({"type":"chatgpt"}))?;
        let login_id = login["loginId"]
            .as_str()
            .ok_or("No login identifier returned")?
            .to_string();
        let url = login["authUrl"].as_str().ok_or("No sign-in URL returned")?;
        let parsed = url::Url::parse(url).map_err(|e| e.to_string())?;
        if parsed.scheme() != "https"
            || !matches!(
                parsed.host_str(),
                Some("auth.openai.com" | "auth0.openai.com" | "chatgpt.com")
            )
        {
            let _ = service.request("account/login/cancel", json!({"loginId":login_id}));
            return Err("Unexpected sign-in URL".into());
        }
        if let Err(error) = crate::open_url::that(url.to_string()) {
            let _ = service.request("account/login/cancel", json!({"loginId":login_id}));
            return Err(error.to_string());
        }
        *pending = Some(Login {
            account_id: id.clone(),
            login_id,
            service,
            expires: Instant::now() + Duration::from_secs(600),
        });
        Ok(id)
    }
    pub fn poll(&self, root: &Path, agents: &Agents, id: &str) -> Result<Option<Profile>, String> {
        let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
        let login = pending
            .as_ref()
            .filter(|flow| flow.account_id == id)
            .ok_or("Sign-in was cancelled. Try again.")?;
        if Instant::now() > login.expires {
            let _ = login
                .service
                .request("account/login/cancel", json!({"loginId":login.login_id}));
            *pending = None;
            return Err("Sign-in expired. Try again.".into());
        }
        let value = login
            .service
            .request("account/read", json!({"refreshToken":false}))?;
        let account = &value["account"];
        match login.service.login_outcome(&login.login_id) {
            None => return Ok(None),
            Some(Err(error)) => {
                *pending = None;
                return Err(error);
            }
            Some(Ok(())) => {}
        }
        if account.is_null() {
            return Ok(None);
        }
        if account["type"] != "chatgpt" {
            return Err("Expected ChatGPT subscription authentication".into());
        }
        let email = account["email"].as_str().map(String::from);
        let plan = account["planType"].as_str().map(String::from);
        if let Some(old) = agents.profiles(root)?.iter().find(|p| p.id == id) {
            if old.email.is_some() && old.email != email {
                let _ = login.service.request("account/logout", json!({}));
                *pending = None;
                return Err("A different account was selected. Add it as a new identity, or reconnect with the original account.".into());
            }
        }
        let profile = Profile {
            id: id.into(),
            label: email.clone().unwrap_or_else(|| "ChatGPT account".into()),
            provider: "codex".into(),
            subscription: true,
            email,
            plan,
            ..Profile::default()
        };
        agents.store_subscription(root, profile.clone())?;
        {
            let _lock = self.settings_lock.lock().map_err(|e| e.to_string())?;
            let mut settings = read_settings(root)?;
            let connected=agents.profiles(root)?.into_iter().filter(|profile|profile.subscription&&!profile.disconnected).map(|profile|profile.id).collect::<Vec<_>>();
            if crate::identity_defaults::reconcile(&mut settings.default_account,&connected) {
                settings.initialized=true;
                write_settings(root, &settings)?;
            }
        }
        *pending = None;
        Ok(Some(profile))
    }
    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|e| e.to_string())?;
        if pending.as_ref().is_some_and(|flow| flow.account_id == id) {
            let login = pending.take().unwrap();
            login
                .service
                .request("account/login/cancel", json!({"loginId":login.login_id}))?;
        }
        Ok(())
    }
    pub fn disconnect(&self, root: &Path, agents: &Agents, id: &str) -> Result<(), String> {
        if agents.profile_running(id)? {
            return Err("Stop this account's running chats before disconnecting".into());
        }
        let mut profile = agents
            .profiles(root)?
            .into_iter()
            .find(|p| p.id == id && p.subscription)
            .ok_or("ChatGPT identity not found")?;
        self.cancel(id)?;
        service(root, id)?.request("account/logout", json!({}))?;
        profile.disconnected = true;
        agents.store_subscription(root, profile)?;
        self.ensure_default(root, agents).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_overrides_persist_without_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let agents = Agents::default();
        let accounts = ChatgptAccounts::default();
        for id in ["one", "two"] {
            agents
                .store_subscription(
                    root,
                    Profile {
                        id: id.into(),
                        subscription: true,
                        provider: "codex".into(),
                        ..Profile::default()
                    },
                )
                .unwrap();
        }
        assert!(!accounts.settings(root).unwrap().initialized);
        accounts
            .assign(root, &agents, None, Some("one".into()))
            .unwrap();
        accounts
            .assign(root, &agents, Some("repo-a".into()), Some("two".into()))
            .unwrap();
        accounts
            .assign(root, &agents, Some("repo-b".into()), None)
            .unwrap();
        accounts
            .assign(root, &agents, None, Some("two".into()))
            .unwrap();
        let saved = accounts.settings(root).unwrap();
        assert_eq!(saved.default_account.as_deref(), Some("two"));
        assert_eq!(saved.repositories["repo-a"].as_deref(), Some("two"));
        assert_eq!(saved.repositories["repo-b"], None);
        accounts.inherit(root, "repo-a").unwrap();
        assert!(!accounts
            .settings(root)
            .unwrap()
            .repositories
            .contains_key("repo-a"));
        assert!(accounts
            .assign(root, &agents, None, Some("unknown".into()))
            .is_err());
        let old: Profile = serde_json::from_value(
            json!({"id":"api","label":"API","provider":"codex","executable":""}),
        )
        .unwrap();
        assert!(!old.subscription);
    }
    #[test]
    #[cfg(unix)]
    fn login_waits_for_completion_and_first_account_becomes_default() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let script = root.join("mock-codex");
        std::fs::write(&script,r#"#!/usr/bin/env python3
import json,os,sys
assert 'CODEX_API_KEY' not in os.environ
assert 'OPENAI_API_KEY' not in os.environ
assert 'forced_login_method="chatgpt"' in sys.argv
assert 'cli_auth_credentials_store="keyring"' in sys.argv
reads=0
for line in sys.stdin:
 r=json.loads(line)
 if 'id' not in r: continue
 result={}
 if r['method']=='account/read':
  reads+=1
  if reads>1: print(json.dumps({'method':'account/login/completed','params':{'loginId':'login','success':True}}),flush=True)
  result={'account':{'type':'chatgpt','email':'fixture@example.test','planType':'plus'}}
 print(json.dumps({'id':r['id'],'result':result}),flush=True)
"#).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(root.join("codex-executable.txt"), script.to_str().unwrap()).unwrap();
        let accounts = ChatgptAccounts::default();
        let agents = Agents::default();
        let mut first = String::new();
        for _ in 0..2 {
            let id = uuid::Uuid::new_v4().to_string();
            if first.is_empty() {
                first = id.clone();
            }
            let service = service(root, &id).unwrap();
            *accounts.pending.lock().unwrap() = Some(Login {
                account_id: id.clone(),
                login_id: "login".into(),
                service,
                expires: Instant::now() + Duration::from_secs(20),
            });
            assert!(accounts.poll(root, &agents, &id).unwrap().is_none());
            let profile = accounts.poll(root, &agents, &id).unwrap().unwrap();
            assert!(profile.subscription);
            assert_eq!(profile.email.as_deref(), Some("fixture@example.test"));
            assert_eq!(
                accounts.settings(root).unwrap().default_account.as_deref(),
                Some(first.as_str())
            );
        }
    }
}
