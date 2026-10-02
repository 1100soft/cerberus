//! Hear the same desktop notification Cursor raises when an agent finishes.
//! The composer database can keep an unfinished checkpoint for minutes after that.

pub fn cursor_agent_completed(app_name: &str, summary: &str, body: &str) -> bool {
    let summary = summary.trim();
    let done = summary == "Agent complete"
        || summary == "Cloud agent complete"
        || summary.starts_with("Done •")
        || summary.starts_with("Done ·");
    if !done {
        return false;
    }
    let from_cursor = app_name.eq_ignore_ascii_case("cursor");
    let known_body = body.contains("Open Cursor to view the agent");
    from_cursor || known_body
}

#[cfg(target_os = "linux")]
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        if let Err(error) = watch(app) {
            eprintln!("Cursor completion notifications are unavailable: {error}");
        }
    });
}

#[cfg(not(target_os = "linux"))]
pub fn start(_app: tauri::AppHandle) {}

#[cfg(target_os = "linux")]
fn watch(app: tauri::AppHandle) -> Result<(), String> {
    use dbus::blocking::Connection;
    use dbus::channel::MatchingReceiver;
    use dbus::message::MatchRule;
    use std::time::Duration;
    let conn = Connection::new_session().map_err(|e| e.to_string())?;
    let rule = MatchRule::new_method_call()
        .with_interface("org.freedesktop.Notifications")
        .with_member("Notify")
        .with_eavesdrop()
        .static_clone();
    let watched = app.clone();
    conn.start_receive(rule.clone(), Box::new(move |msg, _| {
        let mut args = msg.iter_init();
        let app_name = args.read::<String>().unwrap_or_default();
        let _: u32 = args.read().unwrap_or(0);
        let _: String = args.read().unwrap_or_default();
        let summary = args.read::<String>().unwrap_or_default();
        let body = args.read::<String>().unwrap_or_default();
        if cursor_agent_completed(&app_name, &summary, &body) {
            use tauri::Emitter;
            let _ = watched.emit("cursor-agent-settled", ());
        }
        true
    }));
    let bus = conn.with_proxy("org.freedesktop.DBus", "/org/freedesktop/DBus", Duration::from_secs(2));
    let rules = vec![rule.match_str()];
    if bus.method_call::<(), (Vec<String>, u32), _, _>("org.freedesktop.DBus.Monitoring", "BecomeMonitor", (rules, 0u32)).is_err() {
        conn.add_match_no_cb(&rule.match_str()).map_err(|e| e.to_string())?;
    }
    loop {
        conn.process(Duration::from_secs(60)).map_err(|e| e.to_string())?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recognizes_cursor_completion_notifications() {
        assert!(cursor_agent_completed("Cursor", "Done • Review", "Open Cursor to view the agent's output."));
        assert!(cursor_agent_completed("Cursor", "Agent complete", "Open Cursor to view the agent's output."));
        assert!(cursor_agent_completed("", "Cloud agent complete", "Open Cursor to view the agent output."));
        assert!(!cursor_agent_completed("Cursor", "Needs attention", "Approve a command"));
        assert!(!cursor_agent_completed("Firefox", "Done • Download", "File saved"));
    }
}
