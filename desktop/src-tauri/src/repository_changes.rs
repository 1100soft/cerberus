use std::{fs::File, io::Read, path::Path, process::Command};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ChangeSummary { pub head:String, pub branch:String, pub reflog:String, pub changed_lines:u64 }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct CommitState { pub head:String, pub branch:String, pub reflog:String }

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

/// Added plus deleted lines relative to HEAD, including untracked files.
/// Binary files count as one change. For unborn branches, staged and unstaged
/// deltas are combined because there is no commit to compare against.
pub fn changed_lines(repository:&Path)->Result<u64,String>{
    if !repository.is_dir(){return Err("Repository folder is unavailable".into());}
    let has_head=git(repository,&["rev-parse","--verify","HEAD"]).is_ok();
    let mut count=if has_head {numstat(repository,&["diff","--numstat","--no-ext-diff","HEAD","--"])?}
        else {numstat(repository,&["diff","--numstat","--no-ext-diff","--cached","--"])?
            .saturating_add(numstat(repository,&["diff","--numstat","--no-ext-diff","--"])?) };
    let untracked=git(repository,&["ls-files","--others","--exclude-standard","-z"])?;
    for name in untracked.split(|byte|*byte==0).filter(|name|!name.is_empty()){
        #[cfg(unix)] let path={use std::os::unix::ffi::OsStrExt;repository.join(std::ffi::OsStr::from_bytes(name))};
        #[cfg(not(unix))] let path=repository.join(String::from_utf8_lossy(name).as_ref());
        count=count.saturating_add(file_lines(&path));
    }
    Ok(count)
}
pub fn commit_state(repository:&Path)->Result<CommitState,String>{
    let head=String::from_utf8(git(repository,&["rev-parse","--verify","HEAD"]).unwrap_or_default()).unwrap_or_default().trim().to_owned();
    let branch=String::from_utf8(git(repository,&["symbolic-ref","--quiet","--short","HEAD"]).unwrap_or_default()).unwrap_or_default().trim().to_owned();
    let reflog=String::from_utf8(git(repository,&["reflog","-1","--format=%gs"]).unwrap_or_default()).unwrap_or_default().trim().to_owned();
    Ok(CommitState{head,branch,reflog})
}
pub fn summary(repository:&Path)->Result<ChangeSummary,String>{
    let state=commit_state(repository)?;
    Ok(ChangeSummary{head:state.head,branch:state.branch,reflog:state.reflog,changed_lines:changed_lines(repository)?})
}

#[cfg(test)]mod tests{
    use super::*;
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
