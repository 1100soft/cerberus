"""Exercise automation persistence, in-app delivery, prompt prefill, and zoomed layout in WebKitGTK.
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
 const pause=(ms=80)=>new Promise(resolve=>setTimeout(resolve,ms));
 const assert=(ok,message)=>{if(!ok)throw Error(message)};
 const wait=async(get)=>{for(let i=0;i<100;i++){const result=get();if(result)return result;await pause();}throw Error('Timed out waiting for UI: '+document.body.innerText.slice(-500));};
 localStorage.removeItem('gitcerberus.savedPrompts.v1');
 const cacheModule=await (await fetch('/src/lib/conversationCache.ts')).text();
 const apiPath=cacheModule.match(/from "([^"]*\/api\.ts[^"]*)"/)[1];
 const {api}=await import(apiPath);
 const savedModule=await import(apiPath.replace('/lib/api.ts','/lib/savedPrompts.ts'));
 for(const job of savedModule.savedPrompts())savedModule.removePrompt(job.id);
 const accountPath=apiPath.replace('/lib/api.ts','/lib/automationAccounts.ts');
 const {automationAccount}=await import(accountPath);
 const githubAssignment=automationAccount({id:'fixture',displayName:'Fixture',localPath:'/tmp/fixture',identity:{id:'github-1',label:'GitHub user',connected:false}},'copilot',[],{defaultAccount:null,initialized:false,repositories:{}},{identities:[],settings:{defaultAccounts:{},repositories:{}}},[]);
 assert(githubAssignment?.profile.id==='github-1'&&githubAssignment.route==='identity','Copilot ignored the repository GitHub assignment when the identity list was stale');
 const inferredGithub=automationAccount({id:'fixture-2',displayName:'Inferred',localPath:'/tmp/inferred',accessibleIdentityIds:['github-1']},'copilot',[],{defaultAccount:null,initialized:false,repositories:{}},{identities:[],settings:{defaultAccounts:{},repositories:{}}},[{id:'github-1',label:'GitHub user'}]);
 assert(!inferredGithub,'Catalog access was treated as an assignment before persistence');
 api.codexAccount=async()=>({account:{email:'fixture@example.test'}});
 api.codexThreads=async()=>({data:[{id:'saved-fixture',name:'Saved prompt target',preview:'Target',cwd:'/tmp',updatedAt:1700000000,working:false}]});
 api.codexMessages=async()=>({data:[{id:'user',role:'user',text:'Start'}]});
 window.__automationStage='navigation';
 (await wait(()=>document.querySelector('[aria-label="Toggle navigation"]'))).click();
 (await wait(()=>[...document.querySelectorAll('aside nav button')].find(node=>node.textContent.includes('Automation')))).click();
 assert(!document.querySelector('.saved-prompt-form'),'Creation form is visible before New automation');
 (await wait(()=>document.querySelector('.automation-list-header button'))).click();
 await wait(()=>document.querySelector('.automation-dialog'));
 assert(document.querySelector('[role="group"][aria-label="Automation type"]'),'Agent/Shell choice missing');
 assert(!document.querySelector('.automation-dialog [aria-label="Account"]'),'Empty account dropdown still present');
 assert(!document.querySelector('.automation-dialog [aria-label="Permission"]'),'Permission dropdown still present');
 assert(document.querySelector('[aria-label="Paste from clipboard"]'),'Paste action missing');
 assert(document.querySelector('[aria-label="Copy output"]'),'Copy action missing');
 assert(document.querySelector('[aria-label="Describe automation task"]'),'Draft instruction missing');
 assert(!document.querySelector('.automation-repositories'),'Manual automation asks for repositories before run');
 assert(document.querySelector('.automation-dialog-content').scrollHeight<=document.querySelector('.automation-dialog-content').clientHeight+2,'Default dialog requires scrolling: '+document.querySelector('.automation-dialog-content').scrollHeight+'/'+document.querySelector('.automation-dialog-content').clientHeight);
 const choose=async(label,value)=>{if(label==='Condition'){for(const button of [...document.querySelectorAll('.automation-condition-remove')]){button.click();await pause();}label='Add condition';}const button=document.querySelector('.automation-dialog [aria-label="'+label+'"]');assert(button,'Missing '+label);button.click();await pause(0);const option=[...document.querySelectorAll('[role="option"]')].find(node=>node.dataset.value===value);assert(option,'Missing '+label+' option '+value);option.click();await pause();};
 await choose('Condition','interval');
 assert(document.querySelector('.automation-dialog > header [aria-label="Automation name"]'),'Automation name is not in the header');
 assert(document.querySelector('.automation-conditions > strong')?.textContent==='Conditions','Conditions row is not labeled');
 assert(document.querySelector('.automation-condition-chip').textContent.includes('60 min'),'Interval parameter is missing from its chip');
 document.querySelector('.automation-condition-chip .automation-condition-edit').click();await pause();
 assert(!document.querySelector('[aria-label="Interval minutes"]'),'Clicking an open chip did not fold its settings');
 document.querySelector('.automation-condition-chip .automation-condition-edit').click();await pause();
 const intervalInput=document.querySelector('[aria-label="Interval minutes"]');
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(intervalInput,'30');intervalInput.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 assert(document.querySelector('.automation-condition-chip').textContent.includes('30 min'),'Chip did not update after editing the interval');
 assert(document.querySelector('.automation-branch > strong')?.textContent==='Branch','Branch selector has no visible label');
 assert(document.querySelector('.automation-dialog-content').scrollHeight<=document.querySelector('.automation-dialog-content').clientHeight+2,'Folded interval dialog requires scrolling: '+document.querySelector('.automation-dialog-content').scrollHeight+'/'+document.querySelector('.automation-dialog-content').clientHeight);
 const repoIds=[...document.querySelectorAll('.automation-repository-choices > div input')].map((node,index)=>node.closest('label').textContent.trim());
 assert(!document.querySelector('.automation-repositories').open,'Repositories expanded by default');
 assert(document.querySelector('.automation-conditions').compareDocumentPosition(document.querySelector('.automation-repositories'))&Node.DOCUMENT_POSITION_FOLLOWING,'Condition must precede repositories');
 document.querySelector('.automation-repositories summary').click();
 const all=document.querySelector('[aria-label="Select all repositories"]');assert(all,'Select all missing');all.click();await pause();
 const selectedCount=[...document.querySelectorAll('.automation-repository-choices > div input')].filter(node=>node.checked).length;
 assert(selectedCount>=2,'Select all did not select multiple repositories');
 const future=[...document.querySelectorAll('.automation-repository-choices label')].find(node=>node.textContent.includes('Include future'));assert(future,'Future repository option missing');future.querySelector('input').click();await pause();
 assert(document.querySelector('.automation-target-summary').textContent==='All','All scope summary missing');
 assert(document.querySelector('.automation-repositories summary small').textContent.includes(String(selectedCount)),'Selected count missing');
 document.querySelector('.automation-type button:nth-child(2)').click();await pause();
 assert(!document.querySelector('[aria-label="Execution agent"]'),'Shell mode has execution agent');
 assert(document.querySelector('[aria-label="Draft agent"]'),'Draft agent missing');
 const draftBounds=document.querySelector('.automation-draft').getBoundingClientRect(),outputBounds=document.querySelector('.automation-output').getBoundingClientRect();
 assert(draftBounds.width>0&&outputBounds.width>0,'Draft or output field is hidden');
 const nameInput=document.querySelector('.automation-dialog [aria-label="Automation name"]');assert(nameInput,'Automation name missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(nameInput,'Fixture autosave');nameInput.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 const textarea=document.querySelector('.automation-dialog textarea[aria-label="Shell command or script"]');
 Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'printf "fixture shell"');textarea.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 assert(document.querySelector('.shell-editor-highlight .hljs-string'),'Shell string syntax is not highlighted');
 window.__automationStage='save retry';
 const originalSet=Storage.prototype.setItem;let failOnce=true;
 Storage.prototype.setItem=function(key,value){if(key==='gitcerberus.savedPrompts.v1'&&failOnce){failOnce=false;throw Error('Fixture storage failure');}return originalSet.call(this,key,value);};
 document.querySelector('.automation-dialog footer button:last-child').click();await pause();
 assert(document.querySelector('.automation-dialog'),'Dialog closed after failed save');
 assert(!document.querySelector('.saved-prompt-list article'),'Failed save appeared as a card');
 Storage.prototype.setItem=originalSet;
 document.querySelector('.automation-dialog footer button:last-child').click();await pause();
 assert(!document.querySelector('.automation-dialog'),'Dialog stayed open after successful save');
 let jobs=JSON.parse(localStorage.getItem('gitcerberus.savedPrompts.v1'));
 assert(jobs.length===1&&jobs[0].kind==='shell'&&!jobs[0].runtimeTarget&&jobs[0].includeFutureRepositories&&jobs[0].repositoryIds.length===selectedCount,'Shell automation did not save all targets');
 assert(document.querySelectorAll('.saved-prompt-list article').length===1,'Saved automation card missing');
 assert(document.querySelector('.saved-prompt-list article strong').textContent==='Fixture autosave','Automation name missing from card');
 assert(!document.querySelector('.saved-prompt-list article').textContent.includes('printf'), 'Automation content leaked onto card');
 const actionButtons=[...document.querySelectorAll('.saved-prompt-list article .saved-prompt-actions > button')];assert(actionButtons.length>=3&&Math.max(...actionButtons.map(button=>button.getBoundingClientRect().top))-Math.min(...actionButtons.map(button=>button.getBoundingClientRect().top))<2,'Automation actions are stacked vertically');
 document.querySelector('.saved-prompt-list article').click();await wait(()=>document.querySelector('.automation-log-dialog'));
 assert(document.querySelector('.automation-detail-pane .shell-code').textContent.includes('printf "fixture shell"'),'Inspect view omitted script');
 document.querySelector('[aria-label="Close automation details"]').click();await pause();
 window.__automationStage='edit existing automation';
 const originalId=jobs[0].id;const editDraftCalls=[];
 document.querySelector('.saved-prompt-list [aria-label^="Edit "]').click();await wait(()=>document.querySelector('[aria-label="Edit automation"]'));
 assert(document.querySelector('[aria-label="Automation name"]').value==='Fixture autosave','Edit did not prefill name');
 assert(document.querySelector('[aria-label="Shell command or script"]').value==='printf "fixture shell"','Edit did not prefill script');
 assert(document.querySelector('.automation-condition-chip').textContent.includes('Every interval'),'Edit did not prefill condition');
 assert(document.querySelector('.automation-target-summary').textContent==='All','Edit did not prefill future repository scope');
 api.runNewAgentConversation=async(repo,agent,identity,mode,request,sessionId)=>{editDraftCalls.push({repo,agent,request,sessionId});return {text:'printf "revised shell"',sessionId:'edit-draft-session'};};
 await choose('Draft agent','copilot');
 const editInstruction=document.querySelector('textarea[aria-label="Describe automation task"]');
 Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editInstruction,'Add a revised message');editInstruction.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 editInstruction.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));
 await wait(()=>document.querySelector('textarea[aria-label="Shell command or script"]').value==='printf "revised shell"');
 assert(editDraftCalls.length===1&&editDraftCalls[0].request.includes('Modify the following existing automation')&&editDraftCalls[0].request.includes('printf "fixture shell"')&&editDraftCalls[0].request.includes('Add a revised message'),'Edit drafting did not modify the saved script');
 document.querySelector('.automation-dialog footer button:last-child').click();await wait(()=>!document.querySelector('.automation-dialog'));
 jobs=JSON.parse(localStorage.getItem('gitcerberus.savedPrompts.v1'));
 assert(jobs.length===1&&jobs[0].id===originalId&&jobs[0].prompt==='printf "revised shell"'&&jobs[0].enabled,'Edit created a duplicate or lost its schedule');
 const shellCalls=[];api.repositories=async()=>jobs[0].repositoryIds.map(id=>({id,localPath:'/tmp/'+id,displayName:id}));api.runAutomationShell=async(repo,script,onOutput)=>{onOutput?.({stream:'stdout',text:'fixture result\n'});await pause(180);shellCalls.push({repo,script});return {result:'fixture result',stdout:'fixture result',stderr:''};};
 document.querySelector('.saved-prompt-list [aria-label^="Run "]').click();await wait(()=>document.querySelector('[aria-label="Choose repository"]'));
 assert(shellCalls.length===0,'Scheduled job ran before manual repository selection');
 document.querySelector('.automation-runtime-dialog [aria-label="Repository"]').click();await pause();
 const scheduledOption=document.querySelector('[role="option"][data-value="'+jobs[0].repositoryIds[0]+'"]');assert(scheduledOption,'Scheduled manual run cannot choose an in-scope repository');scheduledOption.click();await pause();
 document.querySelector('.automation-runtime-dialog footer button:last-child').click();
 assert((await wait(()=>document.querySelector('.automation-detail-pane[aria-label="Automation log"] .automation-log-lines'))).textContent.includes('fixture result'),'Read-only live terminal did not display shell output');await wait(()=>shellCalls.length===1);
 assert(shellCalls[0].repo===jobs[0].repositoryIds[0],'Run now did not target exactly the chosen repository');
 assert((await wait(()=>document.querySelector('[aria-label="Automation log run"]'))).textContent.includes('completed'),'Per-repository log picker is empty');
 assert((await wait(()=>document.querySelector('.automation-detail-pane[aria-label="Automation log"] .automation-log-lines'))).textContent.includes('fixture result'),'Shell output was not retained in the log viewer');
 const logBounds=document.querySelector('.automation-log-dialog').getBoundingClientRect();assert(logBounds.left>=-1&&logBounds.right<=innerWidth+1&&logBounds.top>=-1&&logBounds.bottom<=innerHeight+1,'Automation log viewer exceeds the window');
 window.__automationStage='manual details';
 (await wait(()=>document.querySelector('[aria-label="Close automation details"]'))).click();await pause();
 window.__automationStage='manual runtime target';
 document.querySelector('.automation-list-header button').click();await wait(()=>document.querySelector('.automation-dialog'));
 assert(!document.querySelector('.automation-repositories'),'Manual target selection visible');
 document.querySelector('.automation-type button:nth-child(2)').click();await pause();
 const draftCalls=[];api.runNewAgentConversation=async(repo,agent,identity,mode,request,sessionId,requestId)=>{draftCalls.push({repo,agent,identity,mode,request,sessionId,requestId});return {text:sessionId?'printf "revised"':'```bash\nprintf "generated"\n```',sessionId:'draft-session-1'};};
 await choose('Draft agent','copilot');await choose('Draft context repository',jobs[0].repositoryIds[0]);
 await choose('Draft context repository','');assert(document.querySelector('[aria-label="Draft context repository"]').textContent.includes('backend-api'),'Auto context does not reveal chosen repository');
 const instruction=document.querySelector('textarea[aria-label="Describe automation task"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(instruction,'commit and push to an autosave branch');instruction.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 instruction.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));
 await wait(()=>document.querySelector('textarea[aria-label="Shell command or script"]').value==='printf "generated"');
 assert(draftCalls.length===1&&draftCalls[0].repo===jobs[0].repositoryIds[0]&&draftCalls[0].agent==='copilot'&&draftCalls[0].mode==='analyze'&&draftCalls[0].request.includes('commit and push to an autosave branch'),'Draft did not use selected agent and repository context');
 assert(!draftCalls[0].request.includes('/Users/alex/'),'Draft request unnecessarily includes repository paths');
 assert(document.querySelector('.automation-draft-history').textContent.includes(draftCalls[0].request),'Submitted request was not retained in the drafting conversation');
 const generatedOutput=document.querySelector('textarea[aria-label="Shell command or script"]');
 generatedOutput.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));await pause();assert(generatedOutput.value==='','Output undo failed');
 generatedOutput.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true,cancelable:true}));await pause();assert(generatedOutput.value==='printf "generated"','Output redo failed');
 Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(instruction,'Make the branch name configurable');instruction.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 instruction.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));
 await wait(()=>document.querySelector('textarea[aria-label="Shell command or script"]').value==='printf "revised"');
 assert(draftCalls.length===2&&draftCalls[1].request==='Make the branch name configurable'&&draftCalls[1].sessionId==='draft-session-1','Follow-up did not resume the drafting conversation with raw user input');
 let rejectPending;let stoppedId;api.runNewAgentConversation=async(repo,agent,identity,mode,request,sessionId,requestId)=>{draftCalls.push({repo,agent,identity,mode,request,sessionId,requestId});return new Promise((resolve,reject)=>{rejectPending=reject;});};
 api.cancelDraft=async(id)=>{stoppedId=id;rejectPending('Draft stopped');};
 Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(instruction,'Do one more revision');instruction.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 instruction.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));await wait(()=>document.querySelector('.automation-draft-actions button:last-child').textContent.includes('Stop'));
 document.querySelector('.automation-draft-actions button:last-child').click();await wait(()=>[...document.querySelectorAll('.automation-dialog [role="status"]')].some(node=>node.textContent.includes('Draft stopped')));
 assert(stoppedId===draftCalls[2].requestId&&draftCalls[2].sessionId==='draft-session-1','Stop did not cancel the active draft request');
 assert(document.querySelector('textarea[aria-label="Shell command or script"]').value==='printf "revised"','Stopped draft changed the saved output');
 const manualName=document.querySelector('.automation-dialog [aria-label="Automation name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(manualName,'Manual shell');manualName.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 const manualScript=document.querySelector('textarea[aria-label="Shell command or script"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(manualScript,'printf "manual"');manualScript.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 assert(!document.querySelector('.automation-dialog footer button:last-child').disabled,'Manual Save disabled: '+document.querySelector('.automation-dialog [role="status"]')?.textContent);
 document.querySelector('.automation-dialog footer button:last-child').click();await pause();
 jobs=JSON.parse(localStorage.getItem('gitcerberus.savedPrompts.v1'));const manualJob=jobs.find(item=>item.trigger==='manual');
 assert(manualJob&&manualJob.runtimeTarget&&manualJob.repositoryIds.length===0,'Manual job required targets at creation');
 window.__automationStage='manual choose repository';
 [...document.querySelectorAll('.saved-prompt-list [aria-label^="Run "]')].at(-1).click();await wait(()=>document.querySelector('[aria-label="Choose repository"]'));
 assert(shellCalls.length===1,'Manual job ran before repository selection');
 window.__automationStage='manual select repository';
 document.querySelector('[aria-label="Repository"]').click();await pause();const runtimeOption=document.querySelector('[role="option"][data-value="'+jobs[0].repositoryIds[0]+'"]');assert(runtimeOption,'Runtime repository option missing');runtimeOption.click();await pause();
 window.__automationStage='manual run';
 document.querySelector('.automation-runtime-dialog footer button:last-child').click();await wait(()=>shellCalls.length===2);
 (await wait(()=>document.querySelector('[aria-label="Close automation details"]'))).click();await pause();
 window.__automationStage='multi-repository agent';
 const savedPath=apiPath.replace('/lib/api.ts','/lib/savedPrompts.ts');
 const {savePrompt,savedPrompts,runSavedPrompt,checkSavedPromptSchedule,recordAutomationFileChange,recordAutomationCommit}=await import(savedPath);
 const calls=[];api.runNewAgentConversation=async(repo,provider,identity,mode,prompt)=>{calls.push({repo,provider,identity,mode,prompt});return {text:'Fixture reply',sessionId:'session-'+repo};};
 const targetIds=jobs[0].repositoryIds.slice(0,2);
 savePrompt({id:'new-fixture',repositoryId:targetIds[0],repositoryIds:targetIds,provider:'claude',threadId:'',title:'New Claude conversation',prompt:'Summarize this repository',trigger:'manual',minutes:60,enabled:false,nextAt:Date.now(),editor:'vscode',target:'new',route:'identity',mode:'edit',accountsByRepository:Object.fromEntries(targetIds.map((id,index)=>[id,{profile:{id:'claude-'+index,provider:'claude',label:'Fixture'},route:'identity'}]))});
 await runSavedPrompt('new-fixture',true,targetIds[0]);
 await runSavedPrompt('new-fixture',true,targetIds[1]);
 assert(calls.length===2&&calls[0].identity==='claude-0'&&calls[1].identity==='claude-1','Agent did not use each repository account');
 assert(JSON.parse(localStorage.getItem('gitcerberus.agentChats')).some(chat=>chat.session?.sessionId==='session-'+targetIds[1]),'New chat not recorded in app history');
 window.__automationStage='file change debounce';
 savePrompt({...jobs[0],id:'file-change-fixture',title:'File change fixture',repositoryIds:[targetIds[0]],repositoryId:targetIds[0],includeFutureRepositories:false,runtimeTarget:false,trigger:'fileChange',debounceSeconds:30,enabled:true,state:undefined});
 const beforeFileRuns=shellCalls.length,clock=Date.now();
 recordAutomationFileChange(targetIds[0],clock+1000);
 await checkSavedPromptSchedule(clock+25000);assert(shellCalls.length===beforeFileRuns,'File automation ran before debounce');
 await checkSavedPromptSchedule(clock+32000);await wait(()=>shellCalls.length===beforeFileRuns+1);await wait(()=>JSON.parse(localStorage.getItem('gitcerberus.savedPrompts.v1')).find(job=>job.id==='file-change-fixture')?.state==='completed');
 await checkSavedPromptSchedule(clock+65000);assert(shellCalls.length===beforeFileRuns+1,'File automation reran without a new file change');
 window.__automationStage='commit event repository scope';
 savePrompt({...savedPrompts().find(job=>job.id==='file-change-fixture'),enabled:false});
 savePrompt({...jobs[0],id:'commit-scope-fixture',title:'Commit scope fixture',repositoryIds:targetIds,repositoryId:targetIds[0],includeFutureRepositories:false,runtimeTarget:false,trigger:'commit',commitBranch:'*',enabled:true,state:undefined});
 const beforeCommitRuns=shellCalls.length;
 await recordAutomationCommit(targetIds[1],{head:'commit-before',branch:'wip',reflog:'commit: baseline'});
 await recordAutomationCommit(targetIds[1],{head:'commit-after',branch:'wip',reflog:'commit: fixture'});
 await wait(()=>shellCalls.length===beforeCommitRuns+1);
 assert(shellCalls.at(-1).repo===targetIds[1],'Commit in one watched repository ran in another repository');
 await wait(()=>savedPrompts().find(job=>job.id==='commit-scope-fixture')?.state==='completed');
 savePrompt({...savedPrompts().find(job=>job.id==='commit-scope-fixture'),enabled:false});
 window.__automationStage='interval repository scope';
 savePrompt({...jobs[0],id:'interval-scope-fixture',title:'Interval scope fixture',repositoryIds:targetIds,repositoryId:targetIds[0],includeFutureRepositories:false,runtimeTarget:false,trigger:'interval',conditions:undefined,nextAt:0,enabled:true,state:undefined});
 const beforeIntervalRuns=shellCalls.length;
 await checkSavedPromptSchedule();
 await wait(()=>shellCalls.length===beforeIntervalRuns+targetIds.length);
 assert(targetIds.every(id=>shellCalls.slice(beforeIntervalRuns).some(call=>call.repo===id)),'Scheduled interval did not run separately in every selected repository');
 await wait(()=>savedPrompts().find(job=>job.id==='interval-scope-fixture')?.state==='completed');
 savePrompt({...savedPrompts().find(job=>job.id==='interval-scope-fixture'),enabled:false});
 window.__automationStage='changed lines threshold';
 savePrompt({...savedPrompts().find(job=>job.id==='file-change-fixture'),enabled:false});
 let changedLines=2;api.repositoryChangeSummary=async()=>({head:'fixture-head',changedLines});
 savePrompt({...jobs[0],id:'changed-lines-fixture',title:'Changed lines fixture',repositoryIds:[targetIds[0]],repositoryId:targetIds[0],includeFutureRepositories:false,runtimeTarget:false,trigger:'changeCount',changeThreshold:3,debounceSeconds:30,enabled:true,state:undefined});
 const beforeThresholdRuns=shellCalls.length,thresholdClock=Date.now();
 recordAutomationFileChange(targetIds[0],thresholdClock);await checkSavedPromptSchedule(thresholdClock+31000);
 assert(shellCalls.length===beforeThresholdRuns,'Threshold automation ran below three changed lines');
 changedLines=3;recordAutomationFileChange(targetIds[0],thresholdClock+32000);await checkSavedPromptSchedule(thresholdClock+64000);
 await wait(()=>shellCalls.length===beforeThresholdRuns+1);
 window.__automationStage='dialog layout';
 document.querySelector('.automation-list-header button').click();await wait(()=>document.querySelector('.automation-dialog'));
 await choose('Condition','fileChange');await choose('Add condition','idleTime');assert(document.querySelector('[aria-label="Idle time minutes"]').value==='5','Idle time default is not five minutes');assert(document.querySelector('.automation-dialog > footer .automation-validation-hint')?.textContent.includes('Select at least one repository')&&document.querySelector('.automation-dialog > footer .automation-primary-action').disabled,'Missing footer validation and disabled Save');assert(document.querySelector('.automation-dialog-content').scrollHeight<=document.querySelector('.automation-dialog-content').clientHeight+2,'File change dialog requires scrolling at default size');
 await choose('Condition','changeCount');assert(document.querySelector('[aria-label="Changed lines threshold"]').value==='10','Changed-lines threshold default is not ten');assert(document.querySelector('.automation-dialog-content').scrollHeight<=document.querySelector('.automation-dialog-content').clientHeight+2,'Changed-lines dialog requires scrolling at default size');
 await choose('Condition','manual');
 assert(document.querySelector('.automation-output [aria-label="Execution agent"]'),'Execution agent selector is detached from the Agent prompt');
 for(const zoom of [1,1.4,1.5]){
  document.documentElement.style.setProperty('--ui-zoom',zoom);await pause();
  const pane=document.querySelector('.automation-dialog'),bounds=pane.getBoundingClientRect();
  assert(bounds.left>=-1&&bounds.right<=innerWidth+2&&pane.scrollWidth<=pane.clientWidth+2,'Dialog overflow at '+zoom);
  const providerSelect=pane.querySelector('[aria-label="Execution agent"]');providerSelect.click();await pause();
  const menu=document.querySelector('[role="listbox"]');assert(menu,'Provider menu did not open');
  const rect=menu.getBoundingClientRect();assert(rect.left>=-1&&rect.right<=innerWidth+1&&rect.top>=-1&&rect.bottom<=innerHeight+1,'Provider menu outside viewport at '+zoom);
  menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await pause();
 }
 document.documentElement.style.setProperty('--ui-zoom',1);
 document.querySelector('[aria-label="Close new automation"]').click();
 window.__automationStage='prompt edge icon';
 [...document.querySelectorAll('aside nav button')].find(node=>node.textContent.includes('Repositories')).click();
 const row=await wait(()=>document.querySelector('.repo-row'));row.click();await pause();
 const copyCheckpoint=await wait(()=>document.querySelector('[aria-label="Copy checkpoint commit prompt"]'));
 let checkpointText='';const clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{checkpointText=text;}}});
 copyCheckpoint.click();await wait(()=>checkpointText);
 assert(checkpointText.startsWith('Create a checkpoint commit for the work you have been performing in this task.')&&checkpointText.includes('Account for every modified, deleted, and untracked file.')&&checkpointText.includes('Do not push.')&&checkpointText.endsWith('Treat the repository state as authoritative if it differs from your recollection of the work.'),'Built-in checkpoint prompt differs from the requested template');
 document.querySelector('[aria-label="Edit checkpoint commit prompt"]').click();
 const checkpointEditor=await wait(()=>document.querySelector('textarea[aria-label="Checkpoint commit prompt"]'));
 assert(checkpointEditor.value===checkpointText,'Checkpoint editor did not load the current template');
 Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(checkpointEditor,'Custom checkpoint instruction');checkpointEditor.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 document.querySelector('.checkpoint-prompt-dialog footer .automation-primary-action').click();await wait(()=>!document.querySelector('.checkpoint-prompt-dialog'));
 checkpointText='';copyCheckpoint.click();await wait(()=>checkpointText);
 assert(checkpointText==='Custom checkpoint instruction','Copy did not use the saved custom template');
 document.querySelector('[aria-label="Edit checkpoint commit prompt"]').click();await wait(()=>document.querySelector('.checkpoint-prompt-dialog'));
 assert(document.querySelector('textarea[aria-label="Checkpoint commit prompt"]').value==='Custom checkpoint instruction','Saved custom prompt was not restored in the editor');
 document.querySelector('.checkpoint-prompt-dialog footer button:first-of-type').click();await pause();
 assert(document.querySelector('textarea[aria-label="Checkpoint commit prompt"]').value.startsWith('Create a checkpoint commit for the work you have been performing'),'Restore default did not restore the requested template');
 document.querySelector('.checkpoint-prompt-dialog footer .automation-primary-action').click();await wait(()=>!document.querySelector('.checkpoint-prompt-dialog'));
 checkpointText='';copyCheckpoint.click();await wait(()=>checkpointText);
 assert(checkpointText.includes('Do not push.'),'Restored template was not copied');
 if(clipboardDescriptor)Object.defineProperty(navigator,'clipboard',clipboardDescriptor);else delete navigator.clipboard;
 const checkbox=await wait(()=>document.querySelector('.provider-controls label.provider-codex input'));if(!checkbox.checked)checkbox.click();
 document.querySelector('[aria-label="Refresh conversations"]').click();
 (await wait(()=>[...document.querySelectorAll('.codex-thread-list button')].find(node=>node.textContent.includes('Saved prompt target')))).click();
 await wait(()=>document.querySelector('.codex-message.user .save-prompt-edge'));await pause(200);
 document.querySelector('.codex-message.user .save-prompt-edge').click();
 const prefilled=await wait(()=>document.querySelector('.automation-dialog textarea[aria-label="Prompt to save"]'));
 assert(prefilled.value==='Start','Prompt text was not prefilled');
 assert(document.querySelector('.automation-dialog [aria-label="Execution agent"]').textContent.includes('Codex'),'Provider was not prefilled');
 assert(document.querySelector('.automation-dialog [aria-label="Draft context repository"]').textContent.includes('backend-api'),'Prompt source repository was not used as draft context');
 window.__automationStage='notification and commit';
 document.querySelector('[aria-label="Close new automation"]').click();
 [...document.querySelectorAll('aside nav button')].find(node=>node.textContent.includes('Automation')).click();
 (await wait(()=>document.querySelector('.automation-list-header button'))).click();await pause();
 [...document.querySelectorAll('.automation-type button')].find(node=>node.textContent==='Notification').click();await pause();
 assert(document.querySelector('[aria-label="Notification message"]'),'Notification message field missing');
 assert(!document.querySelector('.automation-draft'),'Notification editor should not show agent drafting');
 const commitSelect=document.querySelector('[aria-label="Add condition"]');commitSelect.click();await pause();
 const commitOption=[...document.querySelectorAll('[role="option"]')].find(node=>node.textContent.includes('On commit'));assert(commitOption,'Commit condition missing');commitOption.click();await pause();
 assert(document.querySelector('[aria-label="Branch patterns"]')&&document.querySelector('[aria-label="All except"]'),'Commit branch pattern controls missing');
 assert(!document.querySelector('.automation-dialog-content .automation-pair-warnings'),'Pair warning is taking dialog content space');
 commitSelect.click();await pause();
 const handoffOption=[...document.querySelectorAll('[role="option"]')].find(node=>node.textContent==='Handoff');assert(handoffOption,'Handoff condition missing');handoffOption.click();await pause();
 assert(document.querySelector('[aria-label="Incoming handoff name"]'),'Incoming handoff field missing');
 const incomingName=document.querySelector('[aria-label="Incoming handoff name"]');
 assert(!incomingName.placeholder,'Incoming handoff field has hint text');
 incomingName.focus();document.execCommand('insertText',false,'review');await pause();
 assert(incomingName.value==='review','Incoming handoff field rejected a new name');
 [...document.querySelectorAll('.automation-type button')].find(node=>node.textContent==='Agent').click();await pause();
 assert(document.querySelector('[aria-label="Outgoing handoff names"]'),'Outgoing handoff field missing');
 const outgoingName=document.querySelector('[aria-label="Outgoing handoff names"]');
 assert(!outgoingName.placeholder,'Outgoing handoff field has hint text');
 outgoingName.focus();document.execCommand('insertText',false,'correction');await pause();
 assert(outgoingName.value==='correction','Outgoing handoff field rejected a new name');
 assert((document.querySelector('.automation-emits').title||document.querySelector('.automation-emits').dataset.zoomTitle||'').includes('the handoff'),'Handoff guidance tooltip is missing');
 assert(document.querySelector('.automation-emits').getBoundingClientRect().top>=document.querySelector('.automation-output textarea').getBoundingClientRect().bottom-2,'Emit field is not below the prompt');
 outgoingName.focus();outgoingName.select();document.execCommand('insertText',false,'new-handoff');await pause();
 assert(document.querySelector('[aria-label="Outgoing handoff names"]').value==='new-handoff','The field rejected a new handoff name');
 const promptModule=await import(apiPath.replace('/lib/api.ts','/lib/savedPrompts.ts'));
 const noticeModule=await import(apiPath.replace('/lib/api.ts','/lib/automationNotifications.ts'));
 const targetId=jobs[0].repositoryIds[0];
 promptModule.savePrompt({id:'fixture-notification',kind:'notification',title:'Fixture notice',repositoryId:targetId,repositoryIds:[targetId],repositoryLabels:{[targetId]:'Fixture repository'},provider:'codex',threadId:'',prompt:'Ready to review',trigger:'manual',minutes:60,enabled:false,nextAt:0,editor:'vscode'});
 await promptModule.runSavedPrompt('fixture-notification',true,targetId);
 assert(noticeModule.useAutomationNotices,'Notification store unavailable');
 assert(localStorage.getItem('gitcerberus.automationNotifications.v1').includes('Fixture repository'),'Triggered notification omitted repository name');
 window.__savedPromptCheck={passed:true,shellCalls,calls,selectedCount};
})().catch(error=>window.__savedPromptCheck={passed:false,error:String(error),stage:window.__automationStage});
"""
window=Gtk.OffscreenWindow()
view=WebKit2.WebView()
view.set_size_request(900,620)
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
