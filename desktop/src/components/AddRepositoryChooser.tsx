import { FolderGit2, FolderPlus, X } from "lucide-react";

type Props = {
  onImport: () => void;
  onCreate: () => void;
  onClose: () => void;
};

export function AddRepositoryChooser({ onImport, onCreate, onClose }: Props) {
  return <div className="panel-backdrop dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="repo-config chooser">
      <header>
        <div><p>Workspace</p><h2>Add a repository</h2></div>
        <button type="button" onClick={onClose}><X /></button>
      </header>
      <p className="panel-copy">Bring in a project you already have on disk, or start a new Git repository from scratch.</p>
      <div className="chooser-actions">
        <button type="button" onClick={onImport}><FolderGit2 /><span><b>Open existing folder</b><small>Select a local Git repository to monitor</small></span></button>
        <button type="button" onClick={onCreate}><FolderPlus /><span><b>Create new repository</b><small>Initialize Git in a folder and add it here</small></span></button>
      </div>
    </section>
  </div>;
}
