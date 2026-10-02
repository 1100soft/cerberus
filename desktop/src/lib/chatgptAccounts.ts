import { useEffect, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { inTauri } from './api';
import { remoteKey } from './repositories';
import type { Repository } from '../types';
import type { AgentProfile } from './agentChats';
export type AccountSettings={defaultAccount:string|null;initialized:boolean;repositories:Record<string,string|null>};
let state:{profiles:AgentProfile[];settings:AccountSettings;error:string}={profiles:[],settings:{defaultAccount:null,initialized:false,repositories:{}},error:''};
export function currentChatgptAccounts(){return state;}
const listeners=new Set<()=>void>();let pending:Promise<void>|undefined;
export function refreshChatgptAccounts(){if(!inTauri())return Promise.resolve();if(pending)return pending;pending=Promise.all([invoke<AgentProfile[]>('agent_profiles'),invoke<AccountSettings>('chatgpt_settings')]).then(([profiles,settings])=>{state={profiles,settings,error:''};}).catch(error=>{state={...state,error:String(error)};}).finally(()=>{pending=undefined;listeners.forEach(listener=>listener());});return pending;}
export function useChatgptAccounts(){useEffect(()=>{void refreshChatgptAccounts();const update=()=>void refreshChatgptAccounts();window.addEventListener('agent-configuration-changed',update);return()=>window.removeEventListener('agent-configuration-changed',update);},[]);return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>state);}
export const repositoryAccountKey=(repo:Pick<Repository,'id'|'canonicalRemote'>)=>remoteKey(repo.canonicalRemote)||repo.id;
export function assignedChatgpt(settings:AccountSettings,key:string){return Object.hasOwn(settings.repositories,key)?settings.repositories[key]:settings.defaultAccount;}
export async function assignChatgpt(repository:string|null,account:string|null,inherit=false){await invoke('assign_chatgpt_account',{repository,account,inherit});await refreshChatgptAccounts();window.dispatchEvent(new Event('agent-configuration-changed'));}
