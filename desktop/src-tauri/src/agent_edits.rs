//! Compare working-tree fingerprints, without changing the index or storing file contents.
use std::{collections::{BTreeMap, BTreeSet}, hash::Hasher, io::Read, path::Path};
use crate::codex::FileEdit;
pub type Snapshot = BTreeMap<String, u64>;
pub fn snapshot(path: &Path) -> Result<Snapshot, String> {
    let output = std::process::Command::new("git").current_dir(path).args(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err("Could not list workspace files".into()); }
    let paths = output.stdout.split(|byte| *byte == 0).filter(|path| !path.is_empty()).map(|path| String::from_utf8_lossy(path).into_owned()).collect::<BTreeSet<_>>();
    let mut snapshot = BTreeMap::new();
    for relative in paths {
        let file = path.join(&relative);
        let metadata = match std::fs::symlink_metadata(&file) { Ok(m) => m, Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue, Err(e) => return Err(e.to_string()) };
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        if metadata.file_type().is_symlink() {
            hash.write(std::fs::read_link(&file).map_err(|e| e.to_string())?.as_os_str().as_encoded_bytes());
        } else if metadata.is_file() {
            let mut input = std::fs::File::open(&file).map_err(|e| e.to_string())?;
            let mut buffer = [0u8; 65536];
            loop { let count = input.read(&mut buffer).map_err(|e| e.to_string())?; if count == 0 { break; } hash.write(&buffer[..count]); }
        } else { continue; }
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; hash.write_u32(metadata.permissions().mode()); }
        snapshot.insert(relative, hash.finish());
    }
    Ok(snapshot)
}
pub fn changes(before: &Snapshot, after: &Snapshot) -> Vec<FileEdit> {
    before.keys().chain(after.keys()).collect::<BTreeSet<_>>().into_iter().filter_map(|path| {
        if before.get(path) == after.get(path) { return None; }
        Some(FileEdit {path:path.clone(),kind:if !before.contains_key(path) {"add"} else if !after.contains_key(path) {"delete"} else {"update"}.into(),diff:None})
    }).collect()
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn compares_turn_changes_without_counting_preexisting_edits() {
        let dir = tempfile::tempdir().unwrap(); assert!(std::process::Command::new("git").current_dir(dir.path()).arg("init").output().unwrap().status.success());
        std::fs::write(dir.path().join("existing"), "before").unwrap();
        assert!(std::process::Command::new("git").current_dir(dir.path()).args(["add","existing"]).output().unwrap().status.success());
        std::fs::write(dir.path().join("existing"), "already dirty").unwrap();
        let before = snapshot(dir.path()).unwrap(); assert!(changes(&before, &snapshot(dir.path()).unwrap()).is_empty());
        std::fs::write(dir.path().join("existing"), "agent edit").unwrap(); std::fs::write(dir.path().join("new"), "new").unwrap();
        let edits = changes(&before, &snapshot(dir.path()).unwrap()); assert_eq!(edits.len(), 2); assert_eq!(edits[0].kind, "update"); assert_eq!(edits[1].kind, "add");
        std::fs::remove_file(dir.path().join("existing")).unwrap(); assert_eq!(changes(&before, &snapshot(dir.path()).unwrap())[0].kind,"delete");
    }
}
