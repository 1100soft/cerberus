import { repositoryActionKeys } from './shortcuts';
import type { GithubRepository, Identity, Repository } from "../types";

export const isLocal = (repo: Repository) => repo.localPresent ?? !!repo.localPath;
export function remoteKey(remote?: string): string | undefined {
  if (!remote) return undefined;
  const value = remote.replace(/^git@([^:]+):/, 'https://$1/').replace(/^ssh:\/\/git@/, 'https://');
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname.replace(/\/$/, '').replace(/\.git$/, '')}`.toLowerCase();
  } catch { return undefined; }
}
export function repositoryOwner(repo: Repository): string {
  return repo.github?.owner || remoteKey(repo.canonicalRemote)?.split('/')[1] || 'Local';
}
export function ownerColor(owner: string): string {
  let hash = 0;
  for (const char of owner.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} var(--owner-saturation) var(--owner-lightness))`;
}
export function mergeRepositories(local: Repository[], remote: GithubRepository[]): Repository[] {
  const catalog = new Map<string, GithubRepository>();
  const access = new Map<string, string[]>();
  for (const repo of remote) {
    const key = remoteKey(repo.htmlUrl)!;
    if (!catalog.has(key)) catalog.set(key, repo);
    const ids = access.get(key) ?? [];
    if (repo.identityId && !ids.includes(repo.identityId)) ids.push(repo.identityId);
    access.set(key, ids);
  }
  const output = local.map(repo => {
    const key = remoteKey(repo.canonicalRemote) || '';
    return { ...repo, github: catalog.get(key), accessibleIdentityIds: access.get(key) ?? [] };
  });
  const known = new Set(local.map(repo => remoteKey(repo.canonicalRemote)));
  for (const [key, github] of catalog) {
    if (known.has(key)) continue;
    output.push({ id: `github:${github.id}`, displayName: github.name, localPath: '', localPresent: false,
      canonicalRemote: github.htmlUrl, hostType: 'github', defaultBranch: github.defaultBranch,
      detached: false, stagedCount: 0, modifiedCount: 0, untrackedCount: 0, ahead: 0, behind: 0,
      identityMismatch: false, tags: [], manualOrder: output.length, github, accessibleIdentityIds: access.get(key) ?? [] });
  }
  return output;
}
export function isGithubRemote(remote?: string): boolean {
  return !!remoteKey(remote)?.startsWith('github.com/');
}
export function identitiesWithRepositoryAccess(identities: Identity[], repo: { canonicalRemote?: string; github?: GithubRepository; accessibleIdentityIds?: string[]; identity?: Identity }, catalog?: GithubRepository[]): Identity[] {
  if (!isGithubRemote(repo.canonicalRemote || repo.github?.htmlUrl)) return identities;
  if (!catalog) return identities.filter(identity => identity.providerUsername);
  const key = remoteKey(repo.canonicalRemote || repo.github?.htmlUrl);
  const allowed = new Set([
    ...(repo.accessibleIdentityIds ?? []),
    ...catalog.filter(item => remoteKey(item.htmlUrl) === key && item.identityId).map(item => item.identityId),
  ]);
  return identities.filter(identity => allowed.has(identity.id) || identity.id === repo.identity?.id);
}
export type RepositoryControl = { id: string; label: string; key: string };
export function repositoryControls(repo: Repository): RepositoryControl[] {
  const controls: RepositoryControl[] = isLocal(repo) ? [
    { id: 'chat', label: 'Chat with agent', key: repositoryActionKeys.chat },
    { id: 'identity', label: 'Assign account', key: repositoryActionKeys.identity },
    { id: 'editor', label: 'Open in VS Code', key: repositoryActionKeys.editor },
    { id: 'cursor', label: 'Open in Cursor', key: repositoryActionKeys.cursor },
  ] : [{ id: 'locate', label: 'Link existing folder', key: repositoryActionKeys.locate }, ...(repo.github ? [{ id: 'clone', label: 'Clone from GitHub', key: repositoryActionKeys.clone }] : [])];
  if (repo.canonicalRemote) controls.push({ id: 'hosted', label: 'Open hosted repository', key: repositoryActionKeys.hosted });
  if (isLocal(repo)) controls.push({ id: 'configure', label: 'Configure repository', key: repositoryActionKeys.configure });
  return controls;
}
export type RepositorySelection = { repositoryId: string; controlIndex: number };
export function selectRepositoryControl(repositories: Repository[], repositoryId: string, controlIndex: number): RepositorySelection {
  const repo = repositories.find(repo => repo.id === repositoryId) || repositories[0];
  const count = repo ? repositoryControls(repo).length : 0;
  return { repositoryId: repo?.id || '', controlIndex: count ? ((controlIndex % count) + count) % count : 0 };
}

