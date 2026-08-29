import { Copy, ExternalLink, FolderOpen, ArrowDownToLine, RefreshCw, Settings2, Trash2, Upload } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Repository } from "../types";

function VSCodeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.6 2.4 9.5 9.8 5 6.4 2.4 8v8L5 17.6l4.5-3.4 8.1 7.4 4-1.9V4.3l-4-1.9ZM5.2 14.3v-4.6L7.8 12l-2.6 2.3Zm12.3 2.1-5.4-4.4 5.4-4.4v8.8Z"/></svg>;
}

export type ContextAction =
  | "configure"
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
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const node = menu.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - width - 8),
      top: Math.min(y, window.innerHeight - height - 8)
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
    <button role="menuitem" onClick={() => onAction("configure")}><Settings2 />Configure repository</button>
    <hr />
    <button role="menuitem" disabled={busy} onClick={() => onAction("editor")}><VSCodeIcon />Open in VS Code</button>
    <button role="menuitem" disabled={busy || !repository.canonicalRemote} onClick={() => onAction("hosted")}><ExternalLink />Open hosted repository</button>
    <button role="menuitem" disabled={busy} onClick={() => onAction("folder")}><FolderOpen />Open local folder</button>
    <button role="menuitem" onClick={() => onAction("copy-path")}><Copy />Copy local path</button>
    <hr />
    <button role="menuitem" disabled={busy} onClick={() => onAction("fetch")}><RefreshCw />Fetch</button>
    <button role="menuitem" disabled={busy} onClick={() => onAction("pull")}><ArrowDownToLine />Pull (fast-forward)</button>
    <button role="menuitem" disabled={busy} onClick={() => onAction("push")}><Upload />Push</button>
    <button role="menuitem" disabled={busy} onClick={() => onAction("refresh")}><RefreshCw />Refresh status</button>
    <hr />
    <button role="menuitem" className="danger" onClick={() => onAction("remove")}><Trash2 />Remove from workspace</button>
  </div>;
}
