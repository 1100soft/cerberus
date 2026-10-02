import { useSyncExternalStore } from 'react';

const key='gitcerberus.identityInitials';
let overrides:Record<string,string>={};
try {overrides=JSON.parse(localStorage.getItem(key)||'{}') || {};} catch {/* Storage may be unavailable. */}
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);};
export function automaticInitials(label:string){
 const parts=(label.includes('@')?label.split('@')[0]:label).match(/[\p{L}\p{N}]+/gu)||[];
 return (parts.length>1 ? `${parts[0]![0]}${parts.at(-1)![0]}` : (parts[0]||'?').slice(0,2)).toLocaleUpperCase();
}
export function useIdentityInitials(id:string,label:string){
 const saved=useSyncExternalStore(subscribe,()=>overrides[id]||'',()=>overrides[id]||'');
 return saved||automaticInitials(label);
}
export function setIdentityInitials(id:string,value:string){
 const next=value.trim().slice(0,3).toLocaleUpperCase();
 overrides={...overrides};if(next)overrides[id]=next;else delete overrides[id];
 try{localStorage.setItem(key,JSON.stringify(overrides));}catch{/* Keep this window's setting. */}
 listeners.forEach(listener=>listener());
}
