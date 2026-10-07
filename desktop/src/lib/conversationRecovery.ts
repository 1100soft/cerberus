import type { AutomationLog } from './api';
import type { AgentChat, AgentProfile } from './agentChats';
/** Recover display history from durable logs without dispatching provider work. */
export function conversationFromLog(log:AutomationLog,profile:AgentProfile,name:string,existing?:AgentChat):AgentChat{
  let session=log.conversation?.session||existing?.session,reply=log.response,idle=false;
  const formattedSession=log.activity.match(/^Session ([A-Za-z0-9_-]+)/m)?.[1];
  if(!session&&formattedSession)session={sessionId:formattedSession,provider:profile.provider,source:'app'};
  for(const line of log.activity.split('\n'))try{
    const event=JSON.parse(line);
    if(event.type==='session.start'&&event.data?.sessionId)session={sessionId:event.data.sessionId,provider:profile.provider,source:'app'};
    if(event.type==='thread.started'&&event.thread_id)session={sessionId:event.thread_id,provider:profile.provider,source:'app'};
    if(event.type==='assistant.message'&&typeof event.data?.content==='string'){reply=event.data.content;idle=false;}
    if(event.type==='assistant.idle')idle=true;
    if(event.type==='model.model_call_started'||event.type==='tool.execution_start')idle=false;
  }catch{/* Formatted output remains readable even when it is not JSON. */}
  const complete=log.status==='completed'||log.status==='running'&&idle&&!!reply;
  const metadata=log.conversation;
  return {...existing,id:metadata?.id||existing?.id||log.retry?.chatId||`recovered-${log.runId}`,repositoryId:log.repositoryId,profile:metadata?.profile||profile,name:existing?.name||metadata?.name||name,
    externalAutomation:metadata?.externalAutomation??profile.provider!=='codex',automationContext:metadata?.automationContext||existing?.automationContext||(log.branch||log.handoffId?{runId:log.runId,commit:log.commitSha}:undefined),session,
    mode:metadata?.mode||existing?.mode||'full',model:metadata?.model||existing?.model,reasoningEffort:metadata?.reasoningEffort||existing?.reasoningEffort,
    activity:log.activity,messages:[{id:`${log.runId}-prompt`,role:'user',text:metadata?.prompt||existing?.messages.find(message=>message.role==='user')?.text||log.command},{id:`${log.runId}-reply`,role:'assistant',text:reply}],
    status:complete?'Completed':log.status==='error'?log.stderr||'Failed':'Interrupted. Open the original run to resume or retry.',running:false,automationRetry:!!log.retry,updatedAt:log.createdAt};
}
