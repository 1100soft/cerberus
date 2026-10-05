import { useId, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

export function InfoPopover({label,children}:{label:string;children:ReactNode}){
  const [open,setOpen]=useState(false),[position,setPosition]=useState<CSSProperties>({});
  const trigger=useRef<HTMLButtonElement>(null),content=useRef<HTMLDivElement>(null),id=useId();
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{const rect=trigger.current!.getBoundingClientRect();const zoom=Number.parseFloat(getComputedStyle(document.body).zoom)||1;const width=Math.min(360,innerWidth/zoom-24);const top=Math.max(12,Math.min(rect.top/zoom,innerHeight/zoom-12)),bottom=Math.max(12,Math.min(rect.bottom/zoom,innerHeight/zoom-12));const above=top-18,below=innerHeight/zoom-bottom-18;const useAbove=above>below;const height=Math.max(0,useAbove?above:below);setPosition({width,left:Math.max(12,Math.min(rect.left/zoom,innerWidth/zoom-width-12)),top:useAbove?Math.max(12,top-6-Math.min(content.current?.scrollHeight||height,height)):bottom+6,maxHeight:height});};
    const outside=(event:MouseEvent)=>{if(!trigger.current?.contains(event.target as Node)&&!content.current?.contains(event.target as Node))setOpen(false);};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}};
    place();document.addEventListener('mousedown',outside);document.addEventListener('keydown',key,true);window.addEventListener('resize',place);
    return()=>{document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',key,true);window.removeEventListener('resize',place);};
  },[open]);
  return <><button ref={trigger} type="button" className="info-popover-button" aria-label={label} aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(value=>!value)}><Info size={15}/></button>{open&&createPortal(<div ref={content} id={id} className="info-popover" role="note" aria-label={label} style={position}>{children}</div>,document.body)}</>;
}
