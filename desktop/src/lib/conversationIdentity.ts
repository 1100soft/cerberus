import { updatedMillis, type Thread } from './conversationCache';
import type { AgentChat } from './agentChats';

/** Link local app records to provider history even when a provider did not report its session ID. */
export function matchingHistoryThread(chat:AgentChat,threads:Thread[]):Thread|undefined{
  const provider=chat.profile.provider;
  const exact=threads.find(thread=>thread.provider===provider&&(chat.session?.sessionId===thread.id||chat.originKey===thread.key));
  if(exact)return exact;
  if(provider!=='codex'||chat.session?.sessionId||chat.originKey)return;
  const prompt=chat.messages.find(message=>message.role==='user')?.text.trim();
  if(!prompt)return;
  const candidates=threads.filter(thread=>thread.provider==='codex'&&Math.abs(updatedMillis(thread.updatedAt)-chat.updatedAt)<120_000&&((!!thread.preview?.trim()&&thread.preview.trim().length>=20&&prompt.startsWith(thread.preview.trim()))||thread.name?.trim()===chat.name.trim()));
  return candidates.length===1?candidates[0]:undefined;
}
