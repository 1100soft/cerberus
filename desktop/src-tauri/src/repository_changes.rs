use std::{fs::File, io::Read, path::Path, process::Command};
use serde::Serialize;

#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct ChangeSummary { pub head:String, pub branch:String, pub reflog:String, pub changed_lines:u64 }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct CommitState { pub head:String, pub branch:String, pub reflog:String, pub refs:Vec<CommitRef> }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct CommitRef { pub key:String, pub head:String, pub branch:String, pub reflog:String }

fn git(repository:&Path,args:&[&str])->Result<Vec<u8>,String>{
    let output=Command::new("git").arg("-C").arg(repository).args(args).env("GIT_TERMINAL_PROMPT","0").output().map_err(|error|error.to_string())?;
    if !output.status.success(){return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());}
    Ok(output.stdout)
}

fn numstat(repository:&Path,args:&[&str])->Result<u64,String>{
    let output=git(repository,args)?;
    Ok(output.split(|byte|*byte==b'\n').filter(|line|!line.is_empty()).map(|line|{
        let mut parts=line.splitn(3,|byte|*byte==b'\t');
        let parse=|part:Option<&[u8]>|part.and_then(|value|std::str::from_utf8(value).ok()).and_then(|value|value.parse::<u64>().ok());
        match (parse(parts.next()),parse(parts.next())){(Some(added),Some(removed))=>added.saturating_add(removed),_=>1}
    }).sum())
}

fn file_lines(path:&Path)->u64{
    if !std::fs::symlink_metadata(path).is_ok_and(|metadata|metadata.file_type().is_file()){return 1;}
    let Ok(mut file)=File::open(path) else {return 0};
    let mut buffer=[0u8;8192];let mut lines=0u64;let mut last=0u8;let mut any=false;
    loop {let Ok(size)=file.read(&mut buffer) else {return 0};if size==0{break;}
        if buffer[..size].contains(&0){return 1;}
        lines=lines.saturating_add(buffer[..size].iter().filter(|byte|**byte==b'\n').count() as u64);
        last=buffer[size-1];any=true;
    }
    lines.saturating_add(u64::from(any&&last!=b'\n'))
}

