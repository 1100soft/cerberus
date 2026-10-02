import type { AgentProfile } from '../lib/agentChats';
import { ProviderIdentityBadge } from './ProviderIdentityBadge';

/** The same account color and initials identify an account in cards and Identities. */
export function ChatgptAccountBadge({account, assignedId, inherited=false}: {account?:AgentProfile;assignedId?:string|null;inherited?:boolean}) {
  const label=account?.label || (assignedId ? 'Unavailable account' : 'No ChatGPT account assigned');
  const detail=account || assignedId ? `ChatGPT: ${label}${account?.disconnected ? ' · Disconnected' : ''}${inherited ? ' · Default ChatGPT account' : ''}` : label;
  return <span title={detail}><ProviderIdentityBadge provider="chatgpt" id={account?.id||assignedId||undefined} label={account?.label||undefined} disconnected={account?.disconnected}/></span>;
}
