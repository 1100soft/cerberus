import {emailConflict,validEmailRecipient} from './emailPrecedence';
import type {SavedPrompt,Trigger} from './savedPrompts';
import type {AgentProfile} from './agentChats';
import {inputDefinitionsError,type AutomationInput} from './automationInputs';
import {runtimeError,type ScriptRuntime} from './scriptRuntime';
export type WorkflowDocument={schemaVersion:1;revision:string;automations:Record<string,unknown>[]};
export type WorkflowWorkspace={path:string;current:WorkflowDocument;draft:string;guide:string;schema:unknown};
const fields=['emailRecipient','emailPriority','id','title','kind','provider','prompt','enabled','repositoryIds','includeFutureRepositories','runtimeTarget','conditions','conditionSets','minutes','debounceSeconds','changeThreshold','commitBranch','commitAllExcept','handoffName','handoffVariables','emitsHandoffs','model','reasoningEffort','mode','scriptRuntime','manualInputs','requiresMailbox','feedbackPath','feedbackFolder','inboxBatch','handoffOnly','gitAction'] as const;
function canonical(value:unknown):string{return JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);}
const triggers=new Set(['feedback','manual','interval','afterIdle','fileChange','changeCount','commit','ciPass','ciFail','handoff','idleTime','push','pullRequest']);
const exclusive=new Set(['commit','ciPass','ciFail','feedback']);
export function exportAutomationDefinitions(jobs:SavedPrompt[]){return jobs.map(job=>{
 const result:Record<string,unknown>={};for(const field of fields)if(job[field]!==undefined)result[field]=job[field];
 result.kind=job.kind||'prompt';result.conditions=job.conditions||[job.trigger];result.repositoryIds=job.repositoryIds||[job.repositoryId].filter(Boolean);
 if(job.profile?.id)result.accountId=job.profile.id;
 return result;
});}
function object(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
export function parseWorkflowProposal(text:string,current:WorkflowDocument,jobs:SavedPrompt[],repositoryIds:string[],profiles:AgentProfile[]):SavedPrompt[]{
 if(new TextEncoder().encode(text).length>8*1024*1024)throw Error('Workflow proposals must be at most 8 MiB.');
 const doc:unknown=JSON.parse(text);if(!object(doc)||doc.schemaVersion!==1||typeof doc.revision!=='string'||!Array.isArray(doc.automations))throw Error('Expected schemaVersion: 1, revision, and an automations array.');
 if(Object.keys(doc).some(k=>!['schemaVersion','revision','automations','$schema'].includes(k)))throw Error('Unknown document field. Use schema.json.');
 if(doc.revision!==current.revision)throw Error('Configuration changed since this proposal was exported. Merge your edits into the latest current.json revision, then reload.');
 if(canonical(exportAutomationDefinitions(jobs))!==canonical(current.automations))throw Error('Configuration changed in the app. Reload before applying.');
 const ids=new Set<string>();const next=doc.automations.map((row,index)=>{
 const fail=(message:string):never=>{throw Error(`Automation ${index+1}: ${message}`);};
 if(!object(row))return fail('expected an object.');
 for(const key of Object.keys(row))if(![...fields,'accountId'].includes(key as typeof fields[number]))fail(`unknown field ${key}.`);
 if(typeof row.id!=='string'||!row.id.trim()||row.id.length>128||!/^[A-Za-z0-9_-]+$/.test(row.id)||ids.has(row.id))fail('use a unique ID containing letters, digits, hyphens or underscores.');ids.add(row.id as string);
 if(typeof row.title!=='string'||!row.title.trim()||typeof row.prompt!=='string'||!row.prompt.trim())fail('title and prompt are required.');
 if(!['prompt','shell','notification','git'].includes(String(row.kind)))fail('unsupported kind.');
 if(!['codex','cursor','copilot','claude'].includes(String(row.provider)))fail('unsupported provider.');
 if(typeof row.enabled!=='boolean')fail('enabled must be true or false.');
 for(const key of ['includeFutureRepositories','runtimeTarget','commitAllExcept','requiresMailbox','inboxBatch','handoffOnly'])if(row[key]!==undefined&&typeof row[key]!=='boolean')fail(`${key} must be boolean.`);
 for(const key of ['repositoryIds','conditions','handoffVariables','emitsHandoffs','feedbackPath'])if(row[key]!==undefined&&(!Array.isArray(row[key])||!(row[key] as unknown[]).every(x=>typeof x==='string')))fail(`${key} must be an array of strings.`);
 if(!Array.isArray(row.repositoryIds))fail('repositoryIds is required.');
 if((row.repositoryIds as string[]).some(id=>!repositoryIds.includes(id)))fail('unknown project ID. Use catalog.json.');
 if(!(row.repositoryIds as string[]).length&&!row.includeFutureRepositories)fail('select projects or include future projects.');
 const sets=row.conditionSets===undefined?[row.conditions]:row.conditionSets;
 if(!Array.isArray(sets)||!sets.length||!sets.every(set=>Array.isArray(set)&&set.length&&set.every(t=>typeof t==='string'&&triggers.has(t))&&new Set(set).size===set.length&&!(set.includes('manual')&&set.length>1)&&set.filter(t=>exclusive.has(t)).length<=1))fail('invalid condition sets; use AND inside each set and OR between sets. Manual must stand alone.');
 for(const key of ['minutes','debounceSeconds','changeThreshold'])if(row[key]!==undefined&&(typeof row[key]!=='number'||!Number.isFinite(row[key])||(row[key] as number)<(key==='minutes'?1:0)))fail(`${key} must be a valid positive number (zero allowed for debounce/threshold).`);
 for(const key of ['commitBranch','handoffName','model','reasoningEffort','feedbackFolder'])if(row[key]!==undefined&&typeof row[key]!=='string')fail(`${key} must be text.`);
 if(row.emailRecipient!==undefined&&(typeof row.emailRecipient!=='string'||!validEmailRecipient(row.emailRecipient)))fail('invalid emailRecipient.');
 if(row.emailPriority!==undefined&&(!Number.isSafeInteger(row.emailPriority)||Number(row.emailPriority)<1))fail('emailPriority must be a positive integer.');
 if(row.mode!==undefined&&!['analyze','edit'].includes(String(row.mode)))fail('mode must be analyze or edit.');
 if(row.gitAction!==undefined&&!['fetch','pull','push','stage','unstage','commit'].includes(String(row.gitAction)))fail('unsupported gitAction.');
 if(row.kind==='git'&&!row.gitAction)fail('gitAction is required for Git actions.');
 if((sets as string[][]).flat().includes('handoff')&&(typeof row.handoffName!=='string'||!row.handoffName.trim()))fail('handoffName is required.');
 if(typeof row.handoffName==='string'&&row.handoffName&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(row.handoffName))fail('invalid handoffName.');
 if(row.emitsHandoffs&&(row.emitsHandoffs as string[]).some(name=>! /^(?:[A-Za-z0-9][A-Za-z0-9_-]{0,63}|\([A-Za-z0-9][A-Za-z0-9_-]{0,63}\))$/.test(name)))fail('invalid emitted handoff name.');
 if(row.handoffVariables&&(row.handoffVariables as string[]).some(x=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(x)))fail('invalid handoff flag name.');
 if(row.manualInputs!==undefined){if(!Array.isArray(row.manualInputs)||!row.manualInputs.every(input=>object(input)&&Object.keys(input).every(k=>['name','type','options','defaultValue','key','label','required'].includes(k))&&(input.required===undefined||typeof input.required==='boolean')&&typeof input.name==='string'&&typeof input.type==='string'&&(input.options===undefined||Array.isArray(input.options)&&input.options.every(x=>typeof x==='string'))&&(input.defaultValue===undefined||typeof input.defaultValue==='string')&&(input.key===undefined||typeof input.key==='string')&&(input.label===undefined||typeof input.label==='string')))fail('invalid manualInputs.');const error=inputDefinitionsError(row.manualInputs as AutomationInput[]);if(error)fail(error);}
 if(row.scriptRuntime!==undefined){if(!object(row.scriptRuntime)||Object.keys(row.scriptRuntime).some(k=>!['preset','executable','args','extension'].includes(k))||(row.scriptRuntime.extension!==undefined&&typeof row.scriptRuntime.extension!=='string')||!['auto','default','bash','powershell','python','node','ruby','custom'].includes(String(row.scriptRuntime.preset))||(row.scriptRuntime.executable!==undefined&&typeof row.scriptRuntime.executable!=='string')||(row.scriptRuntime.args!==undefined&&(!Array.isArray(row.scriptRuntime.args)||!row.scriptRuntime.args.every(x=>typeof x==='string'))))fail('invalid scriptRuntime.');const error=runtimeError(row.scriptRuntime as ScriptRuntime);if(error)fail(error);}
 if(typeof row.commitBranch==='string'){const parts=row.commitBranch.split(',').map(p=>p.trim()).filter(Boolean);if(!parts.length||parts.some(p=>p.startsWith('/')||p.endsWith('/')||p.includes('..')||/[\s~^:?\[\]\\]/.test(p)))fail('invalid commitBranch patterns.');}
 const existing=jobs.find(j=>j.id===row.id);const {accountId,...definition}=row;
 const profile=accountId===undefined?(existing?.provider===row.provider?existing?.profile:undefined):accountId===existing?.profile?.id&&existing?.provider===row.provider?existing.profile:profiles.find(p=>p.id===accountId&&p.provider===row.provider);if(accountId!==undefined&&!profile)fail('accountId must identify a configured account for this provider.');
 const runtime:Record<string,unknown>={...existing};for(const field of fields)delete runtime[field];
 delete runtime.profile;delete runtime.route;delete runtime.accountsByRepository;
 if(existing&&canonical(row)===canonical(exportAutomationDefinitions([existing])[0]))return existing;
 // Runtime state and per-project account assignments are never accepted from files.
 return {...runtime,...definition,id:row.id,title:row.title,prompt:row.prompt,enabled:row.enabled,kind:row.kind,provider:row.provider,conditions:(sets as Trigger[][])[0],conditionSets:sets,trigger:(sets as Trigger[][])[0][0],repositoryId:(row.repositoryIds as string[])[0]||'',repositoryIds:row.repositoryIds,threadId:'',target:'new',editor:existing?.editor||'vscode',minutes:row.minutes??60,nextAt:existing?.nextAt??Date.now(),profile,route:accountId===undefined||accountId===existing?.profile?.id?existing?.route:'profile',accountsByRepository:existing?.provider===row.provider&&(accountId===undefined||accountId===existing?.profile?.id)?existing?.accountsByRepository:undefined,lastAt:existing?.lastAt,lastResult:existing?.lastResult,errorUnread:existing?.errorUnread,state:existing?.state} as SavedPrompt;
 });
 if(next.some(job=>emailConflict(job,next)))throw Error('Set distinct priorities for overlapping email automations.');
 return next;
}
export function workflowDiff(before:SavedPrompt[],after:SavedPrompt[]){const b=new Map(exportAutomationDefinitions(before).map(x=>[x.id,canonical(x)]));const a=new Map(exportAutomationDefinitions(after).map(x=>[x.id,canonical(x)]));return {added:after.filter(x=>!b.has(x.id)),changed:after.filter(x=>b.has(x.id)&&b.get(x.id)!==a.get(x.id)),removed:before.filter(x=>!a.has(x.id))};}
