use serde::Serialize;
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use tauri::ipc::Channel;
#[derive(Default)]
pub struct SetupTerminal {
    running: AtomicBool,
    cancel: AtomicBool,
}
#[derive(Clone, Serialize)]
pub struct SetupOutput {
    pub text: String,
}
struct Running<'a>(&'a AtomicBool);
impl Drop for Running<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl SetupTerminal {
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }
    pub fn install(
        &self,
        root: &Path,
        provider: &str,
        approved: bool,
        output: Channel<SetupOutput>,
    ) -> Result<PathBuf, String> {
        if !approved {
            return Err("Installation requires approval".into());
        }
        if !matches!(provider, "codex" | "cursor" | "cursor-agent" | "copilot" | "claude") {
            return Err("Unknown provider".into());
        }
        if let Ok(Some(path)) = crate::provider_paths::resolve(root, provider) {
            let _ = output.send(SetupOutput {
                text: "Using the existing installation.\n".into(),
            });
            return Ok(path);
        }
        if self.running.swap(true, Ordering::SeqCst) {
            return Err("An installation is already running".into());
        }
        let _running = Running(&self.running);
        self.cancel.store(false, Ordering::SeqCst);
        let directory = root.join("providers").join(provider);
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        if provider == "cursor-agent" {
            let url = if cfg!(windows) {
                "https://cursor.com/install?win32=true"
            } else {
                "https://cursor.com/install"
            };
            let _ = output.send(SetupOutput {
                text: format!("Downloading official Cursor installer from {url}\n"),
            });
            let response = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(45))
                .build()
                .map_err(|e| e.to_string())?
                .get(url)
                .send()
                .and_then(|r| r.error_for_status())
                .map_err(|e| e.to_string())?;
            let script = directory.join(if cfg!(windows) {
                "install.ps1"
            } else {
                "install.sh"
            });
            std::fs::write(&script, response.bytes().map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            if self.cancel.load(Ordering::SeqCst) {
                return Err("Installation stopped".into());
            }
            #[cfg(windows)]
            let mut command = {
                let mut c = Command::new("powershell.exe");
                c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
                c
            };
            #[cfg(not(windows))]
            let mut command = Command::new("bash");
            command.arg(&script).env("NO_COLOR", "1");
            #[cfg(not(windows))]
            {
                let curl_home = directory.join("curl");
                std::fs::create_dir_all(&curl_home).map_err(|e| e.to_string())?;
                let previous = std::env::var_os("CURL_HOME")
                    .or_else(|| std::env::var_os("HOME"))
                    .map(PathBuf::from)
                    .map(|p| p.join(".curlrc"));
                let mut configuration = String::new();
                if let Some(path) = previous.filter(|p| p.is_file()) {
                    let escaped = path
                        .to_string_lossy()
                        .replace('\\', "\\\\")
                        .replace('"', "\\\"");
                    configuration.push_str(&format!("config = \"{escaped}\"\n"));
                }
                configuration.push_str("connect-timeout = 15\nspeed-limit = 1\nspeed-time = 45\nmax-time = 480\nretry = 2\nretry-delay = 2\nretry-max-time = 120\n");
                std::fs::write(curl_home.join(".curlrc"), configuration)
                    .map_err(|e| e.to_string())?;
                command.env("CURL_HOME", curl_home);
            }
            self.run(command, &output)?;
            return crate::provider_paths::resolve(root, "cursor-agent")?.ok_or("Installer finished but Cursor Agent could not be found. Choose its path in Advanced settings.".into());
        }
        if provider == "codex" {
            #[cfg(windows)]
            let mut command = {
                let mut c = Command::new("cmd.exe");
                c.args(["/d", "/c", "npm"]);
                c
            };
            #[cfg(not(windows))]
            let mut command = Command::new("npm");
            command
                .arg("install")
                .arg("--prefix")
                .arg(&directory)
                .args(["--no-audit", "--no-fund", "@openai/codex"]);
            self.run(command, &output)?;
            // Choose the native binary, since npm's .cmd shim cannot serve app-server stdio directly.
            fn native(path: &Path) -> Option<PathBuf> {
                for entry in std::fs::read_dir(path).ok()?.flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        if let Some(found) = native(&p) {
                            return Some(found);
                        }
                    } else if matches!(
                        p.file_name().and_then(|n| n.to_str()),
                        Some("codex" | "codex.exe")
                    ) {
                        return Some(p);
                    }
                }
                None
            }
            native(&directory.join("node_modules/@openai"))
                .ok_or("Installed Codex native executable was not found".into())
        } else if matches!(provider, "copilot" | "claude") {
            let package = if provider == "copilot" { "@github/copilot" } else { "@anthropic-ai/claude-code" };
            #[cfg(windows)]
            let mut command = {
                let mut c = Command::new("cmd.exe");
                c.args(["/d", "/c", "npm"]);
                c
            };
            #[cfg(not(windows))]
            let mut command = Command::new("npm");
            command.arg("install").arg("--prefix").arg(&directory).args(["--no-audit", "--no-fund", package]);
            self.run(command, &output)?;
            prefixed_executable(&directory, provider)
        } else {
            #[cfg(windows)]
            let python = "python";
            #[cfg(not(windows))]
            let python = "python3";
            let mut create = Command::new(python);
            create.args(["-m", "venv"]).arg(&directory);
            self.run(create, &output)?;
            let bin = directory.join(if cfg!(windows) { "Scripts" } else { "bin" });
            let mut install = Command::new(bin.join(if cfg!(windows) {
                "python.exe"
            } else {
                "python"
            }));
            install.args([
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "cursor-sdk",
            ]);
            self.run(install, &output)?;
            Ok(bin.join(if cfg!(windows) {
                "cursor-sdk-bridge.exe"
            } else {
                "cursor-sdk-bridge"
            }))
        }
    }
    fn run(&self, mut command: Command, output: &Channel<SetupOutput>) -> Result<(), String> {
        let _ = output.send(SetupOutput {
            text: format!("$ {:?}\n", command),
        });
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                format!(
                    "Could not start installer: {e}. Check that Node/npm or Python is installed."
                )
            })?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let readers: Vec<_> = [
            Box::new(stdout) as Box<dyn std::io::Read + Send>,
            Box::new(stderr),
        ]
        .into_iter()
        .map(|pipe| {
            let output = output.clone();
            std::thread::spawn(move || {
                let mut pipe = pipe;
                let mut buffer = [0u8; 4096];
                let mut decoder = crate::terminal_text::TerminalText::default();
                loop {
                    match pipe.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => {
                            let text = decoder.push(&buffer[..count]);
                            if !text.is_empty() {
                                let _ = output.send(SetupOutput { text });
                            }
                        }
                    }
                }
            })
        })
        .collect();
        let deadline = Instant::now() + Duration::from_secs(600);
        loop {
            if self.cancel.load(Ordering::SeqCst) || Instant::now() > deadline {
                stop_process_tree(&mut child);
                let _ = child.wait();
                return Err(if self.cancel.load(Ordering::SeqCst) {
                    "Installation stopped."
                } else {
                    "Installation timed out after 10 minutes. Check the connection and retry."
                }
                .into());
            }
            match child.try_wait() {
                Ok(Some(status)) => {
                    for reader in readers {
                        let _ = reader.join();
                    }
                    return if status.success() {
                        Ok(())
                    } else {
                        Err(format!("Installer exited with {status}"))
                    };
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(e) => {
                    stop_process_tree(&mut child);
                    let _ = child.wait();
                    return Err(e.to_string());
                }
            }
        }
    }
}
pub(crate) fn stop_process_tree(child: &mut std::process::Child) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{}", child.id())])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}
#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn reports_command_failure_and_cancel() {
        let service = SetupTerminal::default();
        let mut failure = Command::new("sh");
        failure.args(["-c", "exit 7"]);
        assert!(service
            .run(failure, &Channel::new(|_| Ok(())))
            .unwrap_err()
            .contains("7"));
        service.cancel();
        let mut wait = Command::new("sh");
        wait.args(["-c", "sleep 30"]);
        let start = Instant::now();
        assert!(service.run(wait, &Channel::new(|_| Ok(()))).is_err());
        assert!(start.elapsed() < Duration::from_secs(3));
    }
    #[cfg(unix)]
    #[test]
    fn streams_carriage_return_progress_before_process_exits() {
        let service = SetupTerminal::default();
        let (send, receive) = std::sync::mpsc::channel();
        let output = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(body) = body {
                let _ = send.send(body);
            }
            Ok(())
        });
        std::thread::scope(|scope| {
            let worker = scope.spawn(|| {
                let mut command = Command::new("sh");
                command.args(["-c", "printf '\\033[2K42%%\\r'; sleep 2"]);
                service.run(command, &output)
            });
            receive.recv_timeout(Duration::from_secs(1)).unwrap(); // command announcement
            let progress = receive.recv_timeout(Duration::from_secs(1)).unwrap();
            assert!(progress.contains("42%"));
            assert!(!progress.contains("[2K"));
            service.cancel();
            assert!(worker.join().unwrap().is_err());
        });
    }
    #[test]
    fn requires_approval_and_known_provider() {
        let service = SetupTerminal::default();
        let root = tempfile::tempdir().unwrap();
        assert!(service
            .install(root.path(), "codex", false, Channel::new(|_| Ok(())))
            .is_err());
        assert!(service
            .install(root.path(), "cursor-agent", false, Channel::new(|_| Ok(())))
            .is_err());
        assert!(service
            .install(root.path(), "copilot", false, Channel::new(|_| Ok(())))
            .is_err());
        assert!(service
            .install(root.path(), "claude", false, Channel::new(|_| Ok(())))
            .is_err());
        assert!(service
            .install(root.path(), "shell", true, Channel::new(|_| Ok(())))
            .is_err());
    }
}
fn prefixed_executable(directory: &Path, name: &str) -> Result<PathBuf, String> {
    #[allow(unused_mut)]
    let mut candidates = vec![directory.join("bin").join(name), directory.join("node_modules/.bin").join(name)];
    #[cfg(windows)]
    {
        candidates.push(directory.join("bin").join(format!("{name}.cmd")));
        candidates.push(directory.join("bin").join(format!("{name}.exe")));
    }
    for path in candidates {
        if path.is_file() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = path.metadata() {
                    let mut permissions = meta.permissions();
                    if permissions.mode() & 0o111 == 0 {
                        permissions.set_mode(permissions.mode() | 0o755);
                        let _ = std::fs::set_permissions(&path, permissions);
                    }
                }
            }
            return Ok(path);
        }
    }
    Err(format!("Installed {name} executable was not found. Choose its path in Advanced settings."))
}
