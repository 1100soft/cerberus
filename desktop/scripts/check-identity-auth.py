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
 const pause=()=>new Promise(r=>setTimeout(r,100));const wait=async(get)=>{for(let i=0;i<100;i++){const v=get();if(v)return v;await pause();}throw Error('UI timeout '+get.toString());};const assert=(v,m)=>{if(!v)throw Error(m);};
 const source=await(await fetch('/src/lib/conversationCache.ts')).text();const {api}=await import(source.match(/from "([^"\n]*\/api\.ts[^"\n]*)"/)[1]);
 let unavailable=true;
 api.identities=async()=>[{id:'fixture-auth',label:'Fixture GitHub',gitName:'Fixture',gitEmail:'fixture@example.test',providerUsername:'fixture',connected:false,...(unavailable?{connectionError:'System credential store is not responding. Retry after restoring the store.'}:{})}];
 (await wait(()=>document.querySelector('[aria-label="Toggle navigation"]'))).click();
 (await wait(()=>[...document.querySelectorAll('aside nav button')].find(node=>node.textContent.includes('Identities')))).click();
 const card=await wait(()=>document.querySelector('[data-card-id="fixture-auth"]'));
 await wait(()=>card.textContent.includes('Unavailable'));
 assert(!card.querySelector('.connected'),'Unavailable identity still says Connected');
 assert(card.textContent.includes('Retry check'),'Unavailable identity prompts reconnect');
 assert(!document.body.innerText.includes('The system restarted and'),'Restart cause asserted without evidence');
 unavailable=false;[...card.querySelectorAll('button')].find(button=>button.textContent.includes('Retry check')).click();
 await wait(()=>card.textContent.includes('Disconnected'));
 assert(card.textContent.includes('Reconnect'),'Missing authentication lacks reconnect action');
 assert(document.body.innerText.includes('not authenticated'),'Account warning missing');
 for(const zoom of [1,1.4,1.5]){document.documentElement.style.setProperty('--ui-zoom',zoom);await pause();assert(card.getBoundingClientRect().right<=innerWidth+1,'Identity card overflows '+zoom);}
 window.__savedPromptCheck={passed:true,checks:'unavailable versus disconnected identity states, retry, warning and zoom layout'};
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
