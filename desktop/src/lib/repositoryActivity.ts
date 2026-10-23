import {savedPrompts} from './savedPrompts';
import {useEffect,useState} from 'react';
import {api,type AutomationLogSummary} from './api';
import {currentAutomationLogs,subscribeAutomationLogs} from './automationLogs';
export const activityKey=(run:Pick<AutomationLogSummary,'automationId'|'repositoryId'|'runId'>)=>`script:${run.automationId}:${run.repositoryId}:${run.runId}`;
export function useRepositoryActivity(repositoryId:string,revision:number){
 const [saved,setSaved]=useState<AutomationLogSummary[]>([]),[,setChange]=useState(0),[error,setError]=useState('');
 useEffect(()=>subscribeAutomationLogs(()=>setChange(value=>value+1)),[]);
 useEffect(()=>{
  let stopped=false,generation=0,debounce:number|undefined;
  const refresh=async()=>{const request=++generation;try{const rows=await api.repositoryAutomationLogs(repositoryId);if(!stopped&&request===generation){setSaved(rows);setError('');}}catch(reason){if(!stopped)setError(String(reason));}};
  void refresh();const timer=window.setInterval(()=>void refresh(),15000);
  // Deletions must disappear as soon as local log views are notified.
  const unsubscribe=subscribeAutomationLogs(()=>{window.clearTimeout(debounce);debounce=window.setTimeout(()=>void refresh(),500);});
  return()=>{stopped=true;window.clearInterval(timer);window.clearTimeout(debounce);unsubscribe();};
 },[repositoryId,revision]);
 const merged=new Map(saved.filter(run=>run.repositoryId===repositoryId).map(run=>[activityKey(run),run]));
 for(const run of currentAutomationLogs().filter(run=>run.repositoryId===repositoryId))merged.set(activityKey(run),{...run,conversationId:run.conversation?.id});
 return {runs:[...merged.values()].map(run=>({...run,title:run.title||savedPrompts().find(job=>job.id===run.automationId)?.title})).sort((a,b)=>b.createdAt-a.createdAt),error};
}
