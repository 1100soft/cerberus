import { useId, useLayoutEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

export function InfoPopover({label,children}:{label:string;children:ReactNode}){
  const [open,setOpen]=useState(false),[position,setPosition]=useState<CSSProperties>({});
  const trigger=useRef<HTMLButtonElement>(null),content=useRef<HTMLDivElement>(null),id=useId();
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{const rect=trigger.current!.getBoundingClientRect();const zoom=Number.parseFloat(getComputedStyle(document.body).zoom)||1;const width=Math.min(360,innerWidth/zoom-24);const below=(innerHeight-rect.bottom)/zoom;setPosition({width,left:Math.max(12,Math.min(rect.left/zoom,innerWidth/zoom-width-12)),...(below<220?{bottom:(innerHeight-rect.top)/zoom+6}:{top:rect.bottom/zoom+6}),maxHeight:Math.max(80,(below<220?rect.top/zoom:below)-18)});};
    const outside=(event:MouseEvent)=>{if(!trigger.current?.contains(event.target as Node)&&!content.current?.contains(event.target as Node))setOpen(false);};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}};
    place();document.addEventListener('mousedown',outside);document.addEventListener('keydown',key,true);window.addEventListener('resize',place);
    return()=>{document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',key,true);window.removeEventListener('resize',place);};
  },[open]);
  return <><button ref={trigger} type="button" className="info-popover-button" aria-label={label} aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(value=>!value)}><Info size={15}/></button>{open&&createPortal(<div ref={content} id={id} className="info-popover" role="note" aria-label={label} style={position}>{children}</div>,document.body)}</>;
}
