use serde::Serialize;
use std::{
    io::{BufRead, BufReader},
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
        if !matches!(provider, "codex" | "cursor") {
            return Err("Unknown provider".into());
        }
        if self.running.swap(true, Ordering::SeqCst) {
            return Err("An installation is already running".into());
        }
        let _running = Running(&self.running);
        self.cancel.store(false, Ordering::SeqCst);
        let directory = root.join("providers").join(provider);
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
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
                for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                    let _ = output.send(SetupOutput {
                        text: format!("{line}\n"),
                    });
                }
            })
        })
        .collect();
        let deadline = Instant::now() + Duration::from_secs(600);
        loop {
            if self.cancel.load(Ordering::SeqCst) || Instant::now() > deadline {
                stop_process_tree(&mut child);
                let _ = child.wait();
                return Err("Installation stopped. You can retry.".into());
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
fn stop_process_tree(child: &mut std::process::Child) {
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
    #[test]
    fn requires_approval_and_known_provider() {
        let service = SetupTerminal::default();
        let root = tempfile::tempdir().unwrap();
        assert!(service
            .install(root.path(), "codex", false, Channel::new(|_| Ok(())))
            .is_err());
        assert!(service
            .install(root.path(), "shell", true, Channel::new(|_| Ok(())))
            .is_err());
    }
}
