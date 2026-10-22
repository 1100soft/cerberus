import { useRef, type KeyboardEventHandler } from 'react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import ruby from 'highlight.js/lib/languages/ruby';
import powershell from 'highlight.js/lib/languages/powershell';
import plaintext from 'highlight.js/lib/languages/plaintext';

hljs.registerLanguage('bash', bash);
for(const [name,grammar] of Object.entries({python,javascript,ruby,powershell,plaintext}))hljs.registerLanguage(name,grammar);

function highlighted(code:string,language='bash'){return hljs.highlight(code,{language:language==='node'?'javascript':['bash','python','ruby','powershell'].includes(language)?language:'plaintext',ignoreIllegals:true}).value;}

export function ShellCode({code,language}:{code:string;language?:string}){
  return <pre className="shell-code"><code dangerouslySetInnerHTML={{__html:highlighted(code,language)}}/></pre>;
}

export function ShellEditor({value,onChange,onKeyDown,language}:{language?:string;value:string;onChange:(value:string)=>void;onKeyDown?:KeyboardEventHandler<HTMLTextAreaElement>}){
  const mirror=useRef<HTMLPreElement>(null);
  return <div className="shell-editor">
    <pre ref={mirror} aria-hidden="true" className="shell-editor-highlight"><code dangerouslySetInnerHTML={{__html:highlighted(value,language)+"\n"}}/></pre>
    <textarea className="automation-script" aria-label="Script content" placeholder="Write your script" spellCheck={false} value={value} onChange={event=>onChange(event.target.value)} onKeyDown={onKeyDown} onScroll={event=>{if(mirror.current){mirror.current.scrollTop=event.currentTarget.scrollTop;mirror.current.scrollLeft=event.currentTarget.scrollLeft;}}} rows={8}/>
  </div>;
}
