import { ChatgptLoginDialog } from './components/ChatgptIdentities';
import { revealRepository } from './lib/repositoryScroll';
import { useWorkspaceFocus } from './lib/workspaceFocus';
import { matchesShortcut, shortcuts } from './lib/shortcuts';
import { ProviderSetup, type Provider } from "./components/ProviderSetup";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownWideNarrow, Bell, Clock3, FolderGit2, ListFilter, Plus, Search, Settings, ShieldCheck } from "lucide-react";
import { AgentsPanel } from "./components/AgentsPanel";
import { SavedPromptsPanel } from "./components/SavedPromptsPanel";
import { Select } from "./components/Select";
import { CodexHistory } from "./components/CodexHistory";
import { CommitHistory } from "./components/CommitHistory";
import { RepositoryCard } from "./components/RepositoryCard";
import { NotificationCenter } from './components/NotificationCenter';
import { useZoomTooltips } from './components/ZoomTooltips';
import { isLocal, mergeRepositories, repositoryControls, selectRepositoryControl, repositoryOwner, filterAndSortRepositories, filterMatchCount, readRepositoryFilters, defaultRepositoryFilters, type RepositoryFilters, type RepositorySelection, type StatusFilter } from "./lib/repositories";
import { IdentitiesPanel } from "./components/IdentitiesPanel";
import { RepositoryConfigDialog } from "./components/RepositoryConfigDialog";
import { RepositoryContextMenu, type ContextAction } from "./components/RepositoryContextMenu";
import { AddRepositoryChooser } from "./components/AddRepositoryChooser";
import { api, inTauri } from "./lib/api";
import { listen } from '@tauri-apps/api/event';
import { useCardReorder } from './lib/cardReorder';
import { watchCursorCompletion } from "./lib/conversationCache";
import { startSavedPromptScheduler, type AutomationDraft } from "./lib/savedPrompts";
import { useChatgptAccounts } from "./lib/chatgptAccounts";
import { useExternalIdentities } from "./lib/externalIdentities";
import type { GithubRepository, Identity, ImportResult, Repository, RepositoryUpdate } from "./types";

function mergeChangedLines(current:Record<string,number>,updates:Record<string,number>){
  return Object.entries(updates).some(([id,count])=>current[id]!==count)?{...current,...updates}:current;
}
function sameRepositoryList(current:Repository[],next:Repository[]){
  return current.length===next.length&&current.every((repo,index)=>JSON.stringify(repo)===JSON.stringify(next[index]));
}

