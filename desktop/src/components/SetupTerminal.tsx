import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

/** A permission-gated installer console; no arbitrary shell commands or elevation. */
export function SetupTerminal({ provider, onInstalled }: { provider: "codex" | "cursor"; onInstalled: () => void | Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true);
  const busy = useRef(false);
  const pane = useRef<HTMLPreElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; if (busy.current) void api.cancelProviderInstall(); }; }, []);
  useEffect(() => { if (pane.current) pane.current.scrollTop = pane.current.scrollHeight; }, [output]);
  async function run() {
    setConfirm(false); setRunning(true); busy.current = true; setOutput(""); setError("");
    try { await api.installProvider(provider, text => { if (active.current) setOutput(current => (current + text).slice(-100000)); }); if (active.current) await onInstalled(); }
    catch (error) { if (active.current) setError(String(error)); }
    finally { busy.current = false; if (active.current) setRunning(false); }
  }
  return <div className="setup-terminal">
    {!running && <button type="button" onClick={() => setConfirm(true)}>Install {provider === "codex" ? "Codex" : "Cursor SDK"} automatically…</button>}
    {confirm && <div role="group" aria-label="Approve provider installation"><p>Allow GitCerberus to download and install this provider into its own application data directory? It runs with your current permissions.</p>
      <pre>{provider === "codex" ? "npm install --prefix <app-data>/providers/codex --no-audit --no-fund @openai/codex" : "python3 -m venv <app-data>/providers/cursor\n<venv-python> -m pip install --disable-pip-version-check cursor-sdk"}</pre>
      <button type="button" onClick={run}>Allow and install</button><button type="button" onClick={() => setConfirm(false)}>Cancel</button></div>}
    {running && <button type="button" onClick={() => api.cancelProviderInstall().catch(error => setError(String(error)))}>Stop installation</button>}
    {(output || running) && <pre ref={pane} className="terminal-output" aria-label="Installation terminal" tabIndex={0}>{output || "Starting installer…"}</pre>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
