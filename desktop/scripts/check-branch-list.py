"""Exercise grouped branch tabs, compact cleanup metadata, stable hover and keyboard navigation in WebKitGTK.
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
 const pause=()=>new Promise(r=>setTimeout(r,100));const wait=async(get)=>{for(let i=0;i<100;i++){const v=get();if(v)return v;await pause();}throw Error('UI timeout: '+get.toString());};const assert=(v,m)=>{if(!v)throw Error(m);};
 const source=await(await fetch('/src/lib/conversationCache.ts')).text();const {api}=await import(source.match(/from "([^"\n]*\/api\.ts[^"\n]*)"/)[1]);
 const originalBranches=api.branches;const activeName='correction/current-ci-failure-with-a-long-descriptive-branch-name';const retainedName='private/automation-a-retained-run-with-a-long-descriptive-branch-name';
 api.branchListing=async id=>[...(await originalBranches(id)).map(name=>({name,kind:'permanent'})),{name:activeName,kind:'used',worktree:'/external'},{name:retainedName,kind:'retained',worktree:'/app/automation-worktrees/run',cleanupAt:Date.now()+3600000,cleanupNote:'Safety checks apply'}];
 let state={upstream:'refs/remotes/origin/main',ahead:0,behind:3,safe:true,reason:'Fast-forward available'};api.branchSyncStatus=async()=>state;let calls=0;api.fastForwardBranch=async()=>{calls++;state={...state,behind:0,safe:false,reason:'Branch is up to date.'};return state;};
 (await wait(()=>document.querySelector('.repo-row'))).click();await wait(()=>document.querySelector('[aria-label="Fast-forward selected branch"]'));await wait(()=>!document.querySelector('[aria-label="Fast-forward selected branch"]').disabled);
 await wait(()=>document.querySelector('.branch-group-retained'));await document.fonts.ready;await wait(()=>[...document.styleSheets].some(sheet=>[...sheet.cssRules].some(rule=>rule.selectorText?.includes('branch-tab-name'))));
 for(const zoom of [1,1.4,1.5]){document.documentElement.style.setProperty('--ui-zoom',zoom);await pause();for(const group of document.querySelectorAll('.branch-group')){const bounds=group.getBoundingClientRect();assert(bounds.right<=innerWidth+1,'Branch group overflows '+zoom);}const tab=document.querySelector(`[role="tab"][aria-label="${retainedName}"]`);assert(tab.closest('.branch-group-retained'),'Wrong retained group');const name=tab.querySelector('.branch-tab-name');const before=[...document.querySelectorAll('.history-tabs [role="tab"]')].map(node=>JSON.stringify(node.getBoundingClientRect()));const style=document.createElement('style');style.textContent=[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules].filter(rule=>rule.selectorText?.includes('branch-group-tabs button:hover')).map(rule=>rule.cssText.replaceAll(':hover','.fixture-hover'))).join('\n');document.head.append(style);tab.dispatchEvent(new MouseEvent('mouseenter'));tab.classList.add('fixture-hover');await pause();assert([...document.querySelectorAll('.history-tabs [role="tab"]')].every((node,i)=>JSON.stringify(node.getBoundingClientRect())===before[i]),'Hover moves branches');assert(getComputedStyle(tab,'::after').position==='absolute','Hover does not overlay neighbors');tab.classList.remove('fixture-hover');style.remove();assert(tab.querySelector('time')?.dateTime,'Retained cleanup schedule missing');assert(/^\d{2}:\d{2}$/.test(tab.querySelector('time').textContent),'Cleanup time not compact');assert(getComputedStyle(tab.querySelector('.branch-cleanup-time')).position==='absolute','Cleanup uses a layout row');assert(getComputedStyle(tab).flexWrap==='nowrap','Branch icon can wrap onto another row');assert(getComputedStyle(name).whiteSpace==='nowrap','Idle name expanded '+JSON.stringify({zoom,selected:tab.getAttribute('aria-selected'),hover:tab.matches(':hover'),focus:tab.matches(':focus-visible'),space:getComputedStyle(name).whiteSpace,classes:tab.parentElement.parentElement.parentElement.parentElement.className,rules:[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules].filter(rule=>rule.selectorText?.includes('branch-tab-name')).map(rule=>rule.cssText))}));tab.click();await wait(()=>tab.getAttribute('aria-selected')==='true');assert(getComputedStyle(name).whiteSpace==='normal','Selected name not expanded');tab.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));await wait(()=>document.querySelector('.branch-group-permanent [aria-selected="true"]'));document.activeElement.blur();await pause();}
 assert(document.querySelector(`[aria-label="${activeName}"]`).closest('.branch-group-used'),'Active branch grouped as retained');
 window.__savedPromptCheck={passed:true,checks:'branch groups, scheduled cleanup, hover position invariance, compact/selected names, keyboard navigation and zoom layout'};
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
