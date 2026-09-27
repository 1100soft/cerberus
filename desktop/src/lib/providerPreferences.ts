import { useEffect, useState } from 'react';
export type Provider = 'codex' | 'cursor' | 'copilot' | 'claude';
const event = 'agent-configuration-changed';
export const configurationChanged = () => window.dispatchEvent(new Event(event));
function read(): Partial<Record<Provider, boolean>> {
  try { const value = JSON.parse(localStorage.getItem('gitcerberus.providers') || '{}'); return Object.fromEntries(['codex', 'cursor', 'copilot', 'claude'].filter(p => typeof value[p] === 'boolean').map(p => [p, value[p]])); } catch { return {}; }
}
export function useProviderPreferences() {
  const [settings, update] = useState(read);
  useEffect(() => { const refresh = () => update(read()); window.addEventListener(event, refresh); return () => window.removeEventListener(event, refresh); }, []);
  return [settings, (provider: Provider, enabled: boolean) => { localStorage.setItem('gitcerberus.providers', JSON.stringify({...read(), [provider]: enabled})); configurationChanged(); }] as const;
}
