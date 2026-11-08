import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/coalescedRefresh.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {coalescedRefresh}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
const timers=new Map();let next=0;
globalThis.setTimeout=callback=>{const id=++next;timers.set(id,callback);return id;};globalThis.clearTimeout=id=>timers.delete(id);
const values=[],errors=[];let calls=0,finish;
const queue=coalescedRefresh(async()=>{calls++;return new Promise(resolve=>finish=resolve);},(...args)=>values.push(args),error=>errors.push(error));
const fire=()=>{const [id,callback]=timers.entries().next().value;timers.delete(id);return callback();};
try{
 for(let i=0;i<10000;i++)queue.enqueue('repo',i);
 assert.equal(timers.size,1);const first=fire();assert.equal(calls,1);
 for(let i=10000;i<20000;i++)queue.enqueue('repo',i);
 assert.equal(calls,1);assert.equal(timers.size,0,'a slow read spawned overlapping work');
 finish('first');await first;assert.equal(timers.size,1);assert.equal(values[0][2],9999);
 const second=fire();assert.equal(calls,2);finish('latest');await second;assert.equal(values[1][2],19999);assert.equal(timers.size,0);
 queue.enqueue('one',1);queue.enqueue('two',2);assert.equal(timers.size,2);queue.clear();assert.equal(timers.size,0);
 queue.enqueue('repo',3);const stale=fire();queue.enqueue('repo',4);queue.clear();finish('obsolete');await stale;
 assert.equal(values.length,2,'disposed work published a stale result');assert.equal(timers.size,0);
 const failing=coalescedRefresh(async()=>{throw Error('offline');},()=>assert.fail('failed read published'),error=>errors.push(error));
 failing.enqueue('repo',1);await fire();assert.equal(errors.length,1);failing.enqueue('repo',2);await fire();assert.equal(errors.length,2);failing.clear();
 console.log('Change event storms coalesce, slow reads have one follow-up, projects remain independent and disposed/failed reads recover');
}finally{queue.clear();globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
