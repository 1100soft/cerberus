import { CloudDownload, Copy, ExternalLink, FolderOpen, ArrowDownToLine, RefreshCw, Settings2, Trash2, Upload } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isLocal } from "../lib/repositories";
import type { Repository } from "../types";
import { CursorIcon, VSCodeIcon } from "./Icons";

export type ContextAction =
  | "configure"
  | "cursor"
  | "clone"
  | "locate"
  | "editor"
  | "hosted"
  | "folder"
  | "copy-path"
  | "fetch"
  | "pull"
  | "push"
  | "refresh"
  | "remove";

type Props = {
  repository: Repository;
  x: number;
  y: number;
  busy?: boolean;
  onAction: (action: ContextAction) => void;
  onClose: () => void;
};

export function RepositoryContextMenu({ repository, x, y, busy, onAction, onClose }: Props) {
  const local = isLocal(repository);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const node = menu.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    const zoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)) / zoom,
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)) / zoom
    });
  }, [x, y]);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return <div ref={menu} className="context-menu" style={{ left: pos.left, top: pos.top }} role="menu">
    <p>{repository.displayName}</p>
    <button role="menuitem" onClick={() => onAction("configure")} disabled={!local}><Settings2 />Configure repository</button>
    <hr />
    {!local && <button role="menuitem" disabled={busy} onClick={() => onAction("locate")}><FolderOpen />Link existing folder</button>}
    {!local && repository.github && <button role="menuitem" disabled={busy} onClick={() => onAction("clone")}><CloudDownload />Clone from GitHub</button>}
    <button role="menuitem" disabled={busy || !local} onClick={() => onAction("editor")}><VSCodeIcon />Open in VS Code</button>
    <button role="menuitem" disabled={busy || !local} onClick={() => onAction("cursor")}><CursorIcon />Open in Cursor</button>
    <button role="menuitem" disabled={busy || !repository.canonicalRemote} onClick={() => onAction("hosted")}><ExternalLink />Open hosted repository</button>
    <button role="menuitem" disabled={busy || !local} onClick={() => onAction("folder")}><FolderOpen />Open local folder</button>
    <button role="menuitem" disabled={!local} onClick={() => onAction("copy-path")}><Copy />Copy local path</button>
    <hr />
    <button role="menuitem" disabled={busy || !local} onClick={() => onAction("fetch")}><RefreshCw />Fetch</button>
    <button role="menuitem" disabled={busy || !local} onClick={() => onAction("pull")}><ArrowDownToLine />Pull (fast-forward)</button>
    <button role="menuitem" disabled={busy || !local} onClick={() => onAction("push")}><Upload />Push</button>
    <button role="menuitem" disabled={busy || !local} onClick={() => onAction("refresh")}><RefreshCw />Refresh status</button>
    <hr />
    <button role="menuitem" className="danger" disabled={repository.id.startsWith("github:")} onClick={() => onAction("remove")}><Trash2 />Remove from workspace</button>
  </div>;
}
