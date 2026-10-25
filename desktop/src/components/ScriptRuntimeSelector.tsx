import {LocalFilePicker} from './LocalFilePicker';
import { useEffect,useState,useRef } from 'react';
import { Select } from './Select';
import { api } from '../lib/api';
import { InfoPopover } from './InfoPopover';
import { availableRuntimeOptions,detectScriptRuntime,runtimeLabel,type ScriptRuntime,type RuntimeStatus } from '../lib/scriptRuntime';
export function ScriptRuntimeSelector({value,onChange,repositoryId,source='',allowDefault=true}:{value:ScriptRuntime;onChange:(value:ScriptRuntime)=>void;repositoryId?:string;source?:string;allowDefault?:boolean}){
 const [platform,setPlatform]=useState('bash');
 useEffect(()=>{void api.scriptRuntimePlatform().then(setPlatform).catch(()=>{});},[]);
 const detected=detectScriptRuntime(source);
 const key=JSON.stringify([value,repositoryId,source]);const current=useRef(key);current.current=key;
 const [choices,setChoices]=useState<RuntimeStatus[]>([]),[status,setStatus]=useState<RuntimeStatus>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;setChoices([]);void api.scriptRuntimeCandidates(repositoryId).then(items=>{if(active)setChoices(items);}).catch(reason=>{if(active)setError(String(reason));});return()=>{active=false;};},[repositoryId]);
 useEffect(()=>{setStatus(undefined);setError('');},[JSON.stringify(value),repositoryId,source]);
 const paths=[...new Set(choices.filter(item=>item.preset===value.preset).map(item=>item.executable!).filter(Boolean))];if(value.executable&&!paths.includes(value.executable))paths.push(value.executable);
 const check=async()=>{const request=current.current;setBusy(true);setError('');try{const result=await api.checkScriptRuntime(value,repositoryId,source);if(request===current.current)setStatus(result);}catch(reason){if(request===current.current)setError(String(reason));}finally{setBusy(false);}};
 return <div className="script-runtime-controls"><div className="script-runtime-row"><Select label="Script runtime" value={value.preset} options={availableRuntimeOptions(platform,[...choices.map(item=>item.preset),...(detected?[detected]:[])],value.preset,allowDefault)} onChange={preset=>onChange({preset:preset as ScriptRuntime['preset']})}/>{!['auto','default'].includes(value.preset)&&value.preset!=='custom'&&<Select label="Interpreter executable" value={value.executable||''} options={[{value:'',label:value.preset==='python'?'Automatic (repository venv, then PATH)':'Automatic from PATH'},...paths.map(path=>({value:path,label:path}))]} onChange={executable=>onChange({...value,executable})}/>}<button type="button" disabled={busy} onClick={()=>void check()}>{busy?'Checking…':'Check runtime'}</button><InfoPopover label="Script runtime help"><p>Automatic detects clear language cues, including shebangs. Ambiguous scripts use the app default. Choose a runtime explicitly to override detection.</p><p>The app default is initially Bash on Linux/macOS and PowerShell on Windows. Other shells appear when installed, detected, or already selected. Interpreter arguments precede the script file and are passed literally, without shell quoting.</p></InfoPopover></div>
 {!['auto','default'].includes(value.preset)&&<details open={value.preset==='custom'}><summary>Interpreter options</summary><LocalFilePicker label="Script interpreter path" value={value.executable||''} onChange={executable=>onChange({...value,executable})}/><label>Interpreter arguments (one per line)<textarea aria-label="Script interpreter arguments" rows={2} value={(value.args||[]).join('\n')} onChange={event=>onChange({...value,args:event.target.value.split('\n').filter(arg=>arg.length>0)})}/></label><label>Script file extension<input aria-label="Script file extension" value={value.extension||''} placeholder="Automatic" onChange={event=>onChange({...value,extension:event.target.value})}/></label></details>}
 {value.preset==='auto'&&<small role="status">{detected?`Detected: ${runtimeLabel({preset:detected})}`:'Language uncertain — app default will be used.'}</small>}
 {(error||status)&&<small role="status">{error||status?.error||`${status?.executable} · ${status?.version}`}</small>}</div>;
}
