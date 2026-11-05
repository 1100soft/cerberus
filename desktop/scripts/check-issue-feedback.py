"""Exercise shared GitHub feedback UI and project isolation in WebKitGTK. Requires existing Vite on 127.0.0.1:3000.
"""
import json
import re
from pathlib import Path
import sys
import urllib.request
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib

urllib.request.urlopen('http://127.0.0.1:3000', timeout=5).close()
script = r"""
(async()=>{
 const pause=()=>new Promise(r=>setTimeout(r,60)),assert=(v,m)=>{if(!v)throw Error(m)},wait=async fn=>{for(let n=0;n<150;n++){const v=fn();if(v)return v;await pause();}throw Error('Timeout '+fn.toString());};
 await wait(()=>document.querySelector('[aria-label="Toggle navigation"]'));
 const src=await(await fetch('/src/components/IssueFeedbackPage.tsx')).text();const path=src.match(/from ["']([^"'\n]*\/issueFeedback\.ts[^"'\n]*)["']/)[1];const {issueFeedback,issueLists,issueDetails}=await import(path);const apiPath=src.match(/from ["']([^"'\n]*\/api\.ts[^"'\n]*)["']/)[1];const {api}=await import(apiPath);const repos=await api.repositories(),identities=await api.identities(),one=repos[0],two=repos[1],account=identities.find(i=>i.providerUsername)||identities[0];
 let settings={defaultTarget:{repository:'org/shared',identityId:account.id},projects:{[one.id]:{disabled:false,target:null,label:'project:one'},[two.id]:{disabled:false,target:{repository:'org/other',identityId:account.id},label:'project:two'}}};let calls=[],saved=[],saveAttempts=[];let delayProject='',release;
 issueFeedback.settings=async()=>settings;issueFeedback.save=async(value,acquireExisting=false)=>{saveAttempts.push(acquireExisting);if(value.projects[two.id]?.label==='project:Renamed queue'&&!acquireExisting)return {status:'conflict',conflicts:[{projectId:two.id,feedbackName:'Renamed queue',repository:'org/other'}]};settings=value;saved.push(value);issueLists.clear();issueDetails.clear();window.dispatchEvent(new Event('issue-feedback-changed'));return {status:'saved'};};issueFeedback.scope=async id=>{const p=settings.projects[id],target=p?.target||settings.defaultTarget;return p?.disabled||!target?null:{...target,label:p?.label||'project:'+id,inherited:!p?.target};};
 const report=(id,number)=>({number,title:(id===one.id?'First':'Second')+' project report '+number,body:'A user report with **formatting** and [link](https://example.test/).\n\n'+('Details '.repeat(2000)),state:'open',url:'https://github.com/org/shared/issues/'+number,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),labels:[id===one.id?'project:one':'project:two']});
 const data=new Map([[one.id,[report(one.id,1)]],[two.id,[report(two.id,2)]]]);
 issueFeedback.request=async(id,r)=>{calls.push({id,...r});if(r.action==='summary')return {openCount:13,labelConfigured:true};if(r.action==='status')return {private:true,canWrite:true};if(r.action==='list'){if(id===delayProject)await new Promise(resolve=>release=resolve);return (data.get(id)||[]).filter(i=>r.state==='all'||i.state===(r.state||'open'));}if(r.action==='read')return data.get(id).find(i=>i.number===r.number);if(r.action==='comments')return [{id:1,body:'Internal comment',createdAt:new Date().toISOString()}];if(r.action==='create'){data.get(id).push({...report(id,3),title:r.title,body:r.body});return {number:3};}if(r.action==='comment')return {number:r.number};if(r.action==='update'){const issue=data.get(id).find(i=>i.number===r.number);issue.state=r.state;return issue;}throw Error('Unexpected action');};
 api.githubRepositories=async()=>({repositories:['org/shared','org/other','org/replacement'].map((fullName,n)=>({id:n+1,name:fullName.split('/')[1],owner:'org',fullName,identityId:account.id,private:true,htmlUrl:'https://github.com/'+fullName})),warnings:[],failedIdentityIds:[]});const externalLinks=[];api.openExternalUrl=async url=>externalLinks.push(url);api.openEmailLink=async()=>{};
 document.querySelector('[aria-label="Toggle navigation"]').click();const nav=text=>[...document.querySelectorAll('aside nav button')].find(b=>b.querySelector('.nav-label')?.textContent===text);nav('Feedback').click();assert(!document.querySelector('.email-page-cache')||document.querySelector('.email-page-cache').hidden,'Email page remains active behind Feedback');await wait(()=>document.querySelector('.issue-feedback-list button'));
 const choose=async(label,value)=>{window.issueStage=label+' '+value;const el=await wait(()=>{const node=document.querySelector(`[aria-label="${label}"]`);return node&&!node.disabled?node:null;});el.click();await wait(()=>document.querySelector('[role="listbox"]'));document.querySelector(`[role="option"][data-value="${value}"]`).click();};
 if(document.querySelector('[aria-label="Feedback project"]').textContent!==one.displayName)await choose('Feedback project',one.id);
 await wait(()=>document.querySelector('.issue-feedback-list').textContent.includes('First project'));

 const itemPath=src.match(/from ["']([^"'\n]*\/itemActivity\.ts[^"'\n]*)["']/)[1];const {itemActivity}=await import(itemPath);const activitySource=await(await fetch(itemPath)).text();const agentState=await import(activitySource.match(/from ["']([^"'\n]*\/agentChats\.ts[^"'\n]*)["']/)[1]);api.saveAgentConversation=async()=>{};itemActivity.load=async(id,runs)=>runs.includes('issue-worker')&&id===one.id?[{runId:'issue-worker',at:Date.now()+1,issue:1}]:[];agentState.restoreAgentConversation({id:'issue-worker',repositoryId:one.id,profile:{id:'fixture',provider:'codex'},name:'Feedback worker',messages:[],running:true,status:'Working',activity:'',updatedAt:Date.now()});await wait(()=>document.querySelector('.issue-feedback-list .item-agent-working')?.textContent.includes('Feedback worker'));agentState.updateAgentChat('issue-worker',{running:false});await wait(()=>!document.querySelector('.issue-feedback-list .item-agent-working'));
 window.dispatchEvent(new Event('issue-feedback-changed'));nav('Projects').click();await wait(()=>document.querySelector(`[data-repository-id="${one.id}"] button[aria-label="Feedback configured · 13 open issues."]`));(await wait(()=>document.querySelector(`[data-repository-id="${two.id}"] button[aria-label="Feedback configured · 13 open issues."]`))).click();await wait(()=>document.querySelector('[aria-label="Feedback project"]').textContent===two.displayName);nav('Email').click();await wait(()=>document.querySelector('[aria-label="Email project"]')?.textContent===two.displayName);await choose('Email project',one.id);nav('Projects').click();await wait(()=>document.querySelector(`[data-repository-id="${one.id}"].selected`));document.querySelector(`[data-repository-id="${one.id}"] button[aria-label^="Email "]`).click();await wait(()=>document.querySelector('[aria-label="Email project"]')?.textContent===one.displayName);nav('Feedback').click();await wait(()=>document.querySelector('[aria-label="Feedback project"]').textContent===one.displayName);await wait(()=>document.querySelector('.issue-feedback-list').textContent.includes('First project'));
 document.querySelector('.issue-feedback-list button').click();await wait(()=>document.querySelector('.issue-feedback-reader').textContent.includes('Internal comment'));
 const input=(node,text)=>{const proto=node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(node,text);node.dispatchEvent(new Event('input',{bubbles:true}));};
 input(document.querySelector('[aria-label="Feedback comment"]'),'Keep this draft');nav('Projects').click();nav('Feedback').click();await wait(()=>document.querySelector('[aria-label="Feedback comment"]')?.value==='Keep this draft');
 const button=text=>[...document.querySelectorAll('.issue-feedback-page button')].find(b=>b.textContent.trim()===text);button('Comment').click();await wait(()=>calls.some(c=>c.action==='comment'));assert(calls.find(c=>c.action==='comment').operationId,'Comment lost operation ID');await wait(()=>issueLists.peek(JSON.stringify([one.id,'open'])));
 await choose('Feedback project',two.id);await wait(()=>document.querySelector('.issue-feedback-list').textContent.includes('Second project'));assert(!document.querySelector('.issue-feedback-list').textContent.includes('First project'),'Cross-project issue list leak');
 delayProject=one.id;await choose('Feedback project',one.id);await wait(()=>release);await wait(()=>document.querySelector('.issue-feedback-list').textContent.includes('First project'));assert(document.querySelector('.issue-feedback-list').textContent.includes('First project'),'Cached issue list not restored');await choose('Feedback project',two.id);await wait(()=>document.querySelector('.issue-feedback-list').textContent.includes('Second project'));release();delayProject='';await pause();assert(!document.querySelector('.issue-feedback-list').textContent.includes('First project'),'Late issue results crossed project boundary');
 document.querySelector('[aria-label="Feedback settings"]').click();await wait(()=>document.querySelector('[aria-label="Default feedback repository"]'));
 const nameInput=document.querySelector('[aria-label="Feedback project label"]');assert(nameInput.value==='two','Routing prefix leaked into feedback name');assert(!document.querySelector('.feedback-toolbar').textContent.includes('project:'),'Routing prefix leaked into queue toolbar');input(nameInput,'Renamed queue');await pause();
 const bounds=()=>{for(const el of document.querySelectorAll('.issue-feedback-workspace,.issue-feedback-list,.issue-feedback-reader')){const r=el.getBoundingClientRect();assert(r.left>=-2&&r.right<=innerWidth+2&&r.top>=-2&&r.bottom<=innerHeight+2,'Feedback pane exceeds viewport '+el.className+' '+JSON.stringify({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}));}};
 for(const zoom of [1,1.4,1.5]){window.issueStage='zoom '+zoom;document.body.style.zoom=String(zoom);document.body.style.setProperty('--ui-zoom',String(zoom));await pause();const dialog=document.querySelector('.issue-feedback-settings'),r=dialog.getBoundingClientRect();assert(r.top>=-2&&r.bottom<=innerHeight+2,'Settings exceeds viewport');const sel=document.querySelector('[aria-label="Default feedback repository"]');sel.focus();sel.click();await wait(()=>document.querySelector('[role="listbox"]'));document.querySelector('[role="listbox"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));const menu=document.querySelector('[role="listbox"]').getBoundingClientRect();assert(menu.left>=-2&&menu.right<=innerWidth+2&&menu.bottom<=innerHeight+2,'Feedback menu exceeds viewport');document.querySelector('[role="listbox"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!document.querySelector('[role="listbox"]'));sel.click();await wait(()=>document.querySelector('[role="listbox"]'));dialog.querySelector('h2').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await wait(()=>!document.querySelector('[role="listbox"]'));}
 document.body.style.zoom='1';document.body.style.setProperty('--ui-zoom','1');await choose('Default feedback repository','org/replacement');const save=[...document.querySelectorAll('.issue-feedback-settings button')].find(b=>b.textContent==='Save');save.click();await wait(()=>document.querySelector('[role="alertdialog"]'));const prompt=document.querySelector('[role="alertdialog"]');assert(document.activeElement.textContent==='Use a different name','Acquisition is selected by default');assert(!prompt.textContent.includes('project:'),'Prompt exposes routing syntax');assert(saved.length===0,'Conflict changed settings before approval');document.activeElement.click();await wait(()=>!document.querySelector('[role="alertdialog"]'));assert(document.activeElement===nameInput,'Retry did not focus name input');assert(saved.length===0,'Default retry acquired issues');save.click();await wait(()=>document.querySelector('[role="alertdialog"]'));for(const zoom of [1,1.4,1.5]){document.body.style.zoom=String(zoom);document.body.style.setProperty('--ui-zoom',String(zoom));await pause();const r=document.querySelector('[role="alertdialog"]').getBoundingClientRect();assert(r.left>=-2&&r.right<=innerWidth+2&&r.top>=-2&&r.bottom<=innerHeight+2,'Conflict prompt exceeds viewport');}document.body.style.zoom='1';document.body.style.setProperty('--ui-zoom','1');[...document.querySelectorAll('[role="alertdialog"] button')].find(b=>b.textContent==='Acquire issues').click();await wait(()=>document.querySelector('.issue-feedback-settings').textContent.includes('repository connected'));assert(saveAttempts.join(',')==='false,false,true','Acquire was not explicit');assert(settings.defaultTarget.repository==='org/replacement','Default repository not saved');assert(settings.projects[two.id].label==='project:Renamed queue','Editing friendly name lost internal mapping');assert(settings.projects[two.id].target.repository==='org/other','Project override was overwritten');
 document.querySelector('[aria-label="Close feedback settings"]').click();await wait(()=>!document.querySelector('.issue-feedback-settings'));await choose('Feedback project',one.id);await wait(()=>document.querySelector('.issue-feedback-list').textContent.includes('First project'));document.querySelector('.issue-feedback-list button').click();await wait(()=>document.querySelector('[aria-label="Feedback comment"]'));
 for(const zoom of [1,1.4,1.5]){window.issueStage='zoom '+zoom;document.body.style.zoom=String(zoom);document.body.style.setProperty('--ui-zoom',String(zoom));await pause();bounds();const scroll=document.querySelector('.issue-feedback-scroll'),link=document.querySelector('[aria-label="Open issue on GitHub"]');assert(!link.closest('.issue-feedback-scroll'),'Issue link is inside scrolling content');const before=link.getBoundingClientRect();scroll.scrollTop=scroll.scrollHeight;await pause();const after=link.getBoundingClientRect();assert(Math.abs(after.top-before.top)<1&&after.top>=0&&after.bottom<=innerHeight,'Issue actions moved out of view while scrolling');}
 document.querySelector('[aria-label="Open issue on GitHub"]').click();await wait(()=>externalLinks.length===1);assert(externalLinks[0]==='https://github.com/org/shared/issues/1','Wrong issue browser URL');
 await choose('Feedback project',two.id);const runtimeSource=await(await fetch('/src/components/AutomationRunDialog.tsx')).text();const scheduler=await import(runtimeSource.match(/from ["']([^"'\n]*\/savedPrompts\.ts[^"'\n]*)["']/)[1]);const {feedback,defaultMailbox}=await import(runtimeSource.match(/from ["']([^"'\n]*\/feedback\.ts[^"'\n]*)["']/)[1]);feedback.config=async id=>{await new Promise(resolve=>setTimeout(resolve,120));return { ...defaultMailbox(),enabled:true,address:'fixture@example.test' };};scheduler.savePrompt({id:'manual-current-project',title:'Manual default fixture',provider:'codex',threadId:'',kind:'notification',prompt:'Fixture',trigger:'manual',conditions:['manual'],requiresMailbox:true,enabled:true,includeFutureRepositories:true,repositoryId:'',repositoryIds:[],minutes:1,nextAt:Date.now()});nav('Automation').click();const manual=await wait(()=>[...document.querySelectorAll('.saved-prompt-list article')].find(card=>card.textContent.includes('Manual default fixture')));manual.querySelector('[aria-label^="Run "]').click();await wait(()=>document.querySelector('.automation-runtime-dialog [aria-label="Project"]')?.textContent===two.displayName);await wait(()=>!document.querySelector('.automation-runtime-dialog footer button').disabled);assert(document.querySelector('.automation-runtime-dialog [aria-label="Project"]').textContent===two.displayName,'Mailbox eligibility discarded the selected project');document.querySelector('.automation-runtime-dialog header button').click();scheduler.removePrompt('manual-current-project');
 window.__savedPromptCheck={passed:true,checks:'project isolation, delayed/stale list responses, cached switching, draft retention, comments, default/override settings and menus at 100/140/150% zoom'};
})().catch(e=>window.__savedPromptCheck={passed:false,error:String(e),stage:window.issueStage,body:document.body.textContent.slice(-1800)});

"""

