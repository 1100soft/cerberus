import type {FolderBatch,FolderOperation,MailboxConfig} from './feedback';
import {folderRoles} from './mailFolderCopy';
export type Assignments=Pick<MailboxConfig,typeof folderRoles[number]>;
export const assignments=(config:MailboxConfig):Assignments=>Object.fromEntries(folderRoles.map(role=>[role,config[role]])) as Assignments;
export type FolderEdit={label:string;operations:FolderOperation[];assignments:Assignments};
export class FolderHistory {
 undo:FolderEdit[]=[];redo:FolderEdit[]=[];
 reset(){this.undo=[];this.redo=[];}
 record(label:string,result:FolderBatch,before:Assignments,after:Assignments){
  if(!result.changes.length&&JSON.stringify(before)===JSON.stringify(after))return;
  this.undo.push({label,operations:[...result.changes].reverse().map(change=>change.inverse),assignments:before});this.undo=this.undo.slice(-50);this.redo=[];
 }
 finish(direction:'undo'|'redo',result:FolderBatch,before:Assignments){
  const stack=this[direction],opposite=this[direction==='undo'?'redo':'undo'],entry=stack.at(-1);if(!entry)return;
  if(result.processed===entry.operations.length)stack.pop();else entry.operations=entry.operations.slice(result.processed);
  if(result.changes.length||!result.error)opposite.push({label:entry.label,operations:[...result.changes].reverse().map(change=>change.inverse),assignments:before});
  if(opposite.length>50)opposite.splice(0,opposite.length-50);
 }
}
