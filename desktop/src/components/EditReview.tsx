import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FileEdit } from '../types';
/** Changes are inspected separately; the transcript never expands to contain a diff. */
export function EditReview({edits,onClose}:{edits:FileEdit[];onClose:()=>void}) {
  const [selected,setSelected] = useState(0);
  const [activeChange,setActiveChange]=useState(-1);
  const dialog = useRef<HTMLDivElement>(null);
  const diff=useRef<HTMLPreElement>(null);
  const editsRef=useRef(edits);
  editsRef.current=edits;
  function selectFile(index:number){setSelected(index);setActiveChange(-1);dialog.current?.querySelectorAll<HTMLButtonElement>('nav button')[index]?.focus();}
  function jumpChange(direction:number){
    const lines=edits[selected]?.diff?.split('\n')||[];
    const changes=lines.flatMap((line,index)=>line.startsWith('@@')||((line.startsWith('+')&&!line.startsWith('+++'))||(line.startsWith('-')&&!line.startsWith('---')))?[index]:[]);
    if(!changes.length)return;
    const next=(activeChange+direction+changes.length)%changes.length;
    setActiveChange(next);
    requestAnimationFrame(()=>diff.current?.querySelectorAll<HTMLElement>('[data-edit-line]')[changes[next]]?.scrollIntoView({block:'center'}));
  }
  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    const shell = document.querySelector('.shell'); shell?.setAttribute('inert','');
    dialog.current?.querySelector<HTMLButtonElement>('[aria-label="Close edit review"]')?.focus();
    const key = (event:KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault();event.stopPropagation();setSelected(current=>{const next=(current+(event.key==='ArrowDown'?1:-1)+editsRef.current.length)%editsRef.current.length;requestAnimationFrame(()=>dialog.current?.querySelectorAll<HTMLButtonElement>('nav button')[next]?.focus());return next;});setActiveChange(-1);}
      if (event.key === 'Enter') {event.preventDefault();event.stopPropagation();dialog.current?.dispatchEvent(new CustomEvent('edit-review-jump',{detail:event.shiftKey?-1:1}));}
      if (event.key === 'Tab') {
        const controls = [...dialog.current!.querySelectorAll<HTMLElement>('button, [tabindex="0"]')];
        const index = controls.indexOf(document.activeElement as HTMLElement);
        event.preventDefault(); controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }
    };
    document.addEventListener('keydown',key,true);
    return () => { document.removeEventListener('keydown',key,true); shell?.removeAttribute('inert'); opener?.focus({preventScroll:true}); };
  },[]);
  useEffect(()=>{const element=dialog.current;const jump=(event:Event)=>jumpChange((event as CustomEvent<number>).detail);element?.addEventListener('edit-review-jump',jump);return()=>element?.removeEventListener('edit-review-jump',jump);},[selected,activeChange,edits]);
  const edit = edits[selected];
  const lines=edit.diff?.split('\n')||[];
  const changes=lines.flatMap((line,index)=>line.startsWith('@@')||((line.startsWith('+')&&!line.startsWith('+++'))||(line.startsWith('-')&&!line.startsWith('---')))?[index]:[]);
  return createPortal(<div className="edit-review-overlay" onMouseDown={event => { if(event.target === event.currentTarget) onClose(); }}><div ref={dialog} className="edit-review" role="dialog" aria-modal="true" aria-label="File changes for this response"><header><h2>File changes</h2><span className="edit-review-hint">↑↓ files · Enter/Shift+Enter edits</span><button aria-label="Close edit review" onClick={onClose}>Close · Esc</button></header><div className="edit-review-body"><nav aria-label="Changed files">{edits.map((file,index) => <button key={index} aria-pressed={index===selected} onClick={()=>selectFile(index)}><span className={`edit-kind ${file.kind}`}>{file.kind}</span><span>{file.path}</span></button>)}</nav><section aria-label="File diff"><h3>{edit.path}</h3><p className="diff-legend"><span className="diff-add">+ added</span> <span className="diff-remove">− removed</span></p>{edit.diff ? <pre ref={diff} tabIndex={0}>{lines.map((line,index)=><div key={index} data-edit-line={index} className={`${line.startsWith('@@') ? 'diff-hunk' : line.startsWith('+') && !line.startsWith('+++') ? 'diff-add' : line.startsWith('-') && !line.startsWith('---') ? 'diff-remove' : ''} ${changes[activeChange]===index?'diff-active':''}`}>{line || ' '}</div>)}</pre> : <p>This history records the changed file, but does not include a saved line-by-line diff.</p>}{edit.source === 'workspace' && <p>Observed during this turn; concurrent workspace edits may be included.</p>}</section></div></div></div>, document.body);
}
