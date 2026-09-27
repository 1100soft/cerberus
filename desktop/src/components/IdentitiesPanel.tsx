import { IdentityCard } from './IdentityCard';
import { ExternalIdentityCards, externalLogin } from './ExternalIdentityCards';
import { ChatgptIdentityCards, ChatgptSettings } from './ChatgptIdentities';
import { IdentitySignIn } from './IdentitySignIn';
import { ProviderIdentityBadge } from './ProviderIdentityBadge';
import { CopilotQuota, type CopilotQuotaResponse } from './CopilotQuota';
import { useEffect, useRef, useState } from "react";
import { Check, HelpCircle, Copy, ExternalLink, Github, Link2, PlugZap, ShieldCheck, Unplug, X } from "lucide-react";
import { api, inTauri } from "../lib/api";
import { invoke } from '@tauri-apps/api/core';
import type { GithubAuthStatus, GithubDeviceFlow, Identity } from "../types";

type Props = { identities: Identity[]; inferredOwner?: string; pendingRepositoryId?: string; startGithubLogin?: boolean; startExternalLogin?: 'cursor'|'claude'; onClose: () => void; onChanged: () => Promise<void>; };
function GithubUsage({identity}:{identity:Identity}){
  const [usage,setUsage]=useState<CopilotQuotaResponse>();
  const [error,setError]=useState('');
  useEffect(()=>{if(identity.connected===false || !inTauri())return;let live=true;void invoke<CopilotQuotaResponse>('copilot_repository_snapshot',{identityId:identity.id,repository:''}).then(result=>{if(live){setUsage(result);setError('');}}).catch(reason=>{if(live)setError(String(reason));});return()=>{live=false;};},[identity.id,identity.connected]);
  return <div className="identity-usage"><CopilotQuota usage={usage}/>{error && <small role="status">{error}</small>}<button type="button" className="identity-usage-link" title={`Opens your browser. Check that @${identity.providerUsername||identity.label} is the signed-in account.`} onClick={()=>void api.openExternalUrl('https://github.com/settings/copilot')}>Open Copilot usage</button></div>;
}

export function IdentitiesPanel({ identities, inferredOwner, pendingRepositoryId, startGithubLogin, startExternalLogin, onClose, onChanged }: Props) {
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
    setMessage(switched
      ? `Signed in as @${identity.providerUsername}. @${expected.providerUsername} is still disconnected; reconnect that account separately if you still need it.`
      : `Signed in as @${identity.providerUsername}${pendingRepositoryId ? ". This repository is now linked to that account." : extra}`);
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
    <div className="identity-list"><ChatgptIdentityCards/><ExternalIdentityCards startLogin={startExternalLogin}/>
      {identities.map((identity) => {
        const connectedAccount = identity.connected !== false;
        return <IdentityCard key={identity.id} icon={<ProviderIdentityBadge provider="github" id={identity.id} label={identity.label}/>} label={identity.label} detail={`${identity.providerUsername ? `@${identity.providerUsername} · ` : ""}${identity.gitEmail}`} initialsId={identity.id} connected={connectedAccount} busy={busyId === identity.id || !!flow} onConnect={()=>reconnect(identity)} onDisconnect={()=>void disconnect(identity)}><GithubUsage identity={identity}/></IdentityCard>;
      })}
    </div>
    <ChatgptSettings/>
    {flow && <div className="device-code">
      <span>Enter this code on GitHub</span>
      <div className="device-code-controls">
        <input value={flow.userCode} readOnly aria-label="GitHub device code" />
        <button type="button" className={codeCopied ? "copied" : ""} onClick={copyDeviceCode} title={codeCopied ? "Copied to clipboard." : "Copy the code."} aria-label="Copy GitHub device code"><Copy /></button>
      </div>
      <span className="device-code-status">Waiting for GitHub authorization…</span>
      <a href={flow.verificationUri} target="_blank" rel="noreferrer">Open GitHub <ExternalLink /></a>
    </div>}
    {message && <p className="oauth-message" role="status">{message}</p>}
    {pendingRepositoryId && <button type="button" className="identity-back" onClick={onClose}>Back to repositories</button>}
    {showHelp && <div className="panel-backdrop dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowHelp(false); }}>
      <section ref={helpDialog} className="repo-config" role="dialog" aria-modal="true" aria-labelledby="identity-help-title">
        <header><h2 id="identity-help-title">How identities work</h2><button type="button" autoFocus aria-label="Close help" onClick={() => setShowHelp(false)}><X /></button></header>
        <div className="wizard-cards">
          <article><ShieldCheck /><h3>Keep your accounts together</h3><p>GitHub identities control Git access and authorship. ChatGPT supplies Codex access. Cursor and Claude identities use their local CLI sign-ins for editor delegation.</p></article>
          <article><Github /><h3>Sign in once per account</h3><p>Choose Add identity, then Sign in with GitHub. Approve GitCerberus in your browser, including repository access to list and clone private repositories. Disconnect an account to remove its token from this computer, or Reconnect if private repositories are missing. Repeat for each account you use. Tokens are stored in this computer’s password manager.</p></article>
          <article><Link2 /><h3>Match your repositories</h3><p>Open a repository’s action tray to assign its GitHub, ChatGPT, Cursor, and Claude accounts. GitHub controls Git access and Copilot information for that repository.</p></article>
        </div>
      </section>
    </div>}
  </section>;
}
