"""Exercise repository creation and stale-catalog identity assignment in WebKitGTK.
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
 const pause=()=>new Promise(resolve=>setTimeout(resolve,80));const assert=(ok,message)=>{if(!ok)throw Error(message)};const wait=async(get)=>{for(let i=0;i<100;i++){const result=get();if(result)return result;await pause();}throw Error('Timed out waiting for repository UI');};
 const apiSource=await (await fetch('/src/lib/conversationCache.ts')).text();const apiPath=apiSource.match(/from "([^"\n]*\/api\.ts[^"\n]*)"/)[1];const {api}=await import(apiPath);
 await wait(()=>document.querySelectorAll('.repo-row').length>0);const accounts=await api.identities();
 api.githubRepositories=async()=>({repositories:[],warnings:[]});
 let received;const create=api.createRepository;api.createRepository=async update=>{received=update;return create(update);};
 document.querySelector('[aria-label="Add repository"]').click();await wait(()=>document.querySelector('.chooser-actions'));[...document.querySelectorAll('.chooser-actions button')].find(button=>button.textContent.includes('Create new repository')).click();await wait(()=>document.querySelector('.config-grid'));
 const setInput=(label,value)=>{const node=[...document.querySelectorAll('.config-grid label')].find(node=>node.textContent.trim().startsWith(label)).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));};
 const choose=async(label,value)=>{document.querySelector(`[aria-label="${label}"]`).click();const option=await wait(()=>document.querySelector(`[role="option"][data-value="${value}"]`));option.click();await pause();};
 setInput('Display name','New Project');setInput('Local path','/tmp/fixture-new-project');await choose('Host type','github');
 assert(document.querySelector('.github-create-options input[type="checkbox"]').checked,'Remote creation is not automatic for GitHub');assert(document.querySelector('[aria-label="Identity"]').textContent.includes(accounts[0].label),'Required GitHub identity not preselected');assert(document.querySelector('[aria-label="GitHub repository visibility"]').textContent.includes('Private'),'GitHub creation should default to private');
 assert(document.querySelector('.github-create-options').textContent.includes(`https://github.com/${accounts[0].providerUsername}/New-Project.git`),'Destination not derived from name and account');
 for(const zoom of [1,1.4,1.5]){
  document.documentElement.style.setProperty('--ui-zoom',zoom);await pause();
  for(const label of ['Identity','GitHub repository visibility']){const button=document.querySelector(`[aria-label="${label}"]`);button.scrollIntoView({block:'center'});await pause();button.click();const list=await wait(()=>document.querySelector('[role="listbox"]'));await pause();const bounds=list.getBoundingClientRect();assert(bounds.right<=innerWidth+1&&bounds.bottom<=innerHeight+1,'Creation menu overflows '+zoom);if(label==='Identity')assert(accounts.every(account=>list.textContent.includes(account.label)),'Accounts disappeared without catalog matches');list.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!document.querySelector('[role="listbox"]'));}
 }
 // Wait for committed option state between keys rather than relying on an 80 ms delay.
 document.documentElement.style.setProperty('--ui-zoom',1);await pause();
 document.querySelector('[aria-label="GitHub repository visibility"]').click();
 const menu=await wait(()=>document.querySelector('[role="listbox"]'));
 await wait(()=>menu.querySelector('[data-value="private"]').id===menu.getAttribute('aria-activedescendant'));
 menu.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
 await wait(()=>menu.querySelector('[data-value="public"]').id===menu.getAttribute('aria-activedescendant'));
 menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
 await wait(()=>document.querySelector('[aria-label="GitHub repository visibility"]').textContent.includes('Public'));
 assert(document.querySelector('[aria-label="GitHub repository visibility"]').textContent.includes('Public'),'Keyboard selection did not update visibility');
 await choose('GitHub repository visibility','private');document.querySelector('[aria-label="Identity"]').click();await wait(()=>document.querySelector('[role="listbox"]'));document.querySelector('.repo-config h2').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await wait(()=>!document.querySelector('[role="listbox"]'));setInput('Remote URL','https://github.com/example-org/new-project.git');await pause();document.querySelector('[aria-label="Identity"]').click();const identities=await wait(()=>document.querySelector('[role="listbox"]'));assert(accounts.every(account=>identities.textContent.includes(account.label)),'Typing unknown GitHub URL removed accounts');identities.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await pause();
 document.querySelector('.repo-config button[type="submit"]').click();await wait(()=>received);assert(received.githubCreate.private===true&&received.identityId===accounts[0].id&&received.canonicalRemote==='https://github.com/example-org/new-project.git','Creation request lost identity, visibility or organization');await wait(()=>!document.querySelector('.repo-config'));
 const row=await wait(()=>[...document.querySelectorAll('.repo-row')].find(row=>row.textContent.includes('New Project')));row.click();await wait(()=>row.querySelector('button.identity'));row.querySelector('button.identity').click();await wait(()=>document.querySelector('[aria-label="GitHub account"]'));document.querySelector('[aria-label="GitHub account"]').click();const list=await wait(()=>document.querySelector('[role="listbox"]'));assert(accounts.every(account=>list.textContent.includes('@'+account.providerUsername)),'New repository account assignment lost accounts after reload');
 window.__savedPromptCheck={passed:true,checks:'new remote defaults, generated destination, organization creation payload, identities without catalog matches, and creation dropdown zoom'};
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
