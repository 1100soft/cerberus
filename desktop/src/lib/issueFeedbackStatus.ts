import {useEffect,useSyncExternalStore} from 'react';
import {issueFeedback} from './issueFeedback';
type Status={state:'none'|'checking'|'ready'|'warning';count?:number;error?:string};
const empty:Status={state:'none'},values=new Map<string,Status>(),pending=new Map<string,Promise<void>>(),times=new Map<string,number>(),listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(fn=>fn());
export async function refreshIssueFeedbackStatus(id:string,force=false){
 if(!id||id.startsWith('github:'))return;
 if(pending.has(id))return pending.get(id);
 if(!force&&Date.now()-(times.get(id)||0)<120_000)return;
 const task=(async()=>{try{const scope=await issueFeedback.scope(id);if(!scope){values.set(id,empty);return;}values.set(id,{...values.get(id),state:'checking'});emit();const result=await issueFeedback.request<{openCount:number}>(id,{action:'summary'});values.set(id,{state:'ready',count:result.openCount});}catch(error){values.set(id,{state:'warning',error:String(error)});}finally{times.set(id,Date.now());emit();}})().finally(()=>pending.delete(id));
 pending.set(id,task);return task;
}
export function useIssueFeedbackStatus(id:string){
 const state=useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>values.get(id)||empty);
 useEffect(()=>{void refreshIssueFeedbackStatus(id);const refresh=(e:Event)=>{const project=(e as CustomEvent<string>).detail;if(!project||project===id)void refreshIssueFeedbackStatus(id,true);};window.addEventListener('issue-feedback-changed',refresh);const timer=setInterval(()=>void refreshIssueFeedbackStatus(id),120_000);return()=>{clearInterval(timer);window.removeEventListener('issue-feedback-changed',refresh);};},[id]);
 return state;
}
