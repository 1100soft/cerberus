import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleOf=source=>import(`data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`);
const {PageSnapshots}=await moduleOf(await readFile(new URL('../src/lib/pageSnapshots.ts',import.meta.url),'utf8'));
globalThis.emailCacheFixture={PageSnapshots};
globalThis.window=new EventTarget();
const calls=[];let fail=false,hold;
globalThis.emailCacheFixture.invoke=async(name,args)=>{
 calls.push([name,args]);
 if(name==='feedback_config')return {address:args.repositoryId+'@example.test'};
 if(name==='feedback_request'){
  if(fail)throw Error('offline');
  if(hold){const waiting=hold;hold=undefined;return waiting;}
  return [{path:'INBOX',selectable:true,count:calls.length}];
 }
 return undefined;
};
const source=(await readFile(new URL('../src/lib/feedback.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const {feedback}=await moduleOf('const {PageSnapshots,invoke}=globalThis.emailCacheFixture;const inTauri=()=>true;\n'+source);
const count=(name,id)=>calls.filter(([method,args])=>method===name&&args.repositoryId===id).length;
await Promise.all([feedback.config('a'),feedback.config('a'),feedback.config('a')]);
assert.equal(count('feedback_config','a'),1,'configuration reads must coalesce');
await feedback.config('a');assert.equal(count('feedback_config','a'),1,'reuse recent configuration');
await feedback.config('b');assert.equal(count('feedback_config','b'),1);
const query={action:'folderTree'};
const [first]=await Promise.all([feedback.request('a',query),feedback.request('a',query)]);
assert.equal(count('feedback_request','a'),1,'count scans must coalesce');
assert.deepEqual(await feedback.request('a',query),first);
const forced=await feedback.request('a',query,true);
assert.equal(count('feedback_request','a'),2);assert.notDeepEqual(forced,first);
fail=true;await assert.rejects(feedback.request('a',query,true),/offline/);fail=false;
assert.deepEqual(await feedback.request('a',query),forced,'failure must preserve usable counts');
window.dispatchEvent(new CustomEvent('feedback-mail-changed',{detail:'a'}));
let resolveOld;hold=new Promise(resolve=>resolveOld=resolve);
const old=feedback.request('a',query);await Promise.resolve();await Promise.resolve();
window.dispatchEvent(new CustomEvent('feedback-mail-changed',{detail:'a'}));
const fresh=await feedback.request('a',query);resolveOld([{path:'stale'}]);await old;
assert.deepEqual(await feedback.request('a',query),fresh,'invalidated scan must not overwrite a fresh result');
await feedback.save('a',{address:'new@example.test'});
await feedback.config('a');assert.equal(count('feedback_config','a'),2,'saving must invalidate configuration');
assert.equal(count('feedback_config','b'),1,'unrelated accounts stay cached');
await feedback.request('a',query);assert.notDeepEqual(await feedback.request('a',query),fresh,'saving must invalidate counts');
console.log('Email cache: coalescing, account isolation, reuse, forced refresh, failures, mutation invalidation and stale-read races passed.');
