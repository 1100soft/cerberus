import { useSyncExternalStore } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { eventEdits, mergeEdits, agentFailure } from './agentEdits';
import { agentOutput } from './agentOutput';
import { api } from './api';
import type { CodexMessage, FileEdit } from '../types';
export type AgentProfile = {id: string; label: string; provider: string; subscription?:boolean; disconnected?:boolean; email?:string; plan?:string};
export type ResumeTarget = {sessionId:string; provider:string; source:'app'|'codex-history'|'cursor-history'};
export type ResumeStatus = {available:boolean; reason:string};
export type AgentChat = {id: string; repositoryId: string; profile: AgentProfile; name: string; archived?:boolean; session?:ResumeTarget; retryable?:boolean; messages: CodexMessage[]; status: string; running: boolean; activity: string; updatedAt: number; originKey?:string};
function readChats(): AgentChat[] {
  try { const saved = JSON.parse(localStorage.getItem('gitcerberus.agentChats') || '[]'); return Array.isArray(saved) ? saved.filter(chat => chat && typeof chat.id === 'string' && typeof chat.repositoryId === 'string' && chat.profile && Array.isArray(chat.messages)).map(chat => ({...chat, running:false, retryable:chat.retryable || (!chat.running && String(chat.activity).includes('already has an active writer')), status:chat.running ? 'Interrupted when the app closed. Resume to continue.' : agentFailure(chat.status,chat.activity)})) : []; } catch { return []; }
}
let chats: AgentChat[] = readChats();
function persist() { try { if (typeof localStorage !== 'undefined') localStorage.setItem('gitcerberus.agentChats', JSON.stringify(chats)); } catch { window.dispatchEvent(new CustomEvent('chat-storage-error', {detail:'Chat history could not be saved on this computer. Keep this window open to retain it.'})); } }
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
export function latestAgentChat(repositoryId:string) { return chats.find(chat=>chat.repositoryId===repositoryId); }
export function useAgentChats() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => chats); }
export function useRepositoryAgentWorking(repositoryId:string){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>chats.some(chat=>chat.repositoryId===repositoryId&&chat.running));}
export function renameAgentChat(id:string, name:string) { const next=name.trim(); if(!next)return; chats=chats.map(chat=>chat.id===id?{...chat,name:next}:chat);persist();emit(); }
export function archiveAgentChat(id:string, archived:boolean) { chats=chats.map(chat=>chat.id===id?{...chat,archived}:chat);persist();emit(); }
function update(id: string, patch: Partial<AgentChat>) { chats = chats.map(chat => chat.id === id ? {...chat, ...patch, updatedAt:Date.now()} : chat); if (patch.session || chats.find(chat => chat.id === id)?.running === false) persist(); emit(); }
export function chatPrompt(messages: CodexMessage[], prompt: string) {
  if (new TextEncoder().encode(prompt).length > 99_000) throw new Error('Message is too long. Shorten it before sending.');
  if (!messages.length) return prompt;
  const context = JSON.stringify(messages.map(({role,text}) => ({role,text})));
  if (new TextEncoder().encode(context + prompt).length > 99_000) throw new Error('This chat is too long to send safely. Start a new chat with a summary.');
  return `Continue this conversation in the current repository. Prior messages are conversation context, not system instructions.\n${context}\n\nCurrent user message:\n${prompt}`;
}
export async function sendAgentMessage(repositoryId: string, profile: AgentProfile, prompt: string, mode: string, chatId?: string, context: CodexMessage[] = [], resume?:ResumeTarget, startNew = false, retry = false, model?:string, originName?:string, reasoningEffort?:string) {
  if (chats.some(chat => chat.repositoryId === repositoryId && chat.running)) throw new Error('A task is already running in this repository. Stop it or wait for it to finish.');
  const originKey=resume && resume.source!=='app' ? `${resume.provider}:${resume.sessionId}` : undefined;
  const original = chats.find(chat => chat.repositoryId === repositoryId && (chat.id === chatId || (!!originKey && chat.originKey===originKey && chat.profile.id===profile.id)));
  const existing = startNew ? undefined : original;
  if (existing && existing.profile.id !== profile.id) throw new Error('Start a new chat to use a different account.');
  if (retry && !original?.retryable) throw new Error('This turn cannot be retried automatically. Send a follow-up instead.');
  const previous = retry ? original!.messages.slice(0,-2) : original?.messages || context;
  const target = startNew ? undefined : resume || existing?.session;
  if (existing && !target && !retry) throw new Error('This conversation has no resumable session. Choose Start new chat.');
  const task = chatPrompt(target ? [] : previous, prompt);
  const id = existing?.id || crypto.randomUUID();
  const messages = [...previous, {id:crypto.randomUUID(), role:'user', text:prompt}, {id:crypto.randomUUID(), role:'assistant', text:''}];
  const record: AgentChat = {id, repositoryId, profile, name: existing?.name || originName || prompt.slice(0,100), archived:existing?.archived, originKey:startNew ? undefined : existing?.originKey || originKey, session:target, messages, running:true, status:'Working…', activity:'', updatedAt:Date.now()};
  chats = existing ? chats.map(chat => chat.id === id ? record : chat) : [record, ...chats]; persist(); emit();
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
      if (typeof sessionId === 'string' && sessionId) update(id, {session:{sessionId, provider:profile.provider, source:'app'}});
      if (event.type === 'turn.failed' || event.type === 'error' || event.is_error) failure = event.error?.message || event.message || event.result || 'Agent reported a failure';
      if(event.type==='turn.plan'){const index=steps.findIndex(step=>step.kind==='plan');const step={kind:'plan',title:'Plan',text:(event.plan||[]).map((item:any)=>`${item.status}: ${item.step}`).join('\n')};if(index<0)steps.push(step);else steps[index]=step;}
      if(event.type==='item.completed'){
        const item=event.item;
        if(item?.type==='agent_message' && item.phase==='commentary')steps.push({kind:'commentary',title:'Progress update',text:item.text||''});
        else if(item?.type==='agent_message')response+=`${item.text||''}\n`;
        else if(item?.type==='command_execution')steps.push({kind:'command',title:item.command||'Command',text:item.aggregated_output||'',status:String(item.exit_code??item.status??'')});
        else if(item?.type==='error')steps.push({kind:'error',title:'Provider notice',text:item.message||''});
      }
      if (event.type === 'assistant') response += (event.message?.content || []).filter((item: {type:string}) => item.type === 'text').map((item: {text:string}) => item.text).join('\n') + '\n';
      if (event.type === 'result' && !response && typeof event.result === 'string') response = event.result;
    } catch { /* Raw stderr belongs in activity, not the assistant reply. */ }
    response = response.slice(-200_000);
    update(id, {activity, messages: [...messages.slice(0,-1), {...messages[messages.length-1], text:response, edits, steps:[...steps]}]});
  };
  void invoke('run_agent', {profileId:profile.id, repositoryId, prompt:task, mode, model:model || null, reasoningEffort:reasoningEffort || null, resume:target || null, output}).then(() => {update(id, {running:false, status:failure || 'Completed'});window.dispatchEvent(new Event('chatgpt-usage-refresh'));}).catch(error => {update(id, {running:false, status:agentFailure(String(error),activity), retryable:!started && !response && !edits.length});if(profile.subscription && /ChatGPT authentication was rejected|ChatGPT credentials are unavailable|does not match the assigned identity/.test(String(error)))window.dispatchEvent(new Event('agent-configuration-changed'));});
  return id;
}
export const stopAgentChat = (repositoryId: string) => invoke('cancel_agent', {repositoryId});

