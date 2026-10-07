use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};

fn credential_storage_issue() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let inspect = || -> Result<Option<String>, String> {
            let bus = dbus::blocking::Connection::new_session().map_err(|e| e.to_string())?;
            let service = bus.with_proxy("org.freedesktop.secrets", "/org/freedesktop/secrets", Duration::from_secs(3));
            let (path,): (dbus::Path<'static>,) = service.method_call("org.freedesktop.Secret.Service", "ReadAlias", ("default",)).map_err(|e| e.to_string())?;
            if path == "/" {
                return Ok(Some("The active Secret Service provider has no default collection. Set a persistent collection as its default; an unlocked wallet in another provider does not fix this.".into()));
            }
            use dbus::blocking::stdintf::org_freedesktop_dbus::Properties;
            let collection = bus.with_proxy("org.freedesktop.secrets", path, Duration::from_secs(3));
            let locked: bool = collection.get("org.freedesktop.Secret.Collection", "Locked").map_err(|e| e.to_string())?;
            Ok(locked.then(|| "The active Secret Service default collection is locked. Unlock it in your password manager.".into()))
        };
        match inspect() { Ok(issue) => issue, Err(error) => Some(format!("Could not inspect the active Secret Service provider: {error}")) }
    }
    #[cfg(not(target_os = "linux"))]
    { None }
}

pub(crate) fn missing_account_error() -> String {
    match credential_storage_issue() {
        Some(issue) => format!("ChatGPT credential storage is unavailable. {issue} Repair storage before reconnecting."),
        None => "Reconnect the assigned ChatGPT account to restore usage information and agent execution.".into(),
    }
}

fn credential_error(message: &str) -> String {
    if is_credential_storage_error(message) {
        let detail = credential_storage_issue().unwrap_or_else(|| "Check that the same OS credential service and collection are accessible during sign-in and execution.".into());
        format!("ChatGPT credential storage failed. {detail} Reconnecting alone cannot repair storage access. Codex reported: {message}")
    } else { message.to_owned() }
}
fn is_credential_storage_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    ["platform secure storage", "auth from keyring", "secret service", "ss api"].iter().any(|term| lower.contains(term))
}

#[derive(Default)]
pub struct CodexService {
    connection: Mutex<Option<Client>>,
    executable_file: PathBuf,
    home: Option<PathBuf>,
}

pub(crate) struct Client {
    child: Child,
    input: ChildStdin,
    output: mpsc::Receiver<Value>,
    sequence: u64,
    events: std::collections::VecDeque<Value>,
    capture_events: bool,
    logins: std::collections::HashMap<String,Result<(),String>>,
}

impl Drop for Client {
    fn drop(&mut self) {
        crate::setup_terminal::stop_process_tree(&mut self.child);
        let _ = self.child.wait();
    }
}

impl Client {
    fn start(executable: &std::ffi::OsStr, home: Option<&Path>) -> Result<Self, String> {
        let mut command = Command::new(executable);
        command.arg("app-server");
        if let Some(home) = home { command.env("CODEX_HOME",home).env_remove("CODEX_API_KEY").env_remove("OPENAI_API_KEY").env_remove("CODEX_ACCESS_TOKEN").args(["-c","forced_login_method=\"chatgpt\"","-c","cli_auth_credentials_store=\"keyring\""]); }

        Self::start_command(command)
    }

