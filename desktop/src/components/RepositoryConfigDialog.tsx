import {FeedbackMailboxBadge} from './FeedbackMailboxBadge';
import {FeedbackSettings} from './FeedbackPanel';
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { formToUpdate, RepositoryFields, type RepositoryFormValue } from "./RepositoryFields";
import { Select } from "./Select";
import { identitiesWithRepositoryAccess } from "../lib/repositories";
import type { GithubRepository, Identity, Repository, RepositoryUpdate } from "../types";

type Props = {
  repository?: Repository;
  identities: Identity[];
  catalog?: GithubRepository[];
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

export function RepositoryConfigDialog({ repository: repo, identities, catalog, onClose, onSave, onRemove }: Props) {
  const creating = !repo;
  const [mailbox,setMailbox]=useState(false);
  const [value, setValue] = useState(() => fromRepo(repo));
  const [createGithub,setCreateGithub]=useState(creating||repo?.hostType==='github'&&!repo.canonicalRemote);
  const [repositoryName,setRepositoryName]=useState("");
  const [organization,setOrganization]=useState("");
  const githubDestination=creating&&value.hostType==='github';
  const [privateGithub,setPrivateGithub]=useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changes = repo ? repo.stagedCount + repo.modifiedCount + repo.untrackedCount : 0;
  const assignable = value.hostType==='github'?identities.filter(identity=>!!identity.providerUsername||identity.id===repo?.identity?.id):identitiesWithRepositoryAccess(identities, { ...repo, canonicalRemote: value.canonicalRemote, github: repo?.github, accessibleIdentityIds: repo?.accessibleIdentityIds, identity: repo?.identity }, catalog);

  const selectedIdentity=identities.find(identity=>identity.id===value.identityId);
  const githubName=githubDestination?repositoryName.trim():value.displayName.trim().replace(/[^A-Za-z0-9_.-]+/g,'-');
  const githubOwner=organization.trim()||selectedIdentity?.providerUsername;
  const generatedRemote=githubOwner&&githubName?`https://github.com/${githubOwner}/${githubName}.git`:'';
  const proposedRemote=githubDestination?generatedRemote:value.canonicalRemote.trim()||generatedRemote;
  const remoteCreation=value.hostType==='github'&&createGithub;
  useEffect(()=>{if(!remoteCreation&&!githubDestination)return;setValue(current=>identities.some(identity=>identity.id===current.identityId&&identity.providerUsername)?current:{...current,identityId:identities.find(identity=>identity.providerUsername)?.id||''});},[remoteCreation,githubDestination,identities]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try { await onSave({...formToUpdate(remoteCreation||githubDestination?{...value,canonicalRemote:proposedRemote}:value),...(remoteCreation?{githubCreate:{private:privateGithub}}:{})}); }
    catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return <div className="panel-backdrop dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <form className="repo-config" onSubmit={submit}>
      <header>
        <div><p>Project</p><h2>{creating ? "Create a new project" : `Configure ${repo.displayName}`}</h2></div>
        <button type="button" onClick={onClose}><X /></button>
      </header>
      {creating && <p className="panel-copy">GitCerberus will initialize a Git repository at this path, remember it in your workspace, and, for GitHub, create and link a remote repository.</p>}
      <RepositoryFields value={value} identities={assignable} identityRequired={!!remoteCreation||githubDestination} githubDestination={githubDestination?{name:repositoryName,organization,remote:generatedRemote,onNameChange:setRepositoryName,onOrganizationChange:setOrganization}:undefined} onChange={setValue} browseTitle={creating ? "Choose a folder for the new project" : "Choose folder"} />
      {value.hostType==='github'&&<section className="github-create-options"><label><input type="checkbox" checked={!!createGithub} onChange={event=>setCreateGithub(event.target.checked)}/>Create remote repository on GitHub</label>{createGithub&&<><Select label="GitHub repository visibility" value={privateGithub?'private':'public'} options={[{value:'private',label:'Private'},{value:'public',label:'Public'}]} onChange={value=>setPrivateGithub(value==='private')}/><p className="panel-copy">{proposedRemote||'Choose a GitHub account to set the destination.'} · Creates an empty remote; files are not pushed. {creating?'Use the organization field to create under an organization.':'Enter an organization repository URL above to use an organization.'} Turn this off to link an existing remote.</p></>}</section>}
      {repo&&<button type="button" onClick={()=>setMailbox(true)}><FeedbackMailboxBadge repositoryId={repo.id} showEmpty/>Email settings</button>}
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
        <button type="submit" className="primary" disabled={busy || !value.displayName.trim() || !value.localPath.trim() || (remoteCreation||githubDestination)&&(!selectedIdentity?.providerUsername||!proposedRemote)}>{creating ? "Create project" : "Save"}</button>
      </footer>
    </form>
    {mailbox&&repo&&<FeedbackSettings repositoryId={repo.id} onClose={()=>setMailbox(false)}/>}
  </div>;
}
