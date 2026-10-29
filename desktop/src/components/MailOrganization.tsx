import {partsFor,projectFolderPath,planProjectFolderCreate,sameMailAccount} from '../lib/mailFolderOperations';
import {useRef,useState} from 'react';
import {Copy,CopyPlus,Undo2,Redo2,X,FolderPlus} from 'lucide-react';
import type {Repository} from '../types';
import {feedback,type MailboxConfig,type MailFolder,type FolderOperation,type MailRef} from '../lib/feedback';
import {folderMoveTarget} from '../lib/mailDrag';
import {planMailFolderCopy} from '../lib/mailFolderCopy';
import {Select} from './Select';
import {MailMoveDialog} from './MailMoveDialog';
type Project={id:string;label:string;config:MailboxConfig};
type Request={kind:'create'|'delete'|'copyTo'|'copyFrom';parts:string[]};
type Step={project:Project;operations:FolderOperation[]};
type Edit={label:string;steps:Step[]};
type Inspection={project:Project;parts:string[];path:string;reference:MailRef;count:number;remaining:Project[]};
export function useMailOrganization({projects,projectId,config,nodes,onRefresh,onInspect}:{projects:Repository[];projectId:string;config:MailboxConfig|null;nodes:MailFolder[];onRefresh:()=>void;onInspect:(project:string,path:string)=>void}){
 const [request,setRequest]=useState<Request|null>(null),[available,setAvailable]=useState<Project[]>([]),[mode,setMode]=useState('this'),[selected,setSelected]=useState<string[]>([]),[source,setSource]=useState(''),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[inspection,setInspection]=useState<Inspection|null>(null),[movingAll,setMovingAll]=useState(false);
 const history=useRef<{undo:Edit[];redo:Edit[]}>({undo:[],redo:[]}),locked=useRef(false);const [,renderHistory]=useState(0),openGeneration=useRef(0);
 const notify=(id:string)=>window.dispatchEvent(new CustomEvent('feedback-mail-changed',{detail:id}));
 const record=(label:string,steps:Step[])=>{if(steps.length){history.current.undo.push({label,steps:[...steps].reverse()});history.current.undo=history.current.undo.slice(-50);history.current.redo=[];renderHistory(v=>v+1);}};
 const execute=async(project:Project,operations:FolderOperation[])=>{
  const current=await feedback.config(project.id);if(!current?.enabled)throw Error(`${project.label}: mailbox is no longer configured.`);if(!sameMailAccount(current,project.config))throw Error(`${project.label}: mailbox account changed. Reopen this action before continuing.`);
  const result=await feedback.batch(project.id,current,'',operations);notify(project.id);
  return {result,inverse:{project,operations:[...result.changes].reverse().map(change=>change.inverse)}};
 };
 const refresh=()=>{onRefresh();renderHistory(v=>v+1);};
 const run=async(action:()=>Promise<void>)=>{if(locked.current)throw Error('A folder operation is already running.');locked.current=true;setBusy(true);setError('');try{await action();}catch(reason){setError(String(reason));throw reason;}finally{locked.current=false;setBusy(false);refresh();}};
 const open=async(kind:Request['kind'],path='')=>{
  if(busy)return;const generation=++openGeneration.current;setRequest({kind,parts:partsFor(path,nodes)});setMode(kind==='copyTo'?'all':'this');setSelected([projectId]);setName('');setError('');setStatus('');setBusy(true);setAvailable([]);
  const found:Project[]=[],errors:string[]=[];
  await Promise.all(projects.filter(p=>p.localPath).map(async p=>{try{const c=p.id===projectId?config:await feedback.config(p.id);if(c?.enabled)found.push({id:p.id,label:p.displayName,config:c});}catch(reason){errors.push(`${p.displayName}: ${String(reason)}`);}}));
  if(generation!==openGeneration.current)return;
  found.sort((a,b)=>projects.findIndex(p=>p.id===a.id)-projects.findIndex(p=>p.id===b.id));setAvailable(found);setSource(found.find(p=>p.id!==projectId)?.id||'');setError(errors.join('\n'));setBusy(false);
 };
 const applyDeletion=async(targets:Project[],parts:string[])=>{
  const inverses:Step[]=[],errors:string[]=[];
  try{for(let i=0;i<targets.length;i++){
   const project=targets[i];setStatus(`Checking ${project.label}…`);
   try{
    const current=await feedback.config(project.id);if(!current?.enabled)throw Error('Mailbox is no longer configured.');if(!sameMailAccount(current,project.config))throw Error('Mailbox account changed. Reopen this action before continuing.');
    const tree=await feedback.setup(project.id,current,undefined,undefined,undefined,true),path=projectFolderPath(parts,tree),node=tree.find(n=>n.path===path);if(!node)continue;
    if(path.toUpperCase()==='INBOX'||[current.drafts,current.sent,current.notes,current.metadata].some(p=>p===path||node.delimiter&&p.startsWith(path+node.delimiter)))throw Error('Reassign configured folders before deleting this folder.');
    if(node.selectable){const check=await feedback.request<{count:number;validity:number}>(project.id,{action:'folderStatus',folder:path});
     if(!Number.isSafeInteger(check.count)||check.count<0||!Number.isSafeInteger(check.validity)||check.validity<1)throw Error('Cannot verify the folder contents.');
     if(check.count>0){setInspection({project,parts,path,reference:{folder:path,validity:check.validity,uid:0,messageId:''},count:check.count,remaining:targets.slice(i+1)});setRequest(null);setStatus('');if(errors.length)setError(errors.join('\n'));onInspect(project.id,path);return;}
    }
    const {result,inverse}=await execute(project,[{operation:'delete',parent:path}]);if(inverse.operations.length)inverses.push(inverse);if(result.error)throw Error(result.error);if(project.id===projectId)onInspect(project.id,'INBOX');
   }catch(reason){errors.push(`${project.label}: ${String(reason)}`);}
  }
  setInspection(null);setStatus('Folder deletion finished.');if(errors.length)throw Error(errors.join('\n'));setRequest(null);
  }finally{record('Delete folders',inverses);}
 };
 const targets=available.filter(p=>request?.kind==='copyFrom'?p.id===projectId:mode==='this'?p.id===projectId:mode==='all'?request?.kind==='copyTo'?p.id!==projectId:true:selected.includes(p.id));
 const submit=async()=>{if(!request)return;const job=request;await run(async()=>{
  if(job.kind==='delete'){await applyDeletion(targets,job.parts);return;}
  const inverses:Step[]=[],errors:string[]=[];
  try{
   const origin=job.kind==='copyFrom'?available.find(p=>p.id===source):available.find(p=>p.id===projectId);
   const sourceNodes=job.kind.startsWith('copy')&&origin?await feedback.setup(origin.id,origin.config):[];
   for(const project of targets){try{setStatus(`${project.label}…`);const current=await feedback.config(project.id);if(!current?.enabled)throw Error('Mailbox is no longer configured.');if(!sameMailAccount(current,project.config))throw Error('Mailbox account changed. Reopen this action before continuing.');const tree=await feedback.setup(project.id,current);
    let operations:FolderOperation[];
    if(job.kind==='create'){
     // Create missing ancestors in a single batch, translating each project's delimiter.
     operations=planProjectFolderCreate([...job.parts,name.trim()],tree,current);
    }else{if(!origin)throw Error('Choose a source project.');operations=planMailFolderCopy(origin.config,sourceNodes,tree,false).operations;}
    if(operations.length){const {result,inverse}=await execute(project,operations);if(inverse.operations.length)inverses.push(inverse);if(result.error)throw Error(result.error);if(job.kind==='create'&&project.id===projectId){const created=result.changes.filter(change=>change.forward.operation==='create').at(-1)?.inverse.parent;if(created)onInspect(project.id,created);}}else if(job.kind==='create'&&project.id===projectId){const last=[...job.parts,name.trim()];if(last.length===1&&current.provider==='proton'&&tree.some(n=>n.path==='Folders'))last.unshift('Folders');onInspect(project.id,projectFolderPath(last,tree));}
   }catch(reason){errors.push(`${project.label}: ${String(reason)}`);}}
  }finally{record(job.kind==='create'?'Create folders':'Copy folder structure',inverses);}
  if(errors.length)throw Error(errors.join('\n'));setStatus(job.kind==='create'?'Folders created.':'Folder structure copied.');setRequest(null);
 });};
 const edit=async(path:string,operation:'rename'|'move',value:string)=>run(async()=>{
  if(!config)throw Error('Mailbox is not configured.');const node=nodes.find(n=>n.path===path);
  if([config.drafts,config.sent,config.notes,config.metadata].some(p=>p===path||node?.delimiter&&p.startsWith(path+node.delimiter)))throw Error('Reassign configured folders in Email settings before moving or renaming them.');
  if(operation==='move'&&!folderMoveTarget(nodes,path,value))throw Error('Choose a different parent outside this folder and its descendants.');
  const project={id:projectId,label:projects.find(p=>p.id===projectId)?.displayName||projectId,config};const {result,inverse}=await execute(project,[{operation,parent:path,name:value}]);record(operation==='move'?'Move folder':'Rename folder',inverse.operations.length?[inverse]:[]);if(result.error)throw Error(result.error);
  const parent=node?.delimiter&&path.includes(node.delimiter)?path.slice(0,path.lastIndexOf(node.delimiter)):'';
  const destination=operation==='move'?folderMoveTarget(nodes,path,value)!:parent+ (parent?node!.delimiter:'')+value;
  onInspect(projectId,destination);setStatus('Folder updated. Existing automation rules and saved email references keep their previous paths.');
 });
 const replay=async(direction:'undo'|'redo')=>run(async()=>{
  const entry=history.current[direction].pop();if(!entry)return;const inverse:Step[]=[],remaining:Step[]=[];const errors:string[]=[];
  for(const step of entry.steps){try{const next=await execute(step.project,step.operations);if(next.inverse.operations.length)inverse.unshift(next.inverse);if(next.result.error){remaining.push({...step,operations:step.operations.slice(next.result.processed)});errors.push(`${step.project.label}: ${next.result.error}`);}}catch(reason){remaining.push(step);errors.push(String(reason));}}
  if(remaining.length)history.current[direction].push({...entry,steps:remaining});if(inverse.length)history.current[direction==='undo'?'redo':'undo'].push({...entry,steps:inverse});
  setStatus(`${direction==='undo'?'Undid':'Redid'}: ${entry.label}`);if(errors.length)throw Error(errors.join('\n'));
 });
 const inspectAgain=()=>{if(!inspection)return;void run(()=>applyDeletion([inspection.project,...inspection.remaining],inspection.parts)).catch(()=>{});};
 const keepFolder=()=>{if(!inspection)return;const next=inspection;setInspection(null);void run(()=>applyDeletion(next.remaining,next.parts)).catch(()=>{});};
 const close=()=>{openGeneration.current++;setRequest(null);};
 const controls=<><button type="button" aria-label="New email folder" title="New folder" disabled={busy||!config} onClick={()=>void open('create')}><FolderPlus size={16}/></button><button type="button" aria-label="Copy folder structure to projects" title="Copy folder structure to projects" disabled={busy||!config} onClick={()=>void open('copyTo')}><CopyPlus size={16}/></button><button type="button" aria-label="Copy folder structure from project" title="Copy folder structure from project" disabled={busy||!config} onClick={()=>void open('copyFrom')}><Copy size={16}/></button><button type="button" aria-label="Undo email folder action" title="Undo folder action" disabled={busy||!history.current.undo.length} onClick={()=>void replay('undo').catch(()=>{})}><Undo2 size={16}/></button><button type="button" aria-label="Redo email folder action" title="Redo folder action" disabled={busy||!history.current.redo.length} onClick={()=>void replay('redo').catch(()=>{})}><Redo2 size={16}/></button></>;
 const dialogs=<>{request&&<div className="automation-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)close();}}><section className="automation-dialog mail-organize-dialog" role="dialog" aria-modal="true" aria-label={request.kind==='create'?'Create email folder':request.kind==='delete'?'Delete email folder':'Copy email folders'} onKeyDown={event=>{if(event.key==='Escape'&&!busy){event.stopPropagation();close();}}}><header><h2>{request.kind==='create'?'New folder':request.kind==='delete'?'Delete folder':'Copy folder structure'}</h2><button type="button" disabled={busy} aria-label="Close folder organization" onClick={close}><X size={16}/></button></header><div className="automation-dialog-content">{request.kind==='create'?<label>Folder name<input aria-label="Email folder name" autoFocus value={name} disabled={busy} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&name.trim()&&targets.length){e.preventDefault();void submit().catch(()=>{});}}}/></label>:request.kind==='delete'?<p>{request.parts.join(' / ')}</p>:<p>Creates missing folders. Emails, account settings and assigned folder purposes stay unchanged.</p>}{request.kind==='copyFrom'?(available.some(p=>p.id!==projectId)?<Select label="Source email project" value={source} disabled={busy} onChange={setSource} options={available.filter(p=>p.id!==projectId).map(p=>({value:p.id,label:p.label}))}/>:<p>No other configured projects.</p>):<><Select label="Target email projects" disabled={busy} value={mode} onChange={setMode} options={[...(request.kind==='copyTo'?[]:[{value:'this',label:'Only this project'}]),{value:'all',label:request.kind==='copyTo'?'All other projects':'All projects'},{value:'custom',label:'Choose projects'}]}/>{mode==='custom'&&<div className="mail-project-targets">{available.filter(p=>request.kind!=='copyTo'||p.id!==projectId).map(p=><label key={p.id}><input type="checkbox" disabled={busy} checked={selected.includes(p.id)} onChange={e=>setSelected(current=>e.target.checked?[...current,p.id]:current.filter(id=>id!==p.id))}/>{p.label}</label>)}</div>}<small>{targets.length} configured {targets.length===1?'project':'projects'}</small></>}</div><footer><div aria-live="polite">{error&&<p className="config-error" role="alert">{error}</p>}{busy&&<p role="status">{status||'Loading projects…'}</p>}</div><button type="button" disabled={busy||!targets.length||request.kind==='create'&&!name.trim()||request.kind==='copyFrom'&&!source} onClick={()=>void submit().catch(()=>{})}>{request.kind==='create'?'Create':request.kind==='delete'?'Delete':'Copy'}</button></footer></section></div>}{movingAll&&inspection&&<MailMoveDialog title="Move folder emails" nodes={nodes.filter(n=>n.selectable&&n.path!==inspection.path&&n.path!==config?.metadata)} onClose={()=>setMovingAll(false)} onMove={async destination=>{const current=inspection;if(projectId!==current.project.id)throw Error('Open the inspected project first.');await run(async()=>{const latest=await feedback.config(current.project.id);if(!latest||!sameMailAccount(latest,current.project.config))throw Error('Mailbox account changed. Inspect this folder again before moving email.');await feedback.request(current.project.id,{action:'moveAll',folder:current.path,message:current.reference,destination});notify(current.project.id);setMovingAll(false);await applyDeletion([current.project,...current.remaining],current.parts);});}}/>}</>;
 const notices=<>{!request&&error&&<p role="alert" className="config-error">{error}</p>}{!request&&!inspection&&status&&<p role="status">{status}</p>}{inspection&&<div className="mail-folder-inspection" role="status"><span>{inspection.project.label} · {inspection.path}: {inspection.count} emails. Move them before deleting this folder, or keep it.</span><button type="button" disabled={busy||projectId!==inspection.project.id} onClick={()=>setMovingAll(true)}>Move emails</button><button type="button" disabled={busy} onClick={inspectAgain}>Retry deletion</button><button type="button" disabled={busy} onClick={keepFolder}>Keep folder</button></div>}</>;
 const onKeyDown=(event:React.KeyboardEvent)=>{if(busy||(event.target as HTMLElement).closest('input,textarea,[contenteditable=true],[role=dialog]')||!event.ctrlKey&&!event.metaKey)return;const key=event.key.toLowerCase();if(key!=='z'&&key!=='y')return;const direction=key==='y'||event.shiftKey?'redo':'undo';if(!history.current[direction].length)return;event.preventDefault();event.stopPropagation();void replay(direction).catch(()=>{});};
 return {controls,dialogs,notices,busy,onKeyDown,create:(parent:string)=>open('create',parent),remove:(path:string)=>open('delete',path),rename:(path:string,name:string)=>edit(path,'rename',name),move:(path:string,parent:string)=>edit(path,'move',parent)};
}
