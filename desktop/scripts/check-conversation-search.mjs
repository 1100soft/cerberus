import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const moduleUrl=source=>`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64')}`;
const calls=[];
const initial={threads:[{id:'one',key:'codex:one',provider:'codex',name:'Title',updatedAt:1}],cursors:{codex:'older'},error:''};
globalThis.__searchMock={
 refreshThreadList:async(repo,archived,enabled)=>{calls.push({repo,archived,enabled});return archived ? {threads:[{id:'archived',key:'codex:archived',provider:'codex',name:'Archive'}],cursors:{},error:''} : initial;},
 loadOlderThreads:async()=>({...initial,threads:[...initial.threads,{id:'two',key:'codex:two',provider:'codex',name:'Older thread'}],cursors:{}}),
 refreshMessages:async(repo,thread)=>({messages:[{id:thread.id,role:'assistant',text:thread.id==='archived'?'hidden needle':'recent text'}],nextCursor:thread.id==='one'?'old-messages':null}),
 loadOlderMessages:async()=>({messages:[{id:'old',role:'user',text:'older needle'}],nextCursor:null})
};
let source=await readFile(new URL('../src/lib/conversationSearch.ts',import.meta.url),'utf8');
source=source.replace("'./conversationCache'",JSON.stringify(moduleUrl('export const {loadOlderMessages,loadOlderThreads,refreshMessages,refreshThreadList}=globalThis.__searchMock;')));
const {searchConversations,textMatches}=await import(moduleUrl(source));let hits=[];
await searchConversations('repo',['codex'],[{id:'app',name:'App',profile:{provider:'cursor'},messages:[{id:'local',text:'local needle'}]}],'needle',()=>false,next=>hits=next);
assert.deepEqual(hits.map(hit=>hit.key),['app:app','codex:one','codex:archived']);
assert.equal(hits[1].messageId,'old');assert.equal(hits[2].archived,true);
assert.ok(calls.every(call=>call.repo==='repo' && call.enabled.join(',')==='codex'));
let published=false;await searchConversations('repo',['codex'],[],'needle',()=>true,()=>{published=true;});
assert.equal(calls.length,2); // cancellation must stop requests
console.log('Repository conversation search covers old messages, old threads, archives, app chats, provider scope and cancellation');

assert.deepEqual(textMatches([{id:'a',text:'Needle needle'},{id:'b',text:'needle'}],'needle'),[{id:'a',occurrence:0},{id:'a',occurrence:1},{id:'b',occurrence:0}]);
