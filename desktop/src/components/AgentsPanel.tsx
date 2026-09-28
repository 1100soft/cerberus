import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type Provider } from './ProviderSetup';
import { useProviderPreferences } from '../lib/providerPreferences';
import { useAgentChats } from '../lib/agentChats';
import { inTauri } from '../lib/api';
import type { Identity } from '../types';
type Profile = { id: string; label: string; provider: string; executable: string; subscription?:boolean; disconnected?:boolean };
type ToolStatus = { path: string | null; error: string | null };
const agents: Array<{ id: Provider; title: string; tool: string; summary: string; signIn: string }> = [
  { id: 'codex', title: 'Codex', tool: 'codex', summary: 'ChatGPT subscription or an OpenAI API key.', signIn: 'ChatGPT identities' },
  { id: 'cursor', title: 'Cursor', tool: 'cursor-agent', summary: 'Cursor Agent for tasks. Editor history does not need the CLI.', signIn: 'Cursor account' },
  { id: 'copilot', title: 'Copilot', tool: 'copilot', summary: 'Uses a GitHub account already connected in Identities.', signIn: 'GitHub identity' },
  { id: 'claude', title: 'Claude', tool: 'claude', summary: 'Claude Code CLI for transcripts and sign-in.', signIn: 'Claude account' },
];
export function AgentsPanel({ visible, identities, onSetup }: { visible: boolean; identities: Identity[]; onSetup: (provider: Provider) => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [settings] = useProviderPreferences();
  const [installation, setInstallation] = useState<Partial<Record<Provider, ToolStatus>>>({});
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
        for (const agent of agents) {
          const tools = await invoke<Array<{tool: string; path: string | null; error: string | null}>>('provider_setup_status', {provider: agent.id});
          if (!active) return;
          setInstallation(current => ({...current, [agent.id]: tools.find(tool => tool.tool === agent.tool) ?? { path: null, error: null }}));
        }
      } catch(e) { if (active) setError(String(e)); }
    };
    void refresh(); window.addEventListener('agent-configuration-changed', refresh);
    const timer = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('agent-configuration-changed', refresh); };
  }, [visible]);
  const ready = agents.filter(agent => installation[agent.id]?.path).length;
  return <section className="agents-panel" hidden={!visible} aria-label="Agent workspace">
    <header><h1>Agents</h1><p>Install each CLI, then connect the account it uses. Chat from a repository’s conversation pane.</p></header>
    <p className="agent-page-status">{inTauri() ? `${ready} of ${agents.length} CLIs ready.` : 'Agent detection, execution, and credential storage require the desktop app.'} Setup installs the CLI. Identities connects the account. Conversations stay off until you enable that provider.</p>
    <div className="agent-cards">{agents.map(agent => {
      const github = identities.filter(identity => identity.connected !== false);
      const accounts = agent.id === 'copilot'
        ? github.map(identity => ({ id: identity.id, label: identity.providerUsername ? `@${identity.providerUsername}` : identity.label, detail: 'GitHub account · Copilot', onManage: () => window.dispatchEvent(new Event('show-identities')) }))
        : profiles.filter(p => p.provider === agent.id).map(account => ({ id: account.id, label: account.label, detail: account.subscription ? `ChatGPT subscription · ${account.disconnected ? 'Disconnected' : 'Connected'}` : 'API key saved', onManage: () => account.subscription ? window.dispatchEvent(new Event('show-identities')) : onSetup(agent.id) }));
      const status = installation[agent.id];
      const installed = !!status?.path;
      const running = runs.filter(run => run.running && run.profile.provider === agent.id).length;
      const state = installed ? 'Installed' : status?.error ? 'Needs attention' : status ? 'Not installed' : inTauri() ? 'Checking…' : 'Desktop app required';
      return <article className="agent-card" key={agent.id}>
        <header><h2 className={`provider-name provider-${agent.id}`}>{agent.title}</h2><span className={installed ? 'agent-ready' : 'agent-pending'}>{state}</span></header>
        <p>{agent.summary}</p>
        <p>{accounts.length} {accounts.length === 1 ? 'account' : 'accounts'} · Conversations {settings[agent.id] ? 'on' : 'off'}{running ? ` · ${running} running` : ''}</p>
        {status?.error && <p role="alert">{status.error}</p>}
        {installed && status?.path && <p className="agent-path" title={status.path}>{status.path}</p>}
        {accounts.map(account => <div className="agent-account" key={account.id}><span><b>{account.label}</b><small>{account.detail}</small></span><button onClick={account.onManage}>Manage</button></div>)}
        {!accounts.length && agent.id === 'copilot' && <p>Connect a GitHub account to use Copilot.</p>}
        {!accounts.length && agent.id !== 'copilot' && agent.id !== 'claude' && <p>Connect an account to run tasks with this agent.</p>}
        <div className="agent-actions">
          <button onClick={() => onSetup(agent.id)} aria-label={`Set up ${agent.title}`}>Setup</button>
          <button type="button" onClick={() => window.dispatchEvent(new Event('show-identities'))}>{agent.signIn}</button>
        </div>
      </article>;
    })}</div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
