import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

/** A permission-gated installer console; no arbitrary shell commands or elevation. */
export function SetupTerminal({ provider, onInstalled, onRunningChange, disabled }: { provider: "codex" | "cursor" | "cursor-agent"; onInstalled: () => void | Promise<void>; onRunningChange?: (running: boolean) => void; disabled?: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const active = useRef(true);
  const busy = useRef(false);
  const pane = useRef<HTMLPreElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; if (busy.current) void api.cancelProviderInstall(); }; }, []);
  useEffect(() => {
    onRunningChange?.(running);
    if (!running) return;
    const start = Date.now(); setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => { window.clearInterval(timer); onRunningChange?.(false); };
  }, [running, onRunningChange]);
  useEffect(() => { if (pane.current) pane.current.scrollTop = pane.current.scrollHeight; }, [output]);
  async function run() {
    setRunning(true); busy.current = true; setOutput(""); setError("");
    try { await api.installProvider(provider, text => { if (active.current) setOutput(current => (current + text).slice(-100000)); }); if (active.current) await onInstalled(); }
    catch (error) { if (active.current) setError(String(error)); }
    finally { busy.current = false; if (active.current) setRunning(false); }
  }
  return <div className="setup-terminal">
    {!running && <div role="group" aria-label="Approve provider installation"><p>{provider === "cursor-agent" ? "Install Cursor Agent using Cursor’s official installer in your user account?" : "Install this provider in GitCerberus’s application data directory?"} No administrator access is requested.</p>
      <pre>{provider === "codex" ? "npm install --prefix <app-data>/providers/codex --no-audit --no-fund @openai/codex" : provider === "cursor-agent" ? "Download https://cursor.com/install (Windows: ?win32=true)\nRun the downloaded installer with bash (Windows: PowerShell)\nDetect and save the installed executable automatically" : "python3 -m venv <app-data>/providers/cursor\n<venv-python> -m pip install --disable-pip-version-check cursor-sdk"}</pre>
      <button type="button" disabled={disabled} onClick={run}>Install {provider === "codex" ? "Codex" : provider === "cursor-agent" ? "Cursor Agent" : "Cursor SDK"}</button></div>}
    {running && <p role="status">Installing… {elapsed}s elapsed. Download progress appears below.</p>}
    {running && <button type="button" onClick={() => api.cancelProviderInstall().catch(error => setError(String(error)))}>Stop installation</button>}
    {(output || running) && <pre ref={pane} className="terminal-output" aria-label="Installation terminal" tabIndex={0}>{output || "Starting installer…"}</pre>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
