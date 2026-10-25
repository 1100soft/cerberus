import {Mail,Check,AlertTriangle,LoaderCircle} from 'lucide-react';
import {useMailboxStatus} from '../lib/feedbackStatus';
export function FeedbackMailboxBadge({repositoryId,showEmpty=false,detail=false}:{repositoryId:string;showEmpty?:boolean;detail?:boolean}){
 const status=useMailboxStatus(repositoryId);
 if(status.state==='none'&&!showEmpty)return null;
 const ready=status.state==='ready',checking=status.state==='checking';
 const message=status.state==='none'?'Feedback mailbox is not configured.':checking?'Checking feedback mailbox…':ready?`Feedback connected · ${status.count??'—'} emails in ${status.config?.inbox}.`:`Feedback needs attention: ${status.error||'Setup is incomplete.'}`;
 return <span className={`feedback-mailbox-badge ${ready?'ready':'warning'}`} title={message} aria-label={message}>
  <span className="feedback-mailbox-icon"><Mail size={17}/>{checking?<LoaderCircle size={10} className="conversation-working"/>:ready?<Check size={10}/>:<AlertTriangle size={10}/>}</span>
  {ready&&status.count!==undefined&&<span>{status.count}</span>}{detail&&<span>{message}</span>}
 </span>;
}
