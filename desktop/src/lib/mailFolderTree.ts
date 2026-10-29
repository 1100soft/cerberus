import type {MailFolder} from './feedback';
// Functional order for standard folders, shared first-seen order for custom names.
// Persist names only, never messages or credentials; lexical sorting is deliberately avoided.
const standardGroups=[['inbox'],['drafts'],['sent','sent items','sent messages'],['archive','archives','all mail'],['starred','important'],['folders'],['labels'],['junk','spam'],['trash','bin','deleted items','deleted messages']];
let customOrder:string[]=[];
try{customOrder=JSON.parse(localStorage.getItem('gitcerberus.mailFolderOrder.v1')||'[]').filter((name:unknown)=>typeof name==='string');}catch{/* Browser storage may be unavailable. */}
const customRanks=new Map(customOrder.map((name,index)=>[name,index]));
let orderChanged=false;
function rank(name:string){const lower=name.toLowerCase(),key=name,standard=standardGroups.findIndex(group=>group.includes(lower));if(standard>=0)return (standard>=7?100_000:0)+standard*10+standardGroups[standard].indexOf(lower);let index=customRanks.get(key);if(index===undefined){index=customOrder.length;customOrder.push(key);customRanks.set(key,index);orderChanged=true;}return 1_000+index;}
// Construct once per server snapshot, rather than scanning all folders for each row.
export function indexMailFolders(nodes:MailFolder[]){
 const source=new Map(nodes.map(node=>[node.path,node]));
 const rows=new Map<string,MailFolder>();
 // Insert implied parents at their first child's position before applying
 // functional and remembered sibling order.
 for(const node of nodes){if(node.delimiter){const parts=node.path.split(node.delimiter);for(let i=1;i<parts.length;i++){const path=parts.slice(0,i).join(node.delimiter);if(!rows.has(path))rows.set(path,source.get(path)||{path,delimiter:node.delimiter,selectable:false});}}if(!rows.has(node.path))rows.set(node.path,node);}
 const parents=new Map<string,string>(),children=new Set<string>(),siblings=new Map<string,MailFolder[]>();
 for(const node of rows.values()){const parent=node.delimiter&&node.path.includes(node.delimiter)?node.path.slice(0,node.path.lastIndexOf(node.delimiter)):'';if(parent){parents.set(node.path,parent);children.add(parent);}const group=siblings.get(parent)||[];group.push(node);siblings.set(parent,group);}
 for(const group of siblings.values()){const ranks=new Map(group.map(node=>[node.path,rank(node.label||node.path.split(node.delimiter||'\0').at(-1)||node.path)]));group.sort((a,b)=>ranks.get(a.path)!-ranks.get(b.path)!);}
 if(orderChanged){orderChanged=false;try{localStorage.setItem('gitcerberus.mailFolderOrder.v1',JSON.stringify(customOrder));}catch{/* In-memory ordering still works. */}}
 const ordered:MailFolder[]=[];const visit=(parent:string)=>{for(const node of siblings.get(parent)||[]){ordered.push(node);visit(node.path);}};visit('');
 return {rows,parents,children,ordered};
}
