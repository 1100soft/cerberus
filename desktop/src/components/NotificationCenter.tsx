import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, Check, CircleAlert, CirclePlay, X } from 'lucide-react';
import { clearAutomationNotices, markAutomationNoticesRead, useAutomationNotices, type AutomationNotice } from '../lib/automationNotifications';

import { disableAutomation, savedPrompts, subscribeSavedPrompts } from '../lib/savedPrompts';
import type { Repository } from '../types';
const AutomationLogDialog=lazy(()=>import('./AutomationLogDialog').then(module=>({default:module.AutomationLogDialog})));

const icon={started:CirclePlay,completed:Check,failed:CircleAlert,message:Bell};
export function NotificationCenter({repositories}:{repositories:Repository[]}){
  const jobs=useSyncExternalStore(subscribeSavedPrompts,savedPrompts);
  const [logNotice,setLogNotice]=useState<AutomationNotice|null>(null);
  const [actionError,setActionError]=useState('');
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
  const logJob=jobs.find(job=>job.id===logNotice?.automationId);
  function actions(item:AutomationNotice){
    const job=jobs.find(job=>job.id===item.automationId);
    if(item.status!=='failed'||!job)return null;
    return <div className="notification-actions"><button type="button" onClick={()=>{window.dispatchEvent(new Event('automation-log-opened'));setLogNotice(item);setOpen(false);setToasts(current=>current.filter(other=>other.id!==item.id));}}>Open log</button><button type="button" disabled={!job.enabled} onClick={()=>{try{disableAutomation(job.id);setActionError('');}catch(error){setActionError(String(error));}}}>{job.enabled?'Disable automation':'Automation disabled'}</button></div>;
  }
  const unread=notices.filter(item=>!item.read).length;
  return <div className="notification-center" ref={root}>
    <button className="notification-trigger" type="button" aria-label={`Notifications${unread?` (${unread} unread)`:''}`} aria-expanded={open} onClick={()=>{setOpen(value=>!value);markAutomationNoticesRead();}}><Bell size={17}/>{unread>0&&<span>{unread>99?'99+':unread}</span>}</button>
    {open&&<section className="notification-popover" aria-label="Automation notifications"><header><strong>Notifications</strong>{notices.length>0&&<button type="button" onClick={clearAutomationNotices}>Clear all</button>}</header><div>{notices.length?notices.map(item=>{const Icon=icon[item.status];return <article key={item.id} className={`notification-item ${item.status}`}><Icon size={15}/><div><strong>{item.title}</strong><p>{item.message}</p><small>{new Date(item.createdAt).toLocaleString()}</small>{actions(item)}</div></article>;}):<p className="panel-copy">No notifications yet.</p>}</div></section>}
    {toasts.length>0&&<div className="notification-toasts" aria-live="polite">{toasts.map(item=>{const Icon=icon[item.status];return <div className={`notification-toast ${item.status}`} key={item.id}><Icon size={16}/><div className="notification-text"><strong>{item.title}</strong><small>{item.message}</small>{actions(item)}</div><button type="button" aria-label="Dismiss notification" onClick={()=>setToasts(current=>current.filter(other=>other.id!==item.id))}><X size={14}/></button></div>;})}</div>}
    {actionError&&<p role="alert">{actionError}</p>}
    {logNotice&&logJob&&<Suspense fallback={<div className="automation-dialog-backdrop" role="status">Loading details…</div>}><AutomationLogDialog key={`${logNotice.automationId}:${logNotice.runId||''}`} job={logJob} repositories={repositories} initialRun={logNotice.repositoryId&&logNotice.runId?{repositoryId:logNotice.repositoryId,runId:logNotice.runId}:undefined} onClose={()=>setLogNotice(null)}/></Suspense>}
  </div>;
}
