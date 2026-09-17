"""Exercise the real React repository controls in WebKitGTK against `npm run dev`.
Run: /usr/bin/python3 desktop/scripts/check-repository-ui.py [width height]
"""
import json
import subprocess
import sys
import gi

gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib

if len(sys.argv) == 1:
    for width, height in [(900, 620), (1100, 700), (1720, 1080), (2200, 700)]:
        subprocess.run([sys.executable, __file__, str(width), str(height)], check=True)
    sys.exit(0)

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
 await document.fonts.ready; await pause();
 const results = [];
 for (const zoom of [1, 1.4, 1.5]) {
  document.documentElement.style.setProperty('--ui-zoom', zoom);
  rows()[0].click(); await pause();
  const before = rows().map(row => row.getBoundingClientRect().height);
  rows()[1].click(); await pause();
  assert(rows().every((row, i) => Math.abs(row.getBoundingClientRect().height - before[i]) < 1), 'Selection changed card height: ' + JSON.stringify({before, after:rows().map(row => row.getBoundingClientRect().height), zoom}));
  const card = selected();
  const editor = card.querySelector('[aria-label="Open in VS Code"]');
  editor.focus(); await pause();
  key(editor, 'ArrowRight'); await pause();
  assert(chosen().length === 1 && chosen()[0].getAttribute('aria-label') === 'Open in Cursor', 'ArrowRight did not select Cursor exclusively');
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
  assert(from.querySelector('.account-badge'), 'Account badge is missing');
  identity.focus(); await pause();
  const nextName = from.nextElementSibling.querySelector('.row-name').textContent;
  key(from.querySelector('.identity'), 'ArrowDown'); await pause();
  assert(selected().querySelector('.row-name').textContent === nextName, 'Assign account interrupted list navigation');
  assert(!document.querySelector('[role=listbox]'), 'ArrowDown opened the account menu');
  rows()[0].click(); await pause();
  const assign = selected().querySelector('.identity');
  assign.click(); await pause();
  let menu = document.querySelector('[role=listbox]');
  assert(menu, 'Identity menu did not open');
  const rect = menu.getBoundingClientRect();
  assert(rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1, 'Dropdown outside viewport');
  key(menu, 'ArrowDown'); key(menu, 'Escape'); await pause();
  assert(!document.querySelector('[role=listbox]'), 'Escape did not close dropdown');
  assign.click(); await pause();
  menu = document.querySelector('[role=listbox]'); key(menu, 'ArrowDown'); key(menu, 'Enter'); await pause();
  assert(!document.querySelector('[role=listbox]'), 'Keyboard choice did not close dropdown');
  assign.click(); await pause();
  document.querySelector('.summary').dispatchEvent(new MouseEvent('mousedown', { bubbles:true })); await pause();
  assert(!document.querySelector('[role=listbox]'), 'Outside click did not close dropdown');
  card.click(); await pause();
  const rowRect = card.getBoundingClientRect(), tray = card.querySelector('.row-panel').getBoundingClientRect();
  const pane = document.querySelector('.repo-grid');
  assert(tray.top < rowRect.bottom && tray.bottom > rowRect.bottom, 'Tray does not overlap card bottom');
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
  for (const [label, choice] of [['Filter by owner', 'northstar'], ['Filter by visibility', 'Private'], ['Filter by local presence', 'Folder not linked']]) {
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
    const index = options.findIndex(option => option.textContent === choice);
    assert(index >= 0, `${label} missing ${choice}`);
    key(dropdown, 'Home'); await pause();
    for (let i=0; i<index; i++) key(dropdown, 'ArrowDown');
    await pause(); key(dropdown, 'Enter'); await pause();
  }
  assert(rows().length === 1 && rows()[0].textContent.includes('design-system'), 'Combined filters did not isolate expected repository');
  for (const label of ['Filter by owner', 'Filter by visibility', 'Filter by local presence']) {
    document.querySelector(`[aria-label="${label}"]`).click(); await pause(); document.querySelector('[role=option]').click(); await pause();
  }
  const sort = document.querySelector('[aria-label="Sort repositories"]');
  sort.click(); await pause();
  let sortMenu = document.querySelector('[role=listbox]');
  const sortBounds = sortMenu.getBoundingClientRect();
  assert(sortBounds.left >= -1 && sortBounds.right <= innerWidth + 1 && sortBounds.top >= -1 && sortBounds.bottom <= innerHeight + 1, 'Sort menu outside viewport');
  key(sortMenu, 'Escape'); await pause(); sort.click(); await pause();
  sortMenu = document.querySelector('[role=listbox]'); key(sortMenu, 'Home'); await pause(); key(sortMenu, 'ArrowDown'); await pause(); key(sortMenu, 'Enter'); await pause();
  assert(rows()[0].querySelector('.row-name').textContent === 'backend-api', 'Name sorting failed');
  sort.click(); await pause(); document.querySelector('[role=option]').click(); await pause();
  results.push({ zoom, heightStable:true, selectionExclusive:true, dropdown:true, tray:true });
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

def checked(webview, result):
    global exit_code
    try:
        raw = webview.evaluate_javascript_finish(result).to_string()
        if raw in ('undefined', 'null'):
            return
        data = json.loads(raw)
        print(json.dumps({'window':sys.argv[1:], **data}))
        exit_code = 0 if data['passed'] else 1
        Gtk.main_quit()
    except Exception as error:
        print(str(error), file=sys.stderr)
        Gtk.main_quit()

def poll():
    view.evaluate_javascript('JSON.stringify(window.__repositoryCheck)', -1, None, None, None, checked)
    return True

def loaded(webview, event):
    global started
    if event == WebKit2.LoadEvent.FINISHED and not started:
        started = True
        webview.evaluate_javascript(script, -1, None, None, None, None)
        GLib.timeout_add(300, poll)

view.connect('load-changed', loaded)
view.load_uri('http://127.0.0.1:3000')
GLib.timeout_add_seconds(35, lambda: (Gtk.main_quit(), False)[1])
Gtk.main()
sys.exit(exit_code)
