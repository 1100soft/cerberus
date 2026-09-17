import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Bell, FolderGit2, Plus, Search, Settings, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Select } from "./components/Select";
import { CodexHistory } from "./components/CodexHistory";
import { CommitHistory } from "./components/CommitHistory";
import { RepositoryCard } from "./components/RepositoryCard";
import { isLocal, mergeRepositories, repositoryControls, selectRepositoryControl, repositoryOwner, filterAndSortRepositories, readRepositoryFilters, type RepositorySelection } from "./lib/repositories";
import { IdentitiesPanel } from "./components/IdentitiesPanel";
import { RepositoryConfigDialog } from "./components/RepositoryConfigDialog";
import { RepositoryContextMenu, type ContextAction } from "./components/RepositoryContextMenu";
import { AddRepositoryChooser } from "./components/AddRepositoryChooser";
import { api } from "./lib/api";
import type { GithubRepository, Identity, ImportResult, Repository, RepositoryUpdate } from "./types";

type Filter = "all" | "dirty" | "ahead" | "behind" | "mismatch";

export function App() {
  const [paneSplit, setPaneSplit] = useState(() => Number(localStorage.getItem("gitcerberus.paneSplit")) || 50);
  const [localRepositories, setRepositories] = useState<Repository[]>([]);
  const [query, setQuery] = useState("");
  const [listFilters, setListFilters] = useState(() => readRepositoryFilters(localStorage.getItem("gitcerberus.repositoryFilters")));
  useEffect(() => { localStorage.setItem("gitcerberus.repositoryFilters", JSON.stringify(listFilters)); }, [listFilters]);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string>();
  const [dragged, setDragged] = useState<string>();
  const [notice, setNotice] = useState("Local repository monitoring is active");
  const [selection, setSelection] = useState<RepositorySelection>({ repositoryId: '', controlIndex: 0 });
  const [githubRepositories, setGithubRepositories] = useState<GithubRepository[]>([]);
  const [githubWarnings, setGithubWarnings] = useState<string[]>([]);
  const [syncingGithub, setSyncingGithub] = useState(false);
  const catalogGeneration = useRef(0);
  const repositories = useMemo(() => mergeRepositories(localRepositories, githubRepositories), [localRepositories, githubRepositories]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [showIdentities, setShowIdentities] = useState(false);
  const [identityPrompt, setIdentityPrompt] = useState<{ owner: string; repositoryId: string }>();
  const [menu, setMenu] = useState<{ repository: Repository; x: number; y: number }>();
  const [configRepo, setConfigRepo] = useState<Repository>();
  const [addRepo, setAddRepo] = useState<"choose" | "create">();

  async function syncGithub() {
    const generation = ++catalogGeneration.current;
    setSyncingGithub(true);
    try {
      const catalog = await api.githubRepositories();
      if (generation !== catalogGeneration.current) return;
      setGithubRepositories(current => [...current.filter(repo => catalog.failedIdentityIds?.includes(repo.identityId)), ...catalog.repositories]); setGithubWarnings(catalog.warnings);
    } catch (error) { if (generation === catalogGeneration.current) setGithubWarnings([String(error)]); }
    finally { if (generation === catalogGeneration.current) setSyncingGithub(false); }
  }
  async function reload() { const [repos, ids] = await Promise.all([api.repositories(), api.identities()]); setRepositories(repos); setIdentities(ids); await syncGithub(); }
  useEffect(() => { reload().catch((e) => setNotice(String(e))); }, []);
  useEffect(() => {
    const sync = () => { api.repositories().then(setRepositories).catch((error) => setNotice(String(error))); };
    const onVisible = () => { if (!document.hidden) sync(); };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    const minimum = 0.75, maximum = 1.5, step = 0.1;
    let zoom = Number(localStorage.getItem("gitcerberus.uiZoom")) || 1;
    const apply = (next: number) => {
      zoom = Math.min(maximum, Math.max(minimum, Math.round(next * 10) / 10));
      document.documentElement.style.setProperty("--ui-zoom", String(zoom));
      localStorage.setItem("gitcerberus.uiZoom", String(zoom));
    };
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      apply(zoom + (event.deltaY < 0 ? step : -step));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (!["+", "=", "-", "_", "0"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "0") apply(1);
      else apply(zoom + (["+", "="].includes(event.key) ? step : -step));
    };
    apply(zoom);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const owners = [...new Set(repositories.map(repositoryOwner))].sort((a, b) => a.localeCompare(b));
  const visible = useMemo(() => filterAndSortRepositories(repositories.filter((repo) => {
    const haystack = [repo.displayName, repo.localPath, repo.canonicalRemote, repo.identity?.label, repo.github?.owner, ...repo.tags].join(" ").toLowerCase();
    const matchesQuery = haystack.includes(query.toLowerCase());
    const changes = repo.stagedCount + repo.modifiedCount + repo.untrackedCount;
    const matchesFilter = filter === "all" || (filter === "dirty" && changes > 0) || (filter === "ahead" && repo.ahead > 0) || (filter === "behind" && repo.behind > 0) || (filter === "mismatch" && repo.identityMismatch);
    return matchesQuery && matchesFilter;
  }), listFilters), [repositories, query, filter, listFilters]);

  const normalizedSelection = selectRepositoryControl(visible, selection.repositoryId, selection.controlIndex);
  const selectedIndex = visible.findIndex(repo => repo.id === normalizedSelection.repositoryId);
  const selectedRepository = visible[selectedIndex];
  const actionIndex = normalizedSelection.controlIndex;
  const historyRepository = selectedRepository && isLocal(selectedRepository) ? selectedRepository : undefined;
  const deferredHistory = useDeferredValue(historyRepository);
  function selectControl(repositoryId: string, controlIndex = actionIndex, focus = false, list = visible) {
    const next = selectRepositoryControl(list, repositoryId, controlIndex);
    setSelection(next);
    requestAnimationFrame(() => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-repository-id]')].find(row => row.dataset.repositoryId === next.repositoryId);
      const control = row?.querySelector<HTMLElement>(`[data-control-index="${next.controlIndex}"]`);
      if (focus) (control || row)?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: 'nearest' });
    });
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, select, textarea, [role=listbox], .history-panel, .codex-panel") || (target.closest('button') && !target.closest('.row-actions')) || showIdentities || configRepo || menu || addRepo || busy) return;
      const repo = selectedRepository;
      if (!repo) return;
      const controls = repositoryControls(repo);
      const shortcut = controls.findIndex(item => item.key.toLowerCase() === event.key.toLowerCase());
      if (shortcut >= 0) {
        event.preventDefault(); selectControl(repo.id, shortcut, true);
        if (controls[shortcut].id === 'identity') requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.repo-row.selected .identity')?.click());
        else void action(repo, controls[shortcut].id);
        return;
      }
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) return;
      // Native button activation owns Enter when focus is already on a control.
      if (event.key === 'Enter' && target.closest('button')) return;
      event.preventDefault();
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const index = (selectedIndex + (event.key === 'ArrowUp' ? -1 : 1) + visible.length) % visible.length;
        selectControl(visible[index].id, actionIndex, true);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') selectControl(repo.id, actionIndex + (event.key === 'ArrowLeft' ? -1 : 1), true);
      else if (controls[actionIndex]?.id === 'identity') document.querySelector<HTMLButtonElement>('.repo-row.selected .identity')?.click();
      else if (controls[actionIndex]) void action(repo, controls[actionIndex].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selectedIndex, actionIndex, showIdentities, configRepo, menu, addRepo, busy]);

  async function action(repo: Repository, name: string) {
    if (busy) return;
    if (name === 'configure') { setConfigRepo(repo); return; }
    setBusy(repo.id);
    try {
      if (name === 'locate') {
        const path = await api.selectRepositoryDirectory(`Link existing checkout for ${repo.displayName}`);
        if (!path) return;
        const result = await api.linkRepositoryFolder(repo.canonicalRemote || '', path, repo.id.startsWith('github:') ? undefined : repo.id);
        setRepositories(await api.repositories());
        selectControl(result.repository.id, 0, false, [...visible, result.repository]);
        setNotice(`Linked existing checkout for ${repo.displayName}`);
        return;
      }
      if (name === 'clone' && repo.github) {
        const parent = await api.selectRepositoryDirectory(`Clone ${repo.github.fullName} — choose its parent folder`);
        if (!parent) return;
        setNotice(`Cloning ${repo.github.fullName} into ${parent}…`);
        const result = await api.cloneGithubRepository(repo.github.identityId, repo.github.fullName, parent);
        setRepositories(items => [...items.filter(item => item.id !== result.repository.id && !(item.id === repo.id && !isLocal(item))), result.repository]);
        selectControl(result.repository.id, 0, false, [...visible, result.repository]);
        setNotice(`Cloned ${repo.github.fullName}`);
        return;
      }
      if (name === "hosted") {
        if (repo.github) await api.openExternalUrl(repo.github.htmlUrl);
        else await api.openHosted(repo.id);
      }
      else if (!isLocal(repo)) throw new Error('Link a local folder or clone this repository first.');
      else if (name === "editor") await api.openEditor(repo.id);
      else if (name === "cursor") await api.openCursor(repo.id);
      else if (name === "folder") await api.openLocalFolder(repo.id);
      else if (name === "refresh") {
        const updated = await api.refresh(repo.id);
        setRepositories((items) => items.map((r) => r.id === updated.id ? updated : r));
      }
      else {
        await api.git(repo.id, name);
        const updated = await api.refresh(repo.id);
        setRepositories((items) => items.map((r) => r.id === updated.id ? updated : r));
      }
      setNotice(`${name[0].toUpperCase() + name.slice(1)} completed for ${repo.displayName}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(undefined); }
  }

  async function contextAction(repo: Repository, name: ContextAction) {
    setMenu(undefined);
    if (name === "configure") { setConfigRepo(repo); return; }
    if (name === "copy-path") {
      try { await navigator.clipboard.writeText(repo.localPath); setNotice(`Copied ${repo.localPath}`); }
      catch { setNotice("Could not copy the local path"); }
      return;
    }
    if (name === "remove") { await removeRepo(repo); return; }
    await action(repo, name);
  }

  async function saveConfig(update: RepositoryUpdate) {
    if (!configRepo) return;
    const saved = await api.updateRepository(configRepo.id, update);
    setRepositories((items) => items.map((r) => r.id === saved.id ? saved : r));
    setConfigRepo(undefined);
    setNotice(`Updated ${saved.displayName}`);
  }

  async function removeRepo(repo: Repository) {
    if (!window.confirm(`Remove ${repo.displayName} from this workspace? The local Git repository is not deleted.`)) return;
    await api.removeRepository(repo.id);
    setRepositories((items) => items.filter((item) => item.id !== repo.id));
    setConfigRepo(undefined);
    setMenu(undefined);
    setNotice(`Removed ${repo.displayName} from the workspace`);
  }

  async function drop(onId: string) {
    if (!dragged || dragged === onId) return;
    if (listFilters.sort !== 'manual') { setNotice('Choose Manual order before reordering cards.'); setDragged(undefined); return; }
    const next = [...localRepositories];
    const from = next.findIndex((r) => r.id === dragged), to = next.findIndex((r) => r.id === onId);
    if (from < 0 || to < 0) return;
    next.splice(to, 0, next.splice(from, 1)[0]);
    setRepositories(next); setDragged(undefined); await api.reorder(next.map((r) => r.id));
  }

  async function importRepo() {
    setAddRepo(undefined);
    const path = await api.selectRepositoryDirectory();
    if (!path) return;
    try { await afterAdded(await api.importRepository(path), "Imported"); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
  }

  async function createRepo(update: RepositoryUpdate) {
    const result = await api.createRepository(update);
    setAddRepo(undefined);
    await afterAdded(result, "Created");
  }

  async function afterAdded(result: ImportResult, verb: string) {
    setRepositories((r) => [...r.filter((repo) => repo.id !== result.repository.id), result.repository]);
    const owner = githubOwner(result.repository.canonicalRemote);
    const matching = owner && identities.find((identity) => identity.providerUsername?.toLowerCase() === owner.toLowerCase());
    if (matching) {
      await api.assignIdentity(result.repository.id, matching.id);
      await reload();
      setNotice(`${verb} ${result.repository.displayName} and associated @${matching.providerUsername}`);
    } else if (owner) {
      setIdentityPrompt({ owner, repositoryId: result.repository.id });
      setShowIdentities(true);
      setNotice(`${verb} ${result.repository.displayName}; sign in as ${owner} so this repository uses the right account`);
    } else setNotice(result.warnings[0] ?? `${verb} ${result.repository.displayName}`);
  }

  return <div className="shell">
    <aside>
      <div className="brand"><div className="brand-mark"><ShieldCheck /></div><div><b>GitCerberus</b><span>Repository guardian</span></div></div>
      <nav>
        <button className={!showIdentities ? "active" : ""} onClick={() => { setShowIdentities(false); setIdentityPrompt(undefined); }}><FolderGit2 />Repositories <span>{repositories.length}</span></button>
        <button className={showIdentities ? "active" : ""} onClick={() => setShowIdentities(true)}><ShieldCheck />Identities <span>{identities.length}</span></button>
        <button><Bell />Automation</button>
      </nav>
      <div className="aside-bottom"><button><Settings />Settings</button><div className="watch-state"><i />Guardian running<span>Last scan just now</span></div></div>
    </aside>

    <main style={{ "--pane-top": `${paneSplit}fr`, "--pane-bottom": `${100 - paneSplit}fr` } as React.CSSProperties}>
      {!showIdentities && <>
      <section className="toolbar">
        <label className="search"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search repositories, identities, tags, paths…" /><kbd>⌘ K</kbd></label>
        <div className="filter"><SlidersHorizontal size={17} /><Select label="Filter repositories" value={filter} onChange={(value) => setFilter(value as Filter)} options={[{value:"all",label:"All statuses"},{value:"dirty",label:"Has changes"},{value:"ahead",label:"Ahead"},{value:"behind",label:"Behind"},{value:"mismatch",label:"Identity mismatch"}]} /></div>
        <div className="header-actions"><button disabled={syncingGithub} onClick={() => void syncGithub()} title={githubWarnings.join("\n") || "Refresh connected GitHub repositories"}>{syncingGithub ? "Loading GitHub…" : "Refresh GitHub"}</button><button className="import" onClick={() => setAddRepo("choose")}><Plus size={17} />Add repository</button></div>
      </section>
      <div className="summary"><span><b>{visible.length}</b> repositories</span><span><i className="ok" />{repositories.filter(isLocal).length} local</span><span><i className="warn" />{repositories.filter(repo => !isLocal(repo)).length} without a linked folder</span>{githubWarnings.length > 0 && <span className="github-warning" role="status" title={githubWarnings.join("\n")}>{githubWarnings.join(" ")}</span>}</div>
      <div className="repository-workspace">
      <div className="repository-list-column">
      <div className="repo-list-controls" aria-label="Repository filters and sorting">
        <Select label="Filter by owner" title="Repository owner" value={listFilters.owner} onChange={owner => setListFilters(current => ({ ...current, owner }))} options={[{ value: '', label: 'All owners' }, ...[...new Set([...owners, ...(listFilters.owner ? [listFilters.owner] : [])])].map(owner => ({ value: owner, label: owner }))]} />
        <Select label="Filter by visibility" title="Repository visibility" value={listFilters.visibility} onChange={visibility => setListFilters(current => ({ ...current, visibility }))} options={[{ value: 'all', label: 'Any visibility' }, { value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }, { value: 'unverified', label: 'Unverified' }]} />
        <Select label="Filter by local presence" title="Whether a local checkout is linked" value={listFilters.presence} onChange={presence => setListFilters(current => ({ ...current, presence }))} options={[{ value: 'all', label: 'Any location' }, { value: 'local', label: 'Linked locally' }, { value: 'unlinked', label: 'Folder not linked' }]} />
        <Select label="Sort repositories" title="Last updated uses GitHub’s update time or the latest local commit; changes counts known working-tree changes." value={listFilters.sort} onChange={sort => setListFilters(current => ({ ...current, sort }))} options={[{ value: 'manual', label: 'Manual order' }, { value: 'name', label: 'Name A–Z' }, { value: 'updated', label: 'Last updated' }, { value: 'changes', label: 'Most changes' }, { value: 'owner', label: 'Owner A–Z' }]} />
      </div>
      <section className="repo-grid">
        {visible.map((repo, index) => <RepositoryCard key={repo.id} repository={repo} identities={identities} onAssignIdentity={async (identityId) => { await api.assignIdentity(repo.id, identityId); setRepositories(await api.repositories()); setNotice(`Updated identity for ${repo.displayName}`); }} selected={index === selectedIndex} actionIndex={actionIndex} busy={!!busy} onSelect={(controlIndex, focus) => selectControl(repo.id, controlIndex, focus)} onAction={(name) => action(repo, name)} onConfigure={() => { setMenu(undefined); setConfigRepo(repo); }} onContextMenu={(event) => setMenu({ repository: repo, x: event.clientX, y: event.clientY })} onDragStart={() => setDragged(repo.id)} onDrop={() => drop(repo.id)} />)}
        {!visible.length && <div className="empty"><FolderGit2 /><h2>No repositories found</h2><p>Try another search or add a local Git repository.</p></div>}
      </section>
      </div>
      <CommitHistory unlinkedName={selectedRepository && !isLocal(selectedRepository) ? selectedRepository.displayName : undefined} repository={deferredHistory} shortcutsEnabled={!configRepo && !menu && !addRepo} />
      </div>
      <div className="pane-divider" role="separator" aria-label="Resize repository and conversation panels" aria-orientation="horizontal" aria-valuemin={20} aria-valuemax={80} aria-valuenow={paneSplit} tabIndex={0}
        onKeyDown={(event) => {
          if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const next = event.key === "Home" ? 20 : event.key === "End" ? 80 : Math.min(80, Math.max(20, paneSplit + (event.key === "ArrowDown" ? 5 : -5)));
          setPaneSplit(next); localStorage.setItem("gitcerberus.paneSplit", String(next));
        }}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const main = event.currentTarget.parentElement!;
          const top = main.querySelector(".repository-workspace")!.getBoundingClientRect().top;
          const bottom = main.querySelector(".codex-panel")!.getBoundingClientRect().bottom;
          const next = Math.min(80, Math.max(20, Math.round((event.clientY - top) / (bottom - top) * 100)));
          setPaneSplit(next); localStorage.setItem("gitcerberus.paneSplit", String(next));
        }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} />
      <CodexHistory unlinkedName={selectedRepository && !isLocal(selectedRepository) ? selectedRepository.displayName : undefined} repository={deferredHistory} />
      </>}
      <div className="toast"><i />{notice}</div>
      {showIdentities && <IdentitiesPanel identities={identities} inferredOwner={identityPrompt?.owner} pendingRepositoryId={identityPrompt?.repositoryId} onClose={() => { setShowIdentities(false); setIdentityPrompt(undefined); }} onChanged={reload} />}
      {menu && <RepositoryContextMenu repository={menu.repository} x={menu.x} y={menu.y} busy={busy === menu.repository.id} onAction={(name) => void contextAction(menu.repository, name)} onClose={() => setMenu(undefined)} />}
      {configRepo && <RepositoryConfigDialog repository={configRepo} identities={identities} onClose={() => setConfigRepo(undefined)} onSave={saveConfig} onRemove={() => removeRepo(configRepo)} />}
      {addRepo === "choose" && <AddRepositoryChooser onClose={() => setAddRepo(undefined)} onImport={importRepo} onCreate={() => setAddRepo("create")} />}
      {addRepo === "create" && <RepositoryConfigDialog identities={identities} onClose={() => setAddRepo(undefined)} onSave={createRepo} />}
    </main>
  </div>;
}

function githubOwner(remote?: string): string | undefined {
  if (!remote) return undefined;
  try {
    const url = new URL(remote);
    if (url.hostname.toLowerCase() !== "github.com") return undefined;
    return url.pathname.split("/").filter(Boolean)[0];
  } catch { return undefined; }
}
