//! Explicit checkout changes conflict only with app work in the same project.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
#[derive(Default)]
struct Activity {
    jobs: usize,
    changing: bool,
}
fn state() -> &'static Mutex<HashMap<String, Activity>> {
    static STATE: OnceLock<Mutex<HashMap<String, Activity>>> = OnceLock::new();
    STATE.get_or_init(Default::default)
}
pub struct Guard {
    project: String,
    changing: bool,
}
fn enter(project: &str, changing: bool) -> Result<Guard, String> {
    let mut all = state().lock().map_err(|e| e.to_string())?;
    let current = all.entry(project.into()).or_default();
    if current.changing || changing && current.jobs > 0 {
        return Err(
            "This project has an active agent, script, or branch change. Wait for it to finish."
                .into(),
        );
    }
    if changing {
        current.changing = true;
    } else {
        current.jobs += 1;
    }
    Ok(Guard {
        project: project.into(),
        changing,
    })
}
pub fn job(project: &str) -> Result<Guard, String> {
    enter(project, false)
}
pub fn change(project: &str) -> Result<Guard, String> {
    enter(project, true)
}
impl Drop for Guard {
    fn drop(&mut self) {
        if let Ok(mut all) = state().lock() {
            if let Some(current) = all.get_mut(&self.project) {
                if self.changing {
                    current.changing = false;
                } else {
                    current.jobs = current.jobs.saturating_sub(1);
                }
                if !current.changing && current.jobs == 0 {
                    all.remove(&self.project);
                }
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checkout_gate_is_project_scoped_and_releases_on_drop() {
        let _elsewhere = job("elsewhere").unwrap();
        let active = job("target").unwrap();
        assert!(change("target").is_err());
        drop(active);
        let checkout = change("target").unwrap();
        assert!(job("target").is_err());
        assert!(change("target").is_err());
        drop(checkout);
        assert!(job("target").is_ok());
    }
}
