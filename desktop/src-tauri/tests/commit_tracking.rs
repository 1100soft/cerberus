//! Real executable regression: Git subprocesses must never initialize the GUI.
#[cfg(unix)]
#[test]
fn script_process_tracks_commit_tree_in_related_clones_and_preserves_git_io() {
    use gitcerberus_lib::commit_provenance::{commits, environment};
    use std::{fs, io::Write, path::Path, process::Command};
    fn git(repo: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().into()
    }
    let root = tempfile::tempdir().unwrap();
    let repo = root.path().join("source repo");
    fs::create_dir(&repo).unwrap();
    git(&repo, &["init", "-b", "main"]);
    git(&repo, &["config", "user.name", "Test"]);
    git(&repo, &["config", "user.email", "test@example.invalid"]);
    git(&repo, &["commit", "--allow-empty", "-qm", "base"]);
    let bare = root.path().join("remote.git");
    git(
        root.path(),
        &[
            "clone",
            "--bare",
            repo.to_str().unwrap(),
            bare.to_str().unwrap(),
        ],
    );
    git(&repo, &["remote", "add", "origin", bare.to_str().unwrap()]);
    let mut env = environment(root.path(), &repo, "repo", "run").unwrap();
    env.insert(
        "CERBERUS_TRACK_EXECUTABLE".into(),
        env!("CARGO_BIN_EXE_gitcerberus").into(),
    );
    let mut command = Command::new("sh");
    command.current_dir(&repo).envs(&env).args([
        "-c",
        "printf 'low-level release\n' | git commit-tree \"$(git write-tree)\" -p HEAD",
    ]);
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let sha = String::from_utf8(output.stdout).unwrap().trim().to_string();
    assert_eq!(
        git(&repo, &["show", "-s", "--format=%s", &sha]),
        "low-level release"
    );
    assert!(commits(root.path(), "repo", "run").contains(&sha));
    let clone = root.path().join("temporary clone");
    git(
        root.path(),
        &["clone", bare.to_str().unwrap(), clone.to_str().unwrap()],
    );
    git(&clone, &["config", "user.name", "Test"]);
    git(&clone, &["config", "user.email", "test@example.invalid"]);
    let status = Command::new("sh")
        .envs(&env)
        .current_dir(&clone)
        .args(["-c", "git commit --allow-empty -qm cloned-normal"])
        .status()
        .unwrap();
    assert!(status.success());
    let ordinary = git(&clone, &["rev-parse", "HEAD"]);
    assert!(commits(root.path(), "repo", "run").contains(&ordinary));
    let tree = git(&clone, &["rev-parse", "HEAD^{tree}"]);
    let mut child = Command::new(env!("CARGO_BIN_EXE_gitcerberus"))
        .arg("--cerberus-track-git")
        .args([
            "-C",
            clone.to_str().unwrap(),
            "commit-tree",
            &tree,
            "-p",
            "HEAD",
        ])
        .envs(&env)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"clone release\n")
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    let cloned_sha = String::from_utf8(output.stdout).unwrap().trim().to_string();
    assert!(commits(root.path(), "repo", "run").contains(&cloned_sha));
    let other = root.path().join("unrelated");
    fs::create_dir(&other).unwrap();
    git(&other, &["init"]);
    git(&other, &["config", "user.name", "Test"]);
    git(&other, &["config", "user.email", "test@example.invalid"]);
    git(&other, &["commit", "--allow-empty", "-qm", "other"]);
    let output = Command::new("sh")
        .current_dir(&other)
        .envs(&env)
        .args([
            "-c",
            "printf 'unrelated\n' | git commit-tree \"$(git write-tree)\"",
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    let other_sha = String::from_utf8(output.stdout).unwrap().trim().to_string();
    assert!(!commits(root.path(), "repo", "run").contains(&other_sha));
    let failed = Command::new(env!("CARGO_BIN_EXE_gitcerberus"))
        .arg("--cerberus-track-git")
        .args(["commit-tree", "invalid-tree"])
        .current_dir(&repo)
        .envs(&env)
        .output()
        .unwrap();
    assert!(!failed.status.success());
    assert!(String::from_utf8_lossy(&failed.stderr).contains("invalid-tree"));
}
