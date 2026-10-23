import type {AutomationLogSummary} from '../lib/api';
export function HandoffTrail({run,runs,onSelect}:{run:AutomationLogSummary;runs:AutomationLogSummary[];onSelect?:(run:AutomationLogSummary)=>void}){
 const parent=run.handoffId?runs.find(item=>item.runId===run.handoffId&&item.repositoryId===run.repositoryId):undefined;
 const children=runs.filter(item=>item.handoffId===run.runId&&item.repositoryId===run.repositoryId);
 if(!run.handoffName&&!children.length&&!run.emittedHandoffs?.length)return null;
 return <div className="handoff-trail" aria-label="Handoff relationships">
 {run.handoffName&&<><span>{parent?(onSelect?<button type="button" onClick={()=>onSelect(parent)}>{parent.title||'Source run'}</button>:parent.title||'Source run'):'Source run unavailable'}</span><span aria-hidden="true">→</span><code>{run.handoffName}</code><span aria-hidden="true">→</span></>}
 <strong>{run.title||'This run'}</strong>
 {children.map(child=><span className="handoff-edge" key={`${child.automationId}:${child.runId}`}><span aria-hidden="true">→</span><code>{child.handoffName}</code><span aria-hidden="true">→</span>{onSelect?<button type="button" onClick={()=>onSelect(child)}>{child.title||'Downstream run'}</button>:<span>{child.title||'Downstream run'}</span>}</span>)}
 {(run.emittedHandoffs||[]).filter(name=>!children.some(child=>child.handoffName===name)).map(name=><span className="handoff-edge" key={name}><span aria-hidden="true">→</span><code>{name}</code><small>Emitted</small></span>)}
 </div>;
}
