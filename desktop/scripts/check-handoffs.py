"""Exercise saved handoff configuration and the automation runner in WebKitGTK.
Requires Vite on 127.0.0.1:3000.
"""
import json
import sys
import urllib.request
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib
urllib.request.urlopen('http://127.0.0.1:3000', timeout=5).close()
script = r"""
(async()=>{
 const pause=(ms=40)=>new Promise(resolve=>setTimeout(resolve,ms));
 const wait=async(get)=>{for(let i=0;i<150;i++){const value=get();if(value)return value;await pause();}throw Error('Timed out waiting for handoff');};
 const assert=(value,message)=>{if(!value)throw Error(message);};
 await wait(()=>document.querySelector('[aria-label="Toggle navigation"]'));
 const cache=await (await fetch('/src/lib/conversationCache.ts')).text();
 const apiPath=cache.match(/from "([^"]*\/api\.ts[^"]*)"/)[1];
 const {api}=await import(apiPath);
 const module=await import(apiPath.replace('/lib/api.ts','/lib/savedPrompts.ts'));
 for(const job of module.savedPrompts())module.removePrompt(job.id);
 assert(module.validHandoffName('review')&&!module.validHandoffName('../review'),'Unsafe handoff name accepted');
 assert(module.validCommitBranchPatterns('main, wip, feature/*')&&module.matchesCommitBranch('feature/foo','main, wip, feature/*')&&!module.matchesCommitBranch('release/foo','main, wip, feature/*'),'Commit branch patterns failed');
 assert(module.matchesCommitBranch('wip','main, autosave/*',true)&&!module.matchesCommitBranch('main','main, autosave/*',true)&&!module.matchesCommitBranch('autosave/x','main, autosave/*',true),'Commit branch exclusions failed');
 const augmented=module.automationPromptWithHandoffs('Original task',{id:'one',name:'review',repositoryId:'1',path:'/repo/.git/claimed/review/one.txt'},{correction:'/repo/.git/outgoing/correction/two.txt'});
 assert(augmented.includes('raise the ready flag')&&augmented.includes('actual JSON booleans')&&augmented.includes('preserve flag names and case'),'Agent flag instructions missing');
 assert(augmented.startsWith('Handoff instructions')&&augmented.indexOf('Read the incoming')<augmented.indexOf('Task:')&&augmented.includes('claimed/review/one.txt')&&augmented.includes('outgoing/correction/two.txt'),'Agent prompt did not require reading the handoff first');
 const base={repositoryId:'1',repositoryIds:['1'],repositoryLabels:{'1':'backend-api'},provider:'codex',threadId:'',minutes:60,enabled:true,nextAt:0,editor:'vscode'};
 module.savePrompt({...base,id:'producer',title:'Producer',kind:'shell',prompt:'emit review',trigger:'manual',enabled:false,emitsHandoffs:['review']});
 module.savePrompt({...base,id:'consumer',title:'Consumer',kind:'shell',prompt:'read review',trigger:'handoff',handoffName:'review'});
 const stored=JSON.parse(localStorage.getItem('gitcerberus.savedPrompts.v1'));
 assert(stored.find(item=>item.id==='consumer').handoffName==='review'&&stored.find(item=>item.id==='producer').emitsHandoffs[0]==='review','Handoff configuration was not persisted');
 const namesModule=await import(apiPath.replace('/lib/api.ts','/lib/handoffNames.ts'));
 assert(namesModule.knownHandoffNames(module.savedPrompts()).includes('review'),'Active handoff name missing');
 assert(!namesModule.knownHandoffNames([]).includes('review'),'Deleted handoff name remained suggested');
 const repoList=[{id:'1',displayName:'backend-api',localPresent:true,localPath:'/virtual/1'},{id:'2',displayName:'frontend-ui',localPresent:true,localPath:'/virtual/2'}];
 assert(namesModule.handoffPairWarnings(module.savedPrompts(),repoList).length===0,'Matching handoffs were reported as incomplete');
 const unmatched=[{...base,id:'orphan',title:'Orphan',prompt:'emit',trigger:'manual',includeFutureRepositories:true,emitsHandoffs:['correction']}];
 assert(namesModule.handoffPairWarnings(unmatched,repoList)[0]==='correction must trigger an automation for 2 repositories.','Unmatched emission warning is incorrect');
 assert(namesModule.handoffPairWarnings([{...base,id:'reader',title:'Reader',prompt:'read',trigger:'handoff',handoffName:'correction'}],repoList)[0]==='correction must be emitted by an automation for backend-api.','Unmatched trigger warning is incorrect');
 assert(module.validEmittedHandoff('(review)')&&!module.validEmittedHandoff('(review')&&!module.validEmittedHandoff('((review))'),'Conditional emission validation incorrect');
 const conditionalPrompt=module.automationPromptWithHandoffs('Emit review only if issues exist',undefined,{review:'/out/review'},['review']);
 assert(conditionalPrompt.includes('conditional')&&conditionalPrompt.includes('leave its output file absent'),'Conditional prompt instructions missing');
 assert(namesModule.knownHandoffNames([{...base,emitsHandoffs:['(review)']}]).includes('review'),'Conditional name not normalized for suggestions');
 const pending=[];const outputPaths=new Map();const calls=[];let claims=0,finishes=0;
 api.handoffOutputPath=async(repo,name,runId)=>`/virtual/${repo}/${name}/${runId}.txt`;
 api.publishHandoff=async(repo,name,runId)=>{const path=`/virtual/${repo}/${name}/${runId}.txt`;if(!outputPaths.has(path))return false;pending.push({id:runId,path:`/virtual/${repo}/claimed/${name}/${runId}.txt`,name,repo,payload:outputPaths.get(path),claimed:false});return true;};
 api.hasPendingHandoff=async(repo,name)=>pending.some(item=>item.repo===repo&&item.name===name&&!item.claimed);
 api.claimHandoff=async(repo,name)=>{const item=pending.find(item=>item.repo===repo&&item.name===name&&!item.claimed);if(!item)return null;item.claimed=true;claims++;return {id:item.id,path:item.path};};
 api.finishHandoff=async(repo,name,id)=>{const index=pending.findIndex(item=>item.repo===repo&&item.name===name&&item.id===id);if(index>=0)pending.splice(index,1);finishes++;};
 api.releaseHandoff=async(repo,name,id)=>{const item=pending.find(item=>item.repo===repo&&item.name===name&&item.id===id);if(item)item.claimed=false;};
 api.codexThreads=async()=>({data:[]});api.cursorThreads=async()=>({data:[]});
 api.runAutomationShell=async(repo,script,onOutput,inputPath,outgoing)=>{calls.push({repo,script,inputPath,outgoing});if(script==='emit review')outputPaths.set(outgoing.review,'payload '+calls.length);else if(script!=='skip review')assert(pending.find(item=>item.path===inputPath)?.payload,'Triggered shell did not receive the claimed payload path');return {result:'done',stdout:'done',stderr:''};};
 for(let emission=1;emission<=2;emission++){
   await module.runSavedPrompt('producer',true,'1');
   await Promise.all([module.checkSavedPromptSchedule(),module.checkSavedPromptSchedule()]);
   await wait(()=>calls.filter(item=>item.script==='read review').length===emission);
   await wait(()=>pending.length===0);
   assert(claims===emission&&finishes===emission,'Handoff was processed more than once or not consumed');
   await module.checkSavedPromptSchedule();await pause();
   assert(calls.filter(item=>item.script==='read review').length===emission,'Consumed handoff retriggered');
 }
 const normalRun=api.runAutomationShell;
 api.runAutomationShell=async(repo,script,onOutput,inputPath,outgoing)=>{if(script==='read review'){calls.push({repo,script,inputPath,outgoing});throw Error('Fixture consumer failure');}return normalRun(repo,script,onOutput,inputPath,outgoing);};
 await module.runSavedPrompt('producer',true,'1');
 await wait(()=>module.savedPrompts().find(item=>item.id==='consumer')?.state==='error');
 assert(finishes===3&&pending.length===0,'Failed action left a claimed handoff that could replay');
 assert(module.savedPrompts().find(item=>item.id==='consumer').enabled,'Failure disabled the handoff consumer');
 await module.checkSavedPromptSchedule();await pause();
 assert(calls.filter(item=>item.script==='read review').length===3,'Failed handoff was processed again');
 module.savePrompt({...module.savedPrompts().find(item=>item.id==='consumer'),handoffVariables:['v','ready']});
 const matching=(item,repo,name,variables)=>item.repo===repo&&item.name===name&&!item.claimed&&(!variables?.length||variables.every(key=>item.variables?.[key]===true));
 api.hasPendingHandoff=async(repo,name,variables)=>pending.some(item=>matching(item,repo,name,variables));
 api.claimHandoff=async(repo,name,variables)=>{const item=pending.find(item=>matching(item,repo,name,variables));if(!item)return null;item.claimed=true;claims++;return {id:item.id,path:item.path};};
 pending.push({id:'false',path:'/virtual/false',repo:'1',name:'review',payload:'not ready',variables:{v:false,ready:true},claimed:false});
 await module.checkSavedPromptSchedule();await pause();assert(claims===3,'False variable triggered consumer');
 pending.push({id:'true',path:'/virtual/true',repo:'1',name:'review',payload:'ready',variables:{v:true,ready:true},claimed:false});
 api.runAutomationShell=normalRun;
 await module.checkSavedPromptSchedule();await wait(()=>finishes===4);
 assert(pending.length===1&&pending[0].id==='false'&&!pending[0].claimed,'Filtered claim consumed wrong emission');
 module.savePrompt({...base,id:'conditional-producer',title:'Conditional producer',kind:'shell',prompt:'skip review',trigger:'manual',emitsHandoffs:['(review)']});
 assert(JSON.parse(localStorage.getItem('gitcerberus.savedPrompts.v1')||'[]').some(item=>item.id==='conditional-producer'&&item.emitsHandoffs[0]==='(review)'),'Conditional name not persisted');
 await module.runSavedPrompt('conditional-producer',true,'1');
 assert(pending.length===1,'Skipped conditional shell unexpectedly emitted');
 assert(calls.at(-1).outgoing.review&&!calls.at(-1).outgoing['(review)'],'Conditional shell output path uses decorated name');
 module.savePrompt({...module.savedPrompts().find(item=>item.id==='conditional-producer'),prompt:'emit review'});
 await module.runSavedPrompt('conditional-producer',true,'1');
 assert(pending.some(item=>item.name==='review'&&item.id!=='false'),'Chosen conditional shell did not emit');
 for(const job of module.savedPrompts())module.disableAutomation(job.id);
 module.savePrompt({...base,id:'sets-fixture',title:'OR sets',kind:'notification',prompt:'Matched sets',trigger:'commit',conditions:['commit','push'],conditionSets:[['commit','push'],['pullRequest','fileChange']],enabled:true});
 let setRuns=0;api.publishHandoff=async()=>false;
 const originalLog=api.writeAutomationLog;api.writeAutomationLog=async log=>{if(log.automationId==='sets-fixture'&&log.status==='completed')setRuns++;return originalLog(log);};
 module.recordConditionEvent('1','commit');module.recordConditionEvent('1','pullRequest');await module.checkSavedPromptSchedule();await pause();
 assert(setRuns===0,'Partial conditions crossed OR rows');
 module.recordConditionEvent('1','push');await module.checkSavedPromptSchedule();await wait(()=>setRuns===1);
 module.recordConditionEvent('1','fileChange');await module.checkSavedPromptSchedule();await pause();assert(setRuns===1,'Other row reused events after an OR run');
 module.recordConditionEvent('1','pullRequest');await module.checkSavedPromptSchedule();await wait(()=>setRuns===2);
 assert(module.automationConditionSets(module.savedPrompts().find(job=>job.id==='sets-fixture')).length===2,'Condition sets lost in persistence');
 module.savePrompt({...module.savedPrompts().find(job=>job.id==='sets-fixture'),trigger:'ciPass',conditions:['ciPass'],conditionSets:[['ciPass'],['ciFail']],ciSince:0,state:undefined});
 for(const [id,conclusion] of [[901,'success'],[902,'failure']]){module.recordAutomationCiRuns('1',[{id,status:'completed',conclusion,headBranch:'main',headSha:'sha-'+id,updatedAt:new Date().toISOString(),htmlUrl:'https://example.test/'+id,name:'Fixture CI'}]);await wait(()=>setRuns===id-898);}
 window.__handoffCheck={passed:true,claims,finishes,calls:calls.length};
})().catch(error=>window.__handoffCheck={passed:false,error:String(error)});
"""
window=Gtk.OffscreenWindow()
view=WebKit2.WebView()
view.set_size_request(900,620)
window.add(view)
window.show_all()
exit_code=1
started=False

def checked(webview,result):
    global exit_code
    try:
        raw=webview.evaluate_javascript_finish(result).to_string()
        if raw in ('undefined','null'):return
        value=json.loads(raw)
        if value is None:return
        print(json.dumps(value))
        exit_code=0 if value['passed'] else 1
        Gtk.main_quit()
    except Exception as error:
        print(str(error),file=sys.stderr)
        Gtk.main_quit()

def poll():
    view.evaluate_javascript('JSON.stringify(window.__handoffCheck || null)',-1,None,None,None,checked)
    return True

def loaded(webview,event):
    global started
    if event==WebKit2.LoadEvent.FINISHED and not started:
        started=True
        view.evaluate_javascript(script+'\nvoid 0;',-1,None,None,None,None)
        GLib.timeout_add(300,poll)

view.connect('load-changed',loaded)
view.load_uri('http://127.0.0.1:3000')
GLib.timeout_add_seconds(35,lambda:(Gtk.main_quit(),False)[1])
Gtk.main()
sys.exit(exit_code)
