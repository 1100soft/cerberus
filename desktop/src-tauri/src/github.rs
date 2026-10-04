//! GitHub catalog and explicit clones. Credentials never cross the IPC boundary.
use crate::{db::Database, git::GitService, models::ImportResult};
use base64::Engine;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepository {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub owner: String,
    pub private: bool,
    pub html_url: String,
    pub default_branch: Option<String>,
    pub updated_at: Option<String>,
    pub pushed_at: Option<String>,
    pub identity_id: String,
}
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub repositories: Vec<GithubRepository>,
    pub warnings: Vec<String>,
    pub failed_identity_ids: Vec<String>,
}
#[derive(Deserialize)]
struct Owner {
    login: String,
}
#[derive(Deserialize)]
struct Remote {
    id: u64,
    name: String,
    full_name: String,
    owner: Owner,
    private: bool,
    html_url: String,
    default_branch: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    pushed_at: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct CiRun {
    pub id: u64,
    #[serde(default = "first_attempt")]
    pub run_attempt: u32,
    pub name: String,
    pub head_branch: Option<String>,
    pub head_sha: String,
    pub conclusion: Option<String>,
    pub updated_at: String,
    pub html_url: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryEvent {
    pub id: String,
    pub kind: String,
    pub branch: String,
    pub sha: Option<String>,
    pub action: Option<String>,
    pub created_at: String,
    pub html_url: String,
}
fn first_attempt() -> u32 { 1 }
#[derive(Deserialize)]
struct CiRunsResponse { workflow_runs: Vec<CiRun> }

#[derive(Clone,Debug,Serialize)]
#[serde(rename_all="camelCase")]
pub struct CiPollError {pub kind:String,pub message:String,pub retry_after_seconds:Option<u64>}
impl From<String> for CiPollError {fn from(message:String)->Self{Self{kind:"configuration".into(),message,retry_after_seconds:None}}}
impl std::fmt::Display for CiPollError {fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result{write!(f,"{}",self.message)}}
fn ci_http_error(status:reqwest::StatusCode,headers:&reqwest::header::HeaderMap,now:u64)->CiPollError{
    let limited=status.as_u16()==429||(status.as_u16()==403&&(headers.get("x-ratelimit-remaining").is_some_and(|v|v=="0")||headers.contains_key("retry-after")));
    let retry=headers.get("retry-after").and_then(|v|v.to_str().ok()).and_then(|v|v.parse::<u64>().ok()).or_else(||headers.get("x-ratelimit-reset").and_then(|v|v.to_str().ok()).and_then(|v|v.parse::<u64>().ok()).map(|reset|reset.saturating_sub(now)+1));
    let (kind,message)=if limited{("rateLimit","GitHub rate limit reached; CI checks will resume after the retry delay.")}
    else if status.as_u16()==401{("authentication","GitHub rejected this account's credentials. Reconnect the assigned GitHub identity.")}
    else if status.as_u16()==403{("access","GitHub denied Actions access. Check the assigned account's Actions read permission and organization authorization.")}
    else if status.as_u16()==404{("access","GitHub could not find this repository or the assigned account cannot read its Actions runs.")}
    else if status.is_server_error(){("server","GitHub is temporarily unavailable; CI checks will retry.")}
    else{("response","GitHub returned an unexpected response while reading Actions runs.")};
    CiPollError{kind:kind.into(),message:format!("{message} (HTTP {})",status.as_u16()),retry_after_seconds:if limited{Some(retry.unwrap_or(60).max(1))}else{None}}
}
fn ci_transport_error(error:reqwest::Error)->CiPollError{
    let kind=if error.is_timeout(){"timeout"}else{"transport"};
    let error=error.without_url();let mut details=error.to_string();let mut source=std::error::Error::source(&error);
    while let Some(cause)=source{details.push_str(": ");details.push_str(&cause.to_string());source=cause.source();}
    CiPollError{kind:kind.into(),message:format!("Could not read GitHub Actions runs: {details}. CI checks will retry."),retry_after_seconds:None}
}
pub fn ci_runs(db: &Database, repository_id: &str) -> Result<Vec<CiRun>, CiPollError> {
    let repository = db.list()?.into_iter().find(|repo| repo.id == repository_id)
        .ok_or_else(|| "Repository is not linked on this device.".to_owned())?;
    let name = repository.canonical_remote.as_deref().and_then(github_name)
        .ok_or_else(|| "CI conditions require a GitHub repository.".to_owned())?;
    let identity = repository.identity.ok_or_else(|| "Assign a GitHub identity to check CI runs.".to_owned())?;
    if identity.provider_username.is_none() { return Err("Assign a connected GitHub identity to check CI runs.".to_owned().into()); }
    let response=client()?.get(format!("https://api.github.com/repos/{name}/actions/runs?event=push&status=completed&per_page=100"))
        .bearer_auth(token(&identity.id)?).header("Accept","application/vnd.github+json").header("X-GitHub-Api-Version","2022-11-28")
        .send().map_err(ci_transport_error)?;
    if !response.status().is_success(){return Err(ci_http_error(response.status(),response.headers(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()));}
    let runs: CiRunsResponse = response.json().map_err(|_|CiPollError{kind:"response".into(),message:"GitHub returned an invalid workflow-run response; CI checks will retry.".into(),retry_after_seconds:None})?;
    Ok(runs.workflow_runs)
}
pub fn repository_events(db:&Database,repository_id:&str)->Result<Vec<RepositoryEvent>,String>{
    let repository=db.list()?.into_iter().find(|repo|repo.id==repository_id).ok_or("Repository is not linked on this device")?;
    let name=repository.canonical_remote.as_deref().and_then(github_name).ok_or("GitHub events require a GitHub repository")?;
    let identity=repository.identity.ok_or("Assign a GitHub identity to check repository events")?;
    if identity.provider_username.is_none(){return Err("Assign a connected GitHub identity to check repository events".into());}
    let response=get(&client()?,&token(&identity.id)?,&format!("/repos/{name}/events?per_page=100"))?;
    let values:Vec<serde_json::Value>=response.json().map_err(|error|format!("Invalid GitHub events response: {error}"))?;
    Ok(values.into_iter().filter_map(|value|{
        let id=value["id"].as_str()?.to_owned();
        let created_at=value["created_at"].as_str()?.to_owned();
        let payload=&value["payload"];
        match value["type"].as_str()?{
            "PushEvent"=>{
                let branch=payload["ref"].as_str()?.strip_prefix("refs/heads/")?.to_owned();
                let sha=payload["head"].as_str().map(String::from);
                let html_url=sha.as_ref().map(|sha|format!("https://github.com/{name}/commit/{sha}")).unwrap_or_else(||format!("https://github.com/{name}"));
                Some(RepositoryEvent{id,kind:"push".into(),branch,sha,action:None,created_at,html_url})
            }
            "PullRequestEvent"=>{
                let branch=payload["pull_request"]["head"]["ref"].as_str()?.to_owned();
                let sha=payload["pull_request"]["head"]["sha"].as_str().map(String::from);
                let html_url=payload["pull_request"]["html_url"].as_str()?.to_owned();
                Some(RepositoryEvent{id,kind:"pullRequest".into(),branch,sha,action:payload["action"].as_str().map(String::from),created_at,html_url})
            }
            _=>None,
        }
    }).collect())
}
impl Remote {
    fn catalog(self, identity_id: &str) -> GithubRepository {
        GithubRepository {
            id: self.id,
            name: self.name,
            full_name: self.full_name,
            owner: self.owner.login,
            private: self.private,
            html_url: self.html_url,
            default_branch: self.default_branch,
            updated_at: self.updated_at,
            pushed_at: self.pushed_at,
            identity_id: identity_id.into(),
        }
    }
}
fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("GitCerberus/0.1")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}
fn token(id: &str) -> Result<String, String> {
    keyring::Entry::new("dev.gitcerberus.app", &format!("github:{id}"))
        .and_then(|entry| entry.get_password())
        .map_err(|_| "Reconnect this GitHub account to restore repository access.".into())
}
fn get(http: &Client, token: &str, path: &str) -> Result<reqwest::blocking::Response, String> {
    let request = http.get(format!("https://api.github.com{path}"));
    let request = if token.is_empty() {
        request
    } else {
        request.bearer_auth(token)
    };
    let response = request
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|_| "Could not reach GitHub. Check your connection and retry.".to_owned())?;
    if !response.status().is_success() {
        return Err(format!(
            "GitHub returned {}. Check account access, organization authorization, or rate limits.",
            response.status()
        ));
    }
    Ok(response)
}
pub fn catalog(db: &Database) -> Result<Catalog, String> {
    let http = client()?;
    let mut output = Catalog::default();
    let mut credentials = Vec::new();
    for identity in db
        .identities()?
        .into_iter()
        .filter(|i| i.provider_username.is_some())
    {
        let result = (|| -> Result<(), String> {
            let secret = token(&identity.id)?;
            credentials.push((identity.id.clone(), secret.clone()));
            let repositories = collect_pages(|page| {
                let response = get(&http, &secret, &format!("/user/repos?per_page=100&page={page}&affiliation=owner,collaborator,organization_member&sort=full_name&direction=asc"))?;
                if page == 1 {
                    if let Some(scopes) = response
                        .headers()
                        .get("x-oauth-scopes")
                        .and_then(|v| v.to_str().ok())
                    {
                        if !scopes.split(',').any(|scope| scope.trim() == "repo") {
                            output.warnings.push(format!("{}: reconnect with repository access to include private repositories.", identity.label));
                        }
                    }
                }
                response
                    .json()
                    .map_err(|e| format!("Invalid GitHub repository response: {e}"))
            })?;
            output.repositories.extend(
                repositories
                    .into_iter()
                    .map(|repo| repo.catalog(&identity.id)),
            );
            Ok(())
        })();
        if let Err(error) = result {
            output.failed_identity_ids.push(identity.id.clone());
            output.warnings.push(format!("{}: {error}", identity.label));
        }
    }
    // Imported public repositories need not be owned by a connected account.
    // Resolve them directly instead of treating absence from /user/repos as visibility.
    for local in db.list()? {
        let Some(remote) = local.canonical_remote.as_deref() else {
            continue;
        };
        let Some(name) = github_name(remote) else {
            continue;
        };
        if output
            .repositories
            .iter()
            .any(|repo| repo.full_name.eq_ignore_ascii_case(&name))
        {
            continue;
        }
        let mut resolved = None;
        for (identity_id, secret) in credentials
            .iter()
            .map(|(id, secret)| (id.as_str(), secret.as_str()))
            .chain(std::iter::once(("", "")))
        {
            if let Ok(response) = get(&http, secret, &format!("/repos/{name}")) {
                if let Ok(repo) = response.json::<Remote>() {
                    resolved = Some(repo.catalog(identity_id));
                    break;
                }
            }
        }
        if let Some(repo) = resolved {
            output.repositories.push(repo);
        } else {
            output.warnings.push(format!("Visibility unverified for {name}. Connect an account with access to this repository."));
        }
    }
    assign_unique_catalog_identities(db,&output)?;
    Ok(output)
}
fn unique_catalog_identity(catalog:&Catalog,remote:&str)->Option<String>{
    let name=github_name(remote)?;
    let mut ids=catalog.repositories.iter().filter(|repo|repo.full_name.eq_ignore_ascii_case(&name)&&!repo.identity_id.is_empty()).map(|repo|repo.identity_id.as_str()).collect::<Vec<_>>();
    ids.sort_unstable();ids.dedup();
    (ids.len()==1).then(||ids[0].to_owned())
}
fn assign_unique_catalog_identities(db:&Database,catalog:&Catalog)->Result<(),String>{
    for repo in db.list()?{
        if repo.identity.is_some(){continue;}
        if let Some(id)=repo.canonical_remote.as_deref().and_then(|remote|unique_catalog_identity(catalog,remote)){
            db.assign_identity(&repo.id,&id)?;
        }
    }
    Ok(())
}
pub fn ensure_identity_access(identity_id: &str, remote: Option<&str>) -> Result<(), String> {
    if identity_id.trim().is_empty() {
        return Ok(());
    }
    let Some(name) = remote.and_then(github_name) else {
        return Ok(());
    };
    let secret = token(identity_id)?;
    get(&client()?, &secret, &format!("/repos/{name}"))?;
    Ok(())
}
fn github_name(remote: &str) -> Option<String> {
    let canonical = crate::git::canonical_remote(remote);
    let url = url::Url::parse(&canonical).ok()?;
    if url.host_str()? != "github.com" {
        return None;
    }
    let name = url.path().trim_matches('/');
    validate_name(name).ok()?;
    Some(name.to_owned())
}
fn collect_pages(
    mut read: impl FnMut(u32) -> Result<Vec<Remote>, String>,
) -> Result<Vec<Remote>, String> {
    let mut repositories = Vec::new();
    for page in 1.. {
        let next = read(page)?;
        let last = next.len() < 100;
        repositories.extend(next);
        if last {
            break;
        }
    }
    Ok(repositories)
}

fn clone_command(full_name: &str, destination: &Path, encoded: &str) -> Command {
    let mut command = Command::new("git");
    command
        .args([
            "-c",
            "credential.helper=",
            "-c",
            "http.followRedirects=false",
            "clone",
            "--",
        ])
        .arg(format!("https://github.com/{full_name}.git"))
        .arg(destination)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", "http.https://github.com/.extraheader")
        .env(
            "GIT_CONFIG_VALUE_0",
            format!("AUTHORIZATION: basic {encoded}"),
        );
    if encoded.is_empty() {
        command
            .env("GIT_CONFIG_COUNT", "0")
            .env_remove("GIT_CONFIG_KEY_0")
            .env_remove("GIT_CONFIG_VALUE_0");
    }
    command
}

fn validate_name(name: &str) -> Result<(), String> {
    let parts: Vec<_> = name.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|p| {
            p.is_empty()
                || *p == "."
                || *p == ".."
                || !p
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
    {
        return Err("Invalid GitHub repository name".into());
    }
    Ok(())
}
fn clone_destination(parent: &Path, name: &str) -> Result<PathBuf, String> {
    validate_name(name)?;
    let parent = parent
        .canonicalize()
        .map_err(|e| format!("Choose an existing parent folder: {e}"))?;
    if !parent.is_dir() {
        return Err("Clone destination must be a folder".into());
    }
    let destination = parent.join(name.split('/').nth(1).unwrap());
    if destination.try_exists().map_err(|e| e.to_string())?
        || destination.symlink_metadata().is_ok()
    {
        return Err(format!(
            "{} already exists. Import it if it is a repository, or choose another parent folder.",
            destination.display()
        ));
    }
    Ok(destination)
}
pub fn clone_repository(
    db: &Database,
    git: &GitService,
    identity_id: &str,
    full_name: &str,
    parent: &Path,
) -> Result<ImportResult, String> {
    validate_name(full_name)?;
    if !identity_id.is_empty()
        && !db
            .identities()?
            .iter()
            .any(|i| i.id == identity_id && i.provider_username.is_some())
    {
        return Err("GitHub account not found".into());
    }
    let secret = if identity_id.is_empty() {
        String::new()
    } else {
        token(identity_id)?
    };
    let remote: Remote = get(&client()?, &secret, &format!("/repos/{full_name}"))?
        .json()
        .map_err(|e| e.to_string())?;
    let destination = clone_destination(parent, &remote.full_name)?;
    // Reserve the new directory atomically; never clone into an existing folder.
    std::fs::create_dir(&destination).map_err(|e| e.to_string())?;
    let encoded = if secret.is_empty() {
        String::new()
    } else {
        base64::engine::general_purpose::STANDARD.encode(format!("x-access-token:{secret}"))
    };
    let result = clone_command(&remote.full_name, &destination, &encoded)
        .output()
        .map_err(|e| format!("Could not launch git: {e}"));
    match result {
        Ok(output) if output.status.success() => {}
        result => {
            // Remove only an empty directory we reserved. Preserve partial clones for recovery.
            let _ = std::fs::remove_dir(&destination);
            return Err(match result {
                Ok(output) => format!(
                    "Clone failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                        .replace(if secret.is_empty() { "\0" } else { &secret }, "[redacted]")
                        .replace(
                            if encoded.is_empty() { "\0" } else { &encoded },
                            "[redacted]"
                        )
                ),
                Err(error) => error,
            });
        }
    }
    let existing = db.list()?.into_iter().find(|repo| {
        !repo.local_present
            && repo.canonical_remote.as_deref().is_some_and(|url| {
                crate::git::canonical_remote(url)
                    .eq_ignore_ascii_case(&format!("https://github.com/{}", remote.full_name))
            })
    });
    let id = if let Some(existing) = existing {
        db.restore_clone_location(&existing.id, &destination)?;
        existing.id
    } else {
        db.import(git, &destination).map_err(|e| {
            format!(
                "Cloned to {}, but import failed: {e}. Import that folder manually.",
                destination.display()
            )
        })?
    };
    if !identity_id.is_empty() {
        db.assign_identity(&id, identity_id)?;
    }
    let repository = db
        .list()?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or("Cloned repository not found")?;
    let repository = crate::scan(git, repository)?;
    db.save_snapshot(&id, &repository)?;
    Ok(ImportResult {
        repository,
        warnings: Vec::new(),
    })
}
pub fn link_existing(
    db: &Database,
    git: &GitService,
    expected_remote: &str,
    path: &Path,
    repository_id: Option<&str>,
) -> Result<ImportResult, String> {
    let root = git.root(path).map_err(|e| e.to_string())?;
    let actual = git.remote_url(&root).unwrap_or_default();
    let expected = crate::git::canonical_remote(expected_remote);
    let actual = crate::git::canonical_remote(&actual);
    let matches = if github_name(&expected).is_some() {
        expected.eq_ignore_ascii_case(&actual)
    } else {
        expected == actual
    };
    if !matches {
        return Err("That folder’s origin does not match the selected repository. Choose a matching checkout, or import this folder separately.".into());
    }
    let id = if let Some(id) = repository_id {
        let repositories = db.list()?;
        let selected = repositories
            .iter()
            .find(|repo| repo.id == id)
            .ok_or("Repository not found")?;
        if crate::git::canonical_remote(selected.canonical_remote.as_deref().unwrap_or_default())
            != expected
        {
            return Err("Repository remote changed. Refresh before linking a folder.".into());
        }
        if repositories.iter().any(|repo| {
            repo.id != id && Path::new(&repo.local_path).canonicalize().ok().as_ref() == Some(&root)
        }) {
            return Err(
                "This checkout is already linked to another card. Select that card instead.".into(),
            );
        }
        db.restore_clone_location(id, &root)?;
        id.to_owned()
    } else {
        db.import(git, &root)?
    };
    let repository = db
        .list()?
        .into_iter()
        .find(|repo| repo.id == id)
        .ok_or("Linked repository not found")?;
    let repository = crate::scan(git, repository)?;
    db.save_snapshot(&id, &repository)?;
    Ok(ImportResult {
        repository,
        warnings: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ci_errors_distinguish_access_rate_limits_and_outages(){
        let mut headers=reqwest::header::HeaderMap::new();
        headers.insert("x-ratelimit-remaining","0".parse().unwrap());headers.insert("x-ratelimit-reset","1300".parse().unwrap());
        let limited=ci_http_error(reqwest::StatusCode::FORBIDDEN,&headers,1000);
        assert_eq!(limited.kind,"rateLimit");assert_eq!(limited.retry_after_seconds,Some(301));
        headers.insert("retry-after","120".parse().unwrap());
        assert_eq!(ci_http_error(reqwest::StatusCode::TOO_MANY_REQUESTS,&headers,1000).retry_after_seconds,Some(120));
        let empty=reqwest::header::HeaderMap::new();
        assert_eq!(ci_http_error(reqwest::StatusCode::UNAUTHORIZED,&empty,1000).kind,"authentication");
        assert_eq!(ci_http_error(reqwest::StatusCode::FORBIDDEN,&empty,1000).kind,"access");
        assert_eq!(ci_http_error(reqwest::StatusCode::NOT_FOUND,&empty,1000).kind,"access");
        assert_eq!(ci_http_error(reqwest::StatusCode::SERVICE_UNAVAILABLE,&empty,1000).kind,"server");
        let json=serde_json::to_value(limited).unwrap();assert_eq!(json["retryAfterSeconds"],301);
    }
    #[test]
    fn ci_timeout_diagnostic_preserves_cause_without_request_url(){
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();
        let server=std::thread::spawn(move||{let (_stream,_)=listener.accept().unwrap();std::thread::sleep(Duration::from_millis(150));});
        let http=Client::builder().no_proxy().timeout(Duration::from_millis(50)).build().unwrap();
        let error=ci_transport_error(http.get(format!("http://{address}/private-request")).send().unwrap_err());
        assert_eq!(error.kind,"timeout");assert!(error.message.contains("timed out"));assert!(!error.message.contains("private-request"));
        server.join().unwrap();
    }
    #[test]
    #[ignore = "read-only live GitHub diagnostic; requires CERBERUS_TEST_DATABASE"]
    fn live_ci_catalog(){
        let path=std::env::var("CERBERUS_TEST_DATABASE").expect("Set the diagnostic database path");
        let db=Database::open(std::path::PathBuf::from(path)).unwrap();
        for repository in db.list().unwrap(){
            let started=std::time::Instant::now();
            match ci_runs(&db,&repository.id){Ok(runs)=>println!("{}: {} workflow runs ({:?})",repository.display_name,runs.len(),started.elapsed()),Err(error)=>panic!("{}: {error} ({:?})",repository.display_name,started.elapsed())}
        }
    }
    #[test]
    fn parses_completed_push_workflow_attempts() {
        let response: CiRunsResponse = serde_json::from_str(r#"{"workflow_runs":[{"id":42,"run_attempt":2,"name":"CI","head_branch":"main","head_sha":"abc","conclusion":"failure","updated_at":"2026-10-03T12:00:00Z","html_url":"https://github.com/example/repo/actions/runs/42"}]}"#).unwrap();
        let run=&response.workflow_runs[0];
        assert_eq!((run.id,run.run_attempt),(42,2));
        assert_eq!(run.conclusion.as_deref(),Some("failure"));
        assert_eq!(run.head_branch.as_deref(),Some("main"));
    }
    #[test]
    fn unique_catalog_account_becomes_repository_assignment(){
        let directory=tempfile::tempdir().unwrap();
        let db=Database::open(directory.path().join("catalog.db")).unwrap();
        let identity=db.save_github_identity("owner","Owner","owner@example.test").unwrap();
        let git=GitService::default();
        let checkout=directory.path().join("checkout");git.init(&checkout,"main").unwrap();
        git.apply_origin(&checkout,Some("https://github.com/owner/repo.git")).unwrap();
        db.import(&git,&checkout).unwrap();
        let catalog=Catalog{repositories:vec![GithubRepository{id:1,name:"repo".into(),full_name:"owner/repo".into(),owner:"owner".into(),private:true,html_url:"https://github.com/owner/repo".into(),default_branch:Some("main".into()),updated_at:None,pushed_at:None,identity_id:identity.id.clone()}],..Default::default()};
        assign_unique_catalog_identities(&db,&catalog).unwrap();
        assert_eq!(db.list().unwrap()[0].identity.as_ref().map(|item|item.id.as_str()),Some(identity.id.as_str()));
    }
    #[test]
    fn linking_validates_origin_and_reuses_missing_registration() {
        let directory = tempfile::tempdir().unwrap();
        let db = Database::open(directory.path().join("test.db")).unwrap();
        let git = GitService::default();
        let checkout = directory.path().join("checkout");
        git.init(&checkout, "main").unwrap();
        git.apply_origin(&checkout, Some("git@github.com:Owner/Repo.git"))
            .unwrap();
        assert!(
            link_existing(&db, &git, "https://github.com/other/repo", &checkout, None).is_err()
        );
        assert!(db.list().unwrap().is_empty());
        let linked =
            link_existing(&db, &git, "https://github.com/Owner/Repo", &checkout, None).unwrap();
        assert!(linked.repository.local_present);
        let moved = directory.path().join("moved");
        std::fs::rename(&checkout, &moved).unwrap();
        let linked_again = link_existing(
            &db,
            &git,
            "https://github.com/Owner/Repo",
            &moved,
            Some(&linked.repository.id),
        )
        .unwrap();
        assert_eq!(linked.repository.id, linked_again.repository.id);
        assert_eq!(db.list().unwrap().len(), 1);
        assert_eq!(
            git.remote_url(&moved).as_deref(),
            Some("git@github.com:Owner/Repo.git")
        );
        assert!(git
            .text(&moved, &["status", "--porcelain"])
            .unwrap()
            .is_empty());
    }
    #[test]
    fn registered_github_remotes_resolve_to_metadata_paths() {
        for remote in [
            "git@github.com:owner/repo.git",
            "https://github.com/owner/repo",
            "ssh://git@github.com/owner/repo.git",
        ] {
            assert_eq!(github_name(remote).as_deref(), Some("owner/repo"));
        }
        assert!(github_name("https://gitlab.com/owner/repo").is_none());
        assert!(github_name("https://github.com/owner/repo/extra").is_none());
    }
    #[test]
    fn restoring_a_missing_checkout_keeps_the_existing_card() {
        let directory = tempfile::tempdir().unwrap();
        let db = Database::open(directory.path().join("test.db")).unwrap();
        let git = GitService::default();
        let original = directory.path().join("old");
        let restored = directory.path().join("restored");
        git.init(&original, "main").unwrap();
        let id = db.import(&git, &original).unwrap();
        assert!(db.list().unwrap()[0].local_present);
        std::fs::rename(&original, &restored).unwrap();
        assert!(!db.list().unwrap()[0].local_present);
        db.restore_clone_location(&id, &restored).unwrap();
        let repos = db.list().unwrap();
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].id, id);
        assert!(repos[0].local_present);
        assert_eq!(db.repository_path(&id).unwrap(), restored);
    }
    #[test]
    fn catalog_reads_every_page_and_preserves_visibility_and_owner() {
        let mut pages = Vec::new();
        let repos = collect_pages(|page| {
            pages.push(page);
            Ok((0..if page < 3 { 100 } else { 1 })
                .map(|i| Remote {
                    id: u64::from(page * 100 + i),
                    name: "repo".into(),
                    full_name: "org/repo".into(),
                    owner: Owner {
                        login: "org".into(),
                    },
                    private: true,
                    html_url: "https://github.com/org/repo".into(),
                    default_branch: Some("main".into()),
                    updated_at: Some("2026-09-17T00:00:00Z".into()),
                    pushed_at: Some("2026-09-16T00:00:00Z".into()),
                })
                .collect())
        })
        .unwrap();
        assert_eq!(pages, [1, 2, 3]);
        assert_eq!(repos.len(), 201);
        let repo = repos.into_iter().next().unwrap().catalog("account");
        assert!(repo.private);
        assert_eq!(repo.owner, "org");
        assert_eq!(repo.identity_id, "account");
        assert!(collect_pages(|_| Err("offline".into())).is_err());
    }
    #[test]
    fn clone_credentials_are_ephemeral_and_absent_from_arguments() {
        let command = clone_command("owner/repo", Path::new("/tmp/new repo"), "encoded-secret");
        let args: Vec<_> = command.get_args().map(|s| s.to_string_lossy()).collect();
        assert!(args.iter().all(|arg| !arg.contains("encoded-secret")));
        assert!(args.contains(&"https://github.com/owner/repo.git".into()));
        assert!(args.contains(&"credential.helper=".into()));
        let env: std::collections::HashMap<_, _> = command.get_envs().collect();
        assert_eq!(
            env[std::ffi::OsStr::new("GIT_CONFIG_VALUE_0")].unwrap(),
            "AUTHORIZATION: basic encoded-secret"
        );
    }
    #[test]
    fn clone_never_overwrites_or_escapes_parent() {
        let parent = tempfile::tempdir().unwrap();
        assert!(clone_destination(parent.path(), "owner/repo").is_ok());
        for name in [
            "../..",
            "owner/..",
            "owner/repo/extra",
            "owner/--x?",
            "/repo",
        ] {
            assert!(clone_destination(parent.path(), name).is_err());
        }
        std::fs::create_dir(parent.path().join("repo")).unwrap();
        assert!(clone_destination(parent.path(), "owner/repo").is_err());
    }
}
