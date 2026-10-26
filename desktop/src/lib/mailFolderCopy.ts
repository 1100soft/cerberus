import {type MailboxConfig,type MailFolder} from './feedback';
export const folderRoles=['inbox','drafts','sent','notes','metadata'] as const;
export function folderParts(path:string,nodes:MailFolder[]):string[]{const node=nodes.find(node=>node.path===path);return node?.delimiter?path.split(node.delimiter):[path];}
// Server operations remain explicit and sequential; partial completion is safe to retry.
export async function copyMailFolders(source:MailboxConfig,sourceNodes:MailFolder[],targetNodes:MailFolder[],create:(parent:string,name:string)=>Promise<MailFolder[]>):Promise<{nodes:MailFolder[];assignments:Pick<MailboxConfig,typeof folderRoles[number]>}>{
 let nodes=targetNodes;
 const paths=sourceNodes.map(node=>folderParts(node.path,sourceNodes));
 for(const role of folderRoles)if(!sourceNodes.some(node=>node.path===source[role]&&node.selectable))throw Error('The source project has incomplete folder assignments.');
 const resolve=async(parts:string[])=>{let parent='';for(const name of parts){const delimiter=parent?nodes.find(node=>node.path===parent)?.delimiter:nodes.find(node=>node.delimiter)?.delimiter;
  if(parent&&!delimiter)throw Error(`“${parent}” does not support child folders.`);
  if(!name||/[\/\\\r\n\0]/.test(name)||(delimiter&&name.includes(delimiter)))throw Error(`The destination server cannot use the folder name “${name}”.`);
  let path=parent?parent+delimiter+name:name;
  if(!parent&&name.toUpperCase()==='INBOX')path=nodes.find(node=>node.path.toUpperCase()==='INBOX')?.path||path;
  if(!nodes.some(node=>node.path===path))nodes=await create(parent,name);
  if(!nodes.some(node=>node.path===path))throw Error(`The server did not return “${path}”.`);
  parent=path;
 }return parent;};
 for(const parts of paths.sort((a,b)=>a.length-b.length))await resolve(parts);
 const assignments={} as Pick<MailboxConfig,typeof folderRoles[number]>;
 for(const role of folderRoles){const path=await resolve(folderParts(source[role],sourceNodes));if(!nodes.some(node=>node.path===path&&node.selectable))throw Error(`“${path}” cannot be assigned on this server.`);assignments[role]=path;}
 return {nodes,assignments};
}
