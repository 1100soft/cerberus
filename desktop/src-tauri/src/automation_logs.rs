use serde::{Deserialize,Serialize};
use std::{fs,path::{Path,PathBuf}};

#[derive(Clone,Default,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Context {
    #[serde(default)] pub commit_triggered:bool,
    #[serde(default,skip_serializing_if="Option::is_none")] pub branch:Option<String>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub commit_sha:Option<String>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub handoff_name:Option<String>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub handoff_id:Option<String>,
}
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Entry {
    #[serde(default,skip_serializing_if="Option::is_none")] pub title:Option<String>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub emitted_handoffs:Option<Vec<String>>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub events:Option<Vec<LogEvent>>,
    #[serde(default,skip_serializing_if="Option::is_none")] pub input_values:Option<serde_json::Value>,
    #[serde(default)] pub dismissed:bool,
    #[serde(flatten)] pub context:Context,
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
    #[serde(default,skip_serializing_if="Option::is_none")] pub conversation:Option<serde_json::Value>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub retry:Option<serde_json::Value>,
}
#[derive(Clone,Serialize,Deserialize)]
pub struct LogEvent { pub at:i64,pub stream:String,pub text:String }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Summary {pub automation_id:String,pub title:Option<String>,pub emitted_handoffs:Option<Vec<String>>,pub conversation_id:Option<String>, #[serde(flatten)] pub context:Context,pub repository_id:String,pub run_id:String,pub created_at:i64,pub kind:String,pub status:String }
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
    if entry.events.as_ref().is_some_and(|events|events.len()>2000||events.iter().map(|event|event.text.len()).sum::<usize>()>2_000_000){return Err("Automation event log exceeds limit".into());}
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
pub fn list_repository(root:&Path,repository_id:&str)->Result<Vec<Summary>,String>{
    if !valid(repository_id){return Err("Invalid repository identifier".into());}
    let parent=root.join("automation-logs");
    if !parent.exists(){return Ok(Vec::new());}
    let mut results=Vec::new();
    for item in fs::read_dir(parent).map_err(|e|e.to_string())? {
        let item=item.map_err(|e|e.to_string())?;
        if !item.file_type().map_err(|e|e.to_string())?.is_dir(){continue;}
        let id=item.file_name().to_string_lossy().to_string();
        if valid(&id){results.extend(list(root,&id)?.into_iter().filter(|entry|entry.repository_id==repository_id));}
    }
    results.sort_by(|a,b|b.created_at.cmp(&a.created_at));
    Ok(results)
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
                summaries.push(Summary{automation_id:entry.automation_id,title:entry.title,emitted_handoffs:entry.emitted_handoffs,conversation_id:entry.conversation.as_ref().and_then(|v|v["id"].as_str()).map(str::to_owned),context:entry.context,repository_id:repository_id.clone(),run_id,created_at:entry.created_at,kind:entry.kind,status:entry.status});
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
/// Delete saved output only; conversations and handoff payloads have independent lifetimes.
pub fn delete(root:&Path,automation_id:&str,repository_id:&str,run_id:&str)->Result<(),String>{
    let path=file(root,automation_id,repository_id,run_id)?;
    if !path.exists(){return Ok(());}
    let entry=read(root,automation_id,repository_id,run_id)?;
    if entry.status=="running"{return Err("An active run cannot be deleted.".into());}
    fs::remove_file(path).map_err(|e|e.to_string())?;
    let records=root.join("automation-commits").join(repository_id).join(run_id);
    if records.exists(){fs::remove_dir_all(records).map_err(|e|e.to_string())?;}
    Ok(())
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn running_entry_updates_in_place(){
        let root=tempfile::tempdir().unwrap();
        let mut entry=Entry{title:None,emitted_handoffs:None,events:None,input_values:None,dismissed:false,context:Context::default(),conversation:None,retry:None,automation_id:"live".into(),repository_id:"repo".into(),run_id:"run".into(),created_at:42,kind:"agent".into(),status:"running".into(),command:"review".into(),stdout:String::new(),stderr:String::new(),response:String::new(),activity:String::new()};
        write(root.path(),&entry).unwrap();assert_eq!(list(root.path(),"live").unwrap()[0].status,"running");
        assert!(delete(root.path(),"live","repo","run").is_err());
        entry.context.branch=Some("correction/test".into());entry.context.commit_sha=Some("selected-commit".into());entry.activity="working".into();write(root.path(),&entry).unwrap();
        assert_eq!(read(root.path(),"live","repo","run").unwrap().activity,"working");assert_eq!(list(root.path(),"live").unwrap()[0].context.branch.as_deref(),Some("correction/test"));
        entry.status="error".into();entry.retry=Some(serde_json::json!({"job":{"prompt":"original"},"incoming":{"name":"revise","id":"original"}}));
        write(root.path(),&entry).unwrap();
        assert_eq!(read(root.path(),"live","repo","run").unwrap().retry,entry.retry);
        entry.retry=None;
        entry.status="completed".into();entry.response="done".into();write(root.path(),&entry).unwrap();
        assert_eq!(list(root.path(),"live").unwrap().len(),1);
        assert_eq!(read(root.path(),"live","repo","run").unwrap().response,"done");
        assert!(read(root.path(),"live","repo","run").unwrap().retry.is_none());
        delete(root.path(),"live","repo","run").unwrap();assert!(list(root.path(),"live").unwrap().is_empty());
        delete(root.path(),"live","repo","run").unwrap();
    }
    #[test]fn entries_are_scoped_to_automation_and_repository(){
        let root=tempfile::tempdir().unwrap();
        let entry=Entry{title:None,emitted_handoffs:None,events:None,input_values:Some(serde_json::json!({"version":"minor","publish":false})),dismissed:false,context:Context::default(),conversation:None,retry:None,automation_id:"job-1".into(),repository_id:"repo-1".into(),run_id:"run-1".into(),created_at:42,kind:"shell".into(),status:"completed".into(),command:"printf hello".into(),stdout:"hello".into(),stderr:String::new(),response:String::new(),activity:String::new()};
        let mut entry=entry;
        entry.title=Some("Release".into());
        entry.emitted_handoffs=Some(vec!["review".into()]);
        entry.context.handoff_name=Some("publish".into());
        entry.context.handoff_id=Some("upstream-run".into());
        entry.events=Some(vec![LogEvent{at:1234,stream:"stdout".into(),text:"hello".into()}]);
        write(root.path(),&entry).unwrap();
        let rows=list_repository(root.path(),"repo-1").unwrap();
        assert_eq!(rows.len(),1);
        assert_eq!(rows[0].title.as_deref(),Some("Release"));
        assert_eq!(rows[0].context.handoff_id.as_deref(),Some("upstream-run"));
        assert_eq!(rows[0].emitted_handoffs.as_ref().unwrap(),&vec!["review".to_string()]);
        assert_eq!(read(root.path(),"job-1","repo-1","run-1").unwrap().events.unwrap()[0].at,1234);
        assert!(list_repository(root.path(),"repo-2").unwrap().is_empty());
        assert!(list_repository(root.path(),"../repo-1").is_err());
        assert_eq!(list(root.path(),"job-1").unwrap().len(),1);
        assert!(list(root.path(),"job-2").unwrap().is_empty());
        assert_eq!(read(root.path(),"job-1","repo-1","run-1").unwrap().stdout,"hello");
        assert_eq!(read(root.path(),"job-1","repo-1","run-1").unwrap().input_values,entry.input_values);
        assert!(read(root.path(),"job-1","../repo-1","run-1").is_err());
    }
}
