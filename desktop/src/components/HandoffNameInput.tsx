import { useRef, useState, type KeyboardEvent } from 'react';

type Props={value:string;onChange:(value:string)=>void;names:string[];multiple?:boolean;label:string;placeholder?:string;maxLength?:number;onChoose?:(value:string)=>void;showAllOnFocus?:boolean};
export function SuggestedTextInput({value,onChange,names,multiple=false,label,placeholder,maxLength,showAllOnFocus=false,onChoose}:Props){
  const input=useRef<HTMLInputElement>(null);
  const blurTimer=useRef<number|undefined>(undefined);
  const [open,setOpen]=useState(false);
  const [active,setActive]=useState(0);
  const [filterOnInput,setFilterOnInput]=useState(false);
  const start=multiple?Math.max(value.lastIndexOf(','),value.lastIndexOf(' '),value.lastIndexOf('\n'))+1:0;
  const end=value.length;
  const query=showAllOnFocus&&!filterOnInput?'':value.slice(start).trim().toLowerCase();
  const selected=multiple?new Set(value.split(/[,\s]+/).map(name=>name.toLowerCase())):new Set<string>();
  const suggestions=names.filter(name=>name.toLowerCase().includes(query)&&(!multiple||!selected.has(name)||name===value.slice(start,end).trim().toLowerCase())).slice(0,12);
  const choose=(name:string)=>{
    if(multiple){const prefix=value.slice(0,start).replace(/\s+$/,'');const suffix=value.slice(end).replace(/^\s+/,'');const next=`${prefix}${prefix&&!prefix.endsWith(',')?', ':prefix?' ':''}${name}${suffix?`, ${suffix.replace(/^,\s*/,'')}`:''}`;onChange(next);requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(next.length,next.length);});}
    else (onChoose||onChange)(name);
    setOpen(false);
  };
  const keyDown=(event:KeyboardEvent<HTMLInputElement>)=>{
    if(!open||!suggestions.length)return;
    if(event.key==='ArrowDown'){event.preventDefault();setActive(index=>(index+1)%suggestions.length);}
    else if(event.key==='ArrowUp'){event.preventDefault();setActive(index=>(index-1+suggestions.length)%suggestions.length);}
    else if(event.key==='Enter'){event.preventDefault();choose(suggestions[Math.min(active,suggestions.length-1)]);}
    else if(event.key==='Escape'){event.preventDefault();setOpen(false);}
  };
  return <span className={`handoff-name-input ${multiple?'handoff-name-multiple':''}`}>
    <input ref={input} aria-label={label} role="combobox" aria-autocomplete="list" aria-expanded={open&&suggestions.length>0} value={value} placeholder={placeholder} maxLength={maxLength??(multiple?500:64)} onFocus={()=>{window.clearTimeout(blurTimer.current);setActive(0);setFilterOnInput(false);setOpen(true);}} onChange={event=>{onChange(event.currentTarget.value);setActive(0);setFilterOnInput(true);setOpen(true);}} onKeyDown={keyDown} onBlur={()=>{blurTimer.current=window.setTimeout(()=>setOpen(false),120);}}/>
    {open&&suggestions.length>0&&<div className="handoff-name-suggestions" role="listbox" aria-label={`${label} suggestions`}>{suggestions.map((name,index)=><button type="button" role="option" aria-selected={active===index} key={name} className={active===index?'active':''} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(name)}>{name}</button>)}</div>}
  </span>;
}
export const HandoffNameInput=SuggestedTextInput;
