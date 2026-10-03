import { api, inTauri } from './api';
import { listen } from '@tauri-apps/api/event';
import { useSyncExternalStore } from 'react';
import { addAutomationNotice } from './automationNotifications';
import type { Provider } from './conversationCache';
import { getAgentChat, latestAgentChat, runExternalAutomation, sendAgentMessage, waitForAgentChat, type AgentProfile } from './agentChats';
import { automationAccount } from './automationAccounts';
import { appendAutomationOutput, beginAutomationOutput, endAutomationOutput } from './automationOutput';
import { repositoryHistoryWorking } from './conversationCache';
import { currentChatgptAccounts, refreshChatgptAccounts } from './chatgptAccounts';
import { currentExternalIdentities, refreshExternalIdentities } from './externalIdentities';

export type Trigger = 'manual' | 'interval' | 'afterIdle' | 'fileChange' | 'changeCount' | 'commit' | 'handoff';
export type GitAction = 'fetch'|'pull'|'push'|'stage'|'unstage'|'commit';
export type AutomationDraft = {repositoryId:string;provider?:Provider;threadId?:string;prompt:string;title?:string};
export type SavedPrompt = {id:string;repositoryId:string;repositoryIds?:string[];repositoryLabels?:Record<string,string>;includeFutureRepositories?:boolean;runtimeTarget?:boolean;accountsByRepository?:Record<string,{profile:AgentProfile;route:'profile'|'identity'}>;provider:Provider;threadId:string;title:string;prompt:string;trigger:Trigger;minutes:number;debounceSeconds?:number;changeThreshold?:number;commitBranch?:string;commitAllExcept?:boolean;handoffName?:string;emitsHandoffs?:string[];enabled:boolean;nextAt:number;editor:'cursor'|'vscode';kind?:'prompt'|'git'|'shell'|'notification';gitAction?:GitAction;target?:'existing'|'new';profile?:AgentProfile;route?:'profile'|'identity';mode?:'analyze'|'edit';handoffOnly?:boolean;lastAt?:number;lastResult?:string;state?:'running'|'accepted'|'completed'|'error';sawWorking?:boolean};
const key='gitcerberus.savedPrompts.v1';
const listeners=new Set<()=>void>();
const running=new Set<string>();
const pendingChanges=new Map<string,{changedAt:number}>();
const debounceTimers=new Map<string,number>();
const lastTriggeredCounts=new Map<string,{head:string;count:number}>();
const commitHeads=new Map<string,string>();
const pendingCommits=new Map<string,number>();
export type HandoffClaim={id:string;path:string;name:string;repositoryId:string};
export function validHandoffName(name:string){return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name);}
export function commitBranchPatterns(value:string){return value.split(',').map(part=>part.trim()).filter(Boolean);}
export function validCommitBranchPatterns(value:string){const parts=commitBranchPatterns(value);return parts.length>0&&parts.every(part=>part==='*'||(!part.startsWith('/')&&!part.endsWith('/')&&!part.includes('..')&&![...part].some(char=>/\s/.test(char)||'~^:?[]\\'.includes(char))));}
export function matchesCommitBranch(branch:string,patterns:string,allExcept=false){const matched=commitBranchPatterns(patterns).some(pattern=>new RegExp(`^${pattern.split('*').map(part=>part.replace(/[|\\{}()[\]\^$+?.]/g,'\\$&')).join('.*')}$`).test(branch));return allExcept?!matched:matched;}
export function automationPromptWithHandoffs(prompt:string,incoming?:HandoffClaim,outgoing:Record<string,string>={}){
  const instructions:string[]=[];
  if(incoming)instructions.push(`Read the incoming ${incoming.name} handoff payload at ${JSON.stringify(incoming.path)} before acting. Treat it as context from the previous agent. References to reading "the handoff" mean this payload.`);
  for(const [name,path] of Object.entries(outgoing))instructions.push(`If you need to emit the ${name} handoff, write its UTF-8 payload to ${JSON.stringify(path)}. The parent directory already exists. Write this file only when that handoff should be emitted.${Object.keys(outgoing).length===1?' References to writing "the handoff" mean this file.':''}`);
  return instructions.length?`Handoff instructions (managed by the app; follow these before the task below):\n${instructions.join('\n')}\n\nTask:\n${prompt}`:prompt;
}
const workingRepositories=new Map<string,Set<string>>();
const workingListeners=new Set<()=>void>();
function setRepositoryWorking(repositoryId:string,jobId:string,working:boolean){
  const next=new Set(workingRepositories.get(repositoryId)||[]);
  if(working)next.add(jobId);else next.delete(jobId);
  if(next.size)workingRepositories.set(repositoryId,next);else workingRepositories.delete(repositoryId);
  for(const listener of workingListeners)listener();
}
export function useAutomationWorking(repositoryId:string){return useSyncExternalStore(listener=>{workingListeners.add(listener);return()=>{workingListeners.delete(listener);};},()=>!!workingRepositories.get(repositoryId)?.size);}
let watchedRepositoryIds=new Set<string>();
let lastHandoffCleanupAt=0;
let jobs:SavedPrompt[]=read();
let checking=false;

