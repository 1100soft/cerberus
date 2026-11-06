"""Exercise commit/tag history refresh through manual, focus and polling paths in WebKitGTK.
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
 const pause=()=>new Promise(r=>setTimeout(r,100));const wait=async(get)=>{for(let i=0;i<100;i++){const v=get();if(v)return v;await pause();}throw Error('UI timeout '+get.toString());};const assert=(v,m)=>{if(!v)throw Error(m);};
 const source=await(await fetch('/src/lib/conversationCache.ts')).text();const {api}=await import(source.match(/from "([^"\n]*\/api\.ts[^"\n]*)"/)[1]);
 let version=1,calls=0;const pollers=[];const originalInterval=window.setInterval;
 window.setInterval=(callback,delay,...args)=>{if(delay===15000)pollers.push(callback);return originalInterval(callback,delay,...args);};
 api.history=async()=>{calls++;return [{hash:String(version).repeat(40),summary:'Commit '+version,author:'Fixture',email:'fixture@example.test',committedAt:new Date().toISOString(),tags:version===2?['v2']:[]}];};
 const originalBranches=api.branches;api.branchListing=async id=>(await originalBranches(id)).map(name=>({name,kind:'permanent',latestTag:version===2?'v2':undefined}));
 (await wait(()=>document.querySelector('.repo-row'))).click();
 await wait(()=>document.querySelector('.commit-history')?.textContent.includes('Commit 1'));
 version=2;document.querySelector('[aria-label="Refresh history"]').click();
 await wait(()=>document.querySelector('.commit-history')?.textContent.includes('Commit 2')&&document.querySelector('.commit-tag')?.textContent==='v2');
 await wait(()=>document.querySelector('.branch-tag')?.textContent==='v2');
 const before=calls;version=3;window.dispatchEvent(new Event('focus'));
 await wait(()=>document.querySelector('.commit-history')?.textContent.includes('Commit 3'));
 assert(calls>before&&!document.querySelector('.commit-tag'),'Focus refresh retained deleted tags');
 version=4;for(const poll of pollers)poll();
 await wait(()=>document.querySelector('.commit-history')?.textContent.includes('Commit 4'));
 // Branch creation/switch controls submit the viewed branch as the base.
 const actions=[];api.changeBranch=async(...args)=>{actions.push(args);};
 document.querySelector('[aria-label="Create branch"]').click();
 const dialog=await wait(()=>document.querySelector('[aria-label="Create branch"][role="dialog"]'));
 assert(!dialog.querySelector('[role=combobox]'),'Branch creation repeats the existing branch selector');
 const label=dialog.querySelector('.stacked-input-field > span');
 const input=dialog.querySelector('input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
 input.focus();await pause();
 assert(input.getBoundingClientRect().top-label.getBoundingClientRect().bottom>=6,'Focused branch field overlaps its label');
 setter.call(input,'feature/ui-test');input.dispatchEvent(new Event('input',{bubbles:true}));
 await pause();dialog.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await wait(()=>actions.length===1&&!document.querySelector('[role="dialog"]'));
 assert(actions[0][1]==='feature/ui-test'&&actions[0][2]===true&&actions[0][3],'Create did not use selected base');
 const alternative=[...document.querySelectorAll('.history-tabs [role="tab"]')].find(node=>node.getAttribute('aria-label')!=='main');
 if(alternative){alternative.click();await pause();const switcher=document.querySelector('[aria-label="Switch to selected branch"]');if(!switcher.disabled){switcher.click();await wait(()=>actions.length===2);assert(actions[1][2]===false,'Switch unexpectedly creates a branch');}}
 // Navigation must paint cached history while the replacement read is stalled.
 document.querySelector('[aria-label="Toggle navigation"]').click();
 const nav=name=>[...document.querySelectorAll('aside nav button')].find(node=>node.textContent.includes(name));
 const retainedHistory=document.querySelector('.commit-history');
 nav('Automation').click();await wait(()=>document.querySelector('.projects-page').hidden);
 let release;const blocked=new Promise(resolve=>release=resolve);const fresh=api.history;
 api.history=async(...args)=>{await blocked;return fresh(...args);};
 nav('Projects').click();
 assert(document.querySelector('.commit-history')===retainedHistory,'Projects rebuilt its retained history view');
 await wait(()=>document.querySelector('.commit-history')?.textContent.includes('Commit 4'));
 assert(!document.querySelector('.commit-history')?.textContent.includes('Loading commits'),'Navigation hid the cached history behind loading');
 version=5;release();
 await wait(()=>document.querySelector('.commit-history')?.textContent.includes('Commit 5'));
 // Shared reads, bounded retention, failures, and forced refresh races.
 const {PageSnapshots}=await import('/src/lib/pageSnapshots.ts');const cache=new PageSnapshots(2);
 let complete,reads=0;const slow=new Promise(resolve=>complete=resolve);
 const first=cache.load('one',async()=>{reads++;return slow;});
 assert(cache.load('one',async()=>99)===first,'Remount duplicated a pending read');
 await cache.load('one',async()=>2,true);complete(1);await first;
 assert(cache.peek('one')===2&&reads===1,'Late read overwrote a forced refresh');
 try{await cache.load('one',async()=>{throw Error('offline');});}catch{}
 assert(cache.peek('one')===2,'Failure erased a usable snapshot');
 cache.set('two',2);cache.set('three',3);assert(cache.peek('one')===undefined,'Snapshot retention is unbounded');
 let stale;const invalidated=cache.load('invalidated',()=>new Promise(resolve=>stale=resolve));await Promise.resolve();cache.clear(key=>key==='invalidated');stale('old account');await invalidated;assert(cache.peek('invalidated')===undefined,'An invalidated read repopulated stale account data');
 window.setInterval=originalInterval;
 window.__savedPromptCheck={passed:true,checks:'manual/focus/poll refresh, tags, cached navigation during stalled reads, coalescing, bounded retention, failure preservation and refresh races'};
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
