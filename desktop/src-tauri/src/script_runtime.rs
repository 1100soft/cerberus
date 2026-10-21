//! Direct script interpreter selection; arguments never pass through a shell.
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    #[serde(default = "default_preset")]
    pub preset: String,
    #[serde(default)]
    pub executable: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub extension: String,
}
impl Default for Runtime {
    fn default() -> Self {
        Self {
            preset: "default".into(),
            executable: String::new(),
            args: Vec::new(),
            extension: String::new(),
        }
    }
}
fn default_preset() -> String {
    "default".into()
}
pub fn platform() -> Runtime {
    Runtime {
        preset: if cfg!(windows) { "powershell" } else { "bash" }.into(),
        ..Default::default()
    }
}
pub fn settings(root: &Path) -> Result<Runtime, String> {
    let path = root.join("script-runtime.json");
    if !path.exists() {
        return Ok(platform());
    }
    let config: Runtime = serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    validate(&config)?;
    if config.preset == "default" {
        return Err("The app default must name an explicit runtime.".into());
    }
    Ok(config)
}
pub fn save(root: &Path, config: &Runtime) -> Result<(), String> {
    validate(config)?;
    if config.preset == "default" {
        return Err("Choose an explicit default runtime.".into());
    }
    let file = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
    serde_json::to_writer(file.as_file(), config).map_err(|e| e.to_string())?;
    file.persist(root.join("script-runtime.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn validate(config: &Runtime) -> Result<(), String> {
    if ![
        "default",
        "bash",
        "powershell",
        "python",
        "node",
        "ruby",
        "custom",
    ]
    .contains(&config.preset.as_str())
    {
        return Err("Unknown script runtime.".into());
    }
    if config.preset == "custom" && config.executable.trim().is_empty() {
        return Err("Choose a custom interpreter executable.".into());
    }
    if config.extension.len() > 16
        || !config
            .extension
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric())
    {
        return Err("Script extension must contain only letters and digits (no dot).".into());
    }
    if config.args.len() > 100 || config.args.iter().any(|arg| arg.contains('\0')) {
        return Err("Invalid interpreter arguments.".into());
    }
    Ok(())
}
fn find(repo: &Path, name: &str) -> Option<PathBuf> {
    let candidate = Path::new(name);
    if candidate.is_absolute() || candidate.components().count() > 1 {
        return Some(if candidate.is_absolute() {
            candidate.into()
        } else {
            repo.join(candidate)
        })
        .filter(|p| p.is_file());
    }
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        let path = dir.join(name);
        if path.is_file() {
            return Some(path);
        }
        #[cfg(windows)]
        for suffix in ["exe", "com"] {
            let path = dir.join(format!("{name}.{suffix}"));
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}
pub fn resolve(repo: &Path, config: &Runtime) -> Result<(PathBuf, Vec<String>, String), String> {
    validate(config)?;
    let config = if config.preset == "default" {
        platform()
    } else {
        config.clone()
    };
    let candidates: Vec<String> = if !config.executable.trim().is_empty() {
        vec![config.executable.clone()]
    } else {
        match config.preset.as_str() {
            "python" => vec![
                if cfg!(windows) {
                    ".venv/Scripts/python.exe"
                } else {
                    ".venv/bin/python"
                }
                .into(),
                if cfg!(windows) {
                    "venv/Scripts/python.exe"
                } else {
                    "venv/bin/python"
                }
                .into(),
                "python3".into(),
                "python".into(),
            ],
            "powershell" => vec!["pwsh".into(), "powershell".into()],
            "node" => vec!["node".into()],
            "ruby" => vec!["ruby".into()],
            _ => vec!["bash".into()],
        }
    };
    let executable=candidates.iter().find_map(|name|find(repo,name)).ok_or_else(||format!("{} interpreter unavailable. Install it, add it to PATH, or select its executable in the automation runtime settings.",config.preset))?;
    let mut args: Vec<String> = match config.preset.as_str() {
        "powershell" => vec!["-NoLogo", "-NoProfile", "-NonInteractive", "-File"],
        "python" => vec!["-u"],
        _ => vec![],
    }
    .into_iter()
    .map(str::to_string)
    .collect();
    #[cfg(windows)]
    if config.preset == "powershell" {
        args.pop();
        args.extend(["-ExecutionPolicy".into(), "Bypass".into(), "-File".into()]);
    }
    // PowerShell flags must precede -File; custom arguments are interpreter flags.
    if config.preset == "powershell" {
        args.pop();
        args.extend(config.args);
        args.push("-File".into());
    } else {
        args.extend(config.args);
    }
    let extension = match config.preset.as_str() {
        "bash" => "sh",
        "powershell" => "ps1",
        "python" => "py",
        "node" => "mjs",
        "ruby" => "rb",
        _ => "txt",
    };
    Ok((
        executable,
        args,
        if config.extension.is_empty() {
            extension.into()
        } else {
            config.extension
        },
    ))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub preset: String,
    pub executable: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}
pub fn check(repo: &Path, config: &Runtime) -> Status {
    let mut status = Status {
        preset: config.preset.clone(),
        executable: None,
        version: None,
        error: None,
    };
    let (path, _, _) = match resolve(repo, config) {
        Ok(value) => value,
        Err(error) => {
            status.error = Some(error);
            return status;
        }
    };
    status.executable = Some(path.to_string_lossy().into());
    let result = (|| -> Result<String, String> {
        let output = tempfile::tempfile().map_err(|e| e.to_string())?;
        let mut command = Command::new(path);
        command.current_dir(repo);
        if config.preset == "powershell" {
            command.args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$PSVersionTable.PSVersion.ToString()",
            ]);
        } else {
            command.arg("--version");
        }
        command
            .stdin(Stdio::null())
            .stdout(output.try_clone().map_err(|e| e.to_string())?)
            .stderr(output.try_clone().map_err(|e| e.to_string())?);
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            if let Some(code) = child.try_wait().map_err(|e| e.to_string())? {
                if !code.success() {
                    return Err("Interpreter --version failed. Check its executable; script arguments are not used for this probe.".into());
                }
                break;
            }
            if std::time::Instant::now() >= deadline {
                crate::setup_terminal::stop_process_tree(&mut child);
                let _ = child.wait();
                return Err("Interpreter version check timed out.".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        use std::io::{Seek, SeekFrom};
        let mut output = output;
        output.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let mut text = String::new();
        output
            .take(16384)
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        Ok(text
            .lines()
            .next()
            .unwrap_or("Version not reported")
            .to_string())
    })();
    match result {
        Ok(version) => status.version = Some(version),
        Err(error) => status.error = Some(error),
    };
    status
}
pub fn candidates(repo: &Path) -> Vec<Status> {
    let mut values = Vec::new();
    for (preset, names) in [
        ("bash", vec!["bash"]),
        ("powershell", vec!["pwsh", "powershell"]),
        (
            "python",
            vec![
                ".venv/bin/python",
                ".venv/Scripts/python.exe",
                "venv/bin/python",
                "venv/Scripts/python.exe",
                "python3",
                "python",
            ],
        ),
        ("node", vec!["node"]),
        ("ruby", vec!["ruby"]),
    ] {
        for name in names {
            if let Some(path) = find(repo, name) {
                let executable = path.to_string_lossy().to_string();
                if !values.iter().any(|item: &Status| {
                    item.preset == preset && item.executable.as_ref() == Some(&executable)
                }) {
                    values.push(Status {
                        preset: preset.into(),
                        executable: Some(executable),
                        version: None,
                        error: None,
                    });
                }
            }
        }
    }
    values
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_python_environment_and_custom_literal_arguments() {
        let repo = tempfile::tempdir().unwrap();
        let binary = repo.path().join(if cfg!(windows) {
            ".venv/Scripts/python.exe"
        } else {
            ".venv/bin/python"
        });
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        std::fs::write(&binary, "").unwrap();
        let (path, args, extension) = resolve(
            repo.path(),
            &Runtime {
                preset: "python".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(path, binary);
        assert_eq!(args, vec!["-u"]);
        assert_eq!(extension, "py");
        let config = Runtime {
            preset: "custom".into(),
            executable: binary.to_string_lossy().into(),
            args: vec!["--literal argument with spaces".into()],
            extension: "ts".into(),
        };
        let (_, args, extension) = resolve(repo.path(), &config).unwrap();
        assert_eq!(args, config.args);
        assert_eq!(extension, "ts");
        assert!(resolve(
            repo.path(),
            &Runtime {
                preset: "custom".into(),
                ..Default::default()
            }
        )
        .is_err());
        assert!(resolve(
            repo.path(),
            &Runtime {
                preset: "python".into(),
                executable: "missing-runtime-cerberus-fixture".into(),
                ..Default::default()
            }
        )
        .unwrap_err()
        .contains("unavailable"));
    }
    #[test]
    fn defaults_persist_and_platform_is_explicit() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            settings(dir.path()).unwrap().preset,
            if cfg!(windows) { "powershell" } else { "bash" }
        );
        let config = Runtime {
            preset: "python".into(),
            args: vec!["-I".into()],
            ..Default::default()
        };
        save(dir.path(), &config).unwrap();
        assert_eq!(settings(dir.path()).unwrap().args, config.args);
    }
}
