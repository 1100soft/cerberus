import { useRef, type KeyboardEventHandler } from 'react';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';

hljs.registerLanguage('bash', bash);

function highlighted(code:string){return hljs.highlight(code,{language:'bash',ignoreIllegals:true}).value;}

export function ShellCode({code}:{code:string}){
  return <pre className="shell-code"><code dangerouslySetInnerHTML={{__html:highlighted(code)}}/></pre>;
}

export function ShellEditor({value,onChange,onKeyDown}:{value:string;onChange:(value:string)=>void;onKeyDown?:KeyboardEventHandler<HTMLTextAreaElement>}){
  const mirror=useRef<HTMLPreElement>(null);
  return <div className="shell-editor">
    <pre ref={mirror} aria-hidden="true" className="shell-editor-highlight"><code dangerouslySetInnerHTML={{__html:highlighted(value)+"\n"}}/></pre>
    <textarea className="automation-script" aria-label="Shell command or script" placeholder="Shell command or script" spellCheck={false} value={value} onChange={event=>onChange(event.target.value)} onKeyDown={onKeyDown} onScroll={event=>{if(mirror.current){mirror.current.scrollTop=event.currentTarget.scrollTop;mirror.current.scrollLeft=event.currentTarget.scrollLeft;}}} rows={8}/>
  </div>;
}
