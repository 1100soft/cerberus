import { DeleteAutomationRunDialog } from './DeleteAutomationRunDialog';
import { CopyButton } from './CopyButton';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import diff from 'highlight.js/lib/languages/diff';
import { api, type AutomationLog, type AutomationLogSummary } from '../lib/api';
import { currentAutomationLogs, subscribeAutomationLogs } from '../lib/automationLogs';
import { acknowledgeAutomationError, subscribeSavedPrompts, type SavedPrompt } from '../lib/savedPrompts';
import { ShellCode } from './ShellCode';
import { Select } from './Select';
import type { Repository } from '../types';

for(const [name,grammar] of [['bash',bash],['sh',bash],['json',json],['diff',diff]] as const)hljs.registerLanguage(name,grammar);
function HighlightedCode({value}:{value:string}){
  const html=hljs.highlightAuto(value,['bash','json','diff']).value;
  return <pre className="automation-log-code"><code dangerouslySetInnerHTML={{__html:html}}/></pre>;
}
export function AutomationLogDialog({job,repositories,onClose,initialRun}:{job:SavedPrompt;repositories:Repository[];onClose:()=>void;initialRun?:{repositoryId:string;runId:string}}){
  useEffect(()=>{const acknowledge=()=>acknowledgeAutomationError(job.id);acknowledge();return subscribeSavedPrompts(acknowledge);},[job.id]);
  const [summaries,setSummaries]=useState<AutomationLogSummary[]>([]);
  const initialSelection=initialRun?`${initialRun.repositoryId}:${initialRun.runId}`:'';
  const [selected,setSelected]=useState(initialSelection);
  const selectionPinned=useRef(!!initialRun);
  const preferredSelection=useRef(initialSelection);
  const [entry,setEntry]=useState<AutomationLog|null>(null);
  const [error,setError]=useState('');
  const [deleting,setDeleting]=useState<AutomationLog|null>(null);
  const [deletingAll,setDeletingAll]=useState(false),[deleteStatus,setDeleteStatus]=useState('');
  const [copyStatus,setCopyStatus]=useState('');
  const [liveEntries,setLiveEntries]=useState(()=>currentAutomationLogs(job.id));
  const lastActive=useRef('');
  const logScroll=useRef<HTMLDivElement>(null);
  const followOutput=useRef(true);
  useEffect(()=>{
    let active=true;let request=0;
    const refresh=()=>{const generation=++request;void api.listAutomationLogs(job.id).then(items=>{if(active&&generation===request){setSummaries(items);setError('');}}).catch(reason=>{if(active)setError(String(reason));});};
    refresh();
    const unsubscribeRuns=subscribeSavedPrompts(refresh);
    const unsubscribeLogs=subscribeAutomationLogs(id=>{if(id===job.id)setLiveEntries(currentAutomationLogs(id));});
    return()=>{active=false;unsubscribeRuns();unsubscribeLogs();};
  },[job.id]);
  const logs=[...new Map([...summaries,...liveEntries].map(item=>[`${item.repositoryId}:${item.runId}`,item])).values()].sort((a,b)=>b.createdAt-a.createdAt);
  const active=logs.find(item=>item.status==='running');
  const activeKey=active?`${active.repositoryId}:${active.runId}`:'';
  useEffect(()=>{
    if(preferredSelection.current){if(logs.some(item=>`${item.repositoryId}:${item.runId}`===preferredSelection.current)){setSelected(preferredSelection.current);preferredSelection.current='';lastActive.current=activeKey;}return;}
    if(selectionPinned.current&&selected&&logs.some(item=>`${item.repositoryId}:${item.runId}`===selected))return;
    if(activeKey&&activeKey!==lastActive.current){lastActive.current=activeKey;setSelected(activeKey);}
    else if(!selected||!logs.some(item=>`${item.repositoryId}:${item.runId}`===selected)){setSelected(logs[0]?`${logs[0].repositoryId}:${logs[0].runId}`:'');}
  },[activeKey,selected,summaries,liveEntries]);
  const liveEntry=liveEntries.find(item=>`${item.repositoryId}:${item.runId}`===selected);
  useEffect(()=>{
    let active=true;setEntry(null);
    if(liveEntry){setEntry(liveEntry);setError('');return;}
    if(!selected||!logs.some(item=>`${item.repositoryId}:${item.runId}`===selected))return;
    const split=selected.indexOf(':');const repositoryId=selected.slice(0,split),runId=selected.slice(split+1);
    void api.readAutomationLog(job.id,repositoryId,runId).then(value=>{if(active){setEntry(value);setError('');}}).catch(reason=>{if(active)setError(String(reason));});
    return()=>{active=false;};
  },[job.id,selected,liveEntry,summaries]);
  const repositoryName=(id:string)=>repositories.find(repo=>repo.id===id)?.displayName||job.repositoryLabels?.[id]||id;
  const logText=[
    entry?[`${repositoryName(entry.repositoryId)} · ${new Date(entry.createdAt).toLocaleString()}`,entry.inputValues&&Object.keys(entry.inputValues).length?`Manual inputs: ${JSON.stringify(entry.inputValues)}`:'',entry.stdout,entry.stderr,entry.response,entry.activity].filter(Boolean).join('\n\n'):'',
    error,
    !entry&&!error&&logs.length>0&&job.state!=='running'?job.lastResult:'',
  ].filter(Boolean).join('\n\n');
  useEffect(()=>setCopyStatus(''),[selected,entry]);
  useLayoutEffect(()=>{followOutput.current=true;},[selected]);
  useLayoutEffect(()=>{const pane=logScroll.current;if(pane&&followOutput.current)pane.scrollTop=pane.scrollHeight;},[selected,entry,error,copyStatus,job.lastResult]);
  return <div className="automation-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="automation-dialog automation-log-dialog" role="dialog" aria-modal="true" aria-label={`Details for ${job.title}`} onKeyDown={event=>{if(event.key==='Escape')onClose();}}><header><h2>{job.title}</h2><button type="button" aria-label="Close automation details" onClick={onClose}><X size={17}/></button></header><div className="automation-dialog-content automation-detail-content">
    <section className="automation-detail-pane" aria-label="Automation content"><strong>{job.kind==='notification'?'Notification message':job.kind==='shell'||job.kind==='git'?'Command or script':'Agent prompt'}</strong><div className="automation-detail-scroll">{job.kind==='shell'||job.kind==='git'?<ShellCode code={job.prompt}/>:<pre className="automation-log-plain">{job.prompt}</pre>}</div></section>
    <section className="automation-detail-pane" aria-label="Automation log"><div className="automation-detail-log-header"><strong>Log</strong><CopyButton label="Copy automation log" value={logText} disabled={!logText} onError={reason=>setCopyStatus(`Could not copy log: ${String(reason)}`)}/>{entry&&entry.status!=='running'&&<button type="button" aria-label="Delete selected automation run" title="Delete this saved run and log" onClick={()=>setDeleting(entry)}><Trash2 size={15}/></button>}{logs.length>0&&<button type="button" aria-label="Delete all saved automation logs" title="Delete all completed and blocked logs for this automation" disabled={!logs.some(log=>log.status!=='running')} onClick={()=>{setDeleteStatus('');setDeletingAll(true);}}>Delete all</button>}{logs.length>0&&<Select label="Automation log run" value={selected} onChange={value=>{selectionPinned.current=true;setSelected(value);}} options={logs.map(item=>({value:`${item.repositoryId}:${item.runId}`,label:`${repositoryName(item.repositoryId)}${item.branch?' · '+item.branch:''}${item.commitSha?' · '+item.commitSha.slice(0,8):''}${item.handoffName?' · '+item.handoffName:''} · ${new Date(item.createdAt).toLocaleString()} · ${item.status}`}))}/>}</div><div ref={logScroll} className="automation-detail-scroll" aria-live="polite" onScroll={event=>{const pane=event.currentTarget;followOutput.current=pane.scrollHeight-pane.clientHeight-pane.scrollTop<=16;}}>
      {copyStatus&&<p role="status">{copyStatus}</p>}{deleteStatus&&<p role="status">{deleteStatus}</p>}

      {entry&&<div className="automation-log-lines"><small>{repositoryName(entry.repositoryId)} · {new Date(entry.createdAt).toLocaleString()}</small>{entry.inputValues&&Object.keys(entry.inputValues).length>0&&<pre>{`Manual inputs: ${JSON.stringify(entry.inputValues)}`}</pre>}{entry.stdout&&<HighlightedCode value={entry.stdout}/>}{entry.stderr&&<pre className="automation-log-error">{entry.stderr}</pre>}{entry.response&&<pre>{entry.response}</pre>}{entry.activity&&<pre className="automation-log-activity">{entry.activity}</pre>}</div>}
      {error&&<pre className="automation-log-error" role="status">{error}</pre>}
      {entry?.status==='running'&&!entry.stdout&&!entry.stderr&&!entry.response&&!entry.activity&&<p className="panel-copy">Waiting for output…</p>}
      {!entry&&!error&&(job.state==='running'?<p className="panel-copy">Preparing run log…</p>:logs.length>0&&job.lastResult?<pre>{job.lastResult}</pre>:<p className="panel-copy">No saved runs.</p>)}
    </div></section>
  </div></section>{deleting&&<DeleteAutomationRunDialog entry={deleting} onClose={()=>setDeleting(null)} onDeleted={()=>{setEntry(null);setSelected('');preferredSelection.current='';selectionPinned.current=false;}}/>}{deletingAll&&<DeleteAutomationRunDialog automationId={job.id} onClose={()=>setDeletingAll(false)} onDeleted={result=>{setEntry(null);setSelected('');preferredSelection.current='';selectionPinned.current=false;setDeleteStatus(`Deleted ${result?.deleted||0} saved runs.${result?.kept?` Kept ${result.kept} active run(s).`:''}`);}}/>}</div>;
}
