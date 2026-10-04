import { matchesShortcut } from '../lib/shortcuts';
import { useEffect, useId, useRef, useState } from "react";
import { GitBranch, GitCommitHorizontal, RefreshCw, Trash2, X } from "lucide-react";
import { api, inTauri, type BranchRemovalPlan } from "../lib/api";
import { listen } from "@tauri-apps/api/event";
import type { Commit, Repository } from "../types";

export function CommitHistory({ repository, unlinkedName, shortcutsEnabled = true }: { repository?: Repository; unlinkedName?: string; shortcutsEnabled?: boolean }) {
  const [branch, setBranch] = useState(repository?.branch ?? "");
  const [branches, setBranches] = useState<string[]>([]);
  const [branchError, setBranchError] = useState("");
  const [removalOpen,setRemovalOpen]=useState(false);
  const [removalPlan,setRemovalPlan]=useState<BranchRemovalPlan|null>(null);
  const [removalBusy,setRemovalBusy]=useState(false);
  const [removalExecuting,setRemovalExecuting]=useState(false);
  const [removalBranch,setRemovalBranch]=useState('');
  const [removalError,setRemovalError]=useState('');
  const [removalSteps,setRemovalSteps]=useState<string[]>([]);
  useEffect(()=>{if(removalOpen)requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.branch-removal-dialog footer button')?.focus());},[removalOpen]);
  const removalRequest=useRef(0);
  const removalRepository=useRef(repository?.id);removalRepository.current=repository?.id;
  useEffect(()=>{removalRequest.current++;setBranch(repository?.branch||'');setBranches([]);setRemovalOpen(false);setRemovalBusy(false);setRemovalExecuting(false);setRemovalPlan(null);setRemovalError('');setRemovalSteps([]);},[repository?.id]);

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
  }, [repository, branch, revision]);

  useEffect(() => {
    if (!repository) return;
    let active = true;
    let request = 0;
    let unlisten: (() => void) | undefined;
    let debounce: number | undefined;
    const refreshBranches = () => {
      const generation = ++request;
      void api.branches(repository.id).then(items => {
        if (!active || generation !== request) return;
        setBranches(current => current.length === items.length && current.every((value,index) => value === items[index]) ? current : items);
        setBranchError("");
      }).catch(error => { if (active && generation === request) setBranchError(String(error)); });
    };
    const onVisible = () => { if (!document.hidden) refreshBranches(); };
    refreshBranches();
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(onVisible, 15000);
    if (inTauri()) void listen<{repositoryId:string}>('automation-git-change', event => {
      if (event.payload.repositoryId !== repository.id) return;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => { refreshBranches(); setRevision(value => value + 1); }, 300);
    }).then(stop => { if (active) unlisten = stop; else stop(); });
    return () => {
      active = false; unlisten?.(); window.clearInterval(timer); window.clearTimeout(debounce);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
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

  async function prepareRemoval(){
    if(!repository||!branch||removalBusy)return;
    const request=++removalRequest.current;
    setRemovalOpen(true);setRemovalBranch(branch);setRemovalPlan(null);setRemovalError('');setRemovalSteps([]);setRemovalBusy(true);
    try{const plan=await api.branchRemovalPlan(repository.id,branch);if(request===removalRequest.current)setRemovalPlan(plan);}
    catch(error){if(request===removalRequest.current)setRemovalError(String(error));}
    finally{if(request===removalRequest.current)setRemovalBusy(false);}
  }
  async function confirmRemoval(){
    if(!repository||!removalPlan||removalBusy)return;
    const repositoryId=repository.id,request=++removalRequest.current;
    setRemovalBusy(true);setRemovalExecuting(true);setRemovalError('');
    try{
      const result=await api.removeBranch(repositoryId,removalPlan);
      if(request!==removalRequest.current)return;
      setRemovalSteps(result.steps);setRemovalError(result.error||'');setRemovalPlan(null);
    }catch(error){if(request===removalRequest.current){setRemovalError(String(error));setRemovalPlan(null);}}
    finally{
      if(request===removalRequest.current&&removalRepository.current===repositoryId){
        setRemovalBusy(false);setRemovalExecuting(false);
        try{const items=await api.branches(repositoryId);if(request===removalRequest.current){setBranches(items);setBranch(current=>items.includes(current)?current:items.includes(repository.branch||'')?(repository.branch||''):items[0]||'');setRevision(value=>value+1);}}
        catch(error){if(request===removalRequest.current)setBranchError(String(error));}
      }
    }
  }
  function closeRemoval(){if(removalExecuting)return;removalRequest.current++;setRemovalOpen(false);setRemovalBusy(false);}

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
    <header><div><p>Commit history</p><h2>{repository?.displayName || unlinkedName || "Select a repository"}</h2></div><button type="button" disabled={!repository || !branch || removalBusy || branch===repository.branch} aria-label="Remove selected branch" title={branch===repository?.branch?"Switch the checkout to another branch before removing its current branch":"Remove the selected branch and its linked worktree"} onClick={()=>void prepareRemoval()}><Trash2 size={16}/></button><button type="button" disabled={!repository || loading} aria-label="Refresh history" onClick={() => setRevision((value) => value + 1)}><RefreshCw size={16} className={loading ? "spin" : ""} /></button></header>
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
    {removalOpen&&<div className="automation-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)closeRemoval();}}><section className="automation-dialog branch-removal-dialog" role="dialog" aria-modal="true" aria-label="Remove branch" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();closeRemoval();}}}><header><h2>Remove branch</h2><button type="button" aria-label="Close branch removal" disabled={removalExecuting} onClick={closeRemoval}><X size={17}/></button></header><div className="automation-dialog-content">
      <p><strong>{repository?.displayName}</strong> · <code>{removalBranch}</code></p>
      {removalBusy&&<p role="status">{removalPlan?'Removing branch…':'Checking branch and remote…'}</p>}
      {removalPlan&&<><p>Remove this local branch{removalPlan.remoteHead?` and ${removalPlan.remote}/${removalPlan.branch}`:''}?</p><p>Git will refuse dirty or locked worktrees and unmerged branches. The primary checkout is preserved. Completed steps cannot be undone by cancelling a later step.</p>{removalPlan.worktrees.length>0&&<><strong>Worktrees to remove</strong><ul>{removalPlan.worktrees.map(path=><li key={path}><code>{path}</code></li>)}</ul></>}<p>{removalPlan.remote?`${removalPlan.remoteHead?'The remote branch will be deleted.':'No matching remote branch exists.'} ${removalPlan.remote} will be fetched and pruned.`:'No origin remote is configured. Only the local branch will be removed.'}</p><small>Commit: {removalPlan.head}</small></>}
      {removalSteps.length>0&&<ol aria-label="Branch removal results">{removalSteps.map((step,index)=><li key={index}>{step}</li>)}</ol>}
      {removalError&&<p className="config-error" role="alert">{removalError}</p>}
      {!removalBusy&&!removalPlan&&removalSteps.length>0&&!removalError&&<p role="status">Branch removal completed.</p>}
    </div><footer><button type="button" disabled={removalExecuting} onClick={closeRemoval}>{removalPlan?'Cancel':'Close'}</button>{removalPlan&&<button type="button" disabled={removalBusy} onClick={()=>void confirmRemoval()}>Remove branch</button>}</footer></section></div>}
  </section>;
}
