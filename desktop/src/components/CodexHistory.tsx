import { memo, startTransition, useEffect, useLayoutEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { cursorDisplayText } from "../lib/conversationText";
import { MessageSquare, RefreshCw } from "lucide-react";
import { SetupTerminal } from "./SetupTerminal";
import { api } from "../lib/api";
import type { CodexAccount, CodexMessage, CodexThread, Repository } from "../types";

export function CodexHistory({ repository, unlinkedName }: { repository?: Repository; unlinkedName?: string }) {
  const [showSetup, setShowSetup] = useState<Provider | "choose" | null>(null);
  const [settings, setSettings] = useState<Partial<Record<Provider, boolean>>>(() => {
    try { const saved = JSON.parse(localStorage.getItem("gitcerberus.providers") || "{}"); return Object.fromEntries(providers.filter(p => typeof saved[p] === "boolean").map(p => [p, saved[p]])); } catch { return {}; }
  });
  const enabled = providers.filter(provider => settings[provider] === true);
  const enable = (provider: Provider) => setSettings(current => ({ ...current, [provider]: true }));
  useEffect(() => { localStorage.setItem("gitcerberus.providers", JSON.stringify(settings)); }, [settings]);
  const [choosing, setChoosing] = useState(false);
  const [account, setAccount] = useState<CodexAccount>();
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loginId, setLoginId] = useState<string>();
  const [starting, setStarting] = useState(false);
  const mounted = useRef(true);
  const pendingLogin = useRef<string>();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pendingLogin.current) void api.codexCancelLogin(pendingLogin.current).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (showSetup !== "codex") { setChecking(false); return; }
    let active = true;
    setChecking(true); setError("");
    api.codexAccount().then((next) => { if (active) { setAccount(next); enable("codex"); setShowSetup(null); } })
      .catch((error) => { if (active) { setError(String(error)); setAccount(undefined); } })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [revision, showSetup]);

  useEffect(() => {
    if (!loginId) return;
    let active = true;
    let timer: number;
    const deadline = Date.now() + 180000;
    async function poll() {
      try {
        const next = await api.codexAccount();
        if (!active) return;
        setAccount(next);
        if (next.account) { pendingLogin.current = undefined; setLoginId(undefined); enable("codex"); setShowSetup(null); setRevision((value) => value + 1); return; }
        if (Date.now() >= deadline) {
          await api.codexCancelLogin(loginId!);
          if (!active) return;
          pendingLogin.current = undefined; setLoginId(undefined); setError("Sign-in timed out. Try connecting again."); return;
        }
        timer = window.setTimeout(poll, 3000);
      } catch (error) { if (active) { setError(String(error)); setLoginId(undefined); } }
    }
    timer = window.setTimeout(poll, 1500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [loginId]);

  async function finishCodexSetup() {
    setAccount(await api.codexAccount());
    enable("codex"); setShowSetup(null); setRevision(value => value + 1);
  }

  async function login() {
    setStarting(true); setError("");
    try {
      const id = await api.codexLogin();
      if (!mounted.current) { await api.codexCancelLogin(id); return; }
      pendingLogin.current = id; setLoginId(id);
    } catch (error) { if (mounted.current) setError(String(error)); }
    finally { if (mounted.current) setStarting(false); }
  }

  return <section className="codex-panel" aria-label="Agent conversations">
    <header><div><p>OpenAI · Codex</p><h2><MessageSquare size={18} />Conversations{(repository?.displayName || unlinkedName) ? ` · ${repository?.displayName || unlinkedName}` : ""}</h2></div><div className="codex-actions">
      <button type="button" aria-expanded={!!showSetup} onClick={() => setShowSetup(showSetup ? null : "choose")}>{showSetup ? "Close setup" : "Add provider"}</button>
      {showSetup === "codex" && account?.account && <span>{account.account.email || "Codex connected"}</span>}
      {settings.codex !== undefined && account && !account.account && !loginId && <button type="button" disabled={starting} onClick={login}>{starting ? "Opening sign-in…" : "Sign in with ChatGPT"}</button>}
      <button type="button" aria-label="Refresh conversations" disabled={checking || starting || !!loginId} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={16} className={checking ? "spin" : ""} /></button>
    </div></header>
    <div className="codex-body">
    <p className="panel-copy">Local Codex and Cursor sessions for this repository. Select a conversation to read its messages.</p>
    {showSetup === "choose" && <div className="provider-picker"><p>Choose a provider to set up.</p>{providers.map(provider => <button key={provider} type="button" onClick={() => setShowSetup(provider)}>{providerName(provider)}{settings[provider] !== undefined ? " · configured" : ""}</button>)}</div>}
    {showSetup === "codex" && checking && <p className="panel-copy" role="status">Connecting to Codex…</p>}
    {showSetup === "codex" && <div className="codex-setup">
      <h3>Connect Codex to GitCerberus</h3>
      <SetupTerminal provider="codex" onInstalled={finishCodexSetup} />
      <ol>
        <li>Install the Codex CLI. With Node.js and npm installed, run <code>npm install -g @openai/codex</code> in a terminal.</li>
        <li>Run <code>codex --version</code> to check the installation. If Codex is already installed but this app cannot find it, use <b>Choose Codex executable</b> below. On macOS/Linux, <code>command -v codex</code> prints its location; on Windows, use <code>where.exe codex</code>.</li>
        <li>Click <b>Retry connection</b>, then <b>Sign in with ChatGPT</b> and finish in your browser. An existing Codex sign-in is reused.</li>
        <li>Start Codex in your repository’s directory to create a conversation, then refresh this panel. Sessions from other directories do not appear here.</li>
      </ol>
      <p>GitCerberus remembers the executable you choose, including when launched from the desktop. Choose the native <code>codex</code> or <code>codex.exe</code> file.</p>
      <div className="codex-actions"><button type="button" disabled={choosing || starting || !!loginId} onClick={async () => {
        setChoosing(true);
        try { if (await api.chooseCodexExecutable()) await finishCodexSetup(); }
        catch (error) { setError(String(error)); }
        finally { setChoosing(false); }
      }}>{choosing ? "Checking executable…" : "Choose Codex executable"}</button>
      <button type="button" disabled={checking || choosing} onClick={() => setRevision((value) => value + 1)}>Retry connection</button></div>
    </div>}
    {showSetup === "cursor" && <CursorSetup repository={repository} onConfigured={() => { enable("cursor"); setShowSetup(null); setRevision(value => value + 1); }} />}
    {showSetup === "codex" && error && <details className="config-error"><summary>Codex connection details</summary><p role="alert">{error}</p></details>}
    {loginId && <p className="panel-copy" role="status">Finish signing in in your browser. <button type="button" onClick={async () => {
      try { await api.codexCancelLogin(loginId); pendingLogin.current = undefined; setLoginId(undefined); }
      catch (error) { setError(String(error)); }
    }}>Cancel sign-in</button></p>}
    {!showSetup && <div className="provider-controls" aria-label="Conversation providers">{providers.map(provider => <div key={provider} className="provider-control"><label><input type="checkbox" checked={settings[provider] === true} disabled={settings[provider] === undefined} onChange={event => setSettings(current => ({...current, [provider]: event.target.checked}))} /><span className={`provider-badge provider-${provider}`}>{providerName(provider)}</span><small>{settings[provider] === undefined ? "Not added" : "Configured"}</small></label>{settings[provider] !== undefined && <button type="button" aria-label={`Configure ${providerName(provider)}`} onClick={() => setShowSetup(provider)}>Setup</button>}</div>)}</div>}
    {!showSetup && repository && enabled.length > 0 && <ConversationBrowser key={repository.id} repository={repository} revision={revision} enabled={enabled} />}
    {!showSetup && !enabled.length && <p className="panel-copy">{Object.keys(settings).length ? "Check a provider to show its conversations." : "Add a provider to browse its conversations here."}</p>}
    {!repository && <p className="panel-copy">{unlinkedName ? "Link an existing local checkout, or clone a new one, to see its conversations." : "Select a repository to see its conversations."}</p>}
    </div>
  </section>;
}

type Provider = "codex" | "cursor";
type Thread = CodexThread & { provider: Provider; key: string };
const providers: Provider[] = ["codex", "cursor"];
const providerName = (provider: Provider) => provider === "codex" ? "Codex" : "Cursor";
const threadList = (provider: Provider, repositoryId: string, archived: boolean, cursor?: string | null) =>
  provider === "codex" ? api.codexThreads(repositoryId, archived, cursor) : api.cursorThreads(repositoryId, archived, cursor);
const readMessages = (repositoryId: string, key: string, cursor?: string | null) => {
  const separator = key.indexOf(":");
  return key.slice(0, separator) === "codex" ? api.codexMessages(repositoryId, key.slice(separator + 1), cursor) : api.cursorMessages(repositoryId, key.slice(separator + 1));
};
const ordered = (threads: Thread[]) => [...threads].sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));

