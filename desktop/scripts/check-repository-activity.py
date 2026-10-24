"""Exercise mixed agent/script activity, live logs, timestamps and handoff navigation in WebKitGTK.
Also verifies automatic commit-SHA relationships. Requires the existing Vite server on 127.0.0.1:3000.
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
 const pause=()=>new Promise(r=>setTimeout(r,100));const wait=async(get)=>{for(let i=0;i<100;i++){const v=get();if(v)return v;await pause();}throw Error('UI timeout '+get.toString());};const assert=(v,m)=>{if(!v)throw Error(m);};
 const source=await(await fetch('/src/lib/conversationCache.ts')).text();const {api}=await import(source.match(/from "([^"\n]*\/api\.ts[^"\n]*)"/)[1]);
 const componentSource=await(await fetch('/src/components/ScriptRun.tsx')).text();
 const modulePath=(source,name)=>source.match(new RegExp('from [\"\']([^\"\'\\n]*/'+name+'\\.ts[^\"\'\\n]*)[\"\']'))[1];
 const {beginAutomationLog,updateAutomationLog,finishAutomationLog}=await import(modulePath(componentSource,'automationLogs'));
 const browserSource=await(await fetch('/src/components/CodexHistory.tsx')).text();
 const {restoreAgentConversation}=await import(modulePath(browserSource,'agentChats'));
 const {savePrompt,savedPrompts}=await import(modulePath(browserSource,'savedPrompts'));
 const {configurationChanged}=await import(modulePath(browserSource,'providerPreferences'));
 localStorage.setItem('gitcerberus.providers',JSON.stringify({codex:true,cursor:false,copilot:false,claude:false}));configurationChanged();
 const repo=(await api.repositories())[0];let records=[];
 api.repositoryAutomationLogs=async id=>records.filter(run=>run.repositoryId===id).map(run=>({...run,conversationId:run.conversation?.id}));
 api.repositoryCommitOrigins=async()=>({'script-run':['a'.repeat(40)]});
 api.writeAutomationLog=async entry=>{records=records.filter(item=>item.runId!==entry.runId);records.push(entry);};
 api.readAutomationLog=async(a,r,id)=>records.find(run=>run.runId===id);
 const now=Date.now();
 const parent={automationId:'review-job',repositoryId:repo.id,runId:'review-run',title:'Review fixture',createdAt:now-90000000,kind:'agent',status:'completed',command:'Review',stdout:'',stderr:'',response:'Reviewed',activity:'',emittedHandoffs:['revise'],conversation:{id:'review-chat'}};
 await beginAutomationLog(parent);await finishAutomationLog(parent);
 restoreAgentConversation({id:'review-chat',repositoryId:repo.id,profile:{id:'fixture',provider:'codex',label:'Fixture'},name:'Review fixture',messages:[{id:'answer',role:'assistant',text:'Reviewed',createdAt:now-7200000}],status:'Completed',running:false,activity:'',updatedAt:now,automationContext:{runId:'review-run'}});
 const run={automationId:'script-job',repositoryId:repo.id,runId:'script-run',title:'Revision script fixture',createdAt:now,kind:'shell',status:'running',command:'printf revised',stdout:'',stderr:'',response:'',activity:'',handoffName:'revise',handoffId:'review-run'};
 await beginAutomationLog(run);
 savePrompt({id:'script-job',title:run.title,repositoryId:repo.id,kind:'shell',provider:'codex',threadId:'',prompt:run.command,trigger:'manual',minutes:5,enabled:false,nextAt:0,editor:'vscode',errorUnread:true,state:'error'});
 await wait(()=>document.querySelector('.repo-row'));document.querySelector('.repo-row').click();
 await wait(()=>document.querySelector('.script-run-view'));
 await wait(()=>!savedPrompts().find(job=>job.id==='script-job').errorUnread);
 await wait(()=>document.querySelector('.script-log-messages .automation-event'));
 assert(document.querySelector('.agent-heading').textContent.includes('Agent/Script'),'Heading missing');
 assert(document.querySelector('.handoff-trail').textContent.includes('Review fixture'),'Missing source relationship');
 assert(document.querySelector('.handoff-trail').textContent.includes('revise'),'Missing handoff');
 const oldRunButton=[...document.querySelectorAll('.codex-thread-list > button')].find(button=>button.textContent.includes('Review fixture'));
 assert(oldRunButton&&!oldRunButton.querySelector('time').textContent.includes(':'),'Old run incorrectly uses recent metadata timestamp');
 const scriptIcon=document.querySelector('.codex-thread-list > button.provider-script .conversation-provider-mark svg');
 const agentIcon=document.querySelector('.codex-thread-list > button.provider-codex .conversation-provider-mark > *');
 assert(scriptIcon&&agentIcon&&scriptIcon.getBoundingClientRect().width===agentIcon.getBoundingClientRect().width&&scriptIcon.getBoundingClientRect().height===agentIcon.getBoundingClientRect().height,'Script icon size differs');

 updateAutomationLog(run,{stdout:'First live output\n'});
 await wait(()=>document.querySelector('.script-log-messages')?.textContent.includes('First live output'));
 assert(document.querySelector('.script-log-messages time').textContent==='Now','New output time');
 updateAutomationLog(run,{stdout:'First live output\nSecond live output\n'});
 await wait(()=>document.querySelector('.script-log-messages')?.textContent.includes('Second live output'));
 assert(document.querySelectorAll('.script-log-messages .automation-event.stdout').length===2,'Output duplicated or missing');
 const many='First live output\nSecond live output\n'+Array.from({length:150},(_,index)=>'line '+index+'\n').join('');
 updateAutomationLog(run,{stdout:many});
 const logPane=await wait(()=>document.querySelector('.script-log-messages'));
 await wait(()=>logPane.textContent.includes('line 149'));
 await wait(()=>logPane.scrollHeight-logPane.clientHeight-logPane.scrollTop<25);
 logPane.scrollTop=0;logPane.dispatchEvent(new Event('scroll'));await pause();
 updateAutomationLog(run,{stdout:many+'Latest while reading above\n'});
 await wait(()=>logPane.textContent.includes('Latest while reading above'));
 assert(logPane.scrollTop<5,'Live output lost manual scroll position');

 document.querySelector('.handoff-trail button').click();
 await wait(()=>document.querySelector('.conversation-markdown')?.textContent.includes('Reviewed'));
 assert(document.querySelector('.handoff-trail').textContent.includes('Revision script fixture'),'Missing downstream relationship');
 assert(/^\d\d:\d\d$/.test(document.querySelector('.codex-message time').textContent),'Past-day timestamp');
 const scriptLabel=[...document.querySelectorAll('.provider-controls label')].find(label=>label.textContent==='Script');
 scriptLabel.click();await wait(()=>![...document.querySelectorAll('.codex-thread-list > button')].some(button=>button.textContent.includes('Revision script fixture')));
 assert(localStorage.getItem('gitcerberus.showScripts')==='false','Script preference not saved');
 scriptLabel.click();await wait(()=>[...document.querySelectorAll('.codex-thread-list > button')].some(button=>button.textContent.includes('Revision script fixture')));
 const button=[...document.querySelectorAll('.codex-thread-list > button')].find(button=>button.textContent.includes('Revision script fixture'));button.click();await wait(()=>document.querySelector('.script-run-view'));
 for(const zoom of [1,1.4,1.5]){document.documentElement.style.setProperty('--ui-zoom',zoom);await pause();const node=document.querySelector('.codex-panel'),rect=node.getBoundingClientRect();assert(rect.bottom<=innerHeight+2,'Pane overflow '+zoom);assert(node.scrollWidth<=node.clientWidth+2,'Horizontal overflow '+zoom);}
 const originalNow=Date.now;
 Date.now=()=>now+90000000;window.dispatchEvent(new Event('focus'));
 await wait(()=>{const label=document.querySelector('.script-log-messages time')?.textContent;return label&&label!=='Now'&&!label.includes(':');});
 Date.now=originalNow;window.dispatchEvent(new Event('focus'));
 const review={...parent,automationId:'commit-review-job',runId:'commit-review-run',title:'Commit review fixture',createdAt:Date.now(),commitTriggered:true,commitSha:'a'.repeat(40),handoffId:undefined,handoffName:undefined,conversation:{id:'commit-review-chat'}};
 await beginAutomationLog(review);await finishAutomationLog(review);
 restoreAgentConversation({id:'commit-review-chat',repositoryId:repo.id,profile:{id:'fixture',provider:'codex',label:'Fixture'},name:review.title,messages:[{id:'commit-answer',role:'assistant',text:'Commit reviewed',createdAt:Date.now()}],status:'Completed',running:false,activity:'',updatedAt:Date.now(),automationContext:{runId:review.runId}});
 document.querySelector('[aria-label="Refresh conversations"]').click();
 await wait(()=>[...document.querySelectorAll('.handoff-trail code')].some(node=>node.title==='Commit '+'a'.repeat(40)));
 const reviewLink=await wait(()=>[...document.querySelectorAll('.handoff-trail button')].find(button=>button.textContent==='Commit review fixture'));reviewLink.click();
 await wait(()=>document.querySelector('.conversation-markdown')?.textContent.includes('Commit reviewed'));
 assert(document.querySelector('.handoff-trail').textContent.includes('Revision script fixture'),'Missing source script for commit-triggered review');
 const sourceLink=[...document.querySelectorAll('.handoff-trail button')].find(button=>button.textContent==='Revision script fixture');sourceLink.click();await wait(()=>document.querySelector('.script-run-view'));
 const notification={...review,automationId:'notice-job',runId:'notice-run',kind:'notification',title:'Commit notification fixture',conversation:undefined,response:'Commit notification delivered',emittedHandoffs:[]};
 await beginAutomationLog(notification);await finishAutomationLog(notification);
 document.querySelector('[aria-label="Refresh conversations"]').click();
 const noticeLink=await wait(()=>[...document.querySelectorAll('.handoff-trail button')].find(button=>button.textContent==='Commit notification fixture'));noticeLink.click();
 await wait(()=>document.querySelector('[role="dialog"][aria-label="Details for Commit notification fixture"]'));
 await wait(()=>document.querySelector('.automation-log-lines')?.textContent.includes('Commit notification delivered'));
 document.querySelector('[aria-label="Close automation details"]').click();


 window.__savedPromptCheck={passed:true,checks:'mixed activity, Script filter/persistence, live timestamped output, follow-scroll/manual scroll preservation, exact handoff/commit links in both directions and local log fallback, zoom 100/140/150'};
})().catch(e=>{window.__savedPromptCheck={passed:false,error:String(e),pane:document.querySelector('.chat-message-column')?.textContent}});
"""

window=Gtk.OffscreenWindow()
# Clipboard behavior is mocked before React mounts; never touch the host clipboard.
manager=WebKit2.UserContentManager()
manager.add_script(WebKit2.UserScript.new("let fixtureClipboard='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>fixtureClipboard,writeText:async value=>{fixtureClipboard=value;}}});",WebKit2.UserContentInjectedFrames.TOP_FRAME,WebKit2.UserScriptInjectionTime.START,None,None))
view=WebKit2.WebView.new_with_user_content_manager(manager)
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
GLib.timeout_add_seconds(35,lambda:(Gtk.main_quit(),False)[1])
Gtk.main()
sys.exit(exit_code)
