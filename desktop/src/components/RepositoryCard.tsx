import { invoke } from '@tauri-apps/api/core';
import { assignedExternalIdentity, externalProviders, useExternalIdentities } from '../lib/externalIdentities';
import { RepositoryAccounts } from './RepositoryAccounts';
import { ChatgptAccountBadge } from './ChatgptAccountBadge';
import { ProviderIdentityBadge } from './ProviderIdentityBadge';
import { CopilotQuota, type CopilotQuotaResponse } from './CopilotQuota';
import { useAgentChats } from '../lib/agentChats';
import { repositoryHistoryWorking, subscribe } from '../lib/conversationCache';
import { assignedChatgpt,repositoryAccountKey,useChatgptAccounts } from '../lib/chatgptAccounts';
import { MessageSquare, AlertTriangle, ArrowDown, ArrowUp, Check, CircleDot, CloudDownload, ExternalLink, FolderOpen, GitBranch, Globe, GripVertical, Lock, Settings2, UserRound, LoaderCircle } from "lucide-react";
import { CursorIcon, VSCodeIcon } from "./Icons";
import { useEffect, useState, useSyncExternalStore } from "react";
import { associatedIdentity, identitiesWithRepositoryAccess, isLocal, ownerColor, repositoryControls, repositoryOwner, repositoryVisibility } from "../lib/repositories";
import type { GithubRepository, Identity, Repository } from "../types";

function AccountBadge({ identity }: { identity?: Identity }) {
  return <ProviderIdentityBadge provider="github" id={identity?.id} label={identity?.label}/>;
}

type Props = {
  repository: Repository; identities: Identity[]; catalog?: GithubRepository[];
  chatgpt: ReturnType<typeof useChatgptAccounts>; external: ReturnType<typeof useExternalIdentities>;
  onAssignIdentity: (identityId: string) => Promise<void>;
  selected: boolean; actionIndex: number; busy?: boolean;
  onSelect: (controlIndex?: number, focus?: boolean) => void;
  onAction: (action: string) => void;
  onConfigure: () => void; onContextMenu: (event: React.MouseEvent) => void;
  onDragStart: () => void; onDrop: () => void;
};
export function RepositoryCard({ repository: repo, identities, catalog, chatgpt, external, onAssignIdentity, selected, actionIndex, busy, onSelect, onAction, onConfigure, onContextMenu, onDragStart, onDrop }: Props) {
  const accountKey=repositoryAccountKey(repo);
  const chats=useAgentChats();
  const historyWorking=useSyncExternalStore(subscribe,()=>repositoryHistoryWorking(repo.id));
  const agentWorking=historyWorking||chats.some(chat=>chat.repositoryId===repo.id && chat.running);
  const assigned=assignedChatgpt(chatgpt.settings,accountKey);
  const chatgptAccount=chatgpt.profiles.find(profile=>profile.id===assigned);
  const [assignOpen, setAssignOpen] = useState(false);
  const [copilot,setCopilot]=useState<CopilotQuotaResponse|null>(null);
  const local = isLocal(repo);
  const changes = repo.stagedCount + repo.modifiedCount + repo.untrackedCount;
  const owner = repositoryOwner(repo);
  const controls = repositoryControls(repo);
  const visibility = repositoryVisibility(repo);
  const account = associatedIdentity(repo, identities);
  const assignable = identitiesWithRepositoryAccess(identities, repo, catalog);
  useEffect(()=>{if(!selected || !repo.github?.fullName || !account?.id || account.connected===false){setCopilot(null);return;}let alive=true;void invoke<typeof copilot>('copilot_repository_snapshot',{identityId:account.id,repository:repo.github.fullName}).then(result=>{if(alive)setCopilot(result);}).catch(()=>{if(alive)setCopilot(null);});return()=>{alive=false;};},[selected,repo.github?.fullName,account?.id,account?.connected]);
  const visibilityDetail = repo.github ? `${repo.github.private ? "Private" : "Public"} GitHub repository` : repo.hostType === 'github' ? 'Visibility unverified. Connect an account that can access this repository.' : 'Visibility is not verified for this host.';
  const icons: Record<string, React.ReactNode> = { chat: <MessageSquare />, editor: <VSCodeIcon />, cursor: <CursorIcon />, hosted: <ExternalLink />, configure: <Settings2 />, clone: <CloudDownload />, locate: <FolderOpen /> };
  useEffect(() => { if (!selected) setAssignOpen(false); }, [selected]);
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
      {assigned && <ChatgptAccountBadge account={chatgptAccount} assignedId={assigned} inherited={!Object.hasOwn(chatgpt.settings.repositories,accountKey)} />}
      {externalProviders.map(({id:provider})=>{const id=assignedExternalIdentity(external.settings,provider,accountKey);const account=external.identities.find(item=>item.id===id);return account?<ProviderIdentityBadge key={provider} provider={provider} id={account.id} label={account.label}/>:null;})}
      <strong className="row-name" title={repo.displayName}>{repo.displayName}</strong>
      {agentWorking && <span title="Agent working"><LoaderCircle className="conversation-working repository-working" aria-label="Agent working"/></span>}
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
      <div className="row-actions">
      {controls.map((control, index) => control.id === 'identity'
        ? <button key={control.id} data-control-index={index} className={`identity ${actionIndex === index ? "chosen" : ""}`} disabled={busy}
            tabIndex={actionIndex === index ? 0 : -1} onPointerEnter={() => { if (!document.activeElement?.closest('.chat-composer')) onSelect(index, true); }} onFocus={() => onSelect(index)}
            onClick={() => { onSelect(index); setAssignOpen(open=>!open); }} onDoubleClick={event => event.stopPropagation()}
            title={`${control.label} (${control.key})`} aria-label={control.label} aria-expanded={assignOpen}>
            <UserRound /><kbd>{control.key}</kbd>
          </button>
        : <button key={control.id} data-control-index={index} className={actionIndex === index ? "chosen" : ""} disabled={busy}
            tabIndex={actionIndex === index ? 0 : -1} onPointerEnter={() => { if (!document.activeElement?.closest('.chat-composer')) onSelect(index, true); }} onFocus={() => onSelect(index)}
            onClick={() => { onSelect(index); onAction(control.id); }} onDoubleClick={event => event.stopPropagation()} title={`${control.label} (${control.key})`} aria-label={control.label}>
            {icons[control.id]}{control.id === 'locate' && <span>Link folder</span>}{control.id === 'clone' && <span>Clone</span>}<kbd>{control.key}</kbd>
          </button>)}</div>
      {repo.github && copilot && <div className="copilot-summary" aria-label="GitHub Copilot">
        <b>Copilot</b><CopilotQuota usage={copilot}/>
      </div>}
    </div>}
    {assignOpen && <RepositoryAccounts repository={repo} identities={assignable} onAssignIdentity={onAssignIdentity} onClose={()=>setAssignOpen(false)}/>}
  </article>;
}
