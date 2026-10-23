import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import diff from 'highlight.js/lib/languages/diff';
import {ActivityTime} from './ActivityTime';
import type {AutomationLog} from '../lib/api';
for(const [name,grammar] of [['bash',bash],['sh',bash],['json',json],['diff',diff]] as const)hljs.registerLanguage(name,grammar);
function HighlightedCode({value}:{value:string}){
  const html=hljs.highlightAuto(value,['bash','json','diff']).value;
  return <pre className="automation-log-code"><code dangerouslySetInnerHTML={{__html:html}}/></pre>;
}
export function AutomationRunContent({entry}:{entry:AutomationLog}){
 if(entry.events?.length)return <div className="automation-event-list">{entry.events.map((event,index)=><section key={index} className={`automation-event ${event.stream} ${event.stream==='stderr'?'automation-log-error':event.stream==='activity'?'automation-log-activity':''}`}><header><ActivityTime timestamp={event.at}/><small>{event.stream}</small></header>{event.stream==='stdout'?<HighlightedCode value={event.text}/>:<pre>{event.text}</pre>}</section>)}</div>;
 return <><ActivityTime timestamp={entry.createdAt}/>{(['stdout','stderr','response','activity'] as const).filter(key=>entry[key]).map(key=><section key={key} className={`automation-event ${key} ${key==='stderr'?'automation-log-error':key==='activity'?'automation-log-activity':''}`}><small>{key}</small>{key==='stdout'?<HighlightedCode value={entry[key]}/>:<pre>{entry[key]}</pre>}</section>)}</>;
}