export function App() {
  useEffect(() => { document.body.classList.add("custom-tooltips"); return () => document.body.classList.remove("custom-tooltips"); }, []);
  useZoomTooltips();
  useEffect(() => watchCursorCompletion(), []);
  useEffect(() => startSavedPromptScheduler(), []);
  const [paneSplit, setPaneSplit] = useState(() => Number(localStorage.getItem("gitcerberus.paneSplit")) || 50);
  const [localRepositories, setRepositories] = useState<Repository[]>([]);
  const [query, setQuery] = useState("");
  const [listFilters, setListFilters] = useState(() => readRepositoryFilters(localStorage.getItem("gitcerberus.repositoryFilters")));
  useEffect(() => { localStorage.setItem("gitcerberus.repositoryFilters", JSON.stringify(listFilters)); }, [listFilters]);
  const [showFilters, setShowFilters] = useState(false);
  const filterAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest('.app-select-menu')) return;
      if (!filterAnchor.current?.contains(target)) setShowFilters(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.app-select-menu')) return;
      if (showFilters) filterAnchor.current?.querySelector('button')?.focus();
      setShowFilters(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [showFilters]);
  useLayoutEffect(() => {
    const position = () => {
      for (const anchor of [filterAnchor.current]) {
        const panel = anchor?.querySelector<HTMLElement>('.repo-filters, .repo-sort');
        if (!panel || !anchor) continue;
        panel.style.left = '0px';
        const rect = panel.getBoundingClientRect();
        const zoom = anchor.getBoundingClientRect().width / anchor.offsetWidth || 1;
        panel.style.left = `${Math.min(0, (window.innerWidth - 8 - rect.right) / zoom)}px`;
        panel.style.maxHeight = `${Math.max(100, (window.innerHeight - rect.top - 8) / zoom)}px`;
      }
    };
    position(); window.addEventListener('resize', position);
    const observer = new MutationObserver(position);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => { window.removeEventListener('resize', position); observer.disconnect(); };
  }, [showFilters]);
  const [busy, setBusy] = useState<string>();
  const [changedLines,setChangedLines]=useState<Record<string,number>>({});
  const [notice, setNotice] = useState("");
  const [selection, setSelection] = useState<RepositorySelection>({ repositoryId: '', controlIndex: 0 });
  const [githubRepositories, setGithubRepositories] = useState<GithubRepository[]>([]);
  const [githubWarnings, setGithubWarnings] = useState<string[]>([]);
  const [syncingGithub, setSyncingGithub] = useState(false);
  const [githubReady, setGithubReady] = useState(false);
  const catalogGeneration = useRef(0);
  const lastCatalogSync = useRef(0);
  const catalogInFlight = useRef(false);
  const repositories = useMemo(() => mergeRepositories(localRepositories, githubRepositories), [localRepositories, githubRepositories]);
  const localIds=localRepositories.map(repo=>repo.id).join('|');
  useEffect(()=>{
    let cancelled=false;
    void api.repositoryChangedLinesBatch(localRepositories.filter(isLocal).map(repo=>repo.id)).then(counts=>{if(!cancelled)setChangedLines(current=>mergeChangedLines(current,counts));}).catch(()=>{});
    return()=>{cancelled=true;};
  },[localIds]);
  useEffect(()=>{
    if(!inTauri())return;
    let stopped=false;let unlisten:(()=>void)|undefined;let unlistenGit:(()=>void)|undefined;
    const timers=new Map<string,number>();
    void listen<{repositoryId:string}>('automation-file-change',event=>{
      const id=event.payload.repositoryId;
      window.clearTimeout(timers.get(id));
      timers.set(id,window.setTimeout(()=>void api.repositoryChangedLines(id).then(count=>setChangedLines(current=>mergeChangedLines(current,{[id]:count}))).catch(()=>{}),500));
    }).then(stop=>{if(stopped)stop();else unlisten=stop;});
    void listen<{repositoryId:string}>('automation-git-change',event=>{
      const id=event.payload.repositoryId;
      window.clearTimeout(timers.get(id));
      timers.set(id,window.setTimeout(()=>void Promise.allSettled([api.repositoryChangedLines(id),api.refresh(id)]).then(([count,repo])=>{
        if(count.status==='fulfilled')setChangedLines(current=>mergeChangedLines(current,{[id]:count.value}));
        if(repo.status==='fulfilled')setRepositories(current=>current.map(item=>item.id===id?repo.value:item));
      }),300));
    }).then(stop=>{if(stopped)stop();else unlistenGit=stop;});
    return()=>{stopped=true;unlisten?.();unlistenGit?.();for(const timeout of timers.values())window.clearTimeout(timeout);};
  },[]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const chatgptAccounts = useChatgptAccounts();
  const externalAccounts = useExternalIdentities();
  const [providerSetup, setProviderSetup] = useState<Provider>();
  const [cursorConversation, setCursorConversation] = useState<{ repositoryId: string; id?: string }>();
  const reportCursorConversation = useCallback((repositoryId: string, id?: string) => {
    setCursorConversation(current => current?.repositoryId === repositoryId && current.id === id ? current : { repositoryId, id });
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('sidebar-open') === 'true');
  useEffect(() => { localStorage.setItem('sidebar-open', String(sidebarOpen)); }, [sidebarOpen]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [showAutomation, setShowAutomation] = useState(false);
  const [automationDraft,setAutomationDraft]=useState<AutomationDraft>();
  useEffect(()=>{const open=(event:Event)=>{setAutomationDraft((event as CustomEvent<AutomationDraft>).detail);setShowAutomation(true);setShowAgents(false);setShowIdentities(false);};window.addEventListener('new-automation-from-prompt',open);return()=>window.removeEventListener('new-automation-from-prompt',open);},[]);
  const [showIdentities, setShowIdentities] = useState(false);
  const [startGithubLogin, setStartGithubLogin] = useState(false);
  const [startExternalLogin, setStartExternalLogin] = useState<'cursor'|'claude'>();
  const [identityPrompt, setIdentityPrompt] = useState<{ owner: string; repositoryId: string }>();
  const [menu, setMenu] = useState<{ repository: Repository; x: number; y: number }>();
  const [configRepo, setConfigRepo] = useState<Repository>();
  const [addRepo, setAddRepo] = useState<"choose" | "create">();

  async function syncGithub(force = false) {
    if (catalogInFlight.current || (!force && Date.now() - lastCatalogSync.current < 300000)) return;
    catalogInFlight.current = true;
    const generation = ++catalogGeneration.current;
    setSyncingGithub(true);
    try {
      const catalog = await api.githubRepositories();
      const refreshed = await api.repositories();
      if (generation !== catalogGeneration.current) return;
      setRepositories(refreshed);
      setGithubRepositories(current => [...current.filter(repo => catalog.failedIdentityIds?.includes(repo.identityId)), ...catalog.repositories]); setGithubWarnings(catalog.warnings);
      setGithubReady(true); lastCatalogSync.current = Date.now();
    } catch (error) { if (generation === catalogGeneration.current) setGithubWarnings([String(error)]); }
    finally { catalogInFlight.current = false; if (generation === catalogGeneration.current) setSyncingGithub(false); }
  }
  async function reload() { await Promise.all([api.repositories().then(setRepositories), api.identities().then(setIdentities)]); void syncGithub(true); }
  useEffect(() => { void reload().then(() => { if (!inTauri()) return; requestAnimationFrame(() => { void api.syncRepositoryRemotes().then(updated => { const byId = new Map(updated.map(repo => [repo.id, repo])); setRepositories(current => current.map(repo => { const next = byId.get(repo.id); return next ? {...repo, canonicalRemote: next.canonicalRemote, hostType: next.hostType} : repo; })); }).catch(() => {}); }); }).catch((e) => setNotice(String(e))); }, []);
  useEffect(() => {
    const syncLocal = () => { api.repositories().then(items=>{setRepositories(current=>sameRepositoryList(current,items)?current:items);void api.repositoryChangedLinesBatch(items.filter(isLocal).map(repo=>repo.id)).then(counts=>setChangedLines(current=>mergeChangedLines(current,counts))).catch(()=>{});}).catch((error) => setNotice(String(error))); };
    const onVisible = () => { if (!document.hidden) { syncLocal(); void syncGithub(); } };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const poll = window.setInterval(() => { if (!document.hidden) { syncLocal(); void syncGithub(); } }, 30000);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    const minimum = 0.75, maximum = 2, step = 0.1;
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
      if (!(['view.zoomIn', 'view.zoomOut', 'view.zoomReset'] as const).some(command => matchesShortcut(event, command))) return;
      event.preventDefault();
      if (matchesShortcut(event, 'view.zoomReset')) apply(1);
      else apply(zoom + (matchesShortcut(event, 'view.zoomIn') ? step : -step));
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
  const ownerOptions = [...new Set([...owners, ...listFilters.owners])].sort((a, b) => a.localeCompare(b));
  const selectedOwners = listFilters.ownersExplicit || listFilters.owners.length ? listFilters.owners : ownerOptions;
  const allOwnersSelected = ownerOptions.length > 0 && ownerOptions.every(owner => selectedOwners.includes(owner));
  const visible = useMemo(() => filterAndSortRepositories(repositories, listFilters, query), [repositories, query, listFilters]);
  const reorderCards=useCardReorder(visible.filter(isLocal).map(repo=>repo.id),ids=>{
    const previous=localRepositories;
    const byId=new Map(previous.map(repo=>[repo.id,repo]));
    const selected=new Set(ids),remaining=ids[Symbol.iterator]();
    const fullIds=previous.slice().sort((a,b)=>a.manualOrder-b.manualOrder).map(repo=>selected.has(repo.id)?remaining.next().value as string:repo.id);
    setRepositories(fullIds.map((id,index)=>({...byId.get(id)!,manualOrder:index})));
    setListFilters(current=>({...current,sort:'manual'}));
    void api.reorder(fullIds).catch(error=>{setRepositories(previous);setNotice(`Could not save repository order: ${String(error)}`);});
  });
  const counted = (patch: Partial<RepositoryFilters>) => filterMatchCount(repositories, listFilters, query, patch);
  const filtersActive = !!listFilters.ownersExplicit || listFilters.owners.length > 0 || listFilters.visibility !== defaultRepositoryFilters.visibility || listFilters.presence !== defaultRepositoryFilters.presence || listFilters.status !== defaultRepositoryFilters.status;

  const normalizedSelection = selectRepositoryControl(visible, selection.repositoryId, selection.controlIndex);
  const selectedIndex = visible.findIndex(repo => repo.id === normalizedSelection.repositoryId);
  const selectedRepository = visible[selectedIndex];
  const actionIndex = normalizedSelection.controlIndex;
  const historyRepository = selectedRepository && isLocal(selectedRepository) ? selectedRepository : undefined;
  useWorkspaceFocus(!providerSetup && !configRepo && !addRepo && !menu && !showAgents && !showIdentities && !showAutomation, historyRepository?.id);
  function selectControl(repositoryId: string, controlIndex = actionIndex, focus = false, list = visible) {
    const next = selectRepositoryControl(list, repositoryId, controlIndex);
    setSelection(next);
    requestAnimationFrame(() => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-repository-id]')].find(row => row.dataset.repositoryId === next.repositoryId);
      const control = row?.querySelector<HTMLElement>(`[data-control-index="${next.controlIndex}"]`);
      if (focus) (control || row)?.focus({ preventScroll: true });
      if (row) revealRepository(row);
    });
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!document.querySelector('[role=dialog]') && !providerSetup && !configRepo && !menu && !addRepo && !document.querySelector('[role=listbox]')) {
        if (matchesShortcut(event, 'repository.focus')) {
          event.preventDefault(); setSidebarOpen(false); setShowShortcuts(false);
          if (!showIdentities && !showAgents && !showAutomation && selectedRepository) selectControl(selectedRepository.id, actionIndex, true);
          return;
        }
        if (!showIdentities && !showAgents && !showAutomation && (matchesShortcut(event, 'conversation.previous') || matchesShortcut(event, 'conversation.next'))) {
          event.preventDefault(); window.dispatchEvent(new CustomEvent('conversation-cycle', {detail: matchesShortcut(event, 'conversation.previous') ? -1 : 1})); return;
        }
      }
      if (!document.querySelector('[role=dialog], [role=listbox]') && !showIdentities && !showAgents && !showAutomation && matchesShortcut(event, 'search.repositories') && !(event.target as HTMLElement).closest('input,textarea,[contenteditable=true]')) {
        event.preventDefault(); document.querySelector<HTMLInputElement>('.search input')?.focus(); return;
      }
      if (event.defaultPrevented || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, select, textarea, [role=listbox], .history-panel, .codex-panel") || (target.closest('button') && !target.closest('.row-actions')) || showShortcuts || providerSetup || showIdentities || showAgents || showAutomation || configRepo || menu || addRepo || busy) return;
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
      if (!(['repository.previous', 'repository.next', 'control.previous', 'control.next', 'control.activate'] as const).some(command => matchesShortcut(event, command))) return;
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
  }, [sidebarOpen, showShortcuts, providerSetup, visible, selectedIndex, actionIndex, showIdentities, showAgents, showAutomation, configRepo, menu, addRepo, busy]);

  useEffect(()=>{const show=(event:Event)=>{const detail=(event as CustomEvent<{githubLogin?:boolean;externalLogin?:'cursor'|'claude'}>).detail;setProviderSetup(undefined);setStartGithubLogin(!!detail?.githubLogin);setStartExternalLogin(detail?.externalLogin);setShowIdentities(true);setShowAgents(false);setShowAutomation(false);};window.addEventListener('show-identities',show);return()=>window.removeEventListener('show-identities',show);},[]);
  async function action(repo: Repository, name: string) {
    if (busy) return;
    if (name === 'chat') { requestAnimationFrame(() => document.querySelector<HTMLElement>('.codex-thread-list button.active, .codex-thread-list button.provider-codex, .codex-thread-list button, .conversation-search input')?.focus()); return; }
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
      else if (name === "cursor") await api.openCursor(repo.id, cursorConversation?.repositoryId === repo.id ? cursorConversation.id : undefined);
      else if (name === "folder") await api.openLocalFolder(repo.id);
      else if (name === "refresh") {
        const updated = await api.refresh(repo.id);
        setRepositories((items) => items.map((r) => r.id === updated.id ? updated : r));
        const count=await api.repositoryChangedLines(repo.id);setChangedLines(current=>({...current,[repo.id]:count}));
      }
      else {
        await api.git(repo.id, name);
        const updated = await api.refresh(repo.id);
        setRepositories((items) => items.map((r) => r.id === updated.id ? updated : r));
        const count=await api.repositoryChangedLines(repo.id);setChangedLines(current=>({...current,[repo.id]:count}));
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

  return <div className={`shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
    <NotificationCenter repositories={repositories}/>
    <button className="app-menu-toggle" aria-label="Toggle navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(open => !open)} title="GitCerberus navigation"><ShieldCheck /></button>
    <aside hidden={!sidebarOpen}>
      <div className="brand"><div className="brand-mark"><ShieldCheck /></div><div><b>GitCerberus</b><span>Repository guardian</span></div></div>
      <nav>
        <button className={!showIdentities && !showAgents && !showAutomation ? "active" : ""} onClick={() => { setShowIdentities(false); setShowAgents(false); setShowAutomation(false); setIdentityPrompt(undefined); }}><FolderGit2 /><span className="nav-label">Repositories</span><span className="nav-count">{repositories.length}</span></button>
        <button className={showIdentities ? "active" : ""} onClick={() => { setShowAgents(false); setShowAutomation(false); setShowIdentities(true); }}><ShieldCheck /><span className="nav-label">Identities</span><span className="nav-count">{identities.length}</span></button>
        <button className={showAgents ? "active" : ""} onClick={() => { setShowAgents(true); setShowIdentities(false); setShowAutomation(false); }}><Bell /><span className="nav-label">Agents</span></button>
        <button className={showAutomation ? "active" : ""} onClick={() => { setAutomationDraft(undefined); setShowAutomation(true); setShowAgents(false); setShowIdentities(false); }}><Clock3 /><span className="nav-label">Automation</span></button>
      </nav>
      <div className="aside-bottom"><button onClick={() => { setShowShortcuts(open => !open); }}><Settings />Keyboard shortcuts</button><div className="watch-state"><i />Guardian running<span>Last scan just now</span></div></div>
    </aside>

    <main style={{ "--pane-top": `${paneSplit}fr`, "--pane-bottom": `${100 - paneSplit}fr` } as React.CSSProperties}>
      {!showIdentities && !showAgents && !showAutomation && <>
      <section className="toolbar">
        <label className="search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" /></label>
        <div className="toolbar-popover" ref={filterAnchor}>
        <button type="button" className={`toolbar-icon ${showFilters ? "active" : ""} ${filtersActive ? "armed" : ""}`} aria-pressed={showFilters} aria-expanded={showFilters} aria-controls="repository-filters" aria-label="Filter repositories" title="Filter repositories" onClick={() => setShowFilters(open => !open)}><ListFilter size={16} /></button>
        {showFilters && <div id="repository-filters" className="repo-filters" aria-label="Repository filters">
          <Select label="Filter by status" title="Working tree and identity status" value={listFilters.status} onChange={status => setListFilters(current => ({ ...current, status: status as StatusFilter }))} options={[
            { value: 'all', label: 'All statuses', count: counted({ status: 'all' }) },
            { value: 'dirty', label: 'Has changes', count: counted({ status: 'dirty' }) },
            { value: 'ahead', label: 'Ahead', count: counted({ status: 'ahead' }) },
            { value: 'behind', label: 'Behind', count: counted({ status: 'behind' }) },
            { value: 'mismatch', label: 'Identity mismatch', count: counted({ status: 'mismatch' }) },
          ]} />
          <Select label="Filter by visibility" title="Repository visibility" value={listFilters.visibility} onChange={visibility => setListFilters(current => ({ ...current, visibility }))} options={[
            { value: 'all', label: 'Any visibility', count: counted({ visibility: 'all' }) },
            { value: 'public', label: 'Public', count: counted({ visibility: 'public' }) },
            { value: 'private', label: 'Private', count: counted({ visibility: 'private' }) },
            { value: 'unverified', label: 'Unverified', count: counted({ visibility: 'unverified' }) },
          ]} />
          <Select label="Filter by local presence" title="Whether a local checkout is linked" value={listFilters.presence} onChange={presence => setListFilters(current => ({ ...current, presence }))} options={[
            { value: 'all', label: 'Any location', count: counted({ presence: 'all' }) },
            { value: 'local', label: 'Linked locally', count: counted({ presence: 'local' }) },
            { value: 'unlinked', label: 'Folder not linked', count: counted({ presence: 'unlinked' }) },
          ]} />
          <fieldset className="owner-filter">
            <legend>Owners</legend>
            <div className="owner-checks">
              <label className="owner-select-all"><input type="checkbox" aria-label="Select all owners" checked={allOwnersSelected}
                ref={node => { if (node) node.indeterminate = !allOwnersSelected && selectedOwners.length > 0; }}
                onChange={() => setListFilters(current => ({ ...current, owners: [], ownersExplicit: allOwnersSelected }))} /><span>Select all</span></label>
              {ownerOptions.map(owner => {
                const count = counted({ owners: [owner], ownersExplicit: true });
                return <label key={owner} title={`${count} ${count === 1 ? 'repository' : 'repositories'}`}>
                  <input type="checkbox" checked={selectedOwners.includes(owner)} onChange={() => setListFilters(current => ({
                    ...current,
                    ownersExplicit: true,
                    owners: selectedOwners.includes(owner) ? selectedOwners.filter(item => item !== owner) : [...selectedOwners, owner],
                  }))} />
                  <span>{owner}</span>
                  <span className="option-count">{count}</span>
                </label>;
              })}
            </div>
          </fieldset>
        </div>}

        </div>
        <Select className={`toolbar-icon sort-trigger ${listFilters.sort !== "manual" ? "armed" : ""}`} triggerContent={<ArrowDownWideNarrow size={16} />} label="Sort repositories" title="Sort repositories. Last updated uses local commit time or GitHub’s last push, with uncommitted work first." value={listFilters.sort} onChange={sort => setListFilters(current => ({ ...current, sort }))} options={[{ value: 'manual', label: 'Manual order' }, { value: 'name', label: 'Name A–Z' }, { value: 'updated', label: 'Last updated' }, { value: 'changes', label: 'Most changes' }, { value: 'owner', label: 'Owner A–Z' }]} />
        <button type="button" className="toolbar-icon" aria-label="Add repository" title="Add a local repository that GitHub did not list" onClick={() => setAddRepo("choose")}><Plus size={16} /></button>
      </section>
      <div className="summary">{notice && <div className="app-notice" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}<span><b>{visible.length}</b> repositories</span><span><i className="ok" />{repositories.filter(isLocal).length} local</span><span><i className="warn" />{repositories.filter(repo => !isLocal(repo)).length} without a linked folder</span>{syncingGithub && <span>Updating GitHub…</span>}{githubWarnings.length > 0 && <span className="github-warning" role="status" title={githubWarnings.join("\n")}>{githubWarnings.join(" ")}</span>}</div>
      <div className="repository-workspace">
      <div className="repository-list-column">
      <section className="repo-grid" tabIndex={-1}>
        {visible.map((repo, index) => <RepositoryCard key={repo.id} repository={repo} identities={identities} chatgpt={chatgptAccounts} external={externalAccounts} catalog={githubReady ? githubRepositories : undefined} onAssignIdentity={async (identityId) => { await api.assignIdentity(repo.id, identityId); setRepositories(await api.repositories()); setNotice(`Updated identity for ${repo.displayName}`); }} selected={index === selectedIndex} actionIndex={actionIndex} busy={!!busy} onSelect={(controlIndex, focus) => selectControl(repo.id, controlIndex, focus)} onAction={(name) => action(repo, name)} onConfigure={() => { setMenu(undefined); setConfigRepo(repo); }} onContextMenu={(event) => setMenu({ repository: repo, x: event.clientX, y: event.clientY })} dragSource={isLocal(repo)?reorderCards.source(repo.id,repo.displayName):undefined} dragItem={isLocal(repo)?reorderCards.item(repo.id):undefined} changedLines={changedLines[repo.id]}/>) }
        {!visible.length && <div className="empty"><FolderGit2 /><h2>No repositories found</h2><p>Try another search or add a local Git repository.</p></div>}
      </section>
      </div>
      <CommitHistory unlinkedName={selectedRepository && !isLocal(selectedRepository) ? selectedRepository.displayName : undefined} key={historyRepository?.id ?? "none"} repository={historyRepository} shortcutsEnabled={!providerSetup && !showShortcuts && !configRepo && !menu && !addRepo} />
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
      <CodexHistory onSetup={setProviderSetup} onCursorConversation={reportCursorConversation} unlinkedName={selectedRepository && !isLocal(selectedRepository) ? selectedRepository.displayName : undefined} repository={historyRepository} />
      </>}
      {showShortcuts && <section className="shortcut-help" aria-label="Keyboard shortcuts"><header><h2>Keyboard shortcuts</h2><button onClick={() => setShowShortcuts(false)}>Close</button></header>{Object.entries(shortcuts).map(([id,shortcut]) => <p key={id}><kbd>{shortcut.label}</kbd> {shortcut.description}</p>)}<p>Repository action keys are shown on the selected card. Escape closes menus before returning to repository actions.</p></section>}
      <ChatgptLoginDialog onSetup={()=>setProviderSetup('codex')}/>
      {providerSetup && <ProviderSetup provider={providerSetup} onClose={() => setProviderSetup(undefined)} />}
      <AgentsPanel identities={identities} onSetup={setProviderSetup} visible={showAgents} />
      {showAutomation && <section className="automation-page" aria-label="Automation"><SavedPromptsPanel repositories={repositories} profiles={chatgptAccounts.profiles} chatgptSettings={chatgptAccounts.settings} external={externalAccounts} identities={identities} draft={automationDraft}/></section>}
      {showIdentities && <IdentitiesPanel identities={identities} inferredOwner={identityPrompt?.owner} pendingRepositoryId={identityPrompt?.repositoryId} startGithubLogin={startGithubLogin} startExternalLogin={startExternalLogin} onClose={() => { setShowIdentities(false); setIdentityPrompt(undefined); setStartGithubLogin(false); setStartExternalLogin(undefined); }} onChanged={reload} />}
      {menu && <RepositoryContextMenu repository={menu.repository} x={menu.x} y={menu.y} busy={busy === menu.repository.id} onAction={(name) => void contextAction(menu.repository, name)} onClose={() => setMenu(undefined)} />}
      {configRepo && <RepositoryConfigDialog repository={configRepo} identities={identities} catalog={githubReady ? githubRepositories : undefined} onClose={() => setConfigRepo(undefined)} onSave={saveConfig} onRemove={() => removeRepo(configRepo)} />}
      {addRepo === "choose" && <AddRepositoryChooser onClose={() => setAddRepo(undefined)} onImport={importRepo} onCreate={() => setAddRepo("create")} />}
      {addRepo === "create" && <RepositoryConfigDialog identities={identities} catalog={githubReady ? githubRepositories : undefined} onClose={() => setAddRepo(undefined)} onSave={createRepo} />}
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
