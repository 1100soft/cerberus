import {Mail,Check,AlertTriangle,LoaderCircle} from 'lucide-react';
import {useMailboxStatus} from '../lib/feedbackStatus';
export function FeedbackMailboxBadge({repositoryId,showEmpty=false,detail=false,onOpen}:{repositoryId:string;showEmpty?:boolean;detail?:boolean;onOpen?:()=>void}){
 const status=useMailboxStatus(repositoryId.startsWith('github:')?'':repositoryId);
 if(status.state==='none'&&!showEmpty)return null;
 const ready=status.state==='ready',checking=status.state==='checking';
 const message=status.state==='none'?'Email mailbox is not configured.':checking?'Checking email mailbox…':ready?`Email connected · ${status.count??'—'} emails in ${status.config?.inbox}.`:`Email needs attention: ${status.error||'Setup is incomplete.'}`;
 const content=<><span className="feedback-mailbox-icon"><Mail size={17}/>{checking?<LoaderCircle size={10} className="conversation-working"/>:ready?<Check size={10}/>:<AlertTriangle size={10}/>}</span>{ready&&status.count!==undefined&&<span>{status.count}</span>}{detail&&<span>{message}</span>}</>;
 return onOpen?<button type="button" className={`feedback-mailbox-badge ${ready?'ready':'warning'}`} title={message} aria-label={message} onClick={event=>{event.stopPropagation();onOpen();}}>{content}</button>:<span className={`feedback-mailbox-badge ${ready?'ready':'warning'}`} title={message} aria-label={message}>{content}
 </span>;
}
