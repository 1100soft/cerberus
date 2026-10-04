import { Channel, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { CodexAccount, CodexThreadPage, CodexMessagePage, Commit, GithubCatalog, GithubAuthStatus, GithubDeviceFlow, Identity, ImportResult, Repository, RepositoryUpdate } from "../types";
import { identitiesWithRepositoryAccess } from "./repositories";

export const inTauri = () => "__TAURI_INTERNALS__" in window;
export type AutomationLog={automationId:string;repositoryId:string;runId:string;createdAt:number;kind:'shell'|'agent'|'git'|'notification';status:'running'|'completed'|'error';command:string;stdout:string;stderr:string;response:string;activity:string};
export type AutomationLogSummary=Pick<AutomationLog,'repositoryId'|'runId'|'createdAt'|'kind'|'status'>;
export type GithubCiRun={id:number;runAttempt:number;name:string;headBranch?:string|null;headSha:string;conclusion?:string|null;updatedAt:string;htmlUrl:string};
export type GithubRepositoryEvent={id:string;kind:'push'|'pullRequest';branch:string;sha?:string|null;action?:string|null;createdAt:string;htmlUrl:string};
const demoAutomationLogs=new Map<string,AutomationLog>();
const demoHandoffs=new Map<string,{id:string;path:string;claimed:boolean}[]>();

let demoIdentities: Identity[] = [
  { id: "work", label: "Northstar", gitName: "Alex Morgan", gitEmail: "alex@northstar.dev", color: "var(--color-8b7cf6)", providerUsername: "octocat", connected: true },
  { id: "personal", label: "Personal", gitName: "Alex Morgan", gitEmail: "alex@example.com", color: "var(--color-ec8e5b)", providerUsername: "github", connected: true }
];

let demoRepositories: Repository[] = [
  { id: "1", displayName: "backend-api", localPath: "/Users/alex/work/backend-api", canonicalRemote: "git@github.com:northstar/backend-api.git", hostType: "github", defaultBranch: "main", branch: "main", detached: false, stagedCount: 1, modifiedCount: 2, untrackedCount: 0, ahead: 2, behind: 0, lastCommitSummary: "Add audit event pagination", lastCommitAt: new Date(Date.now() - 18 * 60000).toISOString(), identity: demoIdentities[0], identityMismatch: false, tags: ["backend", "production"], manualOrder: 0 },
  { id: "2", displayName: "field-notes", localPath: "/Users/alex/code/field-notes", canonicalRemote: "https://github.com/alex/field-notes.git", hostType: "github", defaultBranch: "main", branch: "feature/offline", detached: false, stagedCount: 0, modifiedCount: 0, untrackedCount: 0, ahead: 0, behind: 3, lastCommitSummary: "Cache notebooks for offline use", lastCommitAt: new Date(Date.now() - 3 * 3600000).toISOString(), identity: demoIdentities[1], identityMismatch: false, tags: ["personal", "mobile"], manualOrder: 1 },
  { id: "3", displayName: "infra-modules", localPath: "/Users/alex/work/infra-modules", canonicalRemote: "git@gitlab.com:northstar/infra-modules.git", hostType: "gitlab", defaultBranch: "main", branch: "main", detached: false, stagedCount: 0, modifiedCount: 1, untrackedCount: 2, ahead: 0, behind: 0, lastCommitSummary: "Pin provider versions", lastCommitAt: new Date(Date.now() - 86400000).toISOString(), identityMismatch: true, tags: ["infra"], manualOrder: 2 }
];

export type BranchRemovalPlan={branch:string;head:string;merged:boolean;worktrees:string[];remote:string|null;remoteHead:string|null};
export type BranchRemovalResult={completed:boolean;steps:string[];error:string|null};
export type RepositoryCommitState={head:string;branch:string;reflog:string;refs?:{key:string;head:string;branch:string;reflog:string}[]};

export const api = {
  async linkRepositoryFolder(expectedRemote: string, path: string, repositoryId?: string): Promise<ImportResult> {
    if (!inTauri()) throw new Error("Linking a checkout is available in the desktop app.");
    return invoke("link_repository_folder", { expectedRemote, path, repositoryId: repositoryId ?? null });
  },
  async githubRepositories(): Promise<GithubCatalog> {
    if (inTauri()) return invoke("github_repositories");
    return { repositories: [
      { id: 101, name: "backend-api", fullName: "northstar/backend-api", owner: "northstar", private: true, htmlUrl: "https://github.com/northstar/backend-api", defaultBranch: "main", identityId: "work" },
      { id: 102, name: "field-notes", fullName: "alex/field-notes", owner: "alex", private: false, htmlUrl: "https://github.com/alex/field-notes", defaultBranch: "main", identityId: "personal" },
      { id: 103, name: "design-system", fullName: "northstar/design-system", owner: "northstar", private: true, htmlUrl: "https://github.com/northstar/design-system", defaultBranch: "main", identityId: "work" },
      { id: 104, name: "garden", fullName: "alex/garden", owner: "alex", private: false, htmlUrl: "https://github.com/alex/garden", defaultBranch: "main", identityId: "personal" }
    ], warnings: [] };
  },
  async githubCiRuns(repositoryId:string):Promise<GithubCiRun[]> {
    if(inTauri())return invoke('github_ci_runs',{repositoryId});
    return [];
  },
  async githubRepositoryEvents(repositoryId:string):Promise<GithubRepositoryEvent[]> {
    if(inTauri())return invoke('github_repository_events',{repositoryId});
    return [];
  },
  async cloneGithubRepository(identityId: string, fullName: string, parent: string): Promise<ImportResult> {
    if (!inTauri()) throw new Error("Cloning is available in the desktop app.");
    return invoke("clone_github_repository", { identityId, fullName, parent });
  },
  async openCursor(repositoryId: string, conversationId?: string): Promise<void> {
    if (inTauri()) await invoke("open_in_cursor", { repositoryId, conversationId: conversationId ?? null });
  },
  async promptCapability(repositoryId:string,provider:string,threadId:string):Promise<{automatic:boolean;reason:string}>{
    if (!inTauri()) return {automatic:false,reason:'Automatic delivery requires the desktop app.'};
    return invoke('prompt_capability',{repositoryId,provider,threadId});
  },
  async submitSavedPrompt(repositoryId:string,provider:string,threadId:string,prompt:string):Promise<string>{
    if (!inTauri()) throw new Error('Automatic delivery requires the desktop app.');
    return invoke('submit_saved_prompt',{repositoryId,provider,threadId,prompt});
  },
  async runNewAgentConversation(repositoryId:string,provider:string,identityId:string,mode:string,prompt:string,sessionId?:string,requestId?:string,onOutput?:(event:Record<string,unknown>)=>void):Promise<{text:string;sessionId?:string}>{
    if (!inTauri()) throw new Error('Agent execution requires the desktop app.');
    const output=new Channel<Record<string,unknown>>();output.onmessage=onOutput||(()=>{});
    return invoke('run_new_agent_conversation',{repositoryId,provider,identityId,mode,prompt,sessionId:sessionId||null,requestId:requestId||null,output});
  },
  async cancelDraft(requestId:string):Promise<void>{
    if (!inTauri()) return;
    return invoke('cancel_draft',{requestId});
  },
  async runAutomationShell(repositoryId:string,script:string,onOutput?:(chunk:{stream:string;text:string})=>void,handoffInputPath?:string,handoffOutputPaths:Record<string,string>={},context:Record<string,string>={}):Promise<{result:string;stdout:string;stderr:string}>{
    if (!inTauri()) throw new Error('Shell automations require the desktop app.');
    const output=new Channel<{stream:string;text:string}>();
    output.onmessage=onOutput||(()=>{});
    return invoke('run_automation_shell',{repositoryId,script,output,handoffInputPath:handoffInputPath||null,handoffOutputPaths,context});
  },
  async watchAutomationRepositories(repositoryIds:string[]):Promise<string[]>{
    if (!inTauri()) return [];
    return invoke('watch_automation_repositories',{repositoryIds});
  },
  async repositoryChangedLines(repositoryId:string):Promise<number>{
    if (!inTauri()){const repository=demoRepositories.find(item=>item.id===repositoryId);return (repository?.stagedCount||0)+(repository?.modifiedCount||0)+(repository?.untrackedCount||0);}
    return invoke('repository_changed_lines',{repositoryId});
  },
  async repositoryChangedLinesBatch(repositoryIds:string[]):Promise<Record<string,number>>{
    if (!inTauri())return Object.fromEntries(await Promise.all(repositoryIds.map(async id=>[id,await api.repositoryChangedLines(id)] as const)));
    return invoke('repository_changed_lines_batch',{repositoryIds});
  },
  async repositoryChangeSummary(repositoryId:string):Promise<{head:string;branch:string;reflog:string;changedLines:number}>{
    if (!inTauri()){const repo=demoRepositories.find(item=>item.id===repositoryId);return {head:repo?.lastCommitAt||'demo',branch:repo?.branch||'',reflog:'commit: demo',changedLines:await this.repositoryChangedLines(repositoryId)};}
    return invoke('repository_change_summary',{repositoryId});
  },
  async repositoryCommitState(repositoryId:string):Promise<RepositoryCommitState>{
    if(!inTauri()){const repo=demoRepositories.find(item=>item.id===repositoryId);return {head:repo?.lastCommitAt||'demo',branch:repo?.branch||'',reflog:'commit: demo'};}
    return invoke('repository_commit_state',{repositoryId});
  },
  async repositoryCommitStatesBatch(repositoryIds:string[]):Promise<Record<string,RepositoryCommitState>>{
    if(!inTauri())return Object.fromEntries(await Promise.all(repositoryIds.map(async id=>[id,await api.repositoryCommitState(id)] as const)));
    return invoke('repository_commit_states_batch',{repositoryIds});
  },
  async handoffOutputPath(repositoryId:string,name:string,runId:string):Promise<string>{
    if(!inTauri())return `/tmp/gitcerberus-demo-handoffs/${repositoryId}/${name}/${runId}.txt`;
    return invoke('handoff_output_path',{repositoryId,name,runId});
  },
  async publishHandoff(repositoryId:string,name:string,runId:string,payload?:string):Promise<boolean>{
    if(!inTauri())return false;
    return invoke('publish_handoff',{repositoryId,name,runId,payload:payload??null});
  },
  async hasPendingHandoff(repositoryId:string,name:string):Promise<boolean>{
    if(!inTauri())return !!demoHandoffs.get(`${repositoryId}:${name}`)?.some(item=>!item.claimed);
    return invoke('has_pending_handoff',{repositoryId,name});
  },
  async claimHandoff(repositoryId:string,name:string):Promise<{id:string;path:string}|null>{
    if(!inTauri()){const item=demoHandoffs.get(`${repositoryId}:${name}`)?.find(item=>!item.claimed);if(!item)return null;item.claimed=true;return {id:item.id,path:item.path};}
    return invoke('claim_handoff',{repositoryId,name});
  },
  async finishHandoff(repositoryId:string,name:string,id:string):Promise<void>{
    if(!inTauri()){const key=`${repositoryId}:${name}`;demoHandoffs.set(key,(demoHandoffs.get(key)||[]).filter(item=>item.id!==id));return;}
    return invoke('finish_handoff',{repositoryId,name,id});
  },
  async releaseHandoff(repositoryId:string,name:string,id:string):Promise<void>{
    if(!inTauri()){const item=demoHandoffs.get(`${repositoryId}:${name}`)?.find(item=>item.id===id);if(item)item.claimed=false;return;}
    return invoke('release_handoff',{repositoryId,name,id});
  },
  async cleanupStaleHandoffs(repositoryIds:string[]):Promise<number>{
    if(!inTauri())return 0;
    return invoke('cleanup_stale_handoffs',{repositoryIds});
  },
  async writeAutomationLog(entry:AutomationLog):Promise<void>{
    if(!inTauri()){demoAutomationLogs.set(`${entry.automationId}:${entry.repositoryId}:${entry.runId}`,entry);return;}
    return invoke('write_automation_log',{entry});
  },
  async listAutomationLogs(automationId:string):Promise<AutomationLogSummary[]>{
    if(!inTauri())return [...demoAutomationLogs.values()].filter(item=>item.automationId===automationId).sort((a,b)=>b.createdAt-a.createdAt);
    return invoke('list_automation_logs',{automationId});
  },
  async readAutomationLog(automationId:string,repositoryId:string,runId:string):Promise<AutomationLog>{
    if(!inTauri()){const entry=demoAutomationLogs.get(`${automationId}:${repositoryId}:${runId}`);if(!entry)throw new Error('Automation log not found');return entry;}
    return invoke('read_automation_log',{automationId,repositoryId,runId});
  },
  async chooseCodexExecutable(): Promise<boolean> {
    if (!inTauri()) throw new Error("Open the desktop app to select the Codex executable.");
    const path = await open({ title: "Choose the Codex executable", directory: false, multiple: false });
    if (typeof path !== "string") return false;
    await invoke("configure_codex", { path });
    return true;
  },
  async codexAccount(): Promise<CodexAccount> {
    if (!inTauri()) throw new Error("Codex conversations are available in the desktop app. Install the Codex CLI to connect.");
    return invoke("codex_account");
  },
  async codexLogin(): Promise<string> { return invoke("codex_login"); },
  async codexCancelLogin(loginId: string): Promise<void> { return invoke("codex_cancel_login", { loginId }); },
  async installProvider(provider: "codex" | "cursor" | "cursor-agent" | "copilot" | "claude", onOutput: (text: string) => void): Promise<void> {
    const output = new Channel<{text: string}>(); output.onmessage = message => onOutput(message.text);
    return invoke("install_provider", { provider, approved: true, output });
  },
  async cancelProviderInstall(): Promise<void> { return invoke("cancel_provider_install"); },
  async chooseCursorExecutable(): Promise<boolean> {
    const path = await open({ multiple: false, directory: false, title: "Choose cursor-sdk-bridge executable" });
    if (typeof path !== "string") return false;
    await invoke("configure_cursor", { path });
    return true;
  },
  async claudeThreads(repositoryId: string, archived: boolean): Promise<CodexThreadPage> {
    return invoke('claude_threads', { repositoryId, archived });
  },
  async claudeMessages(repositoryId: string, threadId: string): Promise<CodexMessagePage> {
    return invoke('claude_messages', { repositoryId, threadId });
  },
  async copilotThreads(repositoryId: string, archived: boolean): Promise<CodexThreadPage> {
    return invoke('copilot_threads', { repositoryId, archived });
  },
  async copilotMessages(repositoryId: string, threadId: string): Promise<CodexMessagePage> {
    return invoke('copilot_messages', { repositoryId, threadId });
  },
  async cursorThreads(repositoryId: string, archived: boolean, cursor?: string | null): Promise<CodexThreadPage> {
    if (!inTauri()) throw new Error("Cursor history requires the desktop app and Cursor SDK bridge. Open Setup for instructions.");
    return invoke("cursor_threads", { repositoryId, archived, cursor: cursor ?? null });
  },
  async cursorMessages(repositoryId: string, threadId: string): Promise<CodexMessagePage> {
    return invoke("cursor_messages", { repositoryId, threadId });
  },
  async cursorArchiveThread(repositoryId:string, threadId:string, archived:boolean):Promise<void> { return invoke("cursor_archive_thread",{repositoryId,threadId,archived}); },
  async codexThreads(repositoryId: string, archived: boolean, cursor?: string | null): Promise<CodexThreadPage> {
    return invoke("codex_threads", { repositoryId, archived, cursor: cursor ?? null });
  },
  async codexMessages(repositoryId: string, threadId: string, cursor?: string | null): Promise<CodexMessagePage> {
    return invoke("codex_messages", { repositoryId, threadId, cursor: cursor ?? null });
  },
  async codexUpdateThread(repositoryId:string, threadId:string, action:string, name?:string):Promise<void> { return invoke("codex_update_thread",{repositoryId,threadId,action,name:name??null}); },
  async selectRepositoryDirectory(title = "Choose a folder"): Promise<string | null> {
    if (!inTauri()) return window.prompt("Absolute path to a local Git repository");
    const selected = await open({
      directory: true,
      multiple: false,
      title
    });
    return typeof selected === "string" ? selected : null;
  },
  async syncRepositoryRemotes(): Promise<Repository[]> {
    return inTauri() ? invoke('sync_repository_remotes') : [...demoRepositories];
  },
  async repositories(): Promise<Repository[]> {
    return inTauri() ? invoke("list_repositories") : [...demoRepositories];
  },
  async branches(repositoryId: string): Promise<string[]> {
    if (inTauri()) return invoke("list_branches", { repositoryId });
    const repo = demoRepositories.find((repo) => repo.id === repositoryId);
    return [...new Set([repo?.branch || "main", "main", "develop", "feature/offline"])];
  },
  async branchRemovalPlan(repositoryId:string,branch:string):Promise<BranchRemovalPlan>{
    if(!inTauri())throw new Error('Branch removal requires the desktop app.');
    return invoke('branch_removal_plan',{repositoryId,branch});
  },
  async removeBranch(repositoryId:string,plan:BranchRemovalPlan,confirmedUnmergedHead?:string):Promise<BranchRemovalResult>{
    if(!inTauri())throw new Error('Branch removal requires the desktop app.');
    return invoke('remove_branch',{repositoryId,plan,confirmedUnmergedHead:confirmedUnmergedHead||null});
  },
  async history(repositoryId: string, branch?: string, skip = 0): Promise<Commit[]> {
    if (inTauri()) return invoke("commit_history", { repositoryId, branch: branch ?? null, skip });
    const repo = demoRepositories.find((repo) => repo.id === repositoryId);
    if (!repo?.lastCommitSummary || skip) return [];
    return [repo.lastCommitSummary, `Update ${branch || "main"}`, "Initialize repository"].map((summary, index) => ({
      hash: `${repositoryId}${index}a4e9c7b`.padEnd(40, "0"), summary, author: "Alex Morgan", email: "alex@example.com",
      committedAt: new Date(Date.now() - (index + 1) * 3600000).toISOString()
    }));
  },
  async identities(): Promise<Identity[]> {
    return inTauri() ? invoke("list_identities") : demoIdentities;
  },
  async githubAuthStatus(): Promise<GithubAuthStatus> {
    if (!inTauri()) return { browserSignIn: false, githubCli: false };
    return invoke("github_auth_status");
  },
  async beginGithubOAuth(clientId?: string): Promise<GithubDeviceFlow> {
    return invoke("begin_github_oauth", { clientId: clientId || null });
  },
  async completeGithubOAuth(clientId: string, deviceCode: string): Promise<Identity | null> {
    return invoke("complete_github_oauth", { clientId, deviceCode });
  },
  async completeGithubToken(token: string): Promise<Identity> {
    if (inTauri()) return invoke("complete_github_token", { token });
    const identity: Identity = {
      id: crypto.randomUUID(),
      label: "token-user",
      gitName: "Token User",
      gitEmail: "token@example.com",
      providerUsername: "token-user",
      connected: true
    };
    demoIdentities = [...demoIdentities, identity];
    return identity;
  },
  async importGithubCliIdentity(): Promise<Identity> {
    return invoke("import_github_cli_identity");
  },
  async disconnectGithubIdentity(identityId: string): Promise<void> {
    if (inTauri()) {
      await invoke("disconnect_github_identity", { identityId });
      return;
    }
    demoIdentities = demoIdentities.map((identity) => identity.id === identityId ? { ...identity, connected: false } : identity);
  },
  async openExternalUrl(url: string): Promise<void> {
    if (!inTauri()) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
    await invoke("open_external_url", { url });
  },
  async assignIdentity(repositoryId: string, identityId: string): Promise<void> {
    if (inTauri()) {
      await invoke("assign_repository_identity", { repositoryId, identityId });
      return;
    }
    const repo = demoRepositories.find((item) => item.id === repositoryId);
    const catalog = (await api.githubRepositories()).repositories;
    if (identityId && repo && !identitiesWithRepositoryAccess(demoIdentities, repo, catalog).some((identity) => identity.id === identityId)) {
      throw new Error("This account does not have access to that repository.");
    }
    const identity = identityId ? demoIdentities.find((item) => item.id === identityId) : undefined;
    demoRepositories = demoRepositories.map((item) => item.id === repositoryId ? { ...item, identity } : item);
  },
  async importRepository(path: string): Promise<ImportResult> {
    if (inTauri()) return invoke("import_repository", { path });
    throw new Error("Repository import is available in the desktop app.");
  },
  async createRepository(update: RepositoryUpdate): Promise<ImportResult> {
    if (inTauri()) return invoke("create_repository", { update });
    const identity = update.identityId ? demoIdentities.find((item) => item.id === update.identityId) : undefined;
    const repository: Repository = {
      id: crypto.randomUUID(),
      displayName: update.displayName,
      localPath: update.localPath,
      canonicalRemote: update.canonicalRemote || undefined,
      hostType: update.hostType,
      defaultBranch: update.defaultBranch || "main",
      branch: update.defaultBranch || "main",
      detached: false,
      stagedCount: 0,
      modifiedCount: 0,
      untrackedCount: 0,
      ahead: 0,
      behind: 0,
      lastCommitSummary: undefined,
      lastCommitAt: undefined,
      identity,
      identityMismatch: false,
      tags: update.tags,
      manualOrder: demoRepositories.length
    };
    demoRepositories = [...demoRepositories, repository];
    return { repository, warnings: [] };
  },
  async refresh(id: string): Promise<Repository> {
    if (inTauri()) return invoke("refresh_repository", { repositoryId: id });
    return demoRepositories.find((repo) => repo.id === id)!;
  },
  async git(repositoryId: string, operation: string, args: Record<string, unknown> = {}): Promise<void> {
    if (inTauri()) await invoke("run_git_action", { repositoryId, operation, args });
  },
  async openEditor(repositoryId: string): Promise<void> {
    if (inTauri()) await invoke("open_in_editor", { repositoryId });
  },
  async openHosted(repositoryId: string): Promise<void> {
    if (inTauri()) await invoke("open_hosted_repository", { repositoryId });
  },
  async reorder(ids: string[]): Promise<void> {
    if (inTauri()) await invoke("reorder_repositories", { repositoryIds: ids });
    demoRepositories = ids.map((id,manualOrder) => ({...demoRepositories.find((repo) => repo.id === id)!,manualOrder}));
  },
  async updateRepository(id: string, update: RepositoryUpdate): Promise<Repository> {
    if (inTauri()) return invoke("update_repository", { repositoryId: id, update });
    const identity = update.identityId ? demoIdentities.find((item) => item.id === update.identityId) : undefined;
    demoRepositories = demoRepositories.map((repo) => repo.id === id ? {
      ...repo,
      displayName: update.displayName,
      localPath: update.localPath,
      canonicalRemote: update.canonicalRemote || undefined,
      hostType: update.hostType,
      defaultBranch: update.defaultBranch || undefined,
      identity,
      identityMismatch: repo.identityMismatch,
      tags: update.tags
    } : repo);
    return demoRepositories.find((repo) => repo.id === id)!;
  },
  async removeRepository(id: string): Promise<void> {
    if (inTauri()) await invoke("remove_repository", { repositoryId: id });
    demoRepositories = demoRepositories.filter((repo) => repo.id !== id);
  },
  async openLocalFolder(repositoryId: string): Promise<void> {
    if (inTauri()) await invoke("open_local_folder", { repositoryId });
  }
};
