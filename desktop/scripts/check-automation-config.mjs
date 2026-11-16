import ts from 'typescript';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const dir=await mkdtemp(join(tmpdir(),'cerberus-workflow-'));
try{
 for(const name of ['automationInputs','scriptRuntime','automationConfig']){
 let source=await readFile(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8');
 source=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/from '\.\/(automationInputs|scriptRuntime)'/g,"from './$1.mjs'");
 await writeFile(join(dir,`${name}.mjs`),source);
 }
 const {exportAutomationDefinitions:exported,parseWorkflowProposal:parse,workflowDiff}=await import(pathToFileURL(join(dir,'automationConfig.mjs')));
 const profile={id:'a1',provider:'codex',label:'Account'};
 const job={id:'existing',title:'Existing',kind:'notification',provider:'codex',prompt:'Reminder',enabled:true,repositoryId:'p1',repositoryIds:['p1'],conditions:['manual'],trigger:'manual',threadId:'',minutes:60,nextAt:9,editor:'vscode',target:'new',ciSince:123,feedbackSince:456,lastResult:'private runtime output',profile,route:'identity',accountsByRepository:{p1:{profile,route:'identity'}}};
 const current={schemaVersion:1,revision:'r1',automations:exported([job]).map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]])))};
 const run=rows=>parse(JSON.stringify({...current,automations:rows}),current,[job],['p1'],[profile]);
 assert.equal(runUnchanged(),job);
 function runUnchanged(){return run(current.automations)[0];}
 const rows=structuredClone(current.automations);rows[0].title='Changed';
 let result=run(rows);assert.equal(result[0].ciSince,123);assert.equal(result[0].feedbackSince,456);assert.equal(result[0].route,'identity');assert.deepEqual(result[0].accountsByRepository,job.accountsByRepository);assert.equal(result[0].lastResult,job.lastResult);
 assert(!JSON.stringify(current).includes('private runtime output'));assert(!('accountsByRepository' in current.automations[0]));
 assert.equal(workflowDiff([job],result).changed.length,1);
 assert.equal(run([]).length,0);
 const added={id:'new',title:'New',kind:'shell',provider:'codex',prompt:'echo test',enabled:false,repositoryIds:['p1'],conditions:['manual'],scriptRuntime:{preset:'bash'}};
 assert.equal(run([...rows,added])[1].enabled,false);
 const bad=change=>{const a=structuredClone(rows);change(a);assert.throws(()=>run(a));};
 bad(a=>a.push(a[0]));bad(a=>a[0].kind='unknown');bad(a=>a[0].enabled='false');bad(a=>a[0].repositoryIds=['unknown']);bad(a=>a[0].conditions=['manual','commit']);bad(a=>a[0].conditionSets=[['commit','ciFail']]);bad(a=>a[0].conditions=[]);bad(a=>a[0].minutes=0);bad(a=>a[0].accountsByRepository={});bad(a=>a[0].accountId='unknown');bad(a=>a[0].scriptRuntime={preset:'custom'});bad(a=>a[0].manualInputs=[{name:'x',type:'choice',options:['a','a']}]);bad(a=>a[0].handoffName='../escape');bad(a=>a[0].emitsHandoffs=['../escape']);bad(a=>a[0].commitBranch='bad..branch');
 assert.throws(()=>parse(JSON.stringify({...current,revision:'old'}),current,[job],['p1'],[profile]),/revision|changed/);
 assert.throws(()=>parse(JSON.stringify(current),current,[{...job,title:'concurrent change'}],['p1'],[profile]),/changed/);
 console.log('Workflow configuration checks passed: create/update/delete, runtime/account preservation, malformed proposals, stale revisions and concurrent edits.');
}finally{await rm(dir,{recursive:true,force:true});}
