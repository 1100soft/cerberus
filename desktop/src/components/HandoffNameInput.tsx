import {createPortal} from 'react-dom';
import { useRef, useState, useLayoutEffect, useId, type CSSProperties, type KeyboardEvent } from 'react';

type Props={disabled?:boolean;portal?:boolean;value:string;onChange:(value:string)=>void;names:string[];multiple?:boolean;label:string;placeholder?:string;maxLength?:number;onChoose?:(value:string)=>void;showAllOnFocus?:boolean;conditional?:boolean};
export function SuggestedTextInput({value,onChange,names,multiple=false,label,placeholder,maxLength,showAllOnFocus=false,onChoose,conditional=false,disabled=false,portal=false}:Props){
  const id=useId(),[position,setPosition]=useState<CSSProperties>({});
  const input=useRef<HTMLInputElement>(null);
  const blurTimer=useRef<number|undefined>(undefined);
  const [open,setOpen]=useState(false);
  const [active,setActive]=useState(0);
  const [filterOnInput,setFilterOnInput]=useState(false);
  const start=multiple?Math.max(value.lastIndexOf(','),value.lastIndexOf(' '),value.lastIndexOf('\n'))+1:0;
  const end=value.length;
  const token=value.slice(start).trim().toLowerCase();
  const query=showAllOnFocus&&!filterOnInput?'':conditional?token.replace(/^\(|\)$/g,''):token;
  const selected=multiple?new Set(value.split(/[,\s]+/).map(name=>conditional?name.toLowerCase().replace(/^\(|\)$/g,''):name.toLowerCase())):new Set<string>();
  const suggestions=names.filter(name=>name.toLowerCase().includes(query)&&(!multiple||!selected.has(name)||name===value.slice(start,end).trim().toLowerCase())).slice(0,12);
  useLayoutEffect(()=>{if(!portal||!open||!input.current)return;const rect=input.current.getBoundingClientRect(),zoom=parseFloat(getComputedStyle(document.body).zoom)||1,width=Math.min(Math.max(rect.width/zoom,200),innerWidth/zoom-16),below=(innerHeight-rect.bottom)/zoom-8,above=rect.top/zoom-8,up=below<180&&above>below;
   setPosition({position:'fixed',left:Math.max(8,Math.min(rect.left/zoom,innerWidth/zoom-width-8)),right:'auto',width,...(up?{top:'auto',bottom:(innerHeight-rect.top)/zoom+4}:{top:rect.bottom/zoom+4,bottom:'auto'}),maxHeight:Math.max(40,Math.min(180,up?above:below)),zIndex:120});
  },[portal,open,value,names.join('\0')]);
  const choose=(name:string)=>{
    if(conditional&&value.slice(start).trim().startsWith('('))name=`(${name})`;
    if(multiple){const prefix=value.slice(0,start).replace(/\s+$/,'');const suffix=value.slice(end).replace(/^\s+/,'');const next=`${prefix}${prefix&&!prefix.endsWith(',')?', ':prefix?' ':''}${name}${suffix?`, ${suffix.replace(/^,\s*/,'')}`:''}`;onChange(next);requestAnimationFrame(()=>{input.current?.focus();input.current?.setSelectionRange(next.length,next.length);});}
    else (onChoose||onChange)(name);
    setOpen(false);
  };
  const keyDown=(event:KeyboardEvent<HTMLInputElement>)=>{
    if(!open||!suggestions.length)return;
    if(event.key==='ArrowDown'){event.preventDefault();setActive(index=>(index+1)%suggestions.length);}
    else if(event.key==='ArrowUp'){event.preventDefault();setActive(index=>(index-1+suggestions.length)%suggestions.length);}
    else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();choose(suggestions[Math.min(active,suggestions.length-1)]);}
    else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);}
  };
  const menu=open&&suggestions.length>0&&!disabled?<div id={id} style={portal?position:undefined} className="handoff-name-suggestions" role="listbox" aria-label={`${label} suggestions`}>{suggestions.map((name,index)=><button type="button" role="option" aria-selected={active===index} key={name} className={active===index?'active':''} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(name)}>{name}</button>)}</div>:null;
  return <span className={`handoff-name-input ${multiple?'handoff-name-multiple':''}`}>
    <input ref={input} disabled={disabled} aria-controls={open&&suggestions.length?id:undefined} aria-label={label} role="combobox" aria-autocomplete="list" aria-expanded={!disabled&&open&&suggestions.length>0} value={value} placeholder={placeholder} maxLength={maxLength??(multiple?500:64)} onFocus={()=>{window.clearTimeout(blurTimer.current);setActive(0);setFilterOnInput(false);setOpen(true);}} onChange={event=>{onChange(event.currentTarget.value);setActive(0);setFilterOnInput(true);setOpen(true);}} onKeyDown={keyDown} onBlur={()=>{blurTimer.current=window.setTimeout(()=>setOpen(false),120);}}/>
    {portal&&menu?createPortal(menu,document.body):menu}
  </span>;
}
export const HandoffNameInput=SuggestedTextInput;
