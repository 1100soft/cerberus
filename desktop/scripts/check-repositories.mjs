import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/repositories.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { mergeRepositories, selectRepositoryControl, repositoryControls, isLocal, filterAndSortRepositories, readRepositoryFilters } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const local = { id: 'local', localPath: '/repo', localPresent: true, canonicalRemote: 'git@github.com:Owner/Repo.git' };
const remote = { id: 1, name: 'Repo', owner: 'Owner', htmlUrl: 'https://github.com/owner/repo', private: true, identityId: 'one' };
const repos = mergeRepositories([local], [remote, { ...remote, identityId: 'two' }, { ...remote, id: 2, name: 'Other', htmlUrl: 'https://github.com/owner/other' }]);
assert.equal(repos.length, 2);
assert.equal(repos[0].github.private, true);
assert.equal(isLocal(repos[1]), false);
assert.ok(repositoryControls(repos[0]).some(c => c.id === 'identity' && c.label === 'Assign account'));
assert.ok(!repositoryControls(repos[1]).some(c => c.id === 'editor'));
assert.ok(repositoryControls(repos[1]).some(c => c.id === 'clone'));
for (const repo of repos) {
  const count = repositoryControls(repo).length;
  assert.equal(selectRepositoryControl(repos, repo.id, count).controlIndex, 0);
  assert.equal(selectRepositoryControl(repos, repo.id, -1).controlIndex, count - 1);
}
assert.equal(selectRepositoryControl([...repos].reverse(), 'local', 2).repositoryId, 'local');
assert.deepEqual(selectRepositoryControl([], 'missing', -1), { repositoryId: '', controlIndex: 0 });
console.log('Repository merging and selection checks passed');

const catalog = [
  { ...repos[0], displayName:'Zebra', manualOrder:0, stagedCount:2, modifiedCount:1, untrackedCount:0, github:{...remote, updatedAt:'2026-09-10T00:00:00Z'} },
  { ...repos[1], displayName:'Alpha', manualOrder:1, github:{...remote, private:false, owner:'other', updatedAt:'2026-09-17T00:00:00Z'} },
];
const defaults = readRepositoryFilters(null);
assert.equal(filterAndSortRepositories(catalog, {...defaults, sort:'name'})[0].displayName, 'Alpha');
assert.equal(filterAndSortRepositories(catalog, {...defaults, sort:'updated'})[0].displayName, 'Alpha');
assert.equal(filterAndSortRepositories(catalog, {...defaults, sort:'changes'})[0].displayName, 'Zebra');
assert.equal(filterAndSortRepositories(catalog, {...defaults, owner:'Owner', visibility:'private', presence:'local'}).length, 1);
assert.equal(filterAndSortRepositories(catalog, {...defaults, owner:'Owner', visibility:'public'}).length, 0);
assert.equal(filterAndSortRepositories(catalog, {...defaults, presence:'unlinked'})[0].displayName, 'Alpha');
assert.equal(catalog[0].displayName, 'Zebra'); // Sorting never mutates source or selection order.
assert.equal(repositoryControls(repos[1])[0].id, 'locate');
assert.deepEqual(readRepositoryFilters('{bad'), defaults);
assert.deepEqual(readRepositoryFilters(JSON.stringify({...defaults, sort:'invalid'})), defaults);
console.log('Combined filters, sorting, and folder-link priority passed');
