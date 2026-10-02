import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Select } from './Select';
import { externalProviders, assignedExternalIdentity, assignExternalIdentity, useExternalIdentities } from '../lib/externalIdentities';
import { assignChatgpt, assignedChatgpt, repositoryAccountKey, useChatgptAccounts } from '../lib/chatgptAccounts';
import type { Identity, Repository } from '../types';

export function RepositoryAccounts({repository,identities,onAssignIdentity,onClose}:{repository:Repository;identities:Identity[];onAssignIdentity:(id:string)=>Promise<void>;onClose:()=>void}){
 const key=repositoryAccountKey(repository),chatgpt=useChatgptAccounts(),external=useExternalIdentities();const [error,setError]=useState('');
 const closeRef=useRef(onClose);closeRef.current=onClose;
 const opener=useRef<HTMLElement|null>(document.activeElement as HTMLElement|null);
 useEffect(()=>{const shell=document.querySelector('.shell');shell?.setAttribute('inert','');const dismiss=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('[role=listbox]')){event.preventDefault();closeRef.current();}};window.addEventListener('keydown',dismiss);return()=>{window.removeEventListener('keydown',dismiss);shell?.removeAttribute('inert');opener.current?.focus();};},[]);
 async function change(action:()=>Promise<unknown>){setError('');try{await action();}catch(error){setError(String(error));}}
 const chatgptId=assignedChatgpt(chatgpt.settings,key)||'';
 return createPortal(<div className="panel-backdrop dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="repo-config repository-accounts" role="dialog" aria-modal="true" aria-label={`Accounts for ${repository.displayName}`}><header><div><p>Repository accounts</p><h2>{repository.displayName}</h2></div><button type="button" autoFocus aria-label="Close account settings" onClick={onClose}><X/></button></header><div className="repository-accounts-grid">
  <label>GitHub<Select label="GitHub account" value={repository.identity?.id||''} options={[{value:'',label:'No account'},...identities.map(item=>({value:item.id,label:item.providerUsername?`@${item.providerUsername}`:item.label}))]} onChange={id=>void change(()=>onAssignIdentity(id))}/></label>
  <label>ChatGPT<Select label="ChatGPT account" value={chatgptId} options={[{value:'',label:'No account'},...chatgpt.profiles.filter(item=>item.subscription&&!item.disconnected).map(item=>({value:item.id,label:item.label}))]} onChange={id=>void change(()=>assignChatgpt(key,id||null,!!id && id===chatgpt.settings.defaultAccount))}/></label>
  {externalProviders.map(provider=><label key={provider.id}>{provider.label}<Select label={`${provider.label} account`} value={assignedExternalIdentity(external.settings,provider.id,key)||''} options={[{value:'',label:'No account'},...external.identities.filter(item=>item.provider===provider.id).map(item=>({value:item.id,label:item.label}))]} onChange={id=>void change(()=>assignExternalIdentity(provider.id,key,id||null,!!id && id===external.settings.defaultAccounts[provider.id]))}/></label>)}
 </div>{error&&<p role="alert">{error}</p>}</section></div>,document.body);
}
