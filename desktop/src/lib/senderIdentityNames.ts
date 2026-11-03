import type {MailboxConfig} from './feedback';
export function mergeSenderIdentityNames(values:(string|undefined)[]){
 const names=new Map<string,string>();for(const value of values){const name=value?.trim();if(name&&!names.has(name.toLowerCase()))names.set(name.toLowerCase(),name);}return [...names.values()].sort((a,b)=>a.localeCompare(b));
}
export function senderIdentityNames(configs:MailboxConfig[]){return mergeSenderIdentityNames(configs.flatMap(config=>[config.senderIdentityName,...(config.senderIdentities||[]).map(i=>i.identityName)]));}
export function identityNameProblem(config:MailboxConfig){
 const seen=new Set<string>();
 for(const value of [config.senderIdentityName,...(config.senderIdentities||[]).map(i=>i.identityName)]){const name=value?.trim()||'';
  if(name.length>64||/[@\x00-\x1f\x7f]/.test(value||''))return 'Use identity names of up to 64 characters, without @ or control characters.';
  if(!name)continue;const key=name.toLowerCase();if(seen.has(key))return 'Sender identity names must be unique within this project.';seen.add(key);
 }return '';
}
