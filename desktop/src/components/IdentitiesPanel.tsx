import { IdentityCard, IdentityOrderContext } from './IdentityCard';
import { useCardReorder } from '../lib/cardReorder';
import { useChatgptAccounts } from '../lib/chatgptAccounts';
import { externalProviders, useExternalIdentities } from '../lib/externalIdentities';
import { ExternalIdentityCards, externalLogin } from './ExternalIdentityCards';
import { ChatgptIdentityCards, ChatgptSettings } from './ChatgptIdentities';
import { IdentitySignIn } from './IdentitySignIn';
import { ProviderIdentityBadge } from './ProviderIdentityBadge';
import { CopilotQuota, type CopilotQuotaResponse } from './CopilotQuota';
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Check, HelpCircle, Copy, ExternalLink, Github, Link2, PlugZap, ShieldCheck, Unplug, X } from "lucide-react";
import { api, inTauri } from "../lib/api";
import { useProviderPreferences } from "../lib/providerPreferences";
import { invoke } from '@tauri-apps/api/core';
import type { GithubAuthStatus, GithubDeviceFlow, Identity } from "../types";

type Props = { identities: Identity[]; inferredOwner?: string; pendingRepositoryId?: string; startGithubLogin?: boolean; startExternalLogin?: 'cursor'|'claude'; onClose: () => void; onChanged: () => Promise<void>; };
function GithubUsage({identity}:{identity:Identity}){
  const [usage,setUsage]=useState<CopilotQuotaResponse>();
  const [error,setError]=useState('');
  useEffect(()=>{if(identity.connected===false || !inTauri())return;let live=true;void invoke<CopilotQuotaResponse>('copilot_repository_snapshot',{identityId:identity.id,repository:''}).then(result=>{if(live){setUsage(result);setError('');}}).catch(reason=>{if(live)setError(String(reason));});return()=>{live=false;};},[identity.id,identity.connected]);
  return <div className="identity-usage"><CopilotQuota usage={usage}/>{error && <small role="status">{error}</small>}<button type="button" className="identity-usage-link" title={`Opens your browser. Check that @${identity.providerUsername||identity.label} is the signed-in account.`} onClick={()=>void api.openExternalUrl('https://github.com/settings/copilot')}>Open Copilot usage</button></div>;
}

function GithubDeviceDialog({ flow, copied, onCopy, onCancel }: { flow: GithubDeviceFlow; copied: boolean; onCopy: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.shell');
    const opener = document.activeElement as HTMLElement | null;
    shell?.setAttribute('inert', '');
    dialog.current?.querySelector<HTMLElement>('input')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); cancel.current(); return; }
      if (event.key !== 'Tab') return;
      const items = [...dialog.current?.querySelectorAll<HTMLElement>('button, input') ?? []];
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); shell?.removeAttribute('inert'); opener?.focus(); };
  }, []);
  return createPortal(<div className="provider-overlay"><section ref={dialog} className="provider-dialog github-device-dialog" role="dialog" aria-modal="true" aria-labelledby="github-device-title" tabIndex={-1}>
    <header><h2 id="github-device-title">Enter this code on GitHub</h2></header>
    <div className="provider-dialog-content">
      <p>GitHub is open in your browser. Enter this code there and approve GitCerberus. This dialog closes when GitHub accepts the sign-in.</p>
      <div className="device-code-controls">
        <input value={flow.userCode} readOnly aria-label="GitHub device code" />
        <button type="button" className={copied ? "copied" : ""} onClick={onCopy} title={copied ? "Copied to clipboard." : "Copy the code."} aria-label="Copy GitHub device code"><Copy /></button>
      </div>
      <p role="status">Waiting for GitHub authorization…</p>
    </div>
    <footer>
      <button type="button" onClick={() => void api.openExternalUrl(flow.verificationUri)}>Open GitHub <ExternalLink /></button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </footer>
  </section></div>, document.body);
}

