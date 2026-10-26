import type {MailFolder} from './feedback';
// Construct once per server snapshot, rather than scanning all folders for each row.
export function indexMailFolders(nodes:MailFolder[]){
 const rows=new Map(nodes.map(node=>[node.path,node]));
 for(const node of nodes)if(node.delimiter){const parts=node.path.split(node.delimiter);for(let i=1;i<parts.length;i++){const path=parts.slice(0,i).join(node.delimiter);if(!rows.has(path))rows.set(path,{path,delimiter:node.delimiter,selectable:false});}}
 const parents=new Map<string,string>(),children=new Set<string>(),siblings=new Map<string,MailFolder[]>();
 for(const node of rows.values()){const parent=node.delimiter&&node.path.includes(node.delimiter)?node.path.slice(0,node.path.lastIndexOf(node.delimiter)):'';if(parent){parents.set(node.path,parent);children.add(parent);}const group=siblings.get(parent)||[];group.push(node);siblings.set(parent,group);}
 for(const group of siblings.values())group.sort((a,b)=>a.path.localeCompare(b.path));
 const ordered:MailFolder[]=[];const visit=(parent:string)=>{for(const node of siblings.get(parent)||[]){ordered.push(node);visit(node.path);}};visit('');
 return {rows,parents,children,ordered};
}