function CursorSetup({ onConfigured, repository }: { onConfigured: () => void; repository?: Repository }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="codex-setup"><h3>Connect Cursor to GitCerberus</h3><p>Existing Cursor editor history can be connected below without installing the SDK. Install the bridge only for SDK sessions.</p><SetupTerminal provider="cursor" onInstalled={onConfigured} /><ol>
    <li>Install the Cursor SDK bridge with <code>pip install cursor-sdk</code>, or download the standalone bridge from <a href="https://github.com/cursor/sdk-bridge/releases" target="_blank" rel="noreferrer">Cursor’s releases</a>.</li>
    <li>Run <code>cursor-sdk-bridge --help</code> to verify installation. Choose the <code>cursor-sdk-bridge</code> executable below if this desktop app cannot find it. Use <code>command -v cursor-sdk-bridge</code> on macOS/Linux or <code>where.exe cursor-sdk-bridge</code> on Windows to locate it.</li>
    <li>Local history reads do not require an API key. This viewer reads Cursor editor history and SDK sessions. Cloud conversations are not included. Refresh after creating or updating a session in the repository’s directory.</li>
    <li>For authenticated SDK use, create a user API key in the <a href="https://cursor.com/dashboard" target="_blank" rel="noreferrer">Cursor dashboard</a> and set <code>CURSOR_API_KEY</code> in the environment before launching the app. Signing into the Cursor editor alone does not configure the bridge.</li>
  </ol><p>The executable selection is remembered. Alternatively set <code>GITCERBERUS_CURSOR_PATH</code>. Reading history does not send prompts or run agent tools.</p>
    <button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { if (await api.chooseCursorExecutable()) onConfigured(); } catch (error) { setError(String(error)); } finally { setBusy(false); } }}>{busy ? "Checking executable…" : "Choose Cursor bridge executable"}</button>
    <button type="button" disabled={busy || !repository} onClick={async () => { if (!repository) return; setBusy(true); setError(""); try { await api.cursorThreads(repository.id, false); onConfigured(); } catch (error) { setError(String(error)); } finally { setBusy(false); } }}>Connect existing installation</button>
    {!repository && <p>Select a repository to check an existing installation, or choose the bridge executable.</p>}
    {error && <p className="config-error" role="alert">{error}</p>}
  </div>;
}

