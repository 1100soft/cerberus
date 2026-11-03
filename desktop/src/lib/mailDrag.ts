import type {MailRef,MailFolder} from './feedback';
export const mailDragType='application/x-cerberus-email';
export const folderDragType='application/x-cerberus-email-folder';
export function folderMoveTarget(nodes:MailFolder[],source:string,parent:string){
 const node=nodes.find(n=>n.path===source);if(!node||source.toUpperCase()==='INBOX')return null;
 const delimiter=node.delimiter;
 if(parent===source||delimiter&&parent.startsWith(source+delimiter))return null;
 const leaf=delimiter?source.split(delimiter).at(-1)!:source;
 const target=parent?nodes.find(n=>n.path===parent):undefined;
 if(parent&&!target?.delimiter)return null;
 if(target?.delimiter&&leaf.includes(target.delimiter))return null;
 const path=parent?parent+target!.delimiter+leaf:leaf;
 return path===source||nodes.some(n=>n.path===path)?null:path;
}
export function readMailDrop(data:DataTransfer,projectId:string):{message?:MailRef;folder?:string}|null{
 try{
  if(data.types.includes(folderDragType)){const value=JSON.parse(data.getData(folderDragType));return value.projectId===projectId&&typeof value.path==='string'?{folder:value.path}:null;}
  if(data.types.includes(mailDragType)){const value=JSON.parse(data.getData(mailDragType)),m=value.message;return value.projectId===projectId&&m&&typeof m.folder==='string'&&Number.isSafeInteger(m.uid)&&m.uid>0&&Number.isSafeInteger(m.validity)&&m.validity>0&&typeof m.messageId==='string'?{message:m}:null;}
 }catch{/* Ignore external and malformed drag payloads. */}return null;
}
