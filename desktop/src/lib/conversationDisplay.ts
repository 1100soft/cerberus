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
      const steps: AgentStep[] = group.slice(0,-1).map(message => ({id:message.id,createdAt:message.createdAt,kind:'commentary', title:'Progress update', text:message.text}));
      result.push({...final, steps:[...steps, ...(final.steps || [])], edits:group.flatMap(message => message.edits || [])});
    }
    index = end;
  }
  return result;
}

/** Undo only legacy tool suffixes on a prompt whose authored text is known. */
export function authoredPromptText(text:string,authored:CodexMessage[]):string {
  for(const message of authored){
    if(message.role!=='user'||!message.text||!text.startsWith(message.text))continue;
    let suffix=text.slice(message.text.length),found=false;
    for(const [start,end] of [
      ['\nEmail tools (only when CERBERUS_EMAIL_TOOL is set):','The mail provider and your agent provider may retain accessed content.\n'],
      ['\nProject feedback tools: when CERBERUS_ISSUE_TOOL is set,','Report the issue URL after a confirmed write.\n'],
    ]){
      if(!suffix.startsWith(start))continue;
      const boundary=suffix.indexOf(end,start.length);if(boundary<0)continue;
      suffix=suffix.slice(boundary+end.length);found=true;
    }
    if(found&&!suffix.trim())return message.text;
  }
  return text;
}
/** During execution, present user-facing checkpoints, not commands or raw traces. */
export function checkpointMessages(messages:CodexMessage[]):CodexMessage[]{
  return messages.map(message=>message.role==='assistant'?{...message,text:message.text||message.steps?.filter(step=>step.kind==='commentary').at(-1)?.text||'',steps:undefined,edits:undefined}:message);
}

/** A refreshed history page must confirm the app's last turn before replacing it. */
export function conversationMessages(local:{running:boolean;messages:CodexMessage[]}|undefined,history:CodexMessage[]):CodexMessage[]{
  if(!local)return history;
  if(local.running||!history.length)return local.messages;
  let lastPrompt=local.messages.length-1;while(lastPrompt>=0&&local.messages[lastPrompt].role!=='user')lastPrompt--;
  if(lastPrompt<0)return local.messages;
  const prompt=local.messages[lastPrompt];
  const answer=local.messages.slice(lastPrompt+1).filter(message=>message.role==='assistant').at(-1)?.text.trim();
  for(let index=0;index<history.length;index++){
    if(history[index].role!=='user'||history[index].text!==prompt.text)continue;
    if(prompt.createdAt&&history[index].createdAt&&history[index].createdAt!+2000<prompt.createdAt)continue;
    const next=history.findIndex((message,at)=>at>index&&message.role==='user');
    const turn=history.slice(index+1,next<0?undefined:next);
    if(turn.some(message=>message.role==='assistant'&&message.text.trim()&&(answer?message.text.trim()===answer:true)))return history.length>=local.messages.length||next>=0?history:local.messages;
  }
  const latest=history.filter(message=>message.role==='user').at(-1);
  if(prompt.createdAt&&latest?.createdAt&&latest.createdAt>prompt.createdAt)return history;
  return local.messages;
}
