use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub id: String,
    pub label: String,
    pub git_name: String,
    pub git_email: String,
    pub color: Option<String>,
    pub provider_username: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubDeviceFlow {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    #[serde(default)]
    pub client_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubAuthStatus {
    pub browser_sign_in: bool,
    pub github_cli: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub id: String,
    pub display_name: String,
    pub local_path: String,
    pub canonical_remote: Option<String>,
    pub host_type: String,
    pub default_branch: Option<String>,
    pub branch: Option<String>,
    pub detached: bool,
    pub staged_count: u32,
    pub modified_count: u32,
    pub untracked_count: u32,
    pub ahead: u32,
    pub behind: u32,
    pub last_commit_summary: Option<String>,
    pub last_commit_at: Option<String>,
    pub identity: Option<Identity>,
    pub identity_mismatch: bool,
    pub tags: Vec<String>,
    pub manual_order: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub repository: Repository,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryUpdate {
    pub display_name: String,
    pub local_path: String,
    pub canonical_remote: Option<String>,
    pub host_type: String,
    pub default_branch: Option<String>,
    pub identity_id: Option<String>,
    pub tags: Vec<String>,
}
