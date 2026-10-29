import type {MailFolder,FolderOperation,MailboxConfig} from './feedback';
export const partsFor=(path:string,nodes:MailFolder[])=>{const delimiter=nodes.find(n=>n.path===path)?.delimiter;return path?(delimiter?path.split(delimiter):[path]):[];};
export function projectFolderPath(parts:string[],nodes:MailFolder[]){
 let parent='';for(const part of parts){const delimiter=parent?nodes.find(n=>n.path===parent)?.delimiter:nodes.find(n=>n.delimiter)?.delimiter;if(!part||parent&&!delimiter||delimiter&&part.includes(delimiter))throw Error('This project cannot represent the folder path.');parent=parent?parent+delimiter+part:part;}return parent;
}
export function planProjectFolderCreate(parts:string[],tree:MailFolder[]){
 const nodes=new Map(tree.map(n=>[n.path,n])),operations:FolderOperation[]=[];let parent='';
 for(const name of parts){const delimiter=parent?nodes.get(parent)?.delimiter:tree.find(n=>n.delimiter)?.delimiter;
  if(!name||/[\/\\\r\n\0]/.test(name)||delimiter&&name.includes(delimiter))throw Error('Enter a folder name, not a path.');
  if(parent&&!delimiter)throw Error('This server does not support child folders.');
  const path=parent?parent+delimiter+name:name;
  if(!nodes.has(path)){operations.push({operation:'create',parent,name});nodes.set(path,{path,delimiter:delimiter||null,selectable:true});}parent=path;
 }return operations;
}

export const sameMailAccount=(a:MailboxConfig,b:MailboxConfig)=>JSON.stringify([a.username,a.imapHost,a.imapPort,a.imapSecurity])===JSON.stringify([b.username,b.imapHost,b.imapPort,b.imapSecurity]);
