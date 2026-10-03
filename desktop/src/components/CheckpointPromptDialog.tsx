import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { defaultCheckpointCommitPrompt, readCheckpointCommitPrompt, saveCheckpointCommitPrompt } from '../lib/checkpointPrompt';

export function CheckpointPromptDialog({onClose}:{onClose:()=>void}){
  const [draft,setDraft]=useState(readCheckpointCommitPrompt);
  const [error,setError]=useState('');
  const field=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{field.current?.focus();},[]);
  const save=()=>{try{saveCheckpointCommitPrompt(draft);onClose();}catch(cause){setError(String(cause));}};
  return createPortal(<div className="automation-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="automation-dialog checkpoint-prompt-dialog" role="dialog" aria-modal="true" aria-label="Edit checkpoint commit prompt" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose();}}}>
    <header><h2>Checkpoint commit prompt</h2><button type="button" aria-label="Close checkpoint prompt editor" onClick={onClose}><X size={17}/></button></header>
    <div className="automation-dialog-content"><textarea ref={field} aria-label="Checkpoint commit prompt" value={draft} onChange={event=>{setDraft(event.target.value);setError('');}} spellCheck={false}/></div>
    <footer>{error&&<p className="automation-validation-hint" role="alert">{error}</p>}<button type="button" onClick={()=>{setDraft(defaultCheckpointCommitPrompt);setError('');field.current?.focus();}}>Restore default</button><button type="button" className="automation-primary-action" disabled={!draft.trim()} onClick={save}>Save</button></footer>
  </section></div>,document.body);
}
