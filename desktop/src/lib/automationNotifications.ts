import { useSyncExternalStore } from 'react';

export type AutomationNotice={id:string;automationId:string;repositoryId?:string;runId?:string;title:string;message:string;status:'started'|'completed'|'failed'|'message';createdAt:number;read:boolean};
const key='gitcerberus.automationNotifications.v1';
const listeners=new Set<()=>void>();
function read():AutomationNotice[]{try{const saved=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(saved)?saved.filter(item=>item&&typeof item.id==='string'&&typeof item.title==='string').slice(0,100):[];}catch{return [];}}
let notices=read();
function publish(next:AutomationNotice[]){notices=next.slice(0,100);try{localStorage.setItem(key,JSON.stringify(notices));}catch{/* Keep notifications for this session. */}for(const listener of listeners)listener();}
export function addAutomationNotice(input:Omit<AutomationNotice,'id'|'createdAt'|'read'>){publish([{...input,id:crypto.randomUUID(),createdAt:Date.now(),read:false},...notices]);}
export function markAutomationNoticesRead(){if(notices.some(item=>!item.read))publish(notices.map(item=>({...item,read:true})));}
export function clearAutomationNotices(){publish([]);}
export function useAutomationNotices(){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>notices);}
