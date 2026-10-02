import {useEffect,useRef} from 'react';
import type {AgentStep} from '../types';
export function AgentActivity({steps,finished=true}:{steps?:AgentStep[];finished?:boolean}){
 const details=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{if(details.current)details.current.open=!finished;},[finished]);
 if(!steps?.length)return null;
 return <details ref={details} className="agent-steps" open={!finished}><summary>Activity · {steps.length} updates</summary><div className="agent-step-list">{steps.map((step,index)=><section data-message-id={step.id} className={`agent-step ${step.kind}`} key={step.id||index}>{step.kind!=='commentary' && <div className="agent-step-title"><span>{step.kind==='command'?'Command':step.title}</span>{step.kind==='command' && <code>{step.title}</code>}{step.status && <small>{step.status==='0'?'Completed':step.status}</small>}</div>}<pre>{step.text || 'No output'}</pre></section>)}</div></details>;
}
