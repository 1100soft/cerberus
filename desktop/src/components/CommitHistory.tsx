import { matchesShortcut } from '../lib/shortcuts';
import { useEffect, useId, useRef, useState } from "react";
import { GitBranch, GitCommitHorizontal, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import type { Commit, Repository } from "../types";

export function CommitHistory({ repository, unlinkedName, shortcutsEnabled = true }: { repository?: Repository; unlinkedName?: string; shortcutsEnabled?: boolean }) {
  const [branch, setBranch] = useState(repository?.branch ?? "");
  const [branches, setBranches] = useState<string[]>([]);
  const [branchError, setBranchError] = useState("");
  const [selectedCommit, setSelectedCommit] = useState(-1);
  const panelId = useId();
  const panel = useRef<HTMLElement>(null);
  const tabs = [...new Set([repository?.branch ?? "", ...branches])];
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    setSelectedCommit(-1);
    setCommits([]); setError(""); setHasMore(false); setLoading(!!repository);
    if (repository) {
      api.history(repository.id, branch || undefined).then((items) => {
        if (request !== generation.current) return;
        setCommits(items); setHasMore(items.length === 50);
      }).catch((error) => { if (request === generation.current) setError(String(error)); })
        .finally(() => { if (request === generation.current) setLoading(false); });
    }
    return () => { generation.current++; };
  }, [repository?.id, branch, revision]);

  useEffect(() => {
    let active = true;
    if (!repository) return;
    api.branches(repository.id).then((items) => {
      if (!active) return;
      setBranches(items); setBranchError("");
    }).catch((error) => { if (active) setBranchError(String(error)); });
    return () => { active = false; };
  }, [repository?.id, revision]);

  useEffect(() => {
    if (!shortcutsEnabled || !repository) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(['branch.previous', 'branch.next', 'commit.previous', 'commit.next'] as const).some(command => matchesShortcut(event, command))) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true], [role=dialog], .codex-panel")) return;
      event.preventDefault();
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const index = tabs.indexOf(branch);
        setBranch(tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length]);
      } else if (commits.length) {
        setSelectedCommit((current) => Math.max(0, Math.min(commits.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutsEnabled, repository, tabs, branch, commits.length]);

  useEffect(() => {
    panel.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [branch]);

  useEffect(() => {
    panel.current?.querySelector(`[data-commit-index="${selectedCommit}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedCommit]);

  async function loadMore() {
    if (!repository || loading) return;
    const request = generation.current;
    setLoading(true); setError("");
    try {
      const items = await api.history(repository.id, branch || undefined, commits.length);
      if (request !== generation.current) return;
      setCommits((current) => [...current, ...items]); setHasMore(items.length === 50);
    } catch (error) { if (request === generation.current) setError(String(error)); }
    finally { if (request === generation.current) setLoading(false); }
  }

  return <section ref={panel} className="history-panel" aria-label="Commit history" aria-busy={loading}>
    <header><div><p>Commit history</p><h2>{repository?.displayName || unlinkedName || "Select a repository"}</h2></div><button type="button" disabled={!repository || loading} aria-label="Refresh history" onClick={() => setRevision((value) => value + 1)}><RefreshCw size={16} className={loading ? "spin" : ""} /></button></header>
    {repository && <>
      <div className="history-tabs" role="tablist" aria-label="Branches">
        {tabs.map((name, index) => <button key={name} id={`${panelId}-tab-${index}`} role="tab" type="button" aria-selected={branch === name} aria-controls={`${panelId}-commits`} tabIndex={branch === name ? 0 : -1} onClick={() => setBranch(name)} onKeyDown={(event) => {
          if (event.shiftKey || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          setBranch(tabs[next]);
        }}><GitBranch size={13} />{name || "Detached HEAD"}</button>)}
      </div>
      <p className="history-shortcuts">Shift + ← / → branches · Shift + ↑ / ↓ commits</p>
    </>}
    {branchError && <p className="config-error" role="alert">{branchError}</p>}
    <div id={`${panelId}-commits`} role="tabpanel" aria-labelledby={repository ? `${panelId}-tab-${tabs.indexOf(branch)}` : undefined}>
    {!repository && <p className="panel-copy">{unlinkedName ? "Link an existing local checkout, or clone a new one, to view its commits." : "Select a repository to view its commits."}</p>}
    {error && <p className="config-error" role="alert">{error}</p>}
    {loading && <p className="panel-copy" role="status">Loading commits…</p>}
    {repository && !loading && !error && !commits.length && <p className="panel-copy">No commits on this branch yet.</p>}
    <ol className="commit-history">{commits.map((commit, index) => <li key={`${commit.hash}-${index}`} className={selectedCommit === index ? "selected-commit" : ""}><GitCommitHorizontal size={17} /><button type="button" className="commit-entry" data-commit-index={index} aria-current={selectedCommit === index ? "true" : undefined} onFocus={() => setSelectedCommit(index)} onClick={() => setSelectedCommit(index)}><h3>{commit.summary}</h3><p title={commit.email}>{commit.author}</p><div className="commit-meta"><code title={commit.hash}>{commit.hash.slice(0, 7)}</code><time dateTime={commit.committedAt} title={new Date(commit.committedAt).toLocaleString()}>{new Date(commit.committedAt).toLocaleDateString()}</time></div></button></li>)}</ol>
    {hasMore && <button className="history-more" type="button" disabled={loading} onClick={loadMore}>Load older commits</button>}
    </div>
  </section>;
}
