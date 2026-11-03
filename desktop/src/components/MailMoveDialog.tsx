import {useState} from 'react';
import {X} from 'lucide-react';
import type {MailFolder} from '../lib/feedback';
import {MailFolderTree} from './MailFolderTree';
export function MailMoveDialog({title,nodes,root=false,onMove,onClose}:{title:string;nodes:MailFolder[];root?:boolean;onMove:(path:string)=>Promise<void>;onClose:()=>void}){
 const [target,setTarget]=useState(root?'':nodes.find(n=>n.selectable)?.path||''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const move=async()=>{setBusy(true);setError('');try{await onMove(target);onClose();}catch(reason){setError(String(reason));}finally{setBusy(false);}};
 return <div className="automation-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}><section className="automation-dialog mail-organize-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event=>{if(event.key==='Escape'&&!busy){event.stopPropagation();onClose();}}}><header><h2>{title}</h2><button type="button" aria-label="Close move" disabled={busy} onClick={onClose}><X size={16}/></button></header><div className="automation-dialog-content">{root&&<button type="button" aria-pressed={target===''} onClick={()=>setTarget('')}>Mailbox</button>}<MailFolderTree nodes={nodes} value={target} readOnly disabled={busy} onSelect={setTarget} onCreate={async()=>{}}/></div><footer>{error&&<p role="alert">{error}</p>}<button type="button" disabled={busy||(!root&&!nodes.some(n=>n.selectable&&n.path===target))} onClick={()=>void move()}>Move</button></footer></section></div>;
}