function read():SavedPrompt[] {try {const data=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(data)?data.filter(item=>item&&typeof item.id==='string'&&typeof item.prompt==='string'&&typeof item.threadId==='string').map(item=>item.kind==='git'||item.kind==='shell'||item.kind==='notification'||item.target==='new'?item:{...item,enabled:false,state:'error',lastResult:'Existing-conversation delivery was retired. Create a new in-app automation from this prompt.'}):[];}catch{return [];}}
function publish(next:SavedPrompt[]){const serialized=JSON.stringify(next);localStorage.setItem(key,serialized);if(localStorage.getItem(key)!==serialized)throw new Error('Automation could not be saved on this device.');jobs=next;for(const listener of listeners)listener();}
export function subscribeSavedPrompts(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function savedPrompts(){return jobs;}
export function savePrompt(job:SavedPrompt){publish(jobs.some(item=>item.id===job.id)?jobs.map(item=>item.id===job.id?job:item):[...jobs,job]);}
export function removePrompt(id:string){publish(jobs.filter(item=>item.id!==id));}
export function reorderSavedPrompts(ids:string[]){
  if(ids.length!==jobs.length||new Set(ids).size!==jobs.length||ids.some(id=>!jobs.some(job=>job.id===id)))throw new Error('Automation order is out of date.');
  const byId=new Map(jobs.map(job=>[job.id,job]));publish(ids.map(id=>byId.get(id)!));
}
function change(id:string,update:Partial<SavedPrompt>){publish(jobs.map(job=>job.id===id?{...job,...update}:job));}
async function repositoryAgentBusy(repositoryId:string){
  if(latestAgentChat(repositoryId)?.running)return true;
  const status=await Promise.allSettled([api.codexThreads(repositoryId,false),api.cursorThreads(repositoryId,false)]);
  if(status.some(item=>item.status==='fulfilled'&&item.value.data.some(thread=>thread.working)))return true;
  return status.every(item=>item.status==='fulfilled')?false:repositoryHistoryWorking(repositoryId);
}

export async function runSavedPrompt(id:string,manual=false,runtimeRepositoryId?:string,incoming?:HandoffClaim):Promise<void>{
  const job=jobs.find(item=>item.id===id);if(!job||job.handoffOnly||running.has(id)||job.state==='running'){if(incoming)await api.releaseHandoff(incoming.repositoryId,incoming.name,incoming.id);return;}
  if(!manual&&!job.enabled){if(incoming)await api.releaseHandoff(incoming.repositoryId,incoming.name,incoming.id);return;}
  if(job.kind!=='git'&&job.kind!=='shell'&&job.kind!=='notification'&&job.target!=='new'){if(incoming)await api.releaseHandoff(incoming.repositoryId,incoming.name,incoming.id);change(id,{state:'error',enabled:false,lastResult:'Existing-conversation delivery was retired. Create a new in-app automation from this prompt.'});return;}
  running.add(id);
  let incomingStarted=false;
  try{
    change(id,{state:'running',lastResult:'Running automation…'});
    const useLiveRepositories=job.includeFutureRepositories||(manual&&job.trigger==='manual');
    let repositories=useLiveRepositories?await api.repositories():[];
    if(job.includeFutureRepositories&&job.kind==='prompt'&&job.provider==='copilot'){
      try{await api.githubRepositories();repositories=await api.repositories();}
      catch{/* Explicit repository assignments can still run when catalog refresh fails. */}
    }
    const targets=[...new Set(useLiveRepositories?repositories.filter(item=>item.localPresent!==false&&item.localPath).map(item=>item.id):(job.repositoryIds?.length?job.repositoryIds:[job.repositoryId]))];
    if(manual&&!runtimeRepositoryId)throw new Error('Choose one repository for this manual run.');
    if(runtimeRepositoryId){if(!targets.includes(runtimeRepositoryId))throw new Error('The selected repository is outside this automation’s target scope.');targets.splice(0,targets.length,runtimeRepositoryId);}
    if(!targets.length)throw new Error('Select at least one repository.');
    if(job.kind==='prompt'&&job.includeFutureRepositories){await Promise.all([refreshChatgptAccounts(),refreshExternalIdentities(true)]);}
    const results:string[]=[];let failures=0;
    if(job.kind==='shell')beginAutomationOutput(id);
    for(const repositoryId of targets){
      const repositoryLabel=job.repositoryLabels?.[repositoryId]||repositories.find(item=>item.id===repositoryId)?.displayName||repositoryId;
      setRepositoryWorking(repositoryId,id,true);
      if(job.kind==='notification'){
        incomingStarted=true;
        addAutomationNotice({automationId:id,repositoryId,title:`${job.title} · ${repositoryLabel}`,message:job.prompt,status:'message'});
        results.push(`${repositoryLabel}: Notification sent.`);change(id,{lastResult:results.join('\n')});
        const key=`${id}:${repositoryId}`;pendingChanges.delete(key);window.clearTimeout(debounceTimers.get(key));debounceTimers.delete(key);
        setRepositoryWorking(repositoryId,id,false);continue;
      }
      addAutomationNotice({automationId:id,repositoryId,title:`${job.title} started`,message:repositoryLabel,status:'started'});
      const runId=crypto.randomUUID(),createdAt=Date.now();
      const outgoing:Record<string,string>={};
      for(const name of job.emitsHandoffs||[])outgoing[name]=await api.handoffOutputPath(repositoryId,name,runId);
      const actionPrompt=automationPromptWithHandoffs(job.prompt,incoming?.repositoryId===repositoryId?incoming:undefined,outgoing);
      let stdout='',stderr='',response='',activity='',result='',failure='',agentStarted=false;
      try{
        if(job.kind==='shell'){incomingStarted=true;const shell=await api.runAutomationShell(repositoryId,job.prompt,chunk=>{
          if(chunk.stream==='stderr')stderr=(stderr+chunk.text).slice(-2_000_000);else stdout=(stdout+chunk.text).slice(-2_000_000);
          appendAutomationOutput(id,{repositoryId,stream:chunk.stream==='stderr'?'stderr':'stdout',text:chunk.text});
        },incoming?.repositoryId===repositoryId?incoming.path:undefined,outgoing);result=shell.result;stdout=shell.stdout||shell.result;stderr=shell.stderr;}
        else if(job.kind==='git'){
          if(!job.gitAction)throw new Error('Choose a Git action.');
          incomingStarted=true;
          const args=job.gitAction==='commit'?{message:job.prompt}:job.gitAction==='stage'||job.gitAction==='unstage'?{path:job.prompt}:{};
          await api.git(repositoryId,job.gitAction,args);
          result=`Git ${job.gitAction} completed.`;
        }else{
          const repository=repositories.find(item=>item.id===repositoryId);
          const chatgpt=currentChatgptAccounts();
          const account=job.accountsByRepository?.[repositoryId]||(repository?automationAccount(repository,job.provider,chatgpt.profiles,chatgpt.settings,currentExternalIdentities(),await api.identities()):undefined)|| (job.profile&&job.route?{profile:job.profile,route:job.route}:undefined);
          if(!account)throw new Error('The assigned agent account is unavailable.');
          agentStarted=true;incomingStarted=true;
          if(account.route==='profile'){
            const chatId=await sendAgentMessage(repositoryId,account.profile,actionPrompt,job.mode||'edit',undefined,[],undefined,true);
            result=await waitForAgentChat(chatId);
            activity=getAgentChat(chatId)?.activity||'';
          }else {const run=await runExternalAutomation(repositoryId,account.profile,actionPrompt,job.mode||'edit');result=run.text;activity=getAgentChat(run.chatId)?.activity||'';}
          response=result;
          window.dispatchEvent(new CustomEvent('saved-prompt-finished',{detail:{repositoryId,provider:job.provider}}));
        }
      }catch(error){failure=String(error);failures++;if(agentStarted){const recent=latestAgentChat(repositoryId);if(recent&&recent.updatedAt>=createdAt)activity=recent.activity||activity;}}
      for(const name of Object.keys(outgoing)){try{if(await api.publishHandoff(repositoryId,name,runId))void tick();}catch(error){failure=[failure,`Could not emit ${name}: ${String(error)}`].filter(Boolean).join(' · ');failures++;}}
      try{
        await api.writeAutomationLog({automationId:id,repositoryId,runId,createdAt,kind:job.kind==='shell'?'shell':job.kind==='git'?'git':'agent',status:failure?'error':'completed',command:job.prompt,stdout,stderr:failure?[stderr,failure].filter(Boolean).join('\n'):stderr,response,activity});
      }catch(error){failure=[failure,`Log could not be saved: ${String(error)}`].filter(Boolean).join(' · ');if(!failure.includes(' · '))failures++;}
      addAutomationNotice({automationId:id,repositoryId,title:`${job.title} ${failure?'failed':'completed'}`,message:`${repositoryLabel}${failure?` · ${failure}`:''}`,status:failure?'failed':'completed'});
      results.push(`${repositoryLabel}: ${(failure||result).slice(0,500)}`);
      change(id,{lastResult:results.join('\n')});
      if(job.trigger==='fileChange'||job.trigger==='changeCount'){
        const key=`${id}:${repositoryId}`;pendingChanges.delete(key);
        window.clearTimeout(debounceTimers.get(key));debounceTimers.delete(key);
      }
      setRepositoryWorking(repositoryId,id,false);
    }
    if(job.kind==='shell')endAutomationOutput(id);
    change(id,{state:failures?'error':'completed',enabled:failures?false:job.enabled,lastResult:results.join('\n'),lastAt:Date.now(),nextAt:Date.now()+job.minutes*60_000});
  }catch(error){addAutomationNotice({automationId:id,title:`${job.title} failed`,message:String(error),status:'failed'});try{change(id,{state:'error',lastResult:String(error),lastAt:Date.now(),enabled:false});}catch{window.dispatchEvent(new CustomEvent('automation-storage-error',{detail:String(error)}));}}
  finally{if(incoming)try{if(incomingStarted)await api.finishHandoff(incoming.repositoryId,incoming.name,incoming.id);else await api.releaseHandoff(incoming.repositoryId,incoming.name,incoming.id);}catch(error){console.warn('Could not finish handoff:',error);}running.delete(id);for(const [repositoryId,active] of workingRepositories)if(active.has(id))setRepositoryWorking(repositoryId,id,false);if(job.kind==='shell')endAutomationOutput(id);}
}

async function tick(now=Date.now()){
  if(checking)return;checking=true;
  try{
    const fileJobs=jobs.filter(job=>job.enabled&&(job.trigger==='fileChange'||job.trigger==='changeCount')&&job.state!=='running'&&!running.has(job.id));
    for(const job of fileJobs){
      for(const [key,pending] of pendingChanges){
        if(!key.startsWith(`${job.id}:`)||now-pending.changedAt<Math.max(30,job.debounceSeconds||300)*1000)continue;
        const repositoryId=key.slice(job.id.length+1);
        if(running.has(job.id)||await repositoryAgentBusy(repositoryId))continue;
        if(job.trigger==='changeCount'){
          let summary:{head:string;changedLines:number};try{summary=await api.repositoryChangeSummary(repositoryId);}catch{continue;}
          const previous=lastTriggeredCounts.get(key);
          const baseline=previous?.head===summary.head&&summary.changedLines>=previous.count?previous.count:0;
          if(summary.changedLines<baseline+Math.max(1,job.changeThreshold||10)){pendingChanges.delete(key);continue;}
          lastTriggeredCounts.set(key,{head:summary.head,count:summary.changedLines});
        }
        pendingChanges.delete(key);window.clearTimeout(debounceTimers.get(key));debounceTimers.delete(key);
        void runSavedPrompt(job.id,false,repositoryId);
        break;
      }
    }
    for(const job of jobs.filter(item=>item.enabled&&item.trigger==='commit'&&item.state!=='running'&&!running.has(item.id))){
      for(const key of pendingCommits.keys()){
        if(!key.startsWith(`${job.id}:`))continue;
        const repositoryId=key.slice(job.id.length+1);
        if(job.kind!=='notification'&&await repositoryAgentBusy(repositoryId))continue;
        pendingCommits.delete(key);void runSavedPrompt(job.id,false,repositoryId);break;
      }
    }
    let futureHandoffTargets:string[]|undefined;
    for(const job of jobs.filter(item=>item.enabled&&item.trigger==='handoff'&&validHandoffName(item.handoffName||'')&&item.state!=='running'&&!running.has(item.id))){
      if(job.includeFutureRepositories&&!futureHandoffTargets)futureHandoffTargets=inTauri()?[...watchedRepositoryIds]:(await api.repositories()).filter(repo=>repo.localPresent!==false&&repo.localPath).map(repo=>repo.id);
      const targets=job.includeFutureRepositories?futureHandoffTargets!:(job.repositoryIds?.length?job.repositoryIds:[job.repositoryId]);
      for(const repositoryId of targets){
        if(!repositoryId||running.has(job.id))break;
        try{if(!await api.hasPendingHandoff(repositoryId,job.handoffName!))continue;}catch(error){console.warn('Could not inspect handoff:',error);continue;}
        if(job.kind!=='notification'&&await repositoryAgentBusy(repositoryId))continue;
        let claim:{id:string;path:string}|null;
        try{claim=await api.claimHandoff(repositoryId,job.handoffName!);}catch(error){console.warn('Could not claim handoff:',error);continue;}
        if(claim){void runSavedPrompt(job.id,false,repositoryId,{...claim,name:job.handoffName!,repositoryId});break;}
      }
    }
    for(const job of [...jobs]){
      if(!job.enabled||job.state==='running'||running.has(job.id)||job.trigger==='manual')continue;
      if(job.trigger==='interval'){
        if(now>=job.nextAt)void runSavedPrompt(job.id);
        continue;
      }
    }
  }finally{checking=false;}
}
export function checkSavedPromptSchedule(now?:number){return tick(now);}
export function recordAutomationFileChange(repositoryId:string,occurredAt=Date.now()){
  for(const job of jobs){
    if(!job.enabled||(job.trigger!=='fileChange'&&job.trigger!=='changeCount')||job.state==='running'||running.has(job.id))continue;
    const targets=job.repositoryIds?.length?job.repositoryIds:[job.repositoryId];
    if(!(job.includeFutureRepositories?watchedRepositoryIds.has(repositoryId):targets.includes(repositoryId)))continue;
    const key=`${job.id}:${repositoryId}`;
    pendingChanges.set(key,{changedAt:occurredAt});
    window.clearTimeout(debounceTimers.get(key));
    debounceTimers.set(key,window.setTimeout(()=>void tick(),Math.max(30,job.debounceSeconds||300)*1000));
  }
}
export async function recordAutomationCommit(repositoryId:string,state?:{head:string;branch:string;reflog:string}){
  const current=state||await api.repositoryCommitState(repositoryId);
  const previous=commitHeads.get(repositoryId);
  commitHeads.set(repositoryId,current.head);
  if(previous===undefined||previous===current.head||!current.head||!/^(commit|merge|cherry-pick)(?:\b|\s*\()/i.test(current.reflog))return;
  for(const job of jobs){
    if(!job.enabled||job.trigger!=='commit'||!matchesCommitBranch(current.branch,job.commitBranch||'',job.commitAllExcept))continue;
    const targets=job.repositoryIds?.length?job.repositoryIds:[job.repositoryId];
    if(job.includeFutureRepositories?watchedRepositoryIds.has(repositoryId):targets.includes(repositoryId))pendingCommits.set(`${job.id}:${repositoryId}`,Date.now());
  }
  void tick();
}
async function syncFileWatchers(){
  if(!inTauri())return;
  const repositories=await api.repositories();
  const ids=repositories.filter(repo=>repo.localPresent!==false&&repo.localPath).map(repo=>repo.id);
  watchedRepositoryIds=new Set(ids);
  const fresh=ids.filter(id=>!commitHeads.has(id));
  if(fresh.length){const states=await api.repositoryCommitStatesBatch(fresh);for(const [id,state] of Object.entries(states))commitHeads.set(id,state.head);}
  for(const id of commitHeads.keys())if(!watchedRepositoryIds.has(id))commitHeads.delete(id);
  const errors=await api.watchAutomationRepositories(ids);
  if(errors.length)console.warn('Automation file watchers:',errors.join('; '));
  if(Date.now()-lastHandoffCleanupAt>30*60_000){lastHandoffCleanupAt=Date.now();void api.cleanupStaleHandoffs(ids).catch(error=>console.warn('Handoff cleanup:',error));}
}
export function startSavedPromptScheduler(){
  // The dashboard remains mounted when the Tauri window is hidden. A crash or
  // restart leaves a running job paused for inspection instead of retrying it.
  let stopped=false;let unlisten:(()=>void)|undefined;let unlistenGit:(()=>void)|undefined;
  if(inTauri())void listen<{repositoryId:string;occurredAt:number}>('automation-file-change',event=>recordAutomationFileChange(event.payload.repositoryId,event.payload.occurredAt)).then(stop=>{if(stopped)stop();else unlisten=stop;});
  if(inTauri())void listen<{repositoryId:string}>('automation-git-change',event=>void recordAutomationCommit(event.payload.repositoryId).catch(error=>console.warn('Commit automation:',error))).then(stop=>{if(stopped)stop();else unlistenGit=stop;});
  void syncFileWatchers();
  let watcherScope=JSON.stringify(jobs.map(job=>[job.id,job.trigger,job.repositoryIds,job.repositoryId,job.includeFutureRepositories]));
  const unsubscribe=subscribeSavedPrompts(()=>{const next=JSON.stringify(jobs.map(job=>[job.id,job.trigger,job.repositoryIds,job.repositoryId,job.includeFutureRepositories]));if(next!==watcherScope){watcherScope=next;void syncFileWatchers();}});
  void tick();const timer=window.setInterval(()=>{void tick();void syncFileWatchers();},30_000);
  const handoffTimer=window.setInterval(()=>{if(jobs.some(job=>job.enabled&&job.trigger==='handoff'))void tick();},2000);
  return()=>{stopped=true;unlisten?.();unlistenGit?.();unsubscribe();window.clearInterval(timer);window.clearInterval(handoffTimer);for(const timeout of debounceTimers.values())window.clearTimeout(timeout);debounceTimers.clear();};
}
