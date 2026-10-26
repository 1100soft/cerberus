# Desktop UI conventions

- Use `src/components/Select.tsx` for every dropdown that selects a value. Do not introduce native `<select>` or `<datalist>` controls: their OS-rendered options do not reliably follow application zoom.
- Render menus inside the zoomed document. Portal positioning must account for `--ui-zoom`; do not portal outside the zoomed body or use fixed unscaled option text.
- Verify new dropdowns at 100%, 140%, and 150% zoom, including keyboard selection, Escape, outside-click dismissal, and placement near viewport edges.
- Dashboard panes must fill the available window area and scroll internally. Avoid fixed maximum heights on conversation content; preserve the adjustable repository/conversation split and usable narrow-window layouts.

`npm run check:dropdowns` runs during every production build and rejects native dropdown elements in the UI source.

For dashboard sizing changes, run `/usr/bin/python3 desktop/scripts/check-viewport.py` on Linux with GTK/WebKitGTK installed. Check that the panes fill the viewport, not merely that they do not overflow. WebKit and Chromium differ in how CSS zoom interacts with viewport-unit lengths: anchor the dashboard with fixed `inset: 0` rather than dividing its height by the zoom factor.

## General pane layout rule

All current and future panes must respond to live window resizing, not just the
default window size. Anchor the dashboard to the window edges; distribute spare
space with flexible grid/flex tracks. Set `min-width: 0` and `min-height: 0` on
nested tracks and panes, wrap labels, paths, messages, and controls, and keep
scrolling inside the pane that owns the content. Never hide repository details
to solve width overflow. Reflow dense cards and stack subpanes when needed.
Keep practical pane minimums and the native window minimum (900 × 620), while
allowing all remaining space to grow dynamically. Do not solve layout issues by
increasing the default window size or imposing fixed content maximum heights.
Verify multiple window sizes, including the native minimum and wide/short windows,
at 100%, 140%, and 150% zoom; check both pane bounds and viewport filling.

Conversation providers are opt-in. Only query providers the user has configured
and checked. Persist configuration/filter choices, label configuration separately
from checkbox visibility, and show setup instructions for one chosen provider.

Repository selection must have one state owner shared by mouse and keyboard.
Hover styling must never expand an unselected card or mimic selection. Base card
wrapping on the repository list’s own named container, not an ancestor’s width;
keep the main fields on one row whenever that container has enough room.
Provider installation must show the command plan and require explicit in-app
approval before executing. Use fixed provider commands and no privilege elevation.

- Never add placeholder options to selection menus. Every option must represent a real selectable value or behavior (such as None, Automatic, or Provider default). When no choices exist, show an empty-state message and disable or omit the selector. Text-input hints are allowed.
- A displayed selection must match the value used by actions and validation. Initialize required selections to the first available option, preserving valid user choices when options change. Never display a first-option fallback while leaving the actual value empty or invalid.

- Automation errors must never disable an automation. Preserve its enabled setting after failures, migration, and clearing pending state. Only an explicit user disable action may turn it off. Opening its log acknowledges the list error indicator without deleting error details.

- Error acknowledgement is independent of execution state: another context may
  still be running when a run fails. An open automation log must acknowledge new
  unread errors; after closing, new failures become unread again. Retained blocked
  rows must use neutral styling once acknowledged, keeping their log/retry details.

- Codex model catalogs are advisory, not proof of inference access. Never restore a model rejected explicitly for ChatGPT account support merely because the runtime executable changed. Keep restrictions account-scoped with a bounded lifetime; keep other runtime-specific errors scoped to their runtime. Regression checks must cover Luna rejection surviving upgrades while Sol remains selectable. Never introduce a permanent model-name blacklist or add models from conversation history.

- Keep branch cards compact: icons stay inline with names; cleanup metadata uses a small top-right icon/time indicator with detailed dates in help text, never a dedicated row. Prefer compact controls and metadata over extra rows throughout the UI.

- Local filesystem path controls must offer an OS browse dialog (file or folder as appropriate). New file-path fields use LocalFilePicker rather than requiring users to type paths. Explain whether selected files are copied into app storage or remain external references.

- Keep button text minimal: use short contextual labels (for example Import) and icons for obvious secondary actions, with accessible labels/tooltips. Avoid explaining ordinary Save/import behavior in the UI.

- Mailbox folder selection must discover the server hierarchy and use a tree, including nonselectable namespace parents and server delimiters. Create folders by selecting a parent and entering a leaf name; never require manual IMAP path entry. Configured mailboxes activate automatically; automation rules control processing. Use one Save action that verifies access and leaves failures visible.

- Feedback automation folders are relative to each selected repository's configured email root. Condition UI merges repository trees, shows coverage (including unverified configured accounts), ignores unconfigured repositories, and never adds a repository selector at trigger level. Creating missing folders across repositories requires an explicit in-app action.
