"""Exercise readable credential-store notifications and recovery links in WebKitGTK.
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
 const pause=()=>new Promise(r=>setTimeout(r,100));const wait=async(get)=>{for(let i=0;i<100;i++){const v=get();if(v)return v;await pause();}throw Error('UI timeout '+get.toString()+' '+document.body.innerText.slice(-900));};const assert=(v,m)=>{if(!v)throw Error(m);};
 const source=await(await fetch('/src/lib/conversationCache.ts')).text();const {api}=await import(source.match(/from "([^"\n]*\/api\.ts[^"\n]*)"/)[1]);
 const panel=await(await fetch('/src/components/SavedPromptsPanel.tsx')).text();const module=await import(panel.match(/from "([^"\n]*\/savedPrompts\.ts[^"\n]*)"/)[1]);
 api.scriptRuntimePlatform=async()=> 'bash';
 const repo=(await api.repositories())[0].id;for(const job of module.savedPrompts())module.removePrompt(job.id);
 api.scriptRuntimeCandidates=async()=>[{preset:'python',executable:'/fixture/.venv/bin/python'}];api.checkScriptRuntime=async config=>({preset:config.preset,executable:config.executable||'python3',version:'Python 3.12 fixture'});
 module.savePrompt({id:'runtime-fixture',repositoryId:repo,repositoryIds:[repo],title:'Runtime fixture',prompt:'print("works")',kind:'shell',provider:'codex',threadId:'',trigger:'manual',conditions:['manual'],minutes:60,enabled:false,nextAt:0,editor:'vscode',scriptRuntime:{preset:'python',executable:'/fixture/.venv/bin/python',args:['-u']}});
 (await wait(()=>document.querySelector('[aria-label="Toggle navigation"]'))).click();(await wait(()=>[...document.querySelectorAll('aside nav button')].find(node=>node.textContent.includes('Automation')))).click();
 (await wait(()=>document.querySelector('[aria-label="Edit Runtime fixture"]'))).click();
 await wait(()=>document.querySelector('[aria-label="Script runtime"]')?.textContent.includes('Python'));
 assert(document.querySelector('[aria-label="Interpreter executable"]').textContent.includes('.venv'),'Virtual environment choice lost');
 [...document.querySelectorAll('button')].find(button=>button.textContent==='Check runtime').click();await wait(()=>document.body.textContent.includes('Python 3.12 fixture'));
 document.querySelector('[aria-label="Script runtime"]').click();(await wait(()=>[...document.querySelectorAll('[role="option"]')].find(option=>option.textContent==='Custom'))).click();await wait(()=>document.querySelector('[aria-label="Script runtime"]').textContent.includes('Custom'));await pause();
 const set=(label,value)=>{const input=document.querySelector(`[aria-label="${label}"]`);Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
 set('Script interpreter path','/fixture/runtime with spaces');await pause();set('Script interpreter arguments','--flag\nargument with spaces');await pause();set('Script file extension','py');await pause();
 for(const zoom of [1,1.4,1.5]){document.documentElement.style.setProperty('--ui-zoom',zoom);await pause();const dialog=document.querySelector('.automation-edit-dialog');assert(dialog.getBoundingClientRect().bottom<=innerHeight+1,'Runtime editor height overflow '+zoom);assert(document.querySelector('.script-runtime-controls').getBoundingClientRect().right<=innerWidth+1,'Runtime controls overflow '+zoom);const selector=document.querySelector('[aria-label="Script runtime"]');selector.click();await pause();document.querySelector('[role="listbox"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await pause();assert(!document.querySelector('[role="listbox"]'),'Runtime dropdown did not close on Escape');}
 document.documentElement.style.setProperty('--ui-zoom','1');await pause();
 document.querySelector('.automation-edit-dialog footer .automation-primary-action').click();await wait(()=>!document.querySelector('.automation-edit-dialog'));
 const saved=module.savedPrompts().find(job=>job.id==='runtime-fixture');assert(saved.scriptRuntime.executable==='/fixture/runtime with spaces','Executable did not persist');assert(saved.scriptRuntime.args[1]==='argument with spaces','Arguments were shell-split');
 let received;api.runAutomationShell=async(...args)=>{received=args;return {result:'done',stdout:'done',stderr:''};};
 await module.runSavedPrompt(saved.id,true,repo);assert(received[6].preset==='custom'&&received[6].extension==='py','Execution lost runtime configuration');assert(received[5].CERBERUS_REPOSITORY_ID===repo,'Runtime lost context');
 module.savePrompt({...saved,scriptRuntime:{preset:'auto'},prompt:'import os\nprint(os.getcwd())'});await module.runSavedPrompt(saved.id,true,repo);assert(received[6].preset==='python','Automatic detection did not reach execution');
 for(const zoom of [1,1.4,1.5]){document.documentElement.style.setProperty('--ui-zoom',zoom);await pause();assert(document.body.scrollWidth<=innerWidth+1,'Runtime UI overflow');}
 window.__savedPromptCheck={passed:true,checks:'runtime editing, venv selection, version check, literal arguments, persistence and execution context'};
})().catch(e=>{window.__savedPromptCheck={passed:false,error:String(e)}});
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