function ConversationBrowser({ repository, revision, enabled }: { repository: Repository; revision: number; enabled: Provider[] }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [cursors, setCursors] = useState<Partial<Record<Provider, string | null>>>({});
  const enabledKey = enabled.join(",");
  const [selected, setSelected] = useState<string>();
  const [archived, setArchived] = useState(false);
  const messagePane = useRef<HTMLDivElement>(null);
  const scrollIntent = useRef<{ kind: "latest" } | { kind: "older"; height: number; top: number }>();
  const [messageCursor, setMessageCursor] = useState<string | null>();
  const readGeneration = useRef(0);
  const [messages, setMessages] = useState<CodexMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [listError, setListError] = useState("");
  const [readError, setReadError] = useState("");
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true); setListError(""); setCursors({}); setThreads([]); setSelected(undefined);
    Promise.allSettled(enabled.map(async (provider) => ({ provider, page: await threadList(provider, repository.id, archived) }))).then((results) => {
      if (request !== generation.current) return;
      const items: Thread[] = [];
      const next: Partial<Record<Provider, string | null>> = {};
      const errors: string[] = [];
      results.forEach((result, index) => {
        if (result.status === "rejected") { errors.push(`${providerName(enabled[index])}: ${String(result.reason)}`); return; }
        const { provider, page } = result.value;
        items.push(...page.data.map((thread) => ({ ...thread, provider, key: `${provider}:${thread.id}` })));
        next[provider] = page.nextCursor;
      });
      startTransition(() => { setThreads(ordered(items)); setCursors(next); setListError(errors.join("\n")); setLoading(false); });
    });
    return () => { generation.current++; };
  }, [repository.id, archived, revision, enabledKey]);

  useEffect(() => {
    let active = true;
    const request = ++readGeneration.current;
    scrollIntent.current = undefined;
    setMessageCursor(null);
    setMessages([]); setReadError(""); setReading(!!selected);
    if (selected) readMessages(repository.id, selected).then((page) => { if (active && request === readGeneration.current) startTransition(() => { scrollIntent.current = { kind: "latest" }; setMessages(page.data); setMessageCursor(page.nextCursor); }); })
      .catch((error) => { if (active) setReadError(String(error)); })
      .finally(() => { if (active) setReading(false); });
    return () => { active = false; readGeneration.current++; };
  }, [repository.id, selected, revision]);

  useLayoutEffect(() => {
    const pane = messagePane.current;
    const intent = scrollIntent.current;
    if (!pane || !intent || reading) return;
    if (intent.kind === "older") {
      pane.scrollTop = intent.top + pane.scrollHeight - intent.height;
    } else {
      const prompts = pane.querySelectorAll<HTMLElement>(".codex-message.user");
      const latest = prompts[prompts.length - 1];
      pane.scrollTop = latest ? latest.offsetTop : pane.scrollHeight;
    }
    scrollIntent.current = undefined;
  }, [messages, reading]);

  async function moreMessages() {
    if (!selected || reading) return;
    const request = readGeneration.current;
    const previous = { kind: "older" as const, height: messagePane.current?.scrollHeight ?? 0, top: messagePane.current?.scrollTop ?? 0 };
    setReading(true); setReadError("");
    try {
      const page = await readMessages(repository.id, selected, messageCursor);
      if (request !== readGeneration.current) return;
      scrollIntent.current = previous;
      setMessages((items) => [...page.data, ...items]); setMessageCursor(page.nextCursor);
    } catch (error) { if (request === readGeneration.current) setReadError(String(error)); }
    finally { if (request === readGeneration.current) setReading(false); }
  }

  const visible = threads.filter((thread) => enabled.includes(thread.provider));
  useEffect(() => {
    if (!visible.some((thread) => thread.key === selected)) setSelected(visible[0]?.key);
  }, [threads, enabledKey, selected]);

  async function more(provider: Provider) {
    const request = generation.current;
    setLoading(true);
    try {
      const page = await threadList(provider, repository.id, archived, cursors[provider]);
      if (request !== generation.current) return;
      setThreads((current) => ordered([...current, ...page.data.map((thread) => ({ ...thread, provider, key: `${provider}:${thread.id}` })).filter((thread) => !current.some((item) => item.key === thread.key))]));
      setCursors((current) => ({ ...current, [provider]: page.nextCursor }));
    } catch (error) { if (request === generation.current) setListError(`${providerName(provider)}: ${String(error)}`); }
    finally { if (request === generation.current) setLoading(false); }
  }

  return <>
    <div className="conversation-filters"><label className="codex-archive"><input type="checkbox" checked={archived} onChange={(event) => { setSelected(undefined); setArchived(event.target.checked); }} />Archived conversations</label></div>
    {listError && <details className="config-error provider-errors"><summary>A configured provider is unavailable · retry or adjust its setup</summary><p role="alert">{listError}</p></details>}
    <div className="codex-conversations">
      <div className="codex-thread-list" aria-label="Conversations" aria-busy={loading}>
        {visible.map((thread) => <button type="button" key={thread.key} className={`provider-${thread.provider} ${selected === thread.key ? "active" : ""}`} aria-pressed={selected === thread.key} onClick={() => setSelected(thread.key)}><span className={`provider-badge provider-${thread.provider}`}>{providerName(thread.provider)}</span><b title={thread.name || thread.preview}>{thread.name || thread.preview || "Untitled conversation"}</b><small>{new Date(thread.updatedAt * 1000).toLocaleString()}{thread.gitInfo?.branch ? ` · ${thread.gitInfo.branch}` : ""}</small></button>)}
        {loading && <p className="panel-copy" role="status">Loading conversations…</p>}
        {!loading && !listError && !visible.length && <p className="panel-copy">No {archived ? "archived " : ""}conversations found for this directory.</p>}
        {providers.filter((provider) => cursors[provider] && enabled.includes(provider)).map((provider) => <button key={provider} type="button" disabled={loading} onClick={() => more(provider)}>Load older {providerName(provider)} conversations</button>)}
      </div>
      <div ref={messagePane} className="codex-messages" key={selected} aria-label="Conversation messages" aria-busy={reading} tabIndex={0}>
        {messageCursor && <button type="button" disabled={reading} onClick={moreMessages}>Load older messages</button>}
        {reading && <p className="panel-copy" role="status">Loading messages…</p>}
        {readError && <p className="config-error" role="alert">{readError}</p>}
        {!selected && <p className="panel-copy">Choose a conversation from the list.</p>}
        {selected && !reading && !readError && !messages.length && <p className="panel-copy">No stored user or assistant messages in this conversation.</p>}
        {messages.map((message, index) => <ConversationMessage key={`${message.id}-${index}`} message={message} formatCursor={!!selected?.startsWith("cursor:")} />)}
      </div>
    </div>
  </>;
}

const markdownComponents = { a: ({ children, href }: { children?: React.ReactNode; href?: string }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>, img: ({ alt }: { alt?: string }) => <span>{alt ? `[Image: ${alt}]` : "[Image]"}</span> };
const ConversationMessage = memo(function ConversationMessage({ message, formatCursor }: { message: CodexMessage; formatCursor: boolean }) {
  const text = formatCursor && message.role === "user" ? cursorDisplayText(message.text) : message.text;
  return <article className={`codex-message ${message.role}`}><div className="conversation-markdown"><Markdown components={markdownComponents}>{text}</Markdown></div></article>;
});
