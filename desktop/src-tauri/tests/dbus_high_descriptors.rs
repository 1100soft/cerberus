//! A private session bus must remain usable beyond select()'s FD_SETSIZE.
#![cfg(target_os = "linux")]
use std::{fs::File, process::Command, time::Duration};

#[test]
fn dbus_works_with_high_numbered_descriptors() {
    if std::env::var_os("CERBERUS_DBUS_DESCRIPTOR_FIXTURE").is_some() {
        // CI shells may start with a low soft limit. Raise only this fixture
        // process's soft limit, never the desktop/session-wide hard limit.
        let mut limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        assert_eq!(
            unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) },
            0
        );
        limit.rlim_cur = limit.rlim_cur.max(4096).min(limit.rlim_max);
        assert!(
            limit.rlim_cur >= 2112,
            "fixture requires a hard descriptor limit of at least 2112"
        );
        assert_eq!(unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &limit) }, 0);
        let _files = (0..2048)
            .map(|_| File::open("/dev/null").unwrap())
            .collect::<Vec<_>>();
        let connection =
            dbus::blocking::Connection::new_session().expect("private fixture session bus");
        let proxy = connection.with_proxy(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            Duration::from_secs(3),
        );
        let (names,): (Vec<String>,) = proxy
            .method_call("org.freedesktop.DBus", "ListNames", ())
            .expect("D-Bus must use poll(), not overflow a select() fd_set");
        assert!(names.iter().any(|name| name == "org.freedesktop.DBus"));
        return;
    }
    let output = Command::new("dbus-run-session")
        .arg("--")
        .arg(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "dbus_works_with_high_numbered_descriptors",
            "--nocapture",
        ])
        .env("CERBERUS_DBUS_DESCRIPTOR_FIXTURE", "1")
        .output()
        .expect("install dbus-run-session to run the private-bus regression");
    assert!(
        output.status.success(),
        "high-descriptor D-Bus child failed: {}\n{}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
}
