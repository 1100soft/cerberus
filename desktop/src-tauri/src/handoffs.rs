use serde::Serialize;
use std::{fs, path::{Path,PathBuf}, process::Command, time::{Duration,SystemTime}};

#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Claim { pub id:String, pub path:String }

pub fn valid_name(name:&str)->bool{
    !name.is_empty()&&name.len()<=64&&name.as_bytes()[0].is_ascii_alphanumeric()&&name.bytes().all(|byte|byte.is_ascii_alphanumeric()||matches!(byte,b'-'|b'_'))
}
fn valid_id(id:&str)->bool{!id.is_empty()&&id.len()<=128&&id.bytes().all(|byte|byte.is_ascii_alphanumeric()||matches!(byte,b'-'|b'_'))}
fn root(repository:&Path)->Result<PathBuf,String>{
    let output=Command::new("git").arg("-C").arg(repository).args(["rev-parse","--absolute-git-dir"]).output().map_err(|error|error.to_string())?;
    if !output.status.success(){return Err("Handoffs require a local Git repository.".into());}
    let git_dir=PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    let root=git_dir.join("cerberus-handoffs");
    if root.symlink_metadata().is_ok_and(|meta|meta.file_type().is_symlink()){return Err("Handoff storage is a symbolic link.".into());}
    fs::create_dir_all(&root).map_err(|error|error.to_string())?;
    Ok(root)
}
fn folder(repository:&Path,area:&str,name:&str)->Result<PathBuf,String>{
    if !valid_name(name){return Err("Handoff names must contain 1–64 letters, numbers, hyphens, or underscores, starting with a letter or number.".into());}
    let area_path=root(repository)?.join(area);
    if area_path.symlink_metadata().is_ok_and(|meta|meta.file_type().is_symlink()){return Err("Handoff storage area is a symbolic link.".into());}
    let path=area_path.join(name);
    if path.symlink_metadata().is_ok_and(|meta|meta.file_type().is_symlink()){return Err("Handoff folder is a symbolic link.".into());}
    fs::create_dir_all(&path).map_err(|error|error.to_string())?;
    Ok(path)
}
fn file(repository:&Path,area:&str,name:&str,id:&str)->Result<PathBuf,String>{
    if !valid_id(id){return Err("Invalid handoff emission ID.".into());}
    Ok(folder(repository,area,name)?.join(format!("{id}.txt")))
}
pub fn output_path(repository:&Path,name:&str,run_id:&str)->Result<String,String>{
    let path=file(repository,"outgoing",name,run_id)?;
    if path.symlink_metadata().is_ok_and(|meta|meta.file_type().is_symlink()){return Err("Handoff output is a symbolic link.".into());}
    Ok(path.to_string_lossy().into_owned())
}
pub fn write_payload(repository:&Path,name:&str,run_id:&str,payload:&str)->Result<(),String>{
    use std::io::Write;
    if payload.len()>2_000_000{return Err("Handoff payload exceeds 2 MB.".into());}
    let path=output_path(repository,name,run_id)?;
    let mut output=fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|error|error.to_string())?;
    output.write_all(payload.as_bytes()).map_err(|error|error.to_string())
}
pub fn publish(repository:&Path,name:&str,run_id:&str)->Result<bool,String>{
    let source=file(repository,"outgoing",name,run_id)?;
    if !source.exists(){return Ok(false);}
    if !source.symlink_metadata().map_err(|error|error.to_string())?.file_type().is_file(){return Err("Handoff payload must be a regular file.".into());}
    if source.metadata().map_err(|error|error.to_string())?.len()>2_000_000{let _=fs::remove_file(&source);return Err("Handoff payload exceeds 2 MB.".into());}
    let destination=file(repository,"pending",name,run_id)?;
    if destination.exists(){return Err("Handoff emission already exists.".into());}
    fs::rename(source,destination).map_err(|error|error.to_string())?;
    Ok(true)
}
fn pending(repository:&Path,name:&str)->Result<Vec<PathBuf>,String>{
    let directory=folder(repository,"pending",name)?;
    let mut files=fs::read_dir(directory).map_err(|error|error.to_string())?.filter_map(Result::ok).map(|item|item.path()).filter(|path|path.symlink_metadata().is_ok_and(|meta|meta.file_type().is_file())&&path.extension().is_some_and(|extension|extension=="txt")&&path.file_stem().and_then(|stem|stem.to_str()).is_some_and(valid_id)).collect::<Vec<_>>();
    files.sort();Ok(files)
}
#[cfg(test)]
pub fn cleanup_stale(repository:&Path)->Result<usize,String>{cleanup_with_retention(repository,24)}
pub fn cleanup_with_retention(repository:&Path,hours:u64)->Result<usize,String>{
    // A process interruption cannot cause another run of the same emission.
    // Claims older than the 15-minute runner limit plus a safety margin are
    // archived without automatically retriggering, even when the automation is disabled.
    let claimed_root=root(repository)?.join("claimed");
    let mut removed=0;
    if claimed_root.exists(){for namespace in fs::read_dir(claimed_root).map_err(|error|error.to_string())?.filter_map(Result::ok){
        let name=namespace.file_name().to_string_lossy().into_owned();
        if !valid_name(&name)||!namespace.file_type().is_ok_and(|kind|kind.is_dir()){continue;}
        for item in fs::read_dir(namespace.path()).map_err(|error|error.to_string())?.filter_map(Result::ok){
            let path=item.path();
            if !path.symlink_metadata().is_ok_and(|meta|meta.file_type().is_file()){continue;}
            let old=path.metadata().and_then(|meta|meta.modified()).ok().and_then(|time|SystemTime::now().duration_since(time).ok()).is_some_and(|age|age>Duration::from_secs(1800));
            if !old{continue;}
            let Some(id)=path.file_stem().and_then(|stem|stem.to_str())else{continue};
            if !valid_id(id){continue;}
            let consumed=file(repository,"consumed",&name,id)?;
            if fs::rename(&path,&consumed).is_ok(){let _=fs::File::open(consumed).and_then(|file|file.set_modified(SystemTime::now()));removed+=1;}
        }
    }}
    for area in ["consumed","archived"] {
    let consumed_root=root(repository)?.join(area);
    if consumed_root.exists(){for namespace in fs::read_dir(consumed_root).map_err(|error|error.to_string())?.filter_map(Result::ok){
        if !namespace.file_type().is_ok_and(|kind|kind.is_dir()){continue;}
        for item in fs::read_dir(namespace.path()).map_err(|error|error.to_string())?.filter_map(Result::ok){
            if item.file_type().is_ok_and(|kind|kind.is_file())&&item.metadata().and_then(|meta|meta.modified()).ok().and_then(|time|SystemTime::now().duration_since(time).ok()).is_some_and(|age|age>Duration::from_secs(hours*3600)){let _=fs::remove_file(item.path());}
        }
    }}
    }
    Ok(removed)
}
fn matches_variables(path: &Path, variables: &[String]) -> bool {
    if variables.is_empty() {
        return true;
    }
    if !path.metadata().is_ok_and(|meta| meta.len() <= 2_000_000) {
        return false;
    }
    let Ok(payload) = fs::read(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&payload) else {
        return false;
    };
    variables.iter().all(|name| {
        value
            .get("variables")
            .and_then(|vars| vars.get(name))
            .and_then(serde_json::Value::as_bool)
            == Some(true)
    })
}
pub fn has_pending_matching(
    repository: &Path,
    name: &str,
    variables: &[String],
) -> Result<bool, String> {
    Ok(pending(repository, name)?
        .iter()
        .any(|path| matches_variables(path, variables)))
}
#[cfg(test)]
pub fn has_pending(repository:&Path,name:&str)->Result<bool,String>{Ok(!pending(repository,name)?.is_empty())}
#[cfg(test)]
pub fn claim(repository:&Path,name:&str)->Result<Option<Claim>,String>{claim_matching(repository,name,&[])}
pub fn claim_matching(
    repository: &Path,
    name: &str,
    variables: &[String],
) -> Result<Option<Claim>, String> {
    for source in pending(repository, name)? {
        if !matches_variables(&source, variables) {
            continue;
        }
        let Some(id) = source
            .file_stem()
            .and_then(|stem| stem.to_str())
            .map(str::to_owned)
        else {
            continue;
        };
        let destination = file(repository, "claimed", name, &id)?;
        if fs::hard_link(&source, &destination).is_ok() {
            if let Err(error)=fs::remove_file(&source){let _=fs::remove_file(&destination);return Err(error.to_string());}
            // The payload may have waited in the queue for hours. Lease age
            // begins at claim time, not at the agent's original write.
            if let Err(error) =
                fs::File::open(&destination).and_then(|file| file.set_modified(SystemTime::now()))
            {
                let _ = fs::rename(&destination, &source);
                return Err(format!("Could not timestamp handoff claim: {error}"));
            }
            return Ok(Some(Claim {
                id,
                path: destination.to_string_lossy().into_owned(),
            }));
        }
    }
    Ok(None)
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Selection {pub id:String,pub preview:String,pub retained:bool}
pub fn selections(repository:&Path,name:&str,variables:&[String])->Result<Vec<Selection>,String>{
    let mut result=Vec::new();
    for area in ["pending","consumed","archived"] {
        for entry in fs::read_dir(folder(repository,area,name)?).map_err(|error|error.to_string())?.filter_map(Result::ok) {
            let path=entry.path();
            if !entry.file_type().is_ok_and(|kind|kind.is_file())||!path.metadata().is_ok_and(|meta|meta.len()<=2_000_000)||!matches_variables(&path,variables){continue;}
            let Some(id)=path.file_stem().and_then(|stem|stem.to_str())else{continue};
            if !valid_id(id){continue;}
            result.push(Selection{id:id.into(),preview:fs::read_to_string(&path).map_err(|error|error.to_string())?.chars().take(500).collect(),retained:area!="pending"});
        }
    }
    result.sort_by(|a,b|a.id.cmp(&b.id));Ok(result)
}
pub fn claim_selected(repository:&Path,name:&str,id:&str,variables:&[String])->Result<Claim,String>{
    let destination=file(repository,"claimed",name,id)?;
    if destination.exists(){return Err("This handoff is already being used by another run.".into());}
    for area in ["pending","consumed","archived"] {
        let source=file(repository,area,name,id)?;
        if !source.symlink_metadata().is_ok_and(|meta|meta.file_type().is_file())||!matches_variables(&source,variables){continue;}
        // A hard link creates the claim atomically without overwriting an active claim.
        fs::hard_link(&source,&destination).map_err(|error|error.to_string())?;
        if let Err(error)=fs::remove_file(&source){let _=fs::remove_file(&destination);return Err(error.to_string());}
        fs::File::open(&destination).and_then(|file|file.set_modified(SystemTime::now())).map_err(|error|error.to_string())?;
        return Ok(Claim{id:id.into(),path:destination.to_string_lossy().into_owned()});
    }
    Err("The selected handoff is no longer available or its flags do not match.".into())
}
pub fn finish(repository:&Path,name:&str,id:&str)->Result<(),String>{
    let source=file(repository,"claimed",name,id)?;
    if !source.exists(){return Ok(());}
    // Retain the original payload outside the pending queue. Cleanup cannot
    // turn a completed action into an automatically pending event.
    let consumed=file(repository,"consumed",name,id)?;
    fs::rename(source,&consumed).map_err(|error|error.to_string())?;
    fs::File::open(consumed).and_then(|file|file.set_modified(SystemTime::now())).map_err(|error|error.to_string())
}
pub fn release(repository:&Path,name:&str,id:&str)->Result<(),String>{
    let source=file(repository,"claimed",name,id)?;
    if source.exists(){fs::rename(source,file(repository,"pending",name,id)?).map_err(|error|error.to_string())?;}
    Ok(())
}
#[cfg(test)] mod notification_tests {
    #[test] fn notification_payload_publishes_once(){
        let root=tempfile::tempdir().unwrap();
        std::process::Command::new("git").args(["init","-q"]).arg(root.path()).status().unwrap();
        super::write_payload(root.path(),"notice","run","Ready to review").unwrap();
        assert!(super::write_payload(root.path(),"notice","run","Overwrite").is_err());
        assert!(super::publish(root.path(),"notice","run").unwrap());
        assert!(!super::publish(root.path(),"notice","run").unwrap());
        assert!(super::write_payload(root.path(),"../bad","run","Payload").is_err());
    }
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn validates_names_and_claims_each_emission_once(){
        let root=tempfile::tempdir().unwrap();assert!(Command::new("git").args(["init","-q"]).current_dir(root.path()).status().unwrap().success());
        for bad in ["","../review","review/x",".hidden","a b"]{assert!(!valid_name(bad));}
        for id in ["one","two"]{fs::write(output_path(root.path(),"review",id).unwrap(),id).unwrap();assert!(publish(root.path(),"review",id).unwrap());}
        let first=claim(root.path(),"review").unwrap().unwrap();let second=claim(root.path(),"review").unwrap().unwrap();assert_ne!(first.id,second.id);assert!(claim(root.path(),"review").unwrap().is_none());
        assert_eq!(fs::read_to_string(&first.path).unwrap(),first.id);finish(root.path(),"review",&first.id).unwrap();assert!(!Path::new(&first.path).exists());release(root.path(),"review",&second.id).unwrap();assert_eq!(claim(root.path(),"review").unwrap().unwrap().id,second.id);
    }
    #[test]fn concurrent_claim_has_one_winner(){
        let root=tempfile::tempdir().unwrap();assert!(Command::new("git").args(["init","-q"]).current_dir(root.path()).status().unwrap().success());
        fs::write(output_path(root.path(),"correction","one").unwrap(),"payload").unwrap();publish(root.path(),"correction","one").unwrap();
        let path=root.path().to_path_buf();let threads=(0..8).map(|_|{let path=path.clone();std::thread::spawn(move||claim(&path,"correction").unwrap())}).collect::<Vec<_>>();
        assert_eq!(threads.into_iter().filter_map(|thread|thread.join().unwrap()).count(),1);
    }
    #[test]fn old_pending_payload_gets_a_fresh_claim_lease(){
        let root=tempfile::tempdir().unwrap();assert!(Command::new("git").args(["init","-q"]).current_dir(root.path()).status().unwrap().success());
        let output=output_path(root.path(),"review","old").unwrap();fs::write(&output,"old payload").unwrap();publish(root.path(),"review","old").unwrap();
        let pending=file(root.path(),"pending","review","old").unwrap();fs::File::open(pending).unwrap().set_modified(SystemTime::now()-Duration::from_secs(7200)).unwrap();
        let claimed=claim(root.path(),"review").unwrap().unwrap();assert_eq!(fs::read_to_string(&claimed.path).unwrap(),"old payload");
        assert!(!has_pending(root.path(),"review").unwrap());
    }
    #[test]fn handoffs_are_scoped_to_their_repository(){
        let left=tempfile::tempdir().unwrap();let right=tempfile::tempdir().unwrap();
        for root in [&left,&right]{assert!(Command::new("git").args(["init","-q"]).current_dir(root.path()).status().unwrap().success());}
        fs::write(output_path(left.path(),"review","one").unwrap(),"left only").unwrap();publish(left.path(),"review","one").unwrap();
        assert!(has_pending(left.path(),"review").unwrap());assert!(!has_pending(right.path(),"review").unwrap());
    }
    #[test]fn interrupted_claim_is_discarded_without_retriggering(){
        let root=tempfile::tempdir().unwrap();assert!(Command::new("git").args(["init","-q"]).current_dir(root.path()).status().unwrap().success());
        fs::write(output_path(root.path(),"review","one").unwrap(),"payload").unwrap();publish(root.path(),"review","one").unwrap();
        let claimed=claim(root.path(),"review").unwrap().unwrap();
        fs::File::open(&claimed.path).unwrap().set_modified(SystemTime::now()-Duration::from_secs(7200)).unwrap();
        assert_eq!(cleanup_stale(root.path()).unwrap(),1);
        assert!(!has_pending(root.path(),"review").unwrap());assert!(claim(root.path(),"review").unwrap().is_none());
        assert!(!Path::new(&claimed.path).exists());
    }
}

