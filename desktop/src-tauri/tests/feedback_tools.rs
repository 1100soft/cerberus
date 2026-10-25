//! Exercise the real headless mail-tool entry point without credentials or a mailbox.
use std::{
    io::Write,
    process::{Command, Stdio},
};
fn request(read_only: bool, action: &str) -> std::process::Output {
    let root = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_gitcerberus"))
        .arg("--cerberus-feedback")
        .env("CERBERUS_FEEDBACK_ROOT", root.path())
        .env("CERBERUS_FEEDBACK_REPOSITORY", "fixture-repository")
        .env("CERBERUS_FEEDBACK_READ_ONLY", read_only.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(
            serde_json::json!({"action":action,"text":"private customer content"})
                .to_string()
                .as_bytes(),
        )
        .unwrap();
    child.wait_with_output().unwrap()
}
#[test]
fn analyze_tools_refuse_writes_before_any_mailbox_or_keyring_access() {
    let output = request(true, "draft");
    assert!(!output.status.success());
    let error = String::from_utf8_lossy(&output.stderr);
    assert!(error.contains("Analyze mode permits only reading feedback"));
    assert!(!error.contains("private customer content"));
    assert!(output.stdout.is_empty());
}
#[test]
fn unconfigured_mailbox_fails_headlessly_without_echoing_input() {
    let output = request(false, "read");
    assert!(!output.status.success());
    let error = String::from_utf8_lossy(&output.stderr);
    assert!(error.contains("No enabled feedback mailbox"));
    assert!(!error.contains("private customer content"));
    assert!(output.stdout.is_empty());
}
