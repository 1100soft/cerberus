import { externalProviders, defaultExternalIdentity, useExternalIdentities } from '../lib/externalIdentities';
import { IdentityCard } from './IdentityCard';
import { ChatgptAccountBadge } from './ChatgptAccountBadge';
import { createPortal } from 'react-dom';
import { OpenAILogo } from './OpenAILogo';
import { useEffect,useRef,useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Select } from './Select';
import { assignChatgpt,refreshChatgptAccounts,useChatgptAccounts } from '../lib/chatgptAccounts';
import type { AgentProfile } from '../lib/agentChats';
import { useChatgptCapabilities, usageCredits, usageWindows } from '../lib/chatgptCapabilities';
export const openChatgptLogin=(id?:string)=>window.dispatchEvent(new CustomEvent('chatgpt-login',{detail:id}));
function ChatgptIdentityCard({account,isDefault,onError}:{account:AgentProfile;isDefault:boolean;onError:(error:string)=>void}){
 const {data,error}=useChatgptCapabilities(account.disconnected?undefined:account.id);
 const windows=usageWindows(data);
 const credits=usageCredits(data);
 return <IdentityCard icon={<ChatgptAccountBadge account={account}/>} label={account.label} detail={`${account.plan || 'ChatGPT'}${isDefault?' · Default ChatGPT account':''}`} initialsId={account.id} connected={!account.disconnected} onConnect={()=>openChatgptLogin(account.id)} onDisconnect={()=>void invoke('disconnect_chatgpt',{id:account.id}).then(refreshChatgptAccounts).then(()=>window.dispatchEvent(new Event('agent-configuration-changed'))).catch(error=>onError(String(error)))}>
  {!account.disconnected && <div className="identity-usage">{windows.map((window,index)=><span key={`${window.label}:${index}`}><b>{window.label}</b> {window.remaining}% remaining{window.reset!=='Unknown' && <small> · Resets {window.reset}</small>}</span>)}{credits && <span>{credits.unlimited?'Credits unlimited':credits.balance?`Credits ${credits.balance}`:''}</span>}{!windows.length && <small>{error||data?.usageError||'Usage unavailable'}</small>}</div>}
 </IdentityCard>;
}
export function ChatgptIdentityCards(){
 const {profiles,settings}=useChatgptAccounts();const [error,setError]=useState('');
 return <>{profiles.filter(account=>account.subscription).map(account=><ChatgptIdentityCard key={account.id} account={account} isDefault={settings.defaultAccount===account.id} onError={setError}/>)}{error && <p role="alert">{error}</p>}</>;
}
export function ChatgptSettings(){
 const {profiles,settings}=useChatgptAccounts();const external=useExternalIdentities();const [error,setError]=useState('');
 return <details className="identity-settings"><summary>Default agent accounts</summary><p>New and unassigned repositories use these accounts automatically.</p><div className="identity-defaults">
 <label>ChatGPT<Select label="Default ChatGPT account" value={settings.defaultAccount||''} options={[{value:'',label:'None'},...profiles.filter(p=>p.subscription && !p.disconnected).map(p=>({value:p.id,label:p.label}))]} onChange={id=>void assignChatgpt(null,id||null).catch(error=>setError(String(error)))}/></label>
 {externalProviders.map(provider=><label key={provider.id}>{provider.label}<Select label={`Default ${provider.label} account`} value={external.settings.defaultAccounts[provider.id]||''} options={[{value:'',label:'None'},...external.identities.filter(item=>item.provider===provider.id).map(item=>({value:item.id,label:item.label}))]} onChange={id=>void defaultExternalIdentity(provider.id,id||null).catch(error=>setError(String(error)))}/></label>)}
 </div>{error && <p role="alert">{error}</p>}</details>;
}
export function ChatgptLoginDialog({onSetup}:{onSetup:()=>void}){
 const [open,setOpen]=useState(false);const [connected,setConnected]=useState(false);const loginId=useRef<string>();const dialog=useRef<HTMLElement>(null);const opener=useRef<HTMLElement|null>(null);
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const pending=useRef<string>();const alive=useRef(true);const attempt=useRef(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;attempt.current++;if(pending.current)void invoke('cancel_chatgpt_login',{id:pending.current});};},[]);
 async function connect(id?:string){loginId.current=id;setConnected(false);const current=++attempt.current;setBusy(true);setMessage('Opening ChatGPT sign-in…');try{
   const accountId=await invoke<string>('begin_chatgpt_login',{id:id||null});
   if(!alive.current || current!==attempt.current){await invoke('cancel_chatgpt_login',{id:accountId});return;}pending.current=accountId;setMessage('Finish signing in in your browser.');
   while(alive.current && current===attempt.current){await new Promise(resolve=>setTimeout(resolve,1500));if(!alive.current || current!==attempt.current)break;const profile=await invoke<AgentProfile|null>('poll_chatgpt_login',{id:accountId});if(profile){setConnected(true);pending.current=undefined;await refreshChatgptAccounts();window.dispatchEvent(new Event('agent-configuration-changed'));if(alive.current)setMessage(`Connected ${profile.label}.`);break;}}
 }catch(error){if(alive.current && current===attempt.current)setMessage(String(error));}finally{if(alive.current && current===attempt.current)setBusy(false);}}
 async function cancel(){attempt.current++;if(pending.current){await invoke('cancel_chatgpt_login',{id:pending.current});pending.current=undefined;}setBusy(false);setMessage('Sign-in cancelled.');}
 useEffect(()=>{const start=(event:Event)=>{opener.current=document.activeElement as HTMLElement;setOpen(true);void connect((event as CustomEvent<string|undefined>).detail);};window.addEventListener('chatgpt-login',start);return()=>window.removeEventListener('chatgpt-login',start);},[]);
 useEffect(()=>{if(!open)return;const shell=document.querySelector('.shell');shell?.setAttribute('inert','');const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();void close();}if(event.key==='Tab'){const controls=[...dialog.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const first=controls[0],last=controls.at(-1);if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}}};document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('keydown',key,true);shell?.removeAttribute('inert');opener.current?.focus();};},[open]);
 async function close(){try{await cancel();setOpen(false);}catch(error){setMessage(String(error));}}
 if(!open)return null;
 return createPortal(<div className="panel-backdrop dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)void close();}}><section ref={dialog} className="repo-config chatgpt-login" role="dialog" aria-modal="true" aria-labelledby="chatgpt-login-title"><header><h2 id="chatgpt-login-title"><OpenAILogo/> ChatGPT sign-in</h2><button autoFocus aria-label="Close ChatGPT sign-in" onClick={()=>void close()}>×</button></header><p role="status">{message}</p>{!busy && !connected && <button onClick={()=>void connect(loginId.current)}>Try again</button>}{!busy && !connected && <button onClick={()=>{void close().then(onSetup);}}>Codex setup</button>}<button onClick={()=>void close()}>{busy?'Cancel':'Done'}</button></section></div>,document.body);
}
