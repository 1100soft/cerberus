import type { CodexMessage, AgentStep } from '../types';

/** Keep provider history intact in the cache, but show consecutive assistant updates as one turn. */
export function foldIntermediateMessages(messages: CodexMessage[]): CodexMessage[] {
  const result: CodexMessage[] = [];
  for (let index = 0; index < messages.length;) {
    if (messages[index].role !== 'assistant') { result.push(messages[index++]); continue; }
    let end = index + 1;
    while (end < messages.length && messages[end].role === 'assistant') end++;
    const group = messages.slice(index, end);
    const final = group.at(-1)!;
    if (group.length === 1) result.push(final);
    else {
      const steps: AgentStep[] = group.slice(0,-1).map(message => ({id:message.id,kind:'commentary', title:'Progress update', text:message.text}));
      result.push({...final, steps:[...steps, ...(final.steps || [])], edits:group.flatMap(message => message.edits || [])});
    }
    index = end;
  }
  return result;
}