#[cfg(test)]
mod variable_tests {
    use super::*;
    #[test]
    fn strict_boolean_filters_skip_nonmatching_payloads_without_consuming_them() {
        let root = tempfile::tempdir().unwrap();
        assert!(Command::new("git")
            .args(["init", "-q"])
            .arg(root.path())
            .status()
            .unwrap()
            .success());
        for (id, payload) in [
            ("a", r#"{"variables":{"v":false,"ready":true}}"#),
            ("b", r#"{"variables":{"v":"true","ready":true}}"#),
            ("c", r#"{"variables":{"v":true}}"#),
            ("d", "plain text"),
            (
                "e",
                r#"{"variables":{"v":true,"ready":true},"details":"context"}"#,
            ),
        ] {
            write_payload(root.path(), "review", id, payload).unwrap();
            publish(root.path(), "review", id).unwrap();
        }
        let variables = vec!["v".into(), "ready".into()];
        assert!(has_pending_matching(root.path(), "review", &variables).unwrap());
        assert!(!has_pending_matching(root.path(), "review", &["V".into()]).unwrap());
        let matched = claim_matching(root.path(), "review", &variables)
            .unwrap()
            .unwrap();
        assert_eq!(matched.id, "e");
        finish(root.path(), "review", &matched.id).unwrap();
        assert!(!has_pending_matching(root.path(), "review", &variables).unwrap());
        assert!(claim_matching(root.path(), "review", &variables)
            .unwrap()
            .is_none());
        assert_eq!(pending(root.path(), "review").unwrap().len(), 4);
        assert_eq!(claim(root.path(), "review").unwrap().unwrap().id, "a");
    }
    #[test]
    fn concurrent_filtered_claim_has_one_winner() {
        let root = tempfile::tempdir().unwrap();
        assert!(Command::new("git")
            .args(["init", "-q"])
            .arg(root.path())
            .status()
            .unwrap()
            .success());
        write_payload(root.path(), "review", "one", r#"{"variables":{"v":true}}"#).unwrap();
        publish(root.path(), "review", "one").unwrap();
        let threads = (0..8)
            .map(|_| {
                let path = root.path().to_path_buf();
                std::thread::spawn(move || claim_matching(&path, "review", &["v".into()]).unwrap())
            })
            .collect::<Vec<_>>();
        assert_eq!(
            threads
                .into_iter()
                .filter_map(|thread| thread.join().unwrap())
                .count(),
            1
        );
    }
}

#[cfg(test)] mod selection_tests {
    use super::*;
    #[test] fn selected_handoffs_keep_original_ids_and_require_flags(){
        let repo=tempfile::tempdir().unwrap();Command::new("git").args(["init","-q"]).arg(repo.path()).status().unwrap();
        write_payload(repo.path(),"review","original",r#"{"variables":{"ready":true}}"#).unwrap();publish(repo.path(),"review","original").unwrap();
        assert!(selections(repo.path(),"review",&["missing".into()]).unwrap().is_empty());
        let claim=claim_selected(repo.path(),"review","original",&["ready".into()]).unwrap();
        assert!(claim_selected(repo.path(),"review","original",&[]).is_err());
        finish(repo.path(),"review",&claim.id).unwrap();
        let items=selections(repo.path(),"review",&[]).unwrap();assert_eq!(items[0].id,"original");assert!(items[0].retained);
        assert!(!has_pending(repo.path(),"review").unwrap());
        let retry=claim_selected(repo.path(),"review","original",&[]).unwrap();assert_eq!(retry.id,claim.id);finish(repo.path(),"review",&retry.id).unwrap();
        let path=file(repo.path(),"consumed","review","original").unwrap();fs::File::open(path).unwrap().set_modified(SystemTime::now()-Duration::from_secs(7200)).unwrap();
        cleanup_with_retention(repo.path(),1).unwrap();assert!(selections(repo.path(),"review",&[]).unwrap().is_empty());
    }
}
