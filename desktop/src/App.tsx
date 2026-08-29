import { useEffect, useMemo, useState } from "react";
import { Bell, ChevronDown, FolderGit2, Plus, Search, Settings, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { RepositoryCard } from "./components/RepositoryCard";
import { repositoryActions } from "./components/RepositoryCard";
import { IdentitiesPanel } from "./components/IdentitiesPanel";
import { RepositoryConfigDialog } from "./components/RepositoryConfigDialog";
import { RepositoryContextMenu, type ContextAction } from "./components/RepositoryContextMenu";
import { AddRepositoryChooser } from "./components/AddRepositoryChooser";
import { api } from "./lib/api";
import type { Identity, ImportResult, Repository, RepositoryUpdate } from "./types";

type Filter = "all" | "dirty" | "ahead" | "behind" | "mismatch";

export function App() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string>();
  const [dragged, setDragged] = useState<string>();
  const [notice, setNotice] = useState("Local repository monitoring is active");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [showIdentities, setShowIdentities] = useState(false);
  const [identityPrompt, setIdentityPrompt] = useState<{ owner: string; repositoryId: string }>();
  const [menu, setMenu] = useState<{ repository: Repository; x: number; y: number }>();
  const [configRepo, setConfigRepo] = useState<Repository>();
  const [addRepo, setAddRepo] = useState<"choose" | "create">();

  async function reload() { const [repos, ids] = await Promise.all([api.repositories(), api.identities()]); setRepositories(repos); setIdentities(ids); }
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

  const visible = useMemo(() => repositories.filter((repo) => {
    const haystack = [repo.displayName, repo.localPath, repo.canonicalRemote, repo.identity?.label, ...repo.tags].join(" ").toLowerCase();
    const matchesQuery = haystack.includes(query.toLowerCase());
    const changes = repo.stagedCount + repo.modifiedCount + repo.untrackedCount;
    const matchesFilter = filter === "all" || (filter === "dirty" && changes > 0) || (filter === "ahead" && repo.ahead > 0) || (filter === "behind" && repo.behind > 0) || (filter === "mismatch" && repo.identityMismatch);
    return matchesQuery && matchesFilter;
  }), [repositories, query, filter]);

  useEffect(() => { setSelectedIndex((index) => Math.max(0, Math.min(index, visible.length - 1))); }, [visible.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, select, textarea") || showIdentities || configRepo || menu || addRepo) return;
      const shortcut = repositoryActions.findIndex((item) => item.key.toLowerCase() === event.key.toLowerCase());
      if (shortcut >= 0 && visible[selectedIndex]) { event.preventDefault(); setActionIndex(shortcut); void action(visible[selectedIndex], repositoryActions[shortcut].id); return; }
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "ArrowUp") setSelectedIndex((i) => Math.max(0, i - 1));
      if (event.key === "ArrowDown") setSelectedIndex((i) => Math.min(visible.length - 1, i + 1));
      if (event.key === "ArrowLeft") setActionIndex((i) => (i + repositoryActions.length - 1) % repositoryActions.length);
      if (event.key === "ArrowRight") setActionIndex((i) => (i + 1) % repositoryActions.length);
      if (event.key === "Enter" && visible[selectedIndex]) void action(visible[selectedIndex], repositoryActions[actionIndex].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedIndex, actionIndex, showIdentities, configRepo, menu, addRepo]);

  async function action(repo: Repository, name: string) {
    setBusy(repo.id);
    try {
      if (name === "editor") await api.openEditor(repo.id);
      else if (name === "hosted") await api.openHosted(repo.id);
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
    const next = [...repositories];
    const from = next.findIndex((r) => r.id === dragged), to = next.findIndex((r) => r.id === onId);
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
        <button className="active"><FolderGit2 />Repositories <span>{repositories.length}</span></button>
        <button onClick={() => setShowIdentities(true)}><ShieldCheck />Identities <span>{identities.length}</span></button>
        <button><Bell />Automation</button>
      </nav>
      <div className="aside-bottom"><button><Settings />Settings</button><div className="watch-state"><i />Guardian running<span>Last scan just now</span></div></div>
    </aside>

    <main>
      <header><div><p>Workspace</p><h1>Your repositories</h1></div><div className="header-actions"><button><Bell size={18} /></button><button className="import" onClick={() => setAddRepo("choose")}><Plus size={17} />Add repository</button></div></header>
      <section className="toolbar">
        <label className="search"><Search size={18} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search repositories, identities, tags, paths…" /><kbd>⌘ K</kbd></label>
        <label className="filter"><SlidersHorizontal size={17} /><select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}><option value="all">All repositories</option><option value="dirty">Has changes</option><option value="ahead">Ahead</option><option value="behind">Behind</option><option value="mismatch">Identity mismatch</option></select><ChevronDown size={15} /></label>
      </section>
      <div className="summary"><span><b>{visible.length}</b> repositories</span><span><i className="ok" />{repositories.filter((r) => !r.behind).length} up to date</span><span><i className="warn" />{repositories.filter((r) => r.behind).length} need attention</span></div>
      <section className="repo-grid">
        {visible.map((repo, index) => <RepositoryCard key={repo.id} repository={repo} selected={index === selectedIndex} actionIndex={actionIndex} busy={busy === repo.id} onSelect={() => setSelectedIndex(index)} onAction={(name) => action(repo, name)} onConfigure={() => { setMenu(undefined); setConfigRepo(repo); }} onContextMenu={(event) => setMenu({ repository: repo, x: event.clientX, y: event.clientY })} onDragStart={() => setDragged(repo.id)} onDrop={() => drop(repo.id)} />)}
        {!visible.length && <div className="empty"><FolderGit2 /><h2>No repositories found</h2><p>Try another search or add a local Git repository.</p></div>}
      </section>
      <div className="toast"><i />{notice}</div>
      {showIdentities && <IdentitiesPanel identities={identities} repositories={repositories} inferredOwner={identityPrompt?.owner} pendingRepositoryId={identityPrompt?.repositoryId} onClose={() => { setShowIdentities(false); setIdentityPrompt(undefined); }} onChanged={reload} />}
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
