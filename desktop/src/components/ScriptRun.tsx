import {acknowledgeAutomationError,subscribeSavedPrompts} from '../lib/savedPrompts';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {api,type AutomationLog,type AutomationLogSummary} from '../lib/api';
import {currentAutomationLogs,subscribeAutomationLogs} from '../lib/automationLogs';
import {AutomationRunContent} from './AutomationRunContent';
import {CopyButton} from './CopyButton';
export function ScriptRun({run}:{run:AutomationLogSummary}){
 useEffect(()=>{const acknowledge=()=>acknowledgeAutomationError(run.automationId);acknowledge();return subscribeSavedPrompts(acknowledge);},[run.automationId]);
 const [entry,setEntry]=useState<AutomationLog>(),[error,setError]=useState('');
 const pane=useRef<HTMLDivElement>(null),follow=useRef(true);
 useEffect(()=>{
  let stopped=false;
  const local=()=>currentAutomationLogs(run.automationId).find(item=>item.repositoryId===run.repositoryId&&item.runId===run.runId);
  setEntry(local());setError('');follow.current=true;
  const refresh=()=>{const cached=local();if(cached)setEntry(cached);else void api.readAutomationLog(run.automationId,run.repositoryId,run.runId).then(value=>{if(!stopped)setEntry(local()||value);}).catch(reason=>{if(!stopped)setError(String(reason));});};
  refresh();const unsubscribe=subscribeAutomationLogs(id=>{if(id===run.automationId)refresh();});
  return()=>{stopped=true;unsubscribe();};
 },[run.automationId,run.repositoryId,run.runId]);
 useLayoutEffect(()=>{if(follow.current&&pane.current)pane.current.scrollTop=pane.current.scrollHeight;},[entry]);
 return <div className="script-run-view"><header><strong>{run.title||'Script automation'} · {entry?.status||run.status}</strong><CopyButton label="Copy script log" disabled={!entry} value={entry?[entry.command,entry.stdout,entry.stderr,entry.response,entry.activity].filter(Boolean).join('\n\n'):''}/></header><div ref={pane} className="codex-messages script-log-messages" aria-label="Script log" onScroll={event=>{const node=event.currentTarget;follow.current=node.scrollHeight-node.clientHeight-node.scrollTop<24;}}>{error&&<p role="alert">{error}</p>}{entry?<><details><summary>Script</summary><pre>{entry.command}</pre></details><AutomationRunContent entry={entry}/></>:!error&&<p>Loading script log…</p>}</div></div>;
}
