import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Copy, Play, Plus, Trash2, X, WandSparkles, Square, Pencil } from 'lucide-react';
import { Select } from './Select';
import { HandoffNameInput } from './HandoffNameInput';
import { knownHandoffNames, handoffPairWarnings } from '../lib/handoffNames';
import { ShellCode, ShellEditor } from './ShellCode';
import { removePrompt, reorderSavedPrompts, runSavedPrompt, savePrompt, savedPrompts, subscribeSavedPrompts, validHandoffName, validCommitBranchPatterns, type AutomationDraft, type SavedPrompt, type Trigger } from '../lib/savedPrompts';
import { useCardReorder } from '../lib/cardReorder';
import type { AccountSettings } from '../lib/chatgptAccounts';
import type { ExternalIdentity, Settings } from '../lib/externalIdentities';
import { automationAccount } from '../lib/automationAccounts';
import { sendAgentMessage, stopAgentChat, getAgentChat, waitForAgentChat } from '../lib/agentChats';
import { api } from '../lib/api';
import { useUndoableText } from '../lib/useUndoableText';
import type { AgentProfile } from '../lib/agentChats';
import type { Provider } from '../lib/conversationCache';
import type { Identity, Repository } from '../types';

type Props={repositories:Repository[];profiles:AgentProfile[];chatgptSettings:AccountSettings;external:{identities:ExternalIdentity[];settings:Settings};identities:Identity[];draft?:AutomationDraft};
const providers:Provider[]=['codex','cursor','copilot','claude'];
const AutomationLogDialog=lazy(()=>import('./AutomationLogDialog').then(module=>({default:module.AutomationLogDialog})));
function legacyGitScript(job:SavedPrompt){
  const quote=(value:string)=>`'${value.replace(/'/g,"'\\''")}'`;
  switch(job.gitAction){
    case 'fetch':return 'git fetch';
    case 'pull':return 'git pull';
    case 'push':return 'git push';
    case 'stage':return `git add -- ${quote(job.prompt)}`;
    case 'unstage':return `git restore --staged -- ${quote(job.prompt)}`;
    case 'commit':return `git commit -m ${quote(job.prompt)}`;
    default:return job.prompt;
  }
}
export function SavedPromptsPanel({repositories,profiles,chatgptSettings,external,identities,draft}:Props){
  const [revision,setRevision]=useState(0);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [provider,setProvider]=useState<Provider>('codex');
  const [draftProvider,setDraftProvider]=useState<Provider>('codex');
  const [draftRepositoryId,setDraftRepositoryId]=useState('');
  const promptText=useUndoableText();
  const prompt=promptText.value,setPrompt=promptText.set;
  const [trigger,setTrigger]=useState<Trigger>('manual');
  const [minutes,setMinutes]=useState(60);
  const [debounceSeconds,setDebounceSeconds]=useState(300);
  const [changeThreshold,setChangeThreshold]=useState(10);const [commitBranch,setCommitBranch]=useState('');const [commitAllExcept,setCommitAllExcept]=useState(false);
  const [handoffName,setHandoffName]=useState('');
  const [emitsText,setEmitsText]=useState('');
  const [notice,setNotice]=useState('');
  const [name,setName]=useState('');
  const [detailJobId,setDetailJobId]=useState('');
  const [dialogOpen,setDialogOpen]=useState(false);
  const [editingJob,setEditingJob]=useState<SavedPrompt|null>(null);
  const [kind,setKind]=useState<'prompt'|'shell'|'notification'>('prompt');
  const [includeFuture,setIncludeFuture]=useState(false);
  const [runtimeJob,setRuntimeJob]=useState<SavedPrompt|null>(null);
  const [runtimeRepository,setRuntimeRepository]=useState('');
  const instructionText=useUndoableText();
  const instruction=instructionText.value,setInstruction=instructionText.set;
  const [draftSession,setDraftSession]=useState<{provider:Provider;repositoryId:string;identityId:string;route:'profile'|'identity';sessionId?:string;chatId?:string}|null>(null);
  const activeDraft=useRef<{repositoryId:string;route:'profile'|'identity';requestId:string;stopped:boolean}|null>(null);
  const [draftMessages,setDraftMessages]=useState<{role:'user'|'assistant';text:string}[]>([]);
  const [generating,setGenerating]=useState(false);
  useEffect(()=>subscribeSavedPrompts(()=>setRevision(value=>value+1)),[]);
  useEffect(()=>{if(!draft)return;setEditingJob(null);setKind('prompt');setSelectedIds([draft.repositoryId]);setProvider(draft.provider||'codex');setDraftProvider(draft.provider||'codex');setDraftRepositoryId(draft.repositoryId);promptText.reset(draft.prompt);setName(draft.title||'');setIncludeFuture(false);instructionText.reset();setDraftSession(null);setDraftMessages([]);setNotice('');setDialogOpen(true);},[draft]);
  useEffect(()=>{if(dialogOpen)requestAnimationFrame(()=>document.querySelector<HTMLElement>('.automation-type button')?.focus());},[dialogOpen]);
  const localRepositories=repositories.filter(item=>item.localPresent!==false&&!!item.localPath);
  const validIds=new Set(localRepositories.map(item=>item.id));
  const targets=selectedIds.filter(id=>validIds.has(id));
  const resolveRoute=(repository:Repository)=>automationAccount(repository,provider,profiles,chatgptSettings,external,identities);
  const routes=Object.fromEntries(localRepositories.filter(item=>targets.includes(item.id)).map(item=>[item.id,resolveRoute(item)]));
  const missing=kind==='prompt'?targets.filter(id=>!routes[id]):[];
  const draftAccount=(item:Repository)=>automationAccount(item,draftProvider,profiles,chatgptSettings,external,identities);
  const draftScope=trigger!=='manual'?localRepositories.filter(item=>targets.includes(item.id)):localRepositories;
  const autoDraftRepository=draftScope.find(item=>draftAccount(item));
  const jobs=savedPrompts();
  const knownNames=knownHandoffNames(jobs);
  const emitsHandoffs=[...new Set(emitsText.split(/[\s,]+/).map(value=>value.trim().toLowerCase()).filter(Boolean))];
  const invalidReason=trigger!=='manual'&&!targets.length?'Select at least one target repository.':!name.trim()?'Name this automation.':!prompt.trim()?(kind==='shell'?'Enter a shell command or script.':kind==='notification'?'Enter a notification message.':'Enter a prompt.'):trigger==='commit'&&!validCommitBranchPatterns(commitBranch)?'Enter valid branch patterns separated by commas.':trigger==='handoff'&&!validHandoffName(handoffName.trim())?'Enter a valid handoff name.':emitsHandoffs.some(value=>!validHandoffName(value))?'Enter valid outgoing handoff names.':kind==='shell'&&new Set(emitsHandoffs.map(value=>value.replace(/-/g,'_'))).size!==emitsHandoffs.length?'Outgoing handoff names must have distinct shell variables.':trigger!=='manual'&&missing.length?(provider==='copilot'?'Assign a GitHub account to every selected repository for Copilot.':`Connect and assign a ${provider} account for every selected repository.`):'';
  const savedPairWarnings=handoffPairWarnings(jobs,localRepositories);
  const reorderCards=useCardReorder(jobs.map(job=>job.id),ids=>{try{reorderSavedPrompts(ids);setNotice('');}catch(error){setNotice(`Could not reorder automations: ${String(error)}`);}});
  void revision;
  const trySave=(job:SavedPrompt)=>{try{savePrompt(job);setNotice('');return true;}catch(error){setNotice(`Automation was not saved: ${String(error)}`);return false;}};
  const paste=async()=>{try{setPrompt(await navigator.clipboard.readText());setNotice('');}catch(error){setNotice(`Could not paste: ${String(error)}`);}};
  const copy=async()=>{try{await navigator.clipboard.writeText(prompt);setNotice('Copied output.');}catch(error){setNotice(`Could not copy: ${String(error)}`);}};
  const stopDraft=async()=>{
    const active=activeDraft.current;if(!active)return;
    active.stopped=true;setNotice('Stopping draft…');
    try{if(active.route==='profile')await stopAgentChat(active.repositoryId);else await api.cancelDraft(active.requestId);}
    catch(error){setNotice(`Could not stop draft: ${String(error)}`);}
  };
  const generate=async()=>{
    if(generating)return;
    const task=instruction.trim();if(!task){setNotice(draftSession?'Enter a follow-up message.':'Describe what you want to automate.');return;}
    const repository=draftRepositoryId?localRepositories.find(item=>item.id===draftRepositoryId):autoDraftRepository;
    const account=repository&&draftAccount(repository);
    if(!repository||!account){setNotice(draftProvider==='copilot'?'Choose a repository with an assigned GitHub account for Copilot drafting.':`Assign a connected ${draftProvider} account to ${draftRepositoryId?'the draft context repository':'a local repository'} to draft this automation.`);return;}
    const continuing=!!draftSession&&draftSession.provider===draftProvider&&draftSession.repositoryId===repository.id&&draftSession.identityId===account.profile.id&&draftSession.route===account.route;
    if(continuing&&!draftSession?.sessionId){setNotice('This draft conversation has no resumable session. Change the draft agent or repository to start a new draft.');return;}
    const request=continuing?task:editingJob?`Modify the following existing automation ${editingJob.kind==='shell'||editingJob.kind==='git'?'Bash shell script':'prompt for a coding agent'} according to the user's request. Return the complete revised ${kind==='shell'?'shell script':'automation prompt'} only, without markdown fences or explanation. ${kind==='shell'?'The script runs from a repository directory; make it safe to rerun.':'The prompt will be sent in a new conversation for each target repository.'} Preserve behavior that the user did not ask to change. Use the current repository as context when your available tools permit it. Do not modify files.\n\nExisting ${editingJob.kind==='shell'||editingJob.kind==='git'?'script':'prompt'}:\n${prompt}\n\nRequested change: ${task}`:`Generate an automation ${kind==='shell'?'Bash shell script':'prompt for a coding agent'} to accomplish the following task. Return only the ${kind==='shell'?'necessary shell commands':'automation prompt'} to be copied, without markdown fences or explanation. ${kind==='shell'?'The script runs from a repository directory; make it safe to rerun.':'The prompt will be sent in a new conversation for each target repository.'} Use the current repository as context when your available tools permit it. Do not modify files.\n\nTask: ${task}`;
    const requestId=crypto.randomUUID();
    activeDraft.current={repositoryId:repository.id,route:account.route,requestId,stopped:false};
    if(!continuing)setDraftMessages([]);
    setInstruction(request);setGenerating(true);setNotice('');
    try{
      let raw:string,sessionId:string|undefined,chatId:string|undefined;
      if(account.route==='profile'){
        chatId=await sendAgentMessage(repository.id,account.profile,request,'analyze',continuing?draftSession?.chatId:undefined,[],undefined,!continuing);
        raw=await waitForAgentChat(chatId);
        sessionId=getAgentChat(chatId)?.session?.sessionId;
      }else{
        const result=await api.runNewAgentConversation(repository.id,draftProvider,account.profile.id,'analyze',request,continuing?draftSession?.sessionId:undefined,requestId);
        raw=result.text;sessionId=result.sessionId||draftSession?.sessionId;
      }
      if(activeDraft.current?.stopped){setNotice('Draft stopped.');return;}
      const output=raw.trim().replace(/^```(?:bash|sh|text)?\s*\n?/i,'').replace(/\n?```\s*$/,'').trim();
      if(!output||output==='Completed')throw new Error('The agent completed without a text draft. Inspect its conversation and try again.');
      setPrompt(output);setDraftMessages(current=>[...(continuing?current:[]),{role:'user',text:request},{role:'assistant',text:output}]);
      setDraftSession({provider:draftProvider,repositoryId:repository.id,identityId:account.profile.id,route:account.route,sessionId,chatId});
      instructionText.reset();
    }catch(error){setNotice(activeDraft.current?.stopped?'Draft stopped.':`Could not generate draft: ${String(error)}`);}
    finally{activeDraft.current=null;setGenerating(false);}
  };
  const save=()=>{
    if(!name.trim()){setNotice('Name this automation.');return;}
    if(trigger!=='manual'&&!targets.length){setNotice('Select at least one local repository.');return;}
    if(!prompt.trim()){setNotice(kind==='shell'?'Enter a shell command or script.':kind==='notification'?'Enter a notification message.':'Enter a prompt.');return;}if(trigger==='commit'&&!validCommitBranchPatterns(commitBranch)){setNotice('Enter valid branch patterns separated by commas.');return;}
    if(trigger==='handoff'&&!validHandoffName(handoffName.trim())){setNotice('Enter a handoff name using letters, numbers, hyphens, or underscores.');return;}
    if(emitsHandoffs.some(name=>!validHandoffName(name))){setNotice('Outgoing handoff names must use letters, numbers, hyphens, or underscores.');return;}
    if(kind==='shell'&&new Set(emitsHandoffs.map(name=>name.replace(/-/g,'_'))).size!==emitsHandoffs.length){setNotice('These handoff names would share the same shell variable. Use distinct names.');return;}
    if(trigger!=='manual'&&missing.length){setNotice(provider==='copilot'?'Assign a GitHub account to every selected repository for Copilot.':`Connect and assign a ${provider} account for every selected repository.`);return;}
    const duration=Math.max(1,Math.min(10080,Math.floor(minutes)||60));
    const base={id:editingJob?.id||crypto.randomUUID(),title:name.trim(),repositoryId:trigger==='manual'?'':targets[0],repositoryIds:trigger==='manual'?[]:targets,repositoryLabels:Object.fromEntries(localRepositories.filter(item=>trigger!=='manual'&&targets.includes(item.id)).map(item=>[item.id,item.displayName])),includeFutureRepositories:trigger==='manual'||(includeFuture&&selectedAll),runtimeTarget:trigger==='manual',provider,threadId:'',prompt:prompt.trim(),trigger,minutes:duration,debounceSeconds:Math.max(30,Math.min(86400,Math.floor(debounceSeconds)||300)),changeThreshold:Math.max(1,Math.min(1000000,Math.floor(changeThreshold)||10)),commitBranch:commitBranch.trim(),commitAllExcept,handoffName:trigger==='handoff'?handoffName.trim().toLowerCase():undefined,emitsHandoffs:kind==='notification'?[]:emitsHandoffs,editor:editingJob?.editor||'vscode' as const,enabled:trigger!=='manual'&&(editingJob?.trigger===trigger?editingJob.enabled:true),nextAt:Date.now()+duration*60_000};
    const job:SavedPrompt=kind==='notification'?{...base,kind:'notification'}:kind==='shell'?{...base,kind:'shell',title:name.trim()}:{...base,kind:'prompt',target:'new',title:name.trim(),mode:editingJob?.kind==='prompt'?editingJob.mode||'edit':'edit',accountsByRepository:Object.fromEntries((trigger==='manual'?[]:targets).map(id=>[id,routes[id]!]))};
    if(!trySave(job))return;
    setDialogOpen(false);setEditingJob(null);promptText.reset();setNotice(editingJob?'Automation updated.':'Automation saved.');
  };
  const editJob=(job:SavedPrompt)=>{
    if(job.state==='running'){setNotice('Wait for this automation to finish before editing it.');return;}
    setEditingJob(job);
    setName(job.title);
    setKind(job.kind==='notification'?'notification':job.kind==='shell'||job.kind==='git'?'shell':'prompt');
    setProvider(job.provider);
    setDraftProvider(job.provider);
    setDraftRepositoryId('');
    setSelectedIds(job.includeFutureRepositories&&job.trigger!=='manual'?localRepositories.map(item=>item.id):job.repositoryIds?.length?job.repositoryIds:job.repositoryId?[job.repositoryId]:[]);
    setIncludeFuture(!!job.includeFutureRepositories&&job.trigger!=='manual');
    setTrigger(job.trigger==='interval'||job.trigger==='fileChange'||job.trigger==='changeCount'||job.trigger==='commit'||job.trigger==='handoff'?job.trigger:'manual');
    setMinutes(job.minutes);
    setDebounceSeconds(job.debounceSeconds||300);
    setChangeThreshold(job.changeThreshold||10);setCommitBranch(job.commitBranch||'');setCommitAllExcept(!!job.commitAllExcept);
    setHandoffName(job.handoffName||'');setEmitsText((job.emitsHandoffs||[]).join(', '));
    promptText.reset(job.kind==='git'?legacyGitScript(job):job.prompt);
    instructionText.reset();setDraftSession(null);setDraftMessages([]);
    setNotice(job.kind==='git'?'This older Git action will be saved as a Shell automation.':job.trigger==='afterIdle'?'This older trigger no longer runs automatically. Choose an interval or save it as manual.':job.target!=='new'&&job.kind!=='shell'?'This older conversation target will be saved as a new in-app conversation.':'');
    setDialogOpen(true);
  };
  const selectedAll=localRepositories.length>0&&targets.length===localRepositories.length;
  return <section className="saved-prompts" aria-label="Saved automations">
    <header className="automation-list-header"><div><h2>Automations</h2><p className="panel-copy">Watch repositories for events, or run at intervals. Run now uses one repository.</p></div><button type="button" onClick={()=>{setEditingJob(null);setKind('prompt');setName('');setSelectedIds([]);setProvider('codex');setDraftProvider('codex');setDraftRepositoryId('');promptText.reset();setTrigger('manual');setMinutes(60);setDebounceSeconds(300);setChangeThreshold(10);setCommitBranch('');setCommitAllExcept(false);setHandoffName('');setEmitsText('');setIncludeFuture(false);instructionText.reset();setDraftSession(null);setDraftMessages([]);setNotice('');setDialogOpen(true);}}><Plus size={16}/> New automation</button></header>
    {notice&&!dialogOpen&&<p role="status" className="panel-copy">{notice}</p>}
    {savedPairWarnings.length>0&&<div className="automation-pair-warnings" role="status">{savedPairWarnings.map(message=><p key={message}>{message}</p>)}</div>}
    <div className="saved-prompt-list">{jobs.map(job=>{const legacy=job.kind!=='git'&&job.kind!=='shell'&&job.kind!=='notification'&&job.target!=='new';const ids=job.repositoryIds?.length?job.repositoryIds:[job.repositoryId];const names=job.includeFutureRepositories?'all repositories':ids.map(id=>repositories.find(item=>item.id===id)?.displayName||id).join(', ');const label=job.trigger==='manual'?'Choose one repository at run time':job.trigger==='interval'?`Runs in ${names}`:`Watches ${names}`;const dragItem=reorderCards.item(job.id);return <article key={job.id} {...dragItem} {...reorderCards.source(job.id,job.title)} className={dragItem.className} role="button" tabIndex={0} aria-label={`Open ${job.title}`} onClick={event=>{if((event.target as HTMLElement).closest('button, input, label'))return;setDetailJobId(job.id);}} onKeyDown={event=>{if((event.target as HTMLElement).closest('button, input, label'))return;if(event.key==='Enter'||event.key===' '){event.preventDefault();setDetailJobId(job.id);}}}>
      <div><strong>{job.title}</strong><small className={job.kind==='prompt'?`provider-name provider-${job.provider}`:'provider-name'}>{label} · {job.kind==='shell'?'Shell':job.kind==='git'?'Git':job.kind==='notification'?'Notification':job.provider} · {job.trigger==='interval'?`Every ${job.minutes} min`:job.trigger==='fileChange'?`Wait ${job.debounceSeconds||300} sec after changes`:job.trigger==='changeCount'?`${job.changeThreshold||10} changed lines · wait ${job.debounceSeconds||300} sec`:job.trigger==='commit'?`${job.commitAllExcept?'Commit on all except':'Commit on'} ${job.commitBranch}`:job.trigger==='handoff'?`Handoff ${job.handoffName}`:job.trigger==='afterIdle'?'After work completes':'Manual'}</small></div>
      <div className="saved-prompt-actions"><button type="button" title="Edit automation" aria-label={`Edit ${job.title}`} disabled={job.state==='running'} onClick={()=>editJob(job)}><Pencil size={15}/></button>{!legacy&&<button className="automation-primary-action" type="button" title="Run once in one repository" aria-label={`Run ${job.title} now`} disabled={job.state==='running'} onClick={()=>{setRuntimeRepository('');setRuntimeJob(job);}}><Play size={15}/></button>}{job.state==='running'&&<button type="button" onClick={()=>trySave({...job,state:'error',enabled:false,lastResult:'Delivery state cleared for review. Check the destinations before running again.'})}>Clear pending</button>}{!legacy&&job.trigger!=='manual'&&<label><input type="checkbox" checked={job.enabled} disabled={job.state==='running'} onChange={event=>trySave({...job,enabled:event.target.checked,nextAt:event.target.checked?Date.now()+job.minutes*60_000:job.nextAt,sawWorking:false})}/> Enabled</label>}<button type="button" aria-label={`Remove ${job.title}`} onClick={()=>{try{removePrompt(job.id);}catch(error){setNotice(String(error));}}}><Trash2 size={15}/></button></div>
      {job.state==='running'&&<small role="status">Running…</small>}{job.state==='error'&&<small role="status" className="config-error">Error · Inspect for details</small>}
    </article>;})}</div>
    {!jobs.length&&<p className="panel-copy">No automations saved yet.</p>}
    {detailJobId&&jobs.find(item=>item.id===detailJobId)&&<Suspense fallback={<div className="automation-dialog-backdrop" role="status">Loading details…</div>}><AutomationLogDialog job={jobs.find(item=>item.id===detailJobId)!} repositories={repositories} onClose={()=>setDetailJobId('')}/></Suspense>}
    {runtimeJob&&<div className="automation-dialog-backdrop"><section className="automation-dialog automation-runtime-dialog" role="dialog" aria-modal="true" aria-label="Choose repository"><header><h2>Run automation</h2><button type="button" aria-label="Close" onClick={()=>setRuntimeJob(null)}><X size={17}/></button></header><div className="automation-dialog-content"><p className="panel-copy">Run once in one repository. The saved {runtimeJob.trigger==='interval'?'run':'watch'} scope stays the same.</p><Select label="Repository" value={runtimeRepository} onChange={setRuntimeRepository} options={localRepositories.filter(item=>runtimeJob.trigger==='manual'||runtimeJob.includeFutureRepositories||(runtimeJob.repositoryIds||[runtimeJob.repositoryId]).includes(item.id)).map(item=>({value:item.id,label:item.displayName}))}/></div><footer><button className="automation-primary-action" type="button" disabled={!runtimeRepository} onClick={()=>{if(runtimeJob.kind!=='notification')setDetailJobId(runtimeJob.id);void runSavedPrompt(runtimeJob.id,true,runtimeRepository);setRuntimeJob(null);}}>Run once</button></footer></section></div>}
    {dialogOpen&&<div className="automation-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setDialogOpen(false);}}><section className="automation-dialog" role="dialog" aria-modal="true" aria-label={editingJob?'Edit automation':'New automation'} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setDialogOpen(false);}}}><header><h2>{editingJob?'Edit automation':'New automation'}</h2><button type="button" aria-label={editingJob?'Close edit automation':'Close new automation'} onClick={()=>setDialogOpen(false)}><X size={17}/></button></header><div className="automation-dialog-content"><div className="saved-prompt-form">
      <div className="automation-type" role="group" aria-label="Automation type"><button type="button" className={kind==='prompt'?'active':''} aria-pressed={kind==='prompt'} onClick={()=>{setKind('prompt');setDraftSession(null);setDraftMessages([]);}}>Agent</button><button type="button" className={kind==='shell'?'active':''} aria-pressed={kind==='shell'} onClick={()=>{setKind('shell');setDraftSession(null);setDraftMessages([]);}}>Shell</button><button type="button" className={kind==='notification'?'active':''} aria-pressed={kind==='notification'} onClick={()=>{setKind('notification');setDraftSession(null);setDraftMessages([]);}}>Notification</button></div>
      <div className={`saved-prompt-options ${trigger==='changeCount'?'has-threshold':''}`}><label className="automation-name">Name<input aria-label="Automation name" value={name} onChange={event=>setName(event.target.value)} placeholder="Name this automation" maxLength={120}/></label><Select label="Condition" value={trigger==='afterIdle'?'manual':trigger} onChange={value=>setTrigger(value as Trigger)} options={[{value:'manual',label:'Manual'},{value:'interval',label:'Every interval'},{value:'fileChange',label:'When files change'},{value:'changeCount',label:'After changed lines'},{value:'commit',label:'When a commit is made'},{value:'handoff',label:'Handoff'}]}/>{trigger==='handoff'&&<label>Handoff name <HandoffNameInput label="Incoming handoff name" value={handoffName} onChange={setHandoffName} names={knownNames} /></label>}{trigger==='commit'&&<div className="automation-commit-branches"><label className="automation-commit-except"><input type="checkbox" aria-label="All except" checked={commitAllExcept} onChange={event=>setCommitAllExcept(event.target.checked)}/> All except</label><label>Branches <input aria-label="Commit branches" value={commitBranch} onChange={event=>setCommitBranch(event.target.value)} placeholder="main, wip, feature/*"/></label></div>}{trigger==='interval'&&<label>Every <input type="number" min={1} max={10080} value={minutes} onChange={event=>setMinutes(Number(event.target.value))}/> minutes</label>}{trigger==='changeCount'&&<label>After <input aria-label="Changed lines threshold" type="number" min={1} max={1000000} value={changeThreshold} onChange={event=>setChangeThreshold(Number(event.target.value))}/> lines</label>}{(trigger==='fileChange'||trigger==='changeCount')&&<label>Wait for <input aria-label="Wait seconds after file changes" type="number" min={30} max={86400} value={debounceSeconds} onChange={event=>setDebounceSeconds(Number(event.target.value))}/> seconds</label>}</div>
      {trigger!=='manual'&&<div className="automation-scope"><details className="automation-repositories"><summary><strong>{trigger==='interval'?'Run in repositories':'Watch repositories'}</strong><span className="automation-target-summary" title={selectedAll&&includeFuture?'All':targets.map(id=>localRepositories.find(item=>item.id===id)?.displayName||id).join(', ')}>{selectedAll&&includeFuture?'All':targets.map(id=>localRepositories.find(item=>item.id===id)?.displayName||id).join(', ')||'Choose repositories'}</span><small>{targets.length} selected</small></summary><div className="automation-repository-choices"><label><input type="checkbox" aria-label="Select all repositories" checked={selectedAll} ref={node=>{if(node)node.indeterminate=targets.length>0&&!selectedAll;}} onChange={event=>{setSelectedIds(event.target.checked?localRepositories.map(item=>item.id):[]);if(!event.target.checked)setIncludeFuture(false);}}/> Select all <small>({localRepositories.length})</small></label>{selectedAll&&<label><input type="checkbox" checked={includeFuture} onChange={event=>setIncludeFuture(event.target.checked)}/> Include future repositories</label>}<div>{localRepositories.map(item=><label key={item.id}><input type="checkbox" checked={targets.includes(item.id)} onChange={event=>{setSelectedIds(current=>event.target.checked?[...new Set([...current,item.id])]:current.filter(id=>id!==item.id));if(!event.target.checked)setIncludeFuture(false);}}/><span>{item.displayName}</span></label>)}</div>{!localRepositories.length&&<p className="panel-copy">Link a local repository to use automation.</p>}</div></details><small className="automation-scope-note">{trigger==='interval'?'Each interval runs separately in every selected repository.':'A matching event runs only in the repository where it occurs.'}</small></div>}
      {kind==='notification'?<div className="automation-output automation-notification-editor"><div className="automation-field-heading"><strong>Notification message</strong><button type="button" title="Paste from clipboard" aria-label="Paste from clipboard" onClick={()=>void paste()}><ClipboardPaste size={16}/></button></div><textarea aria-label="Notification message" placeholder="Message to show when the condition is met" value={prompt} onChange={event=>promptText.input(event.target.value)} onKeyDown={promptText.keyDown} rows={5}/></div>:<div className="automation-editor-grid"><section className="automation-draft" aria-label="Draft with agent"><div className="automation-field-heading"><strong>Draft</strong><Select label="Draft agent" value={draftProvider} onChange={value=>{setDraftProvider(value as Provider);setDraftSession(null);setDraftMessages([]);}} options={providers.map(value=>({value,label:value==='codex'?'Codex':value==='copilot'?'Copilot':value==='claude'?'Claude':'Cursor'}))}/></div><Select label="Draft context repository" value={draftRepositoryId} onChange={value=>{setDraftRepositoryId(value);setDraftSession(null);setDraftMessages([]);}} options={[{value:'',label:autoDraftRepository?`Auto: ${autoDraftRepository.displayName}`:'Auto: no available repository'},...localRepositories.map(item=>({value:item.id,label:item.displayName}))]}/>{draftMessages.length>0&&<div className="automation-draft-history">{draftMessages.map((message,index)=><p key={index}><b>{message.role==='user'?'You':'Agent'}:</b> {message.text}</p>)}</div>}<textarea aria-label="Describe automation task" placeholder={draftSession?"Ask for a revision…":editingJob?"Describe how to change this automation…":"Describe the task you want to automate…"} value={instruction} onChange={event=>instructionText.input(event.target.value)} onKeyDown={event=>{if(instructionText.keyDown(event))return;if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();void generate();}}} rows={6}/><div className="automation-draft-actions"><button type="button" disabled={generating} onClick={()=>void generate()}><WandSparkles size={16}/>{draftSession?'Send':editingJob?'Draft changes':'Generate draft'}</button>{generating&&<button type="button" onClick={()=>void stopDraft()}><Square size={14}/> Stop</button>}</div></section><div className="automation-output"><div className="automation-field-heading"><strong>{kind==='shell'?'Shell command':'Agent prompt'}</strong>{kind==='prompt'&&<Select label="Execution agent" value={provider} onChange={value=>setProvider(value as Provider)} options={providers.map(value=>({value,label:value==='codex'?'Codex':value==='copilot'?'Copilot':value==='claude'?'Claude':'Cursor'}))}/>}<span><button type="button" title="Paste from clipboard" aria-label="Paste from clipboard" onClick={()=>void paste()}><ClipboardPaste size={16}/></button><button type="button" title="Copy output" aria-label="Copy output" disabled={!prompt} onClick={()=>void copy()}><Copy size={16}/></button></span></div>{kind==='shell'?<ShellEditor value={prompt} onChange={promptText.input} onKeyDown={promptText.keyDown}/>:<textarea aria-label="Prompt to save" placeholder="Prompt to send" value={prompt} onChange={event=>promptText.input(event.target.value)} onKeyDown={promptText.keyDown} rows={8}/>}<label className="automation-emits" title="In your prompt, you can say “the handoff” when one outgoing name is configured. If several are configured, use their names. Example: Write the details of the issues in the handoff. The app supplies the path and deletes the payload after the receiving task completes.">Emit handoffs <HandoffNameInput label="Outgoing handoff names" value={emitsText} onChange={setEmitsText} names={knownNames} multiple /></label></div></div>}
      {notice&&<p role="status" className="panel-copy">{notice}</p>}
    </div></div><footer>{invalidReason&&<p className="automation-validation-hint" role="status">{invalidReason}</p>}<button className="automation-primary-action" type="button" disabled={!!invalidReason} onClick={save}>{editingJob?'Update automation':'Save automation'}</button></footer></section></div>}
  </section>;
}
