import { useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { Copy } from 'lucide-react';

let copiedText: string | undefined;
const clipboardChanged = 'cerberus-clipboard-changed';
type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'> & {
  label: string;
  value?: string;
  getText?: () => string | Promise<string>;
  onCopied?: () => void;
  onError?: (error: unknown) => void;
};
export function CopyButton({label,value,getText,onCopied,onError,className='',disabled,...props}:Props){
  const [copied,setCopied]=useState(false);
  const [error,setError]=useState('');
  const lastText=useRef<string>();
  const mounted=useRef(true);
  const generation=useRef(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  useEffect(()=>{
    let active=true;
    lastText.current=value;
    const update=async()=>{
      const request=++generation.current;
      let clipboard=copiedText;
      try{clipboard=await navigator.clipboard.readText();}catch{/* Keep known state when clipboard reading is unavailable. */}
      if(active&&request===generation.current){copiedText=clipboard;setCopied(!!lastText.current&&clipboard===lastText.current);}
    };
    const localUpdate=()=>setCopied(!!lastText.current&&copiedText===lastText.current);
    const onCopy=()=>window.setTimeout(()=>void update(),50);
    void update();
    window.addEventListener('focus',update);
    window.addEventListener(clipboardChanged,localUpdate);
    document.addEventListener('copy',onCopy);
    const timer=window.setInterval(()=>{if(document.hasFocus())void update();},400);
    return()=>{active=false;generation.current++;window.clearInterval(timer);window.removeEventListener('focus',update);window.removeEventListener(clipboardChanged,localUpdate);document.removeEventListener('copy',onCopy);};
  },[value]);
  const copy=async()=>{
    try{
      const text=getText?await getText():value||'';
      await navigator.clipboard.writeText(text);
      copiedText=text;
      window.dispatchEvent(new Event(clipboardChanged));
      if(mounted.current){generation.current++;lastText.current=text;setCopied(!!text);setError('');onCopied?.();}
    }catch(reason){if(mounted.current){setCopied(false);setError(`Could not copy: ${String(reason)}`);onError?.(reason);}}
  };
  return <><button {...props} type="button" className={`copy-button ${copied?'copied':''} ${className}`} aria-label={label} title={error|| (copied?'Copied to clipboard.':label)} disabled={disabled} onClick={()=>void copy()}><Copy size={16}/></button><span className="sr-only" role="status">{error|| (copied?'Copied to clipboard.':'')}</span></>;
}
