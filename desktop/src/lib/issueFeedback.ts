import {invoke} from '@tauri-apps/api/core';
import {inTauri} from './api';
import {PageSnapshots} from './pageSnapshots';
export type FeedbackSaveOutcome={status:'saved'}|{status:'conflict';conflicts:{projectId:string;feedbackName:string;repository:string}[]};
export type FeedbackTarget={repository:string;identityId:string};
export type ProjectFeedback={disabled:boolean;target:FeedbackTarget|null;label:string};
export type FeedbackSettings={defaultTarget:FeedbackTarget|null;projects:Record<string,ProjectFeedback>};
export type FeedbackScope=FeedbackTarget&{label:string;inherited:boolean};
export type FeedbackIssue={number:number;title:string;body:string;state:string;url:string;createdAt:string;updatedAt:string;labels:string[]};
export type FeedbackComment={id:number;body:string;url:string;createdAt:string};
// Routing prefixes belong to integration settings, never user-facing names.
export const feedbackLabelName=(label:string)=>label.replace(/^project:/i,'');
export const feedbackLabelValue=(name:string,existing:string)=>/^project:/i.test(existing)?existing.slice(0,8)+feedbackLabelName(name):feedbackLabelName(name);
let preview:FeedbackSettings={defaultTarget:null,projects:{}};
export const issueLists=new PageSnapshots<FeedbackIssue[]>(32);
export const issueDetails=new PageSnapshots<FeedbackIssue>(24);
const settingsCache=new PageSnapshots<FeedbackSettings>(1);
export const issueFeedback={
 settings:()=>settingsCache.load('settings',()=>inTauri()?invoke<FeedbackSettings>('issue_feedback_settings'):Promise.resolve(preview)),
 save:async(settings:FeedbackSettings,acquireExisting=false):Promise<FeedbackSaveOutcome>=>{const result=inTauri()?await invoke<FeedbackSaveOutcome>('save_issue_feedback_settings',{settings,acquireExisting}):{status:'saved' as const};if(result.status==='conflict')return result;if(!inTauri())preview=settings;settingsCache.set('settings',settings);issueLists.clear();issueDetails.clear();window.dispatchEvent(new Event('issue-feedback-changed'));return result;},
 scope:async(repositoryId:string):Promise<FeedbackScope|null>=>{if(inTauri())return invoke('issue_feedback_scope',{repositoryId});const s=await issueFeedback.settings(),p=s.projects[repositoryId];const target=p?.target||s.defaultTarget;return p?.disabled||!target?null:{...target,label:p?.label||`project:${repositoryId}`,inherited:!p?.target};},
 request:async<T,>(repositoryId:string,request:Record<string,unknown>):Promise<T>=>{if(inTauri())return invoke('issue_feedback_request',{repositoryId,request});if(['list','comments'].includes(String(request.action)))return [] as T;if(request.action==='status')return {private:true,canWrite:true} as T;throw Error('GitHub feedback requires the desktop app.');},
};
