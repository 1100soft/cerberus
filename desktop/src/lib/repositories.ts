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
  return `hsl(${hash % 360} 75% 80%)`;
}
export function mergeRepositories(local: Repository[], remote: GithubRepository[]): Repository[] {
  const catalog = new Map<string, GithubRepository>();
  for (const repo of remote) {
    const key = remoteKey(repo.htmlUrl)!;
    // A shared repository appears once even when multiple accounts can access it.
    if (!catalog.has(key)) catalog.set(key, repo);
  }
  const output = local.map(repo => {
    const github = catalog.get(remoteKey(repo.canonicalRemote) || '');
    return { ...repo, github };
  });
  const known = new Set(local.map(repo => remoteKey(repo.canonicalRemote)));
  for (const [key, github] of catalog) {
    if (known.has(key)) continue;
    output.push({ id: `github:${github.id}`, displayName: github.name, localPath: '', localPresent: false,
      canonicalRemote: github.htmlUrl, hostType: 'github', defaultBranch: github.defaultBranch,
      detached: false, stagedCount: 0, modifiedCount: 0, untrackedCount: 0, ahead: 0, behind: 0,
      identityMismatch: false, tags: [], manualOrder: output.length, github });
  }
  return output;
}
export type RepositoryControl = { id: string; label: string; key: string };
export function repositoryControls(repo: Repository): RepositoryControl[] {
  const controls: RepositoryControl[] = isLocal(repo) ? [
    { id: 'identity', label: 'Assign account', key: 'I' },
    { id: 'editor', label: 'Open in VS Code', key: 'E' },
    { id: 'cursor', label: 'Open in Cursor', key: 'C' },
  ] : [{ id: 'locate', label: 'Link existing folder', key: 'I' }, ...(repo.github ? [{ id: 'clone', label: 'Clone from GitHub', key: 'C' }] : [])];
  if (repo.canonicalRemote) controls.push({ id: 'hosted', label: 'Open hosted repository', key: 'G' });
  if (isLocal(repo)) controls.push({ id: 'configure', label: 'Configure repository', key: ',' });
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
export type RepositoryFilters = { owner: string; visibility: string; presence: string; sort: string };
export const defaultRepositoryFilters: RepositoryFilters = { owner: '', visibility: 'all', presence: 'all', sort: 'manual' };
export function readRepositoryFilters(raw: string | null): RepositoryFilters {
  try {
    const value = JSON.parse(raw || '{}');
    return {
      owner: typeof value.owner === 'string' ? value.owner : '',
      visibility: ['all', 'public', 'private', 'unverified'].includes(value.visibility) ? value.visibility : 'all',
      presence: ['all', 'local', 'unlinked'].includes(value.presence) ? value.presence : 'all',
      sort: ['manual', 'name', 'updated', 'changes', 'owner'].includes(value.sort) ? value.sort : 'manual',
    };
  } catch { return { ...defaultRepositoryFilters }; }
}
export const changeCount = (repo: Repository) => repo.stagedCount + repo.modifiedCount + repo.untrackedCount;
export function lastUpdated(repo: Repository): number {
  return Math.max(Date.parse(repo.github?.updatedAt || '') || 0, Date.parse(repo.lastCommitAt || '') || 0);
}
export function filterAndSortRepositories(repositories: Repository[], filters: RepositoryFilters): Repository[] {
  return repositories.filter(repo => (!filters.owner || repositoryOwner(repo).toLowerCase() === filters.owner.toLowerCase())
    && (filters.visibility === 'all' || repositoryVisibility(repo) === filters.visibility)
    && (filters.presence === 'all' || isLocal(repo) === (filters.presence === 'local')))
    .sort((a, b) => {
      const name = a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id);
      switch (filters.sort) {
        case 'name': return name;
        case 'owner': return repositoryOwner(a).localeCompare(repositoryOwner(b)) || name;
        case 'updated': return lastUpdated(b) - lastUpdated(a) || name;
        case 'changes': return (isLocal(b) ? changeCount(b) : -1) - (isLocal(a) ? changeCount(a) : -1) || name;
        default: return a.manualOrder - b.manualOrder || name;
      }
    });
}
