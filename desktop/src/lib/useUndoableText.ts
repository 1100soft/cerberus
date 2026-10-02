import { useRef, useState, type KeyboardEvent } from 'react';

/** Keep programmatic replacements in the same undo stack as typing. */
export function useUndoableText(initial=''){
  const [value,setValue]=useState(initial);
  const current=useRef(initial);
  const history=useRef([initial]);
  const index=useRef(0);
  const lastInput=useRef(0);
  const lastKind=useRef<'input'|'set'|''>('');
  const update=(next:string,kind:'input'|'set')=>{
    if(next===current.current)return;
    const now=Date.now();
    if(kind==='input'&&lastKind.current==='input'&&now-lastInput.current<600&&index.current>0){
      history.current[index.current]=next;
    }else{
      history.current=history.current.slice(0,index.current+1);
      history.current.push(next);
      index.current++;
    }
    current.current=next;lastKind.current=kind;lastInput.current=now;setValue(next);
  };
  const reset=(next='')=>{history.current=[next];index.current=0;current.current=next;lastKind.current='';setValue(next);};
  const keyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{
    if(!(event.ctrlKey||event.metaKey)||event.altKey)return false;
    const undo=event.key.toLowerCase()==='z'&&!event.shiftKey;
    const redo=event.key.toLowerCase()==='y'||(event.key.toLowerCase()==='z'&&event.shiftKey);
    if(!undo&&!redo)return false;
    event.preventDefault();
    const next=Math.max(0,Math.min(history.current.length-1,index.current+(undo?-1:1)));
    index.current=next;current.current=history.current[next];lastKind.current='';setValue(current.current);
    return true;
  };
  return {value,set:(next:string)=>update(next,'set'),input:(next:string)=>update(next,'input'),reset,keyDown};
}
