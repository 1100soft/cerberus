import {invoke} from '@tauri-apps/api/core';
import {inTauri} from './api';
export type MailboxConfig={provider?:string;enabled:boolean;address:string;username:string;imapHost:string;imapPort:number;imapSecurity:string;smtpHost:string;smtpPort:number;smtpSecurity:string;inbox:string;drafts:string;sent:string;notes:string;metadata:string;certificatePath:string;allowSend:boolean};
export type MailFolder={path:string;delimiter:string|null;selectable:boolean;label?:string;coverage?:number;total?:number;detail?:string};
export type FolderOverview=MailFolder&{count?:number|null;unread?:number|null;error?:string|null;trash?:boolean};
export type FolderOperation={operation:'create'|'rename'|'delete';parent:string;name?:string|null};
export type FolderChange={forward:FolderOperation;inverse:FolderOperation};
export type FolderBatch={nodes:MailFolder[];changes:FolderChange[];processed:number;error?:string|null};
export type MailRef={folder:string;validity:number;uid:number;messageId:string};
export type FeedbackMail=MailRef&{subject:string;from:string;replyTo:string;date:string;timestamp:number;body:string;html?:string;inlineImages?:Record<string,string>;read?:boolean;starred?:boolean;attachments:string[]};
export const defaultMailbox=():MailboxConfig=>({provider:'custom',enabled:true,address:'',username:'',imapHost:'',imapPort:993,imapSecurity:'tls',smtpHost:'',smtpPort:465,smtpSecurity:'tls',inbox:'INBOX',drafts:'Drafts',sent:'Sent',notes:'Cerberus Notes',metadata:'Cerberus Receipts',certificatePath:'',allowSend:false});
// Preview data stays in memory. Real mail never goes into localStorage or a DB.
const preview=new Map<string,MailboxConfig>();
export const feedback={
 setup:(repositoryId:string,config:MailboxConfig,password?:string,parent?:string,name?:string):Promise<MailFolder[]>=>inTauri()?invoke('feedback_setup',{repositoryId,config,password:password||null,parent:parent??null,name:name??null}):Promise.resolve(['INBOX','Drafts','Sent','Cerberus Notes','Cerberus Receipts'].map(path=>({path,delimiter:'/',selectable:true}))),
 manage:(repositoryId:string,config:MailboxConfig,password:string,parent:string,operation:'rename'|'delete',name?:string):Promise<MailFolder[]>=>invoke('feedback_setup',{repositoryId,config,password:password||null,parent,name:name??null,operation}),
 batch:(repositoryId:string,config:MailboxConfig,password:string,operations:FolderOperation[]):Promise<FolderBatch>=>invoke('feedback_folder_batch',{repositoryId,config,password:password||null,operations}),
 config:(repositoryId:string):Promise<MailboxConfig|null>=>inTauri()?invoke('feedback_config',{repositoryId}):Promise.resolve(preview.get(repositoryId)||null),
 save:async(repositoryId:string,config:MailboxConfig,password?:string):Promise<void>=>{if(inTauri())await invoke('save_feedback_config',{repositoryId,config,password:password||null});else preview.set(repositoryId,config);window.dispatchEvent(new CustomEvent('feedback-config-changed',{detail:repositoryId}));},
 request:<T,>(repositoryId:string,request:Record<string,unknown>):Promise<T>=>inTauri()?invoke('feedback_request',{repositoryId,request}):Promise.resolve((request.action==='folderTree'?['INBOX','Email/Ready','Email/Resolved','Drafts','Sent'].map(path=>({path,delimiter:'/',selectable:true,count:0,unread:0})):request.action==='folders'?['INBOX','Email/Ready','Email/Resolved','Drafts','Sent']:request.action==='list'||request.action==='poll'?[]:{}) as T),
};
export const mailKey=(mail:MailRef)=>JSON.stringify([mail.folder,mail.validity,mail.uid,mail.messageId]);

export const mailReference=(mail:MailRef):MailRef=>({folder:mail.folder,validity:mail.validity,uid:mail.uid,messageId:mail.messageId});
