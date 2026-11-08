# Desktop UI conventions

- Use `src/components/Select.tsx` for every dropdown that selects a value. Do not introduce native `<select>` or `<datalist>` controls: their OS-rendered options do not reliably follow application zoom.
- Render menus inside the zoomed document. Portal positioning must account for `--ui-zoom`; do not portal outside the zoomed body or use fixed unscaled option text.
- Verify new dropdowns at 100%, 140%, and 150% zoom, including keyboard selection, Escape, outside-click dismissal, and placement near viewport edges.
- Dashboard panes must fill the available window area and scroll internally. Avoid fixed maximum heights on conversation content; preserve the adjustable project/conversation split and usable narrow-window layouts.

`npm run check:dropdowns` runs during every production build and rejects native dropdown elements in the UI source.

For dashboard sizing changes, run `/usr/bin/python3 desktop/scripts/check-viewport.py` on Linux with GTK/WebKitGTK installed. Check that the panes fill the viewport, not merely that they do not overflow. WebKit and Chromium differ in how CSS zoom interacts with viewport-unit lengths: anchor the dashboard with fixed `inset: 0` rather than dividing its height by the zoom factor.

## General pane layout rule

All current and future panes must respond to live window resizing, not just the
default window size. Anchor the dashboard to the window edges; distribute spare
space with flexible grid/flex tracks. Set `min-width: 0` and `min-height: 0` on
nested tracks and panes, wrap labels, paths, messages, and controls, and keep
scrolling inside the pane that owns the content. Never hide project details
to solve width overflow. Reflow dense cards and stack subpanes when needed.
Keep practical pane minimums and the native window minimum (900 × 620), while
allowing all remaining space to grow dynamically. Do not solve layout issues by
increasing the default window size or imposing fixed content maximum heights.
Verify multiple window sizes, including the native minimum and wide/short windows,
at 100%, 140%, and 150% zoom; check both pane bounds and viewport filling.

Conversation providers are opt-in. Only query providers the user has configured
and checked. Persist configuration/filter choices, label configuration separately
from checkbox visibility, and show setup instructions for one chosen provider.

Project selection must have one state owner shared by mouse and keyboard.
Hover styling must never expand an unselected card or mimic selection. Base card
wrapping on the project list’s own named container, not an ancestor’s width;
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

- Each project uses a whole email mailbox; do not add configurable root boundaries. New automation folders use mailbox-wide paths; preserve legacy root-relative rules through compatibility resolution. Sender identities share the mailbox SMTP login and must be configured before use. Condition UI merges project trees, shows coverage (including unverified configured accounts), ignores unconfigured projects, and never adds a project selector at trigger level. Creating missing folders across projects requires an explicit in-app action.

- Email folder deletion is immediate, with undo/redo instead of confirmation. Keep empty/unassigned/leaf and INBOX protections. Folder history covers actual successful mutations, including partially failed batches; never undo folders that predated a copy. Preserve native text-input undo.
- Batch mailbox folder mutations in one authenticated session; avoid reconnecting/listing per child. Share status polling per project and keep unrelated projects independent.

- Render email HTML only after sanitizing it in an opaque-origin sandbox. Sender scripts/forms/frames and remote media remain blocked by default; any trusted sizing/link bridge needs a fresh nonce, strict CSP and frame/token validation. Never grant email frames same-origin access or native IPC, and validate external link protocols on both sides.
- Folder counts must use authoritative STATUS MESSAGES/UNSEEN attributes (imap 2.4 forwards them through its unsolicited channel); never display its default returned Mailbox zeros as real counts. Keep count scans from blocking interactive mail reads, after taking a coherent config/credential snapshot.

- Use consistent functional ordering for standard mail folders and a shared remembered first-seen order for custom folder names; do not alphabetize them. Display folder structure independently of slow per-folder counts and reuse/coalesce read-only discovery snapshots. Keep folder containers isolated from sidebar navigation styles. Reply controls must remain reachable independently of long message content, including the minimum window at 140/150% zoom.
- Custom tooltips must follow live title changes while hovered/focused and must not restore an obsolete title after the control changes state.

- Email product boundary: delegate provider-level email/account management (account
  security, billing, domains and authorized sender administration) to the provider
  web UI. Cerberus prioritizes automation, cross-project folder organization and
  synchronization of folder structures and rules. Basic mail reading/replying is
  secondary. Webmail links use the default browser session; never forward IMAP,
  SMTP, Bridge passwords or API tokens, or claim browser account authentication.

- Sender identity names are local, case-insensitive project mappings,
  independent of provider display names/IDs. Suggest names across projects, enforce
  per-project uniqueness, preserve them through provider refresh, and fail a
  missing requested name instead of falling back to another sender. Never copy
  another project's sender address/credentials when reusing its name.
- Respect provider creation namespaces (Proton custom folders belong under Folders).
  Reveal a newly created folder by selecting it and expanding ancestors. Do not
  scroll unrelated dialogs or their ancestors when refreshing background trees.

