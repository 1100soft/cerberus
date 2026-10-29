import {type MailboxConfig,type MailFolder,type FolderOperation} from './feedback';
export const folderRoles=['drafts','sent','notes','metadata'] as const;
export function folderParts(path:string,nodes:MailFolder[]):string[]{const node=nodes.find(node=>node.path===path);return node?.delimiter?path.split(node.delimiter):[path];}
// Build a deduplicated plan locally; the destination executes it in one IMAP session.
export function planMailFolderCopy(source:MailboxConfig,sourceNodes:MailFolder[],targetNodes:MailFolder[]){
 const nodes=new Map(targetNodes.map(node=>[node.path,node]));const operations:FolderOperation[]=[];
 const sourceIndex=new Map(sourceNodes.map(node=>[node.path,node]));
 for(const role of folderRoles)if(!sourceIndex.get(source[role])?.selectable)throw Error('The source project has incomplete folder assignments.');
 const parts=(path:string)=>{const delimiter=sourceIndex.get(path)?.delimiter;return delimiter?path.split(delimiter):[path];};
 const topDelimiter=targetNodes.find(node=>node.delimiter)?.delimiter||null;
 const resolve=(parts:string[])=>{let parent='';for(const name of parts){const delimiter=parent?nodes.get(parent)?.delimiter:topDelimiter;
  if(parent&&!delimiter)throw Error(`“${parent}” does not support child folders.`);
  if(!name||/[\/\\\r\n\0]/.test(name)||(delimiter&&name.includes(delimiter)))throw Error(`The destination server cannot use the folder name “${name}”.`);
  let path=parent?parent+delimiter+name:name;
  if(!parent&&name.toUpperCase()==='INBOX')path=targetNodes.find(node=>node.path.toUpperCase()==='INBOX')?.path||path;
  if(!nodes.has(path)){operations.push({operation:'create',parent,name});nodes.set(path,{path,delimiter:delimiter||null,selectable:true});}
  parent=path;
 }return parent;};
 for(const path of sourceNodes.map(node=>parts(node.path)).sort((a,b)=>a.length-b.length))resolve(path);
 const assignments={} as Pick<MailboxConfig,typeof folderRoles[number]>;
 for(const role of folderRoles){const path=resolve(parts(source[role]));if(!nodes.get(path)?.selectable)throw Error(`“${path}” cannot be assigned on this server.`);assignments[role]=path;}
 return {operations,assignments};
}
