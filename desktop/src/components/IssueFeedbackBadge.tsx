import {Tickets,Check,AlertTriangle,LoaderCircle} from 'lucide-react';
import {useIssueFeedbackStatus} from '../lib/issueFeedbackStatus';
export function IssueFeedbackBadge({repositoryId}:{repositoryId:string}){
 const state=useIssueFeedbackStatus(repositoryId),linked=!repositoryId.startsWith('github:');
 const message=state.state==='ready'?`Feedback configured · ${state.count} open issues.`:state.state==='checking'?'Checking feedback…':state.state==='warning'?`Feedback needs attention: ${state.error}`:linked?'Feedback is not configured.':'Link this project to configure feedback.';
 return <button type="button" className={`feedback-mailbox-badge ${state.state==='ready'?'ready':'warning'}`} title={message} aria-label={message} onClick={event=>{event.stopPropagation();window.dispatchEvent(new CustomEvent('open-project-page',{detail:{projectId:repositoryId,page:'feedback'}}));}}><span className="feedback-mailbox-icon"><Tickets size={17}/>{state.state==='checking'?<LoaderCircle size={10} className="conversation-working"/>:state.state==='ready'?<Check size={10}/>:<AlertTriangle size={10}/>}</span>{state.count!==undefined&&<span>{state.count}</span>}</button>;
}
