import {PageSnapshots} from './pageSnapshots';
import type {FeedbackMail,FolderOverview} from './feedback';
export const emailFolders=new PageSnapshots<FolderOverview[]>(32);
export const emailLists=new PageSnapshots<FeedbackMail[]>(32);
export const emailMessages=new PageSnapshots<FeedbackMail>(12);
export const emailListKey=(project:string,folder:string)=>JSON.stringify([project,folder]);
export const emailMessageKey=(project:string,mail:{folder:string;validity:number;uid:number;messageId:string})=>JSON.stringify([project,mail.folder,mail.validity,mail.uid,mail.messageId]);
export function invalidateEmailSnapshots(project?:string){
 const matches=(key:string)=>!project||JSON.parse(key)[0]===project;
 emailLists.clear(matches);emailMessages.clear(matches);
}
window.addEventListener('feedback-config-changed',event=>{const id=(event as CustomEvent<string>).detail;emailFolders.clear(key=>!id||key===id);});
for(const name of ['feedback-config-changed','feedback-mail-changed'])window.addEventListener(name,event=>invalidateEmailSnapshots((event as CustomEvent<string>).detail));
