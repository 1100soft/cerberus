use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};

#[derive(Default)]
pub struct CodexService {
    connection: Mutex<Option<Client>>,
    executable_file: PathBuf,
}

struct Client {
    child: Child,
    input: ChildStdin,
    output: mpsc::Receiver<Value>,
    sequence: u64,
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Client {
    fn start(executable: &std::ffi::OsStr) -> Result<Self, String> {
        let mut command = Command::new(executable);
        command.arg("app-server");
        Self::start_command(command)
    }

    fn start_command(mut command: Command) -> Result<Self, String> {
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
            sequence: 0,
        };
        client.request("initialize", json!({"clientInfo": {"name":"gitcerberus", "title":"GitCerberus", "version":"0.1.0"}, "capabilities":{"experimentalApi":true}}))?;
        client.send(json!({"method":"initialized", "params":{}}))?;
        Ok(client)
    }

    fn send(&mut self, value: Value) -> Result<(), String> {
        writeln!(self.input, "{value}")
            .and_then(|_| self.input.flush())
            .map_err(|e| e.to_string())
    }

    fn request(&mut self, method: &str, params: Value) -> Result<Value, String> {
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
            // This viewer never approves agent actions or supplies credentials to tools.
            if value.get("method").is_some() && value.get("id").is_some() {
                self.send(json!({"id":value["id"], "error":{"code":-32601,"message":"Read-only history client"}}))?;
                continue;
            }
            if value["id"].as_u64() != Some(id) {
                continue;
            }
            if let Some(error) = value.get("error") {
                return Err(error["message"]
                    .as_str()
                    .unwrap_or("Codex request failed")
                    .to_owned());
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
            executable_file,
        }
    }

    pub fn configure(&self, path: &Path) -> Result<(), String> {
        if !path.is_absolute() || !path.is_file() {
            return Err("Choose the Codex executable file using its full path.".into());
        }
        let mut guard = self
            .connection
            .lock()
            .map_err(|_| "Codex connection lock failed")?;
        let client = Client::start(path.as_os_str())?;
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
            let executable = std::fs::read_to_string(&self.executable_file)
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(std::ffi::OsString::from)
                .or_else(|| std::env::var_os("GITCERBERUS_CODEX_PATH"))
                .unwrap_or_else(|| "codex".into());
            *guard = Some(Client::start(&executable)?);
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
        let page: ThreadPage = serde_json::from_value(value)
            .map_err(|e| format!("Unsupported Codex thread response: {e}"))?;
        Ok(ThreadPage {
            data: page
                .data
                .into_iter()
                .filter(|thread| same_directory(path, Path::new(&thread.cwd)))
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
        match self.request("thread/turns/list", json!({"threadId":thread_id,"cursor":cursor,"limit":30,"sortDirection":"desc","itemsView":"full"})) {
            Ok(page) => Ok(MessagePage {
                data: page_messages(&page),
                next_cursor: page["nextCursor"].as_str().map(str::to_owned),
            }),
            Err(error) if cursor.is_none() && (error.to_lowercase().contains("unsupported") || error.to_lowercase().contains("not support") || error.to_lowercase().contains("unknown") || error.to_lowercase().contains("not found")) => {
                let value = self.request("thread/read", json!({"threadId":thread_id,"includeTurns":true}))?;
                Ok(MessagePage { data: messages(&value["thread"]), next_cursor: None })
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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: String,
    pub name: Option<String>,
    pub preview: String,
    pub cwd: String,
    pub updated_at: i64,
    pub git_info: Option<Value>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPage {
    pub data: Vec<ThreadSummary>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Message {
    pub id: String,
    pub role: String,
    pub text: String,
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
        for item in turn["items"].as_array().into_iter().flatten() {
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
                    text,
                });
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
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
        result = {'thread':{'cwd':cwd if params['threadId']=='ours' else '/another-repository'}}
    elif method == 'thread/turns/list':
        assert params['threadId'] == 'ours'
        assert params['itemsView'] == 'full'
        result = {'data':[{'items':[{'id':'a','type':'agentMessage','text':'Hello'}]}], 'nextCursor':'older'}
    else: raise AssertionError(method)
    print(json.dumps({'id':request['id'],'result':result}), flush=True)
"#, dir.path().to_str().unwrap()]);
        let service = CodexService {
            connection: Mutex::new(Some(Client::start_command(command).unwrap())),
            executable_file: PathBuf::new(),
        };
        let page = service.threads(dir.path(), None, false).unwrap();
        assert_eq!(page.data.len(), 1);
        assert_eq!(page.data[0].id, "ours");
        assert_eq!(page.next_cursor.as_deref(), Some("next"));
        let page = service.messages(dir.path(), "ours".into(), None).unwrap();
        assert_eq!(page.data[0].text, "Hello");
        assert_eq!(page.next_cursor.as_deref(), Some("older"));
        assert!(service.messages(dir.path(), "other".into(), None).is_err());
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
    fn repository_matching_is_exact() {
        let dir = tempfile::tempdir().unwrap();
        let child = dir.path().join("nested");
        std::fs::create_dir(&child).unwrap();
        assert!(same_directory(dir.path(), &dir.path().join(".")));
        assert!(!same_directory(dir.path(), &child));
    }
}