/// Added plus deleted lines relative to HEAD, including untracked project files.
/// Untracked agent scratch artifacts are excluded; explicitly staged/tracked ones count.
/// Binary files count as one change. For unborn branches, staged and unstaged
/// deltas are combined because there is no commit to compare against.
pub fn changed_lines(repository:&Path)->Result<u64,String>{
    if !repository.is_dir(){return Err("Repository folder is unavailable".into());}
    let has_head=git(repository,&["rev-parse","--verify","HEAD"]).is_ok();
    let mut count=if has_head {numstat(repository,&["diff","--numstat","--no-ext-diff","HEAD","--"])?}
        else {numstat(repository,&["diff","--numstat","--no-ext-diff","--cached","--"])?
            .saturating_add(numstat(repository,&["diff","--numstat","--no-ext-diff","--"])?) };
    let untracked=git(repository,&["ls-files","--others","--exclude-standard","-z"])?;
    for name in untracked.split(|byte|*byte==0).filter(|name|!name.is_empty()&&!name.starts_with(b".agent-artifacts/")){
        #[cfg(unix)] let path={use std::os::unix::ffi::OsStrExt;repository.join(std::ffi::OsStr::from_bytes(name))};
        #[cfg(not(unix))] let path=repository.join(String::from_utf8_lossy(name).as_ref());
        count=count.saturating_add(file_lines(&path));
    }
    Ok(count)
}
pub fn checkout_state(repository:&Path)->Result<CommitState,String>{
    let head=String::from_utf8(git(repository,&["rev-parse","--verify","HEAD"]).unwrap_or_default()).unwrap_or_default().trim().to_owned();
    let branch=String::from_utf8(git(repository,&["symbolic-ref","--quiet","--short","HEAD"]).unwrap_or_default()).unwrap_or_default().trim().to_owned();
    let reflog=String::from_utf8(git(repository,&["reflog","-1","--format=%gs"]).unwrap_or_default()).unwrap_or_default().trim().to_owned();
    Ok(CommitState{head,branch,reflog,refs:Vec::new()})
}
pub fn commit_state(repository:&Path)->Result<CommitState,String>{
    let CommitState{head,branch,reflog,..}=checkout_state(repository)?;
    let mut refs=Vec::new();
    let branches=git(repository,&["for-each-ref","--format=%(refname)%09%(objectname)","refs/heads/"])?;
    for line in String::from_utf8_lossy(&branches).lines(){
        let Some((reference,sha))=line.split_once('\t') else {continue};
        let message=String::from_utf8_lossy(&git(repository,&["reflog","-1","--format=%gs",reference]).unwrap_or_default()).trim().to_owned();
        refs.push(CommitRef{key:reference.into(),head:sha.into(),branch:reference.trim_start_matches("refs/heads/").into(),reflog:message});
    }
    // Detached worktrees have no branch ref; their private HEAD reflogs still record commits.
    let worktrees=git(repository,&["worktree","list","--porcelain","-z"])?;
    for record in worktrees.split(|byte|*byte==0).filter(|record|record.starts_with(b"worktree ")){
        #[cfg(unix)] let path={use std::os::unix::ffi::OsStrExt;Path::new(std::ffi::OsStr::from_bytes(&record[9..]))};
        #[cfg(not(unix))] let path_text=String::from_utf8_lossy(&record[9..]);
        #[cfg(not(unix))] let path=Path::new(path_text.as_ref());
        if git(path,&["symbolic-ref","--quiet","HEAD"]).is_ok(){continue;}
        let sha=String::from_utf8_lossy(&git(path,&["rev-parse","--verify","HEAD"]).unwrap_or_default()).trim().to_owned();
        let message=String::from_utf8_lossy(&git(path,&["reflog","-1","--format=%gs","HEAD"]).unwrap_or_default()).trim().to_owned();
        refs.push(CommitRef{key:format!("worktree:{}",path.display()),head:sha,branch:String::new(),reflog:message});
    }
    Ok(CommitState{head,branch,reflog,refs})
}
pub fn summary(repository:&Path)->Result<ChangeSummary,String>{
    let state=checkout_state(repository)?;
    Ok(ChangeSummary{head:state.head,branch:state.branch,reflog:state.reflog,changed_lines:changed_lines(repository)?})
}


