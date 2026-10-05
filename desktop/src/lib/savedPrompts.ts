import { beginAutomationLog, updateAutomationLog, finishAutomationLog, currentAutomationLogs } from './automationLogs';
import { api, inTauri, type GithubCiRun, type GithubRepositoryEvent, type AutomationLog } from './api';
import { listen } from '@tauri-apps/api/event';
import { useSyncExternalStore } from 'react';
import { addAutomationNotice } from './automationNotifications';
import type { Provider } from './conversationCache';
import { getAgentChat, latestAgentChat, subscribeAgentChats, runExternalAutomation, sendAgentMessage, waitForAgentChat, type AgentProfile } from './agentChats';
import { automationAccount } from './automationAccounts';
import { appendAutomationOutput, beginAutomationOutput, endAutomationOutput } from './automationOutput';
import { isGithubRemote } from './repositories';
import { repositoryHistoryWorking } from './conversationCache';
import { currentChatgptAccounts, refreshChatgptAccounts } from './chatgptAccounts';
import { currentExternalIdentities, refreshExternalIdentities } from './externalIdentities';

export type Trigger = 'manual' | 'interval' | 'afterIdle' | 'fileChange' | 'changeCount' | 'commit' | 'ciPass' | 'ciFail' | 'handoff' | 'idleTime' | 'push' | 'pullRequest';
export type GitAction = 'fetch'|'pull'|'push'|'stage'|'unstage'|'commit';
export type AutomationDraft = {repositoryId:string;provider?:Provider;threadId?:string;prompt:string;title?:string};
export type SavedPrompt = {id:string;repositoryId:string;repositoryIds?:string[];repositoryLabels?:Record<string,string>;includeFutureRepositories?:boolean;runtimeTarget?:boolean;accountsByRepository?:Record<string,{profile:AgentProfile;route:'profile'|'identity'}>;provider:Provider;threadId:string;title:string;prompt:string;trigger:Trigger;conditions?:Trigger[];model?:string;reasoningEffort?:string;minutes:number;debounceSeconds?:number;changeThreshold?:number;commitBranch?:string;commitAllExcept?:boolean;ciSince?:number;handoffName?:string;handoffVariables?:string[];emitsHandoffs?:string[];enabled:boolean;nextAt:number;editor:'cursor'|'vscode';kind?:'prompt'|'git'|'shell'|'notification';gitAction?:GitAction;target?:'existing'|'new';profile?:AgentProfile;route?:'profile'|'identity';mode?:'analyze'|'edit';handoffOnly?:boolean;lastAt?:number;lastResult?:string;state?:'running'|'accepted'|'completed'|'error';sawWorking?:boolean};
export function automationConditions(job:SavedPrompt):Trigger[]{return job.conditions?.length&&job.conditions[0]===job.trigger?job.conditions:[job.trigger];}
const exclusiveEvents=new Set<Trigger>(['commit','ciPass','ciFail']);
export function conditionsCompatible(current:Trigger[],next:Trigger){return !current.includes(next)&&!(next==='manual'||current.includes('manual'))&&!(exclusiveEvents.has(next)&&current.some(item=>exclusiveEvents.has(item)));}
const key='gitcerberus.savedPrompts.v1';
const listeners=new Set<()=>void>();
const running=new Set<string>();
const pendingChanges=new Map<string,{changedAt:number}>();
const debounceTimers=new Map<string,number>();
const lastTriggeredCounts=new Map<string,{head:string;count:number}>();
const commitHeads=new Map<string,Map<string,string>>();
const commitChecks=new Map<string,Promise<void>>();
const pendingCommits=new Map<string,{branch:string;sha:string}[]>();
const pendingCi=new Map<string,{jobId:string;repositoryId:string;run:GithubCiRun}>();
type ConditionEvent={at:number;branch?:string;sha?:string;ciRun?:GithubCiRun};
const pendingConditionEvents=new Map<string,{jobId:string;repositoryId:string;events:Partial<Record<Trigger,ConditionEvent>>}>();
const githubEventKey='gitcerberus.automationGithubEvents.v1';
const githubEventSeen:Record<string,string[]>=(()=>{try{return JSON.parse(localStorage.getItem(githubEventKey)||'{}');}catch{return {};}})();
let checkingGithubEvents=false;
function composite(job:SavedPrompt){const conditions=automationConditions(job);return !!job.conditions?.length&&(conditions.length>1||conditions.some(condition=>condition==='fileChange'||condition==='changeCount'||condition==='idleTime'||condition==='push'||condition==='pullRequest'));}
function scopedTo(job:SavedPrompt,repositoryId:string){return job.includeFutureRepositories?watchedRepositoryIds.has(repositoryId)||!inTauri():(job.repositoryIds?.length?job.repositoryIds:[job.repositoryId]).includes(repositoryId);}
export function recordConditionEvent(repositoryId:string,condition:Trigger,at=Date.now(),details:Omit<ConditionEvent,'at'>={}){
  for(const job of jobs){
    if(!job.enabled||!composite(job)||!automationConditions(job).includes(condition)||!scopedTo(job,repositoryId))continue;
    if(details.branch&&!matchesCommitBranch(details.branch,job.commitBranch||'*',job.commitAllExcept))continue;
    const key=`${job.id}:${repositoryId}`,pending=pendingConditionEvents.get(key)||{jobId:job.id,repositoryId,events:{}};
    pending.events[condition]={at,...details};pendingConditionEvents.set(key,pending);
    if(condition!=='idleTime'&&automationConditions(job).includes('idleTime'))pending.events.idleTime={at};
  }
  void tick();
}
const ciHandledKey='gitcerberus.automationCiHandled.v1';
function readCiHandled():Record<string,string[]>{try{const value=JSON.parse(localStorage.getItem(ciHandledKey)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).filter((entry):entry is [string,string[]]=>Array.isArray(entry[1])&&entry[1].every(item=>typeof item==='string'))):{};}catch{return {};}}
const ciHandled=readCiHandled();
let checkingCi=false;
function ciRunKey(run:GithubCiRun){return `${run.id}:${run.runAttempt||1}`;}
function matchesCiConclusion(trigger:Trigger,conclusion:string|null|undefined){return trigger==='ciPass'?conclusion==='success':trigger==='ciFail'&&(conclusion==='failure'||conclusion==='timed_out'||conclusion==='startup_failure');}
function ciCompletedSince(run:GithubCiRun,since=0){const updated=Date.parse(run.updatedAt);return Number.isFinite(updated)&&updated>=Math.floor(since/1000)*1000;}
function markCiHandled(jobId:string,repositoryId:string,run:GithubCiRun){
  const key=`${jobId}:${repositoryId}`,previous=ciHandled[key]||[];
  const next={...ciHandled,[key]:[...previous,ciRunKey(run)].slice(-200)};
  localStorage.setItem(ciHandledKey,JSON.stringify(next));
  Object.assign(ciHandled,next);
}
export type HandoffClaim={id:string;path:string;name:string;repositoryId:string};
export function validHandoffName(name:string){return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name);}
export function emittedHandoff(value:string){const conditional=value.startsWith('(')&&value.endsWith(')');return {name:conditional?value.slice(1,-1):value,conditional};}
export function validEmittedHandoff(value:string){return validHandoffName(emittedHandoff(value).name);}
export function commitBranchPatterns(value:string){return value.split(',').map(part=>part.trim()).filter(Boolean);}
export function validCommitBranchPatterns(value:string){const parts=commitBranchPatterns(value);return parts.length>0&&parts.every(part=>part==='*'||(!part.startsWith('/')&&!part.endsWith('/')&&!part.includes('..')&&![...part].some(char=>/\s/.test(char)||'~^:?[]\\'.includes(char))));}
export function matchesCommitBranch(branch:string,patterns:string,allExcept=false){const matched=commitBranchPatterns(patterns).some(pattern=>new RegExp(`^${pattern.split('*').map(part=>part.replace(/[|\\{}()[\]\^$+?.]/g,'\\$&')).join('.*')}$`).test(branch));return allExcept?!matched:matched;}
export function knownBranchSets(saved:SavedPrompt[],exceptId?:string){return [...new Set(saved.filter(job=>job.id!==exceptId).filter(job=>job.trigger!=='manual'&&!!job.commitBranch?.trim()&&validCommitBranchPatterns(job.commitBranch.trim())).map(job=>`${job.commitAllExcept?'All except: ':''}${job.commitBranch!.trim()}`))].sort((a,b)=>a.localeCompare(b));}
export function automationPromptWithHandoffs(prompt:string,incoming?:HandoffClaim,outgoing:Record<string,string>={},conditionalNames:string[]=[]){
  const instructions:string[]=[];
  if(incoming)instructions.push(`Read the incoming ${incoming.name} handoff payload at ${JSON.stringify(incoming.path)} before acting. Treat it as context from the previous agent. References to reading "the handoff" mean this payload.`);
  for(const [name,path] of Object.entries(outgoing))instructions.push(`${conditionalNames.includes(name)?`The ${name} handoff is conditional: emit it only if the task condition holds and you actively choose to do so. Otherwise leave its output file absent.`:`Emit the ${name} handoff after completing the task.`} To emit it, write its UTF-8 payload to ${JSON.stringify(path)}. The parent directory already exists. Write this file only when that handoff should be emitted. Handoff flags are boolean trigger variables. Interpret ordinary wording in the task such as "set v", "mark v as true", "raise the ready flag", or "set ready if the review passes" as instructions to set the named flag according to the stated condition. The user does not need to specify JSON syntax. When emitting flags, serialize them in a JSON object under "variables", for example {"variables":{"v":true},"details":"your context"}. Use actual JSON booleans true or false, preserve flag names and case, and keep the handoff context in other fields such as "details". Only set a flag true when the requested condition holds.${Object.keys(outgoing).length===1?' References to writing "the handoff" mean this file.':''}`);
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
let recheck=false;

function read():SavedPrompt[] {try {const data=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(data)?data.filter(item=>item&&typeof item.id==='string'&&typeof item.prompt==='string'&&typeof item.threadId==='string').map(item=>item.kind==='git'||item.kind==='shell'||item.kind==='notification'||item.target==='new'?item:{...item,enabled:false,state:'error',lastResult:'Existing-conversation delivery was retired. Create a new in-app automation from this prompt.'}):[];}catch{return [];}}
function publish(next:SavedPrompt[]){const serialized=JSON.stringify(next);localStorage.setItem(key,serialized);if(localStorage.getItem(key)!==serialized)throw new Error('Automation could not be saved on this device.');jobs=next;for(const listener of listeners)listener();}
export function subscribeSavedPrompts(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function savedPrompts(){return jobs;}
export function disableAutomation(id:string){change(id,{enabled:false});}
export function savePrompt(job:SavedPrompt){for(const key of pendingConditionEvents.keys())if(key.startsWith(`${job.id}:`))pendingConditionEvents.delete(key);publish(jobs.some(item=>item.id===job.id)?jobs.map(item=>item.id===job.id?job:item):[...jobs,job]);}
export function removePrompt(id:string){for(const key of pendingConditionEvents.keys())if(key.startsWith(`${id}:`))pendingConditionEvents.delete(key);publish(jobs.filter(item=>item.id!==id));for(const key of pendingCi.keys())if(key.startsWith(`${id}:`))pendingCi.delete(key);for(const key of Object.keys(ciHandled))if(key.startsWith(`${id}:`))delete ciHandled[key];try{localStorage.setItem(ciHandledKey,JSON.stringify(ciHandled));}catch{/* The removed job cannot run again. */}}
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

export async function runSavedPrompt(id:string,manual=false,runtimeRepositoryId?:string,incoming?:HandoffClaim,ciRun?:GithubCiRun,eventBranch?:string,eventSha?:string):Promise<void>{
  const job=jobs.find(item=>item.id===id);if(!job||job.handoffOnly||running.has(id)||job.state==='running'){if(incoming)await api.releaseHandoff(incoming.repositoryId,incoming.name,incoming.id);return;}
  if(!manual&&!job.enabled){if(incoming)await api.releaseHandoff(incoming.repositoryId,incoming.name,incoming.id);return;}
  running.add(id);
  let incomingStarted=false;
  let currentLog:AutomationLog|undefined;
  try{
    change(id,{state:'running',lastResult:'Running automation…'});
    if(job.kind!=='git'&&job.kind!=='shell'&&job.kind!=='notification'&&job.target!=='new')throw new Error('Existing-conversation delivery was retired. Create a new in-app automation from this prompt.');
    const useLiveRepositories=job.includeFutureRepositories||(manual&&job.trigger==='manual');
    let repositories=useLiveRepositories||job.kind==='shell'?await api.repositories():[];
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
      if(!manual&&((job.conditions?.length&&(job.commitBranch||'*')!=='*')||job.commitAllExcept)){
        const branch=eventBranch||ciRun?.headBranch||(await api.repositoryCommitState(repositoryId)).branch;
        if(!matchesCommitBranch(branch||'',job.commitBranch||'*',job.commitAllExcept))continue;
      }
      const repositoryLabel=job.repositoryLabels?.[repositoryId]||repositories.find(item=>item.id===repositoryId)?.displayName||repositoryId;
      setRepositoryWorking(repositoryId,id,true);
      const runId=crypto.randomUUID(),createdAt=Date.now();
      const log={automationId:id,repositoryId,runId,createdAt,kind:job.kind==='shell'?'shell' as const:job.kind==='git'?'git' as const:job.kind==='notification'?'notification' as const:'agent' as const,status:'running' as const,command:job.prompt,stdout:'',stderr:'',response:'',activity:''};
      currentLog=log;
      await beginAutomationLog(log);
      if(job.kind==='notification'){
        incomingStarted=true;
        addAutomationNotice({automationId:id,repositoryId,title:`${job.title} · ${repositoryLabel}`,message:job.prompt,status:'message'});
        const emissionId=runId;let emissionError='';
        for(const {name,conditional} of (job.emitsHandoffs||[]).map(emittedHandoff)){if(conditional)continue;try{if(await api.publishHandoff(repositoryId,name,emissionId,job.prompt))void tick();}catch(error){failures++;emissionError+=` Could not emit ${name}: ${String(error)}`;}}
        await finishAutomationLog({...log,status:emissionError?'error':'completed',response:job.prompt,stderr:emissionError});
        currentLog=undefined;
        if(emissionError)addAutomationNotice({automationId:id,repositoryId,runId,title:`${job.title} failed`,message:`${repositoryLabel} · ${emissionError}`,status:'failed'});
        results.push(`${repositoryLabel}: Notification sent.${emissionError}`);change(id,{lastResult:results.join('\n')});
        const key=`${id}:${repositoryId}`;pendingChanges.delete(key);window.clearTimeout(debounceTimers.get(key));debounceTimers.delete(key);
        setRepositoryWorking(repositoryId,id,false);continue;
      }
      addAutomationNotice({automationId:id,repositoryId,title:`${job.title} started`,message:repositoryLabel,status:'started'});
      const outgoing:Record<string,string>={};
      const ciContext=ciRun?`GitHub Actions ${ciRun.conclusion==='success'?'passed':'failed'}: ${ciRun.name}. Branch: ${ciRun.headBranch||'unknown'}. Commit: ${ciRun.headSha}. Run: ${ciRun.htmlUrl}.\n\n`:'';
      let stdout='',stderr='',response='',activity='',result='',failure='',agentStarted=false;
      const unsubscribeProgress=subscribeAgentChats(()=>{const chat=latestAgentChat(repositoryId);if(chat&&chat.updatedAt>=createdAt){activity=chat.activity.slice(-2_000_000);response=chat.messages.filter(message=>message.role==='assistant').map(message=>message.text).join('\n\n').slice(-2_000_000);updateAutomationLog(log,{response,activity});}});
      try{
        for(const {name} of (job.emitsHandoffs||[]).map(emittedHandoff))outgoing[name]=await api.handoffOutputPath(repositoryId,name,runId);
        const actionPrompt=automationPromptWithHandoffs(ciContext+job.prompt,incoming?.repositoryId===repositoryId?incoming:undefined,outgoing,(job.emitsHandoffs||[]).map(emittedHandoff).filter(item=>item.conditional).map(item=>item.name));
        if(job.kind==='shell'){incomingStarted=true;const shell=await api.runAutomationShell(repositoryId,job.prompt,chunk=>{
          if(chunk.stream==='stderr')stderr=(stderr+chunk.text).slice(-2_000_000);else stdout=(stdout+chunk.text).slice(-2_000_000);
          updateAutomationLog(log,{stdout,stderr});
          appendAutomationOutput(id,{repositoryId,stream:chunk.stream==='stderr'?'stderr':'stdout',text:chunk.text});
        },incoming?.repositoryId===repositoryId?incoming.path:undefined,outgoing,{CERBERUS_REPOSITORY_ID:repositoryId,CERBERUS_REPOSITORY_NAME:repositoryLabel,CERBERUS_AUTOMATION_ID:id,CERBERUS_AUTOMATION_NAME:job.title,CERBERUS_RUN_ID:runId,CERBERUS_CONDITIONS:manual?'manual':automationConditions(job).join(','),CERBERUS_BRANCH:eventBranch||ciRun?.headBranch||'',CERBERUS_COMMIT_SHA:eventSha||ciRun?.headSha||'',CERBERUS_CI_RUN_URL:ciRun?.htmlUrl||'',CERBERUS_CI_CONCLUSION:ciRun?.conclusion||''});result=shell.result;stdout=shell.stdout||shell.result;stderr=shell.stderr;}
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
            const chatId=await sendAgentMessage(repositoryId,account.profile,actionPrompt,job.mode==='analyze'?'analyze':'full',undefined,[],undefined,true,false,job.model,undefined,job.reasoningEffort);
            result=await waitForAgentChat(chatId);
            activity=getAgentChat(chatId)?.activity||'';
          }else {const run=await runExternalAutomation(repositoryId,account.profile,actionPrompt,job.mode==='analyze'?'analyze':'full');result=run.text;activity=getAgentChat(run.chatId)?.activity||'';}
          response=result;
          window.dispatchEvent(new CustomEvent('saved-prompt-finished',{detail:{repositoryId,provider:job.provider}}));
        }
      }catch(error){failure=String(error);failures++;if(agentStarted){const recent=latestAgentChat(repositoryId);if(recent&&recent.updatedAt>=createdAt)activity=recent.activity||activity;}}
      unsubscribeProgress();
      for(const name of Object.keys(outgoing)){try{if(await api.publishHandoff(repositoryId,name,runId))void tick();}catch(error){failure=[failure,`Could not emit ${name}: ${String(error)}`].filter(Boolean).join(' · ');failures++;}}
      try{
        await finishAutomationLog({automationId:id,repositoryId,runId,createdAt,kind:job.kind==='shell'?'shell':job.kind==='git'?'git':'agent',status:failure?'error':'completed',command:job.prompt,stdout,stderr:failure?[stderr,failure].filter(Boolean).join('\n'):stderr,response,activity});
      }catch(error){failure=[failure,`Log could not be saved: ${String(error)}`].filter(Boolean).join(' · ');if(!failure.includes(' · '))failures++;}
      currentLog=undefined;
      addAutomationNotice({automationId:id,repositoryId,runId,title:`${job.title} ${failure?'failed':'completed'}`,message:`${repositoryLabel}${failure?` · ${failure}`:''}`,status:failure?'failed':'completed'});
      results.push(`${repositoryLabel}: ${(failure||result).slice(0,500)}`);
      change(id,{lastResult:results.join('\n')});
      if(job.trigger==='fileChange'||job.trigger==='changeCount'){
        const key=`${id}:${repositoryId}`;pendingChanges.delete(key);
        window.clearTimeout(debounceTimers.get(key));debounceTimers.delete(key);
      }
      setRepositoryWorking(repositoryId,id,false);
    }
    if(job.kind==='shell')endAutomationOutput(id);
    change(id,{state:failures?'error':'completed',lastResult:results.join('\n'),lastAt:Date.now(),nextAt:Date.now()+job.minutes*60_000});
  }catch(error){
    const failedLog=currentLog||{automationId:id,repositoryId:runtimeRepositoryId||job.repositoryId,runId:crypto.randomUUID(),createdAt:Date.now(),kind:job.kind==='shell'?'shell':job.kind==='git'?'git':job.kind==='notification'?'notification':'agent',status:'running',command:job.prompt,stdout:'',stderr:'',response:'',activity:''} as AutomationLog;
    const latest=currentAutomationLogs(id).find(item=>item.repositoryId===failedLog.repositoryId&&item.runId===failedLog.runId)||failedLog;
    try{await finishAutomationLog({...latest,status:'error',stderr:[latest.stderr,String(error)].filter(Boolean).join('\n')});}catch(logError){console.warn('Could not save failed automation log:',logError);}
    addAutomationNotice({automationId:id,repositoryId:failedLog.repositoryId,runId:failedLog.runId,title:`${job.title} failed`,message:String(error),status:'failed'});
    try{change(id,{state:'error',lastResult:String(error),lastAt:Date.now(),nextAt:Date.now()+job.minutes*60_000});}catch{window.dispatchEvent(new CustomEvent('automation-storage-error',{detail:String(error)}));}
  }
  finally{if(incoming)try{if(incomingStarted)await api.finishHandoff(incoming.repositoryId,incoming.name,incoming.id);else await api.releaseHandoff(incoming.repositoryId,incoming.name,incoming.id);}catch(error){console.warn('Could not finish handoff:',error);}running.delete(id);for(const [repositoryId,active] of workingRepositories)if(active.has(id))setRepositoryWorking(repositoryId,id,false);if(job.kind==='shell')endAutomationOutput(id);}
}

