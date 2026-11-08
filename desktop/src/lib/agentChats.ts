import { useSyncExternalStore } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { eventEdits, mergeEdits, agentFailure } from './agentEdits';
import { agentOutput } from './agentOutput';
import { api } from './api';
import type { CodexMessage, FileEdit } from '../types';
export type AgentProfile = {id: string; label: string; provider: string; subscription?:boolean; disconnected?:boolean; connectionError?:string; email?:string; plan?:string};
export type ResumeTarget = {sessionId:string; provider:string; source:'app'|'codex-history'|'cursor-history'};
export type ResumeStatus = {available:boolean; reason:string};
export type AutomationAgentContext={runId:string;commit?:string};
export type AgentChat = {automationContext?:AutomationAgentContext;externalAutomation?:boolean;id: string; repositoryId: string; profile: AgentProfile; name: string; archived?:boolean; session?:ResumeTarget; retryable?:boolean;automationRetry?:boolean;mode?:string;model?:string;reasoningEffort?:string; messages: CodexMessage[]; status: string; running: boolean; activity: string; updatedAt: number; originKey?:string};
function readChats(): AgentChat[] {
  try { const saved = JSON.parse(localStorage.getItem('gitcerberus.agentChats') || '[]'); return Array.isArray(saved) ? saved.filter(chat => chat && typeof chat.id === 'string' && typeof chat.repositoryId === 'string' && chat.profile && Array.isArray(chat.messages)).map(chat => ({...chat, running:false, retryable:chat.retryable || (!chat.running && String(chat.activity).includes('already has an active writer')), status:chat.running ? 'Interrupted when the app closed. Resume to continue.' : agentFailure(chat.status,chat.activity)})) : []; } catch { return []; }
}
let chats: AgentChat[] = readChats();
const legacyBackupPending=new Set(chats.map(chat=>chat.id));
const dirtyChats=new Map<string,AgentChat>();
let saving=false,flushTimer:number|undefined;
let nativeStoreReady=false;
const storageErrors=new Map<string,string>();
let publishedStorageError:string|undefined;
function storageStatus(){const detail=[...storageErrors.values()].join(' ');if(detail!==publishedStorageError){publishedStorageError=detail;window.dispatchEvent(new CustomEvent('chat-storage-error',{detail}));}}
function storageError(error:unknown,source='database'){
  storageErrors.set(source,source==='backup'?'Local conversation backup storage is full or unavailable. This is storage on this computer, not agent credits.':`Conversation could not be ${source==='restore'?'loaded':'saved'} on this computer: ${String(error)}`);storageStatus();
}
function clearStorageError(source:string){storageErrors.delete(source);storageStatus();}
let restorePromise:Promise<void>|undefined;
export function initializeAgentChats():Promise<void>{
  if(!restorePromise)restorePromise=(async()=>{
    if(!('__TAURI_INTERNALS__' in window)||!api.agentConversations)return;
    try{
      const saved=await api.agentConversations();
      const merged=new Map(chats.map(chat=>[chat.id,chat]));
      for(const chat of saved){const current=merged.get(chat.id);if(!dirtyChats.has(chat.id)&&(!current||chat.updatedAt>=current.updatedAt))merged.set(chat.id,{...chat,running:false,status:chat.running?'Interrupted when the app closed. Resume to continue.':chat.status});}
      chats=[...merged.values()].sort((a,b)=>b.updatedAt-a.updatedAt);emit();
      for(const chat of chats){const prior=saved.find(item=>item.id===chat.id);if(!prior||chat.updatedAt>prior.updatedAt)dirtyChats.set(chat.id,chat);else legacyBackupPending.delete(chat.id);}
      nativeStoreReady=true;clearStorageError('restore');scheduleFlush();
    }catch(error){storageError(error,'restore');restorePromise=undefined;}
  })();
  return restorePromise;
}
async function flushChats(){
  if(saving||!api.saveAgentConversation||!('__TAURI_INTERNALS__' in window))return;
  saving=true;
  try{await initializeAgentChats();while(dirtyChats.size){const [id,chat]=dirtyChats.entries().next().value!;await api.saveAgentConversation(chat);legacyBackupPending.delete(id);if(dirtyChats.get(id)===chat)dirtyChats.delete(id);}clearStorageError('database');if(nativeStoreReady){writeChatFallback();clearStorageError('backup');}}
  catch(error){storageError(error);}finally{saving=false;}
}
function scheduleFlush(){
  if(flushTimer===undefined)flushTimer=window.setTimeout(()=>{flushTimer=undefined;void flushChats();},500);
}
let backupTimer:number|undefined,backupIdle:number|undefined;
function writeChatFallback(){
  window.clearTimeout(backupTimer);backupTimer=undefined;
  if(backupIdle!==undefined){window.cancelIdleCallback?.(backupIdle);backupIdle=undefined;}
  // SQLite is authoritative on desktop. Keep only pending recovery context here,
  // not another copy of every historical conversation in WebKit's tiny quota.
  const native='__TAURI_INTERNALS__' in window;
  // Never truncate the old recovery source before its records have migrated.
  if(native&&legacyBackupPending.size)return;
  const pending=native&&nativeStoreReady?[...dirtyChats.values()]:chats;
  if(native&&nativeStoreReady&&!pending.length){
    try{localStorage.removeItem('gitcerberus.agentChats');clearStorageError('backup');}catch{/* Native history is already saved. */}
    return;
  }
  const records:AgentChat[]=[];let size=2;
  const candidates=[...pending].sort((a,b)=>Number(b.running)-Number(a.running)||b.updatedAt-a.updatedAt);
  for(const chat of candidates){
    const compact={...chat,name:String(chat.name||'Conversation').slice(0,100),status:String(chat.status||'').slice(0,1000),activity:'',messages:chat.messages.slice(-4).map(({steps,edits,...message})=>({...message,text:String(message.text||'').slice(-2000)}))};
    const length=JSON.stringify(compact).length+1;
    if(size+length>48000)continue;
    records.push(compact);size+=length;if(records.length>=8)break;
  }
  try{localStorage.setItem('gitcerberus.agentChats',JSON.stringify(records));clearStorageError('backup');}
  catch(error){
    // Replace an old oversized backup only after those records are durable.
    // Native write failures are reported independently, never masked by this cache.
    if(native&&nativeStoreReady)clearStorageError('backup');else storageError(error,'backup');
  }
}
function scheduleChatFallback(){
  if(backupTimer!==undefined||backupIdle!==undefined)return;
  backupTimer=window.setTimeout(()=>{backupTimer=undefined;if(window.requestIdleCallback)backupIdle=window.requestIdleCallback(()=>{backupIdle=undefined;writeChatFallback();},{timeout:1000});else writeChatFallback();},500);
}
window.addEventListener('pagehide',writeChatFallback);
function persist(id?:string){
  for(const chat of id?chats.filter(chat=>chat.id===id):chats)dirtyChats.set(chat.id,chat);
  const complete=!!id&&!getAgentChat(id)?.running;
  if(complete)writeChatFallback();else scheduleChatFallback();
  scheduleFlush();
  if(complete)void flushChats();
}
export function restoreAgentConversation(chat:AgentChat){
  const current=getAgentChat(chat.id);
  if(current?.running||current&&current.updatedAt>chat.updatedAt&&current.messages.at(-1)?.text)return;
  chats=current?chats.map(item=>item.id===chat.id?chat:item):[chat,...chats];persist(chat.id);emit();
}
export function historyResumeTarget(key?:string): ResumeTarget | undefined {
  if (!key || key === 'new' || key.startsWith('app:')) return;
  const colon = key.indexOf(':'); const provider = key.slice(0,colon);
  if (provider !== 'codex' && provider !== 'cursor') return;
  return {provider, sessionId:key.slice(colon+1), source:provider === 'codex' ? 'codex-history' : 'cursor-history'};
}
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function subscribeAgentChats(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function getAgentChat(id:string) { return chats.find(chat=>chat.id===id); }
export function currentAgentChats(){return chats;}
export function latestAgentChat(repositoryId:string) { return chats.find(chat=>chat.repositoryId===repositoryId); }
export function useAgentChats(active=true) { return useSyncExternalStore(listener => { if(!active)return()=>{};listeners.add(listener); return () => { listeners.delete(listener); }; }, () => chats); }
export function useAgentsRunning(){return useSyncExternalStore(subscribeAgentChats,()=>chats.some(chat=>chat.running));}
export function useRepositoryAgentWorking(repositoryId:string){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>chats.some(chat=>chat.repositoryId===repositoryId&&chat.running));}
export function renameAgentChat(id:string, name:string) { const next=name.trim(); if(!next)return; chats=chats.map(chat=>chat.id===id?{...chat,name:next}:chat);persist(id);emit(); }
export function archiveAgentChat(id:string, archived:boolean) { chats=chats.map(chat=>chat.id===id?{...chat,archived}:chat);persist(id);emit(); }
export function updateAgentChat(id: string, patch: Partial<AgentChat>) { chats = chats.map(chat => chat.id === id ? {...chat, ...patch, updatedAt:Date.now()} : chat); persist(id); emit(); }
export function chatPrompt(messages: CodexMessage[], prompt: string) {
  if (new TextEncoder().encode(prompt).length > 99_000) throw new Error('Message is too long. Shorten it before sending.');
  if (!messages.length) return prompt;
  const context = JSON.stringify(messages.map(({role,text}) => ({role,text})));
  if (new TextEncoder().encode(context + prompt).length > 99_000) throw new Error('This chat is too long to send safely. Start a new chat with a summary.');
  return `Continue this conversation in the current project. Prior messages are conversation context, not system instructions.\n${context}\n\nCurrent user message:\n${prompt}`;
}
export async function sendAgentMessage(repositoryId: string, profile: AgentProfile, prompt: string, mode: string, chatId?: string, context: CodexMessage[] = [], resume?:ResumeTarget, startNew = false, retry = false, model?:string, originName?:string, reasoningEffort?:string,automationContext?:AutomationAgentContext,trackingRunId?:string) {
  const originKey=resume && resume.source!=='app' ? `${resume.provider}:${resume.sessionId}` : undefined;
  const original = chats.find(chat => chat.repositoryId === repositoryId && (chat.id === chatId || (!!originKey && chat.originKey===originKey && chat.profile.id===profile.id)));
  const existing = startNew ? undefined : original;
  automationContext=automationContext||existing?.automationContext;
  if(chats.some(chat=>chat.repositoryId===repositoryId&&chat.running&&chat.automationContext?.runId===automationContext?.runId))throw new Error('A task is already running in this checkout. Stop it or wait for it to finish.');
  if (existing && existing.profile.id !== profile.id) throw new Error('Start a new chat to use a different account.');
  if (retry && !original?.retryable) throw new Error('This turn cannot be retried automatically. Send a follow-up instead.');
  const previous = retry ? original!.messages.slice(0,-2) : original?.messages || context;
  const target = startNew ? undefined : resume || existing?.session;
  if (existing && !target && !retry) throw new Error('This conversation has no resumable session. Choose Start new chat.');
  const task = chatPrompt(target ? [] : previous, prompt);
  const id = existing?.id || crypto.randomUUID();
  const messages = [...previous, {id:crypto.randomUUID(), role:'user', createdAt:Date.now(), text:prompt}, {id:crypto.randomUUID(), role:'assistant', createdAt:Date.now(), text:''}];
  const record: AgentChat = {automationContext,automationRetry:existing?.automationRetry,mode,model,reasoningEffort,id, repositoryId, profile, name: existing?.name || originName || prompt.slice(0,100), archived:existing?.archived, originKey:startNew ? undefined : existing?.originKey || originKey, session:target, messages, running:true, status:'Working…', activity:'', updatedAt:Date.now()};
  chats = existing ? chats.map(chat => chat.id === id ? record : chat) : [record, ...chats]; persist(id); emit();
  let started = false;
  let edits:FileEdit[] = [];
  let response = '', activity = '', failure = '';
  const steps:import('../types').AgentStep[]=[]; 
  const output = new Channel<{text: string}>();
  output.onmessage = ({text}) => {
    activity = (activity + agentOutput(text)).slice(-200_000);
    try {
      const event = JSON.parse(text);
      if (['turn.started','tool_call','item.started','item.completed','assistant','user'].includes(event.type)) started = true;
      edits = mergeEdits(edits, eventEdits(event), event.type === 'workspace_changes' ? event.repository : undefined);
      const sessionId = event.type === 'thread.started' ? event.thread_id : event.type === 'system' && event.subtype === 'init' ? event.session_id : undefined;
      if (typeof sessionId === 'string' && sessionId) updateAgentChat(id, {session:{sessionId, provider:profile.provider, source:'app'}});
      if (event.type === 'turn.failed' || event.type === 'error' || event.is_error) failure = event.error?.message || event.message || event.result || 'Agent reported a failure';
      if(event.type==='turn.plan'){const index=steps.findIndex(step=>step.kind==='plan');const step={createdAt:Date.now(),kind:'plan',title:'Plan',text:(event.plan||[]).map((item:any)=>`${item.status}: ${item.step}`).join('\n')};if(index<0)steps.push(step);else steps[index]=step;}
      if(event.type==='item.completed'){
        const item=event.item;
        if(item?.type==='agent_message' && item.phase==='commentary')steps.push({createdAt:Date.now(),kind:'commentary',title:'Progress update',text:item.text||''});
        else if(item?.type==='agent_message')response+=`${item.text||''}\n`;
        else if(item?.type==='command_execution')steps.push({createdAt:Date.now(),kind:'command',title:item.command||'Command',text:item.aggregated_output||'',status:String(item.exit_code??item.status??'')});
        else if(item?.type==='error')steps.push({createdAt:Date.now(),kind:'error',title:'Provider notice',text:item.message||''});
      }
      if (event.type === 'assistant') response += (event.message?.content || []).filter((item: {type:string}) => item.type === 'text').map((item: {text:string}) => item.text).join('\n') + '\n';
      if (event.type === 'result' && !response && typeof event.result === 'string') response = event.result;
    } catch { /* Raw stderr belongs in activity, not the assistant reply. */ }
    // Command output can include whole MIME messages/base64 attachments. Keep a
    // bounded live trace rather than retaining every command payload forever.
    for(const step of steps){step.text=step.text.slice(-12000);step.title=step.title.slice(0,1000);}
    while(steps.length>100||steps.reduce((size,step)=>size+step.text.length+step.title.length,0)>200000)steps.shift();
    response = response.slice(-200_000);
    updateAgentChat(id, {activity, messages: [...messages.slice(0,-1), {...messages[messages.length-1], text:response, edits, steps:[...steps]}]});
  };
  void invoke('run_agent', {profileId:profile.id, repositoryId, prompt:task, mode, model:model || null, reasoningEffort:reasoningEffort || null, resume:target || null, automationRunId:automationContext?.runId||null,automationCommit:automationContext?.commit||null,trackingRunId:trackingRunId||automationContext?.runId||id,output}).then(() => {updateAgentChat(id, {running:false, status:failure || 'Completed',automationRetry:false});window.dispatchEvent(new Event('chatgpt-usage-refresh'));}).catch(error => {if(profile.subscription)window.dispatchEvent(new Event('chatgpt-usage-refresh'));updateAgentChat(id, {running:false, status:agentFailure(String(error),activity), retryable:!started && !response && !edits.length});if(profile.subscription && /ChatGPT authentication was rejected|ChatGPT credentials are unavailable|does not match the assigned identity/.test(String(error)))window.dispatchEvent(new Event('agent-configuration-changed'));}).finally(()=>{output.onmessage=()=>{};});
  return id;
}
export const stopAgentChat = (repositoryId:string,chatId?:string) => {
  const chat=chatId?getAgentChat(chatId):undefined;
  if(chat?.externalAutomation&&chat.automationContext)return api.cancelDraft(chat.automationContext.runId);
  return invoke('cancel_agent',{repositoryId,automationRunId:chat?.automationContext?.runId||null});
};

