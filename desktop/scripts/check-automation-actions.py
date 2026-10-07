"""Exercise automation persistence, in-app delivery, prompt prefill, and zoomed layout in WebKitGTK.
Requires the existing Vite server on 127.0.0.1:3000.
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
 const pause=(ms=80)=>new Promise(resolve=>setTimeout(resolve,ms));const assert=(ok,message)=>{if(!ok)throw Error(message)};const wait=async(get)=>{for(let i=0;i<100;i++){const result=get();if(result)return result;await pause();}throw Error('Timed out waiting for UI');};
 const cacheSource=await (await fetch('/src/lib/conversationCache.ts')).text();const apiPath=cacheSource.match(/from "([^"]*\/api\.ts[^"]*)"/)[1];const {api}=await import(apiPath);
 const panelSource=await (await fetch('/src/components/SavedPromptsPanel.tsx')).text();const promptPath=panelSource.match(/from "([^"\n]*\/savedPrompts\.ts[^"\n]*)"/)[1];const {savePrompt,savedPrompts,runSavedPrompt,removePrompt}=await import(promptPath);for(const existing of savedPrompts())removePrompt(existing.id);

 const repositories=await api.repositories(),repo=repositories.find(item=>item.localPath);assert(repo,'No demo repository');
 const job={id:'actions-a',repositoryId:repo.id,repositoryIds:[repo.id],provider:'codex',threadId:'',title:'Actions A',prompt:'fixture',trigger:'interval',minutes:60,nextAt:Date.now()+3600000,enabled:true,editor:'vscode',kind:'shell',commitBranch:'*'};
 savePrompt(job);savePrompt({...job,id:'actions-b',title:'Actions B'});
 api.runAutomationShell=async()=>{throw Error('Fixture failure');};await runSavedPrompt(job.id,true,repo.id);const failureResult=savedPrompts().find(item=>item.id===job.id).lastResult;assert(savedPrompts().find(item=>item.id===job.id).enabled,'Failure disabled automation');
 (await wait(()=>document.querySelector('[aria-label="Toggle navigation"]'))).click();(await wait(()=>[...document.querySelectorAll('aside nav button')].find(node=>node.textContent.includes('Automation')))).click();
 const card=()=>document.querySelector('[aria-label="Open Actions A"]');await wait(card);await pause();assert(card().querySelector('.config-error'),'Unread error missing: '+JSON.stringify(savedPrompts().find(item=>item.id===job.id)));card().click();await wait(()=>document.querySelector('.automation-log-dialog'));await wait(()=>!card().querySelector('.config-error'));assert(savedPrompts().find(item=>item.id===job.id).lastResult===failureResult,'Acknowledgement erased error');document.querySelector('[aria-label="Close automation details"]').click();await pause();
 for(const zoom of [1,1.4,1.5]){document.documentElement.style.setProperty('--ui-zoom',zoom);card().dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-2,clientY:innerHeight-2}));const menu=await wait(()=>document.querySelector('[role="menu"]'));await pause();const bounds=menu.getBoundingClientRect();assert(bounds.right<=innerWidth+1&&bounds.bottom<=innerHeight+1,'Menu overflows '+zoom);menu.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));assert(menu.contains(document.activeElement),'Menu keyboard focus lost');menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(()=>!document.querySelector('[role="menu"]'));}
 document.documentElement.style.setProperty('--ui-zoom',1);document.querySelector('[aria-label="Edit Actions A"]').click();await wait(()=>document.querySelector('[aria-label="Next automation"]'));const name=document.querySelector('[aria-label="Automation name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(name,'Actions A edited');name.dispatchEvent(new Event('input',{bubbles:true}));await pause();document.querySelector('[aria-label="Next automation"]').click();await wait(()=>document.querySelector('[aria-label="Automation name"]').value==='Actions B');assert(savedPrompts().find(item=>item.id===job.id).title==='Actions A edited','Navigation discarded edits: '+JSON.stringify(savedPrompts().filter(item=>item.id.startsWith('actions-'))));document.querySelector('[aria-label="Edit automation"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true,cancelable:true}));await wait(()=>document.querySelector('[aria-label="Automation name"]').value==='Actions A edited');document.querySelector('[aria-label="Close edit automation"]').click();
 let received;api.branches=async()=>['main','correction/test'];api.history=async()=>[{hash:'selected-commit',summary:'Selected commit',author:'Fixture',email:'fixture@example.test',committedAt:1700000000}];api.runAutomationShell=async(repository,command,onOutput,input,outputs,context)=>{received={repository,input,context};return {result:'OK',stdout:'OK',stderr:''};};
 savePrompt({...job,id:'actions-commit',title:'Commit inputs',trigger:'commit',commitBranch:'correction/*'});await wait(()=>document.querySelector('[aria-label="Run Commit inputs now"]'));document.querySelector('[aria-label="Run Commit inputs now"]').click();await wait(()=>document.querySelector('[aria-label="Trigger commit"]'));await wait(()=>!document.querySelector('.automation-runtime-dialog footer button').disabled);assert(document.querySelector('[aria-label="Trigger branch"]').textContent.includes('correction/test'),'Wrong branch selected');for(const zoom of [1,1.4,1.5]){document.documentElement.style.setProperty('--ui-zoom',zoom);document.querySelector('[aria-label="Trigger commit"]').click();const list=await wait(()=>document.querySelector('[role="listbox"]'));await pause();const bounds=list.getBoundingClientRect();assert(bounds.right<=innerWidth+1&&bounds.bottom<=innerHeight+1,'Input selector overflows '+zoom);list.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!document.querySelector('[role="listbox"]'));}document.documentElement.style.setProperty('--ui-zoom',1);document.querySelector('.automation-runtime-dialog footer button').click();await wait(()=>received);assert(received.context.CERBERUS_COMMIT_SHA==='selected-commit'&&received.context.CERBERUS_BRANCH==='correction/test','Manual commit context lost');await wait(()=>document.querySelector('[aria-label="Close automation details"]'));document.querySelector('[aria-label="Close automation details"]').click();await pause();
 let selected;api.listMatchingHandoffs=async(repository,name,flags)=>{assert(flags[0]==='ready','Handoff flags lost');return [{id:'original-id',preview:'Original payload',retained:true}];};api.claimSelectedHandoff=async(repository,name,id)=>{selected=id;return {id,path:'/tmp/original-payload'};};received=null;savePrompt({...job,id:'actions-handoff',title:'Handoff inputs',trigger:'handoff',handoffName:'review',handoffVariables:['ready']});await wait(()=>document.querySelector('[aria-label="Run Handoff inputs now"]'));document.querySelector('[aria-label="Run Handoff inputs now"]').click();await wait(()=>document.querySelector('[aria-label="Trigger handoff"]'));assert(document.querySelector('.automation-runtime-dialog pre').textContent==='Original payload','Handoff preview missing');await wait(()=>!document.querySelector('.automation-runtime-dialog footer button').disabled);document.querySelector('.automation-runtime-dialog footer button').click();await wait(()=>received);assert(selected==='original-id'&&received.input==='/tmp/original-payload','Wrong handoff claimed');
 window.__savedPromptCheck={passed:true,checks:'error preservation, acknowledgement, menus at 100/140/150%, edit navigation, commit and handoff inputs'};
})().catch(error=>window.__savedPromptCheck={passed:false,error:String(error)});

"""
window=Gtk.OffscreenWindow()
# Clipboard behavior is mocked before React mounts; never touch the host clipboard.
manager=WebKit2.UserContentManager()
manager.add_script(WebKit2.UserScript.new("let fixtureClipboard='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>fixtureClipboard,writeText:async value=>{fixtureClipboard=value;}}});",WebKit2.UserContentInjectedFrames.TOP_FRAME,WebKit2.UserScriptInjectionTime.START,None,None))
view=WebKit2.WebView.new_with_user_content_manager(manager)
view.set_size_request(900,620)
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
