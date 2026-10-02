import { useEffect, useRef, useState } from 'react';
import { Bell, Check, CircleAlert, CirclePlay, X } from 'lucide-react';
import { clearAutomationNotices, markAutomationNoticesRead, useAutomationNotices, type AutomationNotice } from '../lib/automationNotifications';

const icon={started:CirclePlay,completed:Check,failed:CircleAlert,message:Bell};
export function NotificationCenter(){
  const notices=useAutomationNotices();
  const [open,setOpen]=useState(false);
  const [toasts,setToasts]=useState<AutomationNotice[]>([]);
  const seen=useRef(new Set(notices.map(item=>item.id)));
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const fresh=notices.filter(item=>!seen.current.has(item.id));
    for(const item of fresh)seen.current.add(item.id);
    if(fresh.length)setToasts(current=>[...fresh,...current].slice(0,3));
  },[notices]);
  useEffect(()=>{
    if(!toasts.length)return;
    const timer=window.setTimeout(()=>setToasts(current=>current.slice(0,-1)),6000);
    return()=>window.clearTimeout(timer);
  },[toasts]);
  useEffect(()=>{
    if(!open)return;
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
  },[open]);
  const unread=notices.filter(item=>!item.read).length;
  return <div className="notification-center" ref={root}>
    <button className="notification-trigger" type="button" aria-label={`Notifications${unread?` (${unread} unread)`:''}`} aria-expanded={open} onClick={()=>{setOpen(value=>!value);markAutomationNoticesRead();}}><Bell size={17}/>{unread>0&&<span>{unread>99?'99+':unread}</span>}</button>
    {open&&<section className="notification-popover" aria-label="Automation notifications"><header><strong>Notifications</strong>{notices.length>0&&<button type="button" onClick={clearAutomationNotices}>Clear all</button>}</header><div>{notices.length?notices.map(item=>{const Icon=icon[item.status];return <article key={item.id} className={`notification-item ${item.status}`}><Icon size={15}/><div><strong>{item.title}</strong><p>{item.message}</p><small>{new Date(item.createdAt).toLocaleString()}</small></div></article>;}):<p className="panel-copy">No notifications yet.</p>}</div></section>}
    {toasts.length>0&&<div className="notification-toasts" aria-live="polite">{toasts.map(item=>{const Icon=icon[item.status];return <div className={`notification-toast ${item.status}`} key={item.id}><Icon size={16}/><span><strong>{item.title}</strong><small>{item.message}</small></span><button type="button" aria-label="Dismiss notification" onClick={()=>setToasts(current=>current.filter(other=>other.id!==item.id))}><X size={14}/></button></div>;})}</div>}
  </div>;
}
