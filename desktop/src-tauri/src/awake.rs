//! Sleep inhibition held only while app jobs or detected local agents are active.
use std::sync::{
    mpsc::{self, Sender},
    OnceLock,
};
use std::time::{Duration, Instant};
enum Event {
    Job(bool),
    Presence(bool),
}
fn sender() -> &'static Sender<Event> {
    static SENDER: OnceLock<Sender<Event>> = OnceLock::new();
    SENDER.get_or_init(|| {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut jobs = 0usize;
            let mut presence = None;
            let mut held = None;
            let mut last_attempt = None;
            loop {
                match rx.recv_timeout(Duration::from_secs(2)) {
                    Ok(Event::Job(true)) => jobs += 1,
                    Ok(Event::Job(false)) => jobs = jobs.saturating_sub(1),
                    Ok(Event::Presence(active)) => presence = active.then(Instant::now),
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    _ => {}
                }
                let wanted =
                    jobs > 0 || presence.is_some_and(|at| at.elapsed() < Duration::from_secs(90));
                if !wanted {
                    held = None;
                    last_attempt = None;
                } else if held.is_none()
                    && last_attempt.is_none_or(|at: Instant| at.elapsed() > Duration::from_secs(30))
                {
                    last_attempt = Some(Instant::now());
                    match platform::Inhibitor::new() {
                        Ok(lock) => held = Some(lock),
                        Err(error) => {
                            eprintln!("Could not prevent idle sleep during agent work: {error}")
                        }
                    }
                }
            }
        });
        tx
    })
}
pub struct Guard;
pub fn acquire() -> Guard {
    let _ = sender().send(Event::Job(true));
    Guard
}
impl Drop for Guard {
    fn drop(&mut self) {
        let _ = sender().send(Event::Job(false));
    }
}
pub fn presence(active: bool) {
    let _ = sender().send(Event::Presence(active));
}
#[cfg(target_os = "linux")]
mod platform {
    pub struct Inhibitor {
        _fd: dbus::arg::OwnedFd,
    }
    impl Inhibitor {
        pub fn new() -> Result<Self, String> {
            let bus = dbus::blocking::Connection::new_system().map_err(|e| e.to_string())?;
            let proxy = bus.with_proxy(
                "org.freedesktop.login1",
                "/org/freedesktop/login1",
                std::time::Duration::from_secs(3),
            );
            let (fd,): (dbus::arg::OwnedFd,) = proxy
                .method_call(
                    "org.freedesktop.login1.Manager",
                    "Inhibit",
                    (
                        "idle:sleep",
                        "Cerberus",
                        "Automations or local agents are active",
                        "block",
                    ),
                )
                .map_err(|e| e.to_string())?;
            Ok(Self { _fd: fd })
        }
    }
}
#[cfg(target_os = "macos")]
mod platform {
    pub struct Inhibitor(std::process::Child);
    impl Inhibitor {
        pub fn new() -> Result<Self, String> {
            std::process::Command::new("/usr/bin/caffeinate")
                .args(["-i", "-w", &std::process::id().to_string()])
                .stdin(std::process::Stdio::null())
                .spawn()
                .map(Self)
                .map_err(|e| e.to_string())
        }
    }
    impl Drop for Inhibitor {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}
#[cfg(target_os = "windows")]
mod platform {
    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }
    pub struct Inhibitor;
    impl Inhibitor {
        pub fn new() -> Result<Self, String> {
            if unsafe { SetThreadExecutionState(0x80000001) } == 0 {
                Err(std::io::Error::last_os_error().to_string())
            } else {
                Ok(Self)
            }
        }
    }
    impl Drop for Inhibitor {
        fn drop(&mut self) {
            unsafe {
                SetThreadExecutionState(0x80000000);
            }
        }
    }
}
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
mod platform {
    pub struct Inhibitor;
    impl Inhibitor {
        pub fn new() -> Result<Self, String> {
            Err("Sleep inhibition is not supported on this platform".into())
        }
    }
}

/// Count elapsed active time, excluding long gaps caused by system suspend.
pub struct ActiveDeadline {
    remaining: Duration,
    last: Instant,
}
impl ActiveDeadline {
    pub fn new(duration: Duration) -> Self {
        Self {
            remaining: duration,
            last: Instant::now(),
        }
    }
    pub fn expired(&mut self) -> bool {
        let now = Instant::now();
        self.advance(now.duration_since(self.last));
        self.last = now;
        self.remaining.is_zero()
    }
    fn advance(&mut self, gap: Duration) {
        if gap < Duration::from_secs(5) {
            self.remaining = self.remaining.saturating_sub(gap);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn suspend_does_not_spend_execution_budget() {
        let mut deadline = ActiveDeadline::new(Duration::from_secs(10));
        deadline.advance(Duration::from_secs(3600));
        assert_eq!(deadline.remaining, Duration::from_secs(10));
        deadline.advance(Duration::from_secs(3));
        assert_eq!(deadline.remaining, Duration::from_secs(7));
        deadline.advance(Duration::from_secs(4));
        deadline.advance(Duration::from_secs(3));
        assert!(deadline.expired());
    }
}

#[cfg(all(test, target_os = "linux"))]
mod integration_tests {
    #[test]
    #[ignore = "Requires a real logind system bus"]
    fn logind_lock_is_registered_and_released() {
        let bus = dbus::blocking::Connection::new_system().unwrap();
        let proxy = bus.with_proxy(
            "org.freedesktop.login1",
            "/org/freedesktop/login1",
            std::time::Duration::from_secs(3),
        );
        let count = || {
            type InhibitorRow = (String, String, String, String, u32, u32);
            let (locks,): (Vec<InhibitorRow>,) = proxy
                .method_call("org.freedesktop.login1.Manager", "ListInhibitors", ())
                .unwrap();
            locks
                .iter()
                .filter(|row| row.1 == "Cerberus" && row.5 == std::process::id())
                .count()
        };
        let before = count();
        let lock = super::platform::Inhibitor::new().unwrap();
        assert_eq!(count(), before + 1);
        drop(lock);
        for _ in 0..50 {
            if count() == before {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert_eq!(count(), before);
    }
}
