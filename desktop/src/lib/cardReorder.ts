import { useState, type DragEvent, type KeyboardEvent } from 'react';

type Position='before'|'after';
export function reorderIds(ids:string[],source:string,target:string,position:Position):string[]{
  if(source===target||!ids.includes(source)||!ids.includes(target))return ids;
  const next=ids.filter(id=>id!==source);
  next.splice(next.indexOf(target)+(position==='after'?1:0),0,source);
  return next;
}

export function useCardReorder(ids:string[],onReorder:(ids:string[])=>void,enabled=true){
  const [dragged,setDragged]=useState<string>();
  const [target,setTarget]=useState<{id:string;position:Position}>();
  const clear=()=>{setDragged(undefined);setTarget(undefined);};
  const source=(id:string,label:string)=>({
    draggable:enabled,
    onDragStart:(event:DragEvent<HTMLElement>)=>{
      if(!enabled)return;
      event.stopPropagation();event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',id);
      const preview=document.createElement('div');preview.className='card-drag-preview';preview.textContent=label;
      document.body.append(preview);event.dataTransfer.setDragImage(preview,16,16);
      window.setTimeout(()=>preview.remove(),0);setDragged(id);
    },
    onDragEnd:clear,
  });
  const handle=(id:string,label:string)=>({
    ...source(id,label),
    onKeyDown:(event:KeyboardEvent<HTMLElement>)=>{
      if(!enabled||!['ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();
      const index=ids.indexOf(id),other=ids[index+(event.key==='ArrowUp'?-1:1)];
      if(other)onReorder(reorderIds(ids,id,other,event.key==='ArrowUp'?'before':'after'));
    },
  });
  const item=(id:string)=>({
    className:[dragged===id?'card-dragging':'',target?.id===id?`card-drop-${target.position}`:''].filter(Boolean).join(' '),
    onDragOver:(event:DragEvent<HTMLElement>)=>{
      if(!enabled||!dragged||dragged===id)return;
      event.preventDefault();event.dataTransfer.dropEffect='move';
      const bounds=event.currentTarget.getBoundingClientRect();
      const position=event.clientY<bounds.top+bounds.height/2?'before':'after';
      if(target?.id!==id||target.position!==position)setTarget({id,position});
    },
    onDragLeave:(event:DragEvent<HTMLElement>)=>{
      const next=event.relatedTarget;
      if(!(next instanceof Node)||!event.currentTarget.contains(next))setTarget(current=>current?.id===id?undefined:current);
    },
    onDrop:(event:DragEvent<HTMLElement>)=>{
      if(!enabled||!dragged||dragged===id){clear();return;}
      event.preventDefault();event.stopPropagation();
      const bounds=event.currentTarget.getBoundingClientRect();
      const position=event.clientY<bounds.top+bounds.height/2?'before':'after';
      onReorder(reorderIds(ids,dragged,id,position));clear();
    },
  });
  return {source,handle,item,clear};
}
