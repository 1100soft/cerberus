import { useState } from "react";
import { X } from "lucide-react";
import { formToUpdate, RepositoryFields, type RepositoryFormValue } from "./RepositoryFields";
import type { Identity, Repository, RepositoryUpdate } from "../types";

type Props = {
  repository?: Repository;
  identities: Identity[];
  onClose: () => void;
  onSave: (update: RepositoryUpdate) => Promise<void>;
  onRemove?: () => Promise<void>;
};

function fromRepo(repo?: Repository): RepositoryFormValue {
  return {
    displayName: repo?.displayName ?? "",
    localPath: repo?.localPath ?? "",
    canonicalRemote: repo?.canonicalRemote ?? "",
    hostType: repo?.hostType ?? "local",
    defaultBranch: repo?.defaultBranch ?? "main",
    identityId: repo?.identity?.id ?? "",
    tags: repo?.tags.join(", ") ?? ""
  };
}

export function RepositoryConfigDialog({ repository: repo, identities, onClose, onSave, onRemove }: Props) {
  const creating = !repo;
  const [value, setValue] = useState(() => fromRepo(repo));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changes = repo ? repo.stagedCount + repo.modifiedCount + repo.untrackedCount : 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try { await onSave(formToUpdate(value)); }
    catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return <div className="panel-backdrop dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <form className="repo-config" onSubmit={submit}>
      <header>
        <div><p>Repository</p><h2>{creating ? "Create a new repository" : `Configure ${repo.displayName}`}</h2></div>
        <button type="button" onClick={onClose}><X /></button>
      </header>
      {creating && <p className="panel-copy">GitCerberus will initialize a Git repository at this path, remember it in your workspace, and optionally add a remote.</p>}
      <RepositoryFields value={value} identities={identities} onChange={setValue} browseTitle={creating ? "Choose a folder for the new repository" : "Choose folder"} />
      {repo && <section className="config-status">
        <h3>Live Git status</h3>
        <dl>
          <div><dt>ID</dt><dd>{repo.id}</dd></div>
          <div><dt>Branch</dt><dd>{repo.detached ? "detached" : repo.branch ?? "unknown"}</dd></div>
          <div><dt>Ahead / behind</dt><dd>{repo.ahead} / {repo.behind}</dd></div>
          <div><dt>Changes</dt><dd>{changes ? `${repo.stagedCount} staged, ${repo.modifiedCount} modified, ${repo.untrackedCount} untracked` : "Clean"}</dd></div>
          <div><dt>Last commit</dt><dd>{repo.lastCommitSummary ?? "No commits"}</dd></div>
          <div><dt>Order</dt><dd>{repo.manualOrder}</dd></div>
          <div><dt>Identity mismatch</dt><dd>{repo.identityMismatch ? "Yes" : "No"}</dd></div>
        </dl>
      </section>}
      {error && <p className="config-error">{error}</p>}
      <footer>
        {onRemove && <button type="button" className="danger" onClick={() => void onRemove()}>Remove from workspace</button>}
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy || !value.displayName.trim() || !value.localPath.trim()}>{creating ? "Create repository" : "Save"}</button>
      </footer>
    </form>
  </div>;
}
