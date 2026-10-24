import type {AutomationLogSummary} from '../lib/api';
import {runRelationships,type RunEdge} from '../lib/runRelationships';
export function HandoffTrail({run:selected,runs,onSelect}:{run:AutomationLogSummary;runs:AutomationLogSummary[];onSelect?:(run:AutomationLogSummary)=>void}){
 const {run,parents,children}=runRelationships(selected,runs);
 if(!parents.length&&!children.length&&!run.emittedHandoffs?.length&&!run.producedCommits?.length)return null;
 const label=(item:AutomationLogSummary)=>onSelect?<button type="button" onClick={()=>onSelect(item)}>{item.title||'Related run'}</button>:<span>{item.title||'Related run'}</span>;
 const edge=(item:RunEdge)=><code title={item.kind==='commit'?`Commit ${item.label}`:`Handoff ${item.label}`}>{item.kind==='commit'?item.label.slice(0,8):item.label}</code>;
 return <div className="handoff-trail" aria-label="Run relationships">
 {parents.map((parent,index)=><span className="handoff-edge" key={`parent:${index}`}>{parent.run?label(parent.run):parent.kind==='handoff'?<span>Source run unavailable</span>:null}{parent.run||parent.kind==='handoff'?<span aria-hidden="true">→</span>:null}{edge(parent)}<span aria-hidden="true">→</span></span>)}
 <strong>{run.title||'This run'}</strong>
 {children.map((child,index)=><span className="handoff-edge" key={`child:${index}`}><span aria-hidden="true">→</span>{edge(child)}<span aria-hidden="true">→</span>{label(child.run!)}</span>)}
 {(run.emittedHandoffs||[]).filter(name=>!children.some(child=>child.kind==='handoff'&&child.label===name)).map(name=><span className="handoff-edge" key={name}><span aria-hidden="true">→</span><code title={`Handoff ${name}`}>{name}</code><small>Emitted</small></span>)}
 {(run.producedCommits||[]).filter(sha=>!children.some(child=>child.kind==='commit'&&child.label===sha)).map(sha=><span className="handoff-edge" key={sha}><span aria-hidden="true">→</span><code title={`Commit ${sha}`}>{sha.slice(0,8)}</code><small>Committed</small></span>)}
 </div>;
}
