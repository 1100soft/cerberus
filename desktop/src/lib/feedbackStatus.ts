import {useEffect,useSyncExternalStore} from 'react';
import {feedback,type MailboxConfig} from './feedback';
export type MailboxStatus={config:MailboxConfig|null;state:'checking'|'ready'|'warning'|'none';count?:number;error?:string};
const empty:MailboxStatus={config:null,state:'none'};
const statuses=new Map<string,MailboxStatus>(),listeners=new Set<()=>void>(),pending=new Map<string,Promise<void>>();
const emit=()=>listeners.forEach(listener=>listener());
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export function recordMailboxStatus(id:string,config:MailboxConfig,result:{count?:number}|null,error?:string){
 statuses.set(id,{config,state:result&&config.enabled?'ready':'warning',count:result?.count,error:error||(!config.enabled?'Mailbox is disabled.':!result?'Connection has not been verified.':undefined)});emit();
}
export function refreshMailboxStatus(id:string):Promise<void>{
 const running=pending.get(id);if(running)return running;
 const request=(async()=>{
  let config:MailboxConfig|null=null;
  try{
   config=await feedback.config(id);
   if(!config){statuses.set(id,empty);emit();return;}
   if(!config.enabled){recordMailboxStatus(id,config,null,'Mailbox is disabled.');return;}
   statuses.set(id,{config,state:'checking'});emit();
   const result=await feedback.request<{count:number}>(id,{action:'status'});
   recordMailboxStatus(id,config,result);
  }catch(error){statuses.set(id,{config,state:'warning',error:String(error)});emit();}
 })().finally(()=>pending.delete(id));
 pending.set(id,request);return request;
}
export function useMailboxStatus(id:string){
 const status=useSyncExternalStore(subscribe,()=>statuses.get(id)||empty);
 useEffect(()=>{
  if(!id)return;
  void refreshMailboxStatus(id);
  const refresh=()=>{void (pending.get(id)||Promise.resolve()).then(()=>refreshMailboxStatus(id));};
  const timer=setInterval(refresh,120_000);
  window.addEventListener('feedback-config-changed',refresh);
  window.addEventListener('feedback-mail-changed',refresh);
  return()=>{clearInterval(timer);window.removeEventListener('feedback-config-changed',refresh);window.removeEventListener('feedback-mail-changed',refresh);};
 },[id]);
 return status;
}
