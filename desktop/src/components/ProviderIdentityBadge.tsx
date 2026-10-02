import { Github } from 'lucide-react';
import { OpenAILogo } from './OpenAILogo';
import { ClaudeIcon, CursorIcon } from './Icons';
import { useIdentityInitials } from '../lib/identityInitials';

export type IdentityProvider='chatgpt'|'cursor'|'claude'|'github';
export function ProviderIdentityBadge({provider,id,label,disconnected=false}:{provider:IdentityProvider;id?:string;label?:string;disconnected?:boolean}){
 const initials=useIdentityInitials(id||'',label||'');
 const icon={chatgpt:<OpenAILogo/>,cursor:<CursorIcon/>,claude:<ClaudeIcon/>,github:<Github/>}[provider];
 return <span className={`provider-identity-badge ${provider}${disconnected?' disconnected':''}`} aria-label={label?`${provider} account: ${label}`:provider} title={label}>
  {icon}{id && label && <span className="provider-identity-initials" aria-hidden="true">{initials}</span>}
 </span>;
}
