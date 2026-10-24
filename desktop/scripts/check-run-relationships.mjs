import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/runRelationships.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {runRelationships}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const sha='a'.repeat(40),base={repositoryId:'repo',createdAt:1,kind:'agent',status:'completed'};
const producer={...base,automationId:'produce',runId:'original',producedCommits:[sha]};
const review={...base,automationId:'review',runId:'review-run',commitTriggered:true,commitSha:sha};
const other={...producer,repositoryId:'other',runId:'other-run'};
const imported={...review,runId:'imported',commitTriggered:false};
const prefix={...review,runId:'prefix',commitSha:sha.slice(0,8)};
assert.equal(runRelationships(review,[producer,review,other]).parents[0].run.runId,'original');
assert.deepEqual(runRelationships(producer,[producer,review,other,imported,prefix]).children.map(edge=>edge.run.runId),['review-run']);
assert.equal(runRelationships(review,[review,other]).parents[0].run,undefined);
assert.equal(runRelationships({...review,handoffName:'revise',handoffId:'original'},[producer,review]).parents.length,2);
// Enrichment is used when a full dialog entry lacks the separately stored producer index.
assert.equal(runRelationships({...producer,producedCommits:undefined},[producer,review]).children.length,1);
console.log('Commit/handoff relationship joins use full SHAs, repository scope and actual trigger conditions');
