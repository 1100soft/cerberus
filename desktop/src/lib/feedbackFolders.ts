import {feedback,type MailboxConfig,type MailFolder} from './feedback';
export type FeedbackFolderRule={feedbackPath?:string[];feedbackFolder?:string};
export type MailboxTree={id:string;label:string;config:MailboxConfig;nodes:MailFolder[];error?:string;unverified?:boolean};
// Reserved internal path segment; IMAP folder names cannot contain NUL.
export const mailboxFolderScope='\0mailbox';
export const folderPathLabel=(parts:string[])=>parts.filter(part=>part!==mailboxFolderScope).join(' / ');
export const folderKey=(parts:string[])=>['root',...(parts[0]===mailboxFolderScope?parts.slice(1):parts).map(encodeURIComponent)].join('/');
export const folderParts=(key:string)=>key?[mailboxFolderScope,...key.split('/').slice(1).map(decodeURIComponent)]:[mailboxFolderScope];
export function mailboxRoot(config:MailboxConfig,nodes:MailFolder[]){
 const root=nodes.find(node=>node.selectable&&node.path===config.inbox)||
  (config.provider==='proton'?nodes.find(node=>node.selectable&&node.path===`Folders/${config.inbox}`):undefined);
 if(!root)throw Error(`Configured email root “${config.inbox}” was not found.`);
 return root;
}
export const mailboxScopeKey=(config:MailboxConfig)=>JSON.stringify([config.inbox,config.username,config.imapHost,config.imapPort,config.imapSecurity,config.certificatePath]);
export function relativeFolder(config:MailboxConfig,nodes:MailFolder[],parts:string[]):string|null{
 if(parts[0]===mailboxFolderScope){const delimiter=nodes.find(node=>node.delimiter)?.delimiter;const rest=parts.slice(1);if(!rest.length||rest.some(part=>!part||delimiter&&part.includes(delimiter)))return null;const path=rest.join(delimiter||'');return nodes.some(node=>node.path===path&&node.selectable)&&![config.drafts,config.sent,config.notes,config.metadata].includes(path)?path:null;}
 const root=mailboxRoot(config,nodes); // Compatibility for already-saved root-relative rules only.
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
  add([mailboxFolderScope],mailbox.id,false);
  for(const node of mailbox.nodes){
   const parts=[mailboxFolderScope,...(node.delimiter?node.path.split(node.delimiter):[node.path])];
   const reserved=[mailbox.config.drafts,mailbox.config.sent,mailbox.config.notes,mailbox.config.metadata].includes(node.path);
   for(let length=2;length<=parts.length;length++)add(parts.slice(0,length),mailbox.id,length===parts.length&&node.selectable&&!reserved);
  }
 }
 if(!entries.size)entries.set(folderKey([]),{parts:[],present:new Set(),selectable:new Set()});
 return [...entries.entries()].map(([path,entry])=>{
  const present=mailboxes.filter(mailbox=>!mailbox.unverified&&entry.present.has(mailbox.id)),selectable=mailboxes.filter(mailbox=>!mailbox.unverified&&entry.selectable.has(mailbox.id));
  const missing=mailboxes.filter(mailbox=>!mailbox.error&&!mailbox.unverified&&!entry.selectable.has(mailbox.id));
  const unknown=mailboxes.filter(mailbox=>mailbox.error||mailbox.unverified);
  return {path,delimiter:'/',selectable:entry.selectable.size>0,label:entry.parts.at(-1)===mailboxFolderScope?'Mailbox':entry.parts.at(-1)||'Mailbox',coverage:present.length,total:mailboxes.length,
   detail:[`Present: ${present.map(mailbox=>mailbox.label).join(', ')||'none'}`,missing.length?`Missing or unavailable: ${missing.map(mailbox=>mailbox.label).join(', ')}`:'',unknown.length?`Unverified: ${unknown.map(mailbox=>mailbox.label).join(', ')}`:'',present.length&&!selectable.length?'Container only':''].filter(Boolean).join('\n')};
 });
}
export async function ensureRelativeFolder(mailbox:MailboxTree,parts:string[]):Promise<MailFolder[]>{
 let nodes=await feedback.setup(mailbox.id,mailbox.config);
 const namespace=parts[0]===mailboxFolderScope;
 let parent=namespace?'':mailboxRoot(mailbox.config,nodes).path;
 for(const name of namespace?parts.slice(1):parts){
  const node=parent?nodes.find(node=>node.path===parent):nodes.find(node=>node.delimiter);if(!node?.delimiter)throw Error(`“${parent}” does not support child folders.`);
  if(!name||name.includes(node.delimiter)||/[\/\\\r\n\0]/.test(name))throw Error('Enter a folder name, not a path.');
  const child=parent?parent+node.delimiter+name:name;
  if(!nodes.some(node=>node.path===child))nodes=await feedback.setup(mailbox.id,mailbox.config,undefined,parent,name);
  if(!nodes.some(node=>node.path===child))throw Error(`The server did not return the created folder “${child}”.`);
  parent=child;
 }
 if(!relativeFolder(mailbox.config,nodes,parts))throw Error('This folder cannot receive email automation events.');
 return nodes;
}
