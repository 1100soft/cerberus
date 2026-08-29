use crate::{
    db::Database,
    models::{GithubAuthStatus, GithubDeviceFlow, Identity},
};
use reqwest::blocking::Client;
use serde::Deserialize;
use std::process::Command;

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const API_URL: &str = "https://api.github.com";

fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("GitCerberus/0.1")
        .build()
        .map_err(|e| e.to_string())
}

pub fn resolve_client_id(provided: Option<&str>) -> Result<String, String> {
    if let Some(id) = provided.map(str::trim).filter(|value| !value.is_empty()) {
        return Ok(id.to_owned());
    }
    if let Ok(id) = std::env::var("GITCERBERUS_GITHUB_CLIENT_ID") {
        let id = id.trim();
        if !id.is_empty() {
            return Ok(id.to_owned());
        }
    }
    if let Some(id) = option_env!("GITCERBERUS_GITHUB_CLIENT_ID").map(str::trim) {
        if !id.is_empty() {
            return Ok(id.to_owned());
        }
    }
    Err("Browser sign-in uses GitCerberus’s own GitHub OAuth app, not one you create. This build has no client ID yet—use GitHub CLI or a personal access token, or set GITCERBERUS_GITHUB_CLIENT_ID.".into())
}

pub fn auth_status() -> GithubAuthStatus {
    GithubAuthStatus {
        browser_sign_in: resolve_client_id(None).is_ok(),
        github_cli: github_cli_token().is_ok(),
    }
}

pub fn github_cli_token() -> Result<String, String> {
    let output = Command::new("gh")
        .args(["auth", "token"])
        .env("GH_PROMPT_DISABLED", "1")
        .output()
        .map_err(|_| "GitHub CLI (gh) is not installed or could not be started".to_string())?;
    if !output.status.success() {
        return Err("GitHub CLI is not signed in. Run `gh auth login` in a terminal, then try again.".into());
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if token.is_empty() {
        return Err("GitHub CLI did not return an access token".into());
    }
    Ok(token)
}

pub fn begin(client_id: &str) -> Result<GithubDeviceFlow, String> {
    let client_id = resolve_client_id(Some(client_id))?;
    let mut flow: GithubDeviceFlow = client()?
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[("client_id", client_id.as_str()), ("scope", "read:user user:email")])
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("GitHub device authorization failed: {e}"))?
        .json()
        .map_err(|e| format!("Invalid GitHub device authorization response: {e}"))?;
    flow.client_id = client_id;
    Ok(flow)
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}
#[derive(Deserialize)]
struct GithubUser {
    login: String,
    name: Option<String>,
    email: Option<String>,
}
#[derive(Deserialize)]
struct GithubEmail {
    email: String,
    primary: bool,
    verified: bool,
}

pub fn complete(
    db: &Database,
    client_id: &str,
    device_code: &str,
) -> Result<Option<Identity>, String> {
    let client_id = resolve_client_id(Some(client_id))?;
    let http = client()?;
    let token: TokenResponse = http
        .post(ACCESS_TOKEN_URL)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id.as_str()),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("GitHub token request failed: {e}"))?
        .json()
        .map_err(|e| format!("Invalid GitHub token response: {e}"))?;
    if matches!(
        token.error.as_deref(),
        Some("authorization_pending" | "slow_down")
    ) {
        return Ok(None);
    }
    if let Some(error) = token.error {
        return Err(token.error_description.unwrap_or(error));
    }
    let access_token = token
        .access_token
        .ok_or("GitHub returned no access token")?;
    identity_from_token(db, &access_token).map(Some)
}

pub fn identity_from_token(db: &Database, access_token: &str) -> Result<Identity, String> {
    let http = client()?;
    let user: GithubUser = http
        .get(format!("{API_URL}/user"))
        .bearer_auth(access_token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Could not read GitHub profile: {e}"))?
        .json()
        .map_err(|e| e.to_string())?;
    let emails: Vec<GithubEmail> = http
        .get(format!("{API_URL}/user/emails"))
        .bearer_auth(access_token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Could not read GitHub email: {e}"))?
        .json()
        .map_err(|e| e.to_string())?;
    let email = user
        .email
        .or_else(|| {
            emails
                .into_iter()
                .find(|e| e.primary && e.verified)
                .map(|e| e.email)
        })
        .ok_or("GitHub account has no accessible verified email")?;
    let name = user.name.as_deref().unwrap_or(&user.login);
    let identity = db.save_github_identity(&user.login, name, &email)?;
    keyring::Entry::new("dev.gitcerberus.app", &format!("github:{}", identity.id))
        .and_then(|entry| entry.set_password(access_token))
        .map_err(|e| format!("Could not save GitHub token in the system credential store: {e}"))?;
    Ok(identity)
}
