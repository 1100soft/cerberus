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
const events='export async function listen(name,callback){globalThis.__activityEvent=callback;return ()=>{globalThis.__activityUnsubscribed=true;};}';
source=source.replace("import('@tauri-apps/api/event')",`import('data:text/javascript;base64,${Buffer.from(events).toString('base64')}')`);
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

working=true;calls.length=0;
await cache.refreshWorkingRepositories('codex','project:one');
assert.equal(cache.repositoryHistoryWorking('project:one'),true,'start hints must refresh previously idle projects');
assert.equal(cache.repositoryHistoryWorking('other'),false,'start hints must remain project scoped');
assert.equal(calls.length,1);
working=false;calls.length=0;await cache.refreshWorkingRepositories('codex','new-project');
assert.equal(calls.length,1,'a session hint must discover work in a project whose history was never opened');
console.log('Activity hints detect starts in idle/unopened projects without refreshing unrelated projects');

// Exercise the app-lifetime listener independently of any mounted conversation pane.
globalThis.window=Object.assign(new EventTarget(),{__TAURI_INTERNALS__:{}});
globalThis.document=Object.assign(new EventTarget(),{hidden:false});
let enabled=true;
globalThis.localStorage={getItem:()=>JSON.stringify({codex:enabled})};
const realInterval=globalThis.setInterval,realClearInterval=globalThis.clearInterval;
globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};
const stop=cache.watchWorkingRepositories(()=>[{id:'project:one',localPath:'/repo-one'}]);
await new Promise(resolve=>setTimeout(resolve,20));calls.length=0;
working=true;
globalThis.__activityEvent({payload:{provider:'codex',repositoryPath:'/repo-one',threadId:'one',working:true}});
assert.equal(cache.repositoryHistoryWorking('project:one'),true,'the start hint should update an already known thread immediately');
await new Promise(resolve=>setTimeout(resolve,400));
assert.deepEqual(calls.map(call=>call.repo),['project:one']);
calls.length=0;working=false;
globalThis.__activityEvent({payload:{provider:'codex',repositoryPath:'/repo-one',threadId:'one',working:false}});
assert.equal(cache.repositoryHistoryWorking('project:one'),false,'completion should clear the cached indicator immediately');
await new Promise(resolve=>setTimeout(resolve,400));
assert.deepEqual(calls.map(call=>call.repo),['project:one']);
enabled=false;calls.length=0;
globalThis.__activityEvent({payload:{provider:'codex',repositoryPath:'/repo-one',threadId:'one',working:true}});
await new Promise(resolve=>setTimeout(resolve,400));assert.equal(calls.length,0,'unchecked providers must not be queried');
stop();assert.equal(globalThis.__activityUnsubscribed,true);
globalThis.setInterval=realInterval;globalThis.clearInterval=realClearInterval;
console.log('Native event listener applies start/completion hints immediately, scopes refreshes, respects provider opt-in and unsubscribes');
