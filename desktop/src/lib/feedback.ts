import {invoke} from '@tauri-apps/api/core';
import {inTauri} from './api';
export type SenderIdentity={id?:string;mayDelete?:boolean;address:string;name:string};
export const mailboxSenders=(config:MailboxConfig):SenderIdentity[]=>[{address:config.address,name:config.senderName||''},...(config.senderIdentities||[])];
export function senderIdentityProblem(config:MailboxConfig){if(/[\x00-\x1f\x7f]/.test(config.senderName||''))return 'Enter a valid sender display name.';const seen=new Set([config.address.toLowerCase()]),ids=new Set<string>();for(const sender of config.senderIdentities||[]){if(!/^[^\s<>@]+@[^\s<>@]+$/.test(sender.address)||/[\x00-\x1f\x7f]/.test(sender.name))return 'Enter a valid address and display name for each sender identity.';if(sender.id){if(ids.has(sender.id))return 'Sender identities must have unique IDs.';ids.add(sender.id);}const key=sender.address.toLowerCase();if(seen.has(key)&&(!sender.id||sender.id.startsWith('local:')))return 'Sender identity addresses must be unique.';seen.add(key);}return '';}
export type MailboxConfig={webmailUrl?:string;autoSpecialFolders?:boolean;senderSync?:{enabled:boolean;accountId:string;state:string;baseline:{id:string;email:string;name:string;mayDelete:boolean}[]}|null;senderName?:string;senderIdentities?:SenderIdentity[];provider?:string;enabled:boolean;address:string;username:string;imapHost:string;imapPort:number;imapSecurity:string;smtpHost:string;smtpPort:number;smtpSecurity:string;inbox:string;drafts:string;sent:string;notes:string;metadata:string;certificatePath:string;allowSend:boolean};
export type MailFolder={role?:string|null;path:string;delimiter:string|null;selectable:boolean;label?:string;coverage?:number;total?:number;detail?:string};
export type FolderOverview=MailFolder&{count?:number|null;unread?:number|null;error?:string|null;trash?:boolean};
export type FolderOperation={operation:'create'|'rename'|'delete'|'move';parent:string;name?:string|null};
export type FolderChange={forward:FolderOperation;inverse:FolderOperation};
export type FolderBatch={nodes:MailFolder[];changes:FolderChange[];processed:number;error?:string|null};
export type MailRef={folder:string;validity:number;uid:number;messageId:string};
export type FeedbackMail=MailRef&{subject:string;from:string;replyTo:string;date:string;timestamp:number;body:string;html?:string;inlineImages?:Record<string,string>;read?:boolean;starred?:boolean;attachments:string[]};
export const defaultMailbox=():MailboxConfig=>({autoSpecialFolders:true,provider:'custom',enabled:true,address:'',username:'',imapHost:'',imapPort:993,imapSecurity:'tls',smtpHost:'',smtpPort:465,smtpSecurity:'tls',inbox:'INBOX',drafts:'Drafts',sent:'Sent',notes:'Cerberus Notes',metadata:'Cerberus Receipts',certificatePath:'',allowSend:false});
// Preview data stays in memory. Real mail never goes into localStorage or a DB.
const preview=new Map<string,MailboxConfig>();
const folderSnapshots=new Map<string,{nodes:MailFolder[];at:number}>();
let folderEpoch=0;
const folderEpochs=new Map<string,number>();
const folderVersion=(id:string)=>`${folderEpoch}:${folderEpochs.get(id)||0}`;
const folderPending=new Map<string,Promise<MailFolder[]>>();
const folderScope=(id:string,c:MailboxConfig)=>JSON.stringify([id,c.imapHost,c.imapPort,c.imapSecurity,c.username,c.certificatePath]);
export const cachedMailFolders=(id:string,c:MailboxConfig)=>folderSnapshots.get(folderScope(id,c))?.nodes;
export function invalidateMailFolders(id?:string){if(id)folderEpochs.set(id,(folderEpochs.get(id)||0)+1);else folderEpoch++;for(const key of folderPending.keys())if(!id||JSON.parse(key)[0]===id)folderPending.delete(key);for(const key of folderSnapshots.keys())if(!id||JSON.parse(key)[0]===id)folderSnapshots.delete(key);}
window.addEventListener('feedback-config-changed',event=>invalidateMailFolders((event as CustomEvent<string>).detail));
export const feedback={
 syncSenders:(repositoryId:string,config:MailboxConfig|null,token?:string,push=false):Promise<MailboxConfig>=>invoke('sync_email_senders',{repositoryId,config,token:token||null,push}),
 setup:async(repositoryId:string,config:MailboxConfig,password?:string,parent?:string,name?:string,force=false):Promise<MailFolder[]>=>{
  const epoch=folderVersion(repositoryId),key=folderScope(repositoryId,config),readOnly=!password&&parent===undefined&&name===undefined;
  if(readOnly&&!force){const saved=folderSnapshots.get(key);if(saved&&Date.now()-saved.at<120_000)return saved.nodes;}
  if(readOnly&&folderPending.has(key))return folderPending.get(key)!;
  if(!readOnly)invalidateMailFolders(repositoryId);
  const request=(inTauri()?invoke<MailFolder[]>('feedback_setup',{repositoryId,config,password:password||null,parent:parent??null,name:name??null}):Promise.resolve(['INBOX','Drafts','Sent','Cerberus Notes','Cerberus Receipts'].map(path=>({path,delimiter:'/',selectable:true})))).then(nodes=>{if(readOnly&&epoch===folderVersion(repositoryId))folderSnapshots.set(key,{nodes,at:Date.now()});return nodes;}).finally(()=>{if(readOnly&&folderPending.get(key)===request)folderPending.delete(key);});
  if(readOnly)folderPending.set(key,request);return request;
 },
 manage:(repositoryId:string,config:MailboxConfig,password:string,parent:string,operation:'rename'|'delete',name?:string):Promise<MailFolder[]>=>{invalidateMailFolders(repositoryId);return invoke('feedback_setup',{repositoryId,config,password:password||null,parent,name:name??null,operation});},
 batch:(repositoryId:string,config:MailboxConfig,password:string,operations:FolderOperation[]):Promise<FolderBatch>=>{invalidateMailFolders(repositoryId);return invoke('feedback_folder_batch',{repositoryId,config,password:password||null,operations});},
 config:(repositoryId:string):Promise<MailboxConfig|null>=>inTauri()?invoke('feedback_config',{repositoryId}):Promise.resolve(preview.get(repositoryId)||null),
 save:async(repositoryId:string,config:MailboxConfig,password?:string):Promise<void>=>{if(inTauri())await invoke('save_feedback_config',{repositoryId,config,password:password||null});else preview.set(repositoryId,config);window.dispatchEvent(new CustomEvent('feedback-config-changed',{detail:repositoryId}));},
 request:<T,>(repositoryId:string,request:Record<string,unknown>):Promise<T>=>inTauri()?invoke('feedback_request',{repositoryId,request}):Promise.resolve((request.action==='folderTree'?['INBOX','Email/Ready','Email/Resolved','Drafts','Sent'].map(path=>({path,delimiter:'/',selectable:true,count:0,unread:0})):request.action==='folders'?['INBOX','Email/Ready','Email/Resolved','Drafts','Sent']:request.action==='list'||request.action==='poll'?[]:{}) as T),
};
export const mailKey=(mail:MailRef)=>JSON.stringify([mail.folder,mail.validity,mail.uid,mail.messageId]);

export const mailReference=(mail:MailRef):MailRef=>({folder:mail.folder,validity:mail.validity,uid:mail.uid,messageId:mail.messageId});

export function automaticMailFolders(config:MailboxConfig,nodes:MailFolder[]):Partial<MailboxConfig>{
 const result:Partial<MailboxConfig>={};
 for(const role of ['drafts','sent'] as const){
  const flagged=nodes.find(n=>n.selectable&&n.role===role);
  const names=role==='drafts'?['drafts','draft']:['sent','sent items','sent mail','sent messages'];
  const existing=nodes.find(n=>n.selectable&&n.path===config[role]);
  const fallback=nodes.find(n=>n.selectable&&names.includes(n.path.split(n.delimiter||'/').at(-1)!.toLowerCase()));
  result[role]=(flagged||existing||fallback)?.path||config[role];
 }
 return result;
}
