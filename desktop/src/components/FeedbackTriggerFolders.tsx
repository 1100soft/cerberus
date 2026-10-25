import {useEffect,useState,useRef} from 'react';
import {feedback,type MailboxConfig,type MailFolder} from '../lib/feedback';
import type {Repository} from '../types';
import {MailFolderTree} from './MailFolderTree';
import {Select} from './Select';
export function FeedbackTriggerFolders({repositories,value,onChange}:{repositories:Repository[];value:string;onChange:(value:string)=>void}){
 const [repository,setRepository]=useState(repositories[0]?.id||''),[config,setConfig]=useState<MailboxConfig|null>(null),[nodes,setNodes]=useState<MailFolder[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const currentRepository=useRef(repository);currentRepository.current=repository;
 const ids=repositories.map(repo=>repo.id).join(',');
 useEffect(()=>setRepository(current=>repositories.some(repo=>repo.id===current)?current:repositories[0]?.id||''),[ids]);
 useEffect(()=>{let active=true;setConfig(null);setNodes([]);setError('');if(!repository)return;setBusy(true);void feedback.config(repository).then(async config=>{if(!config)throw Error('Configure this repository’s mailbox on the Feedback page.');const nodes=await feedback.setup(repository,config);if(active){setConfig(config);setNodes(nodes);}}).catch(reason=>{if(active)setError(String(reason));}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[repository]);
 return <div className="feedback-trigger-folders" onKeyDown={event=>{if(event.key==='Enter')event.stopPropagation();}}><button type="button" aria-pressed={!value} onClick={()=>onChange('')}>Repository default</button>{repositories.length>0&&<Select label="Browse mailbox" value={repository} options={repositories.map(repo=>({value:repo.id,label:repo.displayName}))} onChange={setRepository}/>}<small>{value||'Uses each repository’s configured feedback folder.'}</small>{busy?<p>Loading folders…</p>:config&&nodes.length>0?<MailFolderTree key={repository} nodes={nodes.map(node=>({...node,selectable:node.selectable&&![config.drafts,config.sent,config.notes,config.metadata].includes(node.path)}))} value={value} onSelect={onChange} onCreate={async(parent,name)=>{const id=repository;const nodes=await feedback.setup(id,config,undefined,parent,name);if(currentRepository.current===id)setNodes(nodes);}}/>:null}{error&&<p role="alert">{error}</p>}</div>;
}
