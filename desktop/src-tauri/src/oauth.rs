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
        return Err(
            "GitHub CLI is not signed in. Run `gh auth login` in a terminal, then try again."
                .into(),
        );
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if token.is_empty() {
        return Err("GitHub CLI did not return an access token".into());
    }
    Ok(token)
}

pub fn begin(client_id: &str) -> Result<GithubDeviceFlow, String> {
    let client_id = resolve_client_id(Some(client_id))?;
    let response = client()?
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id.as_str()),
            ("scope", "read:user user:email repo"),
        ])
        .send()
        .map_err(|e| format!("GitHub device authorization failed: {e}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|e| format!("Could not read GitHub device authorization response: {e}"))?;

    parse_device_flow_response(&body, status.is_success(), client_id)
}

#[derive(Deserialize)]
struct DeviceFlowResponse {
    device_code: Option<String>,
    user_code: Option<String>,
    verification_uri: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
    error: Option<String>,
    error_description: Option<String>,
}

fn parse_device_flow_response(
    body: &str,
    status_success: bool,
    client_id: String,
) -> Result<GithubDeviceFlow, String> {
    let response: DeviceFlowResponse = serde_json::from_str(body)
        .map_err(|error| format!("Invalid GitHub device authorization response: {error}"))?;

    if let Some(error) = response.error {
        return Err(response.error_description.unwrap_or(error));
    }
    if !status_success {
        return Err("GitHub rejected the device authorization request".into());
    }

    Ok(GithubDeviceFlow {
        device_code: response
            .device_code
            .ok_or("GitHub returned no device code")?,
        user_code: response.user_code.ok_or("GitHub returned no user code")?,
        verification_uri: response
            .verification_uri
            .ok_or("GitHub returned no verification URL")?,
        expires_in: response.expires_in.unwrap_or(900),
        interval: response.interval.unwrap_or(5),
        client_id,
    })
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

#[cfg(test)]
mod tests {
    use super::parse_device_flow_response;

    #[test]
    fn parses_githubs_snake_case_device_response() {
        let body = r#"{"device_code":"device","user_code":"ABCD-EFGH","verification_uri":"https://github.com/login/device","expires_in":899,"interval":5}"#;
        let flow = parse_device_flow_response(body, true, "client".into()).unwrap();

        assert_eq!(flow.device_code, "device");
        assert_eq!(flow.user_code, "ABCD-EFGH");
        assert_eq!(flow.client_id, "client");
    }

    #[test]
    fn reports_githubs_device_flow_error() {
        let body =
            r#"{"error":"device_flow_disabled","error_description":"Device Flow must be enabled"}"#;
        let error = parse_device_flow_response(body, true, "client".into()).unwrap_err();

        assert_eq!(error, "Device Flow must be enabled");
    }
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

pub fn github_connected(id: &str) -> bool {
    crate::github_credentials::token(id).is_ok()
}
pub fn github_token(id: &str) -> Result<String,String> {
    crate::github_credentials::token(id)
}
pub fn disconnect_github_identity(id: &str) -> Result<(), String> {
    crate::github_credentials::disconnect(id)
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
    crate::github_credentials::save(&identity.id, access_token)?;
    Ok(identity)
}
