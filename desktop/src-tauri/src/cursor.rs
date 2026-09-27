//! Read-only adapter for Cursor's published sdk.v1 Connect bridge.
use crate::codex::{Message, MessagePage, ThreadPage, ThreadSummary};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

pub struct CursorService {
    executable_file: PathBuf,
}
struct Bridge {
    child: Child,
    url: String,
    token: String,
    http: reqwest::blocking::Client,
}
impl Drop for Bridge {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Bridge {
    fn start(executable: &std::ffi::OsStr, path: &Path) -> Result<Self, String> {
        let mut child = Command::new(executable).args(["--host", "127.0.0.1", "--port", "0", "--workspace"]).arg(path)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn()
            .map_err(|e| format!("Could not start Cursor SDK bridge: {e}. Open Setup to install or choose cursor-sdk-bridge."))?;
        let stderr = child
            .stderr
            .take()
            .ok_or("Cursor bridge stderr unavailable")?;
        let mut bridge = Self {
            child,
            url: String::new(),
            token: String::new(),
            http: reqwest::blocking::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|e| e.to_string())?,
        };
        let (send, receive) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Some(payload) = line.strip_prefix("cursor-sdk-bridge ready ") {
                    let _ = send.try_send(serde_json::from_str::<Value>(payload));
                }
            }
        });
        let ready = receive
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "Cursor bridge did not become ready. Check the executable installation.")?
            .map_err(|e| e.to_string())?;
        if ready["schemaVersion"] != 1
            || ready["protocol"] != "connect"
            || ready["transport"] != "tcp"
        {
            return Err("Unsupported Cursor bridge protocol".into());
        }
        let url = ready["url"].as_str().ok_or("Missing Cursor bridge URL")?;
        let parsed = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
        if parsed.scheme() != "http"
            || parsed.host_str() != Some("127.0.0.1")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err("Cursor bridge must use local loopback HTTP".into());
        }
        bridge.url = url.trim_end_matches('/').to_owned();
        bridge.token = if let Some(token) = ready["authToken"].as_str() {
            token.to_owned()
        } else {
            std::fs::read_to_string(
                ready["authTokenFile"]
                    .as_str()
                    .ok_or("Missing Cursor bridge token file")?,
            )
            .map_err(|e| e.to_string())?
            .trim()
            .to_owned()
        };
        bridge.call("SdkBridgeControlService/Ping", json!({}))?;
        Ok(bridge)
    }
    fn call(&self, method: &str, body: Value) -> Result<Value, String> {
        let response = self
            .http
            .post(format!("{}/sdk.v1.{method}", self.url))
            .bearer_auth(&self.token)
            .header("Connect-Protocol-Version", "1")
            .json(&body)
            .send()
            .map_err(|e| e.to_string())?;
        let status = response.status();
        let value: Value = response.json().map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!(
                "Cursor: {}",
                value["message"]
                    .as_str()
                    .unwrap_or("History request failed")
            ));
        }
        Ok(value)
    }
}
fn same_directory(value: &Value, path: &Path) -> bool {
    value["local"]["cwd"]
        .as_str()
        .and_then(|cwd| Path::new(cwd).canonicalize().ok())
        .zip(path.canonicalize().ok())
        .is_some_and(|(a, b)| a == b)
}
fn string(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_owned()
}
// Cursor stores runtime notifications as user turns. They are not human prompts.
pub(crate) fn is_system_notification(text: &str) -> bool {
    let normalized = text
        .replace("\\<", "<")
        .replace("\\>", ">")
        .replace("\\_", "_");
    let mut rest = normalized.trim_start();
    if let Some(timestamp) = rest.strip_prefix("<timestamp>") {
        let Some((_, after)) = timestamp.split_once("</timestamp>") else {
            return false;
        };
        rest = after.trim_start();
    }
    rest.starts_with("<system_notification>") && rest.contains("</system_notification>")
}

