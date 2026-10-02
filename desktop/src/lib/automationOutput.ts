export type OutputChunk={repositoryId:string;stream:'stdout'|'stderr';text:string};
const active=new Map<string,OutputChunk[]>();
const listeners=new Set<(automationId:string)=>void>();
const limit=400_000;
export function beginAutomationOutput(automationId:string){active.set(automationId,[]);for(const listener of listeners)listener(automationId);}
export function appendAutomationOutput(automationId:string,chunk:OutputChunk){
  const current=active.get(automationId)||[];
  current.push(chunk);
  let length=current.reduce((sum,item)=>sum+item.text.length,0);
  while(length>limit&&current.length>1){length-=current.shift()!.text.length;}
  active.set(automationId,current);
  for(const listener of listeners)listener(automationId);
}
export function endAutomationOutput(automationId:string){active.delete(automationId);for(const listener of listeners)listener(automationId);}
export function automationOutput(automationId:string){return active.get(automationId)||[];}
export function subscribeAutomationOutput(listener:(automationId:string)=>void){listeners.add(listener);return()=>listeners.delete(listener);}
