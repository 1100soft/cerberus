import {useEffect,useState} from 'react';
import {feedback,type MailboxConfig} from '../lib/feedback';
import {relativeFolder,ensureRelativeFolder,type MailboxTree} from '../lib/feedbackFolders';
import {savedPrompts,automationConditions} from '../lib/savedPrompts';
export function FeedbackMissingFolders({repositoryId,config}:{repositoryId:string;config:MailboxConfig}){
 const [missing,setMissing]=useState<{parts:string[];titles:string[]}[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[dismissed,setDismissed]=useState(false);
 useEffect(()=>{let active=true;setDismissed(false);void feedback.setup(repositoryId,config).then(nodes=>{
  const paths=new Map<string,{parts:string[];titles:string[]}>();
  for(const job of savedPrompts().filter(job=>job.enabled&&automationConditions(job).includes('feedback')&&(job.includeFutureRepositories||(job.repositoryIds?.length?job.repositoryIds:[job.repositoryId]).includes(repositoryId)))){
   if(!job.feedbackPath?.length||relativeFolder(config,nodes,job.feedbackPath))continue;
   const key=JSON.stringify(job.feedbackPath),entry=paths.get(key)||{parts:job.feedbackPath,titles:[]};entry.titles.push(job.title);paths.set(key,entry);
  }
  if(active)setMissing([...paths.values()]);
 }).catch(reason=>{if(active)setError(String(reason));});return()=>{active=false;};},[repositoryId,config]);
 if(dismissed||(!missing.length&&!error))return null;
 const create=async()=>{setBusy(true);setError('');const remaining=[];for(const item of missing){try{const mailbox:MailboxTree={id:repositoryId,label:'This project',config,nodes:[]};await ensureRelativeFolder(mailbox,item.parts);}catch(reason){remaining.push(item);setError(String(reason));}}setMissing(remaining);setBusy(false);window.dispatchEvent(new Event('feedback-config-changed'));};
 return <div className="feedback-folder-proposal" role="status"><strong>Active automations need folders</strong>{missing.map(item=><p key={JSON.stringify(item.parts)}>{item.parts.join(' / ')} <small>· {item.titles.join(', ')}</small></p>)}{missing.length>0&&<button type="button" disabled={busy} onClick={()=>void create()}>Create</button>}<button type="button" disabled={busy} onClick={()=>setDismissed(true)}>Later</button>{error&&<p role="alert">{error}</p>}</div>;
}