- Tree context menus must use a zoom-aware floating body portal, never inline rows.
  Folder mutations should preview pending rows and apply batch snapshots promptly;
  keep navigation responsive and roll back failed previews. Never hide assigned
  receipt folders from mailbox browsing or allow their records to be moved away.
  Keep sender field names/order/heights consistent (Email address, Identity name,
  Display name), separate from sign-in and connection fields.

- Sidebar geometry belongs to the shared shell. Do not set its width, padding or
  decoration sizing through page-specific selectors. Keep page switches stable;
  responsive width changes may depend on the window size only. Viewport checks
  must compare the sidebar across Projects, Identities, Agents, Automation and Email.


## Responsiveness and caching

Never run unnecessary work on the UI thread. Native IPC commands that read files,
wait for locks, query credentials, run Git/other processes or access the network
must be async and dispatch blocking work to spawn_blocking (clone owned state
before dispatch). Rendering and interaction handlers must not perform synchronous
I/O or repeat expensive parsing/scans. Retain expensive page views and reusable
bounded session data, render cached results immediately, and revalidate in the
background. Coalesce reads and parallelize independent pane loads; explicit
refresh and mutation invalidation must supersede stale requests. Suspend hidden
page polling/shortcuts; do not discard drafts, selection or scroll on navigation.
Keep mailbox content transient in memory, never localStorage or a local mail DB;
never cache credentials. Test navigation with delayed backends, stale/failed
reads, mutation invalidation, draft retention and hidden-page keyboard isolation.

## Development server ownership

Tauri starts Vite through beforeDevCommand on port 3000. Reuse an existing
project dev server for browser/WebKit checks; never leave a standalone server
started for tests running after the checks. Track the exact process/group you
start and stop it in cleanup, including failures. Do not kill another project’s
server, silently change ports, or run standalone Vite alongside `npm run tauri dev`.
If port 3000 is occupied, identify its owner before taking action.

- Feedback names are user-facing project names, not routing syntax. Hide internal
  label prefixes in controls and summaries, preserve stored legacy/API mappings,
  and let scoped tools resolve them. Default new feedback names to the project
  name and retain the saved name across project renames. Agents must not ask
  users to supply internal label syntax.

- Preserve feedback name capitalization in defaults, storage, display and agent
  instructions. Case folding is only for comparison, never normalization.

- Changing a feedback name must migrate its existing GitHub issues before saving
  the new mapping. Preserve issue IDs, comments, states, other labels and retry
  receipts. Journal interrupted migrations, expose their destination on reopening
  settings, and block issue operations until Save completes the migration.

- Before a feedback-label migration, check the destination for open and closed
  issues. If occupied, require an explicit acquisition decision before any
  migration/settings write. Default to choosing a different name; focus the name
  input on retry. A configured other project’s queue is never acquirable.

- Project cards keep their natural content height and never shrink inside the
  scrolling list. Group names, identities and service badges so they can wrap;
  reflow branch status using the project list's named container. Verify that
  sibling groups do not overlap at narrow widths and 100/140/150% zoom.
- Use distinct navigation imagery: contact card for Identities, bot for Agents,
  tickets for Feedback. The project tray has no redundant Agent/chat action.
  Keep it translucent when idle and opaque on hover or keyboard navigation.
- Manual automation defaults must preserve the current project while async
  eligibility checks are pending; only choose another project after establishing
  that the current one is ineligible. Preserve explicit dialog choices.

- Stack field labels and text inputs with an explicit gap (use stacked-input-field)
  so focus outlines cannot overlap labels. Verify focused fields, not only idle
  fields, at 100/140/150% zoom. Do not rely on inline label flow for text inputs.

- The project Agent/Script pane supports interactive Codex conversations, including
  resumable IDE history. Other providers remain view-only. Keep new/resume/stop,
  account binding and unavailable-session fallback explicit; never silently turn
  a follow-up into another session or bill a different account. Hide/suspend the
  composer on inactive pages and preserve drafts across navigation.
- Keep Codex runtime tool guidance separate from authored user messages. While a
  conversation runs, present checkpoint/status responses without command traces
  or edit details; preserve the full trace for collapsed inspection afterward.

- Conversation scrolling must distinguish user gestures from layout-generated
  scroll events. Observe content resizing as well as pane resizing; completion
  must preserve bottom-follow or an older reading position. Scope selected-card
  scrolling to its owning list rather than scrolling ancestor page containers.

- VS Code/Cerberus Codex continuation must share the native conversation ID and
  history index while keeping account credentials separate. Do not reject a
  history format without checking runtime support or fork/copy active history
  silently. Preserve paginated lineage, exact rollout paths and repository checks.
- Agent start/completion hints must work independently of mounted conversation
  panes. Coalesce events, query only enabled providers, and avoid filesystem/DB
  feedback loops from history reads. Keep periodic reconciliation as a fallback.
