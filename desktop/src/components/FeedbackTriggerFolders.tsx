import {useEffect,useState,useRef} from 'react';
import {feedback} from '../lib/feedback';
import {folderKey,folderParts,mergedFolderTree,relativeFolder,mailboxRoot,ensureRelativeFolder,type MailboxTree} from '../lib/feedbackFolders';
import type {Repository} from '../types';
import {MailFolderTree} from './MailFolderTree';
export function FeedbackTriggerFolders({repositories,path,legacyValue,onChange}:{repositories:Repository[];path?:string[];legacyValue?:string;onChange:(path:string[])=>void}){
 const [mailboxes,setMailboxes]=useState<MailboxTree[]>([]),[busy,setBusy]=useState(false),[errors,setErrors]=useState<string[]>([]),[proposal,setProposal]=useState<{parts:string[];fresh:boolean}|null>(null);
 const ids=repositories.map(repo=>[repo.id,repo.displayName]),scope=JSON.stringify(ids),current=useRef(scope);current.current=scope;
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  let active=true;setMailboxes([]);setProposal(null);setErrors([]);setBusy(true);
  void Promise.all(repositories.map(async repo=>{
   const config=await feedback.config(repo.id);if(!config?.enabled)return null;
   try{const nodes=await feedback.setup(repo.id,config);mailboxRoot(config,nodes);return {id:repo.id,label:repo.displayName,config,nodes} as MailboxTree;}
   catch(reason){return {id:repo.id,label:repo.displayName,config,nodes:[],error:String(reason)} as MailboxTree;}
  })).then(values=>{if(active){const valuesWithConfig=values.filter((value):value is MailboxTree=>!!value);setMailboxes(valuesWithConfig);setErrors(valuesWithConfig.filter(value=>value.error).map(value=>`${value.label}: ${value.error}`));}}).catch(reason=>{if(active)setErrors([String(reason)]);}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[scope,revision]);
 const nodes=mergedFolderTree(mailboxes);
 const parts=path||[];
 const select=(parts:string[])=>{
  onChange(parts);
  const missing=mailboxes.some(mailbox=>!mailbox.error&&!relativeFolder(mailbox.config,mailbox.nodes,parts));
  setProposal(missing?{parts,fresh:false}:null);
 };
 const createAll=async()=>{
  if(!proposal)return;const selected=proposal.parts,requestScope=scope;setBusy(true);setErrors([]);
  const results=await Promise.all(mailboxes.map(async mailbox=>{
   try{return {...mailbox,nodes:await ensureRelativeFolder(mailbox,selected),error:undefined};}
   catch(reason){return {...mailbox,error:String(reason)};}
  }));
  if(current.current!==requestScope)return;
  setMailboxes(results);setErrors(results.filter(value=>value.error).map(value=>`${value.label}: ${value.error}`));
  if(results.some(value=>!value.error))onChange(selected);
  setProposal(results.some(value=>value.error)?{parts:selected,fresh:false}:null);setBusy(false);window.dispatchEvent(new Event('feedback-config-changed'));
 };
 return <div className="feedback-trigger-folders" onKeyDown={event=>{if(event.key==='Enter')event.stopPropagation();}}>
  {legacyValue&&path===undefined&&<small>Existing folder: {legacyValue}. Select a folder below to use repository-relative rules.</small>}
  <div className="feedback-toolbar"><small>{mailboxes.length} configured {mailboxes.length===1?'repository':'repositories'}</small><button type="button" disabled={busy} onClick={()=>setRevision(value=>value+1)}>Refresh</button></div>
  {busy?<p>Loading folders…</p>:mailboxes.length?<MailFolderTree rooted key={scope} nodes={nodes} value={path===undefined&&legacyValue?'':folderKey(parts)} onSelect={key=>select(folderParts(key))} onCreate={async(parent,name)=>{setProposal({parts:[...folderParts(parent),name],fresh:true});}}/>:<p>Set up email in a selected repository to browse its folders.</p>}
  {mailboxes.length>1&&<small>Dimmed folders aren’t confirmed in every repository. Hover for details.</small>}
  {proposal&&<div className="feedback-folder-proposal" role="status"><p>{proposal.fresh?'Create':'Complete'} “{proposal.parts.join(' / ')}” in all {mailboxes.length} configured repositories?</p><button type="button" disabled={busy} onClick={()=>void createAll()}>Create</button><button type="button" disabled={busy} onClick={()=>setProposal(null)}>Later</button></div>}
  {errors.map(error=><p role="alert" key={error}>{error}</p>)}
 </div>;
}
