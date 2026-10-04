import { CopyButton } from './CopyButton';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import diff from 'highlight.js/lib/languages/diff';
import { api, type AutomationLog, type AutomationLogSummary } from '../lib/api';
import { currentAutomationLogs, subscribeAutomationLogs } from '../lib/automationLogs';
import { subscribeSavedPrompts, type SavedPrompt } from '../lib/savedPrompts';
import { ShellCode } from './ShellCode';
import { Select } from './Select';
import type { Repository } from '../types';

for(const [name,grammar] of [['bash',bash],['sh',bash],['json',json],['diff',diff]] as const)hljs.registerLanguage(name,grammar);
function HighlightedCode({value}:{value:string}){
  const html=hljs.highlightAuto(value,['bash','json','diff']).value;
  return <pre className="automation-log-code"><code dangerouslySetInnerHTML={{__html:html}}/></pre>;
}
export function AutomationLogDialog({job,repositories,onClose}:{job:SavedPrompt;repositories:Repository[];onClose:()=>void}){
  const [summaries,setSummaries]=useState<AutomationLogSummary[]>([]);
  const [selected,setSelected]=useState('');
  const [entry,setEntry]=useState<AutomationLog|null>(null);
  const [error,setError]=useState('');
  const [copyStatus,setCopyStatus]=useState('');
  const [liveEntries,setLiveEntries]=useState(()=>currentAutomationLogs(job.id));
  const lastActive=useRef('');
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
    if(activeKey&&activeKey!==lastActive.current){lastActive.current=activeKey;setSelected(activeKey);}
    else if(!selected||!logs.some(item=>`${item.repositoryId}:${item.runId}`===selected)){setSelected(logs[0]?`${logs[0].repositoryId}:${logs[0].runId}`:'');}
  },[activeKey,selected,summaries,liveEntries]);
  const liveEntry=liveEntries.find(item=>`${item.repositoryId}:${item.runId}`===selected);
  useEffect(()=>{
    let active=true;setEntry(null);
    if(liveEntry){setEntry(liveEntry);return;}
    if(!selected)return;
    const split=selected.indexOf(':');const repositoryId=selected.slice(0,split),runId=selected.slice(split+1);
    void api.readAutomationLog(job.id,repositoryId,runId).then(value=>{if(active){setEntry(value);setError('');}}).catch(reason=>{if(active)setError(String(reason));});
    return()=>{active=false;};
  },[job.id,selected,liveEntry]);
  const repositoryName=(id:string)=>repositories.find(repo=>repo.id===id)?.displayName||job.repositoryLabels?.[id]||id;
  const logText=[
    entry?[`${repositoryName(entry.repositoryId)} · ${new Date(entry.createdAt).toLocaleString()}`,entry.stdout,entry.stderr,entry.response,entry.activity].filter(Boolean).join('\n\n'):'',
    error,
    !entry&&!error&&job.state!=='running'?job.lastResult:'',
  ].filter(Boolean).join('\n\n');
  useEffect(()=>setCopyStatus(''),[selected,entry]);
  return <div className="automation-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="automation-dialog automation-log-dialog" role="dialog" aria-modal="true" aria-label={`Details for ${job.title}`} onKeyDown={event=>{if(event.key==='Escape')onClose();}}><header><h2>{job.title}</h2><button type="button" aria-label="Close automation details" onClick={onClose}><X size={17}/></button></header><div className="automation-dialog-content automation-detail-content">
    <section className="automation-detail-pane" aria-label="Automation content"><strong>{job.kind==='notification'?'Notification message':job.kind==='shell'||job.kind==='git'?'Command or script':'Agent prompt'}</strong><div className="automation-detail-scroll">{job.kind==='shell'||job.kind==='git'?<ShellCode code={job.prompt}/>:<pre className="automation-log-plain">{job.prompt}</pre>}</div></section>
    <section className="automation-detail-pane" aria-label="Automation log"><div className="automation-detail-log-header"><strong>Log</strong><CopyButton label="Copy automation log" value={logText} disabled={!logText} onError={reason=>setCopyStatus(`Could not copy log: ${String(reason)}`)}/>{logs.length>0&&<Select label="Automation log run" value={selected} onChange={setSelected} options={logs.map(item=>({value:`${item.repositoryId}:${item.runId}`,label:`${repositoryName(item.repositoryId)} · ${new Date(item.createdAt).toLocaleString()} · ${item.status}`}))}/>}</div><div className="automation-detail-scroll" aria-live="polite">
      {copyStatus&&<p role="status">{copyStatus}</p>}

      {entry&&<div className="automation-log-lines"><small>{repositoryName(entry.repositoryId)} · {new Date(entry.createdAt).toLocaleString()}</small>{entry.stdout&&<HighlightedCode value={entry.stdout}/>}{entry.stderr&&<pre className="automation-log-error">{entry.stderr}</pre>}{entry.response&&<pre>{entry.response}</pre>}{entry.activity&&<pre className="automation-log-activity">{entry.activity}</pre>}</div>}
      {error&&<pre className="automation-log-error" role="status">{error}</pre>}
      {entry?.status==='running'&&!entry.stdout&&!entry.stderr&&!entry.response&&!entry.activity&&<p className="panel-copy">Waiting for output…</p>}
      {!entry&&!error&&(job.state==='running'?<p className="panel-copy">Preparing run log…</p>:job.lastResult?<pre>{job.lastResult}</pre>:<p className="panel-copy">No output yet.</p>)}
    </div></section>
  </div></section></div>;
}
