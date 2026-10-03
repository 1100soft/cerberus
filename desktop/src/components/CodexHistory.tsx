import { IdentitySignIn } from './IdentitySignIn';
import { VSCodeIcon, CursorIcon, ClaudeIcon } from './Icons';
import { OpenAILogo } from './OpenAILogo';
import { Github } from 'lucide-react';
import { ConversationSearch } from './ConversationSearch';
import { readCheckpointCommitPrompt } from '../lib/checkpointPrompt';
import { CheckpointPromptDialog } from './CheckpointPromptDialog';
import { EditReview } from './EditReview';
import { completeMessages, textMatches, type ConversationHit } from '../lib/conversationSearch';
import { matchesShortcut, shortcuts, type ShortcutCommand } from '../lib/shortcuts';
import { AgentActivity } from './AgentActivity';
import { foldIntermediateMessages } from '../lib/conversationDisplay';
import { ConversationContextMenu } from './ConversationContextMenu';
import { matchingHistoryThread } from '../lib/conversationIdentity';
import { api } from '../lib/api';
import { useAgentChats, renameAgentChat, archiveAgentChat, type AgentChat } from '../lib/agentChats';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { cursorDisplayText } from "../lib/conversationText";
import { loadOlderMessages, loadOlderThreads, peekList, peekMessages, refreshMessages, refreshThreadList, subscribe, warmRepository, listKey, messageKey, providerName, updatedMillis, type Thread } from "../lib/conversationCache";
import { MessageSquare, RefreshCw, ClipboardCopy, Check, Pencil, Settings2, ArrowUpToLine, ArrowDownToLine, ChevronUp, ChevronDown, LoaderCircle, BookmarkPlus } from "lucide-react";
import { useProviderPreferences } from "../lib/providerPreferences";
import type { CodexMessage, FileEdit, Repository } from "../types";

export function CodexHistory({ repository, unlinkedName, onSetup, onCursorConversation }: { repository?: Repository; unlinkedName?: string; onSetup: (provider: import("./ProviderSetup").Provider) => void; onCursorConversation?: (repositoryId: string, conversationId?: string) => void }) {
  const [settings, setEnabled] = useProviderPreferences();
  const enabled = providers.filter(provider => settings[provider] === true);
  const [revision, setRevision] = useState(0);
  useEffect(()=>{const finished=()=>setRevision(value=>value+1);window.addEventListener('saved-prompt-finished',finished);return()=>window.removeEventListener('saved-prompt-finished',finished);},[]);
  const [cursorConversationId, setCursorConversationId] = useState<string>();
  const [copyStatus,setCopyStatus]=useState<'idle'|'copied'|'error'>('idle');
  const [editCheckpoint,setEditCheckpoint]=useState(false);
  const copyTimer=useRef<number>();
  useEffect(()=>()=>window.clearTimeout(copyTimer.current),[]);
  const copyCheckpointPrompt=async()=>{try{await navigator.clipboard.writeText(readCheckpointCommitPrompt());setCopyStatus('copied');}catch{setCopyStatus('error');}window.clearTimeout(copyTimer.current);copyTimer.current=window.setTimeout(()=>setCopyStatus('idle'),2500);};
  const reportCursorConversation = useCallback((id?: string) => { setCursorConversationId(id); if (repository) onCursorConversation?.(repository.id, id); }, [repository?.id, onCursorConversation]);
  return <section className="codex-panel" aria-label="Agent conversations">
    <header><div className="agent-heading"><h2><MessageSquare size={18} />Agent</h2></div><div className="codex-actions">
      {repository && <><button type="button" aria-label="Open in VS Code" title="Continue in VS Code" onClick={() => void api.openEditor(repository.id)}><VSCodeIcon/></button><button type="button" aria-label="Open in Cursor" title={cursorConversationId ? "Open this conversation in the Cursor Agents window" : "Open this repository in the Cursor Agents window"} onClick={() => void api.openCursor(repository.id, cursorConversationId)}><CursorIcon/></button></>}
      {repository&&<button type="button" aria-label={copyStatus==='copied'?"Checkpoint prompt copied":copyStatus==='error'?"Could not copy checkpoint prompt":"Copy checkpoint commit prompt"} title={copyStatus==='copied'?"Checkpoint prompt copied":copyStatus==='error'?"Could not copy prompt":"Copy checkpoint commit prompt for the working agent"} onClick={()=>void copyCheckpointPrompt()}>{copyStatus==='copied'?<Check size={16}/>:<ClipboardCopy size={16}/>}</button>}
      {repository&&<button type="button" aria-label="Edit checkpoint commit prompt" title="Edit checkpoint commit prompt" onClick={()=>setEditCheckpoint(true)}><Pencil size={16}/></button>}
      <IdentitySignIn />
      <button type="button" aria-label="Refresh conversations" onClick={() => setRevision((value) => value + 1)}><RefreshCw size={16} /></button>
    </div></header>
    <div className="provider-controls" aria-label="Conversation providers">{providers.map(provider => <div className="provider-control" key={provider}><label className={`provider-name provider-${provider}`} title={`Show ${providerName(provider)} conversations`}><input type="checkbox" checked={settings[provider] === true} onChange={event => setEnabled(provider, event.target.checked)} />{providerIcon[provider]}<span>{providerName(provider)}</span></label><button type="button" className={`provider-name provider-${provider}`} aria-label={`Set up ${providerName(provider)}`} title={`Set up ${providerName(provider)}`} onClick={() => onSetup(provider)}><Settings2 size={14} /></button></div>)}</div>
    <div className="codex-body">
    {repository && <ConversationBrowser key={repository.id} repository={repository} revision={revision} enabled={enabled} onCursorConversation={reportCursorConversation} />}
    {!repository && <p className="panel-copy">{unlinkedName ? "Link an existing local checkout, or clone a new one, to see its conversations." : "Select a repository to see its conversations."}</p>}
    </div>
    {editCheckpoint&&<CheckpointPromptDialog onClose={()=>setEditCheckpoint(false)}/>}
  </section>;
}

