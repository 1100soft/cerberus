import { api, type AutomationLog } from './api';
const entries=new Map<string,AutomationLog>();
const listeners=new Set<(id:string)=>void>();
const writes=new Map<string,Promise<void>>();
const timers=new Map<string,number>();
const key=(entry:AutomationLog)=>`${entry.automationId}:${entry.repositoryId}:${entry.runId}`;
function publish(entry:AutomationLog){entries.set(key(entry),entry);if(entries.size>200){const oldest=[...entries.values()].filter(item=>item.status!=='running'&&key(item)!==key(entry)).sort((a,b)=>a.createdAt-b.createdAt)[0];if(oldest)entries.delete(key(oldest));}for(const listener of listeners)listener(entry.automationId);}
function persist(entry:AutomationLog){
  // The Rust limit is bytes; JS string length counts UTF-16 code units.
  entry={...entry,stdout:entry.stdout.slice(-450000),stderr:entry.stderr.slice(-450000),response:entry.response.slice(-450000),activity:entry.activity.slice(-450000)};
  const id=key(entry),previous=writes.get(id)||Promise.resolve();
  const pending=previous.catch(()=>{}).then(()=>api.writeAutomationLog(entry));
  writes.set(id,pending);
  void pending.finally(()=>{if(writes.get(id)===pending)writes.delete(id);}).catch(()=>{});
  return pending;
}
export function currentAutomationLogs(id?:string){return [...entries.values()].filter(entry=>!id||entry.automationId===id);}
function withEvents(entry:AutomationLog,previous?:AutomationLog):AutomationLog {
  const events=[...(previous?.events||entry.events||[])];
  for(const stream of ['stdout','stderr','response','activity'] as const){
    const before=previous?.[stream]||'',after=entry[stream];
    if(after&&after!==before)events.push({at:Date.now(),stream,text:(after.startsWith(before)?after.slice(before.length):after).slice(-400000)});
  }
  if(!previous||entry.status!==previous.status)events.push({at:Date.now(),stream:'status',text:entry.status});
  let size=events.reduce((sum,event)=>sum+event.text.length,0);
  while(events.length>2000||size>400000){size-=events.shift()!.text.length;}
  return {...entry,events};
}
export function subscribeAutomationLogs(listener:(id:string)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export async function beginAutomationLog(entry:AutomationLog){entry=withEvents(entry);publish(entry);try{await persist(entry);}catch(error){publish({...entry,status:'error',stderr:`Log could not be saved: ${String(error)}`});throw error;}}
export function updateAutomationLog(entry:AutomationLog,patch:Partial<AutomationLog>){
  const id=key(entry),previous=entries.get(id)||entry,next=withEvents({...previous,...patch},previous);
  publish(next);
  if(!timers.has(id))timers.set(id,window.setTimeout(()=>{timers.delete(id);void persist(entries.get(id)!).catch(error=>console.warn('Could not checkpoint automation log:',error));},500));
}
export async function finishAutomationLog(entry:AutomationLog){
  const id=key(entry);window.clearTimeout(timers.get(id));timers.delete(id);entry=withEvents({...entries.get(id),...entry},entries.get(id));publish(entry);await persist(entry);
}

export function notifyAutomationLogViews(automationId:string){for(const listener of listeners)listener(automationId);}
export async function deleteSavedAutomationLog(entry:AutomationLog,notify=true){
  const id=key(entry);window.clearTimeout(timers.get(id));timers.delete(id);
  await writes.get(id)?.catch(()=>{});
  await api.deleteAutomationLog(entry.automationId,entry.repositoryId,entry.runId);
  entries.delete(id);if(notify)notifyAutomationLogViews(entry.automationId);
}
export async function saveDismissedAutomationLog(entry:AutomationLog){await persist(entry);publish(entry);}