type SummaryResult=Result<ChangeSummary,String>;
struct SummaryReads {
    pending:std::sync::Mutex<std::collections::HashMap<std::path::PathBuf,std::sync::Arc<tokio::sync::OnceCell<SummaryResult>>>>,
    capacity:std::sync::Arc<tokio::sync::Semaphore>,
}
impl Default for SummaryReads {
    fn default()->Self{Self{pending:Default::default(),capacity:std::sync::Arc::new(tokio::sync::Semaphore::new(4))}}
}
impl SummaryReads {
    async fn read<F>(&self,path:std::path::PathBuf,reader:F)->SummaryResult
    where F:FnOnce(&Path)->SummaryResult+Send+'static {
        let cell={let mut pending=self.pending.lock().map_err(|_|"Change reads are unavailable")?;pending.entry(path.clone()).or_default().clone()};
        let key=path.clone();
        let result=cell.get_or_init(||async{
            // Acquire before spawn_blocking: queued callers do not allocate worker
            // threads, pipes or Git processes. The real read owns the permit even
            // if the requesting frontend disappears while it is still running.
            let permit=self.capacity.clone().acquire_owned().await.map_err(|_|"Change reads are unavailable")?;
            tauri::async_runtime::spawn_blocking(move||{let _permit=permit;reader(&path)}).await.map_err(|error|error.to_string())?
        }).await.clone();
        if let Ok(mut pending)=self.pending.lock(){if pending.get(&key).is_some_and(|current|std::sync::Arc::ptr_eq(current,&cell)){pending.remove(&key);}}
        result
    }
}
/// Share concurrent reads and bound Git process creation across all projects.
pub async fn read_summary(path:std::path::PathBuf)->SummaryResult {
    static READS:std::sync::OnceLock<SummaryReads>=std::sync::OnceLock::new();
    READS.get_or_init(Default::default).read(path,summary).await
}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn commits_in_other_worktrees_are_repository_wide(){
        let root=tempfile::tempdir().unwrap();let primary=root.path().join("primary");let linked=root.path().join("linked");
        std::fs::create_dir(&primary).unwrap();
        let run=|path:&Path,args:&[&str]|{git(path,args).unwrap();};
        run(&primary,&["init","-q","-b","main"]);run(&primary,&["config","user.name","Fixture"]);run(&primary,&["config","user.email","fixture@example.test"]);
        run(&primary,&["commit","--allow-empty","-qm","initial"]);
        let initial=commit_state(&primary).unwrap();
        run(&primary,&["worktree","add","-q","-b","agent/new",linked.to_str().unwrap()]);
        let created=commit_state(&primary).unwrap();
        assert!(!created.refs.iter().find(|item|item.branch=="agent/new").unwrap().reflog.starts_with("commit"));
        run(&linked,&["commit","--allow-empty","-qm","agent commit"]);
        let observed=commit_state(&primary).unwrap();
        assert_eq!(observed.head,initial.head);
        let agent=observed.refs.iter().find(|item|item.branch=="agent/new").unwrap();
        assert_ne!(agent.head,initial.head);assert!(agent.reflog.starts_with("commit"));
        let from_linked=commit_state(&linked).unwrap();
        assert_eq!(from_linked.refs.len(),observed.refs.len());
        assert_eq!(crate::git::GitService::default().branches(&primary).unwrap(),vec!["agent/new","main"]);
        run(&linked,&["checkout","--detach","-q"]);run(&linked,&["commit","--allow-empty","-qm","detached commit"]);
        let detached=commit_state(&primary).unwrap();
        assert!(detached.refs.iter().any(|item|item.key.starts_with("worktree:")&&item.branch.is_empty()&&item.reflog.starts_with("commit")));
    }
    fn fixture_summary()->ChangeSummary{ChangeSummary{head:"head".into(),branch:"main".into(),reflog:"commit: fixture".into(),changed_lines:3}}
    #[test]fn concurrent_summary_requests_share_one_read(){
        use std::sync::{Arc,atomic::{AtomicUsize,Ordering}};
        tauri::async_runtime::block_on(async{
            let reads=Arc::new(SummaryReads::default());let calls=Arc::new(AtomicUsize::new(0));let entered=Arc::new(AtomicUsize::new(0));let ready=Arc::new(tokio::sync::Notify::new());
            let gate=Arc::new((std::sync::Mutex::new(false),std::sync::Condvar::new()));let mut tasks=Vec::new();
            for _ in 0..100{
                let (reads,calls,entered,ready,gate)=(reads.clone(),calls.clone(),entered.clone(),ready.clone(),gate.clone());
                tasks.push(tauri::async_runtime::spawn(async move{
                    if entered.fetch_add(1,Ordering::SeqCst)==99{ready.notify_one();}
                    reads.read("same-repository".into(),move |_|{calls.fetch_add(1,Ordering::SeqCst);let (lock,condition)=&*gate;let mut open=lock.lock().unwrap();while !*open{open=condition.wait(open).unwrap();}Ok(fixture_summary())}).await
                }));
            }
            ready.notified().await;
            tokio::time::timeout(std::time::Duration::from_secs(5),async{
                while reads.pending.lock().unwrap().get(Path::new("same-repository")).map(std::sync::Arc::strong_count).unwrap_or(0)<101{tokio::task::yield_now().await;}
            }).await.unwrap();
            {let (lock,condition)=&*gate;*lock.lock().unwrap()=true;condition.notify_all();}
            for task in tasks{assert_eq!(task.await.unwrap().unwrap().changed_lines,3);}
            assert_eq!(calls.load(Ordering::SeqCst),1);assert!(reads.pending.lock().unwrap().is_empty());
            assert!(reads.read("retry".into(),|_|Err("temporary".into())).await.is_err());
            assert!(reads.read("retry".into(),|_|Ok(fixture_summary())).await.is_ok());
        });
    }
    #[test]fn summaries_limit_blocking_workers_across_repositories(){
        use std::sync::{Arc,atomic::{AtomicUsize,Ordering}};
        tauri::async_runtime::block_on(async{
            let reads=Arc::new(SummaryReads::default());let active=Arc::new(AtomicUsize::new(0));let peak=Arc::new(AtomicUsize::new(0));
            let gate=Arc::new((std::sync::Mutex::new(false),std::sync::Condvar::new()));let (started,receive)=std::sync::mpsc::channel();let mut tasks=Vec::new();
            for index in 0..50{
                let (reads,active,peak,gate,started)=(reads.clone(),active.clone(),peak.clone(),gate.clone(),started.clone());
                tasks.push(tauri::async_runtime::spawn(async move{reads.read(format!("repo-{index}").into(),move |_|{
                    let count=active.fetch_add(1,Ordering::SeqCst)+1;peak.fetch_max(count,Ordering::SeqCst);started.send(()).unwrap();
                    let (lock,condition)=&*gate;let mut open=lock.lock().unwrap();while !*open{open=condition.wait(open).unwrap();}
                    active.fetch_sub(1,Ordering::SeqCst);Ok(fixture_summary())
                }).await}));
            }
            for _ in 0..4{receive.recv_timeout(std::time::Duration::from_secs(5)).unwrap();}
            assert_eq!(active.load(Ordering::SeqCst),4);
            {let (lock,condition)=&*gate;*lock.lock().unwrap()=true;condition.notify_all();}
            for task in tasks{task.await.unwrap().unwrap();}
            assert!(peak.load(Ordering::SeqCst)<=4);assert!(reads.pending.lock().unwrap().is_empty());
        });
    }
    #[test]fn ignores_untracked_agent_artifacts_but_counts_explicitly_staged_files(){
        let root=tempfile::tempdir().unwrap();
        let run=|args:&[&str]|assert!(Command::new("git").args(args).current_dir(root.path()).status().unwrap().success());
        run(&["init","-q"]);run(&["config","user.name","Fixture"]);run(&["config","user.email","fixture@example.test"]);run(&["commit","--allow-empty","-qm","initial"]);
        std::fs::create_dir(root.path().join(".agent-artifacts")).unwrap();
        std::fs::write(root.path().join(".agent-artifacts/trace.log"),"scratch\noutput\nlog\n").unwrap();
        assert_eq!(changed_lines(root.path()).unwrap(),0);
        std::fs::write(root.path().join("source.rs"),"new source\n").unwrap();
        assert_eq!(summary(root.path()).unwrap().changed_lines,1);
        run(&["add",".agent-artifacts/trace.log"]);
        assert_eq!(changed_lines(root.path()).unwrap(),4);
    }
    #[test]fn counts_tracked_and_untracked_lines_then_resets_after_commit(){
        let root=tempfile::tempdir().unwrap();
        let run=|args:&[&str]|assert!(Command::new("git").args(args).current_dir(root.path()).status().unwrap().success());
        run(&["init","-q"]);run(&["config","user.name","Fixture"]);run(&["config","user.email","fixture@example.test"]);
        std::fs::write(root.path().join("tracked"),"one\n").unwrap();run(&["add","tracked"]);run(&["commit","-qm","initial"]);
        assert_eq!(changed_lines(root.path()).unwrap(),0);
        std::fs::write(root.path().join("tracked"),"one\ntwo\n").unwrap();
        std::fs::write(root.path().join("new"),"three\nfour").unwrap();
        assert_eq!(changed_lines(root.path()).unwrap(),3);
        let before=summary(root.path()).unwrap();assert_eq!(before.changed_lines,3);
        assert!(!before.branch.is_empty());assert!(before.reflog.starts_with("commit"));
        run(&["add","."]);run(&["commit","-qm","changes"]);
        assert_eq!(changed_lines(root.path()).unwrap(),0);
        let after=summary(root.path()).unwrap();assert_ne!(before.head,after.head);assert_eq!(after.branch,before.branch);assert!(after.reflog.starts_with("commit"));
    }
}
