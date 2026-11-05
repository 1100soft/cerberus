import {PageSnapshots} from './pageSnapshots';
import {useAgentChats} from './agentChats';
import {savedPrompts} from './savedPrompts';
import {useEffect,useState} from 'react';
import {api,type AutomationLogSummary} from './api';
import {currentAutomationLogs,subscribeAutomationLogs} from './automationLogs';
const snapshots=new PageSnapshots<{rows:AutomationLogSummary[];records:Record<string,string[]>}>();
export const activityKey=(run:Pick<AutomationLogSummary,'automationId'|'repositoryId'|'runId'>)=>`script:${run.automationId}:${run.repositoryId}:${run.runId}`;
export function useRepositoryActivity(repositoryId:string,revision:number,active=true){
 const chats=useAgentChats(active).filter(chat=>chat.repositoryId===repositoryId);
 const [origins,setOrigins]=useState<Record<string,string[]>>(()=>snapshots.peek(repositoryId)?.records||{});
 const [saved,setSaved]=useState<AutomationLogSummary[]>(()=>snapshots.peek(repositoryId)?.rows||[]),[,setChange]=useState(0),[error,setError]=useState('');
 useEffect(()=>active?subscribeAutomationLogs(()=>setChange(value=>value+1)):undefined,[active]);
 useEffect(()=>{
  if(!active)return;
  let stopped=false,generation=0,debounce:number|undefined;
  const refresh=async()=>{const request=++generation;try{const {rows,records}=await snapshots.load(repositoryId,async()=>{const [rows,records]=await Promise.all([api.repositoryAutomationLogs(repositoryId),api.repositoryCommitOrigins(repositoryId)]);return {rows,records};});if(!stopped&&request===generation){setSaved(rows);setOrigins(records);setError('');}}catch(reason){if(!stopped)setError(String(reason));}};
  const prior=snapshots.peek(repositoryId);setSaved(prior?.rows||[]);setOrigins(prior?.records||{});setError('');
  void refresh();const timer=window.setInterval(()=>void refresh(),15000);
  // Deletions must disappear as soon as local log views are notified.
  const unsubscribe=subscribeAutomationLogs(()=>{window.clearTimeout(debounce);debounce=window.setTimeout(()=>void refresh(),500);});
  return()=>{stopped=true;window.clearInterval(timer);window.clearTimeout(debounce);unsubscribe();};
 },[repositoryId,revision,active]);
 const merged=new Map(saved.filter(run=>run.repositoryId===repositoryId).map(run=>[activityKey(run),run]));
 for(const run of currentAutomationLogs().filter(run=>run.repositoryId===repositoryId))merged.set(activityKey(run),{...run,conversationId:run.conversation?.id});
 for(const chat of chats){if(origins[chat.id]?.length&&!Array.from(merged.values()).some(run=>run.runId===chat.id)){
   const run:AutomationLogSummary={automationId:'conversation',repositoryId,runId:chat.id,conversationId:chat.id,title:chat.name,createdAt:chat.messages.find(message=>message.createdAt)?.createdAt||chat.updatedAt,kind:'agent',status:chat.running?'running':'completed'};merged.set(activityKey(run),run);
 }}
 return {runs:[...merged.values()].map(run=>({...run,producedCommits:origins[run.runId]||run.producedCommits})).map(run=>({...run,title:run.title||savedPrompts().find(job=>job.id===run.automationId)?.title})).sort((a,b)=>b.createdAt-a.createdAt),error};
}
