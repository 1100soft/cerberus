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
 const pause=()=>new Promise(r=>setTimeout(r,100));const wait=async(get)=>{for(let i=0;i<100;i++){if(get())return;await pause();}throw Error('UI timeout: '+get.toString()+' '+document.body.innerText.slice(-600));};const assert=(v,m)=>{if(!v)throw Error(m);};
 const source=await(await fetch('/src/lib/conversationCache.ts')).text();const {api}=await import(source.match(/from "([^"\n]*\/api\.ts[^"\n]*)"/)[1]);
 const center=await(await fetch('/src/components/NotificationCenter.tsx')).text();const notices=await import(center.match(/from "([^"\n]*\/automationNotifications\.ts[^"\n]*)"/)[1]);const {ciAccessNotice}=await import('/src/lib/ciAccessNotice.ts');
 await wait(()=>document.querySelector('.notification-trigger'));
 let opened='';api.openExternalUrl=async url=>{opened=url;};
 notices.clearAutomationNotices();
 notices.addAutomationNotice({automationId:'ci-monitor',status:'message',...ciAccessNotice(['Cerberus','1100','InDEx','CI'].map(repository=>({repository,message:'GitHub credential storage is unavailable: DBus error: Did not receive a reply'})))});
 await wait(()=>document.querySelector('.notification-toast'));
 document.querySelector('.notification-toast .notification-text > button').click();
 await wait(()=>document.querySelector('.notification-steps'));
 for(const zoom of [1,1.4,1.5]){document.documentElement.style.setProperty('--ui-zoom',zoom);await pause();const popover=document.querySelector('.notification-popover');assert(popover.getBoundingClientRect().right<=innerWidth+1,'Popover overflow');assert(document.querySelectorAll('.notification-steps li').length===3,'Recovery steps missing');}
 const details=document.querySelector('.notification-details');assert(!details.open,'Raw diagnostics expanded by default');assert(details.textContent.includes('DBus error'),'Diagnostics lost');
 document.querySelector('.notification-help-links a').click();await wait(()=>opened.includes('help.gnome.org'));
 assert(document.querySelector('.notification-item p').textContent.includes('Cerberus, 1100, InDEx, CI'),'Repositories not grouped');
 window.__savedPromptCheck={passed:true,checks:'readable grouped notification, recovery steps, collapsed diagnostics and external help links'};
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
