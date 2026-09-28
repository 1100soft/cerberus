//! How the Cursor shortcut opens the Agents window.
//!
//! `cursor://anysphere.cursor-deeplink/glass` focuses that window.
//! A single directory argument is what Cursor uses to select a repository there,
//! as long as `--classic`, `--new-window`, and `--reuse-window` are absent.
//! A selected conversation uses the Agents window's agent id (`editor:` composer
//! ids are stored with that prefix in this app).

const GLASS: &str = "cursor://anysphere.cursor-deeplink/glass";

pub fn plan(repository: &std::path::Path, conversation_id: Option<&str>) -> Vec<Vec<String>> {
    let mut steps = vec![vec![GLASS.to_string()]];
    if let Some(id) = agent_id(conversation_id) {
        let id = url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>();
        steps.push(vec![format!("cursor://anysphere.cursor-deeplink/background-agent?bcId={id}")]);
    } else {
        steps.push(vec![repository.to_string_lossy().into_owned()]);
    }
    steps
}

fn agent_id(conversation_id: Option<&str>) -> Option<&str> {
    let id = conversation_id?.trim();
    let id = id.strip_prefix("editor:").unwrap_or(id);
    if id.is_empty() || id.len() > 200 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return None;
    }
    Some(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repository_open_focuses_agents_then_selects_the_folder() {
        let steps = plan(std::path::Path::new("/work/repo"), None);
        assert_eq!(steps, vec![
            vec![GLASS.to_string()],
            vec!["/work/repo".to_string()],
        ]);
        assert!(steps.iter().flatten().all(|arg| !arg.starts_with("--classic") && arg != "--new-window" && arg != "--reuse-window"));
    }
    #[test]
    fn selected_cursor_conversation_opens_that_agent() {
        let editor = plan(std::path::Path::new("/work/repo"), Some("editor:abc-123"));
        assert_eq!(editor[1][0], "cursor://anysphere.cursor-deeplink/background-agent?bcId=abc-123");
        let cloud = plan(std::path::Path::new("/work/repo"), Some("bc-123"));
        assert!(cloud[1][0].ends_with("bcId=bc-123"));
        assert_eq!(plan(std::path::Path::new("/work/repo"), Some("../etc")).len(), 2);
        assert!(plan(std::path::Path::new("/work/repo"), Some("../etc"))[1][0].ends_with("/work/repo"));
    }
}
