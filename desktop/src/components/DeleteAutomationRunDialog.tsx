import { useState } from 'react';
import { X } from 'lucide-react';
import type { AutomationLog } from '../lib/api';
import { deleteAutomationRun } from '../lib/savedPrompts';
export function DeleteAutomationRunDialog({entry,onClose,onDeleted}:{entry:AutomationLog;onClose:()=>void;onDeleted?:()=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const remove=async()=>{setBusy(true);setError('');try{await deleteAutomationRun(entry);onDeleted?.();onClose();}catch(reason){setError(String(reason));setBusy(false);}};
  return <div className="automation-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}><section className="automation-dialog automation-condition-dialog" role="dialog" aria-modal="true" aria-label="Delete saved automation run" onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!busy)onClose();}}><header><h2>Delete saved run?</h2><button type="button" aria-label="Cancel deleting run" disabled={busy} onClick={onClose}><X size={17}/></button></header><div className="automation-dialog-content"><p>{[entry.branch,entry.commitSha?.slice(0,8),entry.handoffName,new Date(entry.createdAt).toLocaleString()].filter(Boolean).join(' · ')}</p><p>This permanently removes this run entry, its saved output, and its automation retry action. Conversation history and handoff payloads are kept separately. Dirty worktrees and unique commits remain protected.</p>{error&&<p role="alert" className="config-error">{error}</p>}</div><footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" disabled={busy} onClick={()=>void remove()}>{busy?'Deleting…':'Delete run and log'}</button></footer></section></div>;
}
