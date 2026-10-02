//! Read-only adapter for Cursor's published sdk.v1 Connect bridge.
use crate::codex::{Message, MessagePage, ThreadPage, ThreadSummary};
use serde_json::{json, Value};
use std::{
    ffi::{OsStr, OsString},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::Duration,
};

pub struct CursorService {
    executable_file: PathBuf,
    // One bridge per workspace. Listing used to start a new process on every refresh.
    session: Mutex<Option<BridgeSession>>,
}
struct BridgeSession {
    workspace: PathBuf,
    executable: OsString,
    bridge: Bridge,
}
struct Bridge {
    child: Child,
    url: String,
    token: String,
    http: reqwest::blocking::Client,
}
fn stop_child(child: &mut Child) {
    // The published bridge is a shell wrapper that runs Node. Killing only the
    // shell reparents Node to the user session, which is how hundreds of
    // bridges accumulated.
    #[cfg(unix)]
    unsafe {
        extern "C" { fn kill(pid: i32, sig: i32) -> i32; }
        let _ = kill(-(child.id() as i32), 9);
    }
    let _ = child.kill();
    let _ = child.wait();
}
fn bridge_launcher(executable: &Path) -> PathBuf {
    // A pip console script execs the bundled shell launcher and then exits.
    // The shell's Node child is what used to survive after the script was killed.
    let text = std::fs::read_to_string(executable).unwrap_or_default();
    if text.contains("cursor_sdk._vendor") && text.contains("console_entry") {
        if let Some(env_root) = executable.parent().and_then(|bin| bin.parent()) {
            if let Ok(pythons) = std::fs::read_dir(env_root.join("lib")) {
                for python in pythons.flatten() {
                    let launcher = python.path().join("site-packages/cursor_sdk/_vendor/bridge/bin/cursor-sdk-bridge");
                    if launcher.is_file() { return launcher; }
                }
            }
        }
    }
    executable.to_path_buf()
}
fn bridge_command(executable: &OsStr) -> Command {
    let path = bridge_launcher(Path::new(executable));
    // Launch Node directly when the file is the SDK's shell wrapper.
    if let Some(dir) = path.parent() {
        let node = dir.join("node");
        let script = std::fs::canonicalize(dir.join("../dist/bin/cursor-sdk-bridge.js")).unwrap_or_else(|_| dir.join("../dist/bin/cursor-sdk-bridge.js"));
        if node.is_file() && script.is_file() && path.file_name().is_some_and(|name| name != "node") {
            let mut command = Command::new(node);
            command.arg(script);
            return command;
        }
    }
    Command::new(path)
}
impl Drop for Bridge {
    fn drop(&mut self) {
        stop_child(&mut self.child);
    }
}
impl Bridge {
    fn start(executable: &OsStr, path: &Path) -> Result<Self, String> {
        let mut command = bridge_command(executable);
        command.args(["--host", "127.0.0.1", "--port", "0", "--workspace"]).arg(path)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        // tauri dev stops this app with SIGKILL, which skips Drop. Ask the
        // kernel to stop the bridge when this process dies.
        #[cfg(target_os = "linux")]
        unsafe {
            use std::os::unix::process::CommandExt;
            command.pre_exec(|| {
                extern "C" { fn prctl(option: i32, sig: u64, arg3: u64, arg4: u64, arg5: u64) -> i32; }
                let _ = prctl(1, 9, 0, 0, 0);
                Ok(())
            });
        }
        let mut child = command.spawn()
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
        Self { executable_file, session: Mutex::new(None) }
    }
    fn with_bridge<T>(&self, path: &Path, body: impl FnOnce(&Bridge) -> Result<T, String>) -> Result<T, String> {
        let workspace = path.canonicalize().map_err(|e| e.to_string())?;
        let executable = self.executable()?;
        let mut slot = self.session.lock().map_err(|_| "Cursor bridge lock poisoned".to_owned())?;
        let same = slot.as_ref().is_some_and(|session| session.workspace == workspace && session.executable == executable);
        if !same { slot.take(); }
        else if slot.as_ref().is_some_and(|session| session.bridge.call("SdkBridgeControlService/Ping", json!({})).is_err()) {
            slot.take();
        }
        if slot.is_none() {
            *slot = Some(BridgeSession { workspace: workspace.clone(), executable: executable.clone(), bridge: Bridge::start(&executable, &workspace)? });
        }
        body(&slot.as_ref().unwrap().bridge)
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
        self.with_bridge(path, |bridge| {
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
        })
    }
    pub fn archive_thread(&self, path: &Path, id: &str, archived: bool) -> Result<(), String> {
        if id.starts_with("editor:") { return Err("Cursor editor conversations do not expose archive controls to this app".into()); }
        self.with_bridge(path, |bridge| {
        let agent = bridge.call("SdkAgentService/GetAgent", json!({"agentId":id,"options":{"cwd":path}}))?;
        if !same_directory(&agent, path) && !same_directory(&agent["agent"], path) {
            return Err("This Cursor conversation belongs to another repository".into());
        }
        bridge.call(if archived {"SdkAgentService/ArchiveAgent"} else {"SdkAgentService/UnarchiveAgent"}, json!({"agentId":id,"options":{"cwd":path}}))?;
        Ok(())
        })
    }
    pub fn messages(&self, path: &Path, id: String) -> Result<MessagePage, String> {
        if id.starts_with("bc-") {
            return Err("Only local Cursor conversations are supported".into());
        }
        self.with_bridge(path, |bridge| {
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
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shell_wrapper_launches_node_directly() {
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("bin");
        std::fs::create_dir_all(bin.join("../dist/bin")).unwrap();
        let executable = bin.join("cursor-sdk-bridge");
        let node = bin.join("node");
        std::fs::write(&executable, "#!/bin/sh\nexec node\n").unwrap();
        std::fs::write(&node, "").unwrap();
        std::fs::write(root.path().join("dist/bin/cursor-sdk-bridge.js"), "").unwrap();
        let command = bridge_command(executable.as_os_str());
        assert_eq!(command.get_program(), node.as_os_str());
        let env = tempfile::tempdir().unwrap();
        let console = env.path().join("bin/cursor-sdk-bridge");
        std::fs::create_dir_all(console.parent().unwrap()).unwrap();
        std::fs::write(&console, "#!/usr/bin/env python3\nfrom cursor_sdk._vendor import console_entry\n").unwrap();
        let bundled = env.path().join("lib/python3.12/site-packages/cursor_sdk/_vendor/bridge");
        std::fs::create_dir_all(bundled.join("bin")).unwrap();
        std::fs::create_dir_all(bundled.join("dist/bin")).unwrap();
        std::fs::write(bundled.join("bin/cursor-sdk-bridge"), "#!/bin/sh\n").unwrap();
        let bundled_node = bundled.join("bin/node");
        std::fs::write(&bundled_node, "").unwrap();
        std::fs::write(bundled.join("dist/bin/cursor-sdk-bridge.js"), "").unwrap();
        let command = bridge_command(console.as_os_str());
        assert_eq!(command.get_program(), bundled_node.as_os_str());
    }
    #[cfg(unix)]
    #[test]
    fn stopping_a_bridge_kills_the_wrapper_child() {
        use std::os::unix::process::CommandExt;
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 120 & echo $!; wait")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        let grandchild = line.trim();
        let proc = PathBuf::from(format!("/proc/{grandchild}"));
        assert!(proc.exists());
        stop_child(&mut child);
        let alive = std::fs::read_to_string(proc.join("stat")).ok().is_some_and(|stat| {
            matches!(stat.rsplit(')').next().and_then(|rest| rest.split_whitespace().next()), Some("R" | "S" | "D"))
        });
        assert!(!alive, "wrapper child still running");
    }
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
