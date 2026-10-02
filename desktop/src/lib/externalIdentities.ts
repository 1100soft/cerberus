import { invoke } from '@tauri-apps/api/core';
import { useEffect, useSyncExternalStore } from 'react';
import { inTauri } from './api';
export const externalProviders=[{id:'cursor',label:'Cursor'},{id:'claude',label:'Claude'}] as const;
export type ExternalIdentity = {id:string;provider:'cursor'|'claude';label:string;connected:boolean;detail:string};
export type Settings = {defaultAccounts:Record<string,string|null>;repositories:Record<string,Record<string,string|null>>};
let state:{identities:ExternalIdentity[];settings:Settings;error:string}={identities:[],settings:{defaultAccounts:{},repositories:{}},error:''};
export function currentExternalIdentities(){return state;}
let pending:Promise<void>|undefined;
let lastUpdated=0;
const listeners=new Set<()=>void>();
export function refreshExternalIdentities(force=false){if(!inTauri())return Promise.resolve();if(pending)return pending;if(!force && Date.now()-lastUpdated<10000)return Promise.resolve();pending=invoke<{identities:ExternalIdentity[];settings:Settings}>('external_identity_snapshot').then(snapshot=>{state={...snapshot,error:''};lastUpdated=Date.now();}).catch(error=>{state={...state,error:String(error)};}).finally(()=>{pending=undefined;listeners.forEach(listener=>listener());});return pending;}
export function useExternalIdentities(){useEffect(()=>{void refreshExternalIdentities();const update=()=>void refreshExternalIdentities();window.addEventListener('agent-configuration-changed',update);return()=>window.removeEventListener('agent-configuration-changed',update);},[]);return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>state);}
export async function assignExternalIdentity(provider:string,repository:string,account:string|null,inherit=false){await invoke('assign_external_identity',{provider,repository,account,inherit});await refreshExternalIdentities(true);window.dispatchEvent(new Event('agent-configuration-changed'));}

export function assignedExternalIdentity(settings:Settings,provider:string,repository:string){return Object.hasOwn(settings.repositories[provider]||{},repository)?settings.repositories[provider][repository]:settings.defaultAccounts[provider]||null;}
export async function defaultExternalIdentity(provider:string,account:string|null){await invoke('default_external_identity',{provider,account});await refreshExternalIdentities(true);window.dispatchEvent(new Event('agent-configuration-changed'));}
