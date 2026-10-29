//! Provider identity synchronization. API secrets stay in the OS keyring.
use crate::feedback::{Config, SenderIdentity};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    time::Duration,
};
const CORE: &str = "urn:ietf:params:jmap:core";
const SUBMISSION: &str = "urn:ietf:params:jmap:submission";
#[derive(Clone, Default, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Identity {
    pub id: String,
    pub email: String,
    pub name: String,
    pub may_delete: bool,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub enabled: bool,
    pub account_id: String,
    pub state: String,
    pub baseline: Vec<Identity>,
}
fn credential(id: &str, c: &Config) -> Result<keyring::Entry, String> {
    #[cfg(target_os = "linux")]
    let entry = keyring::Entry::new_with_target(
        "GitCerberus",
        "dev.gitcerberus.sender-sync",
        &format!("{id}:{}", c.username.to_lowercase()),
    );
    #[cfg(not(target_os = "linux"))]
    let entry = keyring::Entry::new(
        "dev.gitcerberus.sender-sync",
        &format!("{id}:{}", c.username.to_lowercase()),
    );
    entry.map_err(|_| "Sender sync credential storage unavailable".into())
}
fn address(value: &str) -> bool {
    !value.contains('*') && value.parse::<lettre::Address>().is_ok()
}
fn api_url(url: &str) -> Result<(), String> {
    let u = url::Url::parse(url).map_err(|_| "Invalid identity API endpoint")?;
    if u.scheme() != "https"
        || u.host_str() != Some("api.fastmail.com")
        || u.port().is_some_and(|p| p != 443)
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return Err("Untrusted identity API endpoint".into());
    }
    Ok(())
}
fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Cannot initialize identity API client".into())
}
fn response(r: reqwest::blocking::Response) -> Result<Value, String> {
    use std::io::Read;
    if !r.status().is_success() {
        return Err(format!(
            "Sender identity API returned HTTP {}. Check API authorization.",
            r.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    r.take(2_000_001)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read sender identity response")?;
    if bytes.len() > 2_000_000 {
        return Err("Identity API response is too large".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid identity API response".into())
}
fn call(
    client: &reqwest::blocking::Client,
    url: &str,
    token: &str,
    method: &str,
    args: Value,
) -> Result<Value, String> {
    api_url(url)?;
    let v = response(
        client
            .post(url)
            .bearer_auth(token)
            .json(&json!({"using":[CORE,SUBMISSION],"methodCalls":[[method,args,"identities"]]}))
            .send()
            .map_err(|_| "Cannot reach sender identity API")?,
    )?;
    let result = v["methodResponses"]
        .as_array()
        .and_then(|a| a.iter().find(|r| r[2] == "identities"))
        .ok_or("Identity API did not return the requested result")?;
    if result[0] != method {
        return Err(format!(
            "Sender identity operation failed: {}",
            result[1]["type"].as_str().unwrap_or("unknown error")
        ));
    }
    Ok(result[1].clone())
}
fn fetch(
    client: &reqwest::blocking::Client,
    url: &str,
    token: &str,
    account: &str,
) -> Result<(String, Vec<Identity>), String> {
    let v = call(
        client,
        url,
        token,
        "Identity/get",
        json!({"accountId":account,"ids":null,"properties":["id","email","name","mayDelete"]}),
    )?;
    let state = v["state"]
        .as_str()
        .ok_or("Identity API omitted its state")?
        .to_owned();
    let list: Vec<Identity> =
        serde_json::from_value(v["list"].clone()).map_err(|_| "Invalid identity list")?;
    let mut ids = HashSet::new();
    if list.iter().any(|i| {
        i.id.is_empty() || !ids.insert(i.id.clone()) || i.name.chars().any(char::is_control)
    }) {
        return Err("Identity API returned invalid identities".into());
    }
    Ok((state, list))
}
/// Only fields edited in Cerberus are patched; signatures, Reply-To and Bcc stay untouched.
fn changes(c: &Config, base: &Settings) -> Result<Value, String> {
    let primary = base
        .baseline
        .iter()
        .find(|i| i.email.eq_ignore_ascii_case(&c.address))
        .ok_or("The default sender changed. Reconnect sender sync first.")?;
    let mut desired = vec![(primary.id.clone(), c.address.clone(), c.sender_name.clone())];
    desired.extend(
        c.sender_identities
            .iter()
            .map(|i| (i.id.clone(), i.address.clone(), i.name.clone())),
    );
    let old: HashMap<_, _> = base.baseline.iter().map(|i| (i.id.as_str(), i)).collect();
    let mut update = serde_json::Map::new();
    let mut create = serde_json::Map::new();
    let mut destroy = Vec::new();
    let mut kept = HashSet::new();
    for (id, email, name) in desired {
        if !address(&email) || name.chars().any(char::is_control) {
            return Err("Invalid sender identity".into());
        }
        if let Some(before) = old.get(id.as_str()) {
            if !kept.insert(id.clone()) {
                return Err("Duplicate sender identity".into());
            }
            if !before.email.eq_ignore_ascii_case(&email) {
                return Err(
                    "Server identity addresses cannot be renamed. Add a new identity instead."
                        .into(),
                );
            }
            if before.name != name {
                update.insert(id, json!({"name":name}));
            }
        } else {
            if !id.is_empty() && !id.starts_with("local:") {
                return Err("Unknown server identity; refresh before saving".into());
            }
            create.insert(
                format!("new{}", create.len()),
                json!({"email":email,"name":name}),
            );
        }
    }
    for before in &base.baseline {
        // Wildcard identities cannot be represented as concrete sender choices. Never delete them.
        if address(&before.email) && !kept.contains(&before.id) {
            if !before.may_delete {
                return Err("This server identity cannot be removed".into());
            }
            destroy.push(before.id.clone());
        }
    }
    Ok(
        json!({"accountId":base.account_id,"ifInState":base.state,"create":create,"update":update,"destroy":destroy}),
    )
}
fn dirty(p: &Value) -> bool {
    p["create"].as_object().is_some_and(|m| !m.is_empty())
        || p["update"].as_object().is_some_and(|m| !m.is_empty())
        || p["destroy"].as_array().is_some_and(|v| !v.is_empty())
}
fn import(
    c: &mut Config,
    account: String,
    state: String,
    list: Vec<Identity>,
) -> Result<(), String> {
    let primary=list.iter().find(|i|i.email.eq_ignore_ascii_case(&c.address)).ok_or("The default sender was removed on the server. Choose an existing account address before reconnecting.")?;
    let old = c.sender_identities.clone();
    c.sender_name = primary.name.clone();
    c.sender_identities = list
        .iter()
        .filter(|i| i.id != primary.id && address(&i.email))
        .map(|i| SenderIdentity {
            identity_name: old
                .iter()
                .find(|o| o.id == i.id)
                .or_else(|| {
                    let matches: Vec<_> = old
                        .iter()
                        .filter(|o| o.address.eq_ignore_ascii_case(&i.email))
                        .collect();
                    if matches.len() == 1 {
                        Some(matches[0])
                    } else {
                        None
                    }
                })
                .map(|o| o.identity_name.clone())
                .unwrap_or_default(),
            id: i.id.clone(),
            address: i.email.clone(),
            name: i.name.clone(),
            may_delete: Some(i.may_delete),
        })
        .collect();
    c.sender_sync = Some(Settings {
        enabled: true,
        account_id: account,
        state,
        baseline: list,
    });
    Ok(())
}
pub fn synchronize(
    root: &Path,
    id: &str,
    form: Option<Config>,
    token: Option<String>,
    push: bool,
) -> Result<Config, String> {
    let persist = form.is_none();
    let original = crate::feedback::config(root, id)?
        .ok_or("Save this mailbox before connecting sender synchronization")?;
    let mut c = form.unwrap_or_else(|| original.clone());
    if c.provider != "fastmail" {
        return Err("This provider has no supported read/write sender-identity API. Manual identities remain available; Proton addresses must be managed in Proton, and Purelymail webmail identities are not exposed by its routing API.".into());
    }
    if c.username != original.username || c.imap_host != original.imap_host {
        return Err("Save the mailbox account change before connecting identity sync".into());
    }
    let token_supplied = token.as_ref().is_some_and(|t| !t.is_empty());
    let secret = token.filter(|t| !t.is_empty()).map(Ok).unwrap_or_else(|| {
        credential(id, &c)?.get_password().map_err(|_| {
            "Sender sync API token is missing or its password store is unavailable".to_string()
        })
    })?;
    let client = client()?;
    let session = response(
        client
            .get("https://api.fastmail.com/jmap/session")
            .bearer_auth(&secret)
            .send()
            .map_err(|_| "Cannot reach Fastmail identity service")?,
    )?;
    let account = session["primaryAccounts"][SUBMISSION]
        .as_str()
        .ok_or("API token needs JMAP submission/identity permission")?
        .to_owned();
    let url = session["apiUrl"]
        .as_str()
        .ok_or("Identity service omitted its endpoint")?;
    api_url(url)?;
    let (state, list) = fetch(&client, url, &secret, &account)?;
    if !list.iter().any(|i| {
        i.email.eq_ignore_ascii_case(&c.username) || i.email.eq_ignore_ascii_case(&c.address)
    }) {
        return Err("API token does not match this mailbox's sender addresses".into());
    }
    if push {
        let base = c
            .sender_sync
            .as_ref()
            .filter(|s| s.enabled)
            .ok_or("Connect sender sync before publishing changes")?;
        if base.account_id != account {
            return Err("API account changed; reconnect before saving".into());
        }
        let patch = changes(&c, base)?;
        if dirty(&patch) {
            if base.state != state {
                return Err("Sender identities changed on the server. Refresh before saving to avoid overwriting them; local edits are retained.".into());
            }
            let result = call(&client, url, &secret, "Identity/set", patch)?;
            if ["notCreated", "notUpdated", "notDestroyed"]
                .iter()
                .any(|k| result[*k].as_object().is_some_and(|m| !m.is_empty()))
            {
                return Err("The server rejected some identity changes (for example an unauthorized address). Some changes may have succeeded. Refresh before retrying; local edits are retained.".into());
            }
            let (state, list) = fetch(&client, url, &secret, &account)?;
            import(&mut c, account, state, list)?;
        } else {
            import(&mut c, account, state, list)?;
        }
    } else {
        import(&mut c, account, state, list)?;
    }
    if token_supplied {
        credential(id, &c)?
            .set_password(&secret)
            .map_err(|_| "Cannot save identity API token in the system password store")?;
    }
    if persist {
        let current = crate::feedback::config(root, id)?.ok_or("Mailbox was removed")?;
        if serde_json::to_value(&current).map_err(|e| e.to_string())?
            != serde_json::to_value(&original).map_err(|e| e.to_string())?
        {
            return Err("Mailbox settings changed during identity sync. Refresh and retry.".into());
        }
        crate::feedback::save(root, id, c.clone(), None)?;
    }
    Ok(c)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Config {
        Config {
            address: "primary@example.org".into(),
            sender_name: "Primary".into(),
            sender_identities: vec![SenderIdentity {
                identity_name: "Support".into(),
                id: "alias".into(),
                address: "alias@example.org".into(),
                name: "New name".into(),
                may_delete: Some(true),
            }],
            sender_sync: Some(Settings {
                enabled: true,
                account_id: "account".into(),
                state: "s1".into(),
                baseline: vec![
                    Identity {
                        id: "primary".into(),
                        email: "primary@example.org".into(),
                        name: "Primary".into(),
                        may_delete: false,
                    },
                    Identity {
                        id: "alias".into(),
                        email: "alias@example.org".into(),
                        name: "Old name".into(),
                        may_delete: true,
                    },
                    Identity {
                        id: "wild".into(),
                        email: "*@example.org".into(),
                        name: "Wildcard".into(),
                        may_delete: true,
                    },
                ],
            }),
            ..Default::default()
        }
    }
    #[test]
    fn provider_refresh_preserves_local_automation_identity_names() {
        let mut c = fixture();
        c.sender_identity_name = "General".into();
        let list = c.sender_sync.as_ref().unwrap().baseline.clone();
        import(&mut c, "account".into(), "s2".into(), list).unwrap();
        assert_eq!(c.sender_identity_name, "General");
        assert_eq!(c.sender_identities[0].identity_name, "Support");
        let patch = changes(&c, c.sender_sync.as_ref().unwrap()).unwrap();
        assert!(!dirty(&patch));
        // New provider IDs after creating a local alias retain an unambiguous name/address mapping.
        c.sender_identities[0].id = "local:new".into();
        let list = c.sender_sync.as_ref().unwrap().baseline.clone();
        import(&mut c, "account".into(), "s3".into(), list).unwrap();
        assert_eq!(c.sender_identities[0].identity_name, "Support");
        c.sender_identities[0].identity_name = "Billing".into();
        assert!(!dirty(
            &changes(&c, c.sender_sync.as_ref().unwrap()).unwrap()
        ));
    }
    #[test]
    fn patches_only_changed_fields_and_preserves_wildcard() {
        let c = fixture();
        let p = changes(&c, c.sender_sync.as_ref().unwrap()).unwrap();
        assert_eq!(p["update"]["alias"], json!({"name":"New name"}));
        assert!(p["destroy"].as_array().unwrap().is_empty());
        assert_eq!(p["ifInState"], "s1");
    }
    #[test]
    fn deletion_and_creation_are_explicit() {
        let mut c = fixture();
        c.sender_identities = vec![SenderIdentity {
            identity_name: "New role".into(),
            id: "local:new".into(),
            address: "new@example.org".into(),
            name: "New".into(),
            may_delete: None,
        }];
        let p = changes(&c, c.sender_sync.as_ref().unwrap()).unwrap();
        assert_eq!(p["destroy"], json!(["alias"]));
        assert_eq!(p["create"]["new0"]["email"], "new@example.org");
    }
    #[test]
    fn immutable_addresses_and_non_deletable_identities_are_protected() {
        let mut c = fixture();
        c.sender_identities[0].address = "changed@example.org".into();
        assert!(changes(&c, c.sender_sync.as_ref().unwrap()).is_err());
        c = fixture();
        c.sender_sync.as_mut().unwrap().baseline[1].may_delete = false;
        c.sender_identities.clear();
        assert!(changes(&c, c.sender_sync.as_ref().unwrap()).is_err());
    }
    #[test]
    fn api_credentials_cannot_follow_untrusted_endpoints() {
        assert!(api_url("https://api.fastmail.com/jmap/api/").is_ok());
        for u in [
            "http://api.fastmail.com/",
            "https://example.org/",
            "https://api.fastmail.com.attacker.org/",
            "https://user@api.fastmail.com/",
        ] {
            assert!(api_url(u).is_err());
        }
    }
}