type Provider = import("../lib/conversationCache").Provider;
const providerIcon = {codex:<OpenAILogo/>,cursor:<CursorIcon/>,copilot:<Github/>,claude:<ClaudeIcon/>};
const providers: Provider[] = ["codex", "cursor", "copilot", "claude"];


function ConversationBrowser({ repository, revision, enabled, onCursorConversation }: { repository: Repository; revision: number; enabled: Provider[]; onCursorConversation: (id?: string) => void }) {
  const [archived, setArchived] = useState(false);
  const chats = useAgentChats().filter(chat => chat.repositoryId === repository.id);
  const listedChats = chats.filter(chat => !chat.originKey && !!chat.archived === archived);
  const enabledKey = enabled.join(",");
  const [contextMenu,setContextMenu]=useState<{x:number;y:number;chat?:AgentChat;thread?:Thread}>();
  const [menuError,setMenuError]=useState("");
  const [cursorNames,setCursorNames]=useState<Record<string,string>>(()=>{try{return JSON.parse(localStorage.getItem('gitcerberus.cursorConversationNames')||'{}')}catch{return {}}});
  const list = peekList(listKey(repository.id, archived, enabled));
  const [threads, setThreads] = useState<Thread[]>(() => list?.threads ?? []);
  const [cursors, setCursors] = useState(() => list?.cursors ?? {});
  const [listError, setListError] = useState(list?.error ?? "");
  const [loading, setLoading] = useState(!list);
  const visible = threads.filter((thread) => enabled.includes(thread.provider)).map(thread=>thread.provider==='cursor' && cursorNames[thread.id]?{...thread,name:cursorNames[thread.id]}:thread);
  const matchingThread=(chat:AgentChat)=>matchingHistoryThread(chat,visible);
  const entries = [
    ...listedChats.map(chat=>({key:`app:${chat.id}`,time:Math.max(updatedMillis(chat.updatedAt),updatedMillis(matchingThread(chat)?.updatedAt||0)),chat,thread:undefined as Thread|undefined})),
    ...visible.filter(thread=>!listedChats.some(chat=>matchingThread(chat)?.key===thread.key)).map(thread=>({key:thread.key,time:Math.max(updatedMillis(thread.updatedAt),...chats.filter(chat=>chat.originKey===thread.key).map(chat=>updatedMillis(chat.updatedAt))),chat:undefined as AgentChat|undefined,thread})),
  ].sort((a,b)=>b.time-a.time || a.key.localeCompare(b.key));
  const [selected, setSelected] = useState<string>();
  const [selectionExplicit, setSelectionExplicit] = useState(false);
  const chooseConversation = (key:string) => { setSelectionExplicit(true); setSelected(key); };
  const menuAction=async(action:'rename'|'archive'|'copy'|'share')=>{
    const target=contextMenu;if(!target)return;const chat=target.chat,thread=target.thread;const title=chat?.name||thread?.name||thread?.preview||'Untitled conversation';
    try {
      if(action==='rename'){const name=window.prompt('Conversation name',title)?.trim();if(!name)return;if(chat)renameAgentChat(chat.id,name);else if(thread?.provider==='codex'){await api.codexUpdateThread(repository.id,thread.id,'rename',name);await refreshThreadList(repository.id,archived,enabled);}else if(thread){const next={...cursorNames,[thread.id]:name};setCursorNames(next);localStorage.setItem('gitcerberus.cursorConversationNames',JSON.stringify(next));}}
      else if(action==='archive'){if(chat)archiveAgentChat(chat.id,!chat.archived);else if(thread?.provider==='codex'){await api.codexUpdateThread(repository.id,thread.id,archived?'unarchive':'archive');await refreshThreadList(repository.id,archived,enabled);}else if(thread){await api.cursorArchiveThread(repository.id,thread.id,!archived);await refreshThreadList(repository.id,archived,enabled);}}
      else {const available=thread ? (await completeMessages(repository.id,thread,()=>false)).messages : undefined;const transcript=(chat?.messages||available||[]).map(message=>`${message.role}: ${message.text}`).join('\n\n');if(!transcript)throw new Error('No conversation messages are available to copy.');if(action==='share' && navigator.share)await navigator.share({title,text:transcript});else await navigator.clipboard.writeText(transcript);}
      setMenuError('');
    }catch(error){setMenuError(String(error));}
  };
  const latestKey = entries[0]?.key;
  const directAppChat = chats.find(chat => `app:${chat.id}` === selected);
  const selectedThread = selected === "new" ? undefined : directAppChat ? matchingThread(directAppChat) : visible.find((thread) => thread.key === selected) ?? visible[0];
  const selectedKey = selectedThread?.key;
  const saveMessagePrompt=(message:CodexMessage)=>window.dispatchEvent(new CustomEvent('new-automation-from-prompt',{detail:{repositoryId:repository.id,provider:(appChat?.profile.provider||selectedThread?.provider||'codex') as Provider,prompt:message.text}}));
  const cursorConversationId = selected === "new" ? undefined : selectedThread?.provider === "cursor" ? selectedThread.id : directAppChat?.profile.provider === "cursor" ? directAppChat.session?.sessionId : undefined;
  useEffect(() => { onCursorConversation(cursorConversationId); }, [cursorConversationId, onCursorConversation]);
  const linkedChat = selectedKey ? chats.find(chat => chat.originKey === selectedKey) : undefined;
  const appChat = directAppChat || linkedChat;
  const cached = selectedKey ? peekMessages(messageKey(repository.id, selectedKey)) : undefined;
  const [messages, setMessages] = useState<CodexMessage[]>(() => cached?.messages ?? []);
  const [messageCursor, setMessageCursor] = useState<string | null | undefined>(() => cached?.nextCursor);
  const [reading, setReading] = useState(() => !!selectedKey && !cached);
  const [readError, setReadError] = useState("");
  const messagePane = useRef<HTMLDivElement>(null);
  const scrollIntent = useRef<{ kind: "latest" } | { kind: "older"; height: number; top: number } | undefined>({ kind: "latest" });
  const [messageQuery,setMessageQuery] = useState('');
  const [repoHits,setRepoHits]=useState<ConversationHit[]>([]);
  const repoSearch=useRef({query:'',index:-1});
  const pendingMatch=useRef<{key:string;id?:string;occurrence:number}>();
  const [matchIndex,setMatchIndex] = useState(0);
  const [reviewEdits,setReviewEdits] = useState<FileEdit[]>();
  const [navigationBusy,setNavigationBusy] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const providerHasLocalPrompt=!!appChat && messages.some(message=>message.role==='user' && message.text===appChat.messages.filter(item=>item.role==='user').at(-1)?.text);
  const displayedMessages = appChat && (appChat.running || !selectedThread || !messages.length || (messages.length < appChat.messages.length && !providerHasLocalPrompt)) ? appChat.messages : messages;
  const renderedMessages=foldIntermediateMessages(displayedMessages);
  const continuedOutside=!!appChat && !!selectedThread && !appChat.running && updatedMillis(selectedThread.updatedAt)>appChat.updatedAt
    && messages.filter(message=>message.role==='user').at(-1)?.text!==appChat.messages.filter(message=>message.role==='user').at(-1)?.text;
  const matchedMessages = textMatches(displayedMessages,messageQuery);
  const jumpToMessage = (id:string, occurrence?:number) => {
    const pane=messagePane.current; if(!pane)return;
    const article=[...pane.querySelectorAll<HTMLElement>('[data-message-id]')].find(node=>node.dataset.messageId===id);
    for(let node:HTMLElement|null|undefined=article;node;node=node.parentElement)if(node instanceof HTMLDetailsElement)node.open=true;
    const node=occurrence===undefined ? article : article?.querySelectorAll<HTMLElement>('mark')[occurrence] || article;
    pane.querySelectorAll('.current-search-match').forEach(node=>node.classList.remove('current-search-match'));
    if(occurrence!==undefined)node?.classList.add('current-search-match');
    if(node) { const scale=pane.getBoundingClientRect().height/pane.offsetHeight || 1; pane.scrollTop+=(node.getBoundingClientRect().top-pane.getBoundingClientRect().top)/scale; }
  };
  const searchJump = (delta:number) => { if(!matchedMessages.length)return; const next=(matchIndex+delta+matchedMessages.length)%matchedMessages.length;setMatchIndex(next);pendingMatch.current=undefined;jumpToMessage(matchedMessages[next].id,matchedMessages[next].occurrence); };
  useEffect(()=>{
    const pending=pendingMatch.current;
    if(pending && pending.key===selected){
      const index=matchedMessages.findIndex(match=>match.id===pending.id && match.occurrence===pending.occurrence);
      if(index>=0){setMatchIndex(index);requestAnimationFrame(()=>jumpToMessage(pending.id!,pending.occurrence));}
      return;
    }
    setMatchIndex(0);if(matchedMessages[0])requestAnimationFrame(()=>jumpToMessage(matchedMessages[0].id,0));
  },[messageQuery,selected,displayedMessages,matchedMessages.length]);
  useEffect(()=>{
    if(!messageQuery.trim() || !selectedThread || !messageCursor)return;
    let cancelled=false;setNavigationBusy(true);
    void completeMessages(repository.id,selectedThread,()=>cancelled).catch(error=>{if(!cancelled)setReadError(String(error));}).finally(()=>{if(!cancelled)setNavigationBusy(false);});
    return ()=>{cancelled=true;setNavigationBusy(false);};
  },[messageQuery,selectedKey]);
  const navigate = async (command:ShortcutCommand) => {
    const pane=messagePane.current;if(!pane || navigationBusy)return;
    if(command==='message.first') {
      if(selectedThread && messageCursor) { setNavigationBusy(true);try { await completeMessages(repository.id,selectedThread,()=>!pane.isConnected); } catch(error){setReadError(String(error));}finally{setNavigationBusy(false);} }
      requestAnimationFrame(()=>{pane.scrollTop=0;});return;
    }
    if(command==='message.last'){pane.scrollTop=pane.scrollHeight;return;}
    const nodes=[...pane.querySelectorAll<HTMLElement>('[data-message-id]')];
    const top=pane.getBoundingClientRect().top;
    const node=command==='message.previous' ? nodes.reverse().find(node=>node.getBoundingClientRect().top<top-3) : nodes.find(node=>node.getBoundingClientRect().top>top+3);
    if(node)jumpToMessage(node.dataset.messageId!);
    else if(command==='message.previous' && selectedThread && messageCursor) { await moreMessages(); requestAnimationFrame(()=>{const previous=[...pane.querySelectorAll<HTMLElement>('[data-message-id]')].reverse().find(node=>node.getBoundingClientRect().top<pane.getBoundingClientRect().top-3);if(previous)jumpToMessage(previous.dataset.messageId!);}); }
  };
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.defaultPrevented || document.querySelector('[role=dialog], [role=listbox]'))return;
      if(matchesShortcut(event,'search.conversations')){event.preventDefault();document.querySelector<HTMLInputElement>('[aria-label="Search repository conversations"]')?.focus();return;}
      if(matchesShortcut(event,'search.messages')){event.preventDefault();searchInput.current?.focus();return;}
      for(const command of ['message.first','message.last','message.previous','message.next'] as const)if(matchesShortcut(event,command)){event.preventDefault();void navigate(command);return;}
    };
    document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true);
  });
  const globalMatches=(hits:ConversationHit[])=>hits.flatMap(hit=>(hit.matches.length ? hit.matches : [{id:undefined,occurrence:0}]).map(match=>({hit,...match})));
  const selectRepoMatch=(hits:ConversationHit[],index:number,query:string)=>{
    const match=globalMatches(hits)[index];if(!match)return;
    repoSearch.current.index=index;pendingMatch.current={key:match.hit.key,id:match.id,occurrence:match.occurrence};
    setArchived(match.hit.archived);chooseConversation(match.hit.key);setMessageQuery(query);
    if(match.hit.key===selected && match.id){setMatchIndex(index-globalMatches(hits).findIndex(item=>item.hit.key===match.hit.key));requestAnimationFrame(()=>jumpToMessage(match.id!,match.occurrence));}
  };
  const receiveRepoHits=(query:string,hits:ConversationHit[])=>{
    if(repoSearch.current.query!==query){repoSearch.current={query,index:-1};pendingMatch.current=undefined;setMessageQuery(query);}
    setRepoHits(hits);if(hits.length && repoSearch.current.index<0)selectRepoMatch(hits,0,query);
  };
  const navigateRepoMatch=(delta:number)=>{const count=globalMatches(repoHits).length;if(count)selectRepoMatch(repoHits,(repoSearch.current.index+delta+count)%count,repoSearch.current.query);};
  const lastRepo = useRef(repository.id);
  const scope = `${repository.id}:${archived}:${enabledKey}`;
  const [seenScope, setSeenScope] = useState(scope);
  if (scope !== seenScope) {
    setSeenScope(scope);
    lastRepo.current = repository.id;
    const next = peekList(listKey(repository.id, archived, enabled));
    const first = selected === 'new' || selected?.startsWith('app:') ? selected : next?.threads.find(thread => thread.key === selected)?.key || next?.threads[0]?.key;
    const cachedNext = first ? peekMessages(messageKey(repository.id, first)) : undefined;
    setThreads(next?.threads ?? []); setCursors(next?.cursors ?? {}); setListError(next?.error ?? ""); setLoading(!next);
    setSelected(first);
    setMessages(cachedNext?.messages ?? []); setMessageCursor(cachedNext?.nextCursor);
    setReading(!!first && !cachedNext); setReadError("");
    scrollIntent.current = { kind: "latest" };
  }

  function showCached(threadKey: string, intent: "latest" | undefined) {
    const next = peekMessages(messageKey(repository.id, threadKey));
    if (!next) return false;
    if (intent) scrollIntent.current = { kind: intent };
    else {
      const pane = messagePane.current;
      if (pane && pane.scrollHeight - pane.scrollTop - pane.clientHeight < 96) scrollIntent.current = { kind: "latest" };
    }
    setMessages(next.messages); setMessageCursor(next.nextCursor); setReading(false); setReadError("");
    return true;
  }

  useEffect(() => subscribe(() => {
    const next = peekList(listKey(repository.id, archived, enabled));
    if (next) { setThreads(next.threads); setCursors(next.cursors); setListError(next.error); setLoading(false); }
    if (selectedKey) showCached(selectedKey, undefined);
  }), [repository.id, archived, enabledKey, selectedKey]);

  useEffect(() => {
    const next = peekList(listKey(repository.id, archived, enabled));
    const repoChanged = lastRepo.current !== repository.id;
    lastRepo.current = repository.id;
    setThreads(next?.threads ?? []); setCursors(next?.cursors ?? {}); setListError(next?.error ?? ""); setLoading(!next);
    const nextSelected = selected === 'new' || selected?.startsWith('app:') ? selected : (repoChanged ? next?.threads[0]?.key : selectedKey) ?? next?.threads[0]?.key;
    if (nextSelected !== selected) setSelected(nextSelected);
    if (nextSelected && showCached(nextSelected, "latest")) { /* cached paint */ }
    else {
      scrollIntent.current = { kind: "latest" };
      setMessages([]); setMessageCursor(undefined); setReading(!!nextSelected); setReadError("");
    }
    void refreshThreadList(repository.id, archived, enabled).catch((error) => setListError(String(error)));
  }, [repository.id, archived, enabledKey]);

  useEffect(() => {
    if (!revision) return;
    void refreshThreadList(repository.id, archived, enabled).then((list) => {
      const thread = list.threads.find((item) => item.key === selectedKey) ?? list.threads[0];
      if (thread) return refreshMessages(repository.id, thread, true);
    }).catch((error) => setListError(String(error)));
  }, [revision]);

  useEffect(() => {
    if (!selectionExplicit && latestKey) setSelected(latestKey);
  }, [latestKey, selectionExplicit]);

  useEffect(() => {
    if (!selectedThread) return;
    let active = true;
    if (!showCached(selectedThread.key, "latest")) {
      scrollIntent.current = { kind: "latest" };
      setMessages([]); setMessageCursor(undefined); setReading(true); setReadError("");
    }
    void refreshMessages(repository.id, selectedThread).then(() => { if (active) showCached(selectedThread.key, undefined); }).catch((error) => { if (active) { setReadError(String(error)); setReading(false); } });
    return () => { active = false; };
  }, [repository.id, selectedThread?.key, selectedThread?.updatedAt]);

  useEffect(() => {
    const revalidate = () => { void refreshThreadList(repository.id, archived, enabled).catch(() => {}); };
    window.addEventListener("focus", revalidate);
    const timer = window.setInterval(revalidate, 20000);
    return () => { window.removeEventListener("focus", revalidate); window.clearInterval(timer); };
  }, [repository.id, archived, enabledKey]);

  const cursorWorking = threads.some((thread) => thread.provider === "cursor" && thread.working);
  useEffect(() => {
    if (!cursorWorking) return;
    const timer = window.setInterval(() => {
      void refreshThreadList(repository.id, archived, enabled, "cursor").then((list) => {
        const open = list.threads.find((item) => item.key === selectedKey);
        if (open?.working) return refreshMessages(repository.id, open, true);
      }).catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [repository.id, archived, enabledKey, selectedKey, cursorWorking]);

  useLayoutEffect(() => {
    const pane = messagePane.current;
    const intent = scrollIntent.current;
    if (!pane || !intent) return;
    if (intent.kind === "older") {
      pane.scrollTop = intent.top + pane.scrollHeight - intent.height;
      scrollIntent.current = undefined;
      return;
    }
    if (reading && !messages.length) return;
    const align = () => {
      const prompts = pane.querySelectorAll<HTMLElement>(".codex-message.user");
      const latest = prompts[prompts.length - 1];
      pane.scrollTop = latest ? latest.offsetTop : pane.scrollHeight;
    };
    align();
    const frame = requestAnimationFrame(align);
    scrollIntent.current = undefined;
    return () => cancelAnimationFrame(frame);
  }, [messages, reading, selectedKey]);

  useEffect(() => {
    const cycle = (event: Event) => {
      const keys = ['new', ...listedChats.map(chat => `app:${chat.id}`), ...visible.map(thread => thread.key)];
      const index = Math.max(0, keys.indexOf(selected || selectedKey || 'new'));
      const delta = (event as CustomEvent<number>).detail;
      chooseConversation(keys[(index + delta + keys.length) % keys.length]);
    };
    window.addEventListener('conversation-cycle', cycle);
    return () => window.removeEventListener('conversation-cycle', cycle);
  }, [selected, selectedKey, chats.map(chat => chat.id).join(','), visible.map(thread => thread.key).join(',')]);
  useEffect(() => { document.querySelector('.codex-thread-list .active')?.scrollIntoView({block:'nearest'}); }, [selected]);
  useEffect(() => { if (appChat && messagePane.current) messagePane.current.scrollTop = messagePane.current.scrollHeight; }, [appChat?.messages]);
  async function moreMessages() {
    if (!selectedThread || reading) return;
    const previous = { kind: "older" as const, height: messagePane.current?.scrollHeight ?? 0, top: messagePane.current?.scrollTop ?? 0 };
    setReading(true); setReadError("");
    try {
      const next = await loadOlderMessages(repository.id, selectedThread, messageCursor);
      scrollIntent.current = previous;
      setMessages(next.messages); setMessageCursor(next.nextCursor);
    } catch (error) { setReadError(String(error)); }
    finally { setReading(false); }
  }

  async function more(provider: Provider) {
    setLoading(true);
    try {
      const next = await loadOlderThreads(repository.id, archived, enabled, provider, cursors[provider]);
      setThreads(next.threads); setCursors(next.cursors);
    } catch (error) { setListError(`${providerName(provider)}: ${String(error)}`); }
    finally { setLoading(false); }
  }

  return <>
    {listError && <details className="config-error provider-errors"><summary>A configured provider is unavailable · retry or adjust its setup</summary><p role="alert">{listError}</p></details>}
    {menuError && <p className="config-error" role="alert">{menuError}</p>}
    <div className="codex-conversations">
      <div className="codex-thread-list" aria-label="Conversations" aria-busy={loading}><ConversationSearch repositoryId={repository.id} enabled={enabled} chats={chats} onResults={receiveRepoHits} onNavigate={navigateRepoMatch} />
        <div className="conversation-list-tools"><label className="codex-archive"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Archived</label></div>
        {entries.map(entry=>entry.chat ? <button type="button" key={entry.key} className={`${repoHits.some(hit=>hit.key===entry.key) ? 'search-hit' : ''} provider-${entry.chat.profile.provider} ${appChat?.id === entry.chat.id ? 'active' : ''}`} aria-pressed={appChat?.id === entry.chat.id} title={`${entry.chat.profile.provider} · ${entry.chat.profile.label} · ${new Date(entry.time).toLocaleString()} · ${entry.chat.status}`} onClick={() => chooseConversation(entry.key)} onContextMenu={event=>{event.preventDefault();setContextMenu({x:event.clientX,y:event.clientY,chat:entry.chat});}}><span className="conversation-provider-mark">{providerIcon[entry.chat.profile.provider as Provider] || <MessageSquare/>}</span><b>{entry.chat.name}</b>{(entry.chat.running || matchingThread(entry.chat)?.working) && <LoaderCircle className="conversation-working" size={13} aria-label="Agent working" />}</button> : entry.thread && <button type="button" key={entry.key} className={`${repoHits.some(hit=>hit.key===entry.key) ? 'search-hit' : ''} provider-${entry.thread.provider} ${selectedKey === entry.key ? 'active' : ''}`} aria-pressed={selectedKey === entry.key} onClick={() => chooseConversation(entry.key)} onContextMenu={event=>{event.preventDefault();setContextMenu({x:event.clientX,y:event.clientY,thread:entry.thread});}}><span className="conversation-provider-mark">{providerIcon[entry.thread.provider]}</span><b title={`${providerName(entry.thread.provider)} · ${new Date(updatedMillis(entry.thread.updatedAt)).toLocaleString()}${entry.thread.gitInfo?.branch ? ` · ${entry.thread.gitInfo.branch}` : ''}${entry.thread.provider === "copilot" || entry.thread.provider === "claude" ? " · Live activity unavailable" : ""}
${entry.thread.name || entry.thread.preview}`}>{entry.thread.name || entry.thread.preview || "Untitled conversation"}</b>{(entry.thread.working || chats.some(chat=>chat.originKey===entry.key && chat.running)) && <LoaderCircle className="conversation-working" size={13} aria-label="Agent working" />}</button>)}
        {loading && <p className="panel-copy" role="status">Loading conversations…</p>}
        {!loading && !listError && !visible.length && <p className="panel-copy">No {archived ? "archived " : ""}conversations found for this directory.</p>}
        {providers.filter((provider) => cursors[provider] && enabled.includes(provider)).map((provider) => <button key={provider} type="button" disabled={loading} onClick={() => more(provider)}>Load older {providerName(provider)} conversations</button>)}
      </div>
      <div className="chat-message-column"><div className="message-search"><input ref={searchInput} type="search" aria-label="Search this conversation" placeholder="Find in chat · Ctrl+Shift+F" value={messageQuery} onChange={event=>{pendingMatch.current=undefined;setMessageQuery(event.target.value);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();searchJump(event.shiftKey ? -1 : 1);}}}/>{messageQuery && <><span role="status">{navigationBusy ? 'Searching…' : `${matchedMessages.length ? matchIndex+1 : 0}/${matchedMessages.length} matches`}</span><button title="Previous match · Shift+Enter" aria-label="Previous search match" onClick={()=>searchJump(-1)}>↑</button><button title="Next match · Enter" aria-label="Next search match" onClick={()=>searchJump(1)}>↓</button></>}</div><div className="message-display"><div ref={messagePane} className="codex-messages" aria-label="Conversation messages" aria-busy={reading}>
        {appChat ? <>{readError && <p className="config-error" role="alert">{readError}</p>}{renderedMessages.map((message,index) => <ConversationMessage key={message.id} message={message} query={messageQuery} onReview={setReviewEdits} formatCursor={false} finished={!appChat.running || index < renderedMessages.length-1} onSavePrompt={()=>saveMessagePrompt(message)} />)}<p className="chat-status" role="status">{continuedOutside ? 'Continued outside this app · history is available here' : appChat.status}</p></> : selected === 'new' || !selectedThread ? <p className="panel-copy">Select a conversation to read its history. Open this repository in VS Code or Cursor to continue working.</p> : <>
        {messageCursor && <button type="button" disabled={reading} onClick={moreMessages}>Load older messages</button>}
        {reading && <p className="panel-copy" role="status">Loading messages…</p>}
        {readError && <p className="config-error" role="alert">{readError}</p>}
        {!selectedThread && <p className="panel-copy">Choose a conversation from the list.</p>}
        {selectedThread && !reading && !readError && !messages.length && <p className="panel-copy">No stored user or assistant messages in this conversation.</p>}
        {renderedMessages.map((message, index) => <ConversationMessage key={`${message.id}-${index}`} message={message} query={messageQuery} onReview={setReviewEdits} formatCursor={!!selected?.startsWith("cursor:")} finished={!selectedThread.working || index < renderedMessages.length - 1} onSavePrompt={()=>saveMessagePrompt(message)} />)}
        {selectedThread.working && <p className={`chat-status provider-${selectedThread.provider}`} role="status"><LoaderCircle className="conversation-working" size={13} aria-label="Agent working" /> Working</p>}
        </>}
      </div><div className="conversation-navigation" aria-label="Conversation navigation">{([['message.first',ArrowUpToLine],['message.previous',ChevronUp],['message.next',ChevronDown],['message.last',ArrowDownToLine]] as const).map(([command,Icon])=><button key={command} disabled={navigationBusy} aria-label={shortcuts[command].description} title={`${shortcuts[command].description} · ${shortcuts[command].label}`} onClick={()=>void navigate(command)}><Icon size={16}/><kbd>{shortcuts[command].label}</kbd></button>)}</div></div></div>
    </div>
    {contextMenu && <ConversationContextMenu x={contextMenu.x} y={contextMenu.y} title={contextMenu.chat?.name||contextMenu.thread?.name||contextMenu.thread?.preview||"Untitled conversation"} archived={archived} canManage={!contextMenu.thread || contextMenu.thread.provider === "codex" || contextMenu.thread.provider === "cursor"} onAction={action=>{void menuAction(action);}} onClose={()=>setContextMenu(undefined)}/>}
    {reviewEdits && <EditReview edits={reviewEdits} onClose={()=>setReviewEdits(undefined)} />}
  </>;
}

const markdownCache = new Map<string, React.ReactElement>();
const markdownComponents = { a: ({ children, href }: { children?: React.ReactNode; href?: string }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ alt }: { alt?: string }) => <span>{alt ? `[Image: ${alt}]` : "[Image]"}</span> };
function highlight(query:string) {
  return () => (tree:any) => {
    const visit=(node:any)=>{if(!node.children)return;node.children=node.children.flatMap((child:any)=>{
      if(child.type!=='text'){visit(child);return [child];}
      const text=child.value as string,lower=text.toLocaleLowerCase(),needle=query.toLocaleLowerCase();const result:any[]=[];let start=0,at=lower.indexOf(needle);
      while(at>=0){if(at>start)result.push({type:'text',value:text.slice(start,at)});result.push({type:'element',tagName:'mark',properties:{},children:[{type:'text',value:text.slice(at,at+needle.length)}]});start=at+needle.length;at=lower.indexOf(needle,start);}
      if(start<text.length)result.push({type:'text',value:text.slice(start)});return result;
    });};visit(tree);
  };
}
const ConversationMessage = memo(function ConversationMessage({ message, formatCursor,query,onReview,onSavePrompt,finished=true }: { message: CodexMessage; formatCursor: boolean;query:string;onReview:(edits:FileEdit[])=>void;onSavePrompt?:()=>void;finished?:boolean }) {
  const text = formatCursor && message.role === "user" ? cursorDisplayText(message.text) : message.text;
  const cacheKey = text+'\0'+query.trim();
  let markdown = markdownCache.get(cacheKey);
  if (!markdown) { markdown = <Markdown rehypePlugins={query.trim() ? [highlight(query.trim())] : []} components={markdownComponents}>{text}</Markdown>; if(markdownCache.size>40)markdownCache.clear();markdownCache.set(cacheKey, markdown); }
  return <article data-message-id={message.id} className={`codex-message ${message.role}`}>{message.role === 'assistant' && <AgentActivity steps={message.steps} finished={finished} />}{!!text && <div className="conversation-markdown">{markdown}</div>}{message.role==='user'&&!!text&&<button type="button" className="save-prompt-edge" aria-label="Save this prompt" title="Save this prompt as an automation" onClick={onSavePrompt}><BookmarkPlus size={14}/></button>}{message.edits?.length ? <button className="turn-edits-button" onClick={()=>onReview(message.edits!)}>Review {new Set(message.edits.map(edit=>edit.path)).size} changed file{message.edits.length === 1 ? '' : 's'}</button> : null}</article>;
});