    pub(crate) fn start_command(mut command: Command) -> Result<Self, String> {
        let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
            .spawn().map_err(|e| format!("Could not start Codex: {e}. Install the Codex CLI and put it on PATH, or set GITCERBERUS_CODEX_PATH to its executable."))?;
        let input = child.stdin.take().ok_or("Codex stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("Codex stdout unavailable")?;
        let (send, output) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if let Ok(value) = serde_json::from_str(&line) {
                    if send.send(value).is_err() {
                        break;
                    }
                }
            }
        });
        let mut client = Self {
            child,
            input,
            output,
            sequence: 0, events:Default::default(), capture_events:false, logins:Default::default(),
        };
        client.request("initialize", json!({"clientInfo": {"name":"gitcerberus", "title":"GitCerberus", "version":"0.1.0"}, "capabilities":{"experimentalApi":true}}))?;
        client.send(json!({"method":"initialized", "params":{}}))?;
        Ok(client)
    }

    pub(crate) fn capture_events(&mut self){self.capture_events=true;}
    pub(crate) fn next_event(&mut self) -> Result<Option<Value>,String> {
        if let Some(event)=self.events.pop_front(){return Ok(Some(event));}
        match self.output.recv_timeout(Duration::from_millis(100)) {
            Ok(event)=>Ok(Some(event)),Err(mpsc::RecvTimeoutError::Timeout)=>Ok(None),Err(_)=>Err("Codex disconnected before completing the turn".into())
        }
    }
    pub(crate) fn interrupt(&mut self,thread:&str,turn:&str) {self.sequence+=1;let _=self.send(json!({"id":self.sequence,"method":"turn/interrupt","params":{"threadId":thread,"turnId":turn}}));}
    pub(crate) fn reject_request(&mut self,id:Value)->Result<(),String>{self.send(json!({"id":id,"error":{"code":-32601,"message":"Interactive approvals are unavailable; no action approved"}}))}
    fn send(&mut self, value: Value) -> Result<(), String> {
        writeln!(self.input, "{value}")
            .and_then(|_| self.input.flush())
            .map_err(|e| e.to_string())
    }

    pub(crate) fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.sequence += 1;
        let id = self.sequence;
        self.send(json!({"id":id, "method":method, "params":params}))?;
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let value = self
                .output
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| {
                    "Codex did not respond. Check the installed CLI and retry.".to_owned()
                })?;
            if value["method"] == "account/login/completed" {
                if let Some(login_id)=value["params"]["loginId"].as_str() {self.logins.insert(login_id.into(),if value["params"]["success"]==true {Ok(())}else{Err(credential_error(value["params"]["error"].as_str().unwrap_or("ChatGPT sign-in failed")))});}
            }
            // This viewer never approves agent actions or supplies credentials to tools.
            if value.get("method").is_some() && value.get("id").is_some() {
                self.send(json!({"id":value["id"], "error":{"code":-32601,"message":"Read-only history client"}}))?;
                continue;
            }
            if value["id"].as_u64() != Some(id) {
                if self.capture_events && value.get("method").is_some() { self.events.push_back(value); }
                continue;
            }
            if let Some(error) = value.get("error") {
                let message = error["message"].as_str().unwrap_or("Codex request failed");
                return Err(if message.contains("list_turns is not supported yet") {
                    "This conversation uses paginated Codex history that the installed app-server cannot read or continue. Start a separate chat to proceed; the original conversation is preserved.".into()
                } else { credential_error(message) });
            }
            return value
                .get("result")
                .cloned()
                .ok_or_else(|| "Invalid Codex response".into());
        }
    }
}

impl CodexService {
    pub fn new(executable_file: PathBuf) -> Self {
        Self {
            connection: Mutex::new(None),
            executable_file, home:None,
        }
    }

    pub fn for_account(executable_file: PathBuf, home: PathBuf) -> Self { Self {connection:Mutex::new(None), executable_file, home:Some(home)} }

