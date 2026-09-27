import { ProviderIdentityBadge } from './ProviderIdentityBadge';
import { api } from '../lib/api';
import { invoke } from '@tauri-apps/api/core';
import { useEffect,useRef,useState } from 'react';
import { IdentityCard } from './IdentityCard';
import { externalProviders,refreshExternalIdentities,useExternalIdentities } from '../lib/externalIdentities';
export function ExternalIdentityCards({startLogin}:{startLogin?:'cursor'|'claude'}){
 const {identities}=useExternalIdentities();const [busy,setBusy]=useState<string>();const [message,setMessage]=useState('');
 const started=useRef(false);
 useEffect(()=>{if(startLogin && !started.current){started.current=true;void login(startLogin);}},[startLogin]);
 useEffect(()=>{const onLogin=(event:Event)=>void login((event as CustomEvent<'cursor'|'claude'>).detail);window.addEventListener('external-identity-login',onLogin);return()=>window.removeEventListener('external-identity-login',onLogin);},[]);
 useEffect(()=>{if(!busy)return;const timer=window.setInterval(()=>void refreshExternalIdentities(true),2000);const deadline=window.setTimeout(()=>{setBusy(undefined);setMessage('Sign-in is still incomplete. Try again when you are ready.');},120000);return()=>{window.clearInterval(timer);window.clearTimeout(deadline);};},[busy]);
 async function login(provider:string){setBusy(provider);setMessage(`Finish signing in with ${provider} in your browser.`);try{await invoke('login_external_identity',{provider});await refreshExternalIdentities(true);}catch(error){setMessage(String(error));setBusy(undefined);}}
 async function logout(provider:string){setBusy(provider);try{await invoke('logout_external_identity',{provider});await refreshExternalIdentities(true);setMessage('');}catch(error){setMessage(String(error));}finally{setBusy(undefined);}}
 useEffect(()=>{if(busy && identities.some(item=>item.provider===busy)){setBusy(undefined);setMessage('Account connected.');}},[busy,identities]);
 return <>{externalProviders.map(provider=>{const account=identities.find(item=>item.provider===provider.id);return account?<IdentityCard key={provider.id} icon={<ProviderIdentityBadge provider={provider.id} id={account.id} label={account.label}/>} label={account.label} detail={`${provider.label} · CLI account`} initialsId={account.id} onConnect={()=>void login(provider.id)} onDisconnect={()=>void logout(provider.id)} busy={busy===provider.id}><div className="identity-usage"><UsagePageButton provider={provider.id} account={account.label}/></div></IdentityCard>:null;})}{message&&<p role="status">{message}</p>}</>;
}
export function externalLogin(provider:'cursor'|'claude'){window.dispatchEvent(new CustomEvent('external-identity-login',{detail:provider}));}
function UsagePageButton({provider,account}:{provider:'cursor'|'claude';account:string}){
 const [error,setError]=useState('');
 const url=provider==='cursor'?'https://cursor.com/dashboard/spending':'https://claude.ai/settings/usage';
 return <><button type="button" className="identity-usage-link" title={`Opens your browser. Check that ${account} is the signed-in account.`} onClick={()=>void api.openExternalUrl(url).then(()=>setError('')).catch(reason=>setError(String(reason)))}>Open {provider==='cursor'?'Cursor':'Claude'} usage</button>{error && <small role="alert">{error}</small>}</>;
}