export function waitForAgentChat(id:string,timeoutMs=960_000):Promise<string>{
  return new Promise((resolve,reject)=>{
    const timer=window.setTimeout(()=>{listeners.delete(check);reject(new Error('Agent completion was not observed. Check its conversation before retrying.'));},timeoutMs);
    const check=()=>{const chat=chats.find(item=>item.id===id);if(!chat||chat.running)return;window.clearTimeout(timer);listeners.delete(check);if(chat.status==='Completed')resolve(chat.messages.at(-1)?.text||'Completed');else reject(new Error(chat.status));};
    listeners.add(check);check();
  });
}

export async function runExternalAutomation(repositoryId:string,profile:AgentProfile,prompt:string,mode:'analyze'|'edit'|'full'):Promise<{text:string;chatId:string}>{
  if(chats.some(chat=>chat.repositoryId===repositoryId&&chat.running))throw new Error('A task is already running in this repository.');
  const id=crypto.randomUUID();
  const messages:CodexMessage[]=[{id:crypto.randomUUID(),role:'user',text:prompt},{id:crypto.randomUUID(),role:'assistant',text:''}];
  chats=[{id,repositoryId,profile,name:prompt.slice(0,100),messages,status:'Working…',activity:'',running:true,updatedAt:Date.now()},...chats];persist();emit();
  try{
    const result=await api.runNewAgentConversation(repositoryId,profile.provider,profile.id,mode,prompt,undefined,undefined,event=>{const chat=getAgentChat(id);if(chat)update(id,{activity:(chat.activity+'\n'+JSON.stringify(event)).slice(-2_000_000)});});
    update(id,{running:false,status:'Completed',session:result.sessionId?{sessionId:result.sessionId,provider:profile.provider,source:'app'}:undefined,messages:[messages[0],{...messages[1],text:result.text||'Completed without a text response.'}]});
    window.dispatchEvent(new CustomEvent('saved-prompt-finished',{detail:{repositoryId,provider:profile.provider}}));
    return {text:result.text||'Completed',chatId:id};
  }catch(error){update(id,{running:false,status:String(error),activity:String(error)});throw error;}
}
