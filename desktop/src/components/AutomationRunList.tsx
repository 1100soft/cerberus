import { useEffect, useState } from 'react';
import { FileText, LoaderCircle } from 'lucide-react';
import { api, type AutomationLogSummary } from '../lib/api';
import { currentAutomationLogs, subscribeAutomationLogs } from '../lib/automationLogs';
import { useAutomationRuns, type SavedPrompt } from '../lib/savedPrompts';
import type { Repository } from '../types';
export function AutomationRunList({job,repositories,onOpen}:{job:SavedPrompt;repositories:Repository[];onOpen:(run:{repositoryId:string;runId:string})=>void}){
  const active=useAutomationRuns().filter(run=>run.automationId===job.id);
  const [saved,setSaved]=useState<AutomationLogSummary[]>([]),[live,setLive]=useState(()=>currentAutomationLogs(job.id));
  useEffect(()=>{let current=true;void api.listAutomationLogs(job.id).then(items=>{if(current)setSaved(items);}).catch(()=>{});return()=>{current=false;};},[job.id,job.lastAt]);
  useEffect(()=>subscribeAutomationLogs(id=>{if(id===job.id)setLive(currentAutomationLogs(id));}),[job.id]);
  const logs=[...new Map([...saved,...live].map(run=>[run.runId,run])).values()].sort((a,b)=>b.createdAt-a.createdAt);
  const runningIds=new Set(active.map(run=>run.id));
  const rows=[...active.map(run=>({...run,runId:run.id,createdAt:run.startedAt})),...logs.filter(run=>!runningIds.has(run.runId)).slice(0,3).map(run=>({...run,status:run.status==='running'?'interrupted':run.status}))];
  if(!rows.length)return null;
  return <section className="automation-context-runs" aria-label={`Runs for ${job.title}`}><div className="automation-context-heading"><strong>Runs</strong><small>{active.length?`${active.length} active · `:''}Recent first</small></div>{rows.map(run=>{
    const context=[repositories.find(repo=>repo.id===run.repositoryId)?.displayName||job.repositoryLabels?.[run.repositoryId]||run.repositoryId,run.branch,run.commitSha?.slice(0,8),run.handoffName&&`${run.handoffName} · ${run.handoffId?.slice(0,8)||''}`].filter(Boolean).join(' · ');
    const running=run.status==='running'||run.status==='preparing';
    return <button type="button" className={`automation-context-run ${running?'active':''}`} key={run.runId} onClick={()=>onOpen({repositoryId:run.repositoryId,runId:run.runId})} aria-label={`Open run ${context}`}><span className="automation-context-status">{running?<LoaderCircle size={14} className="spin"/>:<FileText size={14}/>} {run.status}</span><span className="automation-context-label">{context}</span><time dateTime={new Date(run.createdAt).toISOString()}>{new Date(run.createdAt).toLocaleString()}</time></button>;
  })}</section>;
}
