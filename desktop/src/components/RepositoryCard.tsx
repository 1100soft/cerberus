import { AlertTriangle, ArrowDown, ArrowUp, Check, CircleDot, CloudDownload, ExternalLink, FolderOpen, GitBranch, Globe, GripVertical, Lock, Settings2, UserRound } from "lucide-react";
import { CursorIcon, VSCodeIcon } from "./Icons";
import { Select } from "./Select";
import { useEffect, useState } from "react";
import { associatedIdentity, isLocal, ownerColor, repositoryControls, repositoryOwner, repositoryVisibility } from "../lib/repositories";
import type { Identity, Repository } from "../types";

function AccountBadge({ identity }: { identity?: Identity }) {
  const username = identity?.providerUsername;
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [username]);
  const tooltip = username ? `@${username}` : identity ? identity.label : "No account assigned";
  if (username && !failed) {
    return <img className="account-badge" src={`https://github.com/${username}.png?size=40`} alt="" title={tooltip} onError={() => setFailed(true)} />;
  }
  return <span className={`account-badge ${identity ? "assigned" : "unassigned"}`} title={tooltip} aria-label={tooltip}>
    {identity ? identity.label.slice(0, 1).toUpperCase() : <UserRound />}
  </span>;
}

type Props = {
  repository: Repository; identities: Identity[];
  onAssignIdentity: (identityId: string) => Promise<void>;
  selected: boolean; actionIndex: number; busy?: boolean;
  onSelect: (controlIndex?: number, focus?: boolean) => void;
  onAction: (action: string) => void;
  onConfigure: () => void; onContextMenu: (event: React.MouseEvent) => void;
  onDragStart: () => void; onDrop: () => void;
};
export function RepositoryCard({ repository: repo, identities, onAssignIdentity, selected, actionIndex, busy, onSelect, onAction, onConfigure, onContextMenu, onDragStart, onDrop }: Props) {
  const [assigning, setAssigning] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [identityError, setIdentityError] = useState("");
  const local = isLocal(repo);
  const changes = repo.stagedCount + repo.modifiedCount + repo.untrackedCount;
  const owner = repositoryOwner(repo);
  const controls = repositoryControls(repo);
  const visibility = repositoryVisibility(repo);
  const account = associatedIdentity(repo, identities);
  const visibilityDetail = repo.github ? `${repo.github.private ? "Private" : "Public"} GitHub repository` : repo.hostType === 'github' ? 'Visibility unverified. Refresh GitHub or reconnect the account with repository access.' : 'Visibility is not verified for this host.';
  const icons: Record<string, React.ReactNode> = { editor: <VSCodeIcon />, cursor: <CursorIcon />, hosted: <ExternalLink />, configure: <Settings2 />, clone: <CloudDownload />, locate: <FolderOpen /> };
  useEffect(() => { if (!selected) setAssignOpen(false); }, [selected]);
  async function assign(identityId: string) {
    setAssigning(true); setIdentityError("");
    try { await onAssignIdentity(identityId); } catch (error) { setIdentityError(String(error)); } finally { setAssigning(false); setAssignOpen(false); }
  }
  return <article className={`repo-row ${selected ? "selected" : ""} ${local ? "repo-local" : "repo-remote"}`}
    style={{ "--owner-color": ownerColor(owner) } as React.CSSProperties} data-repository-id={repo.id}
    title={local ? `Local checkout: ${repo.localPath}` : repo.localPath ? `Linked folder unavailable: ${repo.localPath}. Link an existing checkout or clone a new one.` : 'No local folder linked. A checkout may already exist; link it or clone a new one.'}
    tabIndex={selected ? 0 : -1}
    onPointerDown={(event) => { if (!(event.target as HTMLElement).closest("button")) onSelect(); }}
    onFocus={(event) => { if (event.target === event.currentTarget) onSelect(); }}
    onClick={(event) => { if (!(event.target as HTMLElement).closest("button")) onSelect(); }}
    onDoubleClick={(event) => { if (local && !(event.target as HTMLElement).closest("button, .drag-handle")) onConfigure(); }}
    onContextMenu={(event) => { event.preventDefault(); onSelect(); onContextMenu(event); }}
    draggable={local} onDragStart={onDragStart} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
    <GripVertical className="drag-handle" />
    <span className="repo-owner" title={`Owner: ${owner}`}>{owner}</span>
    <div className="row-heading">
      <AccountBadge identity={account} />
      <strong className="row-name" title={repo.displayName}>{repo.displayName}</strong>
    </div>
    <span className={`repo-visibility ${visibility}`} title={visibilityDetail} aria-label={visibilityDetail}>{repo.github ? (repo.github.private ? <Lock /> : <Globe />) : <span>?</span>}</span>
    <div className="repo-state">
      {local && <><span className="branch" title={`Working branch: ${repo.branch ?? "Detached HEAD"}`}><GitBranch />{repo.branch ?? "Detached HEAD"}</span>
      <span className={`ahead-count ${repo.ahead ? "ahead" : "muted"}`} title={`${repo.ahead} commits ahead`}><ArrowUp />{repo.ahead}</span>
      <span className={repo.behind ? "behind" : "muted"} title={`${repo.behind} commits behind`}><ArrowDown />{repo.behind}</span>
      <span className={`change-indicator ${changes ? "changes" : "clean"}`} title={changes ? `${changes} changes: ${repo.stagedCount} staged, ${repo.modifiedCount} modified, ${repo.untrackedCount} untracked` : "Working tree clean"} aria-label={changes ? "Has changes" : "Working tree clean"}>{changes ? <CircleDot /> : <Check />}</span></>}
      {repo.identityMismatch && <AlertTriangle className="row-warning" aria-label="Identity mismatch" />}
    </div>
    {selected && <div className="row-panel" aria-label={`Controls for ${repo.displayName}`}>
      <div className="row-actions">{controls.map((control, index) => control.id === 'identity'
        ? <span key={control.id} className="assign-account">
            <button data-control-index={index} className={`identity ${actionIndex === index ? "chosen" : ""}`} disabled={assigning || busy}
              tabIndex={actionIndex === index ? 0 : -1} onPointerEnter={() => onSelect(index, true)} onFocus={() => onSelect(index)}
              onClick={() => { onSelect(index); setAssignOpen(true); }} onDoubleClick={event => event.stopPropagation()}
              title={identityError || `${control.label} (${control.key})`} aria-label={control.label} aria-haspopup="listbox" aria-expanded={assignOpen}>
              <UserRound /><kbd>{control.key}</kbd>
            </button>
            {assignOpen && <Select className="identity-menu" label={control.label} autoOpen tabIndex={-1} onClose={() => setAssignOpen(false)}
              value={repo.identity?.id ?? ""} disabled={assigning || busy} onChange={assign}
              options={[{ value: "", label: "Unassigned" }, ...identities.map(identity => ({ value: identity.id, label: identity.providerUsername ? `@${identity.providerUsername}` : identity.label }))]} />}
          </span>
        : <button key={control.id} data-control-index={index} className={actionIndex === index ? "chosen" : ""} disabled={busy}
            tabIndex={actionIndex === index ? 0 : -1} onPointerEnter={() => onSelect(index, true)} onFocus={() => onSelect(index)}
            onClick={() => { onSelect(index); onAction(control.id); }} onDoubleClick={event => event.stopPropagation()} title={`${control.label} (${control.key})`} aria-label={control.label}>
            {icons[control.id]}{control.id === 'locate' && <span>Link folder</span>}{control.id === 'clone' && <span>Clone</span>}<kbd>{control.key}</kbd>
          </button>)}</div>
      {identityError && <span className="identity-error" role="alert">{identityError}</span>}
    </div>}
  </article>;
}
