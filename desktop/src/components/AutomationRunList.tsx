import { useState } from 'react';
import { FileText, LoaderCircle, RefreshCw, X, Trash2 } from 'lucide-react';
import { blockedAutomationRuns, dismissBlockedAutomation, retryBlockedAutomation, useAutomationRuns, type SavedPrompt } from '../lib/savedPrompts';
import { DeleteAutomationRunDialog } from './DeleteAutomationRunDialog';
import type { AutomationLog } from '../lib/api';
import type { Repository } from '../types';
export function AutomationRunList({job,repositories,onOpen}:{job:SavedPrompt;repositories:Repository[];onOpen:(run:{repositoryId:string;runId:string})=>void}){
  const active=useAutomationRuns().filter(run=>run.automationId===job.id);
  const blocked=blockedAutomationRuns(job.id);
  const [retrying,setRetrying]=useState<string[]>([]),[error,setError]=useState(''),[deleting,setDeleting]=useState<AutomationLog|null>(null);
  const rows=[...active.map(run=>({...run,runId:run.id,createdAt:run.startedAt,retry:undefined})),...blocked.filter(log=>!active.some(run=>run.id===log.runId)).map(log=>({...log,branch:log.branch||log.retry?.eventBranch||log.retry?.ciRun?.headBranch||undefined,commitSha:log.commitSha||log.retry?.eventSha||log.retry?.ciRun?.headSha,handoffName:log.handoffName||log.retry?.incoming?.name,handoffId:log.handoffId||log.retry?.incoming?.id}))];
  if(!rows.length)return null;
  return <section className="automation-context-runs" aria-label={`Runs for ${job.title}`}><div className="automation-context-heading"><strong>Active and blocked runs</strong><small>{active.length} active</small></div>{rows.map(run=>{
    const context=[repositories.find(repo=>repo.id===run.repositoryId)?.displayName||job.repositoryLabels?.[run.repositoryId]||run.repositoryId,run.branch,run.commitSha?.slice(0,8),run.handoffName&&`${run.handoffName} · ${run.handoffId?.slice(0,8)||''}`].filter(Boolean).join(' · ');
    const running=run.status==='running'||run.status==='preparing';
    return <div className={`automation-context-run ${running?'active':'failed'}`} key={run.runId}>
      <button type="button" className="automation-context-open" onClick={()=>onOpen({repositoryId:run.repositoryId,runId:run.runId})} aria-label={`Open run ${context}`}><span className="automation-context-status">{running?<LoaderCircle size={14} className="spin"/>:<FileText size={14}/>} {run.status}</span><span className="automation-context-label" title={context}>{context}</span><time dateTime={new Date(run.createdAt).toISOString()}>{new Date(run.createdAt).toLocaleString()}</time></button>
      {run.retry&&<button type="button" aria-label={`Retry blocked ${job.title}`} title={`Retry this failed run · ${context} · ${new Date(run.createdAt).toLocaleString()}. Uses its saved prompt, input and conversation.`} disabled={retrying.includes(run.runId)} onClick={()=>{setError('');setRetrying(ids=>[...ids,run.runId]);void retryBlockedAutomation(run).catch(reason=>setError(String(reason))).finally(()=>setRetrying(ids=>ids.filter(id=>id!==run.runId)));}}><RefreshCw size={15}/></button>}
      {run.retry&&<button type="button" aria-label={`Dismiss blocked ${job.title}`} title="Dismiss from this card; keep the saved log and retry in conversation history" disabled={retrying.includes(run.runId)} onClick={()=>void dismissBlockedAutomation(run).catch(reason=>setError(String(reason)))}><X size={14}/></button>}
      {run.retry&&<button type="button" aria-label={`Delete blocked run ${job.title}`} title="Delete this saved run and log" disabled={retrying.includes(run.runId)} onClick={()=>setDeleting(run)}><Trash2 size={14}/></button>}
    </div>;
  })}{error&&<p className="config-error" role="alert">{error}</p>}{deleting&&<DeleteAutomationRunDialog entry={deleting} onClose={()=>setDeleting(null)}/>}</section>;
}
