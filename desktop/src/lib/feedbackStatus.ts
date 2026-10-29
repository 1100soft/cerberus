import {useEffect,useSyncExternalStore} from 'react';
import {feedback,type MailboxConfig} from './feedback';
export type MailboxStatus={config:MailboxConfig|null;state:'checking'|'ready'|'warning'|'none';count?:number;error?:string};
const empty:MailboxStatus={config:null,state:'none'};
const statuses=new Map<string,MailboxStatus>(),listeners=new Set<()=>void>(),pending=new Map<string,Promise<void>>();
const checkedAt=new Map<string,number>(),queued=new Set<string>(),watchers=new Map<string,{count:number;cleanup:()=>void}>();
const emit=()=>listeners.forEach(listener=>listener());
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function recordMailboxStatus(id:string,config:MailboxConfig,result:{count?:number}|null,error?:string){
 checkedAt.set(id,Date.now());statuses.set(id,{config,state:result&&config.enabled?'ready':'warning',count:result?.count,error:error||(!config.enabled?'Mailbox is disabled.':!result?'Connection has not been verified.':undefined)});emit();
}
export function refreshMailboxStatus(id:string,force=true):Promise<void>{
 const running=pending.get(id);if(running){if(force)queued.add(id);return running;}
 if(!force&&Date.now()-(checkedAt.get(id)||0)<120_000)return Promise.resolve();
 const request=(async()=>{
  let config:MailboxConfig|null=null;
  try{
   config=await feedback.config(id);
   if(!config){checkedAt.set(id,Date.now());statuses.set(id,empty);emit();return;}
   if(!config.enabled){recordMailboxStatus(id,config,null,'Mailbox is disabled.');return;}
   statuses.set(id,{config,state:'checking'});emit();
   const result=await feedback.request<{count:number}>(id,{action:'status'});
   recordMailboxStatus(id,config,result);
  }catch(error){checkedAt.set(id,Date.now());statuses.set(id,{config,state:'warning',error:String(error)});emit();}
 })().finally(()=>{pending.delete(id);if(queued.delete(id))void refreshMailboxStatus(id);});
 pending.set(id,request);return request;
}
export function useMailboxStatus(id:string){
 const status=useSyncExternalStore(subscribe,()=>statuses.get(id)||empty);
 useEffect(()=>{
  if(!id)return;
  const existing=watchers.get(id);if(existing){existing.count++;return()=>{if(--existing.count===0){existing.cleanup();watchers.delete(id);}};}
  void refreshMailboxStatus(id,false);
  const refresh=(event:Event)=>{const project=(event as CustomEvent<string>).detail;if(!project||project===id)void refreshMailboxStatus(id);};
  const timer=setInterval(()=>void refreshMailboxStatus(id,false),120_000);
  window.addEventListener('feedback-config-changed',refresh);window.addEventListener('feedback-mail-changed',refresh);
  const watcher={count:1,cleanup:()=>{clearInterval(timer);window.removeEventListener('feedback-config-changed',refresh);window.removeEventListener('feedback-mail-changed',refresh);}};watchers.set(id,watcher);
  return()=>{if(--watcher.count===0){watcher.cleanup();watchers.delete(id);}};
 },[id]);
 return status;
}
