import {useEffect,useMemo,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {inTauri} from './api';
import {useAutomationRuns,savedPrompts} from './savedPrompts';
import {useAgentChats} from './agentChats';
import {mailKey,type MailRef} from './feedback';
type Reference={runId:string;at:number;email?:MailRef;issue?:number};
export const itemActivity={load:(repositoryId:string,runIds:string[]):Promise<Reference[]>=>inTauri()?invoke('project_item_activity',{repositoryId,runIds}):Promise.resolve([])};
export function useItemActivity(project:string,active:boolean){
 const runs=useAutomationRuns(),chats=useAgentChats(active),[records,setRecords]=useState<Reference[]>([]);
 const work=useMemo(()=>{const items=new Map<string,{name:string;start:number;email?:MailRef}>();for(const run of runs)if(run.repositoryId===project)items.set(run.id,{name:savedPrompts().find(job=>job.id===run.automationId)?.title||'Automation',start:run.startedAt,email:run.feedback});for(const chat of chats)if(chat.repositoryId===project&&chat.running){const id=chat.automationContext?.runId||chat.id;if(!items.has(id))items.set(id,{name:chat.name,start:[...chat.messages].reverse().find(m=>m.role==='user')?.createdAt||chat.updatedAt});}return items;},[runs,chats,project]);
 const key=JSON.stringify([...work.keys()].sort());
 useEffect(()=>{let alive=true,pending=false;setRecords([]);if(!active||!work.size)return;const refresh=async()=>{if(pending)return;pending=true;try{const values=await itemActivity.load(project,[...work.keys()]);if(alive)setRecords(values);}catch{if(alive)setRecords([]);}finally{pending=false;}};void refresh();const timer=setInterval(()=>void refresh(),2000);return()=>{alive=false;clearInterval(timer);};},[project,key,active]);
 const matching=(email?:MailRef,issue?:number)=>{const names=new Set<string>();for(const [id,task]of work){const record=records.find(r=>r.runId===id&&r.at>=task.start);if(email&&(task.email&&mailKey(task.email)===mailKey(email)||record?.email&&mailKey(record.email)===mailKey(email))||issue!==undefined&&record?.issue===issue)names.add(task.name);}return [...names].join(', ');};
 return {email:(mail:MailRef)=>matching(mail),issue:(number:number)=>matching(undefined,number)};
}
