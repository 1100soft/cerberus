import { Archive, ArchiveRestore, Copy, Share2, Pencil } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type Action = 'rename' | 'archive' | 'copy' | 'share';
export function ConversationContextMenu({x,y,title,archived,canManage=true,onAction,onClose}:{x:number;y:number;title:string;archived:boolean;canManage?:boolean;onAction:(action:Action)=>void;onClose:()=>void}) {
  const menu=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState({left:x,top:y});
  useLayoutEffect(()=>{
    const node=menu.current;if(!node)return;
    const zoom=Number.parseFloat(getComputedStyle(document.body).zoom)||1;
    const rect=node.getBoundingClientRect();
    setPosition({left:Math.max(8,Math.min(x,window.innerWidth-rect.width-8))/zoom,top:Math.max(8,Math.min(y,window.innerHeight-rect.height-8))/zoom});
    node.querySelector<HTMLButtonElement>('button')?.focus();
  },[x,y]);
  useEffect(()=>{
    const outside=(event:MouseEvent)=>{if(!menu.current?.contains(event.target as Node))onClose();};
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();onClose();}
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){
        event.preventDefault();const buttons=[...menu.current?.querySelectorAll('button')||[]];
        const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
      }
    };
    document.addEventListener('mousedown',outside);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',key);};
  },[onClose]);
  const choose=(action:Action)=>{onClose();onAction(action);};
  return <div ref={menu} className="context-menu" role="menu" style={position}><p>{title}</p>
    {canManage && <button role="menuitem" onClick={()=>choose('rename')}><Pencil/>Rename</button>}
    {canManage && <button role="menuitem" onClick={()=>choose('archive')}>{archived?<ArchiveRestore/>:<Archive/>}{archived?'Unarchive':'Archive'}</button>}
    {canManage && <hr/>}
    <button role="menuitem" onClick={()=>choose('share')}><Share2/>Share</button>
    <button role="menuitem" onClick={()=>choose('copy')}><Copy/>Copy conversation</button>
  </div>;
}
