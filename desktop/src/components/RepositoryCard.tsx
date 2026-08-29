import { AlertTriangle, ArrowDown, ArrowUp, ExternalLink, GitBranch, GripVertical, RefreshCw, Upload } from "lucide-react";
import type { Repository } from "../types";

export const repositoryActions = [
  { id: "editor", label: "Open in VS Code", key: "E" },
  { id: "hosted", label: "Open hosted repository", key: "G" },
  { id: "fetch", label: "Fetch", key: "F" },
  { id: "push", label: "Push", key: "P" }
] as const;

function VSCodeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.6 2.4 9.5 9.8 5 6.4 2.4 8v8L5 17.6l4.5-3.4 8.1 7.4 4-1.9V4.3l-4-1.9ZM5.2 14.3v-4.6L7.8 12l-2.6 2.3Zm12.3 2.1-5.4-4.4 5.4-4.4v8.8Z"/></svg>;
}

type Props = {
  repository: Repository;
  selected: boolean;
  actionIndex: number;
  busy?: boolean;
  onSelect: () => void;
  onAction: (action: string) => void;
  onConfigure: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onDragStart: () => void;
  onDrop: () => void;
};

export function RepositoryCard({ repository: repo, selected, actionIndex, busy, onSelect, onAction, onConfigure, onContextMenu, onDragStart, onDrop }: Props) {
  const changes = repo.stagedCount + repo.modifiedCount + repo.untrackedCount;
  const icons = [<VSCodeIcon />, <ExternalLink />, <RefreshCw className={busy ? "spin" : ""} />, <Upload />];
  return <article
    className={`repo-row ${selected ? "selected" : ""}`}
    tabIndex={selected ? 0 : -1}
    onFocus={onSelect}
    onMouseEnter={onSelect}
    onDoubleClick={(event) => {
      if ((event.target as HTMLElement).closest("button, .drag-handle")) return;
      onConfigure();
    }}
    onContextMenu={(event) => {
      event.preventDefault();
      onSelect();
      onContextMenu(event);
    }}
    draggable
    onDragStart={onDragStart}
    onDragOver={(e) => e.preventDefault()}
    onDrop={onDrop}
  >
    <GripVertical className="drag-handle" />
    <span className={`host-dot ${repo.hostType}`} />
    <strong className="row-name">{repo.displayName}</strong>
    {repo.identity ? <span className="identity" style={{ "--identity-color": repo.identity.color } as React.CSSProperties}>{repo.identity.label}</span> : <span className="identity unassigned">Unassigned</span>}
    <span className="branch"><GitBranch />{repo.branch ?? "detached"}</span>
    <span className={repo.ahead ? "ahead" : "muted"}><ArrowUp />{repo.ahead}</span>
    <span className={repo.behind ? "behind" : "muted"}><ArrowDown />{repo.behind}</span>
    <span className={changes ? "changes" : "clean"}>{changes ? `${changes} changed` : "Clean"}</span>
    {repo.identityMismatch && <AlertTriangle className="row-warning" />}
    <div className="row-panel">
      <div className="panel-details"><b>{repo.localPath}</b><span>{repo.lastCommitSummary ?? "No commits"}</span></div>
      <div className="row-actions">{repositoryActions.map((action, index) => <button key={action.id} className={selected && actionIndex === index ? "chosen" : ""} disabled={busy} onClick={() => onAction(action.id)} onDoubleClick={(event) => event.stopPropagation()} title={`${action.label} (${action.key})`}>{icons[index]}<kbd>{action.key}</kbd></button>)}</div>
    </div>
  </article>;
}
