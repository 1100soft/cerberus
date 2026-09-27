import { useEffect, useRef, useState } from 'react';
import { searchConversations, type ConversationHit } from '../lib/conversationSearch';
import type { AgentChat } from '../lib/agentChats';
import type { Provider } from '../lib/conversationCache';
export function ConversationSearch({repositoryId,enabled,chats,onResults,onNavigate}:{repositoryId:string;enabled:Provider[];chats:AgentChat[];onResults:(query:string,hits:ConversationHit[])=>void;onNavigate:(delta:number)=>void}) {
  const [query,setQuery]=useState(''); const [count,setCount]=useState(0);
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const publish=useRef(onResults);publish.current=onResults;
  useEffect(()=>{
    let cancelled=false;setCount(0);setError('');setBusy(!!query.trim());publish.current(query,[]);
    if(!query.trim()) return;
    const timer=setTimeout(()=>{void searchConversations(repositoryId,enabled,chats,query,()=>cancelled,(next,error)=>{if(!cancelled){setCount(next.length);setError(error || '');publish.current(query,next);}}).catch(e=>{if(!cancelled)setError(String(e));}).finally(()=>{if(!cancelled)setBusy(false);});},250);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[query,repositoryId,enabled.join(','),chats.map(chat=>`${chat.id}:${chat.updatedAt}:${chat.running}`).join(',')]);
  return <div className="conversation-search"><input type="search" aria-label="Search repository conversations" placeholder="Search all chats · Ctrl+F" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();onNavigate(event.shiftKey ? -1 : 1);}}}/>{query && <div className="repository-search-status"><span role="status">{busy ? 'Searching…' : `${count} conversations`}</span><button aria-label="Previous repository search match" title="Previous match · Shift+Enter" onClick={()=>onNavigate(-1)}>↑</button><button aria-label="Next repository search match" title="Next match · Enter" onClick={()=>onNavigate(1)}>↓</button>{error && <p role="alert">{error}</p>}</div>}</div>;
}
