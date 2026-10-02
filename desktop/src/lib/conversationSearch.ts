import { loadOlderMessages, loadOlderThreads, refreshMessages, refreshThreadList, type Provider, type Thread, type MessageCache } from './conversationCache';
import type { AgentChat } from './agentChats';
import type { CodexMessage } from '../types';
export type ConversationHit = {key:string; title:string; provider:string; archived:boolean; messageId?:string; snippet:string; matches:{id:string;occurrence:number}[]};
export const containsQuery = (text:string, query:string) => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
export async function completeMessages(repositoryId:string, thread:Thread, cancelled:()=>boolean):Promise<MessageCache> {
  let page = await refreshMessages(repositoryId,thread);
  const seen = new Set<string>();
  while (page.nextCursor && !cancelled()) {
    if (seen.has(page.nextCursor)) throw Error('Provider repeated a message cursor; some history could not be searched.');
    seen.add(page.nextCursor); page = await loadOlderMessages(repositoryId,thread,page.nextCursor);
  }
  return page;
}
export function textMatches(messages:CodexMessage[],query:string) {
  const needle=query.trim().toLocaleLowerCase();
  if(!needle)return [];
  return messages.flatMap(message=>{const text=message.text.toLocaleLowerCase();const hits:{id:string;occurrence:number}[]=[];let at=0;while((at=text.indexOf(needle,at))!==-1){hits.push({id:message.id,occurrence:hits.length});at+=needle.length;}return hits;});
}
function match(key:string,title:string,provider:string,archived:boolean,messages:CodexMessage[],query:string):ConversationHit|undefined {
  const message = messages.find(message => containsQuery(message.text,query));
  if (!message && !containsQuery(title,query)) return;
  const text = message?.text || title;
  const at = Math.max(0,text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase())-45);
  return {key,title,provider,archived,messageId:message?.id,matches:textMatches(messages,query),snippet:text.slice(at,at+180)};
}
/** Explicit search reads every local history page, including archives, only for enabled providers. */
export async function searchConversations(repositoryId:string,enabled:Provider[],chats:AgentChat[],query:string,cancelled:()=>boolean,publish:(hits:ConversationHit[],error?:string)=>void) {
  const hits:ConversationHit[] = [];
  for(const chat of chats) { const hit=match(`app:${chat.id}`,chat.name,chat.profile.provider,false,chat.messages,query); if(hit) hits.push(hit); }
  publish([...hits]);
  const errors:string[]=[];
  for(const archived of [false,true]) {
    if(cancelled()) return;
    let list = await refreshThreadList(repositoryId,archived,enabled);
    if(list.error) errors.push(list.error);
    for(const provider of enabled) {
      const seen=new Set<string>();
      while(list.cursors[provider] && !cancelled()) {
        const cursor=list.cursors[provider]!;
        if(seen.has(cursor)) { errors.push('Provider repeated a conversation cursor.'); break; }
        seen.add(cursor); list=await loadOlderThreads(repositoryId,archived,enabled,provider,cursor);
      }
    }
    for(const thread of list.threads) {
      if(cancelled()) return;
      try {
        const page=await completeMessages(repositoryId,thread,cancelled);
        const hit=match(thread.key,thread.name || thread.preview || 'Untitled conversation',thread.provider,archived,page.messages,query);
        if(hit && !hits.some(item=>item.key===hit.key)) hits.push(hit);
      } catch(error) { errors.push(`${thread.provider}: ${String(error)}`); }
      if(!cancelled()) publish([...hits],errors.length ? 'Some history could not be searched: '+[...new Set(errors)].join(' ') : undefined);
    }
  }
  if(!cancelled()) publish([...hits],errors.length ? 'Some history could not be searched: '+[...new Set(errors)].join(' ') : undefined);
}
