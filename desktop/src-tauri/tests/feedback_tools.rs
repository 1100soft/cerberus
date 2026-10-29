//! Exercise both public and legacy headless email entry points without credentials.
use std::{
    io::Write,
    process::{Command, Stdio},
};
fn request(modern: bool, read_only: bool, action: &str) -> std::process::Output {
    let root = tempfile::tempdir().unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_gitcerberus"));
    for key in [
        "CERBERUS_EMAIL_DATA_DIR",
        "CERBERUS_EMAIL_PROJECT",
        "CERBERUS_EMAIL_READ_ONLY",
        "CERBERUS_FEEDBACK_ROOT",
        "CERBERUS_FEEDBACK_REPOSITORY",
        "CERBERUS_FEEDBACK_READ_ONLY",
    ] {
        command.env_remove(key);
    }
    command.arg(if modern {
        "--cerberus-email"
    } else {
        "--cerberus-feedback"
    });
    command.env(
        if modern {
            "CERBERUS_EMAIL_DATA_DIR"
        } else {
            "CERBERUS_FEEDBACK_ROOT"
        },
        root.path(),
    );
    command.env(
        if modern {
            "CERBERUS_EMAIL_PROJECT"
        } else {
            "CERBERUS_FEEDBACK_REPOSITORY"
        },
        "fixture-project",
    );
    command.env(
        if modern {
            "CERBERUS_EMAIL_READ_ONLY"
        } else {
            "CERBERUS_FEEDBACK_READ_ONLY"
        },
        read_only.to_string(),
    );
    // A false alias must never override a true read-only restriction.
    command.env(
        if modern {
            "CERBERUS_FEEDBACK_READ_ONLY"
        } else {
            "CERBERUS_EMAIL_READ_ONLY"
        },
        "false",
    );
    let mut child = command
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
fn analyze_tools_refuse_writes_for_public_and_legacy_names() {
    for action in ["draft", "flag", "moveAll"] {
        for modern in [true, false] {
            let output = request(modern, true, action);
            assert!(!output.status.success());
            let error = String::from_utf8_lossy(&output.stderr);
            assert!(error.contains("Analyze mode permits only reading email"));
            assert!(!error.contains("private customer content"));
            assert!(output.stdout.is_empty());
        }
    }
}
#[test]
fn unconfigured_mailbox_fails_headlessly_for_public_and_legacy_names() {
    for modern in [true, false] {
        let output = request(modern, false, "read");
        assert!(!output.status.success());
        let error = String::from_utf8_lossy(&output.stderr);
        assert!(error.contains("No configured email mailbox"));
        assert!(!error.contains("private customer content"));
        assert!(output.stdout.is_empty());
    }
}
