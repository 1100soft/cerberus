import type {MailFolder} from './feedback';
// Construct once per server snapshot, rather than scanning all folders for each row.
export function indexMailFolders(nodes:MailFolder[]){
 const source=new Map(nodes.map(node=>[node.path,node]));
 const rows=new Map<string,MailFolder>();
 // Insert implied parents at their first child's position; keep LIST order
 // among siblings, including when the server returns a parent after its child.
 for(const node of nodes){if(node.delimiter){const parts=node.path.split(node.delimiter);for(let i=1;i<parts.length;i++){const path=parts.slice(0,i).join(node.delimiter);if(!rows.has(path))rows.set(path,source.get(path)||{path,delimiter:node.delimiter,selectable:false});}}if(!rows.has(node.path))rows.set(node.path,node);}
 const parents=new Map<string,string>(),children=new Set<string>(),siblings=new Map<string,MailFolder[]>();
 for(const node of rows.values()){const parent=node.delimiter&&node.path.includes(node.delimiter)?node.path.slice(0,node.path.lastIndexOf(node.delimiter)):'';if(parent){parents.set(node.path,parent);children.add(parent);}const group=siblings.get(parent)||[];group.push(node);siblings.set(parent,group);}
 const ordered:MailFolder[]=[];const visit=(parent:string)=>{for(const node of siblings.get(parent)||[]){ordered.push(node);visit(node.path);}};visit('');
 return {rows,parents,children,ordered};
}
