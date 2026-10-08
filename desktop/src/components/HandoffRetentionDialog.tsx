import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { refreshBlockedAutomations } from '../lib/savedPrompts';
import { api } from '../lib/api';

export function AutomationSettingsDialog({repositoryIds,onClose}:{repositoryIds:string[];onClose:()=>void}){
  const [hours,setHours]=useState('24');
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{let active=true;void api.handoffSettings().then(settings=>{if(active){setHours(String(settings.retentionHours));setLoading(false);requestAnimationFrame(()=>input.current?.focus());}}).catch(error=>{if(active){setError(String(error));setLoading(false);}});return()=>{active=false;};},[]);
  const valid=Number.isInteger(Number(hours))&&Number(hours)>=1&&Number(hours)<=8760;
  const save=async()=>{
    if(!valid||loading||saving)return;
    setSaving(true);setError('');
    try{
      await api.saveHandoffSettings(Number(hours));
      await api.cleanupStaleHandoffs(repositoryIds);
      await refreshBlockedAutomations();

      onClose();
    }catch(error){setError(String(error));setSaving(false);}
  };
  return <div className="automation-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onClose();}}><section className="automation-dialog automation-condition-dialog" role="dialog" aria-modal="true" aria-label="Automation settings" onKeyDown={event=>{if(event.key==='Escape'&&!saving){event.stopPropagation();onClose();}if(event.key==='Enter'&&event.target===input.current){event.preventDefault();void save();}}}>
    <header><h2>Automation settings</h2><button type="button" aria-label="Close automation settings" disabled={saving} onClick={onClose}><X size={17}/></button></header>
    <div className="automation-dialog-content"><h3>Handoff retention</h3><p>Keep completed and blocked handoffs for downstream reruns. Pending handoffs and active runs are kept separately.</p><label className="handoff-retention-field">Retention in hours<input ref={input} type="number" min={1} max={8760} step={1} value={hours} disabled={loading||saving} onChange={event=>setHours(event.target.value)}/></label><p className="panel-copy">Default: 24 hours after the latest run finishes. Choose 1–8760 whole hours. Reducing this period removes expired handoffs; increasing it cannot restore deleted payloads.</p>{error&&<p className="config-error" role="alert">{error}</p>}</div>
    <footer><button type="button" disabled={!valid||loading||saving} onClick={()=>void save()}>{saving?'Saving…':'Save'}</button></footer>
  </section></div>;
}
