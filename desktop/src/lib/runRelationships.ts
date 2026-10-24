import type {AutomationLogSummary} from './api';
export type RunEdge={run?:AutomationLogSummary;kind:'handoff'|'commit';label:string};
const same=(a:AutomationLogSummary,b:AutomationLogSummary)=>a.repositoryId===b.repositoryId&&a.automationId===b.automationId&&a.runId===b.runId;
/** Join immutable handoff IDs or full commit hashes, always inside one repository. */
export function runRelationships(selected:AutomationLogSummary,all:AutomationLogSummary[]){
 const recorded=all.find(item=>same(item,selected));
 const run={...recorded,...selected,producedCommits:selected.producedCommits??recorded?.producedCommits};
 const others=all.filter(item=>item.repositoryId===run.repositoryId&&!same(item,run));
 const parents:RunEdge[]=[],children:RunEdge[]=[];
 if(run.handoffName)parents.push({kind:'handoff',label:run.handoffName,run:others.find(item=>item.runId===run.handoffId)});
 if(run.commitTriggered&&run.commitSha){
   const sources=others.filter(item=>item.producedCommits?.includes(run.commitSha!));
   if(sources.length)parents.push(...sources.map(source=>({kind:'commit' as const,label:run.commitSha!,run:source})));
   else parents.push({kind:'commit',label:run.commitSha});
 }
 for(const child of others){
   if(child.handoffId===run.runId&&child.handoffName)children.push({run:child,kind:'handoff',label:child.handoffName});
   if(child.commitTriggered&&child.commitSha&&run.producedCommits?.includes(child.commitSha))children.push({run:child,kind:'commit',label:child.commitSha});
 }
 return {run,parents,children};
}