export const repositoryVisibility = (repo: Repository) => repo.github ? (repo.github.private ? 'private' : 'public') : 'unverified';
export function associatedIdentity(repo: Repository, identities: Identity[]): Identity | undefined {
  return repo.identity || identities.find(identity => identity.id === repo.github?.identityId);
}
export type StatusFilter = 'all' | 'dirty' | 'ahead' | 'behind' | 'mismatch';
export type RepositoryFilters = { owners: string[]; ownersExplicit?: boolean; visibility: string; presence: string; status: StatusFilter; sort: string };
export const defaultRepositoryFilters: RepositoryFilters = { owners: [], ownersExplicit: false, visibility: 'all', presence: 'all', status: 'all', sort: 'manual' };
const statuses: StatusFilter[] = ['all', 'dirty', 'ahead', 'behind', 'mismatch'];
export function readRepositoryFilters(raw: string | null): RepositoryFilters {
  try {
    const value = JSON.parse(raw || '{}');
    const owners = Array.isArray(value.owners) ? value.owners.filter((owner: unknown) => typeof owner === 'string' && owner) :
      (typeof value.owner === 'string' && value.owner ? [value.owner] : []);
    return {
      owners,
      ownersExplicit: value.ownersExplicit === true || owners.length > 0,
      visibility: ['all', 'public', 'private', 'unverified'].includes(value.visibility) ? value.visibility : 'all',
      presence: ['all', 'local', 'unlinked'].includes(value.presence) ? value.presence : 'all',
      status: statuses.includes(value.status) ? value.status : 'all',
      sort: ['manual', 'name', 'updated', 'changes', 'owner'].includes(value.sort) ? value.sort : 'manual',
    };
  } catch { return { ...defaultRepositoryFilters }; }
}
export const changeCount = (repo: Repository) => repo.stagedCount + repo.modifiedCount + repo.untrackedCount;
function parsedTime(value?: string): number {
  const time = Date.parse((value || '').trim());
  return Number.isFinite(time) ? time : 0;
}
export function lastUpdated(repo: Repository): number {
  const commit = parsedTime(repo.lastCommitAt);
  const pushed = parsedTime(repo.github?.pushedAt);
  if (isLocal(repo)) return commit || pushed;
  return pushed || parsedTime(repo.github?.updatedAt) || commit;
}
export function matchesQuery(repo: Repository, query: string): boolean {
  if (!query) return true;
  const haystack = [repo.displayName, repo.localPath, repo.canonicalRemote, repo.identity?.label, repo.github?.owner, ...repo.tags].join(' ').toLowerCase();
  return haystack.includes(query.toLowerCase());
}
export function matchesStatus(repo: Repository, status: StatusFilter): boolean {
  if (status === 'all') return true;
  if (status === 'dirty') return changeCount(repo) > 0;
  if (status === 'ahead') return repo.ahead > 0;
  if (status === 'behind') return repo.behind > 0;
  return repo.identityMismatch;
}
export function matchesFilters(repo: Repository, filters: RepositoryFilters, query = ''): boolean {
  const selected = new Set(filters.owners.map(owner => owner.toLowerCase()));
  return matchesQuery(repo, query)
    && matchesStatus(repo, filters.status)
    && (!(filters.ownersExplicit || selected.size) || selected.has(repositoryOwner(repo).toLowerCase()))
    && (filters.visibility === 'all' || repositoryVisibility(repo) === filters.visibility)
    && (filters.presence === 'all' || isLocal(repo) === (filters.presence === 'local'));
}
export function filterMatchCount(repositories: Repository[], filters: RepositoryFilters, query: string, patch: Partial<RepositoryFilters>): number {
  const next = { ...filters, ...patch };
  return repositories.reduce((count, repo) => count + (matchesFilters(repo, next, query) ? 1 : 0), 0);
}
export function filterAndSortRepositories(repositories: Repository[], filters: RepositoryFilters, query = ''): Repository[] {
  return repositories.filter(repo => matchesFilters(repo, filters, query)).sort((a, b) => {
    const name = a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);
    switch (filters.sort) {
      case 'name': return name;
      case 'owner': return repositoryOwner(a).localeCompare(repositoryOwner(b)) || name;
      case 'updated': {
        const dirty = Number(isLocal(b) && changeCount(b) > 0) - Number(isLocal(a) && changeCount(a) > 0);
        return dirty || lastUpdated(b) - lastUpdated(a) || name;
      }
      case 'changes': return (isLocal(b) ? changeCount(b) : -1) - (isLocal(a) ? changeCount(a) : -1) || name;
      default: return a.manualOrder - b.manualOrder || name;
    }
  });
}
