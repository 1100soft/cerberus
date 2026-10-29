import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
globalThis.window=new EventTarget();
const catalog=JSON.parse(await readFile(new URL('../src/lib/mailProviders.json',import.meta.url),'utf8'));
const load=async(path,replace=source=>source)=>{
 const source=replace(await readFile(new URL(path,import.meta.url),'utf8'));
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};
const {defaultMailbox}=await load('../src/lib/feedback.ts',source=>source.replace(/^import .*;\n/gm,''));
const {normalizeMailbox,selectMailProvider,connectionOverrides,mailboxAccountChanged}=await load('../src/lib/mailProviders.ts',source=>source.replace("import catalog from './mailProviders.json';",`const catalog=${JSON.stringify(catalog)};`));
const defaults=defaultMailbox();assert.equal(defaults.provider,'custom');assert.equal(defaults.imapHost,'');assert.equal(defaults.smtpHost,'');
assert.equal(new Set(catalog.map(provider=>provider.id)).size,catalog.length);
for(const provider of catalog){
 const selected=selectMailProvider({...defaults,address:'alias@example.org',username:'account@example.org',inbox:'Feedback',certificatePath:'/old.pem'},provider.id);
 for(const [key,value] of Object.entries(provider.settings))assert.equal(selected[key],value);
 assert.equal(selected.username,'account@example.org');assert.equal(selected.inbox,'Feedback');assert.equal(selected.certificatePath,'');
 assert.equal(normalizeMailbox(selected).provider,provider.id);assert.equal(connectionOverrides(selected),false);
 for(const url of [provider.documentation,provider.passwordDocumentation].filter(Boolean))assert.equal(new URL(url).protocol,'https:');
 if(provider.id!=='custom')assert.ok(provider.documentation,provider.id);
}
const legacy={...defaults,...catalog.find(provider=>provider.id==='purelymail').settings,provider:undefined,certificatePath:'/keep.pem'};
assert.equal(normalizeMailbox(legacy).provider,'purelymail');assert.equal(normalizeMailbox(legacy).certificatePath,'/keep.pem');
const customLegacy={...legacy,imapPort:999};assert.equal(normalizeMailbox(customLegacy).provider,'custom');assert.equal(normalizeMailbox(customLegacy).imapPort,999);
const savedOverride={...customLegacy,provider:'purelymail'};assert.equal(normalizeMailbox(savedOverride).provider,'purelymail');assert.equal(connectionOverrides(savedOverride),true);
assert.equal(mailboxAccountChanged(legacy,{...legacy,imapHost:'different.example.org'}),true);assert.equal(mailboxAccountChanged(legacy,{...legacy,username:'different@example.org'}),true);assert.equal(mailboxAccountChanged(legacy,{...legacy,imapPort:994}),false);
assert.equal(catalog.find(provider=>provider.id==='outlook').auth,'oauth');assert.equal(catalog.find(provider=>provider.id==='microsoft365').auth,'oauth');
assert.equal(selectMailProvider(defaults,'proton').imapPort,1143);assert.equal(selectMailProvider(defaults,'proton').smtpPort,1025);
console.log('Provider defaults, exact legacy migration, override preservation, credential isolation and documentation links passed');
