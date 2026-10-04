import { useEffect, useState } from 'react';
import { Copy, X } from 'lucide-react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import diff from 'highlight.js/lib/languages/diff';
import { api, type AutomationLog, type AutomationLogSummary } from '../lib/api';
import { automationOutput, subscribeAutomationOutput } from '../lib/automationOutput';
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
  const [live,setLive]=useState(automationOutput(job.id));
  const refresh=()=>void api.listAutomationLogs(job.id).then(items=>{setSummaries(items);setSelected(current=>current||(items[0]?`${items[0].repositoryId}:${items[0].runId}`:''));}).catch(reason=>setError(String(reason)));
  useEffect(()=>{refresh();const unsubscribeRuns=subscribeSavedPrompts(refresh);const unsubscribeOutput=subscribeAutomationOutput(id=>{if(id===job.id)setLive([...automationOutput(id)]);});return()=>{unsubscribeRuns();unsubscribeOutput();};},[job.id]);
  useEffect(()=>{if(job.state==='completed'||job.state==='error'){void api.listAutomationLogs(job.id).then(items=>{setSummaries(items);if(items[0])setSelected(`${items[0].repositoryId}:${items[0].runId}`);});}},[job.id,job.lastAt,job.state]);
  useEffect(()=>{if(!selected){setEntry(null);return;}const split=selected.indexOf(':');const repositoryId=selected.slice(0,split),runId=selected.slice(split+1);void api.readAutomationLog(job.id,repositoryId,runId).then(setEntry).catch(reason=>setError(String(reason)));},[job.id,selected]);
  const repositoryName=(id:string)=>repositories.find(repo=>repo.id===id)?.displayName||job.repositoryLabels?.[id]||id;
  const logText=[
    live.length?['Live output',...live.map(chunk=>`[${repositoryName(chunk.repositoryId)}] ${chunk.text}`)].join('\n'):'',
    entry?[`${repositoryName(entry.repositoryId)} · ${new Date(entry.createdAt).toLocaleString()}`,entry.stdout,entry.stderr,entry.response,entry.activity].filter(Boolean).join('\n\n'):'',
    error,
    !entry&&!live.length&&!error?job.lastResult:'',
  ].filter(Boolean).join('\n\n');
  const copyLog=async()=>{try{await navigator.clipboard.writeText(logText);setCopyStatus('Copied log.');}catch(reason){setCopyStatus(`Could not copy log: ${String(reason)}`);}};
  useEffect(()=>setCopyStatus(''),[selected,live,entry]);
  return <div className="automation-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="automation-dialog automation-log-dialog" role="dialog" aria-modal="true" aria-label={`Details for ${job.title}`} onKeyDown={event=>{if(event.key==='Escape')onClose();}}><header><h2>{job.title}</h2><button type="button" aria-label="Close automation details" onClick={onClose}><X size={17}/></button></header><div className="automation-dialog-content automation-detail-content">
    <section className="automation-detail-pane" aria-label="Automation content"><strong>{job.kind==='notification'?'Notification message':job.kind==='shell'||job.kind==='git'?'Command or script':'Agent prompt'}</strong><div className="automation-detail-scroll">{job.kind==='shell'||job.kind==='git'?<ShellCode code={job.prompt}/>:<pre className="automation-log-plain">{job.prompt}</pre>}</div></section>
    <section className="automation-detail-pane" aria-label="Automation log"><div className="automation-detail-log-header"><strong>Log</strong><button type="button" aria-label="Copy automation log" disabled={!logText} onClick={()=>void copyLog()}><Copy size={15}/> Copy log</button>{job.kind!=='notification'&&<Select label="Automation log run" value={selected} onChange={setSelected} options={[{value:'',label:'Choose a saved run'},...summaries.map(item=>({value:`${item.repositoryId}:${item.runId}`,label:`${repositoryName(item.repositoryId)} · ${new Date(item.createdAt).toLocaleString()} · ${item.status}`}))]}/>}</div><div className="automation-detail-scroll" aria-live="polite">
      {copyStatus&&<p role="status">{copyStatus}</p>}
      {live.length>0&&<div className="automation-log-lines"><small>Live output</small>{live.map((chunk,index)=><pre key={index} className={chunk.stream==='stderr'?'automation-log-error':''}><span className="automation-log-source">[{repositoryName(chunk.repositoryId)}]</span> {chunk.text}</pre>)}</div>}
      {entry&&<div className="automation-log-lines"><small>{repositoryName(entry.repositoryId)} · {new Date(entry.createdAt).toLocaleString()}</small>{entry.stdout&&<HighlightedCode value={entry.stdout}/>}{entry.stderr&&<pre className="automation-log-error">{entry.stderr}</pre>}{entry.response&&<pre>{entry.response}</pre>}{entry.activity&&<pre className="automation-log-activity">{entry.activity}</pre>}</div>}
      {error&&<pre className="automation-log-error" role="status">{error}</pre>}
      {!entry&&!live.length&&!error&&(job.lastResult?<pre>{job.lastResult}</pre>:<p className="panel-copy">No output yet.</p>)}
    </div></section>
  </div></section></div>;
}
