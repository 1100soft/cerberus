import {useEffect,useState,useSyncExternalStore} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {inTauri} from './api';
export type ModelOption={model:string;displayName:string;isDefault:boolean;defaultReasoningEffort:string;supportedReasoningEfforts:{reasoningEffort:string;description:string}[]};
type Credits={balance?:string;unlimited?:boolean};
type RateLimits={limitId?:string;limitName?:string;primary?:Window;secondary?:Window;credits?:Credits};
export type Capabilities={models:ModelOption[];runtime?:{executable:string;version?:string};modelsError?:string;usage?:{rateLimits?:RateLimits;rateLimitsByLimitId?:Record<string,RateLimits>|null};usageError?:string};
type Window={usedPercent:number;windowDurationMins?:number;resetsAt?:number};
const cache=new Map<string,{time:number;value:Capabilities}>();
const requests=new Map<string,Promise<Capabilities>>();
function fetchCapabilities(id:string){let request=requests.get(id);if(!request){request=invoke<Capabilities>('chatgpt_capabilities',{profileId:id}).then(value=>{cache.set(id,{time:Date.now(),value});return value;}).catch(error=>{cache.delete(id);throw error;}).finally(()=>requests.delete(id));requests.set(id,request);}return request;}
export function commonCapabilities(values:Capabilities[]):Capabilities {
 const first=values[0];
 const errors=values.map(value=>value.modelsError).filter(Boolean);
 return {...first,models:errors.length?[]:(first?.models||[]).filter(model=>values.every(value=>value.models.some(item=>item.model===model.model))),modelsError:errors.length?errors.join(' · '):undefined};
}
export function useChatgptCapabilities(account?:string|string[]){
 const ids=[...new Set(typeof account==='string'?[account]:account||[])].sort();
 const id=ids.join(':');
 const [state,setState]=useState<{id?:string;data?:Capabilities;error?:string}>({});
 useEffect(()=>{let live=true;const refresh=(force=false)=>{
  if(!ids.length || !inTauri())return;
  const saved=ids.map(id=>cache.get(id));
  if(!force && saved.every(value=>value && Date.now()-value.time<60000)){setState({id,data:commonCapabilities(saved.map(value=>value!.value))});return;}
  void Promise.all(ids.map(fetchCapabilities)).then(values=>{if(live)setState({id,data:commonCapabilities(values)});}).catch(error=>{if(live)setState({id,error:String(error)});});
 };const force=()=>refresh(true);refresh();const interval=setInterval(force,60000);window.addEventListener('chatgpt-usage-refresh',force);window.addEventListener('agent-configuration-changed',force);return()=>{live=false;clearInterval(interval);window.removeEventListener('chatgpt-usage-refresh',force);window.removeEventListener('agent-configuration-changed',force);};},[id]);
 return state.id===id ? state : {};
}
function snapshots(data?:Capabilities){
 const legacy=data?.usage?.rateLimits;
 const buckets=Object.entries(data?.usage?.rateLimitsByLimitId||{});
 return buckets.length ? buckets.map(([id,value])=>({id,...value})) : legacy ? [{id:legacy.limitId||'',...legacy}] : [];
}
export function formatResetTime(seconds:number,now=Date.now()){
 const date=new Date(seconds*1000);
 if(!Number.isFinite(date.getTime()))return 'Unknown';
 const time=`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
 if(date.getTime()>=now && date.getTime()-now<24*60*60*1000)return time;
 return `${new Intl.DateTimeFormat('en-US',{month:'short'}).format(date)} ${date.getDate()}, ${time}`;
}
export function usageWindows(data?:Capabilities){
 const limits=snapshots(data);const multiple=limits.length>1;const seen=new Set<string>();
 return limits.flatMap(limit=>[limit.primary,limit.secondary].filter((window):window is Window=>!!window&&Number.isFinite(window.usedPercent)).map(window=>({window,scope:limit.limitName||limit.id}))).filter(({window})=>{const key=`${window.usedPercent}:${window.windowDurationMins}:${window.resetsAt}`;if(seen.has(key))return false;seen.add(key);return true;}).map(({window,scope})=>({remaining:Math.max(0,Math.min(100,100-window.usedPercent)),label:`${multiple&&scope?`${scope} · `:''}${window.windowDurationMins ? window.windowDurationMins>=1440 ? `${Math.round(window.windowDurationMins/1440)}d` : `${window.windowDurationMins/60}h` : 'Usage'}`,reset:window.resetsAt?formatResetTime(window.resetsAt):'Unknown'}));
}
export function usageCredits(data?:Capabilities){const limits=snapshots(data);return limits.find(limit=>limit.id==='codex')?.credits||limits.find(limit=>limit.credits)?.credits;}
function savedModels():Map<string,string>{
 try {const value=JSON.parse(localStorage.getItem('gitcerberus.selectedModels')||'{}');return new Map(Object.entries(value).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));} catch {return new Map();}
}
const chosenModels=savedModels();
const chosenEfforts=new Map<string,string>();
const modelListeners=new Set<()=>void>();
export function chooseModel(accountId:string,model:string){chosenModels.set(accountId,model);try{localStorage.setItem('gitcerberus.selectedModels',JSON.stringify(Object.fromEntries(chosenModels)));}catch{/* Keep the choice for this window when storage is unavailable. */}modelListeners.forEach(listener=>listener());}
export function chooseEffort(accountId:string,model:string,effort:string){chosenEfforts.set(`${accountId}:${model}`,effort);modelListeners.forEach(listener=>listener());}
export function useSelectedEffort(accountId?:string,model?:ModelOption){
 const chosen=useSyncExternalStore(listener=>{modelListeners.add(listener);return()=>modelListeners.delete(listener);},()=>accountId&&model?chosenEfforts.get(`${accountId}:${model.model}`):undefined);
 return model?.supportedReasoningEfforts.some(option=>option.reasoningEffort===chosen) ? chosen : model?.defaultReasoningEffort;
}
export function useSelectedModel(accountId?:string,fallback?:string){
 const chosen=useSyncExternalStore(listener=>{modelListeners.add(listener);return()=>modelListeners.delete(listener);},()=>accountId?chosenModels.get(accountId):undefined);
 return chosen||fallback;
}
