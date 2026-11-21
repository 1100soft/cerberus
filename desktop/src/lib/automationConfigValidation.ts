import type {WorkflowDocument} from './automationConfig';
import type {SavedPrompt} from './savedPrompts';
import type {AgentProfile} from './agentChats';
export function validateWorkflowProposal(text:string,current:WorkflowDocument,jobs:SavedPrompt[],repositoryIds:string[],profiles:AgentProfile[]):Promise<SavedPrompt[]>{
 return new Promise((resolve,reject)=>{
 const worker=new Worker(new URL('./automationConfig.worker.ts',import.meta.url),{type:'module'});
 const timer=window.setTimeout(()=>{worker.terminate();reject(Error('Workflow validation timed out. Reduce proposal size.'));},15000);
 const finish=()=>{window.clearTimeout(timer);worker.terminate();};
 worker.onmessage=event=>{finish();if(event.data.error)reject(Error(event.data.error));else resolve(event.data.jobs);};
 worker.onerror=event=>{finish();reject(Error(event.message||'Workflow validation failed.'));};
 worker.postMessage({text,current,jobs,repositoryIds,profiles});
 });
}