    pub fn login_outcome(&self,id:&str)->Option<Result<(),String>> {self.connection.lock().ok()?.as_ref()?.logins.get(id).cloned()}
    pub fn disconnect(&self) -> Result<(), String> {
        *self.connection.lock().map_err(|_| "Codex connection lock failed")? = None;
        Ok(())
    }
    pub fn configure(&self, path: &Path) -> Result<(), String> {
        if !path.is_absolute() || !path.is_file() {
            return Err("Choose the Codex executable file using its full path.".into());
        }
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| "Codex connection lock failed")?;
        let client = Client::start(path.as_os_str(), self.home.as_deref())?;
        std::fs::write(&self.executable_file, path.to_string_lossy().as_bytes())
            .map_err(|e| format!("Could not save the Codex location: {e}"))?;
        *guard = Some(client);
        Ok(())
    }

    pub fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| "Codex connection lock failed")?;
        if guard.is_none() {
            let executable = crate::provider_paths::resolve_from_file(&self.executable_file, "codex")?
                .ok_or("Codex is not installed. Open provider setup to install it.")?;
            *guard = Some(Client::start(executable.as_os_str(), self.home.as_deref())?);
        }
        let result = guard.as_mut().unwrap().request(method, params);
        // A failed transport must not leave a stale connection blocking retries.
        if result
            .as_ref()
            .err()
            .is_some_and(|e| e.contains("did not respond") || e.contains("pipe"))
        {
            *guard = None;
        }
        result
    }

    pub fn resume_home(&self, repository: &Path, id: &str) -> Result<PathBuf, String> {
        let value = self.request("thread/read", json!({"threadId":id,"includeTurns":false}))?;
        if !value["thread"]["cwd"].as_str().is_some_and(|cwd| same_directory(repository, Path::new(cwd))) { return Err("This conversation belongs to another repository".into()); }
        let file = PathBuf::from(value["thread"]["path"].as_str().ok_or("This conversation has no local resumable session file")?);
        crate::agent_sessions::validate_rollout(&file, id, repository)?;
        file.ancestors().find(|path| path.file_name().is_some_and(|name| name == "sessions" || name == "archived_sessions"))
            .and_then(|path| path.parent()).map(Path::to_path_buf).ok_or_else(|| "The Codex session storage location is unsupported".into())
    }

    pub fn can_append(&self, repository:&Path, id:&str) -> Result<bool,String> {
        let value=self.request("thread/read",json!({"threadId":id,"includeTurns":false}))?;
        if !value["thread"]["cwd"].as_str().is_some_and(|cwd|same_directory(repository,Path::new(cwd))){return Err("This Codex conversation belongs to another repository".into());}
        Ok(value["thread"]["status"]["type"]=="active")
    }

    pub fn submit_saved_turn(&self,repository:&Path,id:&str,prompt:&str)->Result<(),String>{
        let executable=crate::provider_paths::resolve_from_file(&self.executable_file,"codex")?.ok_or("Codex is not installed")?;
        let mut client=Client::start(executable.as_os_str(),self.home.as_deref())?;
        client.capture_events();
        let info=client.request("thread/read",json!({"threadId":id,"includeTurns":false}))?;
        if !info["thread"]["cwd"].as_str().is_some_and(|cwd|same_directory(repository,Path::new(cwd))){return Err("This Codex conversation belongs to another repository".into());}
        if info["thread"]["status"]["type"]=="active" {return Err("This Codex thread is still working".into());}
        let resumed=client.request("thread/resume",json!({"threadId":id,"excludeTurns":true,"cwd":repository,"approvalPolicy":"never","sandbox":"workspace-write"}))?;
        if resumed["thread"]["id"].as_str()!=Some(id){return Err("Codex resumed a different conversation; nothing was sent".into());}
        let started=client.request("turn/start",json!({"threadId":id,"input":[{"type":"text","text":prompt}],"cwd":repository,"approvalPolicy":"never","sandboxPolicy":{"type":"workspaceWrite","writableRoots":[repository],"networkAccess":false}}))?;
        let turn=started["turn"]["id"].as_str().ok_or("Codex returned no turn ID")?.to_owned();
        let deadline=Instant::now()+Duration::from_secs(900);
        loop {
            if Instant::now()>=deadline {client.interrupt(id,&turn);return Err("Codex timed out after 15 minutes. Inspect the conversation before retrying.".into());}
            let Some(event)=client.next_event()? else {continue};
            if let Some(request_id)=event.get("id") {if event.get("method").is_some(){client.reject_request(request_id.clone())?;}continue;}
            let params=&event["params"];
            if params["threadId"].as_str().is_some_and(|thread|thread!=id)||params["turnId"].as_str().is_some_and(|value|value!=turn){continue;}
            match event["method"].as_str().unwrap_or("") {
                "error" if !params["willRetry"].as_bool().unwrap_or(false)=>return Err(params["error"]["message"].as_str().unwrap_or("Codex turn failed").into()),
                "turn/completed" if params["turn"]["id"].as_str()==Some(&turn)=>return match params["turn"]["status"].as_str(){Some("completed")=>Ok(()),_=>Err(params["turn"]["error"]["message"].as_str().unwrap_or("Codex turn did not complete").into())},
                _=>{}
            }
        }
    }

    pub fn update_thread(&self, repository: &Path, id: &str, action: &str, name: Option<&str>) -> Result<(), String> {
        let value = self.request("thread/read", json!({"threadId":id,"includeTurns":false}))?;
        if !value["thread"]["cwd"].as_str().is_some_and(|cwd| same_directory(repository, Path::new(cwd))) {
            return Err("This conversation belongs to another repository".into());
        }
        let (method, params) = match action {
            "rename" => {
                let name = name.map(str::trim).filter(|name| !name.is_empty()).ok_or("Enter a conversation name")?;
                ("thread/name/set", json!({"threadId":id,"name":name}))
            }
            "archive" => ("thread/archive", json!({"threadId":id})),
            "unarchive" => ("thread/unarchive", json!({"threadId":id})),
            _ => return Err("Unknown conversation action".into()),
        };
        self.request(method, params).map(|_| ())
    }

    pub fn threads(
        &self,
        path: &Path,
        cursor: Option<String>,
        archived: bool,
    ) -> Result<ThreadPage, String> {
        let value = self.request("thread/list", json!({
            "cwd": path, "cursor":cursor, "limit":30, "sortKey":"updated_at", "archived":archived,
            "sourceKinds":["cli","vscode","appServer"]
        }))?;
        let page: ThreadPage = serde_json::from_value(value.clone())
            .map_err(|e| format!("Unsupported Codex thread response: {e}"))?;
        Ok(ThreadPage {
            data: page
                .data
                .into_iter()
                .filter(|thread| same_directory(path, Path::new(&thread.cwd)))
                .map(|mut thread| {
                    if let Some(source) = value["data"].as_array().and_then(|items| items.iter().find(|item| item["id"] == thread.id)) {
                        thread.working = source["status"]["type"] == "active"
                            || source["path"].as_str().is_some_and(|file| rollout_working(Path::new(file)));
                        // thread/list follows the rollout file clock, which also moves when Codex
                        // rewrites settings. Sort by the last message or task instead.
                        if let Some(file) = source["path"].as_str() {
                            if let Some(updated) = conversation_updated_at(Path::new(file)) {
                                thread.updated_at = updated;
                            }
                        }
                    }
                    thread
                })
                .collect(),
            next_cursor: page.next_cursor,
        })
    }

    pub fn messages(
        &self,
        path: &Path,
        thread_id: String,
        cursor: Option<String>,
    ) -> Result<MessagePage, String> {
        let value = self.request(
            "thread/read",
            json!({"threadId":thread_id, "includeTurns":false}),
        )?;
        if !value["thread"]["cwd"]
            .as_str()
            .is_some_and(|cwd| same_directory(path, Path::new(cwd)))
        {
            return Err("This conversation belongs to a different repository.".into());
        }
        let local_file = value["thread"]["path"].as_str().map(Path::new);
        if value["thread"]["historyMode"] == "paginated" {
            return local_file.ok_or("The stored Codex conversation file is unavailable".into())
                .and_then(|file| rollout_messages(file, &thread_id, path));
        }
        match self.request("thread/turns/list", json!({"threadId":thread_id,"cursor":cursor,"limit":30,"sortDirection":"desc","itemsView":"full"})) {
            Ok(page) => Ok(MessagePage {
                data: page_messages(&page),
                next_cursor: page["nextCursor"].as_str().map(str::to_owned),
            }),
            Err(error) if error.contains("paginated Codex history") => local_file.ok_or(error.clone()).and_then(|file| rollout_messages(file, &thread_id, path)),
            Err(error) if cursor.is_none() && (error.to_lowercase().contains("unsupported") || error.to_lowercase().contains("not support") || error.to_lowercase().contains("unknown") || error.to_lowercase().contains("not found")) => {
                match self.request("thread/read", json!({"threadId":thread_id,"includeTurns":true})) {
                    Ok(value) => Ok(MessagePage { data: messages(&value["thread"]), next_cursor: None }),
                    Err(read_error) if read_error.contains("paginated Codex history") => Err(read_error),
                    Err(read_error) => Err(read_error),
                }
            }
            Err(error) => Err(error),
        }
    }
}

