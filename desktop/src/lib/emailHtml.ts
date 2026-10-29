import DOMPurify from 'dompurify';
export function emailLink(value:string):string|null{try{const url=new URL(value);return ['https:','http:','mailto:'].includes(url.protocol)?url.href:null;}catch{return null;}}
const options={USE_PROFILES:{html:true},WHOLE_DOCUMENT:true,FORBID_TAGS:['script','iframe','object','embed','form','input','button','textarea','select','video','audio','source','link','base','meta'],FORBID_ATTR:['srcset','background','ping','download','autofocus','nonce']} as const;
export function emailDocument(html:string,images:Record<string,string>={},remote=false,token=crypto.randomUUID()):string{
 const clean=DOMPurify.sanitize(html,{...options,FORBID_TAGS:[...options.FORBID_TAGS],FORBID_ATTR:[...options.FORBID_ATTR],RETURN_DOM:true}) as HTMLElement;
 for(const anchor of clean.querySelectorAll('a')){const href=anchor.getAttribute('href')||'';anchor.removeAttribute('data-email-link');anchor.removeAttribute('target');anchor.removeAttribute('href');const link=emailLink(href);if(link){anchor.setAttribute('data-email-link',link);anchor.setAttribute('href','#');anchor.setAttribute('title',link);}else if(href.startsWith('#'))anchor.setAttribute('href',href);}
 for(const image of clean.querySelectorAll('img')){const src=image.getAttribute('src')||'';image.removeAttribute('src');let value=src;if(src.toLowerCase().startsWith('cid:')){let cid=src.slice(4);try{cid=decodeURIComponent(cid);}catch{/* Keep the literal ID. */}value=images[cid]||'';}
  if(/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)||(remote&&/^https?:\/\//i.test(value)))image.setAttribute('src',value);
 }
 const sanitized=DOMPurify.sanitize(clean.outerHTML,{...options,FORBID_TAGS:[...options.FORBID_TAGS],FORBID_ATTR:[...options.FORBID_ATTR],RETURN_DOM:true}) as HTMLElement;
 const owner=sanitized.ownerDocument,head=sanitized.querySelector('head')!,body=sanitized.querySelector('body')!;
 const policy=`default-src 'none'; script-src 'nonce-${token}'; style-src 'unsafe-inline'; img-src data:${remote?' https: http:':''}; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'`;
 const meta=owner.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content=policy;head.prepend(meta);
 const charset=owner.createElement('meta');charset.setAttribute('charset','utf-8');head.prepend(charset);
 const referrer=owner.createElement('meta');referrer.name='referrer';referrer.content='no-referrer';head.prepend(referrer);
 const style=owner.createElement('style');style.textContent='html{background:white;color:#202020;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}body{margin:12px}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}a{color:#325ec8}';head.insertBefore(style,meta.nextSibling);
 // This is the only executable code: a fixed, nonce-authorized bridge in an
 // opaque-origin frame. Sender HTML cannot access app DOM, storage, or IPC.
 const script=owner.createElement('script');script.setAttribute('nonce',token);
 script.textContent=`(()=>{const send=(type,value)=>parent.postMessage({cerberusEmail:${JSON.stringify(token)},type,value},'*');document.addEventListener('click',event=>{const anchor=event.target.closest&&event.target.closest('a');if(!anchor)return;const link=anchor.getAttribute('data-email-link');if(link){event.preventDefault();send('link',link);}});let last=0;const resize=()=>{const height=Math.max(180,Math.min(20000,document.body.scrollHeight+24));if(height!==last){last=height;send('height',height);}};window.addEventListener('message',event=>{if(event.source===parent&&event.data&&event.data.cerberusEmail===${JSON.stringify(token)}&&event.data.type==='measure'){last=0;resize();}});new ResizeObserver(resize).observe(document.body);resize();})();`;
 body.append(script);return '<!doctype html>'+sanitized.outerHTML;
}
