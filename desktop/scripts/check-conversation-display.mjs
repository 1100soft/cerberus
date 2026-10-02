import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../src/lib/conversationDisplay.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {foldIntermediateMessages}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const messages=[{id:'u1',role:'user',text:'Do it'},{id:'a1',role:'assistant',text:'First step'},{id:'a2',role:'assistant',text:'Second step'},{id:'a3',role:'assistant',text:'Done',edits:[{path:'a',kind:'update'}]},{id:'u2',role:'user',text:'Thanks'}];
const display=foldIntermediateMessages(messages);
assert.equal(display.length,3);
assert.equal(display[1].text,'Done');
assert.deepEqual(display[1].steps.map(step=>step.text),['First step','Second step']);
assert.equal(display[1].edits.length,1);
assert.deepEqual(foldIntermediateMessages([{id:'single',role:'assistant',text:'Only answer'}]),[{id:'single',role:'assistant',text:'Only answer'}]);
console.log('Consecutive assistant updates fold under their final response');
