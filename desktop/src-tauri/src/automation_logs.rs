use serde::{Deserialize,Serialize};
use std::{fs,path::{Path,PathBuf}};

#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Entry {
    pub automation_id:String,
    pub repository_id:String,
    pub run_id:String,
    pub created_at:i64,
    pub kind:String,
    pub status:String,
    pub command:String,
    pub stdout:String,
    pub stderr:String,
    pub response:String,
    pub activity:String,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub retry:Option<serde_json::Value>,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Summary { pub repository_id:String,pub run_id:String,pub created_at:i64,pub kind:String,pub status:String }
fn valid(value:&str)->bool{!value.is_empty()&&value.len()<=128&&value.bytes().all(|byte|byte.is_ascii_alphanumeric()||matches!(byte,b'-'|b'_'))}
fn folder(root:&Path,automation_id:&str,repository_id:&str)->Result<PathBuf,String>{
    if !valid(automation_id)||!valid(repository_id){return Err("Invalid automation log identifier".into());}
    Ok(root.join("automation-logs").join(automation_id).join(repository_id))
}
fn file(root:&Path,automation_id:&str,repository_id:&str,run_id:&str)->Result<PathBuf,String>{
    if !valid(run_id){return Err("Invalid automation run identifier".into());}
    Ok(folder(root,automation_id,repository_id)?.join(format!("{run_id}.json")))
}
pub fn write(root:&Path,entry:&Entry)->Result<(),String>{
    if !matches!(entry.kind.as_str(),"shell"|"agent"|"git"|"notification")||!matches!(entry.status.as_str(),"running"|"completed"|"error"){return Err("Invalid automation log type or status".into());}
    let path=file(root,&entry.automation_id,&entry.repository_id,&entry.run_id)?;
    if [entry.command.len(),entry.stdout.len(),entry.stderr.len(),entry.response.len(),entry.activity.len()].iter().any(|size|*size>2_000_000){return Err("Automation log exceeds the 2 MB per field limit".into());}
    fs::create_dir_all(path.parent().ok_or("Invalid log path")?).map_err(|error|error.to_string())?;
    let bytes=serde_json::to_vec_pretty(entry).map_err(|error|error.to_string())?;
    let mut output=tempfile::NamedTempFile::new_in(path.parent().ok_or("Invalid log path")?).map_err(|error|error.to_string())?;
    use std::io::Write;output.write_all(&bytes).map_err(|error|error.to_string())?;
    output.as_file().sync_all().map_err(|error|error.to_string())?;
    output.persist(path).map_err(|error|error.to_string())?;
    Ok(())
}
pub fn list(root:&Path,automation_id:&str)->Result<Vec<Summary>,String>{
    if !valid(automation_id){return Err("Invalid automation identifier".into());}
    let parent=root.join("automation-logs").join(automation_id);
    if !parent.exists(){return Ok(Vec::new());}
    let mut summaries=Vec::new();
    for repository in fs::read_dir(parent).map_err(|error|error.to_string())?{
        let repository=repository.map_err(|error|error.to_string())?;
        if !repository.file_type().map_err(|error|error.to_string())?.is_dir(){continue;}
        let repository_id=repository.file_name().to_string_lossy().to_string();
        if !valid(&repository_id){continue;}
        for item in fs::read_dir(repository.path()).map_err(|error|error.to_string())?{
            let item=item.map_err(|error|error.to_string())?;
            if !item.file_type().map_err(|error|error.to_string())?.is_file(){continue;}
            let Some(run_id)=item.file_name().to_str().and_then(|name|name.strip_suffix(".json")).map(str::to_owned)else{continue};
            if !valid(&run_id){continue;}
            let Ok(bytes)=fs::read(item.path())else{continue};
            let Ok(entry)=serde_json::from_slice::<Entry>(&bytes)else{continue};
            if entry.automation_id==automation_id&&entry.repository_id==repository_id&&entry.run_id==run_id{
                summaries.push(Summary{repository_id:repository_id.clone(),run_id,created_at:entry.created_at,kind:entry.kind,status:entry.status});
            }
        }
    }
    summaries.sort_by(|a,b|b.created_at.cmp(&a.created_at));
    Ok(summaries)
}
pub fn read(root:&Path,automation_id:&str,repository_id:&str,run_id:&str)->Result<Entry,String>{
    let bytes=fs::read(file(root,automation_id,repository_id,run_id)?).map_err(|error|error.to_string())?;
    let entry:Entry=serde_json::from_slice(&bytes).map_err(|error|error.to_string())?;
    if entry.automation_id!=automation_id||entry.repository_id!=repository_id||entry.run_id!=run_id{return Err("Automation log identifier mismatch".into());}
    Ok(entry)
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn running_entry_updates_in_place(){
        let root=tempfile::tempdir().unwrap();
        let mut entry=Entry{automation_id:"live".into(),repository_id:"repo".into(),run_id:"run".into(),created_at:42,kind:"agent".into(),status:"running".into(),command:"review".into(),stdout:String::new(),stderr:String::new(),response:String::new(),activity:String::new(),retry:None};
        write(root.path(),&entry).unwrap();assert_eq!(list(root.path(),"live").unwrap()[0].status,"running");
        entry.activity="working".into();write(root.path(),&entry).unwrap();
        assert_eq!(read(root.path(),"live","repo","run").unwrap().activity,"working");
        entry.status="error".into();entry.retry=Some(serde_json::json!({"job":{"prompt":"original"},"incoming":{"name":"revise","id":"original"}}));
        write(root.path(),&entry).unwrap();
        assert_eq!(read(root.path(),"live","repo","run").unwrap().retry,entry.retry);
        entry.retry=None;
        entry.status="completed".into();entry.response="done".into();write(root.path(),&entry).unwrap();
        assert_eq!(list(root.path(),"live").unwrap().len(),1);
        assert_eq!(read(root.path(),"live","repo","run").unwrap().response,"done");
        assert!(read(root.path(),"live","repo","run").unwrap().retry.is_none());
    }
    #[test]fn entries_are_scoped_to_automation_and_repository(){
        let root=tempfile::tempdir().unwrap();
        let entry=Entry{automation_id:"job-1".into(),repository_id:"repo-1".into(),run_id:"run-1".into(),created_at:42,kind:"shell".into(),status:"completed".into(),command:"printf hello".into(),stdout:"hello".into(),stderr:String::new(),response:String::new(),activity:String::new(),retry:None};
        write(root.path(),&entry).unwrap();
        assert_eq!(list(root.path(),"job-1").unwrap().len(),1);
        assert!(list(root.path(),"job-2").unwrap().is_empty());
        assert_eq!(read(root.path(),"job-1","repo-1","run-1").unwrap().stdout,"hello");
        assert!(read(root.path(),"job-1","../repo-1","run-1").is_err());
    }
}