window=Gtk.OffscreenWindow()
# Clipboard behavior is mocked before React mounts; never touch the host clipboard.
manager=WebKit2.UserContentManager()
manager.add_script(WebKit2.UserScript.new("let fixtureClipboard='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>fixtureClipboard,writeText:async value=>{fixtureClipboard=value;}}});",WebKit2.UserContentInjectedFrames.TOP_FRAME,WebKit2.UserScriptInjectionTime.START,None,None))
# Apply the real stylesheet without waiting for external Google font imports.
fixture_root=Path(__file__).resolve().parents[1]/"src"
fixture_css=(fixture_root/"palette.css").read_text()+re.sub(r"""@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')\s*;""", "", (fixture_root/"styles.css").read_text())
script="const fixtureStyle=document.createElement('style');fixtureStyle.textContent="+json.dumps(fixture_css)+";document.head.append(fixtureStyle);\n"+script
view=WebKit2.WebView(web_context=WebKit2.WebContext.new_ephemeral(),user_content_manager=manager)
view.set_size_request(*(map(int,sys.argv[1:3]) if len(sys.argv)>2 else (900,620)))
window.add(view)
window.show_all()
exit_code=1
started=False
finished=False

def checked(webview,result):
    global exit_code, finished
    try:
        raw=webview.evaluate_javascript_finish(result).to_string()
        if raw in ('undefined','null'):return
        value=json.loads(raw)
        if value is None:return
        print(json.dumps(value))
        exit_code=0 if value['passed'] else 1
        finished=True
        # Unload React and its timers before tearing down WebKit's JS context.
        view.load_html('<!doctype html><html></html>',None)
        GLib.timeout_add(400,lambda:(Gtk.main_quit(),False)[1])
    except Exception as error:
        print(str(error),file=sys.stderr)
        Gtk.main_quit()

def poll():
    if finished:return False
    view.evaluate_javascript('JSON.stringify(window.__savedPromptCheck || null)',-1,None,None,None,checked)
    return True

def loaded(webview,event):
    global started
    if event==WebKit2.LoadEvent.FINISHED and not started:
        started=True
        view.evaluate_javascript(script+'\nvoid 0;',-1,None,None,None,None)
        GLib.timeout_add(300,poll)

view.connect('load-changed',loaded)
view.load_uri('http://127.0.0.1:3000')
GLib.timeout_add_seconds(60,lambda:(Gtk.main_quit(),False)[1])
Gtk.main()
sys.exit(exit_code)
