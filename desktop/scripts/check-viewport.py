"""Regression check for viewport filling in Tauri's Linux WebKit engine.
Run with /usr/bin/python3 desktop/scripts/check-viewport.py (GTK/WebKitGTK required).
An offscreen window exercises the real stylesheet without opening a desktop window.
"""
import json
from pathlib import Path
import sys
import subprocess
import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib

if len(sys.argv) == 1:
    for width, height in [(900, 620), (1100, 700), (1720, 1080), (2200, 700)]:
        subprocess.run([sys.executable, __file__, str(width), str(height)], check=True)
    sys.exit(0)

css = (Path(__file__).resolve().parents[1] / "src/styles.css").read_text()
css = "\n".join(line for line in css.splitlines() if not line.startswith("@import"))
html = """<div class="shell"><aside><div class="brand">GitCerberus</div><nav>Repositories</nav></aside><main>
<section class="toolbar">Repository controls</section><div class="summary">Repositories</div>
<div class="repository-workspace"><div class="repository-list-column"><div class="repo-list-controls">Filters and sort</div><section class="repo-grid">Repositories</section></div>
<section class="history-panel">Commit history</section></div>
<div class="pane-divider"></div><section class="codex-panel"><header>Conversations</header>
<div class="codex-body"><div class="provider-controls">Codex · Cursor</div><div class="codex-conversations"><div class="codex-thread-list"><button>Conversation with a long title that should wrap</button></div><div class="codex-messages"><article class="codex-message user"><div>A prompt with enough text to exercise wrapping within the available pane width.</div></article></div></div></div></section></main></div>"""
script = """JSON.stringify([false, true].flatMap(open => [0.75, 1, 1.4, 1.5].map(zoom => {
 document.querySelector('.shell').classList.toggle('sidebar-open', open);
 document.querySelector('aside').hidden = !open;
 document.documentElement.style.setProperty('--ui-zoom', zoom);
 const main = document.querySelector('main');
 const shell = document.querySelector('.shell').getBoundingClientRect();
 const ai = document.querySelector('.codex-panel').getBoundingClientRect();
 const panes = [...document.querySelectorAll('.repository-workspace, .repo-grid, .history-panel, .codex-panel, .codex-thread-list, .codex-messages')].map(node => { const r = node.getBoundingClientRect(); return {name: node.className, left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height, overflow:node.scrollWidth-node.clientWidth}; });
 return {open, zoom, width:innerWidth, panes, viewport: innerHeight, shell: shell.height,
   bottomGap: innerHeight - ai.bottom,
   expectedGap: parseFloat(getComputedStyle(main).paddingBottom) * zoom};
})))"""
window = Gtk.OffscreenWindow()
view = WebKit2.WebView()
view.set_size_request(int(sys.argv[1]), int(sys.argv[2]))
window.add(view)
window.show_all()
exit_code = 1

def finished(webview, result):
    global exit_code
    try:
        rows = json.loads(webview.evaluate_javascript_finish(result).to_string())
        for row in rows:
            for pane in row["panes"]:
                assert pane["left"] >= 0 and pane["right"] <= row["width"] + 2, (row["zoom"], pane)
                assert pane["top"] >= 0 and pane["bottom"] <= row["viewport"] + 2, (row["zoom"], pane)
                assert pane["width"] > 30 and pane["height"] > 20, (row["zoom"], pane)
                assert pane["overflow"] <= 2, (row["zoom"], pane)
            assert abs(row["shell"] - row["viewport"]) < 2, row
            assert abs(row["bottomGap"] - row["expectedGap"]) < 2, row
        print(json.dumps({"passed": True, "engine": "WebKitGTK", "window": sys.argv[1:], "zooms": [row["zoom"] for row in rows]}))
        exit_code = 0
    except Exception as error:
        print(str(error), file=sys.stderr)
    Gtk.main_quit()

def loaded(webview, event):
    if event == WebKit2.LoadEvent.FINISHED:
        webview.evaluate_javascript(script, -1, None, None, None, finished)

view.connect("load-changed", loaded)
view.load_html("<style>" + css + "</style>" + html, "file:///")
GLib.timeout_add_seconds(15, lambda: (Gtk.main_quit(), False)[1])
Gtk.main()
sys.exit(exit_code)
