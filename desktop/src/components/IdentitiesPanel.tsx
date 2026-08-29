import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Github, Link2, ShieldCheck, X } from "lucide-react";
import { api } from "../lib/api";
import type { GithubAuthStatus, GithubDeviceFlow, Identity, Repository } from "../types";

const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=read:user,user:email&description=GitCerberus";

type Props = { identities: Identity[]; repositories: Repository[]; inferredOwner?: string; pendingRepositoryId?: string; onClose: () => void; onChanged: () => Promise<void>; };

export function IdentitiesPanel({ identities, repositories, inferredOwner, pendingRepositoryId, onClose, onChanged }: Props) {
  const [step, setStep] = useState(inferredOwner ? 1 : 0);
  const [status, setStatus] = useState<GithubAuthStatus>({ browserSignIn: false, githubCli: false });
  const [statusReady, setStatusReady] = useState(false);
  const [flow, setFlow] = useState<GithubDeviceFlow>();
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const autoStarted = useRef(false);

  useEffect(() => {
    api.githubAuthStatus().then((next) => { setStatus(next); setStatusReady(true); }).catch(() => setStatusReady(true));
  }, []);

  async function connected(identity: Identity, extra = "") {
    if (pendingRepositoryId) await api.assignIdentity(pendingRepositoryId, identity.id);
    setMessage(`Signed in as @${identity.providerUsername}${pendingRepositoryId ? ". This repository is now linked to that account." : extra}`);
    setFlow(undefined);
    setToken("");
    await onChanged();
    setStep(2);
  }

  async function connectBrowser() {
    try {
      const next = await api.beginGithubOAuth();
      setFlow(next);
      await api.openExternalUrl(next.verificationUri);
      setMessage("GitHub should now be open. Approve GitCerberus, then come back and select I’ve authorized GitHub.");
    } catch (e) { setMessage(String(e)); }
  }

  async function completeBrowser() {
    if (!flow) return;
    try {
      const identity = await api.completeGithubOAuth(flow.clientId ?? "", flow.deviceCode);
      if (!identity) setMessage("GitHub is still waiting. Finish the prompt in the browser, then try again.");
      else await connected(identity, ". Next, match your repositories to this account.");
    } catch (e) { setMessage(String(e)); }
  }

  async function connectCli() {
    try { await connected(await api.importGithubCliIdentity(), " using your GitHub CLI session."); }
    catch (e) { setMessage(String(e)); }
  }

  async function connectToken() {
    try { await connected(await api.completeGithubToken(token.trim())); }
    catch (e) { setMessage(String(e)); }
  }

  useEffect(() => {
    if (!inferredOwner || !statusReady || autoStarted.current) return;
    autoStarted.current = true;
    setStep(1);
    setMessage(`This repository looks like it belongs to GitHub user “${inferredOwner}”. Sign in with that account so commits and the hosted page stay together.`);
    if (status.browserSignIn) void connectBrowser();
  }, [inferredOwner, statusReady, status.browserSignIn]);

  const steps = ["How it works", "Sign in", "Match repos"];

  return <div className="panel-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="identities-panel">
      <header>
        <div><p>Identity routing</p><h2>Who should this code belong to?</h2></div>
        <button onClick={onClose}><X /></button>
      </header>
      <ol className="wizard-steps">
        {steps.map((label, index) => <li key={label}><button type="button" className={step === index ? "active" : step > index ? "done" : ""} onClick={() => setStep(index)}><span>{index + 1}</span>{label}</button></li>)}
      </ol>

      {step === 0 && <>
        <p className="panel-copy">If you use more than one GitHub account—say work and personal—Git needs to know which one a repository belongs to. GitCerberus remembers that choice so you do not accidentally commit, push, or open the wrong profile.</p>
        <div className="wizard-cards">
          <article><ShieldCheck /><h3>An identity is a person-at-work</h3><p>It is a Git author name, email, and GitHub login kept together. Assign one identity to each repository.</p></article>
          <article><Github /><h3>Sign in once per account</h3><p>GitHub does not allow apps to log in with only a username. You approve GitCerberus in the browser, reuse GitHub CLI, or paste a token. You do not create your own OAuth app.</p></article>
          <article><Link2 /><h3>Then match your folders</h3><p>Work repos get the work identity. Personal repos get the personal one. You can change this later from any repository’s configuration.</p></article>
        </div>
        {inferredOwner && <p className="oauth-message">The folder you just added looks like it is owned by <b>{inferredOwner}</b> on GitHub. The next step signs that account in.</p>}
      </>}

      {step === 1 && <>
        <p className="panel-copy">Sign in with each GitHub account you actually use. Repeat this step for work and personal logins. GitCerberus stores the token in this computer’s password manager.</p>
        <div className="sign-in-actions">
          <button type="button" className="primary" disabled={!status.browserSignIn} onClick={connectBrowser}><Github />Sign in with GitHub</button>
          <button type="button" disabled={!status.githubCli} onClick={connectCli}>Use GitHub CLI session</button>
        </div>
        {!status.browserSignIn && <p className="oauth-message">One-click browser sign-in will appear once GitCerberus is built with its product OAuth client ID. Until then, use GitHub CLI or a personal access token—you still do not register an OAuth app.</p>}
        {!status.githubCli && <p className="oauth-message">GitHub CLI is optional. If you already run <code>gh auth login</code> on this machine, that session can be reused here.</p>}
        {flow && <div className="device-code">
          <span>If GitHub asks for a code, enter</span>
          <strong>{flow.userCode}</strong>
          <button onClick={completeBrowser}>I’ve authorized GitHub</button>
          <a href={flow.verificationUri} target="_blank">Open GitHub <ExternalLink /></a>
        </div>}
        <label className="token-field">Personal access token
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… or github_pat_…" autoComplete="off" />
        </label>
        <div className="sign-in-actions">
          <button type="button" disabled={!token.trim()} onClick={connectToken}>Connect with token</button>
          <button type="button" onClick={() => void api.openExternalUrl(TOKEN_URL)}>Create a token on GitHub</button>
        </div>
        {message && <p className="oauth-message">{message}</p>}
        <div className="identity-list">
          {!identities.length && <p className="panel-copy">No accounts connected yet.</p>}
          {identities.map((identity) => <div key={identity.id}><Github /><span><b>{identity.label}</b><small>@{identity.providerUsername} · {identity.gitEmail}</small></span><Check className="connected" /></div>)}
        </div>
      </>}

      {step === 2 && <>
        <p className="panel-copy">Choose which signed-in account each repository should use. Unassigned repositories will not know which Git author or GitHub profile to apply. You can also set this later by double-clicking a repository.</p>
        {!identities.length && <p className="oauth-message">Sign in on the previous step before matching repositories.</p>}
        <div className="association-list">{repositories.map((repo) => <label key={repo.id}>
          <span>{repo.displayName}<small>{repo.canonicalRemote ?? repo.localPath}</small></span>
          <select value={repo.identity?.id ?? ""} onChange={async (e) => { await api.assignIdentity(repo.id, e.target.value); await onChanged(); }}>
            <option value="">Unassigned</option>
            {identities.map((identity) => <option key={identity.id} value={identity.id}>{identity.label}</option>)}
          </select>
        </label>)}</div>
      </>}

      <footer className="wizard-nav">
        <button type="button" disabled={step === 0} onClick={() => setStep((value) => value - 1)}><ChevronLeft size={16} />Back</button>
        {step < 2 ? <button type="button" className="primary" onClick={() => setStep((value) => value + 1)}>Continue<ChevronRight size={16} /></button> : <button type="button" className="primary" onClick={onClose}>Done</button>}
      </footer>
    </section>
  </div>;
}
