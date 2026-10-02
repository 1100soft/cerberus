"""Exercise the real React repository controls in WebKitGTK against `npm run dev`.
Run: /usr/bin/python3 desktop/scripts/check-repository-ui.py [width height]
"""
import json
import subprocess
import sys
import urllib.request
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib

if len(sys.argv) == 1:
    for width, height in [(900, 620), (1100, 700), (1720, 1080), (2200, 700)]:
        subprocess.run([sys.executable, __file__, str(width), str(height)], check=True)
    sys.exit(0)

urllib.request.urlopen("http://127.0.0.1:3000", timeout=5).close()

script = r"""
(async () => {
 const pause = () => new Promise(resolve => setTimeout(resolve, 70));
 const assert = (ok, why) => { if (!ok) throw Error(why); };
 const key = (node, name) => node.dispatchEvent(new KeyboardEvent('keydown', { key:name, bubbles:true, cancelable:true }));
 const rows = () => [...document.querySelectorAll('.repo-row')];
 const selected = () => document.querySelector('.repo-row.selected');
 const chosen = () => document.querySelectorAll('.row-actions .chosen');
 for (let wait = 0; rows().length < 5 && wait < 100; wait++) await pause();
 assert(rows().length >= 5, 'Expected merged local and GitHub demo cards');
 window.__repositoryProgress = 'fonts';
 await document.fonts.ready; await pause();
 const cacheModule = await (await fetch('/src/lib/conversationCache.ts')).text();
 const apiPath = cacheModule.match(/from "([^"]*\/api\.ts[^"]*)"/)[1];
 const {api} = await import(apiPath);
 api.codexAccount = async () => ({account:{email:'ui-test@example.test'}});
 api.codexThreads = async () => ({data:[{id:'fixture-one',name:'Review repository',updatedAt:1700000000},{id:'fixture-two',name:'Plan a change',updatedAt:1699999999}]});
 api.codexMessages = async (_,id) => ({data:[{id:id+'-user',role:'user',text:'Review this repository'},{id:id+'-progress',role:'assistant',text:'Checking the source files'},{id:id+'-progress-2',role:'assistant',text:'Running the checks'},{id:id+'-answer',role:'assistant',text:'A fixture response for keyboard and layout testing.\n\n'.repeat(30),edits:[{path:'src/fixture.ts',kind:'update',diff:'+example'},{path:'src/second.ts',kind:'update',diff:'+second'}]}]});
 api.copilotThreads = async () => ({data:[{id:'copilot-fixture',name:'Copilot review',preview:'Copilot review',updatedAt:1700000001}]});
 api.claudeThreads = async () => ({data:[{id:'claude-fixture',name:'Claude review',preview:'Claude review',updatedAt:1700000002}]});
 api.copilotMessages = async () => ({data:[{id:'cp-answer',role:'assistant',text:'Copilot transcript'}]});
 api.claudeMessages = async () => ({data:[{id:'cl-answer',role:'assistant',text:'Claude transcript'}]});
 const results = [];
 for (const zoom of [1, 1.4, 1.5]) {
  if(!document.querySelector('aside').hidden){document.querySelector('[aria-label="Toggle navigation"]').click();await pause();}
  document.documentElement.style.setProperty('--ui-zoom', zoom);
  window.__repositoryProgress = 'scroll '+zoom;
  const repositoryList = document.querySelector('.repo-grid');
  repositoryList.style.maxHeight = '125px';
  rows()[0].click(); await pause();
  selected().querySelector('[data-control-index="0"]').focus(); await pause();
  for (const direction of ['ArrowDown','ArrowUp']) {
    for (let index=0;index<rows().length+1;index++) {
      key(document.activeElement,direction); await pause();
      const cardBounds = selected().getBoundingClientRect(), listBounds = repositoryList.getBoundingClientRect();
      assert(cardBounds.top >= listBounds.top - 1 && cardBounds.bottom <= listBounds.bottom + 1, 'Selected card is clipped after keyboard navigation: ' + JSON.stringify({zoom,direction,card:cardBounds,list:listBounds}));
    }
  }
  repositoryList.style.maxHeight = '';
  rows()[0].click(); await pause();
  window.__repositoryProgress = 'repository controls '+zoom;
  const before = rows().map(row => row.getBoundingClientRect().height);
  rows()[1].click(); await pause();
  assert(rows().every((row, i) => Math.abs(row.getBoundingClientRect().height - before[i]) < 1), 'Selection changed card height: ' + JSON.stringify({before, after:rows().map(row => row.getBoundingClientRect().height), zoom}));
  const card = selected();
  const editor = card.querySelector('[aria-label="Open in VS Code"]');
  editor.focus(); await pause();
  key(editor, 'ArrowRight'); await pause();
  assert(chosen().length === 1 && chosen()[0].getAttribute('aria-label') === 'Open in Cursor', 'ArrowRight did not select Cursor exclusively: '+JSON.stringify([...chosen()].map(button=>button.getAttribute('aria-label'))));
  editor.dispatchEvent(new PointerEvent('pointerover', { bubbles:true })); await pause();
  assert(chosen().length === 1 && chosen()[0] === editor && document.activeElement === editor, 'Hover did not replace keyboard selection');
  key(editor, 'ArrowRight'); await pause();
  assert(chosen().length === 1 && chosen()[0].getAttribute('aria-label') === 'Open in Cursor', 'Keyboard did not continue from hovered control');
  const count = card.querySelectorAll('[data-control-index]').length;
  for (let i=0;i<count;i++) { key(document.activeElement, 'ArrowRight'); await pause(); }
  assert(chosen()[0].getAttribute('aria-label') === 'Open in Cursor', 'Control cycling failed');
  rows()[0].click(); await pause();
  const from = selected();
  const identity = from.querySelector('.identity');
  assert(identity.getAttribute('aria-label') === 'Assign account', 'Assign account is missing from the tray');
  assert(identity.getAttribute('role') !== 'combobox', 'Account assignment is still an inline dropdown');
  assert(from.querySelector('.provider-identity-badge.github'), 'Account badge is missing');
  identity.focus(); await pause();
  const nextName = from.nextElementSibling.querySelector('.row-name').textContent;
  key(from.querySelector('.identity'), 'ArrowDown'); await pause();
  assert(selected().querySelector('.row-name').textContent === nextName, 'Assign account interrupted list navigation');
  assert(!document.querySelector('[role=listbox]'), 'ArrowDown opened the account menu');
  rows()[0].click(); await pause();
  const assign = selected().querySelector('.identity');
  assign.click(); await pause();
  assert(document.querySelector('.repository-accounts'),'Unified account panel did not open');
  assert(selected().querySelectorAll('.row-actions .identity').length===1 && !selected().querySelector('.assign-chatgpt, .assign-external'),'Repository tray has redundant account buttons');
  document.querySelector('.repository-accounts [aria-label="GitHub account"]').click();await pause();
  let menu = document.querySelector('[role=listbox]');
  assert(menu, 'GitHub account menu did not open');
  const rect = menu.getBoundingClientRect();
  assert(rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1, 'Dropdown outside viewport');
  key(menu, 'ArrowDown'); key(menu, 'Escape'); await pause();
  assert(!document.querySelector('[role=listbox]'), 'Escape did not close dropdown');
  document.querySelector('.repository-accounts [aria-label="GitHub account"]').click(); await pause();
  menu = document.querySelector('[role=listbox]'); key(menu, 'ArrowDown'); key(menu, 'Enter'); await pause();
  assert(!document.querySelector('[role=listbox]'), 'Keyboard choice did not close dropdown');
  document.querySelector('.repository-accounts [aria-label="GitHub account"]').click(); await pause();
  document.querySelector('.summary').dispatchEvent(new MouseEvent('mousedown', { bubbles:true })); await pause();
  assert(!document.querySelector('[role=listbox]'), 'Outside click did not close dropdown');
  document.querySelector('[aria-label="Close account settings"]').click();await pause();
  card.click(); await pause();
  const rowRect = card.getBoundingClientRect(), tray = card.querySelector('.row-panel').getBoundingClientRect();
  const pane = document.querySelector('.repo-grid');
  assert(tray.top < rowRect.bottom && tray.bottom > rowRect.bottom, 'Tray does not overlap card bottom');
  const mid = (rowRect.left + rowRect.right) / 2, trayMid = (tray.left + tray.right) / 2;
  assert(Math.abs(trayMid - mid) < rowRect.width / 3, 'Control tray is not centered on the card');
  assert(rowRect.height / zoom <= 38, 'Repository cards are not dense');
  assert(!card.querySelector('.availability'), 'Local presence consumes card content');
  assert(card.querySelector('.repo-owner').getBoundingClientRect().top < rowRect.top, 'Owner is not on the corner');
  assert(card.querySelector('.repo-visibility').getBoundingClientRect().top < rowRect.top, 'Visibility is not on the corner');
  card.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, clientX:innerWidth-5, clientY:innerHeight-5 })); await pause();
  const context = document.querySelector('.context-menu');
  const cr = context.getBoundingClientRect();
  assert(cr.left >= -1 && cr.right <= innerWidth + 1 && cr.top >= -1 && cr.bottom <= innerHeight + 1, 'Context menu outside viewport');
  key(context, 'Escape'); await pause();
  assert(pane.scrollWidth <= pane.clientWidth + 2, 'Repository pane overflows horizontally');
  const remote = document.querySelector('.repo-remote'); remote.click(); await pause();
  assert(selected() === remote && chosen().length === 1, 'Remote selection is not exclusive');
  assert(remote.querySelector('[aria-label="Clone from GitHub"]'), 'Remote card missing Clone');
  assert(remote.querySelector('[data-control-index="0"]').getAttribute('aria-label') === 'Link existing folder', 'Link existing folder is not the primary action');
  assert(!remote.querySelector('[aria-label="Open in Cursor"]'), 'Remote card offers a local editor');
  const rt = remote.querySelector('.row-panel').getBoundingClientRect();
  const pr = pane.getBoundingClientRect();
  assert(rt.top >= pr.top - 1 && rt.bottom <= pr.bottom + 1, 'Selected tray is clipped by scroll pane');
  const filterToggle = document.querySelector('[aria-label="Filter repositories"]');
  assert(filterToggle, 'Filter toggle is missing');
  if (filterToggle.getAttribute('aria-pressed') !== 'true') filterToggle.click();
  for (let wait = 0; !document.querySelector('.repo-filters') && wait < 20; wait++) await pause();
  assert(filterToggle.getAttribute('aria-pressed') === 'true', 'Filter toggle did not open');
  const filterBounds = document.querySelector('.repo-filters').getBoundingClientRect();
  const filterButtonBounds = filterToggle.getBoundingClientRect();
  assert(filterBounds.top >= filterButtonBounds.bottom && filterBounds.top < filterButtonBounds.bottom + 20, 'Filters not anchored under button');
  assert(filterBounds.left >= 0 && filterBounds.right <= innerWidth + 1 && filterBounds.bottom <= innerHeight + 1, 'Filter popover outside viewport');
  const ownerLabels = [...document.querySelectorAll('.owner-checks label')];
  assert(ownerLabels.every((label, i) => !i || label.getBoundingClientRect().top >= ownerLabels[i-1].getBoundingClientRect().bottom), 'Owners are not vertically stacked');
  const sidebar = document.querySelector('aside');
  if(!sidebar.hidden){document.querySelector('[aria-label="Toggle navigation"]').click();await pause();}
  assert(sidebar.hidden, 'Navigation did not close');
  document.querySelector('[aria-label="Toggle navigation"]').click(); await pause();
  assert(sidebar.scrollWidth <= sidebar.clientWidth + 1, 'Sidebar content is clipped');
  for (const label of sidebar.querySelectorAll('.nav-label, .nav-count, .brand b')) {
    const bounds = label.getBoundingClientRect(), side = sidebar.getBoundingClientRect();
    assert(bounds.left >= side.left && bounds.right <= side.right + 1, 'Sidebar label outside bounds');
  }
  document.querySelector('[aria-label="Toggle navigation"]').click(); await pause();
  assert(document.querySelector('.repo-filters [aria-label="Filter by status"]'), 'Status filter is not grouped with the other filters');
  const sortToggle = document.querySelector('[aria-label="Sort repositories"]');
  sortToggle.click(); await pause();
  const directSort = document.querySelector('[role=listbox]');
  assert(directSort && directSort.querySelector('[data-value="updated"]'), 'Sort icon did not open options directly');
  const directBounds = directSort.getBoundingClientRect(), sortButtonBounds = sortToggle.getBoundingClientRect();
  assert(directBounds.top >= sortButtonBounds.bottom && directBounds.top < sortButtonBounds.bottom + 20, 'Sort options not directly under button');
  key(directSort, 'Escape'); await pause();
  const owner = [...document.querySelectorAll('.owner-checks label')].find(label => label.textContent.includes('northstar'));
  assert(owner, 'Owner checkboxes are missing');
  document.querySelector('[aria-label="Select all owners"]').click(); await pause();
  assert(rows().length === 0, 'Select all did not clear all owners');
  owner.querySelector('input').click(); await pause();
  for (const [label, choice] of [['Filter by visibility', 'private'], ['Filter by local presence', 'unlinked']]) {
    const trigger = document.querySelector(`[aria-label="${label}"]`);
    trigger.click(); await pause();
    let dropdown = document.querySelector('[role=listbox]');
    const bounds = dropdown.getBoundingClientRect();
    assert(bounds.left >= -1 && bounds.right <= innerWidth + 1 && bounds.top >= -1 && bounds.bottom <= innerHeight + 1, `${label} is outside viewport`);
    key(dropdown, 'Escape'); await pause();
    assert(!document.querySelector('[role=listbox]'), `${label} did not close with Escape`);
    trigger.click(); await pause();
    document.querySelector('.summary').dispatchEvent(new MouseEvent('mousedown', {bubbles:true})); await pause();
    assert(!document.querySelector('[role=listbox]'), `${label} did not close on outside click`);
    trigger.click(); await pause();
    dropdown = document.querySelector('[role=listbox]');
    const options = [...document.querySelectorAll('[role=option]')];
    const index = options.findIndex(option => option.dataset.value === choice);
    assert(index >= 0, `${label} missing ${choice}`);
    assert(options[index].querySelector('.option-count'), `${label} is missing match counts`);
    key(dropdown, 'Home'); await pause();
    for (let i=0; i<index; i++) key(dropdown, 'ArrowDown');
    await pause(); key(dropdown, 'Enter'); await pause();
  }
  assert(rows().length === 1 && rows()[0].textContent.includes('design-system'), 'Combined filters did not isolate expected repository');
  document.querySelector('[aria-label="Select all owners"]').click(); await pause();
  for (const label of ['Filter by visibility', 'Filter by local presence']) {
    document.querySelector(`[aria-label="${label}"]`).click(); await pause(); document.querySelector('[role=option]').click(); await pause();
  }
  const sort = document.querySelector('button[aria-label="Sort repositories"]');
  sort.click(); await pause();
  let sortMenu = document.querySelector('[role=listbox]');
  const sortBounds = sortMenu.getBoundingClientRect();
  assert(sortBounds.left >= -1 && sortBounds.right <= innerWidth + 1 && sortBounds.top >= -1 && sortBounds.bottom <= innerHeight + 1, 'Sort menu outside viewport');
  key(sortMenu, 'Escape'); await pause(); sort.click(); await pause();
  sortMenu = document.querySelector('[role=listbox]'); key(sortMenu, 'Home'); await pause(); key(sortMenu, 'ArrowDown'); await pause(); key(sortMenu, 'Enter'); await pause();
  assert(rows()[0].querySelector('.row-name').textContent === 'backend-api', 'Name sorting failed');
  sort.click(); await pause(); document.querySelector('[role=option]').click(); await pause();
  key(sortToggle, 'Escape'); await pause();
  assert(!document.querySelector('.repo-sort') && !document.querySelector('.repo-filters'), 'Toolbar panels did not close with Escape');
  filterToggle.click(); await pause();
  document.querySelector('.summary').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})); await pause();
  assert(!document.querySelector('.repo-filters'), 'Filter panel did not close on outside click');
  rows()[0].click(); await pause();
  let chatButton = selected().querySelector('[aria-label="Chat with agent"]');
  assert(chatButton && chatButton.dataset.controlIndex === '0', 'Chat must be the first repository action');
  chatButton.click(); await pause();
  let input = document.querySelector('.codex-thread-list button.active');
  assert(input && document.activeElement?.closest('.codex-panel'), 'Chat action must focus the Agent history pane');
  assert(!document.querySelector('.chat-composer, [aria-label="Agent permissions"], [aria-label="Model"]'), 'Read-only Agent pane exposed input controls');
  const providerCheckbox = document.querySelector('.provider-controls input');
  if (!providerCheckbox.checked) { providerCheckbox.click(); await pause(); }
  for (let wait=0; !document.querySelector('.codex-thread-list button.provider-codex') && wait<30; wait++) await pause();
  assert(document.querySelector('.codex-thread-list button.provider-codex'), 'Expected demo conversations');
  const codexColor = getComputedStyle(document.querySelector('.provider-controls .provider-codex')).color;
  assert(codexColor === getComputedStyle(document.querySelector('.codex-thread-list button.provider-codex')).borderLeftColor, 'Codex legend no longer matches conversation color');
  assert(codexColor !== getComputedStyle(document.querySelector('.provider-controls .provider-cursor')).color, 'Provider colors must differ');
  for (const provider of ['copilot','claude']) {
    const checkbox=document.querySelector(`.provider-controls .provider-${provider} input`);
    checkbox.click();await pause();await pause();
    const card=document.querySelector(`.codex-thread-list button.provider-${provider}`);
    assert(card, `${provider} conversation missing from shared history`);
    card.click();await pause();await pause();
    assert(document.querySelector('.codex-messages').textContent.includes(provider==='copilot'?'Copilot transcript':'Claude transcript'), `${provider} transcript missing`);
    checkbox.click();await pause();
  }

  assert(!document.querySelector('.codex-thread-list button.provider-codex small, .codex-thread-list button.provider-codex .provider-badge'), 'Conversation cards still show redundant metadata');
  rows()[1].click(); await pause(); rows()[0].click(); await pause(); await pause();
  assert(document.querySelector('.codex-thread-list .active')?.textContent === 'Review repository', 'Repository selection should open latest conversation');
  assert(!document.querySelector('.toast'), 'Persistent monitoring overlay remains');
  input = document.querySelector('.codex-thread-list button.active');
  chatButton = selected().querySelector('[aria-label="Chat with agent"]');
  input.focus();
  assert(document.querySelector('.turn-edits-button')?.textContent.includes('changed file'), 'Per-response edit overview missing');
  const display = document.querySelector('.codex-messages');
  document.querySelector('[aria-label="Beginning of conversation"]').click(); await pause();
  assert(display.scrollTop < 2, 'Beginning button did not scroll to top');
  document.querySelector('[aria-label="Next prompt or response"]').click(); await pause();
  assert(display.scrollTop > 0, 'Next-message button did not navigate');
  document.querySelector('[aria-label="Previous prompt or response"]').click(); await pause();
  assert(Math.abs(display.querySelector('[data-message-id]').getBoundingClientRect().top-display.getBoundingClientRect().top)<4 || display.scrollTop<3, 'Previous-message button did not navigate: '+JSON.stringify({scroll:display.scrollTop,first:display.querySelector('[data-message-id]').getBoundingClientRect(),pane:display.getBoundingClientRect()}));
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'End',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true})); await pause();
  assert(display.scrollHeight-display.scrollTop-display.clientHeight < 2, 'End shortcut did not reach bottom');
  const reviewTrigger=document.querySelector('.turn-edits-button');
  const originalHeight=display.scrollHeight;reviewTrigger.click();await pause();
  assert(document.querySelector('[role=dialog][aria-label="File changes for this response"]'), 'Missing separate edit review');
  assert(document.querySelector('.edit-review .diff-add') && document.querySelector('.edit-review').textContent.includes('src/fixture.ts'), 'Diff lacks highlighting or file context');
  assert(display.scrollHeight===originalHeight, 'Review expanded transcript');
  const reviewBounds=document.querySelector('.edit-review').getBoundingClientRect();
  assert(reviewBounds.right<=innerWidth+1 && reviewBounds.bottom<=innerHeight+1, 'Edit review outside viewport');
  const review=document.querySelector('.edit-review');
  key(document.activeElement,'Enter');await pause();
  assert(review.querySelector('.diff-active'), 'Enter did not highlight a changed line');
  key(document.activeElement,'ArrowDown');await pause();
  assert(review.querySelector('nav button[aria-pressed=true]')?.textContent.includes('src/second.ts'), 'Arrow Down did not select the next file');
  key(document.activeElement,'Enter');await pause();
  assert(review.querySelector('.diff-active')?.textContent.includes('second'), 'Enter did not highlight an edit in the selected file');
  key(document.activeElement,'ArrowUp');await pause();
  assert(review.querySelector('nav button[aria-pressed=true]')?.textContent.includes('src/fixture.ts'), 'Arrow Up did not select the previous file');
  key(document.activeElement,'Escape');await pause();
  input.dispatchEvent(new KeyboardEvent('keydown',{key:'F',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true}));await pause();
  const localSearch=document.querySelector('[aria-label="Search this conversation"]');
  assert(document.activeElement===localSearch, 'In-conversation search shortcut failed');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(localSearch,'fixture response');localSearch.dispatchEvent(new Event('input',{bubbles:true}));await pause();
  assert(display.querySelector('mark'), 'Search does not highlight matches');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(localSearch,'');localSearch.dispatchEvent(new Event('input',{bubbles:true}));await pause();
  localSearch.dispatchEvent(new KeyboardEvent('keydown',{key:'f',ctrlKey:true,bubbles:true,cancelable:true}));await pause();
  const repoSearch=document.querySelector('[aria-label="Search repository conversations"]');assert(document.activeElement===repoSearch,'Repository conversation search shortcut failed');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(repoSearch,'fixture response');repoSearch.dispatchEvent(new Event('input',{bubbles:true}));
  for(let wait=0;!document.querySelector('.codex-thread-list > button.search-hit') && wait<40;wait++)await pause();
  assert(document.querySelector('.codex-thread-list > button.search-hit'), 'Repository-wide message search returned no results');
  await pause();assert(display.querySelector('mark.current-search-match'), 'Repository search did not jump to its first match');
  const firstConversation=document.querySelector('.codex-thread-list > button.active').textContent;
  const firstMatch=display.querySelector('mark.current-search-match');key(repoSearch,'Enter');await pause();
  assert(display.querySelector('mark.current-search-match')!==firstMatch,'Enter did not move to next match');
  repoSearch.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}));await pause();
  assert(display.querySelector('mark.current-search-match')===firstMatch,'Shift+Enter did not return to previous match');
  for(let index=0;index<30;index++){key(repoSearch,'Enter');await pause();}
  assert(document.querySelector('.codex-thread-list > button.active').textContent!==firstConversation,'Search did not advance to next conversation');
  repoSearch.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}));await pause();
  assert(document.querySelector('.codex-thread-list > button.active').textContent===firstConversation,'Previous match did not cross conversation boundary');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(repoSearch,'');repoSearch.dispatchEvent(new Event('input',{bubbles:true}));await pause();
  key(repoSearch,'Escape');await pause();key(document.activeElement,'f');await pause();
  assert(document.activeElement===document.querySelector('.search input'),'F did not focus repository search');
  key(document.activeElement,'Escape');await pause();input.focus();
  assert(!document.querySelector('.chat-composer'), 'Composer must be absent from read-only history');
  const browseOwner = input;
  browseOwner.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown',shiftKey:true,bubbles:true,cancelable:true})); await pause();
  assert(document.activeElement === browseOwner, 'Commit shortcut stole conversation focus');
  const handoff = document.querySelector('.codex-actions [aria-label="Open in VS Code"]');
  assert(handoff && document.querySelector('.codex-actions [aria-label="Open in Cursor"]'), 'Editor handoff actions are missing');
  assert(!document.querySelector('[aria-label="Agent permissions"], [aria-label="Model"], [aria-label="Reasoning intensity"]'), 'Input-only controls remain');

  document.querySelector('[aria-label="Toggle navigation"]').click(); await pause();
  [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Agents')).click(); await pause();
  window.__repositoryProgress = 'setup '+zoom;
  const agentPanel = document.querySelector('.agents-panel');
  assert(!agentPanel.hidden, 'Agents navigation does not work');
  assert(agentPanel.getBoundingClientRect().right <= innerWidth + 1, 'Agent workspace overflows');
  assert(agentPanel.querySelectorAll('.agent-card').length === 4, 'Missing agent cards');
  assert(!agentPanel.querySelector('[aria-label="AI account"]'), 'Unexpected central account picker');
  const setupButton = agentPanel.querySelector('[aria-label="Set up Codex"]');
  setupButton.focus(); setupButton.click(); await pause();
  let dialog = document.querySelector('.provider-dialog');
  assert(dialog && !agentPanel.contains(dialog), 'Setup must be a separate popup');
  assert(document.querySelector('.shell').hasAttribute('inert'), 'Background remains interactive');
  const bounds = dialog.getBoundingClientRect();
  assert(bounds.top >= 0 && bounds.bottom <= innerHeight + 1 && bounds.right <= innerWidth + 1, 'Setup popup outside viewport');
  assert(!dialog.querySelector('input[type=checkbox]'), 'Setup must not duplicate history controls');
  assert(dialog.textContent.includes('create a new secret API key'), 'Missing API key instructions');
  assert(![...dialog.querySelectorAll('button')].some(b => ['Done','Use for conversations','Close setup'].includes(b.textContent)), 'Redundant completion buttons');
  const firstContents = dialog.textContent;
  assert(!dialog.querySelector('[aria-label="Agent"]'), 'Setup must not ask for the provider again');
  assert(dialog.querySelector('h2').textContent === 'Codex setup', 'Wrong provider setup');
  key(dialog, 'Escape'); await pause();
  assert(!document.querySelector('.provider-dialog') && document.activeElement === setupButton, 'Popup dismissal or focus restoration failed');
  if(document.querySelector('aside').hidden)document.querySelector('[aria-label="Toggle navigation"]').click(); await pause();
  [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Repositories')).click(); await pause();
  document.querySelector('.codex-panel [aria-label="Set up Codex"]').click(); await pause();
  dialog = document.querySelector('.provider-dialog');
  assert(dialog && dialog.textContent === firstContents, 'Both routes must open identical setup');
  [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Close').click(); await pause();
  assert(!document.querySelector('.shell').hasAttribute('inert'), 'Background not restored');
  document.querySelector('.codex-panel [aria-label="Set up Cursor"]').click(); await pause();
  dialog = document.querySelector('.provider-dialog');
  assert(dialog.querySelector('h2').textContent === 'Cursor setup' && dialog.textContent.includes('Cursor dashboard'), 'Cursor setup opened wrong provider');
  assert(!dialog.querySelector('[role=combobox]'), 'Unexpected provider picker');
  [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Close').click(); await pause();
  window.__repositoryProgress = 'save key '+zoom;
  const previousIPC = window.__TAURI_INTERNALS__;
  let savedKeys = 0, testProfiles = [], allowResume = true, chatgptSettings={defaultAccount:null,initialized:false,repositories:{}};
  const externalAccounts=[{id:'cursor:fixture',provider:'cursor',label:'Cursor fixture',connected:true,detail:''},{id:'claude:fixture',provider:'claude',label:'Claude fixture',connected:true,detail:''}];
  const externalSettings={defaultAccounts:{},repositories:{}};
  window.__TAURI_INTERNALS__ = {invoke: async (command,args) => {
    if (command === 'provider_setup_status') return [{tool:'codex',path:'/fixture/codex',error:null}];
    if (command === 'agent_profiles') return testProfiles;
    if (command === 'chatgpt_settings') return chatgptSettings;
    if (command === 'external_identity_snapshot') return {identities:externalAccounts,settings:externalSettings};
    if (command === 'external_identities') return externalAccounts;
    if (command === 'external_identity_settings') return externalSettings;
    if (command === 'default_external_identity'){externalSettings.defaultAccounts[args.provider]=args.account;return externalSettings;}
    if (command === 'assign_external_identity'){const accounts=externalSettings.repositories[args.provider]??={};if(args.inherit)delete accounts[args.repository];else accounts[args.repository]=args.account;return externalSettings;}
    if (command === 'assign_chatgpt_account') {if(args.repository){if(args.inherit)delete chatgptSettings.repositories[args.repository];else chatgptSettings.repositories[args.repository]=args.account;}else{chatgptSettings.defaultAccount=args.account;chatgptSettings.initialized=true;}return chatgptSettings;}
    if (command === 'begin_chatgpt_login') return 'subscription-test';
    if (command === 'poll_chatgpt_login') {const profile={id:'subscription-test',provider:'codex',subscription:true,label:'subscriber@example.test',plan:'plus'};if(!testProfiles.some(item=>item.id===profile.id))testProfiles.push(profile);chatgptSettings.defaultAccount=profile.id;chatgptSettings.initialized=true;return profile;}
    if (command === 'cancel_chatgpt_login') return null;
    if (command === 'github_auth_status') return {browserSignIn:false,githubCli:false};
    if (command === 'agent_resume_status') return {available:allowResume,reason:allowResume ? 'Continue this conversation' : 'The session file is unavailable.'};
    if (command === 'save_agent_profile') { savedKeys++; const profile = {id:'fixture-account-'+savedKeys,provider:args.provider,label:args.label}; testProfiles.push(profile); return profile; }
    throw Error('Unexpected test IPC: '+command);
  }};
  document.querySelector('.codex-panel [aria-label="Set up Codex"]').click(); await pause();
  let keyField = document.querySelector('.provider-dialog input[type=password]');
  const enterKey = value => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(keyField,value); keyField.dispatchEvent(new Event('input',{bubbles:true})); };
  enterKey('fixture-key-not-real'); await pause(); keyField.form.requestSubmit(); await pause();
  assert(document.querySelector('#key-added-title')?.textContent === 'API key added', 'Missing key-added confirmation');
  assert(!document.querySelector('.provider-dialog input[type=password]'), 'Key field remains exposed after saving');
  assert(document.activeElement.textContent === 'Close', 'Confirmation should focus Close');
  assert(savedKeys === 1, 'Saving submitted more than once');
  [...document.querySelectorAll('.provider-dialog button')].find(button=>button.textContent === 'Add another key').click(); await pause();
  keyField = document.querySelector('.provider-dialog input[type=password]');
  assert(keyField.value === '' && document.activeElement === keyField, 'Add another key must focus a cleared input');
  enterKey('second-fixture-key'); await pause(); keyField.form.requestSubmit(); await pause();
  assert(savedKeys === 2 && document.querySelector('#key-added-title'), 'Second save did not confirm');
  document.activeElement.click(); await pause();
  assert(!document.querySelector('.provider-dialog'), 'Confirmation Close did not close setup');
  window.__repositoryProgress = 'resume status '+zoom;
  testProfiles = [testProfiles[0], {id:'cursor-test',provider:'cursor',label:'Cursor test'}]; window.dispatchEvent(new Event('agent-configuration-changed')); await pause();
  const importedThreads = document.querySelectorAll('.codex-thread-list button.provider-codex');
  const archiveControl=document.querySelector('.codex-thread-list .conversation-list-tools .codex-archive');
  assert(archiveControl && archiveControl.compareDocumentPosition(importedThreads[0]) & Node.DOCUMENT_POSITION_FOLLOWING, 'Archived control must precede conversation cards');
  importedThreads[0].click(); await pause(); await pause();
  assert(document.querySelector('.codex-messages').textContent.includes('fixture response'), 'Imported history was not displayed');
  assert(document.querySelector('.codex-messages .agent-steps:not([open])') && document.querySelector('.codex-messages .agent-step pre')?.textContent.includes('Checking the source files'), 'Intermediate activity did not fold');
  const activity=document.querySelector('.codex-messages .agent-steps');activity.querySelector('summary').click();await pause();
  assert(activity.open && activity.querySelectorAll('.agent-step').length===2 && [...activity.querySelectorAll('.agent-step pre')].every(node=>node.getBoundingClientRect().height>0),'One click did not expand every intermediate update');
  assert(!document.querySelector('.chat-composer'), 'Imported history exposed a composer');
  allowResume = false; importedThreads[1].click(); await pause(); await pause();
  assert(!document.querySelector('.chat-composer'), 'Unavailable resume exposed an input');
  document.querySelector('.codex-thread-list button').click(); await pause();
  window.__repositoryProgress='ChatGPT identities '+zoom;
  window.dispatchEvent(new Event('show-identities'));await pause();await pause();
  assert(document.querySelector('.identities-page'), 'Identity page did not open');
  const identitySignInClass=document.querySelector('.identities-page .identity-sign-in-trigger')?.className;
  document.querySelector('.identities-page .add-identity > button').click();await pause();
  const signIn=[...document.querySelectorAll('.identity-sign-in button')].find(button=>button.textContent==='Sign in with ChatGPT');
  const signInStyle=signIn && ['display','padding','borderWidth','backgroundColor','fontSize','minHeight'].map(name=>getComputedStyle(signIn)[name]);
  assert(signIn,'ChatGPT sign-in missing from Identities');signIn.click();
  for(let wait=0;!document.querySelector('.identities-page .identity-list')?.textContent.includes('subscriber@example.test') && wait<50;wait++)await pause();
  assert(document.querySelector('.identities-page .identity-list').textContent.includes('Default'),'First subscription was not made default');
  const initialsInput=document.querySelector('.identities-page .identity-initials-editor');
  assert(initialsInput && initialsInput.closest('.identity-title') && !initialsInput.closest('.identity-card').querySelector(':scope > .identity-initials-editor'),'Initials editor must share the identity title row');
  assert(document.querySelector('.identities-page .identity-list .openai-logo'),'OpenAI identity logo missing');
  assert(document.querySelector('.identities-page .provider-identity-badge.cursor svg') && document.querySelector('.identities-page .provider-identity-badge.claude svg'),'Provider brand icons missing');
  const usageLink=[...document.querySelectorAll('.identities-page .identity-usage-link')].find(button=>button.textContent.includes('Cursor'));
  assert(usageLink,'Cursor usage link missing');
  const originalOpenExternal=api.openExternalUrl;let openedUsage='';api.openExternalUrl=async url=>{openedUsage=url;};usageLink.click();await pause();api.openExternalUrl=originalOpenExternal;
  assert(openedUsage==='https://cursor.com/dashboard/spending','Cursor usage link opened the wrong destination');
  assert(document.querySelectorAll('.identities-page .identity-list').length===1,'Identities should use a single list');
  for(let wait=0;![...document.querySelectorAll('.chatgpt-login button')].some(button=>button.textContent==='Done') && wait<50;wait++)await pause();
  [...document.querySelectorAll('.chatgpt-login button')].find(button=>button.textContent==='Done').click();await pause();
  document.querySelector('.identity-settings summary').click();await pause();
  document.querySelector('[aria-label="Default ChatGPT account"]').click();await pause();
  assert(document.querySelector('[role=listbox]').getBoundingClientRect().bottom<=innerHeight+1,'Default account menu overflows viewport');
  key(document.activeElement,'Escape');await pause();
  document.querySelector('[aria-label="Default Cursor account"]').click();await pause();
  document.querySelector('[role=listbox] [data-value="cursor:fixture"]').click();await pause();await pause();
  document.querySelector('[aria-label="Default Claude account"]').click();await pause();
  document.querySelector('[role=listbox] [data-value="claude:fixture"]').click();await pause();await pause();
  assert(externalSettings.defaultAccounts.cursor==='cursor:fixture' && externalSettings.defaultAccounts.claude==='claude:fixture','External identity defaults were not saved');
  if(document.querySelector('aside').hidden)document.querySelector('[aria-label="Toggle navigation"]').click();await pause();
  [...document.querySelectorAll('nav button')].find(button=>button.textContent.includes('Repositories')).click();await pause();

  window.__repositoryProgress='ChatGPT repository assignment '+zoom;
  assert(identitySignInClass && document.querySelector('.codex-panel .identity-sign-in-trigger')?.className===identitySignInClass,'Shared sign-in trigger missing');
  document.querySelector('.codex-panel .add-identity > button').click();await pause();
  const agentSignIn=[...document.querySelectorAll('.codex-panel .identity-sign-in button')].find(button=>button.textContent==='Sign in with ChatGPT');
  assert(agentSignIn && signInStyle.every((value,index)=>value===getComputedStyle(agentSignIn)[['display','padding','borderWidth','backgroundColor','fontSize','minHeight'][index]]),'Sign-in menu option styles differ between panes');
  agentSignIn.click();await pause();
  assert(document.querySelector('.chatgpt-login'),'Conversation sign-in did not open shared popup');
  key(document.activeElement,'Escape');await pause();
  selected().querySelector('.identity').click();await pause();
  assert(document.querySelector('.repository-accounts'),'Account panel missing');
  assert(document.querySelector('.repository-accounts [aria-label="Cursor account"]').textContent.includes('Cursor fixture') && document.querySelector('.repository-accounts [aria-label="Claude account"]').textContent.includes('Claude fixture'),'Repository did not inherit external defaults');
  assert(!selected().querySelector('.assign-chatgpt, .assign-external'),'Redundant account controls remain');
  document.querySelector('.repository-accounts [aria-label="ChatGPT account"]').click();await pause();
  let accountMenu=document.querySelector('[role=listbox]');
  assert(accountMenu && accountMenu.textContent.includes('subscriber@example.test') && !accountMenu.textContent.includes('Use default'),'Repository account options are incorrect');
  assert(accountMenu.getBoundingClientRect().bottom<=innerHeight+1,'Repository account menu overflows viewport');
  accountMenu.querySelector('[data-value=""]').click();await pause();await pause();
  assert(Object.values(chatgptSettings.repositories).includes(null),'Explicit no-account choice was not saved: '+JSON.stringify(chatgptSettings));
  document.querySelector('.repository-accounts [aria-label="ChatGPT account"]').click();await pause();
  document.querySelector('[role=listbox] [data-value="subscription-test"]').click();await pause();await pause();
  assert(Object.keys(chatgptSettings.repositories).length===0,'Selecting the default account did not restore inheritance');
  document.querySelector('.repository-accounts [aria-label="ChatGPT account"]').click();await pause();key(document.querySelector('[role=listbox]'),'Escape');await pause();
  assert(!document.querySelector('[role=listbox]'),'Escape did not dismiss account assignment');
  document.querySelector('.repository-accounts [aria-label="ChatGPT account"]').click();await pause();document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));await pause();
  assert(!document.querySelector('[role=listbox]'),'Outside click did not dismiss account assignment');
  document.querySelector('[aria-label="Close account settings"]').click();await pause();
  testProfiles=[];chatgptSettings={defaultAccount:null,initialized:false,repositories:{}};window.dispatchEvent(new Event('agent-configuration-changed'));await pause();
  if (previousIPC) window.__TAURI_INTERNALS__ = previousIPC; else delete window.__TAURI_INTERNALS__;
  results.push({ zoom, heightStable:true, selectionExclusive:true, dropdown:true, tray:true, agents:true, sharedSetup:true });
 }
 window.__repositoryCheck = { passed:true, results };
})().catch(error => window.__repositoryCheck = { passed:false, error:String(error) });
"""
window = Gtk.OffscreenWindow()
view = WebKit2.WebView()
view.set_size_request(int(sys.argv[1]), int(sys.argv[2]))
window.add(view)
window.show_all()
exit_code = 1
started = False
last_progress = "page load"

