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
 const originalBranches=api.branches,originalHistory=api.history;
 let branchNames=['main'],historyBranch='';
 api.branches=async()=>branchNames;
 api.history=async(_,branch)=>{historyBranch=branch||'';return [];};
 document.querySelector('.repo-row.repo-local:not([data-repository-id="'+sourceId+'"])').click();await pause();
 const nativeSetInterval=window.setInterval;let pollBranches;
 window.setInterval=(callback,delay,...args)=>{if(delay===15000)pollBranches=callback;return nativeSetInterval(callback,delay,...args);};
 document.querySelector('.repo-row.repo-local[data-repository-id="'+sourceId+'"]').click();
 await wait(()=>document.querySelector('.history-tabs [role="tab"]')?.textContent.includes('main'));
 branchNames=['main','private/agent-work'];window.dispatchEvent(new Event('focus'));
 const privateBranch=await wait(()=>[...document.querySelectorAll('.history-tabs [role="tab"]')].find(tab=>tab.textContent==='private/agent-work'));
 privateBranch.click();await wait(()=>historyBranch==='private/agent-work');
 assert(pollBranches,'Branch list has no independent polling fallback');
 branchNames=['main','private/agent-work','private/second-worktree'];pollBranches();
 await wait(()=>[...document.querySelectorAll('.history-tabs [role="tab"]')].some(tab=>tab.textContent==='private/second-worktree'));
 window.setInterval=nativeSetInterval;
 const originalPlan=api.branchRemovalPlan,originalRemove=api.removeBranch;
 const plan={branch:'private/agent-work',head:'a'.repeat(40),merged:true,worktrees:['/tmp/linked tree'],remote:'origin',remoteHead:'a'.repeat(40)};
 let removalCalls=0;
 api.branchRemovalPlan=async(repo,branch)=>{assert(repo===sourceId&&branch===plan.branch,'Removal plan used another branch or repository');return plan;};
 api.removeBranch=async(repo,confirmed)=>{assert(repo===sourceId&&confirmed.head===plan.head,'Confirmation lost the inspected branch tip');removalCalls++;branchNames=branchNames.filter(name=>name!==confirmed.branch);return {completed:true,steps:['Removed worktree: /tmp/linked tree','Deleted local branch: '+confirmed.branch,'Deleted remote branch: origin/'+confirmed.branch],error:null};};
 for(const zoom of [1,1.4,1.5]){
   document.documentElement.style.setProperty('--ui-zoom',zoom);
   document.querySelector('[aria-label="Remove selected branch"]').click();
   const dialog=await wait(()=>document.querySelector('[aria-label="Remove branch"]'));
   await wait(()=>dialog.textContent.includes('/tmp/linked tree'));
   assert(removalCalls===0,'Inspecting a removal mutated the branch');
   const bounds=dialog.getBoundingClientRect();assert(bounds.left>=-1&&bounds.right<=innerWidth+1&&bounds.top>=-1&&bounds.bottom<=innerHeight+1,'Removal dialog exceeds viewport at '+zoom);
   assert(dialog.textContent.includes('origin/private/agent-work'),'Confirmation omitted remote deletion');
   dialog.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await pause();
   assert(!document.querySelector('[aria-label="Remove branch"]'),'Escape did not cancel confirmation');
 }
 document.documentElement.style.setProperty('--ui-zoom',1);
 document.querySelector('[aria-label="Remove selected branch"]').click();
 await wait(()=>document.querySelector('.branch-removal-dialog footer button:last-child')?.textContent==='Remove branch');
 document.querySelector('.branch-removal-dialog footer button:last-child').click();
 await wait(()=>document.querySelector('.branch-removal-dialog').textContent.includes('Branch removal completed'));
 assert(removalCalls===1,'Confirmation ran removal more than once');
 await wait(()=>![...document.querySelectorAll('.history-tabs [role="tab"]')].some(tab=>tab.textContent===plan.branch));
 assert(document.querySelector('.history-tabs [aria-selected="true"]').textContent==='main','History retained the removed branch selection');
 document.querySelector('[aria-label="Close branch removal"]').click();await pause();
 assert(document.querySelector('[aria-label="Remove selected branch"]').disabled,'Current checkout branch removal was enabled');
 const remainingBranch=[...document.querySelectorAll('.history-tabs [role="tab"]')].find(tab=>tab.textContent==='private/second-worktree');remainingBranch.click();await pause();
 api.branchRemovalPlan=async()=>{throw Error('Branch is unmerged');};
 document.querySelector('[aria-label="Remove selected branch"]').click();
 await wait(()=>document.querySelector('.branch-removal-dialog [role="alert"]')?.textContent.includes('unmerged'));
 assert(![...document.querySelectorAll('.branch-removal-dialog footer button')].some(button=>button.textContent==='Remove branch'),'Failed preflight still offered deletion');
 document.querySelector('[aria-label="Close branch removal"]').click();await pause();
 api.branchRemovalPlan=async()=>({...plan,branch:'private/second-worktree',merged:false,worktrees:[]});
 document.documentElement.style.setProperty('--ui-zoom',1.5);
 let forcedHead;
 api.removeBranch=async(repo,confirmed,head)=>{forcedHead=head;return {completed:true,steps:['Force-deleted local branch: '+confirmed.branch],error:null};};
 document.querySelector('[aria-label="Remove selected branch"]').click();
 await wait(()=>document.querySelector('.branch-removal-dialog footer button:last-child')?.textContent==='Continue to forced deletion');
 assert(document.querySelector('.branch-removal-dialog [role="alert"]').textContent.includes('unmerged'),'Unmerged branch warning missing');
 document.querySelector('.branch-removal-dialog footer button:last-child').click();await pause();
 assert(!forcedHead,'Initial unmerged confirmation forced deletion immediately');
 const forceButton=document.querySelector('.branch-removal-dialog footer button:last-child');
 assert(forceButton.textContent==='Force delete branch'&&forceButton.disabled,'Second confirmation did not require acknowledgement');
 const forcedBounds=document.querySelector('.branch-removal-dialog').getBoundingClientRect();assert(forcedBounds.left>=-1&&forcedBounds.right<=innerWidth+1&&forcedBounds.top>=-1&&forcedBounds.bottom<=innerHeight+1,'Forced confirmation exceeds viewport at 150%');
 document.querySelector('[aria-label="Confirm unmerged branch deletion"]').click();await pause();forceButton.click();
 await wait(()=>document.querySelector('.branch-removal-dialog').textContent.includes('Branch removal completed'));
 assert(forcedHead===plan.head,'Forced confirmation was not bound to the inspected commit');
 document.documentElement.style.setProperty('--ui-zoom',1);
 document.querySelector('[aria-label="Close branch removal"]').click();await pause();
 api.branchRemovalPlan=async()=>({...plan,branch:'private/second-worktree',worktrees:[]});
 api.removeBranch=async()=>{branchNames=['main'];return {completed:false,steps:['Deleted local branch: private/second-worktree'],error:'Remote deletion refused'};};
 document.querySelector('[aria-label="Remove selected branch"]').click();await wait(()=>document.querySelector('.branch-removal-dialog footer button:last-child')?.textContent==='Remove branch');
 document.querySelector('.branch-removal-dialog footer button:last-child').click();await wait(()=>document.querySelector('.branch-removal-dialog [role="alert"]')?.textContent.includes('Remote deletion refused'));
 assert(document.querySelector('.branch-removal-dialog').textContent.includes('Deleted local branch'),'Partial failure hid the completed operation');
 document.querySelector('[aria-label="Close branch removal"]').click();await pause();
 api.branchRemovalPlan=originalPlan;api.removeBranch=originalRemove;api.branches=originalBranches;api.history=originalHistory;


 const panelSource=await (await fetch('/src/components/SavedPromptsPanel.tsx')).text();const savedPath=panelSource.match(/from "([^"\n]*\/savedPrompts\.ts[^"\n]*)"/)[1];
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
