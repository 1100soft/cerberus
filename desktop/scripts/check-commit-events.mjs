import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/commitEvents.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {createsLocalCommit}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
for(const message of ['fetch origin: fast-forward','fetch . origin/wip:refs/heads/wip: fast-forward','merge refs/remotes/origin/wip: Fast-forward','merge origin/wip: Fast-forward','pull: Fast-forward','checkout: moving from main to wip','branch: Created from origin/wip','rebase (finish): refs/heads/wip onto abc'])assert.equal(createsLocalCommit(message),false,message);
for(const message of ['commit: fix','commit (initial): initial','commit (amend): amended','cherry-pick: fix','merge feature: Merge made by the ort strategy.'])assert.equal(createsLocalCommit(message),true,message);
console.log('Local commit versus imported history checks passed');
