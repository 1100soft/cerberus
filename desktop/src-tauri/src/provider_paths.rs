use serde::Serialize;
use std::path::{Path, PathBuf};

pub fn specification(tool: &str) -> Result<(&'static str, &'static str, &'static str), String> {
    match tool {
        "codex" => Ok(("codex-executable.txt", "GITCERBERUS_CODEX_PATH", "codex")),
        "cursor" => Ok((
            "cursor-executable.txt",
            "GITCERBERUS_CURSOR_PATH",
            "cursor-sdk-bridge",
        )),
        "cursor-agent" => Ok((
            "cursor-agent-executable.txt",
            "GITCERBERUS_CURSOR_AGENT_PATH",
            "agent",
        )),
        "copilot" => Ok((
            "copilot-executable.txt",
            "GITCERBERUS_COPILOT_PATH",
            "copilot",
        )),
        "claude" => Ok(("claude-executable.txt", "GITCERBERUS_CLAUDE_PATH", "claude")),
        _ => Err("Unknown provider tool".into()),
    }
}
fn usable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return path
            .metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
    }
    #[cfg(not(unix))]
    {
        true
    }
}
fn find(value: &Path) -> Option<PathBuf> {
    if value.is_absolute() {
        return usable(value).then(|| value.to_path_buf());
    }
    if value.components().count() != 1 {
        return None;
    }
    for directory in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        if !directory.is_absolute() {
            continue;
        }
        let path = directory.join(value);
        if usable(&path) {
            return Some(path);
        }
        #[cfg(windows)]
        {
            let path = path.with_extension("exe");
            if usable(&path) {
                return Some(path);
            }
        }
    }
    None
}
pub fn codex_version(path: &Path) -> Option<semver::Version> {
    use std::{
        io::Read,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let mut child = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) | Err(_) => return None,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
    let mut output = String::new();
    child
        .stdout
        .take()?
        .take(4096)
        .read_to_string(&mut output)
        .ok()?;
    output
        .split_whitespace()
        .find_map(|part| semver::Version::parse(part).ok())
}
fn extension_codex_candidates(home: &Path) -> Vec<PathBuf> {
    let platform = format!(
        "{}-{}",
        if cfg!(target_os = "macos") {
            "macos"
        } else if cfg!(windows) {
            "windows"
        } else {
            "linux"
        },
        std::env::consts::ARCH
    );
    let binary = if cfg!(windows) { "codex.exe" } else { "codex" };
    [
        ".vscode",
        ".vscode-insiders",
        ".vscode-server",
        ".vscode-server-insiders",
        ".cursor",
    ]
    .iter()
    .flat_map(|editor| {
        std::fs::read_dir(home.join(editor).join("extensions"))
            .into_iter()
            .flatten()
            .flatten()
    })
    .filter(|entry| {
        entry
            .file_name()
            .to_string_lossy()
            .starts_with("openai.chatgpt-")
    })
    .map(|entry| entry.path().join("bin").join(&platform).join(binary))
    .collect()
}
fn newest_codex(paths: Vec<PathBuf>) -> Option<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let paths = paths
        .into_iter()
        .filter_map(|path| find(&path))
        .filter(|path| seen.insert(path.canonicalize().unwrap_or_else(|_| path.clone())))
        .collect::<Vec<_>>();
    let newest = paths
        .iter()
        .filter_map(|path| codex_version(path).map(|version| (version, path)))
        .max_by(|a, b| a.0.cmp(&b.0));
    newest
        .map(|(_, path)| path.clone())
        .or_else(|| paths.first().cloned())
}
pub fn resolve(root: &Path, tool: &str) -> Result<Option<PathBuf>, String> {
    let (file, _, _) = specification(tool)?;
    resolve_from_file(&root.join(file), tool)
}
pub fn resolve_from_file(file: &Path, tool: &str) -> Result<Option<PathBuf>, String> {
    let root = file.parent().unwrap_or(Path::new("."));
    let (_, env, name) = specification(tool)?;
    // An explicit saved override is authoritative; never silently run another binary when it breaks.
    if let Ok(saved) = std::fs::read_to_string(file) {
        if !saved.trim().is_empty() {
            return find(Path::new(saved.trim())).map(Some).ok_or_else(|| "The saved executable is missing or is not executable. Reset it in Advanced settings.".into());
        }
    }
    if let Some(value) = std::env::var_os(env) {
        if let Some(path) = find(Path::new(&value)) {
            return Ok(Some(path));
        }
    }
    let mut candidates = vec![PathBuf::from(name)];
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        let home = PathBuf::from(home);
        if tool == "codex" {
            candidates.extend(extension_codex_candidates(&home));
        }
        if tool == "claude" {
            candidates.push(home.join(".claude/local/claude"));
        }
        if tool == "cursor-agent" {
            candidates.push(PathBuf::from("cursor-agent"));
            candidates.push(home.join(".local/bin/cursor-agent"));
            let versions = home.join(".local/share/cursor-agent/versions");
            if let Ok(entries) = std::fs::read_dir(versions) {
                let mut paths: Vec<_> = entries
                    .flatten()
                    .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                    .map(|e| e.path())
                    .collect();
                paths.sort();
                paths.reverse();
                candidates.extend(paths.into_iter().map(|p| p.join("cursor-agent")));
            }
        }
        candidates.extend([
            home.join(".local/bin").join(name),
            home.join(".cargo/bin").join(name),
            home.join(".npm-global/bin").join(name),
        ]);
    }
    candidates.extend([
        Path::new("/usr/local/bin").join(name),
        Path::new("/opt/homebrew/bin").join(name),
    ]);
    if tool == "cursor" {
        candidates.push(root.join("providers/cursor").join(if cfg!(windows) {
            "Scripts/cursor-sdk-bridge.exe"
        } else {
            "bin/cursor-sdk-bridge"
        }));
    }
    // Older billing profiles stored executable paths. Adopt those when no shared path exists.
    if let Ok(bytes) = std::fs::read(root.join("agent-profiles.json")) {
        if let Ok(profiles) = serde_json::from_slice::<Vec<serde_json::Value>>(&bytes) {
            for profile in profiles {
                if profile["provider"]
                    == if tool == "cursor-agent" {
                        "cursor"
                    } else {
                        tool
                    }
                {
                    if tool != "cursor" {
                        if let Some(path) = profile["executable"].as_str() {
                            if Path::new(path).is_absolute() {
                                candidates.insert(0, PathBuf::from(path));
                            }
                        }
                    }
                }
            }
        }
    }
    #[cfg(windows)]
    {
        let executables: Vec<_> = candidates
            .iter()
            .filter(|p| p.extension().is_none())
            .map(|p| p.with_extension("exe"))
            .collect();
        candidates.extend(executables);
    }
    if tool == "codex" {
        return Ok(newest_codex(candidates));
    }
    for candidate in candidates {
        if let Some(path) = find(&candidate) {
            return Ok(Some(path));
        }
    }
    Ok(None)
}
pub fn save(root: &Path, tool: &str, path: &Path) -> Result<(), String> {
    let (file, _, _) = specification(tool)?;
    if !path.is_absolute() || !usable(path) {
        return Err("Choose an executable file using its full path".into());
    }
    std::fs::write(root.join(file), path.to_string_lossy().as_bytes()).map_err(|e| e.to_string())
}
#[derive(Serialize)]
pub struct ToolStatus {
    pub tool: String,
    pub path: Option<String>,
    pub error: Option<String>,
}
pub fn status(root: &Path, provider: &str) -> Result<Vec<ToolStatus>, String> {
    let tools = match provider {
        "codex" => vec!["codex"],
        "cursor" => vec!["cursor-agent", "cursor"],
        "copilot" => vec!["copilot"],
        "claude" => vec!["claude"],
        _ => return Err("Unknown provider".into()),
    };
    Ok(tools
        .into_iter()
        .map(|tool| match resolve(root, tool) {
            Ok(path) => ToolStatus {
                tool: tool.into(),
                path: path.map(|p| p.to_string_lossy().into_owned()),
                error: None,
            },
            Err(error) => ToolStatus {
                tool: tool.into(),
                path: None,
                error: Some(error),
            },
        })
        .collect())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn automatic_codex_selection_uses_versions_not_path_or_extension_order() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let make = |name: &str, version: &str| {
            let path = root.path().join(name);
            std::fs::write(&path, format!("#!/bin/sh\necho codex-cli {version}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
            path
        };
        let old = make("path-codex", "0.154.0");
        let preview = make("extension-codex", "0.162.0-alpha.17.2");
        let stable = make("stable-codex", "0.162.0");
        assert_eq!(
            newest_codex(vec![old.clone(), preview.clone()]),
            Some(preview.clone())
        );
        assert_eq!(
            newest_codex(vec![preview, stable.clone(), old.clone()]),
            Some(stable)
        );
        save(root.path(), "codex", &old).unwrap();
        assert_eq!(resolve(root.path(), "codex").unwrap(), Some(old));
    }
    #[cfg(unix)]
    #[test]
    fn codex_extension_discovery_is_platform_scoped() {
        let root = tempfile::tempdir().unwrap();
        let platform = format!(
            "{}-{}",
            if cfg!(target_os = "macos") {
                "macos"
            } else {
                "linux"
            },
            std::env::consts::ARCH
        );
        let binary = root
            .path()
            .join(".vscode/extensions/openai.chatgpt-1/bin")
            .join(platform)
            .join("codex");
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        std::fs::write(&binary, "").unwrap();
        assert!(extension_codex_candidates(root.path()).contains(&binary));
    }
    #[test]
    fn shared_override_is_authoritative_and_cursor_tools_are_separate() {
        let root = tempfile::tempdir().unwrap();
        let exe = std::env::current_exe().unwrap();
        save(root.path(), "codex", &exe).unwrap();
        assert_eq!(resolve(root.path(), "codex").unwrap(), Some(exe.clone()));
        save(root.path(), "cursor-agent", &exe).unwrap();
        assert!(!root.path().join("cursor-executable.txt").exists());
        std::fs::write(
            root.path().join("codex-executable.txt"),
            "/definitely/missing",
        )
        .unwrap();
        assert!(resolve(root.path(), "codex").is_err());
        assert!(resolve(root.path(), "other").is_err());
    }
}
