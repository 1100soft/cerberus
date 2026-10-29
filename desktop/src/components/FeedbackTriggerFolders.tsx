import {useEffect,useState,useRef} from 'react';
import {feedback,cachedMailFolders} from '../lib/feedback';
import {folderKey,folderParts,folderPathLabel,mailboxFolderScope,mergedFolderTree,relativeFolder,ensureRelativeFolder,type MailboxTree} from '../lib/feedbackFolders';
import type {Repository} from '../types';
import {MailFolderTree} from './MailFolderTree';
export function FeedbackTriggerFolders({repositories,path,legacyValue,onChange}:{repositories:Repository[];path?:string[];legacyValue?:string;onChange:(path:string[])=>void}){
 const [mailboxes,setMailboxes]=useState<MailboxTree[]>([]),[busy,setBusy]=useState(false),[errors,setErrors]=useState<string[]>([]),[proposal,setProposal]=useState<{parts:string[];fresh:boolean}|null>(null);
 const ids=repositories.map(repo=>[repo.id,repo.displayName]),scope=JSON.stringify(ids),current=useRef(scope);current.current=scope;
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  let active=true;setMailboxes([]);setProposal(null);setErrors([]);setBusy(true);
  let remaining=repositories.length;
  if(!remaining)setBusy(false);
  const update=(mailbox:MailboxTree)=>{if(!active)return;setMailboxes(current=>[...current.filter(value=>value.id!==mailbox.id),mailbox].sort((a,b)=>repositories.findIndex(repo=>repo.id===a.id)-repositories.findIndex(repo=>repo.id===b.id)));};
  for(const repo of repositories)void (async()=>{
   let config;
   try{
    config=await feedback.config(repo.id);if(!config?.enabled)return;
    const cached=cachedMailFolders(repo.id,config);update({id:repo.id,label:repo.displayName,config,nodes:cached||[],unverified:!!cached,error:cached?undefined:'Loading folders…'});
    const nodes=await feedback.setup(repo.id,config,undefined,undefined,undefined,revision>0);update({id:repo.id,label:repo.displayName,config,nodes});
   }catch(reason){if(active){setErrors(current=>[...current,`${repo.displayName}: ${String(reason)}`]);if(config?.enabled){const cached=cachedMailFolders(repo.id,config);update({id:repo.id,label:repo.displayName,config,nodes:cached||[],unverified:!!cached,error:cached?undefined:String(reason)});}}}
   finally{if(active&&!--remaining)setBusy(false);}
  })();
  return()=>{active=false;};
 },[scope,revision]);
 const nodes=mergedFolderTree(mailboxes);
 const parts=path||[mailboxFolderScope,'INBOX'];
 const selection=parts[0]===mailboxFolderScope?parts:(()=>{const mailbox=mailboxes.find(value=>!value.error);if(!mailbox)return parts;try{const actual=relativeFolder(mailbox.config,mailbox.nodes,parts);const node=mailbox.nodes.find(node=>node.path===actual);return actual?[mailboxFolderScope,...(node?.delimiter?actual.split(node.delimiter):[actual])]:parts;}catch{return parts;}})();
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
  {path&&path[0]!==mailboxFolderScope&&<small>Existing rule keeps its previous per-project folder until you choose a folder.</small>}
  {legacyValue&&path===undefined&&<small>Existing folder: {legacyValue}. Select a mailbox folder below.</small>}
  <div className="feedback-toolbar"><small>{mailboxes.length} configured {mailboxes.length===1?'repository':'repositories'}</small><button type="button" disabled={busy} onClick={()=>setRevision(value=>value+1)}>Refresh</button></div>
  {busy&&<p role="status">Loading folders…</p>}{mailboxes.length?<MailFolderTree rooted key={scope} nodes={nodes} value={path===undefined&&legacyValue?'':folderKey(selection)} onSelect={key=>select(folderParts(key))} onCreate={async(parent,name)=>{setProposal({parts:[...folderParts(parent),name],fresh:true});}}/>:!busy&&<p>Set up email in a selected project to browse its folders.</p>}
  {mailboxes.length>1&&<small>Dimmed folders aren’t confirmed in every project. Hover for details.</small>}
  {proposal&&<div className="feedback-folder-proposal" role="status"><p>{proposal.fresh?'Create':'Complete'} “{folderPathLabel(proposal.parts)}” in all {mailboxes.length} configured projects?</p><button type="button" disabled={busy} onClick={()=>void createAll()}>Create</button><button type="button" disabled={busy} onClick={()=>setProposal(null)}>Later</button></div>}
  {errors.map(error=><p role="alert" key={error}>{error}</p>)}
 </div>;
}
