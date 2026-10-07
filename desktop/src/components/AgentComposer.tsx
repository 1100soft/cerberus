import { retryConversationAction } from '../lib/savedPrompts';
import { ArrowUp, SquarePen } from 'lucide-react';
import { assignedChatgpt,useChatgptAccounts } from '../lib/chatgptAccounts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Select } from './Select';
import { api, inTauri } from '../lib/api';
import { useChatgptCapabilities, useSelectedEffort, useSelectedModel } from '../lib/chatgptCapabilities';
import { sendAgentMessage, stopAgentChat, useAgentChats, type AgentProfile, historyResumeTarget, type ResumeStatus } from '../lib/agentChats';
import { matchesShortcut } from '../lib/shortcuts';
import type { CodexMessage } from '../types';
import type { Provider } from './ProviderSetup';
const drafts = new Map<string,string>();
export function AgentComposer({accountKey,repositoryId, chatId, conversationKey, context, contextReady, imported, permission, onSelect, onSetup}: {accountKey:string;repositoryId:string; chatId?:string; conversationKey?:string; context:CodexMessage[]; contextReady:boolean; imported:boolean; permission:string; onSelect:(id:string)=>void; onSetup:(provider:Provider)=>void}) {
  const accountState=useChatgptAccounts();
  const assignedId=assignedChatgpt(accountState.settings,accountKey);
  const assignedProfile=accountState.profiles.find(profile=>profile.id===assignedId);
  const chats = useAgentChats();
  const chat = chats.find(chat => chat.id === chatId);
  const active = chats.find(item => item.repositoryId === repositoryId && item.running && item.automationContext?.runId===chat?.automationContext?.runId);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const mode=permission;
  const draftKey = `${repositoryId}:${chatId || conversationKey || 'new'}`;
  const [draft, setDraft] = useState(drafts.get(draftKey) || '');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [resumeStatus, setResumeStatus] = useState<ResumeStatus>();
  const [storageError, setStorageError] = useState('');
  useEffect(() => { const warn = (event:Event) => setStorageError((event as CustomEvent<string>).detail); window.addEventListener('chat-storage-error', warn); return () => window.removeEventListener('chat-storage-error', warn); }, []);
  useEffect(() => { setDraft(drafts.get(draftKey) || ''); setError(''); }, [draftKey]);
  useEffect(() => {
    let live = true;
    const refresh = () => { if (inTauri()) invoke<AgentProfile[]>('agent_profiles').then(items => { if (live) { setProfiles(items); setProfileId(current => items.some(item => item.id === current) ? current : items.length === 1 ? items[0].id : ''); } }).catch(e => { if (live) setError(String(e)); }); };
    refresh(); window.addEventListener('agent-configuration-changed', refresh);
    return () => { live = false; window.removeEventListener('agent-configuration-changed', refresh); };
  }, []);
  const provider = chat?.profile.provider || historyResumeTarget(conversationKey)?.provider;
  const matchingProfiles = profiles.filter(item => !item.disconnected && (!item.subscription || item.id===assignedId) && (!assignedId || item.provider!=='codex' || item.id===assignedId) && (!provider || item.provider === provider));
  const originalProfile = !assignedId || (provider && provider!=='codex') ? matchingProfiles.find(profile => profile.id === chat?.profile.id) : undefined;
  const chosenProfile=matchingProfiles.find(profile=>profile.id===profileId);
  const profile = !provider && chosenProfile?.provider==='cursor' ? chosenProfile : (!provider || provider==='codex') && assignedId ? assignedProfile?.disconnected ? undefined : assignedProfile : originalProfile || matchingProfiles.find(profile=>profile.id===profileId) || (matchingProfiles.length===1 ? matchingProfiles[0] : undefined);
  const capabilities = useChatgptCapabilities(profile?.subscription && !profile.disconnected ? profile.id : undefined);
  const defaultModel=capabilities.data?.models.find(item=>item.isDefault)?.model;
  const preferredModel = useSelectedModel(profile?.subscription ? profile.id : undefined, defaultModel);
  const model=capabilities.data?.models.some(item=>item.model===preferredModel)?preferredModel:defaultModel;
  const effort=useSelectedEffort(profile?.subscription ? profile.id : undefined,capabilities.data?.models.find(item=>item.model===model));
  const showAccountPicker = matchingProfiles.length > 0 && !(assignedId && (!provider || provider === 'codex'));
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { if (input.current) { input.current.style.height = 'auto'; const available=input.current.closest('.chat-message-column')?.clientHeight ?? 180; input.current.style.height = `${Math.min(input.current.scrollHeight,Math.max(50,available-65))}px`; } }, [draft, draftKey]);
  const target = chat?.session || historyResumeTarget(conversationKey);
  const targetKey = target ? `${target.source}:${target.provider}:${target.sessionId}` : '';
  const continuing = !!chat || imported;
  useEffect(() => {
    let live = true; setResumeStatus(undefined);
    if (!continuing || !profile) return;
    if(chat && chat.profile.id!==profile.id){setResumeStatus({available:false,reason:'This chat uses another account. Start a new chat with the assigned account to keep billing separate.'});return;}
    if (!target) { setResumeStatus({available:false,reason:'No resumable session was recorded for this chat.'}); return; }
    if (!inTauri()) { setResumeStatus({available:false,reason:'Session resume requires the desktop app.'}); return; }
    invoke<ResumeStatus>('agent_resume_status', {profileId:profile.id,repositoryId,target,automationRunId:chat?.automationContext?.runId||null,automationCommit:chat?.automationContext?.commit||null}).then(status => { if (live) setResumeStatus(status); }).catch(e => { if (live) setResumeStatus({available:false,reason:String(e)}); });
    return () => { live = false; };
  }, [repositoryId, profile?.id, targetKey, continuing, chat?.running]);
  const needsNew = continuing && resumeStatus?.available === false;
  async function send(startNew = false) {
    if (needsNew && !startNew) { setError('Choose Start new chat to continue in a separate conversation.'); return; }
    if (!profile || !draft.trim() || active || sending || (continuing && !resumeStatus)) return;
    setSending(true); setError('');
    try {
      const id = await sendAgentMessage(repositoryId, profile, draft.trim(), mode, chatId, imported && contextReady ? context : [], resumeStatus?.available ? target : undefined, startNew, false, profile.subscription ? model : undefined, undefined, profile.subscription ? effort : undefined);
      drafts.delete(draftKey); setDraft(''); onSelect(!startNew && conversationKey && historyResumeTarget(conversationKey) ? conversationKey : `app:${id}`);
    } catch(e) { setError(String(e)); } finally { setSending(false); }
  }
  const activeProvider = profile?.provider || provider;
  return <form className={`chat-composer${activeProvider ? ` provider-${activeProvider}` : ''}`} onSubmit={event => { event.preventDefault(); void send(); }}>
    <textarea ref={input} aria-label="Message agent" placeholder={needsNew ? 'Start a new chat with this conversation as context…' : continuing ? 'Continue this conversation…' : 'Ask the agent about this repository…'} value={draft} onChange={event => { setDraft(event.target.value); drafts.set(draftKey,event.target.value); requestAnimationFrame(() => { const pane = input.current?.closest('.chat-message-column')?.querySelector('.codex-messages'); if (pane) pane.scrollTop = pane.scrollHeight; }); }} onKeyDown={event => { if (matchesShortcut(event.nativeEvent, 'chat.send')) { event.preventDefault(); void send(); } }} />
    {assignedId && (!assignedProfile || assignedProfile.disconnected) && (!provider || provider==='codex') && <small role="alert">The assigned ChatGPT identity is disconnected. Reconnect it in Identities or assign another account.</small>}
    {continuing && profile && <small role="status">{!resumeStatus ? 'Checking whether this conversation can continue…' : resumeStatus.available ? 'Continuing the existing conversation.' : `New chat required: ${resumeStatus.reason}`}</small>}
    {needsNew && <small>{contextReady ? '“Start new chat” copies the loaded messages. The original conversation is kept.' : 'Stored messages could not be loaded. “Start new chat” sends only the new prompt and keeps the original conversation.'}</small>}
    {chat?.retryable && !needsNew && !active && profile && <button type="button" disabled={sending} onClick={async () => { setSending(true); setError(''); try { await retryConversationAction(chat.id); } catch(e) { setError(String(e)); } finally { setSending(false); } }}>Retry last message</button>}
    {chat && !active && resumeStatus?.available && chat.status !== 'Completed' && <button type="button" disabled={!draft.trim() || sending} onClick={() => { void send(true); }}>Start new chat instead</button>}
    {chat?.status.includes('no credits remaining') && <button type="button" onClick={() => api.openExternalUrl('https://platform.openai.com/settings/organization/billing/').catch(e => setError(String(e)))}>Open API billing</button>}
    {storageError && <p role="alert">{storageError}</p>}
    {!inTauri() && <small>Sending requires the desktop app.</small>}
    {error && <p role="alert">{error}</p>}
    <div className="chat-composer-actions">
      {showAccountPicker && <Select label="Chat account" disabled={!!originalProfile || sending} value={profile?.id || ''} triggerContent={profile ? undefined : 'Select account'} onChange={setProfileId} options={matchingProfiles.map(profile => ({value:profile.id,label:`${profile.label} · ${profile.subscription ? 'ChatGPT subscription' : profile.provider+' API'}`}))} />}
      {active ? <button type="button" onClick={() => stopAgentChat(repositoryId,active.id).catch(e => setError(String(e)))}>Stop</button> : <button className="chat-send" type={needsNew ? 'button' : 'submit'} onClick={needsNew ? () => { void send(true); } : undefined} disabled={!inTauri() || !profile || !draft.trim() || sending || (continuing && !resumeStatus)} aria-label={needsNew ? "Start new chat" : "Send message"} title={needsNew ? contextReady ? 'Start a separate conversation using loaded messages' : 'Start a separate conversation without unavailable history' : 'Send message · Ctrl+Enter'}>{needsNew ? <SquarePen size={18}/> : <ArrowUp size={18}/>}</button>}
    </div>
  </form>;
}