export function IdentitiesPanel({ identities, inferredOwner, pendingRepositoryId, startGithubLogin, startExternalLogin, onClose, onChanged }: Props) {
  const chatgptAccounts=useChatgptAccounts();
  const externalAccounts=useExternalIdentities();
  const [identityOrder,setIdentityOrder]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem('gitcerberus.identityCardOrder')||'[]');}catch{return [];}});
  const allCardIds=[...chatgptAccounts.profiles.filter(account=>account.subscription).map(account=>account.id),...externalProviders.flatMap(provider=>externalAccounts.identities.filter(account=>account.provider===provider.id).slice(0,1).map(account=>account.id)),...identities.map(identity=>identity.id)];
  const orderedCardIds=[...allCardIds].sort((a,b)=>{
    const left=identityOrder.indexOf(a),right=identityOrder.indexOf(b);
    return (left<0?Number.MAX_SAFE_INTEGER:left)-(right<0?Number.MAX_SAFE_INTEGER:right);
  });
  const reorderCards=useCardReorder(orderedCardIds,ids=>{setIdentityOrder(ids);localStorage.setItem('gitcerberus.identityCardOrder',JSON.stringify(ids));});
  const [, setProviderEnabled] = useProviderPreferences();
  const [showHelp, setShowHelp] = useState(false);
  const [status, setStatus] = useState<GithubAuthStatus>({ browserSignIn: false, githubCli: false });
  const [statusReady, setStatusReady] = useState(false);
  const [flow, setFlow] = useState<GithubDeviceFlow>();
  const [codeCopied, setCodeCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string>();
  const helpDialog = useRef<HTMLElement>(null);
  const autoStarted = useRef(false);
  const authAttempt = useRef(0);
  const reconnecting = useRef<Identity>();

  useEffect(() => {
    api.githubAuthStatus().then((next) => { setStatus(next); setStatusReady(true); }).catch(() => setStatusReady(true));
  }, []);

  async function connected(identity: Identity, extra = "") {
    if (pendingRepositoryId) await api.assignIdentity(pendingRepositoryId, identity.id);
    const expected = reconnecting.current;
    const switched = expected?.providerUsername && identity.providerUsername && expected.providerUsername.toLowerCase() !== identity.providerUsername.toLowerCase();
    setProviderEnabled('copilot', true);
    setMessage(switched
      ? `Signed in as @${identity.providerUsername}. Copilot uses this GitHub account. @${expected.providerUsername} is still disconnected; reconnect that account separately if you still need it.`
      : `Signed in as @${identity.providerUsername}. Copilot uses this GitHub account.${pendingRepositoryId ? " This repository is now linked to that account." : extra}`);
    reconnecting.current = undefined;
    setFlow(undefined);
    await onChanged();
  }

  async function connectBrowser() {
    const attempt = ++authAttempt.current;
    try {
      const next = await api.beginGithubOAuth();
      if (authAttempt.current !== attempt) return;
      setFlow(next);
      setCodeCopied(false);
      await api.openExternalUrl(next.verificationUri);
      const target = reconnecting.current;
      setMessage(target
        ? `GitHub should now be open. Approve GitCerberus as ${target.providerUsername ? `@${target.providerUsername}` : target.label} to restore access.`
        : "GitHub should now be open. Approve GitCerberus there; this screen will finish signing you in automatically.");
      const deadline = Date.now() + next.expiresIn * 1000;
      const interval = Math.max(next.interval, 5) * 1000;
      while (authAttempt.current === attempt && Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, interval));
        if (authAttempt.current !== attempt) return;
        const identity = await api.completeGithubOAuth(next.clientId ?? "", next.deviceCode);
        if (authAttempt.current !== attempt) return;
        if (identity) {
          await connected(identity, ". Next, match your repositories to this account.");
          authAttempt.current++;
          return;
        }
      }
      if (authAttempt.current === attempt) {
        setFlow(undefined);
        reconnecting.current = undefined;
        setMessage("The GitHub authorization expired. Select Sign in with GitHub to try again.");
      }
    } catch (e) {
      if (authAttempt.current === attempt) {
        setFlow(undefined);
        reconnecting.current = undefined;
        setMessage(String(e));
      }
    }
  }

  useEffect(() => () => { authAttempt.current++; }, []);

  async function disconnect(identity: Identity) {
    const name = identity.providerUsername ? `@${identity.providerUsername}` : identity.label;
    if (!window.confirm(`Disconnect ${name}? GitHub access is removed from this computer. Assigned repositories stay associated until you reconnect.`)) return;
    setBusyId(identity.id);
    try {
      await api.disconnectGithubIdentity(identity.id);
      setMessage(`Disconnected ${name}. Reconnect to list private repositories and clone with this account.`);
      await onChanged();
    } catch (error) { setMessage(String(error)); }
    finally { setBusyId(undefined); }
  }

  function reconnect(identity: Identity) {
    if (!status.browserSignIn) {
      setMessage("GitHub sign-in is unavailable because this build has no product OAuth client ID.");
      return;
    }
    reconnecting.current = identity;
    void connectBrowser();
  }

  async function copyDeviceCode() {
    if (!flow) return;
    try {
      await navigator.clipboard.writeText(flow.userCode);
      setCodeCopied(true);
    } catch (e) { setMessage(`Could not copy the code: ${String(e)}`); }
  }

  useEffect(() => {
    if (!(inferredOwner || startGithubLogin) || !statusReady || autoStarted.current) return;
    autoStarted.current = true;
    if(inferredOwner)setMessage(`This repository looks like it belongs to GitHub user “${inferredOwner}”. Sign in with that account so commits and the hosted page stay together.`);
    if (status.browserSignIn) void connectBrowser();
  }, [inferredOwner, startGithubLogin, statusReady, status.browserSignIn]);

  useEffect(() => {
    if (!showHelp) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowHelp(false);
      if (event.key === "Tab") { event.preventDefault(); helpDialog.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previousFocus?.focus(); };
  }, [showHelp]);

  return <section className="identities-page">
    <header>
      <div><p>Workspace</p><h1>Your identities</h1></div>
      <div className="header-actions">
        <button type="button" onClick={() => setShowHelp(true)}><HelpCircle size={17} />How it works</button>
        <IdentitySignIn onExternalLogin={externalLogin} github={{onClick: () => { void connectBrowser(); }, disabled: !statusReady || !status.browserSignIn || !!flow, message: !statusReady ? 'Checking sign-in availability…' : !status.browserSignIn ? 'GitHub sign-in is unavailable because this build has no product OAuth client ID.' : undefined}} />
      </div>
    </header>
    <IdentityOrderContext.Provider value={{reorder:reorderCards,position:id=>orderedCardIds.indexOf(id)}}><div className="identity-list"><ChatgptIdentityCards/><ExternalIdentityCards startLogin={startExternalLogin}/>
      {identities.map((identity) => {
        const connectedAccount = identity.connected !== false;
        return <IdentityCard key={identity.id} icon={<ProviderIdentityBadge provider="github" id={identity.id} label={identity.label}/>} label={identity.label} detail={`${identity.providerUsername ? `@${identity.providerUsername} · ` : ""}${identity.gitEmail}`} initialsId={identity.id} connected={connectedAccount} busy={busyId === identity.id || !!flow} onConnect={()=>reconnect(identity)} onDisconnect={()=>void disconnect(identity)}><GithubUsage identity={identity}/></IdentityCard>;
      })}
    </div></IdentityOrderContext.Provider>
    <ChatgptSettings/>
    {flow && <GithubDeviceDialog flow={flow} copied={codeCopied} onCopy={() => void copyDeviceCode()} onCancel={() => { authAttempt.current++; reconnecting.current = undefined; setFlow(undefined); setMessage('GitHub sign-in was cancelled.'); }} />}
    {message && <p className="oauth-message" role="status">{message}</p>}
    {pendingRepositoryId && <button type="button" className="identity-back" onClick={onClose}>Back to repositories</button>}
    {showHelp && <div className="panel-backdrop dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowHelp(false); }}>
      <section ref={helpDialog} className="repo-config" role="dialog" aria-modal="true" aria-labelledby="identity-help-title">
        <header><h2 id="identity-help-title">How identities work</h2><button type="button" autoFocus aria-label="Close help" onClick={() => setShowHelp(false)}><X /></button></header>
        <div className="wizard-cards">
          <article><ShieldCheck /><h3>Keep your accounts together</h3><p>GitHub identities control Git access and authorship. ChatGPT supplies Codex access. Cursor and Claude identities use their local CLI sign-ins for editor delegation.</p></article>
          <article><Github /><h3>Sign in once per account</h3><p>Choose Add identity, then Sign in with GitHub. Approve GitCerberus in your browser, including repository access to list and clone private repositories. Disconnect an account to remove its token from this computer, or Reconnect if private repositories are missing. Repeat for each account you use. Tokens are stored in this computer’s password manager.</p></article>
          <article><Link2 /><h3>Match your repositories</h3><p>Open a repository’s action tray to assign its GitHub, ChatGPT, Cursor, and Claude accounts. Copilot usage for a connected GitHub account stays on this page.</p></article>
        </div>
      </section>
    </div>}
  </section>;
}
