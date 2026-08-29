import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { GithubAuthStatus, GithubDeviceFlow, Identity, ImportResult, Repository, RepositoryUpdate } from "../types";

export const inTauri = () => "__TAURI_INTERNALS__" in window;

let demoIdentities: Identity[] = [
  { id: "work", label: "Northstar", gitName: "Alex Morgan", gitEmail: "alex@northstar.dev", color: "#8b7cf6" },
  { id: "personal", label: "Personal", gitName: "Alex Morgan", gitEmail: "alex@example.com", color: "#ec8e5b" }
];

let demoRepositories: Repository[] = [
  { id: "1", displayName: "backend-api", localPath: "/Users/alex/work/backend-api", canonicalRemote: "git@github.com:northstar/backend-api.git", hostType: "github", defaultBranch: "main", branch: "main", detached: false, stagedCount: 1, modifiedCount: 2, untrackedCount: 0, ahead: 2, behind: 0, lastCommitSummary: "Add audit event pagination", lastCommitAt: new Date(Date.now() - 18 * 60000).toISOString(), identity: demoIdentities[0], identityMismatch: false, tags: ["backend", "production"], manualOrder: 0 },
  { id: "2", displayName: "field-notes", localPath: "/Users/alex/code/field-notes", canonicalRemote: "https://github.com/alex/field-notes.git", hostType: "github", defaultBranch: "main", branch: "feature/offline", detached: false, stagedCount: 0, modifiedCount: 0, untrackedCount: 0, ahead: 0, behind: 3, lastCommitSummary: "Cache notebooks for offline use", lastCommitAt: new Date(Date.now() - 3 * 3600000).toISOString(), identity: demoIdentities[1], identityMismatch: false, tags: ["personal", "mobile"], manualOrder: 1 },
  { id: "3", displayName: "infra-modules", localPath: "/Users/alex/work/infra-modules", canonicalRemote: "git@gitlab.com:northstar/infra-modules.git", hostType: "gitlab", defaultBranch: "main", branch: "main", detached: false, stagedCount: 0, modifiedCount: 1, untrackedCount: 2, ahead: 0, behind: 0, lastCommitSummary: "Pin provider versions", lastCommitAt: new Date(Date.now() - 86400000).toISOString(), identity: demoIdentities[0], identityMismatch: true, tags: ["infra"], manualOrder: 2 }
];

export const api = {
  async selectRepositoryDirectory(): Promise<string | null> {
    if (!inTauri()) return window.prompt("Absolute path to a local Git repository");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose a folder"
    });
    return typeof selected === "string" ? selected : null;
  },
  async repositories(): Promise<Repository[]> {
    return inTauri() ? invoke("list_repositories") : [...demoRepositories];
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
      providerUsername: "token-user"
    };
    demoIdentities = [...demoIdentities, identity];
    return identity;
  },
  async importGithubCliIdentity(): Promise<Identity> {
    return invoke("import_github_cli_identity");
  },
  async openExternalUrl(url: string): Promise<void> {
    await invoke("open_external_url", { url });
  },
  async assignIdentity(repositoryId: string, identityId: string): Promise<void> {
    if (inTauri()) {
      await invoke("assign_repository_identity", { repositoryId, identityId });
      return;
    }
    const identity = identityId ? demoIdentities.find((item) => item.id === identityId) : undefined;
    demoRepositories = demoRepositories.map((repo) => repo.id === repositoryId ? { ...repo, identity } : repo);
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
    demoRepositories = ids.map((id) => demoRepositories.find((repo) => repo.id === id)!);
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