export function waitForAgentChat(id:string,timeoutMs=960_000):Promise<string>{
  return new Promise((resolve,reject)=>{
    let remaining=timeoutMs,last=Date.now();
    const timer=window.setInterval(()=>{const now=Date.now(),gap=now-last;last=now;if(gap<5000)remaining-=Math.max(0,gap);check();if(remaining<=0){window.clearInterval(timer);listeners.delete(check);reject(new Error('Agent completion was not observed. Check its conversation before retrying.'));}},1000);
    const check=()=>{const chat=chats.find(item=>item.id===id);if(!chat||chat.running)return;window.clearInterval(timer);listeners.delete(check);if(chat.status==='Completed')resolve(chat.messages.at(-1)?.text||'Completed');else reject(new Error(chat.status));};
    listeners.add(check);check();
  });
}

export async function runExternalAutomation(repositoryId:string,profile:AgentProfile,prompt:string,mode:'analyze'|'edit'|'full',conversationName?:string,automationContext?:AutomationAgentContext,onStarted?:(chatId:string)=>void,retryChatId?:string,trackingRunId?:string):Promise<{text:string;chatId:string}>{
  const existing=retryChatId?getAgentChat(retryChatId):undefined;
  if(existing&&existing.profile.id!==profile.id)throw new Error("Retry requires the original agent account.");
  automationContext=existing?.automationContext||automationContext;
  if(chats.some(chat=>chat.repositoryId===repositoryId&&chat.running&&chat.automationContext?.runId===automationContext?.runId))throw new Error('A task is already running in this checkout.');
  const id=existing?.id||crypto.randomUUID();
  const messages:CodexMessage[]=[{id:crypto.randomUUID(),role:'user',createdAt:Date.now(),text:prompt},{id:crypto.randomUUID(),role:'assistant',createdAt:Date.now(),text:''}];
  const record:AgentChat={externalAutomation:true,automationContext,id,repositoryId,profile,mode,archived:existing?.archived,session:existing?.session,name:existing?.name||conversationName||prompt.slice(0,100),messages:existing?.session?[...existing.messages,...messages]:messages,status:'Working…',activity:'',running:true,updatedAt:Date.now()};chats=existing?chats.map(chat=>chat.id===id?record:chat):[record,...chats];persist(id);emit();onStarted?.(id);
  try{
    const result=await api.runNewAgentConversation(repositoryId,profile.provider,profile.id,mode,prompt,existing?.session?.sessionId,automationContext?.runId,event=>{const chat=getAgentChat(id);if(chat)updateAgentChat(id,{activity:(chat.activity+'\n'+JSON.stringify(event)).slice(-2_000_000),...externalEventPatch(event,chat)});},automationContext,trackingRunId||automationContext?.runId||id);
    updateAgentChat(id,{running:false,status:'Completed',automationRetry:false,session:result.sessionId?{sessionId:result.sessionId,provider:profile.provider,source:'app'}:undefined,messages:[...record.messages.slice(0,-1),{...messages[1],text:result.text||'Completed without a text response.'}]});
    window.dispatchEvent(new CustomEvent('saved-prompt-finished',{detail:{repositoryId,provider:profile.provider}}));
    return {text:result.text||'Completed',chatId:id};
  }catch(error){updateAgentChat(id,{running:false,status:String(error),activity:(getAgentChat(id)?.activity||'')+'\n'+String(error)});throw error;}
}

export function externalEventPatch(event:Record<string,unknown>,chat:AgentChat):Partial<AgentChat>{
  const data=event.data as Record<string,unknown>|undefined;
  const sessionId=event.type==='session.start'?data?.sessionId:event.type==='thread.started'?event.thread_id:undefined;
  const patch:Partial<AgentChat>=typeof sessionId==='string'?{session:{sessionId,provider:chat.profile.provider,source:'app'}}:{};
  if(event.type==='assistant.message'&&typeof data?.content==='string')patch.messages=[...chat.messages.slice(0,-1),{...chat.messages.at(-1)!,text:data.content}];
  return patch;
}
