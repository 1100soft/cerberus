import {feedback,type MailboxConfig,type MailFolder} from './feedback';
export type FeedbackFolderRule={feedbackPath?:string[];feedbackFolder?:string};
export type MailboxTree={id:string;label:string;config:MailboxConfig;nodes:MailFolder[];error?:string};
export const folderKey=(parts:string[])=>['root',...parts.map(encodeURIComponent)].join('/');
export const folderParts=(key:string)=>key?key.split('/').slice(1).map(decodeURIComponent):[];
export function mailboxRoot(config:MailboxConfig,nodes:MailFolder[]){
 const root=nodes.find(node=>node.selectable&&node.path===config.inbox)||
  (config.provider==='proton'?nodes.find(node=>node.selectable&&node.path===`Folders/${config.inbox}`):undefined);
 if(!root)throw Error(`Configured email root “${config.inbox}” was not found.`);
 return root;
}
export const mailboxScopeKey=(config:MailboxConfig)=>JSON.stringify([config.inbox,config.username,config.imapHost,config.imapPort,config.imapSecurity,config.certificatePath]);
export function relativeFolder(config:MailboxConfig,nodes:MailFolder[],parts:string[]):string|null{
 const root=mailboxRoot(config,nodes);
 if(!parts.length)return root.path;
 if(!root.delimiter)return null;
 if(parts.some(part=>!part||part.includes(root.delimiter!)))return null;
 const path=root.path+root.delimiter+parts.join(root.delimiter);
 return nodes.some(node=>node.path===path&&node.selectable)&&![config.drafts,config.sent,config.notes,config.metadata].includes(path)?path:null;
}
export function resolveFeedbackFolder(config:MailboxConfig,nodes:MailFolder[],rule:FeedbackFolderRule):string|null{
 if(rule.feedbackPath!==undefined)return relativeFolder(config,nodes,rule.feedbackPath);
 return rule.feedbackFolder||config.inbox; // Preserve previously saved absolute rules.
}
export function mergedFolderTree(mailboxes:MailboxTree[]):MailFolder[]{
 const entries=new Map<string,{parts:string[];present:Set<string>;selectable:Set<string>}>();
 const add=(parts:string[],id:string,selectable:boolean)=>{
  const key=folderKey(parts),entry=entries.get(key)||{parts,present:new Set<string>(),selectable:new Set<string>()};entry.present.add(id);if(selectable)entry.selectable.add(id);entries.set(key,entry);
 };
 for(const mailbox of mailboxes){
  if(mailbox.error)continue;
  const root=mailboxRoot(mailbox.config,mailbox.nodes);add([],mailbox.id,true);
  if(!root.delimiter)continue;
  for(const node of mailbox.nodes){
   if(!node.path.startsWith(root.path+root.delimiter))continue;
   const parts=node.path.slice(root.path.length+root.delimiter.length).split(root.delimiter);
   const reserved=[mailbox.config.drafts,mailbox.config.sent,mailbox.config.notes,mailbox.config.metadata].includes(node.path);
   for(let length=1;length<=parts.length;length++)add(parts.slice(0,length),mailbox.id,length===parts.length&&node.selectable&&!reserved);
  }
 }
 if(!entries.size)entries.set(folderKey([]),{parts:[],present:new Set(),selectable:new Set()});
 return [...entries.entries()].map(([path,entry])=>{
  const present=mailboxes.filter(mailbox=>entry.present.has(mailbox.id)),selectable=mailboxes.filter(mailbox=>entry.selectable.has(mailbox.id));
  const missing=mailboxes.filter(mailbox=>!mailbox.error&&!entry.selectable.has(mailbox.id));
  const unknown=mailboxes.filter(mailbox=>mailbox.error);
  return {path,delimiter:'/',selectable:entry.selectable.size>0,label:entry.parts.at(-1)||'Email root',coverage:present.length,total:mailboxes.length,
   detail:[`Present: ${present.map(mailbox=>mailbox.label).join(', ')||'none'}`,missing.length?`Missing or unavailable: ${missing.map(mailbox=>mailbox.label).join(', ')}`:'',unknown.length?`Unverified: ${unknown.map(mailbox=>mailbox.label).join(', ')}`:'',present.length&&!selectable.length?'Container only':''].filter(Boolean).join('\n')};
 });
}
export async function ensureRelativeFolder(mailbox:MailboxTree,parts:string[]):Promise<MailFolder[]>{
 let nodes=await feedback.setup(mailbox.id,mailbox.config);
 let parent=mailboxRoot(mailbox.config,nodes).path;
 for(const name of parts){
  const node=nodes.find(node=>node.path===parent);if(!node?.delimiter)throw Error(`“${parent}” does not support child folders.`);
  if(!name||name.includes(node.delimiter)||/[\/\\\r\n\0]/.test(name))throw Error('Enter a folder name, not a path.');
  const child=parent+node.delimiter+name;
  if(!nodes.some(node=>node.path===child))nodes=await feedback.setup(mailbox.id,mailbox.config,undefined,parent,name);
  if(!nodes.some(node=>node.path===child))throw Error(`The server did not return the created folder “${child}”.`);
  parent=child;
 }
 if(!relativeFolder(mailbox.config,nodes,parts))throw Error('This folder cannot receive email automation events.');
 return nodes;
}
