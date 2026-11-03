import type {FolderOperation,MailFolder} from './feedback';
// A reversible visual preview only. Native validation remains authoritative.
export function previewMailFolders(nodes:MailFolder[],operations:FolderOperation[]){
 let next=[...nodes];const pending=new Set<string>();
 for(const op of operations){const node=next.find(n=>n.path===op.parent),delimiter=node?.delimiter||next.find(n=>n.delimiter)?.delimiter||'/';
  if(op.operation==='create'){const path=op.parent?op.parent+delimiter+op.name:op.name!;if(!next.some(n=>n.path===path)){next.push({path,delimiter,selectable:true});pending.add(path);}}
  else if(op.operation==='delete'){// Keep the row visible but dimmed until safe deletion is confirmed.
   pending.add(op.parent);
  }else{const parent=op.parent.includes(delimiter)?op.parent.slice(0,op.parent.lastIndexOf(delimiter)):'',leaf=op.parent.split(delimiter).at(-1)!,destination=op.operation==='move'?(op.name?op.name+delimiter:'')+leaf:(parent?parent+delimiter:'')+op.name;
   next=next.map(n=>n.path===op.parent||n.path.startsWith(op.parent+delimiter)?{...n,path:destination+n.path.slice(op.parent.length)}:n);pending.add(destination);
  }
 }
 return {nodes:next,pending:[...pending]};
}
