import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogIn } from 'lucide-react';
import { ProviderIdentityBadge } from './ProviderIdentityBadge';
import { externalProviders } from '../lib/externalIdentities';
import { openChatgptLogin } from './ChatgptIdentities';

/** The same provider chooser is used wherever an agent identity can be added. */
export function IdentitySignIn({ github, onExternalLogin }: { github?: { onClick: () => void; disabled: boolean; message?: string }; onExternalLogin?: (provider:'cursor'|'claude')=>void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="add-identity" ref={container}>
    <button type="button" className="identity-sign-in-trigger" aria-label="Sign in" title="Add identity" aria-expanded={open} onClick={() => setOpen(!open)}><LogIn size={17}/><ChevronDown size={15}/></button>
    {open && <div className="identity-sign-in">
      <button type="button" onClick={() => { setOpen(false); openChatgptLogin(); }}><ProviderIdentityBadge provider="chatgpt"/>Sign in with ChatGPT</button>
      {externalProviders.map(provider => <button type="button" key={provider.id} onClick={() => { setOpen(false); if(onExternalLogin)onExternalLogin(provider.id);else window.dispatchEvent(new CustomEvent('show-identities',{detail:{externalLogin:provider.id}})); }}><ProviderIdentityBadge provider={provider.id}/>Sign in with {provider.label}</button>)}
      <button type="button" disabled={github?.disabled} onClick={() => { setOpen(false); if(github)github.onClick();else window.dispatchEvent(new CustomEvent('show-identities',{detail:{githubLogin:true}})); }}><ProviderIdentityBadge provider="github"/>Sign in with GitHub</button>{github?.message && <p className="panel-copy">{github.message}</p>}
    </div>}
  </div>;
}
