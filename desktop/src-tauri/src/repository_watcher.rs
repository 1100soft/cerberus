use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::{collections::{HashMap, HashSet}, path::{Path, PathBuf}, process::Command, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileChange { repository_id: String, occurred_at: u128 }

struct ActiveWatcher { root: PathBuf, _watcher: RecommendedWatcher, _git_watcher: Option<RecommendedWatcher> }

fn emit_change(app:&AppHandle,kind:&str,repository_id:&str){
    let occurred_at=SystemTime::now().duration_since(UNIX_EPOCH).map(|time|time.as_millis()).unwrap_or_default();
    let _=app.emit(kind,FileChange{repository_id:repository_id.to_owned(),occurred_at});
}
fn git_directory(root:&Path)->Option<PathBuf>{
    let output=Command::new("git").arg("-C").arg(root).args(["rev-parse","--absolute-git-dir"]).output().ok()?;
    if !output.status.success(){return None;}
    PathBuf::from(String::from_utf8(output.stdout).ok()?.trim()).canonicalize().ok()
}

#[derive(Default)]
pub struct RepositoryWatchers { active: Mutex<HashMap<String, ActiveWatcher>> }

impl RepositoryWatchers {
    pub fn sync(&self, desired: Vec<(String, PathBuf)>, app: AppHandle) -> Result<Vec<String>, String> {
        let mut active = self.active.lock().map_err(|error| error.to_string())?;
        let ids: HashSet<_> = desired.iter().map(|(id, _)| id.as_str()).collect();
        active.retain(|id, _| ids.contains(id.as_str()));
        let mut errors = Vec::new();
        for (id, path) in desired {
            let root = match path.canonicalize() {
                Ok(root) if root.is_dir() => root,
                Ok(_) => { errors.push(format!("{id}: repository folder is unavailable")); continue; }
                Err(error) => { errors.push(format!("{id}: {error}")); continue; }
            };
            if active.get(&id).is_some_and(|entry| entry.root == root) { continue; }
            active.remove(&id);
            let event_id = id.clone();
            let event_root = root.clone();
            let event_app = app.clone();
            let git_dir=git_directory(&root);
            let root_git_dir=git_dir.as_ref().filter(|path|path.starts_with(&root)).cloned();
            let watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
                if let Ok(event) = event {
                    if relevant(&event, &event_root) {
                        emit_change(&event_app,"automation-file-change",&event_id);
                    }
                    if root_git_dir.as_ref().is_some_and(|git_dir|git_relevant(&event,git_dir)){emit_change(&event_app,"automation-git-change",&event_id);}
                }
            });
            let mut watcher=match watcher { Ok(watcher)=>watcher, Err(error)=>{errors.push(format!("{id}: {error}"));continue;} };
            if let Err(error) = watcher.watch(&root, RecursiveMode::Recursive) {
                errors.push(format!("{id}: {error}"));
                continue;
            }
            let mut git_watcher=None;
            if let Some(git_dir)=git_dir.filter(|path|!path.starts_with(&root)){
                let git_id=id.clone();let git_app=app.clone();let git_root=git_dir.clone();
                match notify::recommended_watcher(move |event:notify::Result<Event>|{
                    if let Ok(event)=event {if git_relevant(&event,&git_root){emit_change(&git_app,"automation-git-change",&git_id);}}
                }){
                    Ok(mut watcher)=>match watcher.watch(&git_dir,RecursiveMode::Recursive){Ok(())=>git_watcher=Some(watcher),Err(error)=>errors.push(format!("{id}: commit watcher: {error}"))},
                    Err(error)=>errors.push(format!("{id}: commit watcher: {error}")),
                }
            }
            active.insert(id, ActiveWatcher { root, _watcher: watcher, _git_watcher: git_watcher });
        }
        Ok(errors)
    }
}

fn git_relevant(event:&Event,git_dir:&Path)->bool{
    if !matches!(event.kind,EventKind::Create(_)|EventKind::Modify(_)|EventKind::Remove(_)){return false;}
    event.paths.iter().any(|path|path.strip_prefix(git_dir).ok().is_some_and(|relative|{
        let name=relative.to_string_lossy().replace('\\',"/");
        name=="HEAD"||name=="packed-refs"||name=="logs/HEAD"||name.starts_with("refs/heads/")||name.starts_with("logs/refs/heads/")
    }))
}

fn relevant(event: &Event, root: &Path) -> bool {
    if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) { return false; }
    event.paths.iter().any(|path| {
        path.strip_prefix(root).ok().is_some_and(|relative| {
            !relative.as_os_str().is_empty() && !relative.components().any(|part| part.as_os_str() == ".git")
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind};
    #[test]
    fn filters_git_and_access_events() {
        let root = Path::new("/repo");
        let file = Event::new(EventKind::Create(CreateKind::File)).add_path(root.join("source.rs"));
        assert!(relevant(&file, root));
        let git = Event::new(EventKind::Modify(ModifyKind::Any)).add_path(root.join(".git/index"));
        assert!(!relevant(&git, root));
        let access = Event::new(EventKind::Access(notify::event::AccessKind::Any)).add_path(root.join("source.rs"));
        assert!(!relevant(&access, root));
        let commit=Event::new(EventKind::Modify(ModifyKind::Any)).add_path(root.join(".git/refs/heads/main"));
        assert!(git_relevant(&commit,&root.join(".git")));
        assert!(!git_relevant(&git,&root.join(".git")));
    }
    #[test]
    fn receives_a_file_change_without_polling() {
        use std::sync::mpsc;
        use std::time::Duration;
        let directory=tempfile::tempdir().unwrap();
        let root=directory.path().canonicalize().unwrap();
        let (tx,rx)=mpsc::channel();
        let mut watcher=notify::recommended_watcher(move |event:notify::Result<Event>| {
            if let Ok(event)=event { if relevant(&event,&root) { let _=tx.send(()); } }
        }).unwrap();
        watcher.watch(directory.path(),RecursiveMode::Recursive).unwrap();
        std::fs::write(directory.path().join("changed.txt"),"change").unwrap();
        rx.recv_timeout(Duration::from_secs(3)).expect("filesystem watcher did not report a new file");
    }
}