fn messages(value: &Value) -> Vec<Message> {
    let mut output = Vec::new();
    for item in value["messages"].as_array().into_iter().flatten() {
        let payload = &item["message"];
        // Local SDK history contains entire protobuf conversation turns, including
        // both the prompt and assistant steps, even when the wrapper type is user.
        let turn = payload
            .get("agentConversationTurn")
            .or_else(|| payload.get("agent_conversation_turn"))
            .or_else(|| {
                (payload["turn"]["case"] == "agentConversationTurn")
                    .then_some(&payload["turn"]["value"])
            });
        if let Some(turn) = turn {
            let user = turn.get("userMessage").or_else(|| turn.get("user_message"));
            if let Some(text) = user
                .and_then(|v| v["text"].as_str())
                .filter(|s| !s.is_empty())
            {
                output.push(Message {
                    id: format!("{}:user", string(&item["uuid"])),
                    role: "user".into(),
                    text: text.into(), edits:Vec::new(),
                });
            }
            for (index, step) in turn["steps"].as_array().into_iter().flatten().enumerate() {
                let assistant = step
                    .get("assistantMessage")
                    .or_else(|| step.get("assistant_message"))
                    .or_else(|| {
                        (step["message"]["case"] == "assistantMessage")
                            .then_some(&step["message"]["value"])
                    });
                if let Some(text) = assistant
                    .and_then(|v| v["text"].as_str())
                    .filter(|s| !s.is_empty())
                {
                    output.push(Message {
                        id: format!("{}:assistant:{index}", string(&item["uuid"])),
                        role: "assistant".into(),
                        text: text.into(), edits:Vec::new(),
                    });
                }
            }
            continue;
        }
        let role = item["type"].as_str().unwrap_or_default();
        if !matches!(role, "user" | "assistant") {
            continue;
        }
        let content = &payload["content"];
        let text = if let Some(text) = content.as_str() {
            text.to_owned()
        } else {
            content
                .as_array()
                .into_iter()
                .flatten()
                .filter(|part| part["type"] == "text")
                .filter_map(|part| part["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n\n")
        };
        if !text.is_empty() {
            output.push(Message {
                id: string(&item["uuid"]),
                role: role.into(),
                text, edits:Vec::new(),
            });
        }
    }
    output.retain(|message| message.role != "user" || !is_system_notification(&message.text));
    output
}
impl CursorService {
    pub fn new(executable_file: PathBuf) -> Self {
        Self { executable_file }
    }
    fn executable(&self) -> Result<std::ffi::OsString, String> {
        crate::provider_paths::resolve_from_file(&self.executable_file, "cursor")?
            .map(|path| path.into_os_string()).ok_or("Cursor SDK bridge is not installed".into())
    }
    pub fn configure(&self, path: &Path) -> Result<(), String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let _bridge = Bridge::start(path.as_os_str(), &std::env::temp_dir())?;
        std::fs::write(&self.executable_file, path.to_string_lossy().as_bytes())
            .map_err(|e| e.to_string())
    }
    pub fn threads(
        &self,
        path: &Path,
        cursor: Option<String>,
        archived: bool,
    ) -> Result<ThreadPage, String> {
        let bridge = Bridge::start(&self.executable()?, path)?;
        let result = bridge.call("SdkAgentService/ListAgents", json!({"options":{"runtime":"RUNTIME_LOCAL","cwd":path,"limit":30,"cursor":cursor.unwrap_or_default(),"includeArchived":archived}}))?;
        let mut data: Vec<_> = result["items"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|v| {
                same_directory(v, path) && v["archived"].as_bool().unwrap_or(false) == archived
            })
            .map(|v| ThreadSummary {
                id: string(&v["agentId"]),
                name: v["name"].as_str().map(str::to_owned),
                preview: string(&v["summary"]),
                cwd: string(&v["local"]["cwd"]),
                updated_at: v["lastModified"]
                    .as_str()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|d| d.timestamp())
                    .unwrap_or(0),
                git_info: None,
                working: v["status"].as_str().is_some_and(|status| status.eq_ignore_ascii_case("running"))
                    || v["status"]["type"].as_str().is_some_and(|status| status.eq_ignore_ascii_case("running")),
            })
            .collect();
        data.sort_by_key(|v| std::cmp::Reverse(v.updated_at));
        Ok(ThreadPage {
            data,
            next_cursor: result["nextCursor"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned),
        })
    }
    pub fn archive_thread(&self, path: &Path, id: &str, archived: bool) -> Result<(), String> {
        if id.starts_with("editor:") { return Err("Cursor editor conversations do not expose archive controls to this app".into()); }
        let bridge = Bridge::start(&self.executable()?, path)?;
        let agent = bridge.call("SdkAgentService/GetAgent", json!({"agentId":id,"options":{"cwd":path}}))?;
        if !same_directory(&agent, path) && !same_directory(&agent["agent"], path) {
            return Err("This Cursor conversation belongs to another repository".into());
        }
        bridge.call(if archived {"SdkAgentService/ArchiveAgent"} else {"SdkAgentService/UnarchiveAgent"}, json!({"agentId":id,"options":{"cwd":path}}))?;
        Ok(())
    }
    pub fn messages(&self, path: &Path, id: String) -> Result<MessagePage, String> {
        if id.starts_with("bc-") {
            return Err("Only local Cursor conversations are supported".into());
        }
        let bridge = Bridge::start(&self.executable()?, path)?;
        let agent = bridge.call(
            "SdkAgentService/GetAgent",
            json!({"agentId":id,"options":{"cwd":path}}),
        )?;
        if !same_directory(&agent["agent"], path) {
            return Err("Cursor conversation belongs to another directory".into());
        }
        let result = bridge.call(
            "SdkAgentService/ListAgentMessages",
            json!({"agentId":id,"options":{"cwd":path,"runtime":"RUNTIME_LOCAL"}}),
        )?;
        Ok(MessagePage {
            data: messages(&result),
            next_cursor: None,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn runtime_notifications_are_not_user_prompts() {
        let notification = "<timestamp>Friday</timestamp>\n<system_notification><task>status: aborted</task></system_notification><user_query>Inform the user.</user_query>";
        for text in [
            notification.to_owned(),
            notification.replace('<', "\\<").replace('_', "\\_"),
        ] {
            assert!(is_system_notification(&text));
            let data = messages(&json!({"messages":[
                {"type":"user","uuid":"n","message":{"content":text}},
                {"type":"user","uuid":"u","message":{"content":"Real prompt"}},
                {"type":"assistant","uuid":"a","message":{"content":"Response"}}
            ]}));
            assert_eq!(data.len(), 2);
            assert_eq!(data[0].text, "Real prompt");
        }
        assert!(!is_system_notification(
            "Explain <system_notification>example</system_notification>"
        ));
        assert!(!is_system_notification(
            "```xml\n<system_notification>example</system_notification>\n```"
        ));
        assert!(!is_system_notification(
            "<user_query><system_notification>example</system_notification></user_query>"
        ));
    }

    #[test]
    #[ignore = "requires GITCERBERUS_TEST_CURSOR_BRIDGE pointing to an installed bridge"]
    fn live_bridge_lists_empty_repository() {
        let executable = std::env::var_os("GITCERBERUS_TEST_CURSOR_BRIDGE").unwrap();
        let directory = tempfile::tempdir().unwrap();
        let bridge = Bridge::start(&executable, directory.path()).unwrap();
        let result = bridge
            .call(
                "SdkAgentService/ListAgents",
                json!({"options":{"runtime":"RUNTIME_LOCAL","cwd":directory.path(),"limit":30}}),
            )
            .unwrap();
        assert!(result["items"]
            .as_array()
            .is_none_or(|items| items.is_empty()));
    }
    #[test]
    fn extracts_text_without_tools() {
        let data = messages(
            &json!({"messages":[{"type":"user","uuid":"1","message":{"content":[{"type":"text","text":"hello"}]}},{"type":"assistant","uuid":"2","message":{"content":[{"type":"tool_use","name":"shell"},{"type":"text","text":"answer"}]}},{"type":"tool","message":{"content":"secret"}}]}),
        );
        assert_eq!(data.len(), 2);
        assert_eq!(data[0].text, "hello");
        assert_eq!(data[1].text, "answer");
    }
    #[test]
    fn expands_sdk_turn_into_prompt_and_response() {
        for payload in [
            json!({"agentConversationTurn":{"userMessage":{"text":"prompt"},"steps":[{"assistantMessage":{"text":"response"}},{"thinkingMessage":{"text":"private"}}]}}),
            json!({"turn":{"case":"agentConversationTurn","value":{"userMessage":{"text":"prompt"},"steps":[{"message":{"case":"assistantMessage","value":{"text":"response"}}}]}}}),
        ] {
            let data =
                messages(&json!({"messages":[{"type":"user","uuid":"turn","message":payload}]}));
            assert_eq!(data.len(), 2);
            assert_eq!(data[0].role, "user");
            assert_eq!(data[1].role, "assistant");
            assert_eq!(data[1].text, "response");
        }
    }
    #[test]
    fn rejects_other_directories() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        assert!(!same_directory(
            &json!({"local":{"cwd":b.path()}}),
            a.path()
        ));
        assert!(same_directory(&json!({"local":{"cwd":a.path()}}), a.path()));
    }
}
