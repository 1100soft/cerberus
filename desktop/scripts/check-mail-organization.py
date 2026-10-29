"""Exercise email organization, scoped folder actions and structure copying in WebKitGTK. Requires the existing Vite server on 127.0.0.1:3000.
"""
import json
import re
from pathlib import Path
import sys
import urllib.request
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib

urllib.request.urlopen('http://127.0.0.1:3000', timeout=5).close()
script = r"""
(async()=>{
 const pause=()=>new Promise(r=>setTimeout(r,70)),wait=async(fn)=>{for(let i=0;i<200;i++){const value=fn();if(value)return value;await pause();}throw Error('Timeout '+fn.toString());},assert=(v,m)=>{if(!v)throw Error(m);};
 const source=await(await fetch('/src/components/EmailPage.tsx')).text();const {feedback,defaultMailbox}=await import(source.match(/from ["']([^"'\n]*\/feedback\.ts[^"'\n]*)["']/)[1]);const {api}=await import(source.match(/from ["']([^"'\n]*\/api\.ts[^"'\n]*)["']/)[1]);
 const repos=(await api.repositories()).filter(p=>p.localPath),a=repos[0],b=repos[1];assert(a&&b,'Two local projects required');
 const make=(path,delimiter='/')=>({path,delimiter,selectable:true});
 const base={...defaultMailbox(),address:'team@example.org',username:'fixture',imapHost:'imap.fixture',smtpHost:'smtp.fixture'};
 const configs=new Map([[a.id,{...base}],[b.id,{...base}]]),trees=new Map([[a.id,['INBOX','Drafts','Sent','Cerberus Notes','Cerberus Receipts','Ready','Archive','Trash','Drag','Drag/Child'].map(p=>make(p))],[b.id,['INBOX','Drafts','Sent','Cerberus Notes','Cerberus Receipts','From B'].map(p=>make(p))]]),counts=new Map(),calls=[];
 feedback.config=async id=>configs.get(id)||null;feedback.setup=async id=>trees.get(id)||[];
 feedback.batch=async(id,c,password,operations)=>{calls.push({id,action:'batch',operations});let nodes=[...(trees.get(id)||[])],changes=[],processed=0,error=null;
  for(const op of operations){const delimiter=nodes.find(n=>n.path===op.parent)?.delimiter||'/';let inverse;
   if(op.operation==='create'){const path=op.parent?op.parent+delimiter+op.name:op.name;if(nodes.some(n=>n.path===path)){processed++;continue;}nodes.push(make(path));inverse={operation:'delete',parent:path};}
   else if(op.operation==='delete'){if(counts.get(id+':'+op.parent)>0){error='Move emails before deleting';break;}const index=op.parent.lastIndexOf('/');inverse={operation:'create',parent:index<0?'':op.parent.slice(0,index),name:op.parent.slice(index+1)};nodes=nodes.filter(n=>n.path!==op.parent);}
   else{const index=op.parent.lastIndexOf('/'),parent=index<0?'':op.parent.slice(0,index),leaf=op.parent.slice(index+1),dest=op.operation==='move'?(op.name?op.name+'/'+leaf:leaf):(parent?parent+'/':'')+op.name;nodes=nodes.map(n=>n.path===op.parent||n.path.startsWith(op.parent+'/')?{...n,path:dest+n.path.slice(op.parent.length)}:n);inverse={operation:op.operation,parent:dest,name:op.operation==='move'?parent:leaf};}
   changes.push({forward:op,inverse});processed++;
  }trees.set(id,nodes);return {nodes,changes,processed,error};
 };
 feedback.request=async(id,r)=>{calls.push({id,...r});if(r.action==='folderTree')return trees.get(id).filter(n=>n.path!==base.metadata).map(n=>({...n,count:counts.get(id+':'+n.path)||0,unread:0}));if(r.action==='folderStatus')return {count:counts.get(id+':'+r.folder)||0,validity:7};if(r.action==='moveAll'){assert(r.message.validity===7,'Bulk move lost inspected validity');counts.set(id+':'+r.folder,0);return {moved:2};}if(r.action==='list')return [{folder:r.folder,validity:7,uid:2,messageId:'<fixture@example.org>',subject:'Organize fixture',from:'sender@example.org',replyTo:'sender@example.org',date:new Date().toUTCString(),timestamp:Date.now(),body:'Fixture mail',read:false,attachments:[]}];if(r.action==='read')return {...r.message,subject:'Organize fixture',from:'sender@example.org',replyTo:'sender@example.org',date:'now',timestamp:Date.now(),body:'Fixture',attachments:[]};return {connected:true,count:0};};
 await wait(()=>document.querySelector('[aria-label="Toggle navigation"]'));document.querySelector('[aria-label="Toggle navigation"]').click();await wait(()=>[...document.querySelectorAll('nav button')].find(n=>n.textContent==='Email'));[...document.querySelectorAll('nav button')].find(n=>n.textContent==='Email').click();
 const page=()=>document.querySelector('.feedback-page'),row=path=>page()?.querySelector(`.email-folders [data-folder-path="${CSS.escape(path)}"] .mail-folder-row`),dialog=()=>document.querySelector('.mail-organize-dialog');
 const input=(node,value)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));};
 const button=text=>[...(dialog()||document).querySelectorAll('button')].find(n=>n.textContent===text);
 const choose=async(label,value)=>{const trigger=document.querySelector(`[aria-label="${label}"]`);await wait(()=>!trigger.disabled);trigger.click();await wait(()=>document.querySelector('[role="listbox"]'));const option=[...document.querySelectorAll('[role="option"]')].find(n=>n.dataset.value===value);assert(option,'Missing option '+label+' '+value);option.click();await pause();};
 await wait(()=>row('Drag')&&!document.querySelector('[aria-label="Email project"]').disabled);
 const data=()=>{const values={};return {types:[],setData(type,value){values[type]=value;if(!this.types.includes(type))this.types.push(type);},getData(type){return values[type]||'';},effectAllowed:'move',dropEffect:'move'};};
 const dragEvent=(target,type,transfer)=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:transfer});target.dispatchEvent(event);};
 let transfer=data();dragEvent(await wait(()=>document.querySelector('.feedback-list > button')),'dragstart',transfer);dragEvent(row('Ready'),'dragover',transfer);await wait(()=>row('Ready').classList.contains('mail-folder-drop'));dragEvent(row('Ready'),'drop',transfer);await wait(()=>calls.some(c=>c.action==='move'&&c.destination==='Ready'&&c.message.uid===2));
 await wait(()=>row('Drag')&&!page().querySelector('.feedback-list > button').disabled);transfer=data();dragEvent(row('Drag'),'dragstart',transfer);dragEvent(row('Ready'),'drop',transfer);await wait(()=>row('Ready/Drag/Child'));assert(calls.some(c=>c.action==='batch'&&c.operations.some(o=>o.operation==='move'&&o.parent==='Drag'&&o.name==='Ready')),'Folder drag did not move subtree');
 await wait(()=>!document.querySelector('[aria-label="Undo email folder action"]').disabled);document.querySelector('[aria-label="Undo email folder action"]').click();await wait(()=>row('Drag/Child'));
 // Same-account project boundaries and descendant cycles are rejected before mutation.
 const beforeMoves=calls.filter(c=>c.action==='batch').length;transfer=data();transfer.setData('application/x-cerberus-email-folder',JSON.stringify({projectId:b.id,path:'Drag'}));dragEvent(row('Ready'),'drop',transfer);await pause();assert(calls.filter(c=>c.action==='batch').length===beforeMoves,'Cross-project folder drag was accepted');
 // Message menus must stay inside the viewport at every supported zoom.
 for(const zoom of [1,1.4,1.5]){document.documentElement.style.setProperty('--ui-zoom',zoom);await pause();const email=await wait(()=>page().querySelector('.feedback-list > button')&&!page().querySelector('.feedback-list > button').disabled&&page().querySelector('.feedback-list > button'));email.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-3,clientY:innerHeight-3}));const menu=await wait(()=>document.querySelector('[aria-label="Email actions"]'));await pause();const rect=menu.getBoundingClientRect();assert(rect.right<=innerWidth+2&&rect.bottom<=innerHeight+2,'Email menu overflow at '+zoom);menu.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));assert(menu.contains(document.activeElement),'Email menu keyboard focus lost');menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!document.querySelector('[aria-label="Email actions"]'));}
 document.documentElement.style.setProperty('--ui-zoom','1');await pause();page().querySelector('.feedback-list > button').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await wait(()=>document.querySelector('[aria-label="Email actions"]'));[...document.querySelectorAll('[role="menuitem"]')].find(n=>n.textContent==='Mark read').click();await wait(()=>calls.some(c=>c.action==='flag'&&c.flag==='read'&&c.message.uid===2));
 document.querySelector('[aria-label="New email folder"]').click();await wait(()=>dialog()?.querySelector('[aria-label="Email folder name"]'));input(dialog().querySelector('[aria-label="Email folder name"]'),'Shared new');await choose('Target email projects','all');await wait(()=>!button('Create').disabled);button('Create').click();await wait(()=>!dialog());assert(trees.get(a.id).some(n=>n.path==='Shared new')&&trees.get(b.id).some(n=>n.path==='Shared new'),'Create did not cover selected projects');
 await wait(()=>!document.querySelector('[aria-label="Undo email folder action"]').disabled);document.querySelector('[aria-label="Undo email folder action"]').click();await wait(()=>!trees.get(a.id).some(n=>n.path==='Shared new')&&!trees.get(b.id).some(n=>n.path==='Shared new'));await wait(()=>!document.querySelector('[aria-label="Redo email folder action"]').disabled);document.querySelector('[aria-label="Redo email folder action"]').click();await wait(()=>trees.get(a.id).some(n=>n.path==='Shared new')&&trees.get(b.id).some(n=>n.path==='Shared new'));
 // Copy creates structure only, retaining destination account settings and purposes.
 document.querySelector('[aria-label="Copy folder structure to projects"]').click();await wait(()=>dialog()&&button('Copy')&&!button('Copy').disabled);button('Copy').click();await wait(()=>!dialog());assert(trees.get(b.id).some(n=>n.path==='Drag/Child'),'Copy outward omitted source subtree');
 document.querySelector('[aria-label="Copy folder structure from project"]').click();await wait(()=>document.querySelector('[aria-label="Source email project"]')&&!document.querySelector('[aria-label="Source email project"]').disabled);
 for(const zoom of [1,1.4,1.5]){document.documentElement.style.setProperty('--ui-zoom',zoom);await pause();const selector=document.querySelector('[aria-label="Source email project"]');selector.scrollIntoView({block:'nearest'});selector.click();const menu=await wait(()=>document.querySelector('[role="listbox"]'));await pause();const r=menu.getBoundingClientRect();assert(r.bottom<=innerHeight+2&&r.right<=innerWidth+2,'Source project dropdown overflow');menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(()=>!document.querySelector('[role="listbox"]'));selector.click();await wait(()=>document.querySelector('[role="listbox"]'));document.querySelector('[role="listbox"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!document.querySelector('[role="listbox"]'));}
 document.documentElement.style.setProperty('--ui-zoom','1');await pause();button('Copy').click();await wait(()=>!dialog());assert(trees.get(a.id).some(n=>n.path==='From B'),'Copy inward omitted source folder');assert(configs.get(b.id).metadata===base.metadata,'Copy changed destination assignments');
 // Scope selection precedes deletion; a nonempty folder opens its actual project.
 await wait(()=>row('Shared new'));const deleteStart=calls.length;counts.set(b.id+':Shared new',2);row('Shared new').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await wait(()=>document.querySelector('[role="menuitem"]'));[...page().querySelectorAll('[role="menuitem"]')].find(n=>n.textContent.includes('Delete')).click();await wait(()=>dialog());await choose('Target email projects','custom');const checks=[...dialog().querySelectorAll('input[type="checkbox"]')];assert(checks.length===2,'Unconfigured projects were included');checks.find(n=>n.parentElement.textContent===b.displayName).click();await wait(()=>!button('Delete').disabled);button('Delete').click();await wait(()=>document.querySelector('.mail-folder-inspection'));assert(!trees.get(a.id).some(n=>n.path==='Shared new')&&trees.get(b.id).some(n=>n.path==='Shared new'),'Nonempty folder was deleted');await wait(()=>document.querySelector('[aria-label="Email project"]').textContent.includes(b.displayName)&&page().querySelector('.feedback-current-folder').textContent==='Shared new');assert(!calls.slice(deleteStart).some(c=>c.id===b.id&&c.action==='batch'&&c.operations.some(o=>o.operation==='delete'&&o.parent==='Shared new')),'Delete was sent for a nonempty folder');
 await wait(()=>button('Keep folder')&&!button('Keep folder').disabled);button('Keep folder').click();await wait(()=>!document.querySelector('.mail-folder-inspection'));assert(trees.get(b.id).some(n=>n.path==='Shared new'),'Keep folder deleted mail');await wait(()=>row('Shared new'));row('Shared new').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));await wait(()=>document.querySelector('[role="menuitem"]'));[...page().querySelectorAll('[role="menuitem"]')].find(n=>n.textContent.includes('Delete')).click();await wait(()=>button('Delete')&&!button('Delete').disabled);button('Delete').click();await wait(()=>document.querySelector('.mail-folder-inspection'));
 await wait(()=>button('Move emails')&&!button('Move emails').disabled);button('Move emails').click();await wait(()=>document.querySelector('[aria-label="Move folder emails"]'));await wait(()=>button('Move')&&!button('Move').disabled);button('Move').click();await wait(()=>!trees.get(b.id).some(n=>n.path==='Shared new'));await wait(()=>!document.querySelector('.mail-folder-inspection'));assert(calls.some(c=>c.action==='moveAll'&&c.id===b.id&&c.folder==='Shared new'&&c.destination==='INBOX'),'Inspection did not move emails within the affected project');
 // Regression: Proton rejects bare top-level CREATE. Reveal the canonical child even under a collapsed namespace.
 configs.get(b.id).provider='proton';trees.get(b.id).push({path:'Folders',delimiter:'/',selectable:false},make('Folders/Existing'));document.querySelector('[aria-label="Refresh email"]').click();await wait(()=>row('Folders/Existing'));page().querySelector('[aria-label="Collapse Folders"]').click();await wait(()=>!row('Folders/Existing'));await wait(()=>!document.querySelector('[aria-label="New email folder"]').disabled);document.querySelector('[aria-label="New email folder"]').click();await wait(()=>dialog()?.querySelector('[aria-label="Email folder name"]'));input(dialog().querySelector('[aria-label="Email folder name"]'),'Visible child');await wait(()=>!button('Create').disabled);button('Create').click();await wait(()=>!dialog());await wait(()=>row('Folders/Visible child'));assert(page().querySelector('.feedback-current-folder').textContent==='Folders/Visible child','Created folder was not revealed/selected');assert(calls.some(c=>c.id===b.id&&c.action==='batch'&&c.operations.some(o=>o.operation==='create'&&o.parent==='Folders'&&o.name==='Visible child')),'Proton CREATE omitted its required namespace');
 window.__savedPromptCheck={passed:true,checks:'email/folder drag and drop, cross-project drag rejection, subtree undo/redo, email menus and dropdowns at 100/140/150%, scoped create/delete, structure copy in both directions, nonempty-folder navigation, explicit bulk move and safe resumed deletion'};
})().catch(error=>window.__savedPromptCheck={passed:false,error:String(error),body:document.body.innerText.slice(-6000)});

"""

window=Gtk.OffscreenWindow()
# Clipboard behavior is mocked before React mounts; never touch the host clipboard.
manager=WebKit2.UserContentManager()
manager.add_script(WebKit2.UserScript.new("let fixtureClipboard='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>fixtureClipboard,writeText:async value=>{fixtureClipboard=value;}}});",WebKit2.UserContentInjectedFrames.TOP_FRAME,WebKit2.UserScriptInjectionTime.START,None,None))
# Apply the real stylesheet without waiting for external Google font imports.
fixture_root=Path(__file__).resolve().parents[1]/"src"
fixture_css=(fixture_root/"palette.css").read_text()+re.sub(r"""@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')\s*;""", "", (fixture_root/"styles.css").read_text())
script="const fixtureStyle=document.createElement('style');fixtureStyle.textContent="+json.dumps(fixture_css)+";document.head.append(fixtureStyle);\n"+script
view=WebKit2.WebView(web_context=WebKit2.WebContext.new_ephemeral(),user_content_manager=manager)
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
GLib.timeout_add_seconds(100,lambda:(Gtk.main_quit(),False)[1])
Gtk.main()
sys.exit(exit_code)
