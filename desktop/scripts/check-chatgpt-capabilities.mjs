import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const complete=await readFile(new URL('../src/lib/chatgptCapabilities.ts',import.meta.url),'utf8');
const source=complete.slice(complete.indexOf('function snapshots'),complete.indexOf('const chosenModels'));
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const module=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const data={models:[],usage:{rateLimits:{},rateLimitsByLimitId:{codex:{limitName:'Codex',primary:{usedPercent:25,windowDurationMins:300,resetsAt:2},credits:{balance:'4.5',unlimited:false}}}}};
assert.deepEqual(module.usageWindows(data),[{remaining:75,label:'5h',reset:module.formatResetTime(2)}]);
const current=Math.floor(Date.now()/1000);
assert.match(module.formatResetTime(current+3600),/^\d{2}:\d{2}$/);
assert.match(module.formatResetTime(current+172800),/^[A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2}$/);
assert.equal(module.usageCredits(data).balance,'4.5');
assert.equal(module.usageWindows({models:[],usage:{rateLimits:{primary:{usedPercent:40,windowDurationMins:10080}}}})[0].remaining,60);
console.log('ChatGPT usage supports current multi-bucket and legacy rate-limit responses');

// Exercise the hook's refresh lifecycle with isolated provider and React adapters.
const hookSource=complete.replace(/^import .*;\n/gm,'');
const fixturePrefix=`
let hookState={},effect,cleanup,refresh,fail=false;
const localStorage={getItem:()=>null};
const window={addEventListener:(name,fn)=>{refresh=fn;},removeEventListener:()=>{}};
const useState=()=>[hookState,value=>{hookState=value;}];
const useEffect=fn=>{effect=fn;};
const useSyncExternalStore=()=>undefined;
const inTauri=()=>true;
const invoke=async()=>{if(fail)throw Error('Catalog offline');return {models:[{model:'available-model'}]};};
`;
const fixtureSuffix=`
export async function verifyRefresh(){
 useChatgptCapabilities('first');cleanup=effect();await new Promise(resolve=>setTimeout(resolve,0));
 if(hookState.data?.models[0].model!=='available-model')throw Error('Catalog was not loaded');
 fail=true;refresh();await new Promise(resolve=>setTimeout(resolve,0));
 if(hookState.data||!hookState.error?.includes('offline'))throw Error('Failed verification retained selectable models');
 cleanup();const other=useChatgptCapabilities('second');if(other.data)throw Error('Catalog leaked across accounts');
 cleanup=effect();await new Promise(resolve=>setTimeout(resolve,0));cleanup();
}
`;
const fixtureCode=ts.transpileModule(fixturePrefix+hookSource+fixtureSuffix,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const fixture=await import(`data:text/javascript;base64,${Buffer.from(fixtureCode).toString('base64')}`);
await fixture.verifyRefresh();
assert.deepEqual(fixture.commonCapabilities([{models:[{model:'shared'},{model:'first-only'}]},{models:[{model:'shared'}]}]).models,[{model:'shared'}]);
assert.deepEqual(fixture.commonCapabilities([{models:[{model:'shared'}]},{models:[],modelsError:'Unavailable'}]).models,[]);
console.log('Codex choices require verified availability and remain isolated by account; multiple accounts use their intersection');
