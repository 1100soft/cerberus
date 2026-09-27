import { createPortal } from 'react-dom';
import { configurationChanged } from '../lib/providerPreferences';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { SetupTerminal } from './SetupTerminal';
import { api, inTauri } from '../lib/api';
export type Provider = 'codex' | 'cursor';
type Tool = { tool: 'codex' | 'cursor' | 'cursor-agent'; path: string | null; error: string | null };
const name = (tool: Tool['tool']) => tool === 'codex' ? 'Codex' : tool === 'cursor' ? 'Cursor SDK history (optional)' : 'Cursor Agent';
/** One provider setup surface used from both conversations and agent billing profiles. */
export function ProviderSetup({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const [profiles, setProfiles] = useState<Array<{id: string; label: string; provider: string}>>([]);
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState('');
  const saveLock = useRef(false);
  const keyInput = useRef<HTMLInputElement>(null);
  const confirmationClose = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (added) confirmationClose.current?.focus(); }, [added]);
  const dialog = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    const shell = document.querySelector<HTMLElement>('.shell');
    shell?.setAttribute('inert', '');
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('.app-select-menu')) return;
      if (event.key === 'Escape') { event.preventDefault(); if (!locked.current) onClose(); }
      if (event.key === 'Tab') {
        const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]') || []).filter(el => el.getClientRects().length);
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); shell?.removeAttribute('inert'); opener?.focus(); configurationChanged(); };
  }, []);
  useEffect(() => { if (inTauri()) invoke<typeof profiles>('agent_profiles').then(setProfiles).catch(e => setError(String(e))); }, []);
  async function saveAccount() {
    if (saveLock.current || installing || !apiKey.trim()) return;
    saveLock.current = true;
    setSaving(true); setError('');
    try {
      const base = provider === 'codex' ? 'Codex' : 'Cursor';
      let index = 1; while (profiles.some(p => p.label === `${base} ${index}`)) index++;
      const profile = await invoke<(typeof profiles)[number]>('save_agent_profile', {provider, label: label.trim() || `${base} ${index}`, executable: '', key: apiKey});
      setProfiles(current => [...current, profile]); setApiKey(''); setLabel(''); setAdded(profile.label); configurationChanged();
    } catch(e) { setError(String(e)); } finally { saveLock.current = false; setSaving(false); }
  }
  const [tools, setTools] = useState<Tool[]>([]);
  const [installing, setInstalling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  locked.current = installing || saving || busy;
  async function detect() {
    if (!inTauri()) { setError('Provider setup requires the desktop app.'); return; }
    setBusy(true); setError('');
    try { setTools(await invoke<Tool[]>('provider_setup_status', { provider })); }
    catch(e) { setError(String(e)); } finally { setBusy(false); }
  }
  useEffect(() => { void detect(); }, [provider]);
  useEffect(() => {
    if (!inTauri() || installing) return;
    let active = true;
    const timer = window.setInterval(() => {
      invoke<Tool[]>('provider_setup_status', { provider }).then(next => { if (active) setTools(next); }).catch(() => {});
    }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [provider, installing]);
  async function change(tool: Tool['tool'], reset = false) {
    try {
      const path = reset ? null : await open({ directory:false, multiple:false, title:`Choose ${name(tool)} executable` });
      if (!reset && typeof path !== 'string') return;
      setBusy(true);
      await invoke('set_provider_path', { tool, path });
      await detect();
    } catch(e) { setError(String(e)); } finally { setBusy(false); }
  }
  return createPortal(<div className="provider-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !locked.current) onClose(); }}><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={added ? "key-added-title" : "agent-setup-title"} className="provider-dialog">{added ? <><header><h2 id="key-added-title">API key added</h2></header><div className="provider-dialog-content"><p><b>{added}</b> was saved successfully in your OS keychain.</p><p>You can select this account in chat. The provider checks the key when you send your first message.</p></div><footer><button type="button" onClick={() => { setAdded(''); requestAnimationFrame(() => keyInput.current?.focus()); }}>Add another key</button><button ref={confirmationClose} type="button" onClick={onClose}>Close</button></footer></> : <><header><h2 id="agent-setup-title" className={`provider-name provider-${provider}`}>{provider === 'codex' ? 'Codex' : 'Cursor'} setup</h2></header><div className="provider-dialog-content"><section className="provider-setup" aria-label={`${provider === 'codex' ? 'Codex' : 'Cursor'} provider setup`}>
    {busy && <p role="status">Checking installation…</p>}
    {tools.filter(tool => tool.tool !== 'cursor').map(tool => <div key={tool.tool}><p>{name(tool.tool)}: {tool.path ? 'Ready' : tool.error || 'Not found'}</p>{!tool.path && !tool.error && <SetupTerminal provider={tool.tool} onInstalled={detect} onRunningChange={setInstalling} disabled={installing} />}</div>)}
    {provider==='codex' && <section><h3>ChatGPT subscription</h3><p>Sign in and assign your ChatGPT accounts in Identities.</p><button onClick={()=>{onClose();window.dispatchEvent(new Event('show-identities'));}}>Manage ChatGPT identities</button></section>}
    <h3>API accounts (optional)</h3>
    <p>Connect the account you want to use for chat. Usage is billed to that account.</p>
    {profiles.filter(p => p.provider === provider && !(p as {subscription?:boolean}).subscription).map(p => <div className="agent-controls" key={p.id}><b>{p.label}</b><span>Key saved</span><button disabled={saving} onClick={async () => { setSaving(true); try { await invoke('remove_agent_profile', {id:p.id}); setProfiles(current => current.filter(item => item.id !== p.id)); configurationChanged(); } catch(e) { setError(String(e)); } finally { setSaving(false); } }}>Disconnect {p.label}</button></div>)}
    <form onSubmit={event => { event.preventDefault(); void saveAccount(); }}>
      <p>{provider === 'codex' ? 'Open the OpenAI API dashboard, sign in to the account you want to use, select your project, and create a new secret API key. Make sure that project has API billing enabled.' : 'Open the Cursor dashboard, sign in to the account you want to use, open API Keys, and create a user API key.'} Paste the key below.</p>
      <button type="button" disabled={!inTauri()} onClick={() => api.openExternalUrl(provider === 'codex' ? 'https://platform.openai.com/api-keys' : 'https://cursor.com/dashboard').catch(e => setError(String(e)))}>Open {provider === 'codex' ? 'OpenAI API keys' : 'Cursor dashboard'}</button>
      <label>API key<input ref={keyInput} type="password" required autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} /></label>
      <p>Stored in your OS keychain. The provider checks the key when you run a task.</p>
      <details><summary>Advanced account settings</summary><label>Account name<input placeholder="Generated automatically; e.g. Work or Personal" value={label} onChange={event => setLabel(event.target.value)} /></label></details>
      <button disabled={saving || installing || !apiKey.trim() || !inTauri()}>{saving ? 'Saving…' : 'Connect account'}</button>
    </form>
    <details><summary>Advanced installation settings</summary>
      {tools.map(tool => <div key={tool.tool} className="provider-tool"><b>{name(tool.tool)}</b><p>{tool.path || tool.error || 'Not installed'}</p>
        <button type="button" disabled={busy || installing} onClick={() => change(tool.tool)}>Choose executable</button>
        <button type="button" disabled={busy || installing} onClick={() => change(tool.tool, true)}>Use automatic detection</button>
        {tool.tool === 'cursor' && !tool.path && !tool.error && <SetupTerminal provider="cursor" onInstalled={detect} onRunningChange={setInstalling} disabled={installing} />}
      </div>)}
      <button type="button" disabled={busy || installing} onClick={detect}>Detect again</button>
      <button type="button" disabled={!inTauri()} onClick={() => api.openExternalUrl(provider === 'codex' ? 'https://developers.openai.com/codex/cli/' : 'https://cursor.com/docs/cli/installation').catch(e => setError(String(e)))}>Official documentation</button>
      
    </details>
    {error && <p role="alert">{error}</p>}
  </section></div><footer><span>Settings save automatically. API keys save when you connect.</span><button type="button" disabled={installing || saving || busy} onClick={onClose}>Close</button></footer></>}</div></div>, document.body);
}
