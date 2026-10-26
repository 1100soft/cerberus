import {useEffect,useMemo,useRef,useState} from 'react';
import {Code2,Image,FileText} from 'lucide-react';
import {emailDocument,emailLink} from '../lib/emailHtml';
import {api} from '../lib/api';
import type {FeedbackMail} from '../lib/feedback';
export function EmailBody({message}:{message:FeedbackMail}){
 const [plain,setPlain]=useState(false),[remote,setRemote]=useState(false),[error,setError]=useState(''),[height,setHeight]=useState(320);
 const frame=useRef<HTMLIFrameElement>(null),token=useRef(crypto.randomUUID());
 const measure=()=>frame.current?.contentWindow?.postMessage({cerberusEmail:token.current,type:'measure'},'*');
 const document=useMemo(()=>message.html?emailDocument(message.html,message.inlineImages,remote,token.current):'',[message.html,message.inlineImages,remote]);
 useEffect(()=>{const receive=(event:MessageEvent)=>{if(event.source!==frame.current?.contentWindow||event.data?.cerberusEmail!==token.current)return;
  if(event.data.type==='height'&&typeof event.data.value==='number'&&Number.isFinite(event.data.value)){setHeight(Math.max(180,Math.min(20000,event.data.value)));if(frame.current)frame.current.dataset.ready='true';}
  if(event.data.type==='link'&&typeof event.data.value==='string'){const url=emailLink(event.data.value);if(url)void api.openEmailLink(url).catch(reason=>setError(String(reason)));}
 };window.addEventListener('message',receive);measure();return()=>window.removeEventListener('message',receive);},[]);
 return <div className="email-content">{message.html&&<div className="feedback-toolbar"><button type="button" aria-label={plain?'Show HTML email':'Show plain text email'} title={plain?'HTML':'Plain text'} onClick={()=>setPlain(value=>!value)}>{plain?<FileText size={15}/>:<Code2 size={15}/>}</button>{!remote&&!plain&&<button type="button" title="Load remote images for this message" onClick={()=>setRemote(true)}><Image size={15}/>Load images</button>}</div>}{error&&<p role="alert">{error}</p>}{message.html&&!plain?<iframe ref={frame} className="email-html-frame" title="Email message" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={document} onLoad={measure} style={{height}}/>:<pre className="feedback-body">{message.body||'No plain-text version is included.'}</pre>}</div>;
}
