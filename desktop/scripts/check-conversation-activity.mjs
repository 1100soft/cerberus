import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const calls=[];
let working=true,fail=false;
globalThis.__activityApi={
 codexThreads:async(repo,archived)=>{calls.push({repo,archived});if(fail)throw Error('offline');return {data:[{id:'one',updatedAt:1,working}],nextCursor:null};},
 cursorThreads:async()=>({data:[],nextCursor:null})
};
let source=await readFile(new URL('../src/lib/conversationCache.ts',import.meta.url),'utf8');
source=source.replace('import { api } from "./api";','const api=globalThis.__activityApi;');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const cache=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
await cache.refreshThreadList('project:one',false,['codex']);
await cache.refreshThreadList('project:one',false,['codex','cursor']);
await cache.refreshThreadList('other',false,['codex']);
assert.equal(cache.repositoryHistoryWorking('project:one'),true);
let updates=0;const unsubscribe=cache.subscribe(()=>updates++);
calls.length=0;fail=true;
await cache.refreshWorkingRepositories();
assert.equal(cache.repositoryHistoryWorking('project:one'),true,'failed reads must retain known activity');
fail=false;working=false;calls.length=0;
await cache.refreshWorkingRepositories();
assert.equal(cache.repositoryHistoryWorking('project:one'),false,'all provider-filter cache variants must settle');
assert.equal(cache.repositoryHistoryWorking('other'),false,'unselected projects must settle');
assert.equal(calls.length,2,'coalesce provider/filter variants per project');
assert.ok(updates>0,'notify project-card subscribers');
calls.length=0;await cache.refreshWorkingRepositories();
assert.equal(calls.length,0,'do not poll idle projects');
unsubscribe();
console.log('Background activity settles unselected projects and cache variants, preserves failures, and skips idle projects');
