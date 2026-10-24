//! Process-scoped Git hooks: no repository configuration or existing hook changes.
use std::{collections::HashMap, fs, path::Path, process::Command};
fn valid(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
}
/// A GUI launched by an agent is a new execution host, not a continuation of
/// that producer. Detach inherited tracking before the app starts any threads.
pub fn detach_inherited_tracking() {
    let Ok(count) = std::env::var("CERBERUS_TRACK_CONFIG_COUNT").and_then(|value| {
        value
            .parse::<usize>()
            .map_err(|_| std::env::VarError::NotPresent)
    }) else {
        return;
    };
    if std::env::var(format!("GIT_CONFIG_KEY_{count}")).as_deref() == Ok("core.hooksPath") {
        std::env::set_var("GIT_CONFIG_COUNT", count.to_string());
        std::env::remove_var(format!("GIT_CONFIG_KEY_{count}"));
        std::env::remove_var(format!("GIT_CONFIG_VALUE_{count}"));
    }
    let paths: Vec<_> = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .filter(|path| {
            !path
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|name| name.to_string_lossy().starts_with("commit-tracking-hooks-"))
        })
        .collect();
    if let Ok(path) = std::env::join_paths(paths) {
        std::env::set_var("PATH", path);
    }
    let keys: Vec<_> = std::env::vars_os()
        .map(|(key, _)| key)
        .filter(|key| key.to_string_lossy().starts_with("CERBERUS_TRACK_"))
        .collect();
    for key in keys {
        std::env::remove_var(key);
    }
}
fn install(directory: &Path, name: &str, content: &str) -> Result<(), String> {
    let path = directory.join(name);
    if path.is_file() {
        return Ok(());
    }
    let mut output = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    use std::io::Write;
    output
        .write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        output
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    match output.persist_noclobber(path) {
        Ok(_) => Ok(()),
        Err(e) if e.error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
fn executable(name: &str) -> Result<std::path::PathBuf, String> {
    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .map(|path| path.join(name))
        .find(|path| path.is_file())
        .ok_or_else(|| format!("{name} not found"))
}
fn global_args(args: &[std::ffi::OsString]) -> (usize, Vec<std::ffi::OsString>) {
    let mut index = 0;
    while index < args.len() {
        let text = args[index].to_string_lossy();
        if matches!(
            text.as_ref(),
            "-C" | "-c" | "--git-dir" | "--work-tree" | "--namespace" | "--config-env"
        ) {
            index += 2;
        } else if text.starts_with('-') {
            index += 1;
        } else {
            break;
        }
    }
    (index, args[..index.min(args.len())].to_vec())
}
fn record_tree(args: &[std::ffi::OsString], sha: &str) -> Result<(), String> {
    if !matches!(sha.len(), 40 | 64) || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Ok(());
    }
    let real = std::env::var_os("CERBERUS_TRACK_GIT").ok_or("Missing Git executable")?;
    let (_, prefix) = global_args(args);
    let output = Command::new(&real)
        .args(&prefix)
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .output()
        .map_err(|e| e.to_string())?;
    let common = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let expected = std::env::var("CERBERUS_TRACK_COMMON").unwrap_or_default();
    let associated = output.status.success() && common == expected;
    let associated = if associated {
        true
    } else {
        let expected = std::env::var("CERBERUS_TRACK_REMOTES").unwrap_or_default();
        let output = Command::new(&real)
            .args(&prefix)
            .args(["config", "--get-regexp", "^remote\\..*\\.url$"])
            .output()
            .map_err(|e| e.to_string())?;
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| line.split_once(' ').map(|(_, url)| url))
            .any(|url| {
                expected
                    .lines()
                    .any(|allowed| !allowed.is_empty() && allowed == url)
            })
    };
    if associated {
        let path =
            std::env::var_os("CERBERUS_TRACK_RECORDS").ok_or("Missing commit record directory")?;
        fs::write(Path::new(&path).join(sha), []).map_err(|e| e.to_string())?;
    }
    Ok(())
}
/// Early executable mode. Preserve Git's stdin/output/status and intercept only
/// the successful stdout SHA of commit-tree (which has no commit hook).
pub fn git_proxy_main() -> Option<i32> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.first().is_none_or(|arg| arg != "--cerberus-track-git") {
        return None;
    }
    let Some(real) = std::env::var_os("CERBERUS_TRACK_GIT") else {
        return Some(1);
    };
    let args = &args[1..];
    let (index, _) = global_args(args);
    let tree = args.get(index).is_some_and(|arg| arg == "commit-tree");
    let mut command = Command::new(real);
    command.args(args);
    if tree {
        let output = command
            .stdin(std::process::Stdio::inherit())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .output();
        return Some(match output {
            Ok(output) => {
                use std::io::Write;
                if output.status.success() {
                    let _ = record_tree(args, String::from_utf8_lossy(&output.stdout).trim());
                }
                let _ = std::io::stdout().write_all(&output.stdout);
                output.status.code().unwrap_or(1)
            }
            Err(_) => 1,
        });
    }
    Some(
        command
            .status()
            .ok()
            .and_then(|status| status.code())
            .unwrap_or(1),
    )
}
pub fn environment(
    root: &Path,
    repo: &Path,
    repository_id: &str,
    run_id: &str,
) -> Result<HashMap<String, String>, String> {
    if !valid(repository_id) || !valid(run_id) {
        return Err("Invalid commit tracking identifier".into());
    }
    let script = include_str!("commit_tracking_hook.sh");
    use std::hash::Hasher;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    hash.write(script.as_bytes());
    let hooks = root.join(format!("commit-tracking-hooks-{:x}", hash.finish()));
    fs::create_dir_all(&hooks).map_err(|e| e.to_string())?;
    // Forward all existing hooks, retaining their arguments, input and exit status.
    for name in [
        "applypatch-msg",
        "pre-applypatch",
        "post-applypatch",
        "pre-commit",
        "pre-merge-commit",
        "prepare-commit-msg",
        "commit-msg",
        "post-commit",
        "pre-rebase",
        "post-checkout",
        "post-merge",
        "pre-push",
        "pre-receive",
        "update",
        "proc-receive",
        "post-receive",
        "post-update",
        "reference-transaction",
        "push-to-checkout",
        "pre-auto-gc",
        "post-rewrite",
        "sendemail-validate",
        "fsmonitor-watchman",
        "p4-changelist",
        "p4-prepare-changelist",
        "p4-post-changelist",
        "p4-pre-submit",
        "post-index-change",
    ] {
        install(&hooks, name, script)?;
    }
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Cannot resolve repository for commit tracking".into());
    }
    let records = root
        .join("automation-commits")
        .join(repository_id)
        .join(run_id);
    fs::create_dir_all(&records).map_err(|e| e.to_string())?;
    let count = std::env::var("GIT_CONFIG_COUNT").unwrap_or_else(|_| "0".into());
    let mut count = count
        .parse::<usize>()
        .map_err(|_| "Invalid inherited Git configuration count")?;
    // An app launched by an already tracked process must not wrap its own proxy.
    if let Ok(previous) = std::env::var("CERBERUS_TRACK_CONFIG_COUNT") {
        if let Ok(previous) = previous.parse::<usize>() {
            if previous < count
                && std::env::var(format!("GIT_CONFIG_KEY_{previous}")).as_deref()
                    == Ok("core.hooksPath")
            {
                count = previous;
            }
        }
    }
    let real = if let Some(path) = std::env::var_os("CERBERUS_TRACK_GIT")
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_file())
    {
        path
    } else {
        executable(if cfg!(windows) { "git.exe" } else { "git" })?
    };
    let shim = hooks.join("bin");
    fs::create_dir_all(&shim).map_err(|e| e.to_string())?;
    install(
        &shim,
        "git",
        "#!/bin/sh\nexec \"$CERBERUS_TRACK_EXECUTABLE\" --cerberus-track-git \"$@\"\n",
    )?;
    #[cfg(windows)]
    install(
        &shim,
        "git.cmd",
        "@\"%CERBERUS_TRACK_EXECUTABLE%\" --cerberus-track-git %*\r\n",
    )?;
    let mut paths = vec![shim];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    let remotes = Command::new(&real)
        .arg("-C")
        .arg(repo)
        .args(["config", "--get-regexp", "^remote\\..*\\.url$"])
        .output()
        .map_err(|e| e.to_string())?;
    let remotes = String::from_utf8_lossy(&remotes.stdout)
        .lines()
        .filter_map(|line| line.split_once(' ').map(|(_, url)| url.to_owned()))
        .collect::<Vec<_>>()
        .join("\n");
    let mut env = HashMap::from([
        ("CERBERUS_TRACK_GIT".into(), real.to_string_lossy().into()),
        (
            "CERBERUS_TRACK_EXECUTABLE".into(),
            std::env::current_exe()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into(),
        ),
        ("CERBERUS_TRACK_REMOTES".into(), remotes),
        (
            "PATH".into(),
            std::env::join_paths(paths)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into(),
        ),
        ("CERBERUS_TRACK_CONFIG_COUNT".into(), count.to_string()),
        (
            "CERBERUS_TRACK_COMMON".into(),
            String::from_utf8_lossy(&output.stdout).trim().into(),
        ),
        (
            "CERBERUS_TRACK_RECORDS".into(),
            records.to_string_lossy().into(),
        ),
        (
            "GIT_CONFIG_COUNT".into(),
            count
                .checked_add(1)
                .ok_or("Too many inherited Git settings")?
                .to_string(),
        ),
        (format!("GIT_CONFIG_KEY_{count}"), "core.hooksPath".into()),
        (
            format!("GIT_CONFIG_VALUE_{count}"),
            hooks.to_string_lossy().into(),
        ),
    ]);
    for index in 0..count {
        for prefix in ["GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"] {
            let key = format!("{prefix}{index}");
            if let Ok(value) = std::env::var(&key) {
                env.insert(key, value);
            }
        }
    }
    Ok(env)
}
pub fn configure(command: &mut Command, env: &HashMap<String, String>, codex: bool) {
    command.envs(env);
    if codex {
        // Explicitly forward these non-secret settings through Codex's shell env filter.
        let mut pairs: Vec<_> = env.iter().collect();
        pairs.sort_by_key(|(key, _)| *key);
        for (key, value) in pairs {
            command.args([
                "-c",
                &format!(
                    "shell_environment_policy.set.{key}={}",
                    serde_json::to_string(value).unwrap()
                ),
            ]);
        }
    }
}
pub fn commits(root: &Path, repository_id: &str, run_id: &str) -> Vec<String> {
    if !valid(repository_id) || !valid(run_id) {
        return vec![];
    }
    let mut values: Vec<_> = fs::read_dir(
        root.join("automation-commits")
            .join(repository_id)
            .join(run_id),
    )
    .into_iter()
    .flatten()
    .filter_map(Result::ok)
    .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
    .filter(|name| matches!(name.len(), 40 | 64) && name.bytes().all(|b| b.is_ascii_hexdigit()))
    .collect();
    values.sort();
    values.dedup();
    values
}
pub fn repository_commits(root: &Path, repository_id: &str) -> HashMap<String, Vec<String>> {
    if !valid(repository_id) {
        return HashMap::new();
    }
    fs::read_dir(root.join("automation-commits").join(repository_id))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let id = entry.file_name().to_str()?.to_owned();
            let values = commits(root, repository_id, &id);
            (!values.is_empty()).then_some((id, values))
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    fn git(repo: &Path, args: &[&str], env: Option<&HashMap<String, String>>) -> String {
        let mut command = Command::new("git");
        command.arg("-C").arg(repo).args(args);
        if let Some(env) = env {
            command.envs(env.iter().filter(|(key, _)| key.as_str() != "PATH"));
        }
        let out = command.output().unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().into()
    }
    #[cfg(unix)]
    #[test]
    fn scripts_track_initial_and_amended_commits_in_linked_worktrees_and_keep_hook_input() {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        fs::create_dir(&repo).unwrap();
        git(&repo, &["init", "-b", "main"], None);
        git(&repo, &["config", "user.name", "Test"], None);
        git(
            &repo,
            &["config", "user.email", "test@example.invalid"],
            None,
        );
        let mut env = environment(root.path(), &repo, "repo", "initial").unwrap();
        env.remove("PATH");
        let mut command = Command::new("sh");
        command
            .args(["-c", "git commit --allow-empty -qm initial"])
            .current_dir(&repo);
        configure(&mut command, &env, false);
        assert!(command.status().unwrap().success());
        assert_eq!(commits(root.path(), "repo", "initial").len(), 1);
        let linked = root.path().join("linked");
        git(
            &repo,
            &["worktree", "add", "-b", "agent", linked.to_str().unwrap()],
            None,
        );
        let original = repo.join(".git/hooks/post-rewrite");
        fs::write(&original, "#!/bin/sh\ncat > rewrite-input\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&original, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let env = environment(root.path(), &linked, "repo", "agent-run").unwrap();
        git(
            &linked,
            &["commit", "--allow-empty", "--no-verify", "-qm", "produced"],
            Some(&env),
        );
        let first = git(&linked, &["rev-parse", "HEAD"], None);
        git(
            &linked,
            &["commit", "--amend", "--allow-empty", "-qm", "amended"],
            Some(&env),
        );
        let amended = git(&linked, &["rev-parse", "HEAD"], None);
        let records = commits(root.path(), "repo", "agent-run");
        assert!(records.contains(&first) && records.contains(&amended));
        assert!(fs::read_to_string(linked.join("rewrite-input"))
            .unwrap()
            .contains(&format!("{first} {amended}")));
        fs::remove_file(linked.join("rewrite-input")).unwrap();
        git(
            &repo,
            &["worktree", "remove", linked.to_str().unwrap()],
            None,
        );
        assert_eq!(
            repository_commits(root.path(), "repo")["agent-run"],
            records
        );
    }
    #[test]
    fn process_scoped_commits_preserve_hooks_and_exclude_other_writers_and_imports() {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo with spaces");
        fs::create_dir(&repo).unwrap();
        git(&repo, &["init", "-b", "main"], None);
        git(&repo, &["config", "user.name", "Test"], None);
        git(
            &repo,
            &["config", "user.email", "test@example.invalid"],
            None,
        );
        git(&repo, &["commit", "--allow-empty", "-qm", "base"], None);
        let original = repo.join(".git/hooks/pre-commit");
        fs::write(&original, "#!/bin/sh\nprintf invoked >> hook-marker\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&original, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let env = environment(root.path(), &repo, "repo", "run").unwrap();
        git(
            &repo,
            &["commit", "--allow-empty", "-qm", "tracked"],
            Some(&env),
        );
        let tracked = git(&repo, &["rev-parse", "HEAD"], None);
        assert_eq!(commits(root.path(), "repo", "run"), vec![tracked.clone()]);
        assert!(repo.join("hook-marker").exists());
        git(
            &repo,
            &["commit", "--allow-empty", "-qm", "other writer"],
            None,
        );
        let other = git(&repo, &["rev-parse", "HEAD"], None);
        assert!(!commits(root.path(), "repo", "run").contains(&other));
        git(&repo, &["branch", "imported"], None);
        git(&repo, &["reset", "--hard", &tracked], Some(&env));
        git(&repo, &["merge", "--ff-only", "imported"], Some(&env));
        assert_eq!(commits(root.path(), "repo", "run"), vec![tracked]);
        git(&repo, &["branch", "pick-before"], None);
        git(
            &repo,
            &["commit", "--allow-empty", "-qm", "importable"],
            None,
        );
        let imported = git(&repo, &["rev-parse", "HEAD"], None);
        git(&repo, &["checkout", "pick-before"], None);
        git(&repo, &["cherry-pick", "--ff", &imported], Some(&env));
        assert!(!commits(root.path(), "repo", "run").contains(&imported));
        git(
            &repo,
            &[
                "-c",
                "core.logAllRefUpdates=false",
                "commit",
                "--allow-empty",
                "-qm",
                "without reflog",
            ],
            Some(&env),
        );
        let no_log = git(&repo, &["rev-parse", "HEAD"], None);
        assert!(commits(root.path(), "repo", "run").contains(&no_log));
        assert!(!fs::read_to_string(repo.join(".git/config"))
            .unwrap()
            .contains("hooksPath"));
    }
}
