"""Exercise server-backed feedback management and automation dispatch in WebKitGTK. Requires the existing Vite server on 127.0.0.1:3000.
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
 for(let i=0;i<50&&getComputedStyle(document.body).margin!=='0px';i++)await new Promise(resolve=>setTimeout(resolve,40));
 if(getComputedStyle(document.body).margin!=='0px')throw Error('Fixture stylesheet did not apply');
 const pause=()=>new Promise(resolve=>setTimeout(resolve,80));const wait=async(get)=>{for(let i=0;i<150;i++){const value=get();if(value)return value;await pause();}throw Error('Timeout '+get.toString());};const assert=(v,m)=>{if(!v)throw Error(m);};
 const source=await(await fetch('/src/components/FeedbackPanel.tsx')).text();const path=source.match(/from ["']([^"'\n]*\/feedback\.ts[^"'\n]*)["']/)[1];const {feedback,defaultMailbox,mailKey}=await import(path);
 const automationSource=await(await fetch('/src/components/AutomationRunDialog.tsx')).text();const jobsPath=automationSource.match(/from ["']([^"'\n]*\/savedPrompts\.ts[^"'\n]*)["']/)[1];const scheduler=await import(jobsPath);
 const apiSource=await(await fetch('/src/lib/conversationCache.ts')).text();const {api}=await import(apiSource.match(/from "([^"\n]*\/api\.ts[^"\n]*)"/)[1]);
 const repos=await api.repositories();const repo=repos[0],other=repos[1];let config={...defaultMailbox(),enabled:true,address:'support@example.org',username:'fixture'};let requests=[],saved=[],acked=false,failStatus=false;
 const mail={folder:'INBOX',validity:7,uid:22,messageId:'<customer@example.org>',subject:'Feedback fixture',from:'reports@example.org',replyTo:'customer@example.org',date:new Date().toUTCString(),timestamp:Date.now(),body:'Customer report. <script>window.fixtureBad=true</script>'+('\nLong report detail '.repeat(150)),attachments:['diagnostic.txt']};
 feedback.config=async id=>id===repo.id?config:null;
 feedback.save=async(id,value,password)=>{saved.push({id,value,password});config=value;};
 feedback.request=async(id,request)=>{requests.push({id,...request});if(request.action==='folders')return ['INBOX','Ready','Resolved','Drafts','Sent','Cerberus Notes','Cerberus Receipts','Folders/Reports'];if(request.action==='list')return id===repo.id?[mail]:[];if(request.action==='read')return mail;if(['test','status'].includes(request.action)){if(failStatus)throw Error('Fixture authentication failed');return {connected:true,count:63};}if(request.action==='poll')return acked?[]:[mail];if(request.action==='ack')acked=true;return {};};
 await wait(()=>document.querySelector('[aria-label="Toggle navigation"]'));document.querySelector('[aria-label="Toggle navigation"]').click();
 const nav=label=>[...document.querySelectorAll('aside nav button')].find(button=>button.textContent.includes(label));nav('Feedback').click();
 await wait(()=>document.querySelector('.feedback-list strong')?.textContent==='Feedback fixture');document.querySelector('.feedback-list > button').click();
 await wait(()=>document.querySelector('.feedback-body')?.textContent.includes('Customer report'));
 assert(!window.fixtureBad,'Email HTML executed');assert(document.querySelector('.feedback-reader').textContent.includes('diagnostic.txt'),'Attachment metadata missing');
 const text=document.querySelector('[aria-label="Feedback reply or note"]');const input=(node,value)=>{Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));};
 const button=label=>[...document.querySelectorAll('button')].find(button=>button.textContent===label);
 input(text,'Reply draft fixture');button('Save reply draft').click();await wait(()=>requests.some(request=>request.action==='draft'));assert(requests.find(request=>request.action==='draft').text==='Reply draft fixture','Draft text missing');
 await wait(()=>document.querySelector('[role="status"]')?.textContent.includes('draft'));input(text,'Internal finding fixture');button('Save internal note').click();await wait(()=>requests.some(request=>request.action==='note'));
 assert(!button('Send reply'),'Sending unexpectedly enabled');
 await wait(()=>!document.querySelector('[aria-label="Configure feedback mailbox"]').disabled);document.querySelector('[aria-label="Configure feedback mailbox"]').click();await wait(()=>document.querySelector('[aria-label="Feedback mailbox settings"]'));
 const chooseProvider=async id=>{document.querySelector('[aria-label="Email provider"]').click();await wait(()=>document.querySelector('[role="listbox"]'));document.querySelector(`[role="option"][data-value="${id}"]`).click();await pause();};
 const labeled=label=>[...document.querySelectorAll('.feedback-settings label')].find(node=>node.childNodes[0]?.textContent.trim()===label)?.querySelector('input');
 assert(document.querySelector('[aria-label="Email provider"]').textContent.includes('Other IMAP server'),'A specific provider was selected by default');
 await chooseProvider('gmail');assert(!labeled('IMAP host')&&!document.querySelector('[aria-label="Trusted certificate"]'),'Gmail showed irrelevant connection/certificate fields');assert(labeled('Google app password'),'Gmail app-password field missing');assert(!document.querySelector('.feedback-provider-help').textContent.includes('Bridge'),'Proton help leaked into Gmail');assert(document.querySelector('.feedback-provider-help a').href==='https://support.google.com/mail/answer/7126229','Gmail documentation link missing');assert(document.querySelector('[aria-label="Provider server settings"]').textContent.includes('imap.gmail.com:993'),'Gmail settings were not filled');
 button('Customize connection settings').click();await wait(()=>labeled('IMAP host'));assert(labeled('SMTP host').value==='smtp.gmail.com','SMTP preset missing');
 await chooseProvider('proton');assert(labeled('IMAP port').value==='1143'&&labeled('SMTP port').value==='1025','Bridge defaults missing');assert(labeled('Bridge-generated password')&&document.querySelector('[aria-label="Trusted certificate"]'),'Bridge fields missing');assert(document.querySelector('.feedback-provider-help a').href.startsWith('https://proton.me/'),'Bridge help link missing');assert(!document.querySelector('.feedback-certificate input'),'Certificate path text box remains');api.selectLocalFile=async(title,extensions)=>{assert(extensions.includes('pem'),'Certificate filter missing');return '/fixture/Bridge certificate.pem';};button('Import').click();await wait(()=>document.querySelector('[aria-label="Certificate selected"]'));api.selectLocalFile=async()=>null;button('Import').click();await pause();assert(document.querySelector('[aria-label="Remove certificate"]'),'Cancelling replacement cleared certificate');document.querySelector('[aria-label="Remove certificate"]').click();await wait(()=>!document.querySelector('[aria-label="Certificate selected"]'));assert(!document.querySelector('.feedback-certificate').textContent.includes('Save'),'Certificate controls explain ordinary save behavior');
 await chooseProvider('zohoOrganization');assert(labeled('IMAP host').value==='imappro.zoho.com','Zoho organization preset incorrect');assert(document.querySelector('.feedback-provider-help').textContent.includes('region-specific'),'Zoho regional guidance missing');
 await chooseProvider('outlook');assert(!document.querySelector('.feedback-settings input[type="password"]'),'OAuth-only provider offered a password');assert([...document.querySelectorAll('.feedback-settings footer button')].every(node=>node.disabled),'Unsupported OAuth login was enabled');assert(document.querySelector('.feedback-provider-help').textContent.includes('OAuth'),'OAuth requirement not explained');
 await chooseProvider('custom');assert(labeled('IMAP host').value===''&&labeled('SMTP host').value==='','Custom provider retained another provider’s endpoints');
 for(const zoom of [1,1.4,1.5]){document.body.style.setProperty('--ui-zoom',String(zoom));document.body.style.zoom=String(zoom);await pause();const page=document.querySelector('.feedback-page'),pageRect=page.getBoundingClientRect(),mainRect=document.querySelector('main').getBoundingClientRect();assert(pageRect.bottom<=innerHeight+2&&Math.abs(pageRect.bottom-(mainRect.bottom-parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom)*zoom))<3,'Feedback pane does not fill the viewport at '+zoom+' '+JSON.stringify({page:pageRect.toJSON(),main:mainRect.toJSON(),height:innerHeight}));assert(page.scrollWidth<=page.clientWidth+2,'Feedback pane overflows horizontally');const reader=document.querySelector('.feedback-reader');assert(reader.scrollHeight>reader.clientHeight&&getComputedStyle(reader).overflowY==='auto','Long feedback does not scroll internally');const dialog=document.querySelector('.feedback-settings'),rect=dialog.getBoundingClientRect();assert(rect.left>=-2&&rect.right<=innerWidth+2&&rect.top>=-2&&rect.bottom<=innerHeight+2,'Settings overflow at '+zoom);document.querySelector('[aria-label="IMAP security"]').click();await wait(()=>document.querySelector('[role="listbox"]'));document.querySelector('[role="listbox"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait(()=>!document.querySelector('[role="listbox"]'));document.querySelector('[aria-label="Email provider"]').click();const providerMenu=await wait(()=>document.querySelector('[role="listbox"]'));providerMenu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!document.querySelector('[role="listbox"]'));assert(document.querySelector('.feedback-settings'),'Provider Escape closed the dialog');document.querySelector('[aria-label="Email provider"]').click();await wait(()=>document.querySelector('[role="listbox"]'));document.querySelector('.feedback-settings h2').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await wait(()=>!document.querySelector('[role="listbox"]'));const providerTrigger=document.querySelector('[aria-label="Email provider"]');providerTrigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));const keyboardMenu=await wait(()=>document.querySelector('[role="listbox"]'));const menuRect=keyboardMenu.getBoundingClientRect();assert(menuRect.left>=0&&menuRect.right<=innerWidth+2&&menuRect.top>=0&&menuRect.bottom<=innerHeight+2,'Provider menu outside viewport');keyboardMenu.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await pause();keyboardMenu.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(()=>!document.querySelector('[role="listbox"]'));assert(providerTrigger.textContent.includes('Gmail'),'Provider keyboard selection failed');await chooseProvider('custom');}
 document.body.style.zoom='1';document.body.style.setProperty('--ui-zoom','1');const settings=document.querySelector('.feedback-settings');settings.querySelector('details').open=true;
 const enabledBox=[...settings.querySelectorAll('input[type="checkbox"]')].find(node=>node.parentElement.textContent.includes('Enable this repository'));
 enabledBox.click();await pause();const testButton=[...settings.querySelectorAll('footer button')].find(node=>node.textContent==='Save and test');assert(!testButton.disabled,'Disabled mailbox cannot be tested');testButton.click();await wait(()=>requests.some(request=>request.action==='test'));await wait(()=>!testButton.disabled);assert(!saved.at(-1).value.enabled,'Testing unexpectedly enabled the mailbox');assert(settings.textContent.includes('IMAP connected'),'Test result missing');enabledBox.click();await pause();
 [...settings.querySelectorAll('input[type="checkbox"]')].find(node=>node.parentElement.textContent.includes('Allow replies')).click();
 [...settings.querySelectorAll('footer button')].find(node=>node.textContent==='Save').click();await wait(()=>!document.querySelector('.feedback-settings'));await wait(()=>document.querySelector('.feedback-list > button')&&!document.querySelector('[aria-label="Configure feedback mailbox"]').disabled);document.querySelector('.feedback-list > button').click();await wait(()=>button('Send reply'));
 input(document.querySelector('[aria-label="Feedback reply or note"]'),'Send fixture');button('Send reply').click();await pause();assert(!requests.some(request=>request.action==='send'),'Reply sent before explicit confirmation');button('Confirm send reply').click();await wait(()=>requests.some(request=>request.action==='send'));await wait(()=>!document.querySelector('[aria-label="Configure feedback mailbox"]').disabled);assert(requests.find(request=>request.action==='send').operationId,'Send has no stable operation ID');
 nav('Repositories').click();await wait(()=>document.querySelector(`[data-repository-id="${repo.id}"] .feedback-mailbox-badge.ready`));const mailboxBadge=document.querySelector(`[data-repository-id="${repo.id}"] .feedback-mailbox-badge.ready`);assert(mailboxBadge.textContent==='63','Repository mailbox count missing');assert(mailboxBadge.title.includes('INBOX'),'Mailbox count has no folder explanation');document.querySelector(`[data-repository-id="${repo.id}"]`).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await wait(()=>document.querySelector('.repo-config'));assert(document.querySelector('.repo-config .feedback-mailbox-badge.ready'),'Repository configuration has no mailbox setup indicator');document.querySelector('.repo-config header button').click();await wait(()=>!document.querySelector('.repo-config'));const statusPath=source.match(/from ["']([^"'\n]*\/feedbackStatus\.ts[^"'\n]*)["']/)[1];const {refreshMailboxStatus}=await import(statusPath);failStatus=true;await refreshMailboxStatus(repo.id);assert(document.querySelector(`[data-repository-id="${repo.id}"] .feedback-mailbox-badge.warning`)?.title.includes('Fixture authentication failed'),'Failed connection retained successful setup badge');failStatus=false;await refreshMailboxStatus(repo.id);await wait(()=>document.querySelector(`[data-repository-id="${repo.id}"] .feedback-mailbox-badge.ready`));nav('Feedback').click();await wait(()=>document.querySelector('.feedback-list > button')); 
 // Switch repository: previous message content must disappear, with no fallback selection mismatch.
 document.querySelector('[aria-label="Feedback repository"]').click();await wait(()=>document.querySelector('[role="listbox"]'));[...document.querySelectorAll('[role="option"]')].find(option=>option.textContent===other.displayName).click();await wait(()=>document.querySelector('.feedback-page').textContent.includes('Configure a mailbox'));assert(!document.querySelector('.feedback-body'),'Other repository retained email body');assert(!requests.some(request=>request.id===other.id&&['list','read'].includes(request.action)),'Unconfigured mailbox was queried after switching repository');
 // A feedback-only automation must dispatch for its own repo, acknowledge once,
 // preserve a reference in logs, and never persist customer content as its input.
 const job={id:'feedback-fixture',repositoryId:repo.id,repositoryIds:[repo.id],provider:'codex',threadId:'',title:'Feedback fixture automation',prompt:'New feedback received',trigger:'feedback',conditions:['feedback'],feedbackFolder:'INBOX',feedbackSince:Date.now()-1000,minutes:60,enabled:true,nextAt:Date.now(),editor:'vscode',kind:'notification'};
 window.feedbackDebug=()=>({jobs:scheduler.savedPrompts(),requests});scheduler.savePrompt(job);await scheduler.pollFeedback();await wait(()=>requests.some(request=>request.action==='ack'));
 await wait(()=>scheduler.savedPrompts().find(item=>item.id===job.id)?.state==='completed');
 const logs=await api.listAutomationLogs(job.id);assert(logs.length===1,'Wrong feedback dispatch count');assert(logs[0].repositoryId===repo.id,'Feedback crossed repository scope');const log=await api.readAutomationLog(job.id,repo.id,logs[0].runId);assert(log.feedback.uid===22,'Original feedback reference missing');assert(!JSON.stringify(log).includes('Customer report'),'Email body copied into run log');
 await scheduler.pollFeedback();assert((await api.listAutomationLogs(job.id)).length===1,'Handled email replayed');
 // The input dialog must select a real email by default for explicit reruns.
 nav('Automation').click();await wait(()=>document.querySelector('[aria-label="Run Feedback fixture automation now"]'));document.querySelector('[aria-label="Run Feedback fixture automation now"]').click();await wait(()=>document.querySelector('[aria-label="Trigger feedback email"]'));assert(!button('Run once').disabled,'Displayed first feedback email was not selected');
 const originalAcks=requests.filter(request=>request.action==='ack').length;
 button('Run once').click();await wait(()=>scheduler.savedPrompts().find(item=>item.id===job.id)?.state==='completed'&&requests.filter(request=>request.action==='ack').length===originalAcks);await wait(()=>document.querySelector('.automation-log-dialog'));
 const manualLogs=await api.listAutomationLogs(job.id);assert(manualLogs.length===2,'Manual feedback run did not execute');
 await api.writeAutomationLog({...log,runId:'interrupted-feedback',status:'running',retry:{feedback:log.feedback,job:{...job},manual:false}});
 await scheduler.recoverFeedbackRuns();const blocked=scheduler.blockedAutomationRuns(job.id).find(run=>run.runId==='interrupted-feedback');assert(blocked?.retry.feedback.uid===22,'Interrupted feedback lost its original context');assert(scheduler.savedPrompts().find(item=>item.id===job.id).enabled,'Feedback error disabled the automation');
 await scheduler.retryBlockedAutomation(blocked);assert(!scheduler.blockedAutomationRuns(job.id).some(run=>run.runId==='interrupted-feedback'),'Successful feedback retry remained blocked');
 document.querySelector('.automation-log-dialog')?.querySelector('header button[aria-label*="Close"]')?.click();nav('Feedback').click();await wait(()=>document.querySelector('[aria-label="Configure feedback mailbox"]')&&!document.querySelector('[aria-label="Configure feedback mailbox"]').disabled);document.querySelector('[aria-label="Configure feedback mailbox"]').click();await wait(()=>document.querySelector('[aria-label="Email provider"]')&&!document.querySelector('[aria-label="Email provider"]').disabled);await chooseProvider('proton');document.querySelector('.feedback-settings details').open=true;input(labeled('Default feedback folder'),'Reports');input(labeled('Bridge-generated password'),'fixture password');await pause();button('Save and test').click();await wait(()=>saved.some(item=>item.value.inbox==='Folders/Reports'));await wait(()=>!button('Save and test').disabled);assert(document.querySelector('[aria-label="Default feedback folder"]').textContent.includes('Folders/Reports'),'Canonical server folder not selected');document.querySelector('[aria-label="Default feedback folder"]').click();const folderMenu=await wait(()=>document.querySelector('[role="listbox"]'));assert([...folderMenu.querySelectorAll('[role="option"]')].some(option=>option.dataset.value==='Folders/Reports'),'Server folder choices missing');folderMenu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
 for(const zoom of [1,1.4,1.5]){document.body.style.zoom=String(zoom);document.body.style.setProperty('--ui-zoom',String(zoom));await pause();const selector=document.querySelector('[aria-label="Default feedback folder"]');selector.click();let menu=await wait(()=>document.querySelector('[role="listbox"]'));const rect=menu.getBoundingClientRect();assert(rect.left>=0&&rect.right<=innerWidth+2&&rect.top>=0&&rect.bottom<=innerHeight+2,'Mailbox folder menu outside viewport');menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!document.querySelector('[role="listbox"]'));selector.click();menu=await wait(()=>document.querySelector('[role="listbox"]'));document.querySelector('.feedback-settings h2').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await wait(()=>!document.querySelector('[role="listbox"]'));selector.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));menu=await wait(()=>document.querySelector('[role="listbox"]'));menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));await pause();menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await wait(()=>!document.querySelector('[role="listbox"]'));assert(selector.textContent.includes('Folders/Reports'),'Folder keyboard selection changed the displayed/value state');}
 window.__savedPromptCheck={passed:true,checks:'repository isolation, inert HTML, draft/note actions, send opt-in, disabled-mailbox connection test, shared repository status/count, Proton canonical folder discovery and selector, compact certificate controls, provider presets/relevant fields/docs/OAuth limits, settings zoom, server acknowledgement and no replay, reference-only logs, manual default selection, interrupted-run recovery and retry'};
})().catch(error=>{window.__savedPromptCheck={passed:false,error:String(error),debug:window.feedbackDebug?.(),body:document.body.textContent.slice(-2500)}});
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
GLib.timeout_add_seconds(60,lambda:(Gtk.main_quit(),False)[1])
Gtk.main()
sys.exit(exit_code)