def checked(webview, result):
    global exit_code, last_progress
    try:
        raw = webview.evaluate_javascript_finish(result).to_string()
        if raw in ('undefined', 'null'):
            return
        data = json.loads(raw)
        if 'pending' in data:
            last_progress = data['pending']
            return
        print(json.dumps({'window':sys.argv[1:], **data}))
        exit_code = 0 if data['passed'] else 1
        Gtk.main_quit()
    except Exception as error:
        print(str(error), file=sys.stderr)
        Gtk.main_quit()

def poll():
    view.evaluate_javascript('JSON.stringify(window.__repositoryCheck || {pending:window.__repositoryProgress || "loading"})', -1, None, None, None, checked)
    return True

def script_started(webview, result):
    try:
        webview.evaluate_javascript_finish(result)
    except Exception as error:
        print("Script startup: " + str(error), file=sys.stderr)
        Gtk.main_quit()

def loaded(webview, event):
    global started
    if event == WebKit2.LoadEvent.FINISHED and not started:
        started = True
        webview.evaluate_javascript(script + "\nvoid 0;", -1, None, None, None, script_started)
        GLib.timeout_add(300, poll)

view.connect('load-changed', loaded)
view.load_uri('http://127.0.0.1:3000')
GLib.timeout_add_seconds(60, lambda: (Gtk.main_quit(), False)[1])
Gtk.main()
if exit_code: print("Stopped at: " + str(last_progress), file=sys.stderr)
sys.exit(exit_code)