async function tick(now=Date.now()){
  if(checking){recheck=true;return;}checking=true;
  try{
    const fileJobs=jobs.filter(job=>job.enabled&&!composite(job)&&(job.trigger==='fileChange'||job.trigger==='changeCount')&&job.state!=='running'&&!running.has(job.id));
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
    for(const job of jobs.filter(item=>item.enabled&&!composite(item)&&item.trigger==='commit'&&item.state!=='running'&&!running.has(item.id))){
      for(const key of pendingCommits.keys()){
        if(!key.startsWith(`${job.id}:`))continue;
        const repositoryId=key.slice(job.id.length+1);
        if(job.kind!=='notification'&&await repositoryAgentBusy(repositoryId))continue;
        const queue=pendingCommits.get(key)!;const event=queue.shift()!;if(!queue.length)pendingCommits.delete(key);void runSavedPrompt(job.id,false,repositoryId,undefined,undefined,event.branch,event.sha);break;
      }
    }
    for(const [key,pending] of pendingCi){
      const job=jobs.find(item=>item.id===pending.jobId);
      if(!job||!job.enabled||composite(job)||(job.trigger!=='ciPass'&&job.trigger!=='ciFail')||!ciCompletedSince(pending.run,job.ciSince)||!matchesCommitBranch(pending.run.headBranch||'',job.commitBranch||'*',job.commitAllExcept)){pendingCi.delete(key);continue;}
      if(job.state==='running'||running.has(job.id))continue;
      if(job.kind!=='notification'&&await repositoryAgentBusy(pending.repositoryId))continue;
      try{markCiHandled(job.id,pending.repositoryId,pending.run);}catch(error){console.warn('Could not save handled CI run:',error);break;}
      pendingCi.delete(key);
      void runSavedPrompt(job.id,false,pending.repositoryId,undefined,pending.run);
    }
    for(const job of jobs.filter(item=>item.enabled&&composite(item)&&item.state!=='running'&&!running.has(item.id))){
      const conditions=automationConditions(job);
      if(conditions.includes('handoff')&&validHandoffName(job.handoffName||'')){
        const targets=job.includeFutureRepositories?(await api.repositories()).filter(repo=>repo.localPresent!==false&&repo.localPath).map(repo=>repo.id):(job.repositoryIds?.length?job.repositoryIds:[job.repositoryId]);
        for(const repositoryId of targets){
          if(pendingConditionEvents.get(`${job.id}:${repositoryId}`)?.events.handoff)continue;
          try{if(await api.hasPendingHandoff(repositoryId,job.handoffName!,job.handoffVariables))recordConditionEvent(repositoryId,'handoff',now);}catch(error){console.warn('Could not inspect handoff:',error);}
        }
      }
      if(conditions.includes('interval')&&now>=job.nextAt){
        const targets=job.includeFutureRepositories?(await api.repositories()).filter(repo=>repo.localPresent!==false&&repo.localPath).map(repo=>repo.id):(job.repositoryIds?.length?job.repositoryIds:[job.repositoryId]);
        for(const repositoryId of targets)recordConditionEvent(repositoryId,'interval',now);
        change(job.id,{nextAt:now+job.minutes*60_000});
      }
      for(const [key,pending] of pendingConditionEvents){
        if(pending.jobId!==job.id)continue;
        const latest=Math.max(...Object.values(pending.events).map(event=>event?.at||0));
        if(conditions.includes('idleTime')&&(!pending.events.idleTime||now-latest<Math.max(1,job.debounceSeconds||300)*1000))continue;
        if(conditions.some(condition=>condition!=='handoff'&&!pending.events[condition]))continue;
        if((job.commitBranch||'*')!=='*'||job.commitAllExcept){
          const branch=Object.values(pending.events).find(item=>item?.branch)?.branch||(await api.repositoryCommitState(pending.repositoryId)).branch;
          if(!matchesCommitBranch(branch||'',job.commitBranch||'*',job.commitAllExcept)){pendingConditionEvents.delete(key);continue;}
        }
        const pushSha=pending.events.push?.sha,ciSha=(pending.events.ciPass||pending.events.ciFail)?.sha;
        if(pushSha&&ciSha&&pushSha!==ciSha)continue;
        if(job.kind!=='notification'&&await repositoryAgentBusy(pending.repositoryId))continue;
        let claim:HandoffClaim|undefined;
        if(conditions.includes('handoff')){
          try{const found=await api.claimHandoff(pending.repositoryId,job.handoffName||'',job.handoffVariables);if(!found)continue;claim={...found,name:job.handoffName||'',repositoryId:pending.repositoryId};}
          catch(error){console.warn('Could not claim handoff:',error);continue;}
        }
        const event=Object.values(pending.events).find(item=>item?.ciRun)?.ciRun;
        pendingConditionEvents.delete(key);
        if(conditions.includes('changeCount')){try{const summary=await api.repositoryChangeSummary(pending.repositoryId);lastTriggeredCounts.set(`${job.id}:${pending.repositoryId}`,{head:summary.head,count:summary.changedLines});}catch{/* Retry from the last known count on the next change. */}}
        if(event)try{markCiHandled(job.id,pending.repositoryId,event);}catch(error){console.warn('Could not save handled CI run:',error);if(claim)await api.releaseHandoff(claim.repositoryId,claim.name,claim.id);continue;}
        void runSavedPrompt(job.id,false,pending.repositoryId,claim,event,Object.values(pending.events).find(item=>item?.branch)?.branch,Object.values(pending.events).find(item=>item?.sha)?.sha);
        break;
      }
    }
    let futureHandoffTargets:string[]|undefined;
    for(const job of jobs.filter(item=>item.enabled&&!composite(item)&&item.trigger==='handoff'&&validHandoffName(item.handoffName||'')&&item.state!=='running'&&!running.has(item.id))){
      if(job.includeFutureRepositories&&!futureHandoffTargets)futureHandoffTargets=inTauri()?[...watchedRepositoryIds]:(await api.repositories()).filter(repo=>repo.localPresent!==false&&repo.localPath).map(repo=>repo.id);
      const targets=job.includeFutureRepositories?futureHandoffTargets!:(job.repositoryIds?.length?job.repositoryIds:[job.repositoryId]);
      for(const repositoryId of targets){
        if(!repositoryId||running.has(job.id))break;
        try{if(!await api.hasPendingHandoff(repositoryId,job.handoffName!,job.handoffVariables))continue;}catch(error){console.warn('Could not inspect handoff:',error);continue;}
        if(job.kind!=='notification'&&await repositoryAgentBusy(repositoryId))continue;
        let claim:{id:string;path:string}|null;
        try{claim=await api.claimHandoff(repositoryId,job.handoffName!,job.handoffVariables);}catch(error){console.warn('Could not claim handoff:',error);continue;}
        if(claim){void runSavedPrompt(job.id,false,repositoryId,{...claim,name:job.handoffName!,repositoryId});break;}
      }
    }
    for(const job of [...jobs]){
      if(!job.enabled||composite(job)||job.state==='running'||running.has(job.id)||job.trigger==='manual')continue;
      if(job.trigger==='interval'){
        if(now>=job.nextAt)void runSavedPrompt(job.id);
        continue;
      }
    }
  }finally{checking=false;if(recheck){recheck=false;queueMicrotask(()=>void tick());}}
}
export function checkSavedPromptSchedule(now?:number){return tick(now);}
export function recordAutomationCiRuns(repositoryId:string,runs:GithubCiRun[]){
  const eligible=jobs.filter(job=>job.enabled&&automationConditions(job).some(condition=>condition==='ciPass'||condition==='ciFail')&&(job.includeFutureRepositories?true:(job.repositoryIds?.length?job.repositoryIds:[job.repositoryId]).includes(repositoryId)));
  for(const job of eligible){
    const condition=automationConditions(job).includes('ciPass')?'ciPass':'ciFail';
    for(const run of [...runs].reverse()){
      if(!matchesCiConclusion(condition,run.conclusion)||!ciCompletedSince(run,job.ciSince)||!matchesCommitBranch(run.headBranch||'',job.commitBranch||'*',job.commitAllExcept))continue;
      const runKey=ciRunKey(run),key=`${job.id}:${repositoryId}:${runKey}`;
      if(ciHandled[`${job.id}:${repositoryId}`]?.includes(runKey)||pendingCi.has(key))continue;
      if(composite(job))recordConditionEvent(repositoryId,condition,Date.parse(run.updatedAt),{branch:run.headBranch||undefined,sha:run.headSha,ciRun:run});
      else pendingCi.set(key,{jobId:job.id,repositoryId,run});
    }
  }
  void tick();
}
export function recordAutomationGithubEvents(repositoryId:string,events:GithubRepositoryEvent[]){
  const eligible=jobs.filter(job=>job.enabled&&automationConditions(job).some(condition=>condition==='push'||condition==='pullRequest')&&scopedTo(job,repositoryId));
  if(!eligible.length)return;
  const seen=new Set(githubEventSeen[repositoryId]||[]);
  for(const event of [...events].reverse()){
    if(seen.has(event.id))continue;
    seen.add(event.id);
    for(const job of eligible){
      if(!automationConditions(job).includes(event.kind)||Date.parse(event.createdAt)<Math.floor((job.ciSince||0)/1000)*1000)continue;
      recordConditionEvent(repositoryId,event.kind,Date.parse(event.createdAt),{branch:event.branch,sha:event.sha||undefined});
    }
  }
  githubEventSeen[repositoryId]=[...seen].slice(-200);
  try{localStorage.setItem(githubEventKey,JSON.stringify(githubEventSeen));}catch(error){console.warn('Could not remember GitHub events:',error);}
}
async function pollGithubEvents(){
  if(checkingGithubEvents||!jobs.some(job=>job.enabled&&automationConditions(job).some(condition=>condition==='push'||condition==='pullRequest')))return;
  checkingGithubEvents=true;
  try{
    const repositories=(await api.repositories()).filter(repo=>repo.localPresent!==false&&repo.localPath);
    for(const repo of repositories){
      if(!jobs.some(job=>job.enabled&&automationConditions(job).some(condition=>condition==='push'||condition==='pullRequest')&&scopedTo(job,repo.id)))continue;
      try{recordAutomationGithubEvents(repo.id,await api.githubRepositoryEvents(repo.id));}
      catch(error){console.warn(`GitHub events for ${repo.displayName}:`,error);}
    }
  }catch(error){console.warn('Could not list repositories for GitHub events:',error);}
  finally{checkingGithubEvents=false;}
}
type CiPollFailure={kind:string;message:string;retryAfterSeconds?:number|null};
type CiPollHealth={failures:number;retryAt:number;error:CiPollFailure;notified:boolean};
const ciPollHealth=new Map<string,CiPollHealth>();
let ciOutageNotified=false;
function ciFailure(error:unknown):CiPollFailure{
  if(error&&typeof error==='object'&&'kind' in error&&'message' in error)return error as CiPollFailure;
  return {kind:'transport',message:String(error)};
}
function transientCiError(error:CiPollFailure){return !['authentication','access','configuration'].includes(error.kind);}
export async function pollAutomationCi(now?:number){
  const pollTime=()=>now??Date.now();
  if(checkingCi)return;
  const ciJobs=jobs.filter(job=>job.enabled&&automationConditions(job).some(condition=>condition==='ciPass'||condition==='ciFail'));
  if(!ciJobs.length){ciPollHealth.clear();ciOutageNotified=false;return;}
  checkingCi=true;
  try{
    const repositories=(await api.repositories()).filter(repo=>repo.localPresent!==false&&repo.localPath&&isGithubRemote(repo.canonicalRemote)&&repo.identity?.providerUsername&&ciJobs.some(job=>job.includeFutureRepositories||(job.repositoryIds?.length?job.repositoryIds:[job.repositoryId]).includes(repo.id)));
    const ids=new Set(repositories.map(repo=>repo.id));
    for(const id of ciPollHealth.keys())if(!ids.has(id))ciPollHealth.delete(id);
    // A slow or inaccessible repository must not block checks for every other repository.
    let nextRepository=0;
    await Promise.allSettled(Array.from({length:Math.min(4,repositories.length)},async()=>{
      while(nextRepository<repositories.length){
        const repo=repositories[nextRepository++];
        const previous=ciPollHealth.get(repo.id);if(previous&&pollTime()<previous.retryAt)continue;
        try{recordAutomationCiRuns(repo.id,await api.githubCiRuns(repo.id));ciPollHealth.delete(repo.id);}
        catch(error){
          const failure=ciFailure(error),failures=(previous?.failures||0)+1;
          const backoff=Math.min(900,60*2**Math.min(failures-1,4));
          const retryDelay=Math.max(backoff,Number.isFinite(failure.retryAfterSeconds)?Math.max(0,failure.retryAfterSeconds!):0);
          ciPollHealth.set(repo.id,{failures,retryAt:pollTime()+retryDelay*1000,error:failure,notified:previous?.error.kind===failure.kind&&previous.notified||false});
          console.warn(`CI checks for ${repo.displayName} will retry:`,failure.message);
        }
      }
    }));
    const outages=repositories.filter(repo=>{const health=ciPollHealth.get(repo.id);return health&&transientCiError(health.error);});
    if(!outages.length)ciOutageNotified=false;
    const persistent=outages.filter(repo=>ciPollHealth.get(repo.id)!.failures>=3);
    if(persistent.length&&!ciOutageNotified){
      ciOutageNotified=true;
      addAutomationNotice({automationId:'ci-monitor',title:'CI checks delayed',message:`GitHub monitoring is delayed for ${persistent.map(repo=>repo.displayName).join(', ')}. This is a monitoring problem, not a failed workflow. Checks retry automatically. ${ciPollHealth.get(persistent[0].id)!.error.message}`,status:'message'});
    }
    const denied=repositories.filter(repo=>{const health=ciPollHealth.get(repo.id);return health&&!transientCiError(health.error)&&!health.notified;});
    if(denied.length){
      for(const repo of denied)ciPollHealth.get(repo.id)!.notified=true;
      addAutomationNotice({automationId:'ci-monitor',title:'CI access needs attention',message:denied.map(repo=>`${repo.displayName}: ${ciPollHealth.get(repo.id)!.error.message}`).join('\n'),status:'message'});
    }
  }catch(error){console.warn('Could not list repositories for CI monitoring:',error);}
  finally{checkingCi=false;}
}
export function recordAutomationFileChange(repositoryId:string,occurredAt=Date.now()){
  recordConditionEvent(repositoryId,'fileChange',occurredAt);
  recordConditionEvent(repositoryId,'idleTime',occurredAt);
  for(const job of jobs.filter(item=>item.enabled&&composite(item)&&automationConditions(item).includes('changeCount')&&scopedTo(item,repositoryId))){
    void api.repositoryChangeSummary(repositoryId).then(summary=>{
      const key=`${job.id}:${repositoryId}`,previous=lastTriggeredCounts.get(key);
      const baseline=previous?.head===summary.head&&summary.changedLines>=previous.count?previous.count:0;
      if(summary.changedLines>=baseline+Math.max(1,job.changeThreshold||10))recordConditionEvent(repositoryId,'changeCount',occurredAt);
    }).catch(error=>console.warn('Could not count changes for automation:',error));
  }
  for(const job of jobs){
    if(!job.enabled||composite(job)||(job.trigger!=='fileChange'&&job.trigger!=='changeCount')||job.state==='running'||running.has(job.id))continue;
    const targets=job.repositoryIds?.length?job.repositoryIds:[job.repositoryId];
    if(!(job.includeFutureRepositories?watchedRepositoryIds.has(repositoryId):targets.includes(repositoryId)))continue;
    const key=`${job.id}:${repositoryId}`;
    pendingChanges.set(key,{changedAt:occurredAt});
    window.clearTimeout(debounceTimers.get(key));
    debounceTimers.set(key,window.setTimeout(()=>void tick(),Math.max(30,job.debounceSeconds||300)*1000));
  }
}
type CommitSnapshot=Awaited<ReturnType<typeof api.repositoryCommitState>>;
function commitRefs(state:CommitSnapshot){return state.refs??[{key:'HEAD',...state}];}
export async function recordAutomationCommit(repositoryId:string,state?:CommitSnapshot){
  const previousCheck=commitChecks.get(repositoryId)||Promise.resolve();
  const check=previousCheck.catch(()=>{}).then(async()=>{
    const current=state||await api.repositoryCommitState(repositoryId);
    const refs=commitRefs(current),previous=commitHeads.get(repositoryId);
    commitHeads.set(repositoryId,new Map(refs.map(ref=>[ref.key,ref.head])));
    if(!previous)return;
    for(const ref of refs){
      if(previous.get(ref.key)===ref.head||!ref.head||!/^(commit|merge|cherry-pick)(?:\b|\s*\()/i.test(ref.reflog))continue;
      for(const job of jobs){
        if(!job.enabled||!automationConditions(job).includes('commit')||!matchesCommitBranch(ref.branch,job.commitBranch||'',job.commitAllExcept))continue;
        const targets=job.repositoryIds?.length?job.repositoryIds:[job.repositoryId];
        if(job.includeFutureRepositories?watchedRepositoryIds.has(repositoryId):targets.includes(repositoryId)){
          if(composite(job))recordConditionEvent(repositoryId,'commit',Date.now(),{branch:ref.branch,sha:ref.head});
          else {const key=`${job.id}:${repositoryId}`,queue=pendingCommits.get(key)||[];queue.push({branch:ref.branch,sha:ref.head});pendingCommits.set(key,queue);}
        }
      }
    }
    void tick();
  });
  commitChecks.set(repositoryId,check);
  try{await check;}finally{if(commitChecks.get(repositoryId)===check)commitChecks.delete(repositoryId);}
}
async function syncFileWatchers(){
  if(!inTauri())return;
  const repositories=await api.repositories();
  const ids=repositories.filter(repo=>repo.localPresent!==false&&repo.localPath).map(repo=>repo.id);
  watchedRepositoryIds=new Set(ids);
  const fresh=ids.filter(id=>!commitHeads.has(id));
  if(fresh.length){const states=await api.repositoryCommitStatesBatch(fresh);for(const [id,state] of Object.entries(states))commitHeads.set(id,new Map(commitRefs(state).map(ref=>[ref.key,ref.head])));}
  for(const id of commitHeads.keys())if(!watchedRepositoryIds.has(id))commitHeads.delete(id);
  const errors=await api.watchAutomationRepositories(ids);
  await Promise.allSettled(ids.filter(id=>!fresh.includes(id)).map(id=>recordAutomationCommit(id)));
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
  void tick();void pollAutomationCi();void pollGithubEvents();const timer=window.setInterval(()=>{void tick();void syncFileWatchers();},30_000);
  const ciTimer=window.setInterval(()=>void pollAutomationCi(),60_000);
  const githubEventTimer=window.setInterval(()=>void pollGithubEvents(),60_000);
  const handoffTimer=window.setInterval(()=>{if(jobs.some(job=>job.enabled&&automationConditions(job).includes('handoff')))void tick();},2000);
  return()=>{stopped=true;unlisten?.();unlistenGit?.();unsubscribe();window.clearInterval(timer);window.clearInterval(ciTimer);window.clearInterval(githubEventTimer);window.clearInterval(handoffTimer);for(const timeout of debounceTimers.values())window.clearTimeout(timeout);debounceTimers.clear();};
}
