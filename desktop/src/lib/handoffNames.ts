import { automationConditions, emittedHandoff, validHandoffName, type SavedPrompt } from './savedPrompts';
import type { Repository } from '../types';

function normalized(names:Iterable<string>){return [...new Set([...names].map(name=>name.trim().toLowerCase()).filter(validHandoffName))].sort((a,b)=>a.localeCompare(b));}
export function knownHandoffNames(jobs:SavedPrompt[]){
  return normalized(jobs.flatMap(job=>[...(automationConditions(job).includes('handoff')&&job.handoffName?[job.handoffName]:[]),...(job.emitsHandoffs||[]).map(value=>emittedHandoff(value).name)]));
}
function scope(job:SavedPrompt,repositories:Repository[]){
  if(job.includeFutureRepositories)return repositories.filter(repo=>repo.localPresent!==false&&!!repo.localPath).map(repo=>repo.id);
  return job.repositoryIds?.length?job.repositoryIds:job.repositoryId?[job.repositoryId]:[];
}
export function handoffPairWarnings(jobs:SavedPrompt[],repositories:Repository[]){
  const uses=new Map<string,{emits:Set<string>;triggers:Set<string>}>();
  for(const job of jobs){
    const targets=scope(job,repositories);
    for(const repositoryId of targets){
      const incoming=automationConditions(job).includes('handoff')?normalized([job.handoffName||'']):[];
      const outgoing=normalized((job.emitsHandoffs||[]).map(value=>emittedHandoff(value).name));
      for(const handoff of incoming){const key=`${repositoryId}\u0000${handoff}`;const pair=uses.get(key)||{emits:new Set<string>(),triggers:new Set<string>()};pair.triggers.add(job.id);uses.set(key,pair);}
      for(const handoff of outgoing){const key=`${repositoryId}\u0000${handoff}`;const pair=uses.get(key)||{emits:new Set<string>(),triggers:new Set<string>()};pair.emits.add(job.id);uses.set(key,pair);}
    }
  }
  const grouped=new Map<string,string[]>();
  for(const [key,pair] of uses){
    if(pair.emits.size&&pair.triggers.size)continue;
    const [repositoryId,handoff]=key.split('\u0000');
    const direction=pair.emits.size?'trigger':'emit';
    const group=`${handoff}\u0000${direction}`;
    grouped.set(group,[...(grouped.get(group)||[]),repositoryId]);
  }
  return [...grouped].map(([key,ids])=>{
    const [name,direction]=key.split('\u0000');
    const target=ids.length===1?repositories.find(repo=>repo.id===ids[0])?.displayName||ids[0]:`${ids.length} repositories`;
    return `${name} must ${direction==='trigger'?'trigger an automation':'be emitted by an automation'} for ${target}.`;
  });
}
