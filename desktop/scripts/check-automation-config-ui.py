"""Exercise workflow configuration validation, applying and zoomed layout in WebKitGTK.
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
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(fn)=>{for(let i=0;i<120;i++){if(fn())return;await pause(40);}throw Error('UI timed out: '+document.body.innerText.slice(-1200));};
 const source=await(await fetch('/src/components/AutomationConfigDialog.tsx')).text();
 const lib=name=>source.match(new RegExp('from "([^"\\n]*/'+name+'\\.ts[^"\\n]*)"'))[1];
 const {api}=await import(lib('api'));const saved=await import(lib('savedPrompts'));
 for(const job of saved.savedPrompts())saved.removePrompt(job.id);
 const config=await import('/src/lib/automationConfig.ts');
 const React=(await import('/node_modules/.vite/deps/react.js')).default;const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
 const {AutomationConfigDialog}=await import('/src/components/AutomationConfigDialog.tsx');
 const original=document.getElementById('root');original.style.display='none';const mount=document.createElement('div');document.body.append(mount);
 let current={schemaVersion:1,revision:'fixture-r1',automations:config.exportAutomationDefinitions(saved.savedPrompts())};
 let draft=JSON.stringify({...current,automations:[...current.automations,{id:'fixture-rule',title:'Fixture rule',kind:'notification',provider:'codex',prompt:'Hello',enabled:false,repositoryIds:['p1'],conditions:['manual']}]},null,2);
 api.workflowConfigSync=async(rows)=>{current={...current,automations:rows};return {path:'/tmp/fixture-workflows',current,draft,guide:'Fixture guide',schema:{}};};
 api.workflowConfigOpen=async()=>{};
 const root=createRoot(mount);root.render(React.createElement(AutomationConfigDialog,{repositories:[{id:'p1',displayName:'Fixture',localPath:'/tmp/fixture'}],profiles:[{id:'account',provider:'cursor',label:'Fixture account'}],onClose:()=>{}}));
 await wait(()=>[...mount.querySelectorAll('textarea')].some(t=>t.value.includes('fixture-rule')));
 const button=text=>[...mount.querySelectorAll('button')].find(b=>b.textContent===text);
 assert(button('Apply').disabled,'Apply enabled before validation');
 button('Validate').click();await wait(()=>!button('Apply').disabled);
 assert(mount.innerText.includes('1 added'),'Missing change summary');
 button('Apply').click();await wait(()=>mount.innerText.includes('Applied.'));
 assert(saved.savedPrompts().some(j=>j.id==='fixture-rule'&&!j.enabled),'Proposal not applied or enabled unexpectedly');
 button('Validate').click();await wait(()=>!button('Apply').disabled);
 const existing=saved.savedPrompts().find(j=>j.id==='fixture-rule');saved.savePrompt({...existing,title:'Concurrent title'});
 button('Apply').click();await wait(()=>mount.innerText.includes('changed. Reload'));
 assert(saved.savedPrompts().find(j=>j.id==='fixture-rule').title==='Concurrent title','Stale Apply overwrote concurrent edits');
 const details=mount.querySelector('details');details.open=true;await pause(100);
 for(const zoom of [1,1.4,1.5]){
 document.documentElement.style.setProperty('--ui-zoom',String(zoom));document.body.style.zoom=String(zoom);await pause(80);
 const content=mount.querySelector('.automation-dialog-content');content.scrollTop=content.scrollHeight;
 const footer=mount.querySelector('footer'),dialog=mount.querySelector('[role=dialog]');
 assert(dialog.clientHeight<=innerHeight/zoom+20,'Dialog exceeds viewport at '+zoom+' '+JSON.stringify({clientHeight:dialog.clientHeight,innerHeight,maxHeight:getComputedStyle(dialog).maxHeight,zoomVar:getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')}));
 const f=footer.getBoundingClientRect(),d=dialog.getBoundingClientRect();assert(f.bottom<=d.bottom+2,'Footer clipped at '+zoom+' '+JSON.stringify({footer:f.toJSON(),dialog:d.toJSON()}));
 const picker=mount.querySelector('[aria-haspopup="listbox"]');assert(picker,'Account selector missing');picker.scrollIntoView({block:'center'});await pause(60);picker.click();await pause(120);
 assert(document.querySelector('[role="listbox"]'),'App-rendered dropdown missing at '+zoom);
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await pause(40);
 }
 root.unmount();mount.remove();original.style.display='';
 window.__savedPromptCheck={passed:true,checks:'Configuration dialog worker validation, explicit Apply, disabled creation, zoom and dropdowns'};
})().catch(error=>window.__savedPromptCheck={passed:false,error:String(error)});
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
