import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, HelpCircle, Plus, Copy, ExternalLink, Github, Link2, PlugZap, ShieldCheck, Unplug, X } from "lucide-react";
import { api } from "../lib/api";
import type { GithubAuthStatus, GithubDeviceFlow, Identity } from "../types";

type Props = { identities: Identity[]; inferredOwner?: string; pendingRepositoryId?: string; onClose: () => void; onChanged: () => Promise<void>; };

export function IdentitiesPanel({ identities, inferredOwner, pendingRepositoryId, onClose, onChanged }: Props) {
  const [showSignIn, setShowSignIn] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [status, setStatus] = useState<GithubAuthStatus>({ browserSignIn: false, githubCli: false });
  const [statusReady, setStatusReady] = useState(false);
  const [flow, setFlow] = useState<GithubDeviceFlow>();
  const [codeCopied, setCodeCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string>();
  const addMenu = useRef<HTMLDivElement>(null);
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
    setShowSignIn(false);
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
    if (!inferredOwner || !statusReady || autoStarted.current) return;
    autoStarted.current = true;
    setShowSignIn(true);
    setMessage(`This repository looks like it belongs to GitHub user “${inferredOwner}”. Sign in with that account so commits and the hosted page stay together.`);
    if (status.browserSignIn) void connectBrowser();
  }, [inferredOwner, statusReady, status.browserSignIn]);

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

  useEffect(() => {
    if (!showSignIn) return;
    const dismiss = (event: MouseEvent) => { if (!addMenu.current?.contains(event.target as Node)) setShowSignIn(false); };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [showSignIn]);

  return <section className="identities-page">
    <header>
      <div><p>Workspace</p><h1>Your identities</h1></div>
      <div className="header-actions">
        <button type="button" onClick={() => setShowHelp(true)}><HelpCircle size={17} />How it works</button>
        <div className="add-identity" ref={addMenu}>
          <button type="button" className="import" aria-expanded={showSignIn} aria-controls="identity-sign-in" onClick={() => setShowSignIn(!showSignIn)}><Plus size={17} />Add identity<ChevronDown size={15} /></button>
          {showSignIn && <div id="identity-sign-in" className="identity-sign-in" onKeyDown={(event) => { if (event.key === "Escape") setShowSignIn(false); }}>
            <button type="button" disabled={!statusReady || !status.browserSignIn || !!flow} onClick={connectBrowser}><Github size={18} />Sign in with GitHub</button>
            {!statusReady ? <p className="panel-copy">Checking sign-in availability…</p> : !status.browserSignIn && <p className="panel-copy">GitHub sign-in is unavailable because this build has no product OAuth client ID.</p>}
          </div>}
        </div>
      </div>
    </header>
    <p className="panel-copy">Repositories accessible to your connected GitHub accounts appear automatically. Use Assign account on a repository’s action tray to match it to an identity.</p>
    <div className="identity-list">
      {!identities.length && <div className="identity-empty"><ShieldCheck /><span><b>No identities yet</b><small>Add an identity to connect your GitHub account.</small></span></div>}
      {identities.map((identity) => {
        const connectedAccount = identity.connected !== false;
        return <div key={identity.id}>
          <Github style={{ color: identity.color }} />
          <span><b>{identity.label}</b><small>{identity.providerUsername ? `@${identity.providerUsername} · ` : ""}{identity.gitEmail}</small></span>
          <div className="identity-actions">
            <span className={connectedAccount ? "connected" : "disconnected"}>{connectedAccount ? <><Check size={16} />Connected</> : "Disconnected"}</span>
            {connectedAccount
              ? <button type="button" disabled={busyId === identity.id || !!flow} onClick={() => void disconnect(identity)}><Unplug size={15} />{busyId === identity.id ? "Disconnecting…" : "Disconnect"}</button>
              : <button type="button" disabled={!!flow || busyId === identity.id} onClick={() => reconnect(identity)}><PlugZap size={15} />Reconnect</button>}
          </div>
        </div>;
      })}
    </div>
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
          <article><ShieldCheck /><h3>Keep your accounts together</h3><p>An identity combines your Git author name, email, and GitHub login.</p></article>
          <article><Github /><h3>Sign in once per account</h3><p>Choose Add identity, then Sign in with GitHub. Approve GitCerberus in your browser, including repository access to list and clone private repositories. Disconnect an account to remove its token from this computer, or Reconnect if private repositories are missing. Repeat for each account you use. Tokens are stored in this computer’s password manager.</p></article>
          <article><Link2 /><h3>Match your repositories</h3><p>Open a repository’s action tray and press Assign account to choose a connected GitHub identity. Use your work identity for work repositories and your personal identity for personal ones.</p></article>
        </div>
      </section>
    </div>}
  </section>;
}
