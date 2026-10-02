"""Exercise the shared card drag indicator and repository order in WebKitGTK.
Requires Vite on 127.0.0.1:3000.
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
 const pause=(ms=80)=>new Promise(resolve=>setTimeout(resolve,ms));
 const wait=async(get)=>{for(let i=0;i<100;i++){const result=get();if(result)return result;await pause();}throw Error('Timed out waiting for card');};
 const assert=(ok,message)=>{if(!ok)throw Error(message)};
 await wait(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent-codex-border').trim());
 const rows=await wait(()=>{const nodes=[...document.querySelectorAll('.repo-row.repo-local')];return nodes.length>=2?nodes:null;});
 const source=rows[0],destination=rows[1],sourceId=source.dataset.repositoryId;
 assert(source.draggable,'Repository card is not draggable');
 const dataTransfer=new DataTransfer();
 source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));await pause();
 const box=destination.getBoundingClientRect();
 destination.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer,clientY:box.bottom-2}));await pause();
 assert(destination.classList.contains('card-drop-after'),'Drop position indicator is missing');
 assert(getComputedStyle(destination).boxShadow.includes('inset'),'Drop position indicator has no visible styling: '+getComputedStyle(destination).boxShadow+' '+destination.className+' accent='+getComputedStyle(document.documentElement).getPropertyValue('--accent-codex-border')+' matched='+destination.matches('.repository-workspace .repo-row.card-drop-after'));
 destination.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer,clientY:box.bottom-2}));
 await wait(()=>{const current=[...document.querySelectorAll('.repo-row.repo-local')];return current[1]?.dataset.repositoryId===sourceId;});
 assert(!document.querySelector('.card-drop-after, .card-drag-preview'),'Drag visuals remained after drop');
 const cacheModule=await (await fetch('/src/lib/conversationCache.ts')).text();
 const apiPath=cacheModule.match(/from "([^"]*\/api\.ts[^"]*)"/)[1];
 const {api}=await import(apiPath);
 const repos=await api.repositories();assert(repos.find(repo=>repo.id===sourceId).manualOrder===1,'Saved repository order did not update');
 const savedPath=apiPath.replace('/lib/api.ts','/lib/savedPrompts.ts');
 const {savePrompt,savedPrompts}=await import(savedPath);
 for(const [index,id] of ['drag-one','drag-two'].entries())savePrompt({id,repositoryId:'',repositoryIds:[],provider:'codex',threadId:'',title:'Drag fixture '+index,prompt:'true',trigger:'manual',minutes:60,enabled:false,nextAt:0,editor:'vscode',kind:'shell'});
 document.querySelector('[aria-label="Toggle navigation"]').click();
 (await wait(()=>[...document.querySelectorAll('aside nav button')].find(node=>node.textContent.includes('Automation')))).click();
 const automationCards=await wait(()=>{const cards=[...document.querySelectorAll('.saved-prompt-list article')];const first=cards.find(card=>card.textContent.includes('Drag fixture 0')),second=cards.find(card=>card.textContent.includes('Drag fixture 1'));return first&&second?[first,second]:null;});
 const cardTransfer=new DataTransfer();
 automationCards[0].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:cardTransfer}));await pause();
 const cardBox=automationCards[1].getBoundingClientRect();
 automationCards[1].dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:cardTransfer,clientY:cardBox.bottom-2}));await pause();
 assert(automationCards[1].classList.contains('card-drop-after'),'Automation drop indicator is missing');
 automationCards[1].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:cardTransfer,clientY:cardBox.bottom-2}));
 assert(savedPrompts().findIndex(job=>job.id==='drag-one')>savedPrompts().findIndex(job=>job.id==='drag-two'),'Automation order was not saved');

 (await wait(()=>[...document.querySelectorAll('aside nav button')].find(node=>node.textContent.includes('Identities')))).click();
 const identityCards=await wait(()=>{const cards=[...document.querySelectorAll('.identity-card')];return cards.length>=2?cards:null;});
 const firstIdentity=identityCards[0];
 const identityTransfer=new DataTransfer();firstIdentity.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:identityTransfer}));await pause();
 const identityBox=identityCards[1].getBoundingClientRect();
 identityCards[1].dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:identityTransfer,clientY:identityBox.bottom-2}));await pause();
 assert(identityCards[1].classList.contains('card-drop-after'),'Identity drop indicator is missing');
 identityCards[1].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:identityTransfer,clientY:identityBox.bottom-2}));
 const identityOrder=JSON.parse(localStorage.getItem('gitcerberus.identityCardOrder')||'[]');
 assert(identityOrder[0]===identityCards[1].dataset.cardId&&identityOrder[1]===identityCards[0].dataset.cardId,'Identity order was not saved');
 window.__cardReorderCheck={passed:true};
})().catch(error=>window.__cardReorderCheck={passed:false,error:String(error)});
"""
window=Gtk.OffscreenWindow()
view=WebKit2.WebView()
view.set_size_request(1100,700)
window.add(view)
window.show_all()
exit_code=1
started=False

def checked(webview,result):
    global exit_code
    try:
        raw=webview.evaluate_javascript_finish(result).to_string()
        if raw in ('undefined','null'):return
        value=json.loads(raw)
        if value is None:return
        print(json.dumps(value))
        exit_code=0 if value['passed'] else 1
        Gtk.main_quit()
    except Exception as error:
        print(str(error),file=sys.stderr)
        Gtk.main_quit()

def poll():
    view.evaluate_javascript('JSON.stringify(window.__cardReorderCheck || null)',-1,None,None,None,checked)
    return True

def loaded(webview,event):
    global started
    if event==WebKit2.LoadEvent.FINISHED and not started:
        started=True
        view.evaluate_javascript(script+'\nvoid 0;',-1,None,None,None,None)
        GLib.timeout_add(300,poll)

view.connect('load-changed',loaded)
view.load_uri('http://127.0.0.1:3000')
GLib.timeout_add_seconds(20,lambda:(Gtk.main_quit(),False)[1])
Gtk.main()
sys.exit(exit_code)