fn same_directory(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn rollout_messages(file: &Path, id: &str, repository: &Path) -> Result<MessagePage, String> {
    let reader = BufReader::new(std::fs::File::open(file).map_err(|e| format!("Could not read stored Codex conversation: {e}"))?);
    let mut lines = reader.lines();
    let first: Value = serde_json::from_str(&lines.next().ok_or("Empty Codex conversation")?.map_err(|e| e.to_string())?)
        .map_err(|_| "Unreadable Codex conversation metadata")?;
    if first["type"] != "session_meta" || first["payload"]["id"] != id
        || !first["payload"]["cwd"].as_str().is_some_and(|cwd| same_directory(repository, Path::new(cwd))) {
        return Err("The stored Codex conversation does not belong to this repository".into());
    }
    let mut data = Vec::new();
    for line in lines {
        let line = line.map_err(|e| e.to_string())?;
        let Ok(record) = serde_json::from_str::<Value>(&line) else { continue };
        if record["type"] != "response_item" || record["payload"]["type"] != "message" { continue }
        let Some(role) = record["payload"]["role"].as_str().filter(|role| *role == "user" || *role == "assistant") else { continue };
        let text = record["payload"]["content"].as_array().into_iter().flatten()
            .filter_map(|part| match part["type"].as_str() {
                Some("input_text" | "output_text" | "text") => part["text"].as_str().map(str::to_owned),
                Some("input_image" | "input_file") => Some("[Attachment]".into()),
                _ => None,
            }).collect::<Vec<_>>().join("\n");
        if !text.is_empty() {
            data.push(Message {id: format!("{}:{}", id, record["ordinal"]), role: role.into(), text, edits: Vec::new()});
        }
    }
    Ok(MessagePage {data, next_cursor: None})
}

fn conversation_change(record: &Value) -> bool {
    match record["type"].as_str() {
        Some("response_item") => record["payload"]["type"] == "message",
        Some("event_msg") => matches!(record["payload"]["type"].as_str(), Some("task_started" | "task_complete" | "turn_aborted" | "task_cancelled")),
        _ => false,
    }
}
fn conversation_updated_at(file: &Path) -> Option<i64> {
    use std::io::{Read, Seek, SeekFrom};
    let mut input = std::fs::File::open(file).ok()?;
    let meta = input.metadata().ok()?;
    let mut window = 65_536_u64;
    loop {
        let start = meta.len().saturating_sub(window);
        input.seek(SeekFrom::Start(start)).ok()?;
        let mut bytes = Vec::new();
        input.read_to_end(&mut bytes).ok()?;
        let tail = String::from_utf8_lossy(&bytes);
        let mut latest = None;
        for line in tail.lines().skip(usize::from(start > 0)) {
            let Ok(record) = serde_json::from_str::<Value>(line) else { continue };
            if !conversation_change(&record) { continue }
            let Some(stamp) = record["timestamp"].as_str() else { continue };
            let Ok(time) = chrono::DateTime::parse_from_rfc3339(stamp) else { continue };
            latest = Some(latest.map_or(time.timestamp(), |current: i64| current.max(time.timestamp())));
        }
        if latest.is_some() || start == 0 || window >= 2_097_152 { return latest }
        window = window.saturating_mul(2);
    }
}
fn rollout_working(file: &Path) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut input) = std::fs::File::open(file) else { return false };
    let Ok(meta) = input.metadata() else { return false };
    if !meta.modified().ok().and_then(|time| time.elapsed().ok()).is_some_and(|age| age < Duration::from_secs(600)) { return false }
    let mut window = 131_072_u64;
    loop {
        let start = meta.len().saturating_sub(window);
        if input.seek(SeekFrom::Start(start)).is_err() { return false }
        let mut bytes = Vec::new();
        if input.read_to_end(&mut bytes).is_err() { return false }
        let tail = String::from_utf8_lossy(&bytes);
        let mut latest = None;
        for line in tail.lines().skip(usize::from(start > 0)) {
            let Ok(record) = serde_json::from_str::<Value>(line) else { continue };
            if record["type"] == "event_msg" {
                match record["payload"]["type"].as_str() {
                    Some("task_started") => latest = Some(true),
                    Some("task_complete" | "turn_aborted" | "task_cancelled") => latest = Some(false),
                    _ => {}
                }
            }
        }
        if let Some(running) = latest { return running }
        if start == 0 { return false }
        window = window.saturating_mul(2);
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: String,
    pub name: Option<String>,
    pub preview: String,
    pub cwd: String,
    pub updated_at: i64,
    pub git_info: Option<Value>,
    #[serde(default)]
    pub working: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPage {
    pub data: Vec<ThreadSummary>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FileEdit { pub path: String, pub kind: String, #[serde(skip_serializing_if = "Option::is_none")] pub diff: Option<String> }

#[derive(Debug, Serialize)]
pub struct Message {
    pub id: String,
    pub role: String,
    pub text: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub edits: Vec<FileEdit>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePage {
    pub data: Vec<Message>,
    pub next_cursor: Option<String>,
}

// Fetch newest turns first, but render messages within and across turns chronologically.
fn page_messages(page: &Value) -> Vec<Message> {
    let turns: Vec<_> = page["data"]
        .as_array()
        .into_iter()
        .flatten()
        .rev()
        .cloned()
        .collect();
    messages(&json!({"turns": turns}))
}

fn messages(thread: &Value) -> Vec<Message> {
    let mut result = Vec::new();
    for turn in thread["turns"].as_array().into_iter().flatten() {
        let start = result.len();
        let mut edits = Vec::new();
        for item in turn["items"].as_array().into_iter().flatten() {
            if item["type"] == "fileChange" && item["status"] == "completed" {
                for change in item["changes"].as_array().into_iter().flatten() {
                    if let Some(path) = change["path"].as_str() {
                        edits.push(FileEdit {path:path.into(),kind:change["kind"].as_str().or_else(|| change["kind"]["type"].as_str()).unwrap_or("update").into(),diff:change["diff"].as_str().map(String::from)});
                    }
                }
            }
            let (role, text) = match item["type"].as_str() {
                Some("agentMessage") => (
                    "assistant",
                    item["text"].as_str().unwrap_or_default().to_owned(),
                ),
                Some("userMessage") => (
                    "user",
                    item["content"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|part| {
                            if part["type"] == "text" {
                                part["text"].as_str().unwrap_or_default().to_owned()
                            } else {
                                "[Attachment]".into()
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n"),
                ),
                _ => continue,
            };
            if !text.is_empty() {
                result.push(Message {
                    id: item["id"].as_str().unwrap_or_default().to_owned(),
                    role: role.into(),
                    text, edits:Vec::new(),
                });
            }
        }
        if !edits.is_empty() {
            if let Some(message) = result[start..].iter_mut().rev().find(|message| message.role == "assistant") { message.edits = edits; }
            else { result.push(Message {id:format!("{}:edits", turn["id"].as_str().unwrap_or("turn")),role:"assistant".into(),text:String::new(),edits}); }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    #[test]
    fn storage_errors_are_distinct_from_authentication_errors() {
        for error in ["logout failed: failed to delete auth from keyring", "Couldn't access platform secure storage: SS error: result not returned from SS API", "Secret Service unavailable"] {
            assert!(super::is_credential_storage_error(error));
        }
        assert!(!super::is_credential_storage_error("Token expired"));
        assert_eq!(super::credential_error("Token expired"), "Token expired");
    }
    use super::*;
    #[test]
    fn paginated_rollout_reads_recent_messages_and_checks_repository() {
        let root = std::env::temp_dir().join(format!("cerberus-rollout-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("conversation.jsonl");
        let rows = [
            json!({"type":"session_meta","payload":{"id":"thread-1","cwd":root,"history_mode":"paginated"}}),
            json!({"type":"response_item","ordinal":1,"payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Recent prompt"}]}}),
            json!({"type":"response_item","ordinal":2,"payload":{"type":"reasoning","content":[{"type":"output_text","text":"private"}]}}),
            json!({"type":"response_item","ordinal":3,"payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Recent answer"}]}}),
        ];
        std::fs::write(&file, rows.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n")).unwrap();
        let result = rollout_messages(&file, "thread-1", &root).unwrap();
        assert_eq!(result.data.iter().map(|message| message.text.as_str()).collect::<Vec<_>>(), ["Recent prompt", "Recent answer"]);
        assert!(rollout_messages(&file, "other-thread", &root).is_err());
        std::fs::OpenOptions::new().append(true).open(&file).unwrap().write_all(b"\n{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\"}}\n").unwrap();
        assert!(rollout_working(&file));
        std::fs::OpenOptions::new().append(true).open(&file).unwrap().write_all(format!("{}\n", json!({"type":"event_msg","payload":{"type":"item_completed","text":"x".repeat(150_000)}})).as_bytes()).unwrap();
        assert!(rollout_working(&file));
        std::fs::OpenOptions::new().append(true).open(&file).unwrap().write_all(b"{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\"}}\n").unwrap();
        assert!(!rollout_working(&file));
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn settings_rewrites_do_not_make_a_conversation_newer() {
        let root = std::env::temp_dir().join(format!("cerberus-order-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("conversation.jsonl");
        let rows = [
            json!({"timestamp":"2026-09-23T06:44:51.886Z","type":"response_item","payload":{"type":"message","role":"assistant"}}),
            json!({"timestamp":"2026-09-23T06:44:52.632Z","type":"event_msg","payload":{"type":"task_complete"}}),
            json!({"timestamp":"2026-09-28T02:57:06.010Z","type":"event_msg","payload":{"type":"thread_settings_applied"}}),
        ];
        std::fs::write(&file, rows.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n")).unwrap();
        assert_eq!(conversation_updated_at(&file), Some(chrono::DateTime::parse_from_rfc3339("2026-09-23T06:44:52.632Z").unwrap().timestamp()));
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    #[cfg(unix)]
    fn transport_handles_handshake_notifications_and_errors() {
        let mut command = Command::new("python3");
        command.args(["-u", "-c", r#"
import json, sys
initialized = False
for line in sys.stdin:
    request = json.loads(line)
    method = request['method']
    if method == 'initialized':
        initialized = True
        continue
    if method == 'initialize':
        assert request['params']['clientInfo']['name'] == 'gitcerberus'
        result = {'userAgent':'fixture'}
    elif method == 'account/read':
        assert initialized
        print(json.dumps({'method':'account/updated','params':{'authMode':None}}), flush=True)
        result = {'account':None}
    else:
        print(json.dumps({'id':request['id'],'error':{'code':-32601,'message':'Unknown method'}}), flush=True)
        continue
    print(json.dumps({'id':request['id'],'result':result}), flush=True)
"#]);
        let mut client = Client::start_command(command).unwrap();
        assert_eq!(
            client.request("account/read", json!({})).unwrap(),
            json!({"account":null})
        );
        assert_eq!(
            client.request("invalid", json!({})).unwrap_err(),
            "Unknown method"
        );
        // A protocol error must not make the next response match the wrong request.
        assert!(client.request("account/read", json!({})).is_ok());
    }

    #[test]
    #[cfg(unix)]
    fn service_filters_repository_and_pages_messages() {
        let dir = tempfile::tempdir().unwrap();
        let session = dir.path().join("sessions/rollout-ours.jsonl");
        std::fs::create_dir_all(session.parent().unwrap()).unwrap();
        std::fs::write(&session, json!({"type":"session_meta","payload":{"id":"ours","cwd":dir.path()}}).to_string()).unwrap();
        let mut command = Command::new("python3");
        command.args(["-u", "-c", r#"
import json, sys
cwd = sys.argv[1]
for line in sys.stdin:
    request = json.loads(line)
    method = request['method']
    params = request.get('params', {})
    if method == 'initialized': continue
    if method == 'initialize': result = {}
    elif method == 'thread/list':
        assert params['cwd'] == cwd
        assert params['sourceKinds'] == ['cli', 'vscode', 'appServer']
        result = {'data':[{'id':'ours','preview':'A task','cwd':cwd,'updatedAt':100},
                          {'id':'other','preview':'Other task','cwd':'/another-repository','updatedAt':101}], 'nextCursor':'next'}
    elif method == 'thread/read':
        result = {'thread':{'cwd':cwd if params['threadId']=='ours' else '/another-repository', 'path':cwd+'/sessions/rollout-ours.jsonl'}}
    elif method == 'thread/turns/list':
        assert params['threadId'] == 'ours'
        assert params['itemsView'] == 'full'
        result = {'data':[{'items':[{'id':'a','type':'agentMessage','text':'Hello'}]}], 'nextCursor':'older'}
    else: raise AssertionError(method)
    print(json.dumps({'id':request['id'],'result':result}), flush=True)
"#, dir.path().to_str().unwrap()]);
        let service = CodexService {
            connection: Mutex::new(Some(Client::start_command(command).unwrap())),
            executable_file: PathBuf::new(), home:None,
        };
        let page = service.threads(dir.path(), None, false).unwrap();
        assert_eq!(page.data.len(), 1);
        assert_eq!(page.data[0].id, "ours");
        assert_eq!(page.next_cursor.as_deref(), Some("next"));
        let page = service.messages(dir.path(), "ours".into(), None).unwrap();
        assert_eq!(page.data[0].text, "Hello");
        assert_eq!(page.next_cursor.as_deref(), Some("older"));
        assert!(service.messages(dir.path(), "other".into(), None).is_err());
        assert_eq!(service.resume_home(dir.path(), "ours").unwrap(), dir.path());
        assert!(service.resume_home(dir.path(), "other").is_err());
        std::fs::remove_file(session).unwrap();
        assert!(service.resume_home(dir.path(), "ours").is_err());
    }

    #[test]
    #[cfg(unix)]
    fn executable_selection_persists_and_rejects_invalid_paths() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let executable = dir.path().join("codex-fixture");
        std::fs::write(
            &executable,
            r#"#!/usr/bin/env python3
import json, sys
for line in sys.stdin:
    request = json.loads(line)
    if 'id' in request:
        print(json.dumps({'id':request['id'],'result':{'account':None}}), flush=True)
"#,
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let settings = dir.path().join("executable.txt");
        {
            let service = CodexService::new(settings.clone());
            service.configure(&executable).unwrap();
            assert!(service.configure(&dir.path().join("missing")).is_err());
            assert_eq!(
                std::fs::read_to_string(&settings).unwrap(),
                executable.to_string_lossy()
            );
        }
        let service = CodexService::new(settings);
        assert_eq!(
            service.request("account/read", json!({})).unwrap(),
            json!({"account":null})
        );
    }

    #[test]
    fn newest_page_renders_turns_chronologically() {
        let page = json!({"data":[
            {"items":[{"id":"u2","type":"userMessage","content":[{"type":"text","text":"Latest prompt"}]}, {"id":"a2","type":"agentMessage","text":"Latest answer"}]},
            {"items":[{"id":"u1","type":"userMessage","content":[{"type":"text","text":"Earlier prompt"}]}, {"id":"a1","type":"agentMessage","text":"Earlier answer"}]}
        ]});
        let parsed = page_messages(&page);
        assert_eq!(
            parsed
                .iter()
                .map(|message| message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["u1", "a1", "u2", "a2"]
        );
    }

    #[test]
    fn extracts_conversation_without_tool_payloads() {
        let parsed = messages(&json!({"turns":[{"items":[
            {"type":"userMessage","id":"u","content":[{"type":"text","text":"Fix this"},{"type":"localImage","path":"private.png"}]},
            {"type":"commandExecution","aggregatedOutput":"private tool output"},
            {"type":"agentMessage","id":"a","text":"Done"}
        ]}]}));
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].text, "Fix this\n[Attachment]");
        assert_eq!(parsed[1].role, "assistant");
        assert_eq!(parsed[1].text, "Done");
    }
    #[test]
    fn edits_belong_to_the_last_assistant_message_of_each_turn() {
        let parsed = messages(&json!({"turns":[{"items":[
            {"type":"agentMessage","id":"comment","text":"Working"},
            {"type":"fileChange","status":"completed","changes":[{"path":"a.rs","kind":{"type":"update"},"diff":"+new"}]},
            {"type":"fileChange","status":"declined","changes":[{"path":"no.rs","kind":"add"}]},
            {"type":"agentMessage","id":"final","text":"Done"}
        ]},{"items":[{"type":"agentMessage","text":"Next turn"}]}]}));
        assert!(parsed[0].edits.is_empty()); assert_eq!(parsed[1].edits.len(),1);
        assert_eq!(parsed[1].edits[0].path,"a.rs"); assert_eq!(parsed[1].edits[0].diff.as_deref(),Some("+new"));
        assert!(parsed[2].edits.is_empty());
    }
    #[test]
    fn repository_matching_is_exact() {
        let dir = tempfile::tempdir().unwrap();
        let child = dir.path().join("nested");
        std::fs::create_dir(&child).unwrap();
        assert!(same_directory(dir.path(), &dir.path().join(".")));
        assert!(!same_directory(dir.path(), &child));
    }
}
