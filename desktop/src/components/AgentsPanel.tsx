import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type Provider } from './ProviderSetup';
import { useProviderPreferences } from '../lib/providerPreferences';
import { useAgentChats } from '../lib/agentChats';
import { inTauri } from '../lib/api';
type Profile = { id: string; label: string; provider: string; executable: string; subscription?:boolean; disconnected?:boolean };
export function AgentsPanel({ visible, onSetup }: { visible: boolean; onSetup: (provider: Provider) => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [settings] = useProviderPreferences();
  const [installation, setInstallation] = useState<Partial<Record<Provider, {path: string | null; error: string | null}>>>({});
  const [error, setError] = useState('');
  const runs = useAgentChats();
  useEffect(() => {
    if (!visible || !inTauri()) return;
    let active = true;
    const refresh = async () => {
      try {
        const next = await invoke<Profile[]>('agent_profiles');
        if (!active) return;
        setProfiles(next);
        for (const provider of ['codex', 'cursor'] as const) {
          const tools = await invoke<Array<{tool: string; path: string | null; error: string | null}>>('provider_setup_status', {provider});
          if (active) setInstallation(current => ({...current, [provider]: tools.find(tool => tool.tool === (provider === 'codex' ? 'codex' : 'cursor-agent'))}));
        }
      } catch(e) { if (active) setError(String(e)); }
    };
    void refresh(); window.addEventListener('agent-configuration-changed', refresh);
    const timer = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('agent-configuration-changed', refresh); };
  }, [visible]);
  return <section className="agents-panel" hidden={!visible} aria-label="Agent workspace">
    <header><h1>Agents</h1><p>Manage installations, accounts, and agent status. Chat from a repository’s conversation pane.</p></header>
    <p>Connect ChatGPT subscriptions in Identities. Use Setup for installation and optional API keys. Use the repository account action to assign ChatGPT, Cursor, and Claude accounts. API accounts can be selected in chat.</p>
    {!inTauri() && <p>Agent detection, execution, and credential storage require the desktop app.</p>}
    <div className="agent-cards">{(['codex', 'cursor'] as Provider[]).sort((a,b) => Number(!!installation[b]?.path) - Number(!!installation[a]?.path)).map(provider => {
      const accounts = profiles.filter(p => p.provider === provider);
      const installed = !!installation[provider]?.path;
      const running = runs.filter(run => run.running && run.profile.provider === provider).length;
      return <article className="agent-card" key={provider}>
        <header><h2>{provider === 'codex' ? 'Codex' : 'Cursor Agent'}</h2><span className={installed ? 'agent-ready' : ''}>{installed ? 'Installed' : installation[provider]?.error ? 'Needs attention' : installation[provider] ? 'Not installed for tasks' : inTauri() ? 'Checking…' : 'Desktop app required'}</span></header>
        <p>{accounts.length} {accounts.length === 1 ? 'account' : 'accounts'} · Conversations {settings[provider] ? 'on' : 'off'}{running ? ` · ${running} running` : ''}</p>
        {installation[provider]?.error && <p role="alert">{installation[provider]?.error}</p>}
        {accounts.map(account => <div className="agent-account" key={account.id}><span><b>{account.label}</b><small>{account.subscription ? `ChatGPT subscription · ${account.disconnected?'Disconnected':'Connected'}` : 'API key saved'}</small></span><button onClick={() => account.subscription ? window.dispatchEvent(new Event('show-identities')) : onSetup(provider)}>Manage</button></div>)}
        {!accounts.length && <p>Connect an account to run tasks with this agent.</p>}
        <button onClick={() => onSetup(provider)} aria-label={`Set up ${provider === 'codex' ? 'Codex' : 'Cursor'}`}>Setup</button>
      </article>;
    })}</div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
