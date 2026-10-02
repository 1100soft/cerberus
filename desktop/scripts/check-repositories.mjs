import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
let source = await readFile(new URL('../src/lib/repositories.ts', import.meta.url), 'utf8');
const shortcutSource = await readFile(new URL('../src/lib/shortcuts.ts', import.meta.url), 'utf8');
const shortcutJS = ts.transpileModule(shortcutSource, { compilerOptions: {module:ts.ModuleKind.ESNext} }).outputText;
source = source.replace("'./shortcuts'", JSON.stringify(`data:text/javascript;base64,${Buffer.from(shortcutJS).toString('base64')}`));
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { mergeRepositories, selectRepositoryControl, repositoryControls, isLocal, filterAndSortRepositories, filterMatchCount, readRepositoryFilters, identitiesWithRepositoryAccess } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const local = { id: 'local', localPath: '/repo', localPresent: true, canonicalRemote: 'git@github.com:Owner/Repo.git' };
const remote = { id: 1, name: 'Repo', owner: 'Owner', htmlUrl: 'https://github.com/owner/repo', private: true, identityId: 'one' };
const repos = mergeRepositories([local], [remote, { ...remote, identityId: 'two' }, { ...remote, id: 2, name: 'Other', htmlUrl: 'https://github.com/owner/other', identityId: 'two' }]);
assert.equal(repos.length, 2);
assert.deepEqual(repos[0].accessibleIdentityIds.sort(), ['one', 'two']);
assert.equal(identitiesWithRepositoryAccess([{id:'one'},{id:'two'}], repos[0], [remote, { ...remote, identityId: 'two' }]).map(i => i.id).join(), 'one,two');
assert.equal(identitiesWithRepositoryAccess([{id:'one'},{id:'two'}], repos[1], [remote, { ...remote, identityId: 'two' }, { ...remote, id: 2, name: 'Other', htmlUrl: 'https://github.com/owner/other', identityId: 'two' }]).map(i => i.id).join(), 'two');
assert.equal(repos[0].github.private, true);
assert.equal(isLocal(repos[1]), false);
assert.equal(repositoryControls(repos[0])[0].id, 'chat');
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
  { ...repos[0], displayName:'Zebra', manualOrder:0, stagedCount:2, modifiedCount:1, untrackedCount:0, lastCommitAt:'2026-09-10T00:00:00Z\n', github:{...remote, updatedAt:'2026-09-10T00:00:00Z'} },
  { ...repos[1], displayName:'Alpha', manualOrder:1, github:{...remote, private:false, owner:'other', updatedAt:'2026-09-17T00:00:00Z', pushedAt:'2026-09-01T00:00:00Z'} },
];
const defaults = readRepositoryFilters(null);
assert.equal(filterAndSortRepositories(catalog, {...defaults, sort:'name'})[0].displayName, 'Alpha');
assert.equal(filterAndSortRepositories(catalog, {...defaults, sort:'updated'})[0].displayName, 'Zebra');
assert.equal(filterAndSortRepositories(catalog, {...defaults, sort:'changes'})[0].displayName, 'Zebra');
assert.equal(filterAndSortRepositories(catalog, {...defaults, owners:['Owner'], visibility:'private', presence:'local'}).length, 1);
assert.equal(filterAndSortRepositories(catalog, {...defaults, owners:['Owner'], visibility:'public'}).length, 0);
assert.equal(filterAndSortRepositories(catalog, {...defaults, presence:'unlinked'})[0].displayName, 'Alpha');
assert.equal(filterAndSortRepositories(catalog, {...defaults, owners:['Owner', 'other']}).length, 2);
assert.equal(filterAndSortRepositories(catalog, {...defaults, status:'dirty'}).length, 1);
assert.equal(filterMatchCount(catalog, defaults, '', { visibility:'private' }), 1);
const staleGithub = [
  { ...catalog[0], displayName:'Cerberus', stagedCount:0, modifiedCount:0, untrackedCount:0, lastCommitAt:'2026-09-17T12:00:00Z', github:{...remote, updatedAt:'2020-01-01T00:00:00Z'} },
  { ...catalog[1], displayName:'Noisy', github:{...remote, owner:'other', updatedAt:'2026-09-17T18:00:00Z', pushedAt:'2026-01-01T00:00:00Z'} },
];
assert.equal(filterAndSortRepositories(staleGithub, {...defaults, sort:'updated'})[0].displayName, 'Cerberus');
assert.equal(catalog[0].displayName, 'Zebra'); // Sorting never mutates source or selection order.
assert.equal(repositoryControls(repos[1])[0].id, 'locate');
assert.deepEqual(readRepositoryFilters('{bad'), defaults);
assert.deepEqual(readRepositoryFilters(JSON.stringify({ owner:'Owner', sort:'invalid' })), {...defaults, owners:['Owner'], ownersExplicit:true});
console.log('Combined filters, sorting, and folder-link priority passed');

assert.equal(filterAndSortRepositories(catalog, {...defaults, owners:[], ownersExplicit:true}).length, 0);
assert.equal(filterAndSortRepositories(catalog, readRepositoryFilters('{"owners":[]}')).length, 2);
assert.equal(filterAndSortRepositories(catalog, readRepositoryFilters('{"owners":[],"ownersExplicit":true}')).length, 0);
