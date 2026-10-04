"""Exercise GitHub CI automation dispatch in WebKitGTK. Requires Vite on port 3000."""
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
 window.__ciStage='mount';
 const pause=(ms=40)=>new Promise(resolve=>setTimeout(resolve,ms));
 const wait=async(get)=>{for(let i=0;i<150;i++){const result=get();if(result)return result;await pause();}throw Error('Timed out waiting for CI automation');};
 const assert=(condition,message)=>{if(!condition)throw Error(message);};
 await wait(()=>document.querySelector('[aria-label="Toggle navigation"]'));
 window.__ciStage='open automation';
 document.querySelector('[aria-label="Toggle navigation"]').click();
 (await wait(()=>[...document.querySelectorAll('aside nav button')].find(node=>node.textContent.includes('Automation')))).click();
 (await wait(()=>document.querySelector('.automation-list-header button'))).click();
 await wait(()=>document.querySelector('[aria-label="New automation"]'));
 window.__ciStage='condition options';
 document.querySelector('[aria-label="Add condition"]').click();await pause();
 const conditionOptions=[...document.querySelectorAll('[role="option"]')];
 assert(conditionOptions.some(node=>node.textContent==='When CI passes')&&conditionOptions.some(node=>node.textContent==='When CI fails'),'CI conditions are missing from the dialog');
 conditionOptions.find(node=>node.textContent==='When CI passes').click();await pause();
 assert(!document.querySelector('.automation-repositories').open,'Repository picker expanded by default');document.querySelector('.automation-repositories summary').click();await pause();assert(document.querySelector('.automation-repositories .automation-scope-note').textContent.includes('only where the event occurs'),'CI repository scope is unclear');
 assert(document.querySelector('[aria-label="Branch patterns"]')?.value==='*'&&document.querySelector('[aria-label="All except"]'),'CI branch selector did not default to all branches');
 document.querySelector('[aria-label="Close new automation"]').click();
 window.__ciStage='scheduler setup';
 const source=await (await fetch('/src/lib/conversationCache.ts')).text();
 const apiPath=source.match(/from "([^"]*\/api\.ts[^"]*)"/)[1];
 const {api}=await import(apiPath);
 const automation=await import(apiPath.replace('/lib/api.ts','/lib/savedPrompts.ts'));
 for(const job of automation.savedPrompts())automation.removePrompt(job.id);
 const repos=['1','2'].map(id=>({id,displayName:'repo-'+id,localPresent:true,localPath:'/virtual/'+id,canonicalRemote:'https://github.com/example/repo-'+id,identity:{id:'github',providerUsername:'example'}}));
 api.repositories=async()=>repos;
 api.codexThreads=async()=>({data:[]});api.cursorThreads=async()=>({data:[]});
 const calls=[];api.runAutomationShell=async(repo,script,onOutput,incoming,outgoing,context)=>{calls.push({repo,script,context});return {result:'done',stdout:'done',stderr:''};};
 const passId='ci-pass-'+crypto.randomUUID(),failId='ci-fail-'+crypto.randomUUID();
 const now=Date.now();
 const base={repositoryId:'1',repositoryIds:['1','2'],provider:'codex',threadId:'',prompt:'echo ci',minutes:60,enabled:true,nextAt:now+60000,editor:'vscode',kind:'shell',ciSince:now-1000};
 automation.savePrompt({...base,id:passId,title:'CI passed',trigger:'ciPass',commitBranch:'main, feature/*'});
 automation.savePrompt({...base,id:failId,title:'CI failed',trigger:'ciFail',commitBranch:'main, feature/*'});
 automation.savePrompt({...base,id:'branch-set-'+crypto.randomUUID(),title:'Branch set',trigger:'commit',commitBranch:'release/*, hotfix',commitAllExcept:true,enabled:false});
 automation.savePrompt({...base,id:'plain-branch-set-'+crypto.randomUUID(),title:'Plain branch set',trigger:'commit',commitBranch:'main, wip',enabled:false});
 assert(automation.knownBranchSets(automation.savedPrompts()).includes('All except: release/*, hotfix'),'Saved branch set missing from suggestions');
 window.__ciStage='branch suggestions';
 document.querySelector('.automation-list-header button').click();await wait(()=>document.querySelector('[aria-label="New automation"]'));
 document.querySelector('[aria-label="Add condition"]').click();await pause();
 [...document.querySelectorAll('[role="option"]')].find(node=>node.textContent==='When CI fails').click();await pause();
 const branchInput=document.querySelector('[aria-label="Branch patterns"]');branchInput.blur();await pause(140);branchInput.focus();await pause();
 assert([...document.querySelectorAll('[aria-label="Branch patterns suggestions"] [role="option"]')].some(node=>node.textContent==='All except: release/*, hotfix'),'Saved branch set was not suggested');
 assert([...document.querySelectorAll('[aria-label="Branch patterns suggestions"] [role="option"]')].some(node=>node.textContent==='main, wip'),'Focusing did not show branch sets without wildcards');
 branchInput.blur();branchInput.focus();await pause(150);
 assert(document.querySelector('[aria-label="Branch patterns suggestions"]'),'Refocusing closed branch suggestions');
 for(const zoom of [1,1.4,1.5]){document.documentElement.style.setProperty('--ui-zoom',zoom);await pause();const menu=document.querySelector('[aria-label="Branch patterns suggestions"]');const bounds=menu.getBoundingClientRect();assert(bounds.left>=-1&&bounds.right<=innerWidth+1&&bounds.top>=-1&&bounds.bottom<=innerHeight+1,'Branch suggestions exceeded the window at zoom '+zoom);}
 document.documentElement.style.setProperty('--ui-zoom',1);
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(branchInput,'release/');branchInput.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 const suggestions=[...document.querySelectorAll('[aria-label="Branch patterns suggestions"] [role="option"]')];
 assert(suggestions.length===1&&suggestions[0].textContent==='All except: release/*, hotfix','Typing did not narrow branch-set suggestions');
 branchInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await pause();assert(branchInput.value==='release/*, hotfix'&&document.querySelector('[aria-label="All except"]').checked,'Keyboard selection did not fill the branch set');
 document.documentElement.style.setProperty('--ui-zoom',1);
 document.querySelector('[aria-label="Close new automation"]').click();
 const run=(id,conclusion,attempt=1,updatedAt=new Date(now).toISOString(),branch='main')=>({id,runAttempt:attempt,name:'Build',headBranch:branch,headSha:'a'.repeat(40),conclusion,updatedAt,htmlUrl:'https://github.com/example/repo-2/actions/runs/'+id});
 window.__ciStage='first success';
 automation.recordAutomationCiRuns('2',[run(100,'success')]);
 await pause(100);await automation.checkSavedPromptSchedule();
 await wait(()=>calls.length===1);await wait(()=>automation.savedPrompts().find(job=>job.id===passId)?.state==='completed');
 assert(calls[0].repo==='2','CI event fanned out to another watched repository');
 automation.recordAutomationCiRuns('2',[run(100,'success')]);await pause(100);assert(calls.length===1,'Repeated poll retriggered the same workflow run');
 automation.recordAutomationCiRuns('2',[run(100,'success',2)]);
 await wait(()=>calls.length===2);await wait(()=>automation.savedPrompts().find(job=>job.id===passId)?.state==='completed');
 automation.recordAutomationCiRuns('1',[run(101,'failure')]);
 await wait(()=>calls.length===3);await wait(()=>automation.savedPrompts().find(job=>job.id===failId)?.state==='completed');
 assert(calls[2].repo==='1','Failed CI ran for the wrong repository');
 automation.recordAutomationCiRuns('1',[run(102,'success',1,new Date(now-5000).toISOString())]);
 await pause(100);assert(calls.length===3,'CI completion before automation creation triggered');
 automation.recordAutomationCiRuns('2',[run(104,'success',1,new Date(now).toISOString(),'release/1')]);await pause(100);
 assert(calls.length===3,'CI completion on an excluded branch triggered');
 assert(calls[0].context?.CERBERUS_REPOSITORY_ID==='2'&&calls[0].context?.CERBERUS_BRANCH==='main'&&calls[0].context?.CERBERUS_COMMIT_SHA==='a'.repeat(40)&&calls[0].context?.CERBERUS_CI_CONCLUSION==='success','CI shell context was not forwarded');
 automation.recordAutomationCiRuns('2',[run(105,'success',1,new Date(now).toISOString(),'feature/new')]);
 await wait(()=>calls.length===4);await wait(()=>automation.savedPrompts().find(job=>job.id===passId)?.state==='completed');
 automation.savePrompt({...automation.savedPrompts().find(job=>job.id===passId),enabled:false});
 automation.savePrompt({...automation.savedPrompts().find(job=>job.id===failId),enabled:false});
 const exceptId='ci-except-'+crypto.randomUUID();
 automation.savePrompt({...base,id:exceptId,title:'All except',trigger:'ciPass',commitBranch:'main, autosave/*',commitAllExcept:true});
 automation.recordAutomationCiRuns('2',[run(106,'success')]);await pause(100);
 assert(calls.length===4,'All except matched a blocked branch');
 automation.recordAutomationCiRuns('2',[run(107,'success',1,new Date(now).toISOString(),'release/1')]);
 await wait(()=>calls.length===5);await wait(()=>automation.savedPrompts().find(job=>job.id===exceptId)?.state==='completed');
 automation.savePrompt({...automation.savedPrompts().find(job=>job.id===exceptId),enabled:false});
 const handled=JSON.parse(localStorage.getItem('gitcerberus.automationCiHandled.v1'));
 assert(handled[passId+':2'].includes('100:1')&&handled[passId+':2'].includes('100:2'),'Completed workflow attempts were not persisted');
 automation.savePrompt({...automation.savedPrompts().find(job=>job.id===passId),enabled:true});
 let polled=0;api.githubCiRuns=async(repo)=>{polled++;return repo==='1'?[run(103,'success')]:[];};
 window.__ciStage='polling';
 const stop=automation.startSavedPromptScheduler();
 await wait(()=>calls.length===6);stop();
 assert(calls[5].repo==='1'&&polled>0,'Scheduler did not poll GitHub CI for the watched repository');
 await wait(()=>automation.savedPrompts().find(job=>job.id===passId)?.state==='completed');
 automation.savePrompt({...automation.savedPrompts().find(job=>job.id===passId),enabled:false});
 window.__ciStage='combined conditions';
 const comboId='combo-'+crypto.randomUUID();
 automation.savePrompt({...base,id:comboId,title:'Push and CI',trigger:'push',conditions:['push','ciPass'],commitBranch:'*',ciSince:now-1000});
 const event=(id,sha)=>({id,kind:'push',branch:'main',sha,createdAt:new Date(now).toISOString(),htmlUrl:'https://github.com/example/repo-2/commit/'+sha});
 const beforeCombo=calls.length;
 automation.recordAutomationGithubEvents('2',[event(comboId+'-push','a'.repeat(40))]);await pause(80);
 assert(calls.length===beforeCombo,'Push ran before CI was observed');
 automation.recordAutomationCiRuns('2',[run(201,'success',1,new Date(now).toISOString(),'main')]);
 await wait(()=>calls.length===beforeCombo+1);
 assert(calls.at(-1).repo==='2','Combined conditions ran for the wrong repository');
 automation.recordAutomationGithubEvents('2',[event(comboId+'-push','a'.repeat(40))]);await pause(80);
 assert(calls.length===beforeCombo+1,'A polled push event repeated');
 const idleId='idle-'+crypto.randomUUID();
 automation.savePrompt({...base,id:idleId,title:'File quiet',trigger:'fileChange',conditions:['fileChange','idleTime'],debounceSeconds:2,commitBranch:'*'});
 const beforeIdle=calls.length;
 automation.recordAutomationFileChange('1',Date.now());await automation.checkSavedPromptSchedule();
 assert(calls.length===beforeIdle,'Idle condition ran before quiet period');
 await automation.checkSavedPromptSchedule(Date.now()+3000);
 await wait(()=>calls.length===beforeIdle+1);
 window.__ciStage='CI monitoring recovery';
 for(const job of automation.savedPrompts())automation.savePrompt({...job,enabled:false});
 const healthId='health-'+crypto.randomUUID();
 automation.savePrompt({...base,id:healthId,title:'Monitoring recovery',trigger:'ciFail',commitBranch:'*',includeFutureRepositories:true});
 const monitored=[...repos,...['3','4','5'].map(id=>({...repos[0],id,displayName:'repo-'+id})),{...repos[0],id:'local',canonicalRemote:null},{...repos[0],id:'unassigned',identity:null}];
 api.repositories=async()=>monitored;
 const monitorNotices=()=>JSON.parse(localStorage.getItem('gitcerberus.automationNotifications.v1')||'[]').filter(item=>item.automationId==='ci-monitor');
 const noticesBefore=monitorNotices().length,requests=[];let failMonitoring=true,releaseSlow;
 const slow=new Promise(resolve=>releaseSlow=resolve);
 api.githubCiRuns=async repo=>{requests.push(repo);if(repo==='2')return [run(999,'failure')];if(failMonitoring&&repo!=='5'){if(repo==='1')await slow;throw {kind:'timeout',message:'GitHub request timed out'};}return [];};
 const healthNow=Date.now(),callsBeforeHealth=calls.length;
 const checking=automation.pollAutomationCi(healthNow);
 await wait(()=>calls.length===callsBeforeHealth+1);
 assert(calls.at(-1).repo==='2','An unavailable repository blocked a healthy repository CI failure');
 assert(requests.includes('5'),'A stalled request blocked healthy repositories beyond the first four');
 releaseSlow();await checking;
 assert(!requests.includes('local')&&!requests.includes('unassigned'),'CI monitoring queried an ineligible live-scope repository');
 assert(monitorNotices().length===noticesBefore,'One transient timeout generated monitoring alerts');
 const firstRequests=requests.filter(id=>id==='1').length;
 await automation.pollAutomationCi(healthNow+1000);
 assert(requests.filter(id=>id==='1').length===firstRequests,'CI backoff was ignored');
 await automation.pollAutomationCi(healthNow+60000);await automation.pollAutomationCi(healthNow+180000);
 assert(monitorNotices().length===noticesBefore+1&&monitorNotices()[0].title==='CI checks delayed','Persistent outage did not produce one combined monitoring notice');
 assert(['repo-1','repo-3','repo-4'].every(name=>monitorNotices()[0].message.includes(name)),'Grouped outage notice omitted affected repositories');
 await automation.pollAutomationCi(healthNow+420000);
 assert(monitorNotices().length===noticesBefore+1,'Unchanged outage spammed additional monitoring notices');
 failMonitoring=false;await automation.pollAutomationCi(healthNow+1000000);
 assert(calls.length===callsBeforeHealth+1,'Recovery replayed the already handled failure');
 let rateRequests=0;
 api.githubCiRuns=async repo=>{if(repo==='1'){rateRequests++;throw {kind:'rateLimit',message:'Rate limited',retryAfterSeconds:600};}return [];};
 await automation.pollAutomationCi(healthNow+1100000);await automation.pollAutomationCi(healthNow+1160000);
 assert(rateRequests===1,'GitHub Retry-After was ignored');
 let denied=false;
 api.githubCiRuns=async repo=>{if(repo==='1')throw {kind:'authentication',message:'Reconnect assigned account'};if(repo==='2'&&!denied)return [run(1000,'failure')];return [];};
 await automation.pollAutomationCi(healthNow+1700000);denied=true;
 await wait(()=>calls.length===callsBeforeHealth+2);
 assert(monitorNotices()[0].title==='CI access needs attention'&&monitorNotices()[0].message.includes('Reconnect assigned account'),'Permanent account failure did not get actionable guidance');
 const noticesAfterAccess=monitorNotices().length;
 await automation.pollAutomationCi(healthNow+1900000);
 assert(monitorNotices().length===noticesAfterAccess,'Repeated account failure spammed another alert');
 automation.savePrompt({...automation.savedPrompts().find(job=>job.id===healthId),enabled:false});
 window.__ciStage='list scrolling';
 for(let i=0;i<30;i++)automation.savePrompt({...base,id:'scroll-'+i,title:'Scroll '+i,trigger:'manual',enabled:false});
 await pause();
 for(const zoom of [1,1.4,1.5]){
  document.documentElement.style.setProperty('--ui-zoom',zoom);await pause();
  const list=document.querySelector('.saved-prompt-list'),bounds=list.getBoundingClientRect();
  assert(bounds.bottom<=innerHeight+1&&bounds.top>=0,'Automation list exceeds viewport at '+zoom);
  assert(list.scrollHeight>list.clientHeight,'Automation list has no contained overflow at '+zoom);
  list.scrollTop=list.scrollHeight;assert(list.scrollTop>0,'Automation list cannot scroll at '+zoom);
 }
 window.__ciCheck={passed:true,calls,polled};
})().catch(error=>window.__ciCheck={passed:false,error:String(error),stage:window.__ciStage});
"""
window = Gtk.OffscreenWindow()
view = WebKit2.WebView()
view.set_size_request(900,620)
window.add(view)
window.show_all()
exit_code = 1
started = False

def checked(webview, result):
    global exit_code
    try:
        raw = webview.evaluate_javascript_finish(result).to_string()
        if raw in ('undefined', 'null'): return
        value = json.loads(raw)
        if value is None: return
        print(json.dumps(value))
        exit_code = 0 if value.get('passed') else 1
        Gtk.main_quit()
    except Exception as error:
        print(error)
        Gtk.main_quit()

def inspect():
    view.evaluate_javascript('JSON.stringify(window.__ciCheck || null)', -1, None, None, None, checked)
    return True

def loaded(webview, event):
    global started
    if event == WebKit2.LoadEvent.FINISHED and not started:
        started = True
        view.evaluate_javascript(script+'\nvoid 0;', -1, None, None, None, None)
        GLib.timeout_add(250, inspect)

view.connect('load-changed', loaded)
view.load_uri('http://127.0.0.1:3000')
GLib.timeout_add_seconds(60, lambda: (Gtk.main_quit(),False)[1])
Gtk.main()
sys.exit(exit_code)
