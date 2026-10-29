import {useState} from 'react';
import {FolderSearch,X} from 'lucide-react';
import {api} from '../lib/api';
/** Local file paths are selected through the OS dialog, never manually entered. */
export function LocalFilePicker({label,value,onChange,extensions,disabled=false}:{label:string;value:string;onChange:(path:string)=>void;extensions?:string[];disabled?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const browse=async()=>{setBusy(true);setError('');try{const selected=await api.selectLocalFile(`Choose ${label.toLowerCase()}`,extensions);if(selected)onChange(selected);}catch(reason){setError(String(reason));}finally{setBusy(false);}};
 return <label>{label}<span className="path-field local-file-picker"><input aria-label={label} value={value} readOnly disabled={disabled||busy} title={value||'Choose a file using Browse'} onClick={()=>{if(!disabled&&!busy)void browse();}}/><button type="button" aria-label={`Browse ${label}`} title="Browse" disabled={disabled||busy} onClick={()=>void browse()}><FolderSearch size={16}/></button>{value&&<button type="button" aria-label={`Clear ${label}`} title="Clear selection" disabled={disabled||busy} onClick={()=>onChange('')}><X size={14}/></button>}</span>{error&&<small role="alert">{error}</small>}</label>;
}
