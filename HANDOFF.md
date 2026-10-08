# GitCerberus handoff — 2026-10-07

## First read

- Repository: `/home/eh930/project/apps/cerberus`; branch `wip`.
- This document includes the automation triggers, live logs, provider permissions, credentials, model catalog, copy controls, and worktree-aware Git operations checkpoint below. Review current Git status before continuing; repository state is authoritative.
- Current docs: [README](README.md), [documentation index](docs/README.md), [desktop architecture](desktop/docs/architecture.md), [desktop operations](desktop/docs/agent-operations.md), and [UI conventions](desktop/AGENTS.md).
- The 2026-09-27 handoff is in [docs/archive/HANDOFF-2026-09-27.md](docs/archive/HANDOFF-2026-09-27.md). Older notes remain in `docs/archive/HANDOFF-previous.md`.

## Product direction

The app is a repository-first viewer. The Agent pane lists Codex, Cursor, Copilot, and Claude conversations when each provider is enabled and offers editor handoff. Identity owns account connection and usage. `AgentsPanel` owns provider setup. Legacy composer and runner files still exist and are not shown in the Agent pane.

| Area | Files |
| --- | --- |
| Repository list and working mark | `desktop/src/App.tsx`, `components/RepositoryCard.tsx` |
| Conversations | `components/CodexHistory.tsx`, `lib/conversationCache.ts` |
| Identity and premium quota | `components/IdentitiesPanel.tsx`, `components/CopilotQuota.tsx` |
| Codex order | `desktop/src-tauri/src/codex.rs` (`conversation_updated_at`) |
| Cursor history and one reused bridge | `cursor_editor.rs`, `cursor.rs` |
| Cursor completion notification | `cursor_notifications.rs` |
| Copilot editor chats | `copilot_history.rs` |
| Copilot quota startup | `copilot.rs` |

## This session

- The working spinner in the Agent pane uses that conversation's provider color. The repository row uses the app accent, `--accent-codex`.
- Cursor's system notification for a finished agent (`Done • …`, `Agent complete`, or `Cloud agent complete`) is watched on the Linux session bus. The event `cursor-agent-settled` clears the spinner without waiting for the next poll. A checkpoint more than five seconds after that notification is treated as a new run. The composer database can otherwise keep an unfinished checkpoint for up to three minutes.
- Codex conversation order uses the last message or task boundary. A later `thread_settings_applied` rewrite was sorting idle conversations above newer work. `updatedMillis` still compares second and millisecond timestamps as milliseconds.
- Copilot usage stays on the Identity card. Only a finite Premium requests budget is shown. Copilot chats are read from the editor's `chatSessions` JSONL for that folder.
- Listing Cursor agents used to start a bridge on every refresh and kill only the shell wrapper, leaving the Node process behind. The app now launches Node directly, keeps one bridge, and asks the kernel to stop it when the app exits. About a thousand leftover bridge processes were stopped during this session.

## Verification

Passed for this checkpoint: `cargo test` (81 passed, 3 live/provider tests ignored), `npm run build`, and the WebKit viewport, card reorder, handoff, and Automation UI scripts. `cargo fmt --check` still reports large formatting differences across pre-existing compact Rust sources, so the checkpoint preserves the repository's current Rust style. Production bundle size warnings remain.

## Constraints that still apply

- Conversation providers are opt-in. Installers show the command plan and wait for in-app approval. No privilege elevation and no paid inference as a diagnostic.
- Use `src/components/Select.tsx` for dropdowns.
- Cursor editor state and Copilot chat files are read-only.
- A connected GitHub identity is enough for Copilot. Do not demand another sign-in, and do not point the SDK at a random `copilot` binary.
- UI tests expect four agent cards, Codex and Cursor setup copy, and Copilot/Claude conversation checkboxes that start unchecked. Do not auto-enable Copilot because a GitHub identity exists.

## Automation (current)

See [automation documentation](desktop/docs/saved-prompts.md). The Automation page creates and edits named Agent and Shell jobs. Manual jobs choose a repository at run time; interval and file-change jobs select one, several, or all linked local repositories. File-change and changed-line threshold conditions receive immediate native filesystem notifications, excluding `.git`, wait for a configurable debounce (default 300 seconds), and check active Codex/Cursor and in-app conversations before running. `desktop/src-tauri/src/repository_watcher.rs` owns the native watchers and emits events; `desktop/src-tauri/src/repository_changes.rs` counts added and deleted lines against `HEAD` (including untracked files) for repository cards and threshold checks; `desktop/src/lib/savedPrompts.ts` holds pending changes and schedules runs. The scheduler exists only while the app is running. Repository, Automation, and Identity cards share whole-card drag reordering (`desktop/src/lib/cardReorder.ts`) with visible before/after indicators. Repository order persists in the database, while Automation and Identity order persist in localStorage. Conversation history stays ordered by latest activity.

Shell runs open a read-only live terminal and stream stdout/stderr through a Tauri channel. Every executed repository gets a JSON log in the app data directory under `automation-logs/<automation-id>/<repository-id>/<run-id>.json`. Agent logs include the final response and available activity. The unified detail dialog lists and reads files through `desktop/src-tauri/src/automation_logs.rs`; it highlights shell commands and agent code blocks. UI and output listeners live in `desktop/src/components/AutomationLogDialog.tsx` and `desktop/src/lib/automationOutput.ts`. `desktop/scripts/check-saved-prompts.py` exercises save/edit, live terminal, log viewing, and file debounce in WebKit. Rust tests cover file changes, log path scoping, and shell output streams. The full Rust suite passed during this checkpoint.

## Latest automation and repository UI work

Repository cards are draggable across their full surface, including when a different sort is active; a drop changes to manual order. Repository changed-line counts are fetched in one batch and unchanged repository snapshots do not trigger React updates. The Automation page now supports a commit trigger with branch patterns and optional exclusions and Notification jobs. The in-app notification center stores recent run start, completion, failure, and custom notification events locally. Repository cards show an automation activity indicator while a job targets them. See `desktop/docs/saved-prompts.md` for trigger behavior.

Automation and Identity cards now drag from their full surface. Clicking an Automation card opens one detail dialog with equal script/prompt and log panes; live stderr is highlighted inline. Triggered custom notifications include the repository name. UI fixtures: `/usr/bin/python3 desktop/scripts/check-card-reorder.py`, `/usr/bin/python3 desktop/scripts/check-saved-prompts.py`, and `/usr/bin/python3 desktop/scripts/check-viewport.py`.

## Handoff automations

The Automation dialog now has a Handoff condition with one incoming name and an Emit field for outgoing names. The runner keeps the saved user prompt unchanged and prepends exact file instructions only to the dispatched agent prompt. Shell jobs use handoff environment variables. Native queue operations live in `desktop/src-tauri/src/handoffs.rs`: per-repository Git metadata storage, unique run files, atomic claim by rename, cleanup after the triggered run, and 30-minute cleanup of interrupted claims without replay. The scheduler in `desktop/src/lib/savedPrompts.ts` checks pending handoffs every two seconds while running. Tests: `cargo test --lib handoffs::tests` in `desktop/src-tauri`, and `/usr/bin/python3 desktop/scripts/check-handoffs.py` with Vite on port 3000. See `desktop/docs/saved-prompts.md` for lifecycle details.

The Handoff name controls now share searchable suggestions from currently configured trigger and emission names. Emit is below the action field. The Automation page warns about unmatched names per repository. The handoff help popover explains that prompts may refer to the payload as “the handoff”; exact paths are added by the app.

## Automation follow-up — 2026-10-03

This checkpoint includes the implementation since commit `12fee19` (`Add automation workflows and checkpoint prompt`), including the new `desktop/scripts/check-ci-automation.py` fixture. Review `git status --short` before continuing. The older Automation paragraph above describes the checkpoint and is superseded by [current Automation documentation](desktop/docs/saved-prompts.md) for condition behavior.

Recent user requests added CI pass/fail, push, and pull request triggers; a branch filter for all conditions; multiple compatible conditions that must all be observed in the same repository; Idle time as an independent condition; and Codex model and reasoning effort controls. Existing one-trigger jobs still load through `automationConditions()`. New jobs save a `conditions` array. Commit, CI pass, and CI fail exclude each other. The scheduler records pending condition events per job and repository, checks branch patterns, and requires matching commit SHAs when push and CI are combined. GitHub Actions runs and repository events are polled with the assigned GitHub identity. CI run IDs/attempts and repository event IDs are remembered locally. Pending composite condition sets live in memory and reset after dispatch or editing; they do not survive an app restart. GitHub event polling is subject to GitHub's own delivery latency. Live GitHub delivery was not exercised in this follow-up; the WebKit fixtures mock it.

The Automation dialog now has the name in its header and a labeled row of removable condition chips. Adding a condition uses a compact + menu. Parameterized conditions show their current value on the chip and open a temporary modal for editing; the main form is inert until Done, Enter, or Escape closes the modal, and focus returns to the chip. The repository picker and Branch selector share the available row equally and wrap when needed. Repository scope help is concise and appears only inside the expanded picker. The branch selector defaults to `*`; it suggests branch sets from saved automations. Codex Agent automations can choose a catalog model and supported reasoning effort. Cursor, Claude, and Copilot automation runs still use their provider defaults because their app adapters do not expose catalog-backed model selection.

Implementation entry points: `desktop/src/components/SavedPromptsPanel.tsx` and `desktop/src/styles.css` for the dialog; `desktop/src/lib/savedPrompts.ts` for persistence and scheduling; `desktop/src/lib/handoffNames.ts` for combined handoff conditions; `desktop/src/lib/api.ts`, `desktop/src-tauri/src/github.rs`, and `desktop/src-tauri/src/lib.rs` for GitHub events. UI conventions are in `desktop/AGENTS.md`, especially the requirement to use `Select.tsx` for dropdowns and verify zoom behavior.

Verification completed during this follow-up: `npm run build`, `cargo check`, `/usr/bin/python3 scripts/check-ci-automation.py`, `/usr/bin/python3 scripts/check-saved-prompts.py`, `/usr/bin/python3 scripts/check-handoffs.py`, `/usr/bin/python3 scripts/check-viewport.py`, and `git diff --check`. Run the Python UI scripts from `desktop/` with Vite serving on port 3000. The viewport script passed at 900×620, 1100×700, 1720×1080, and 2200×700 across 75%, 100%, 140%, and 150% zoom. The test scripts' mocked GitHub events and agent execution do not establish live provider delivery. Normal Vite bundle-size warnings and pre-existing Rust dead-code warnings remain.

## Automation dialog refinement — 2026-10-03

Preserved the Automation follow-up above. New automation and prompt-import dialogs now start without a condition; Manual is exclusive in both the add menu and handler, hides repository and branch controls, and saves unrestricted branch scope. Draft starts hidden on create/edit, with the Draft with AI feature button toggling the pane and giving the action editor the full width while hidden. Parameter dialogs accept Enter as well as Escape and Done; an open handoff suggestion consumes its first Enter. Branch suggestions distinguish “All except” sets and restore the checkbox. Automation page height is constrained to the available main area and the list scrolls internally.

Validation: production build, saved-prompt workflow fixture (including Enter and Manual exclusivity), CI automation fixture (including exclusion suggestions and 30-card scrolling at 100/140/150% zoom), viewport fixture, and diff whitespace check. Existing bundle warnings remain. WebKitGTK occasionally printed a heap-cleanup warning after reporting a passing fixture; no assertion failure accompanied that cleanup warning.

## Automation action context and layout — 2026-10-03

Model/reasoning controls are inline with the execution agent, with a catalog refresh button and preservation of an existing saved model while loading. Agent, Shell, and Notification action text and undo histories are separate. The Draft with AI feature button sits above the editor with visible quota guidance. `InfoPopover.tsx` provides zoom-aware, viewport-constrained help with Escape/outside dismissal; handoff and shell context help use it. Notifications now keep outgoing handoff names and publish their message as each payload using a scoped create-new native write and the existing queue lifecycle.

Shell runs receive repository ID/name/path, branch/SHA, automation/run metadata, conditions, CI URL/conclusion, and existing handoff paths through `CERBERUS_` environment variables. Triggered commit, composite event, and CI branch/SHA are preserved; otherwise the native runner reads current Git state. All inherited `CERBERUS_` variables are cleared before setting the current run. Context never interpolates script text or changes the checkout.

Local model diagnosis: the saved Codex runtime was `/usr/local/bin/codex` (0.154.0), whose account catalog lacked GPT-6 Sol and GPT-6.1 Sol. The installed VS Code extension runtime is 0.160.0. At the user's request to synchronize, the existing app setting `/home/eh930/.local/share/dev.gitcerberus.app/codex-executable.txt` now points to `/home/eh930/.vscode/extensions/openai.chatgpt-26.930.31730-linux-x64/bin/linux-x86_64/codex`. This setting is outside the repository. Its live `model/list` under the Cerberus account home returned `gpt-6.1-sol`, `gpt-6-sol`, Astra, Luna, and the existing older models. No inference or installation was used. If that extension directory is later removed, update the executable in Advanced settings; explicit overrides remain authoritative. Official documentation lists GPT-6.1 Sol for both CLI and IDE, subject to account/client rollout.

Validation: build, saved-prompt UI (independent text, quota guidance, popover zoom/escape, notification handoff payload), CI UI (shell event context), handoff UI, viewport matrix, and native suite (84 passed, 3 ignored). An existing Cursor process-cleanup test failed on the first full-suite attempt, passed in isolation, and the subsequent full suite passed. WebKitGTK still occasionally prints its known heap-cleanup warning after a passing fixture. Native tests exercise literal shell context, checkout fallback, and scoped notification payload publishing.

## Checkpoint review — 2026-10-03

All pending Automation work is included in this checkpoint. Final review also restored two-second polling for handoff conditions when combined with another condition, reset all parameters and outgoing names when importing a new prompt, retained a 500-character branch-pattern field, and reset GitHub observation time when re-enabling a combined GitHub job. Notification edits no longer show the legacy conversation-target message. Desktop operations now lists the CI, handoff, and card-reorder checks.

Checkpoint validation: production build (dropdown convention, TypeScript, Vite), ChatGPT capability and conversation-display Node checks, saved-prompt/CI/handoff/card-reorder WebKit checks, the four-size viewport matrix, `cargo check`, full `cargo test -- --test-threads=1` (84 passed, 3 live tests ignored), and whitespace review. No credential-pattern matches or generated artifacts were found in the pending changes. `cargo fmt --check` does not pass: the archived HEAD baseline also fails with extensive compact-source formatting differences (267 diff sections versus 268 at this checkpoint). Existing Rust style is preserved rather than applying a repository-wide reformat. Normal bundle-size and Rust dead-code warnings remain.


## CI monitoring reliability follow-up — 2026-10-04

The user's saved monitoring notices contained “Could not reach GitHub” for Cerberus, Mountlet, 1100, and InDEx, with roughly 30-second spacing matching the old request timeout. These were monitoring transport errors, not workflow failures. The old code discarded the underlying error cause and sent an alert per repository. The exact historical transport cause cannot be reconstructed from those messages. A read-only live native diagnostic with each repository's assigned GitHub credential succeeded for all four: Cerberus/1100/InDEx returned no push-triggered workflow runs; Mountlet returned 100. No agent inference, workflow dispatch, or credential changes were used.

The native CI command now returns structured timeout/transport, authentication/access, rate-limit, server, and response errors; details preserve transport causes without request URLs. GitHub retry/reset headers are retained, and connection setup has a ten-second timeout within the existing thirty-second request timeout. Frontend polling uses four workers to check eligible repositories, keeps per-repository retry health, backs off to fifteen minutes, respects larger GitHub retry delays, and groups persistent outages into one “CI checks delayed” notice after three failures. Access failures get actionable grouped notices. These monitoring notices have message status and cannot trigger automations. Healthy repositories continue checking while another request fails or stalls. All-repository scopes still poll without a local push prerequisite, so remote/editor pushes remain detectable; non-GitHub or unassigned future repositories are skipped.

The CI WebKit fixture now tests a slow failed poll alongside a real matching failure in another repository, transient-alert suppression, grouped persistent notices, backoff, rate-limit delays, access guidance, recovery deduplication, and eligible live-scope filtering. Native tests cover error categories, retry headers, JSON error serialization, and timeout cause retention without request URLs. The opt-in `live_ci_catalog` test reads existing workflow catalogs without running automations.

Validation for this follow-up: production build (dropdown convention and TypeScript included), full `cargo test -- --test-threads=1` (86 passed, 4 opt-in tests ignored), CI recovery WebKit fixture, saved-prompt and handoff WebKit regressions, and `git diff --check`. The live catalog diagnostic was explicitly run and passed against all four assigned repositories, both before and after the native error-handling changes. Existing bundle-size and Rust dead-code warnings remain. Retry deadlines use response time so slow requests do not shorten GitHub's retry delay. These changes are included in this checkpoint.

## Desktop CI and release foundations (2026-10-04)

The only previous workflow was version-tag Debian publication; ordinary pushes
had no CI workflows. Added `.github/workflows/ci.yml` for all branch pushes, PRs,
and manual runs: actionlint, frontend build/logic/version checks, native test
compilation on Ubuntu/Windows/macOS, plus serial Rust and mocked WebKitGTK tests
on Linux. Added `desktop-packages.yml` for manual/version-tag artifact builds:
Linux x64/ARM64 Debian and AppImage, Windows x64 NSIS, macOS Intel/ARM64 DMG.
Read-only tokens, bounded jobs, caches, lockfiles, tag/app-version validation,
ad-hoc macOS signing, and artifact retention are configured. Existing APT tag
publication remains separate. No release/store publication or signing secrets
were added. Nothing pushed.

`docs/ci-and-releases.md` documents release verification, signing/protection needs,
Linux baseline/ARM runner constraints, and the mobile implementation sequence.
Android/iOS jobs are intentionally not enabled: generated projects, mobile entry,
tray/CLI adapters, and small-screen UI are missing. Local workflow actionlint
1.7.12, shell syntax, matching/mismatching release-tag checks, frontend production
build, Linux Tauri debug application build, and both logic scripts passed.
Rust tests: 86 passed, 4 opt-in ignored.
All five configured WebKit fixtures passed individually against the existing
local Vite server, including four viewport sizes and 75/100/140/150% zoom.
The Xvfb orchestration script could not run locally (Xvfb not installed); its CI
job explicitly installs it. Hosted Windows/macOS/ARM builds and installers await
GitHub execution. The CI-monitoring reliability changes are included in the same checkpoint.

Autosave branches (`autosave` and `autosave/**`, matching the existing
`autosave/eh930-GX5MRXL-0e0293a2/wip` branch) are excluded from CI push and PR
target triggers. Job guards additionally skip autosave PR sources and manual
CI/package dispatches. Version-tag publication is unchanged. Actionlint and
`git diff --check` passed after the filter change.

Checkpoint review: all 13 pending files belong to CI monitoring, desktop
workflows, autosave filtering, supporting checks, or documentation. The UI runner
now starts Vite directly so its exit trap stops the server process. Final build,
frontend logic checks, 86 native tests (4 ignored), actionlint, release version,
shell syntax, whitespace, and credential-pattern review passed. Earlier passing
Linux native build and WebKit regressions remain applicable; only workflow/docs
and runner cleanup changed since those runs. No generated artifacts or unrelated
files are staged. Existing rustfmt baseline failure remains documented.


## Repository-wide commits and copyable automation logs (2026-10-04)

Branch enumeration already used shared local refs, but history only reloaded on
repository selection/manual refresh. It now refreshes when the repository object
is refreshed by Git events. Commit detection previously compared only checkout
HEAD: it now snapshots all local branch tips and detached worktree HEADs, checks
commit/merge/cherry-pick reflog reasons, serializes concurrent checks, deduplicates
unchanged tips, and queues separate branch events for commit-only jobs. Watchers
resolve the common Git directory, including when the linked checkout is itself a
worktree, and observe private worktree HEAD logs. A 30-second snapshot fallback
catches missed notifications. Shell context lookup remains checkout-local and
works for nongit folders as before. Actions still run in the linked checkout;
file/change-count conditions remain checkout-local. Rapid same-branch commits can
coalesce to the latest observed tip; remote-tracking refs are not local branches.

Automation log dialog adds Copy log with status feedback and clipboard error
handling, copying all displayed saved/live output sections and fallback results.
WebKit regressions cover copying, failure feedback, unchanged primary HEAD with
an agent branch commit, branch-creation suppression, event deduplication, context,
and two different branch commits queued together. Native temporary Git/worktree
fixtures cover shared branch enumeration, linked and detached commits, shared Git
directory resolution, and actual watcher delivery for a linked-worktree commit.
Production build and saved-prompt/CI WebKit fixtures passed. Native suite passed
88 tests (4 ignored) after separating checkout context from repository-wide
snapshot collection; the initial shell regression identified that distinction.
Changes remain uncommitted; nothing pushed.


Branch-list follow-up: relying on a changed parent repository object was not
sufficient, because the regular repository refresh preserves equal snapshots.
CommitHistory now requests branches directly on focus/visibility, every 15 seconds
while visible, and on debounced Git events, with request-generation protection
and listener/timer cleanup. WebKit regression proves a private/ branch appears
without a parent metadata change, can load its history, and a second branch
appears through the timer fallback. Production build and that regression passed.
The running app uses the expected gitcerberus.db; all refs and registered worktrees
for its four linked repositories were inspected read-only and none currently
contains a private/ branch. Asked for the repository/worktree path to locate the
user's specific branch rather than claiming it has been found.

Located the user's missing branch: `private/ci-37186394041` at
`/tmp/cerberus-ci-37186394041`, commit
`1bcca95178d5cbfed9c5c7a03d6a7fc2a72b99d4` (Fix desktop CI workflow lint and
condition dialog focus). It still exists. Its common Git directory is
`/tmp/cerberus-ci-repo-37186394041/.git`, a separate repository, not Cerberus's
linked checkout. That separate clone has the temporary worktree registered; the
linked checkout has neither the branch nor commit object. Repository-wide
watching cannot see refs in another clone. A later CI-correction run failed to
create `correction/ci-37186394041` in the primary repository due to Git metadata
permissions. No refs were fetched, merged, pushed, or modified during diagnosis.

## Shared copy feedback and automation write permissions (2026-10-04)

Read Mountlet's license-key copy implementation in app/src/main.ts and its green
corner badge CSS in app/src/style.css. Added shared CopyButton for automation logs,
prompt output, checkpoint prompt, GitHub device code, repository path, and
conversation copying. Buttons are icon-only with accessible names. The icon
remains visible and a green corner check follows clipboard contents, checked on
focus and every 400 ms while focused. Known in-app clipboard writes synchronize
buttons when reads are denied. Value changes clear stale indicators; failures
appear in accessible status and tooltip. Context-menu copy actions stay open so
feedback remains visible. Removed old success text/timed checkpoint icon swap.

The reported CI agent used edit/workspace-write with approvals disabled, so Git
metadata was protected and outbound network was disabled. Edit agent automations
now request the existing full execution mode on both profile and identity routes;
Codex thread and turn receive danger-full-access. This disables the sandbox rather
than granting narrowly scoped .git writes. Analyze-only jobs, drafting, and
interactive conversation permission choices are preserved. Existing saved edit
jobs get this on their next run; completed sessions need another run. The dialog
includes agent-permissions help. No CI-fix agent was launched, paid inference used,
Git credentials changed, or branch pushed during this work.

Validation: production build (TypeScript/dropdown check), 88 Rust tests with 4
opt-in ignored, saved-prompt WebKit (icon/badge, external clipboard change,
clipboard failure, full automation mode), card/branch UI fixture, four-size zoom
viewport matrix, and diff whitespace all passed. Transport fixture now verifies
both edit and full thread/turn policies. Saved-prompt test clears in-memory jobs
and mocks clipboard before React mounts; the earlier host-clipboard teardown
abort did not recur with that isolated fixture. All changes remain uncommitted.

## Running log entries and provider permission adapters (2026-10-04)

Automation logs now begin before each repository action, including notifications.
The dialog selects a newly running entry and updates that same entry from shell
streams, agent chat messages/activity, Copilot session events, and available CLI
output. Selecting an older run shows only its own content. In-memory updates are
immediate; serialized disk checkpoints are throttled to 500 ms and flushed at
completion/error. Native writes atomically replace the JSON file. The running
entry keeps its run ID when completed. In-memory completed entries are bounded.

Removed the saved-run placeholder and the generic Select "Choose…" fallback.
desktop/AGENTS.md now records the general rule: no placeholder menu options;
empty selectors are disabled or omitted, and every option is a real behavior.

The earlier full-mode change exposed adapters that rejected that mode. Copilot
now accepts edit/full and approves its tool permission requests for both; analyze
still permits only reading. Cursor accepts full through its force mode, and
Claude uses bypassPermissions for full. Codex continues danger-full-access.
This fixes Cerberus's "Unsupported Copilot permission mode" rejection; provider
or organization policies can still constrain the underlying tool. No paid agent
run was launched to verify provider access.

Validation: production TypeScript/dropdown/Vite build passed; Rust tests passed
(90 passed, 4 opt-in ignored); saved-prompt and CI WebKit fixtures passed with
exit status 0. Fixtures cover running-entry selection, live updates, completion
under the same run ID, absent placeholder options, and permission routing. The
CI fixture's WebKit child printed an allocator diagnostic after its successful
assertions; the fixture runner still exited 0. Vite retains its chunk-size
warning. Diff whitespace passed. All current changes remain uncommitted.

## Manual-run defaults and log following (2026-10-04)

Run once derives its selection from the eligible local repositories, defaulting
to the first while preserving a valid explicit choice. Display, button validation,
and execution share that value, including when repository options change. Empty
scope remains disabled. Audited app Select usages: account controls have real
None/Unassigned states or explicit account-selection buttons; other controls
initialize real values, and log selection is owned by its running/history logic.
Removed Select's misleading first-option display fallback for invalid values;
it now reports unavailable selection rather than pretending another value was
chosen. Recorded the selection-state invariant in desktop/AGENTS.md.

The log pane follows output at the bottom, pauses when the user scrolls up, and
resumes when they return to the bottom. Switching runs resets following.
Saved-prompt WebKit regression tests cover running without touching the repository
dropdown, explicit repository selection, overflowing log following, retaining a
scrolled-up position, and resuming at the bottom. Production build, that fixture,
four-window viewport matrix at 75/100/140/150% zoom, and diff whitespace passed.
Vite's existing chunk-size warning remains. No commit or push performed.

## Error notifications and manual branch-filter bypass (2026-10-04)

Inspected saved Post-commit review (correction) configuration read-only: commit
condition, correction/* inclusion filter, all repositories, enabled. Cerberus's
current checkout is wip. runSavedPrompt previously applied the saved branch
filter to manual runs and silently continued before creating a log, so this
combination ran no action and produced empty completion details. Manual Run once
now bypasses trigger/branch conditions in the selected repository's current
checkout; automatic filtering and saved repository scope remain in force. The
runtime dialog explains that branches are not switched.

Action, preparation, log, and handoff-emission errors no longer disable jobs.
Execution completion never restores an earlier enabled snapshot, so an explicit
disable during a run remains effective. Interval preparation failures advance
nextAt to avoid a scheduler-tick retry loop. Preparation errors create error log
entries too, preserving any current run output. Retired existing-conversation
configurations still undergo their existing disabled-schedule migration on read.

Failure notifications carry repository/run IDs. Toasts and notification history
offer Open log and Disable automation; disabled jobs show the latter as disabled.
NotificationCenter can open the log from any app page and selects that failed
run, even after newer successful runs. Opening from a notification closes any
existing panel-owned log dialog. Removing the automation removes those actions.

Validation: production TypeScript/dropdown/Vite build, saved-prompt, handoff, CI,
and four-window zoom viewport fixtures passed (runner exit 0), and diff whitespace
passed. Regression coverage includes automatic filtering versus manual override,
action/preparation failures remaining enabled, failure-log selection after a
newer success, explicit disable persistence, and disabling during execution.
The saved-prompt fixture now resolves Vite's actual savedPrompts/automationLogs
import URLs rather than copying api.ts's unrelated timestamp, avoiding duplicate
state stores during development tests. That fixture's WebKit child printed an
allocator diagnostic after successful assertions; Vite's chunk warning remains.
No paid agent run, settings write to the user's configured jobs, commit, or push.

## GitHub credential storage and reconnect refresh (2026-10-04)

Read-only Secret Service metadata diagnosis: org.freedesktop.secrets is currently
owned by GNOME Keyring, has only a session collection, and ReadAlias(default)
returns /. KDE's separate compatibility endpoint has a default kdewallet
collection. Neither endpoint's service-attribute search found Cerberus GitHub
entries. No secret values were retrieved, provider configuration changed, or
collections created. The pinned keyring 3.6.3 legacy default-target lookup calls
ReadAlias(default) when its initial item search is empty; the resulting NoResult
becomes the user's storage error. github.rs then obscured every storage cause
with a generic reconnect instruction.

Added github_credentials.rs shared by OAuth persistence/status/disconnect,
repository API calls, and Copilot (through oauth::github_token). Linux writes
target a named GitCerberus collection, independent of the default alias. Legacy
reads search service/user across collections without the default-alias fallback.
New entries take precedence; legacy fallback is only used when the named entry
is absent. Saving must succeed and match a fresh credential lookup before sign-in
reports success. Disconnect deletes matching service/user entries across the
active service's collections. Native macOS/Windows entry naming is preserved.
Storage access, missing tokens, and ambiguous credentials have distinct messages;
no plaintext storage or cross-provider token recovery was introduced. A stable
Secret Service provider and user sign-in are still required on this machine.

App.tsx also dropped forced catalog refreshes while an older lookup was in
flight. Reconnection now queues a fresh lookup and invalidates the older result,
preventing pre-reconnection warnings from being published after sign-in.

Validation: four new credential tests passed, production build passed, and the
saved-prompt WebKit fixture passed with a mocked OAuth reconnect while a catalog
request is in flight (including observing the visible repository warnings).
New module rustfmt and diff whitespace passed. Full Rust suite: 93 passed,
4 ignored, 1 existing Cursor wrapper-child cleanup test failed; isolated rerun
also failed its immediate process-state assertion. Cursor source was unchanged.
The remaining suite passed with that test excluded. WebKit child again printed
an allocator diagnostic after successful fixture assertions/runner exit 0;
Vite retains its chunk warning. No actual OAuth flow, paid agent call, credential
write, commit, or push was performed.

## Safeguarded branch removal from commit history (2026-10-04)

Commit history now has an icon button to remove the selected local branch. The
current app checkout's branch is disabled; native checks also protect the primary
worktree and app-linked folder. A cancellable preparation dialog lists the branch
tip, linked worktrees, and exact remote ref. Confirmation uses a revalidated plan
and displays completed steps plus any later error. It refreshes branches/history
after success or partial failure and selects an available branch if needed.

branch_removal.rs validates refs, parses worktree porcelain -z without losing
spaces/newlines, checks Git's upstream-or-HEAD merge eligibility before worktree
removal, calls worktree remove without force, then branch -d without -D. Remote
defaults to origin, with REMOTE environment override; absent origin allows local
only removal. Exact ls-remote distinguishes exit 2 (absent) from access failure.
A matching remote ref is rechecked, removed using normal push --delete, and the
remote fetched/pruned. No branch/checkout is switched or force-deleted. Changes
since confirmation are refused; completed steps are not automatically undone.
Remote operations use configured Git credentials, not a new app token flow.

Validation: eight native tests passed using temporary repositories and local bare
remotes, covering clean worktree/local/remote deletion, absent remote ref, dirty
and locked worktrees, unmerged/primary branches, stale tips, remote access failure,
and rejected remote deletion with partial success. Production build, shared card
WebKit fixture, and four-window zoom viewport matrix passed. UI regression covers
confirmation/cancellation at 100/140/150%, target preservation, refreshed branch
selection, failed preflight, and partial results. Rust suite excluding the already
failing Cursor cleanup test passed (101 passed, 4 ignored, 1 filtered). New module
rustfmt and diff whitespace passed. WebKit printed its existing allocator warning
after successful fixture assertions/runner exit 0; Vite retains its chunk warning.
Removed generated untracked bytecode for the two Python automation fixtures.
No user branch/worktree/remote was removed, no GitHub push performed, and no
project commit created. All accumulated changes remain uncommitted.

## Explicit forced deletion of unmerged branches (2026-10-04)

User authorized a force option for leftover alternate CI-correction branches.
Removal plans now report merge status instead of rejecting unmerged branches.
Merged branches retain branch -d. An unmerged plan shows its branch/full commit,
then Continue to forced deletion opens the second confirmation, requiring an
unchecked acknowledgement before Force delete branch is enabled. The native
command requires confirmation of the exact inspected unmerged head; changed
tips, merge status, worktrees, or remote tips require fresh review. Only then
does branch -D replace -d. Worktree removal remains non-forced, with primary and
app-linked checkouts, dirty files, and locked worktrees still protected. Results
identify forced local deletion explicitly. The dialog height accounts for zoom
so its warning/acknowledgement scroll internally with the footer accessible.

Validation: ten native removal tests passed, including refusal without/wrong
force confirmation, confirmed deletion of an unmerged branch with a clean linked
worktree, and preservation of a dirty linked worktree even with confirmation.
Production build and WebKit UI fixture passed; UI covers the second-step gate,
unchecked acknowledgement, exact commit submission, cancellation at 100/140/150%,
and forced-dialog bounds at 150%. New-module formatting and diff whitespace pass.
Existing WebKit allocator and Vite chunk-size diagnostics remain. No live user
branch was removed, no project commit or remote GitHub push performed; changes
remain uncommitted.

## Boolean handoff trigger variables (2026-10-04)

Handoff condition editor now saves optional handoffVariables as comma-separated,
case-sensitive identifiers. Every requested name must be JSON boolean true in
the incoming payload's variables object, e.g. {"variables":{"v":true}}. Plain
text remains compatible with triggers without requirements. Native inspection
and atomic claiming both filter; false/missing/string/invalid payloads remain
pending, while later matching emissions can run. Composite and standalone
schedulers pass the same requirements. Outgoing agent instructions and help
explain the format; scripts/notification payloads can emit the same JSON.

Validation: eight native handoff tests pass, including strict matching and
concurrent filtered claims; WebKit scheduler fixture confirms nonmatching queue
entries are preserved. Production build passes (existing chunk-size warning).
Automation UI fixture covers variable entry, condition chip, and dialog bounds
at 100/140/150% zoom. Changes remain uncommitted.

## Handoff flags wording and help (2026-10-05)

Trigger UI calls boolean variables flags. Emitting agents receive instructions
to interpret ordinary task wording (set v, mark v true, raise ready, conditional
flags), preserve names/case, and write actual JSON booleans in the existing
variables object alongside details. No schema migration or natural-language
parsing of payloads; deterministic trigger matching is unchanged. Emit handoffs
popover explains Agent wording and Shell JSON output with a quoted output path.
Documentation and fixtures updated. Production build and handoff scheduler
fixture pass; automation UI fixture checks flag labels and both help examples.
Changes remain uncommitted.

## Conditional handoff emissions (2026-10-05)

Emit handoffs accepts parentheses: summary, (review). Parenthesized names remain
in saved settings/edit fields, but runtime paths, shell environment keys, name
suggestions and pairing use undecorated names. Agents receive explicit optional
emission instructions; absent files emit nothing. Shell scripts decide by
writing inside an if condition. Empty payload files still emit. Duplicate names
with different decoration are rejected; conditional names require Agent/Shell
(not Notification, which emits automatically). Suggestions retain parentheses
when completing a conditional name. Help includes Agent wording and Shell if
commands, and docs explain lifecycle and syntax.

Fixed an existing ordering bug: agent prompt augmentation now happens after
outgoing paths are populated, ensuring instructions actually reach agents.
Validation: production build, WebKit handoff scheduler (skip and active emission,
undecorated paths, persistence, prompt instructions), and automation UI checks
pass. Existing Vite chunk warning remains. Changes are uncommitted.

## OR condition sets (2026-10-05)

SavedPrompt.conditionSets stores arrays of AND conditions; rows are combined in
OR. Legacy conditions remain a single set. automationConditions returns the
union for monitoring subscriptions; automationConditionSets returns rows for
evaluation. Pending events are keyed by job/repository/set and cannot satisfy
other rows. A match clears all pending rows for that job/repository to prevent
double runs. CI dispatch now handles both pass and fail alternatives. Shell
CERBERUS_CONDITIONS reports the matched set. Branch/repository scope and repeated
condition parameters remain shared, explicitly explained in editor/docs.

Editor provides colored rows, OR labels, AND separators, per-row adding/removing,
and an inline Add condition set button. Empty rows block saving; Manual remains
exclusive. Clicking an alternative parameter chip promotes that row into the
primary editing position; colors/order follow the displayed rows.

Validation: build, WebKit scheduler (separate partial matches, either OR row,
clear-after-run, CI pass/fail alternatives), automation UI (rows, different
colors, selectors at 100/140/150%, existing compact layouts), and card/branch
removal fixture pass. Existing Vite chunk and WebKit child allocator diagnostics
remain. During validation styles.css contained component source instead of CSS;
restored committed CSS plus prior copy/notification/branch/flag styles and new
row styles. Card fixture confirms prior copy/branch behavior. InfoPopover now
uses clamped top placement to stay in the zoomed viewport. All changes remain
uncommitted, no push or live automation run.

## Automation defaults, help, and card sizing (2026-10-05)

New automation creation (including incoming drafts) selects every current local
repository and includes future repositories by default. Editing retains saved
scope. While future inclusion is on, displayed targets follow the linked local
repository list; deselecting any repository snapshots the remaining targets and
turns future inclusion off. Manual still chooses its repository at run time.

Handoff help is a short summary with Agent wording, Shell output path, conditional
emission, and a boolean flag example. Detailed instructions moved to the separate
desktop/docs/handoffs.md guide, linked from the docs index and automation docs.
Automation list is a flexible, internally scrolling column. Cards never shrink,
and titles/summaries wrap to their content height rather than being truncated.

Validation: build and WebKit automation UI pass (default current/future scope and
existing workflows); card fixture passes with 30 extra long-title cards at
100/140/150% zoom, confirming no card shrink/clipping and independent list scroll.
Existing Vite chunk and WebKit child allocator diagnostics remain. Changes are
uncommitted; no live automation execution or push.

## Codex catalog disappearance regression (2026-10-07)

Read-only probe of the configured VS Code Codex app-server in the app's assigned
account home returned account:null from account/read, but model/list returned
eight models including gpt-6.1-sol, gpt-6-astra, and gpt-6-sol. Existing native
chatgpt_capabilities rejected the missing account before requesting models; the
hook then dropped data and the selector silently showed only Provider default.
No auth secrets were read/output, no login change or paid turn was executed.

Native catalog discovery is now independent of account verification, with quota
requests skipped for an unverified/mismatched account and a usageError explaining
reconnection. Agent execution verification remains unchanged. The frontend keeps
the last successful per-account catalog after failed refreshes and displays model
availability/account warnings in an info popover beside model controls. Saved
model selections survive. No hardcoded model list was added.

Validation: two native catalog tests (signed-out catalog/no quota read, verified
account pagination/usage), hook refresh-cache/account isolation checks, production
build, and automation WebKit UI fixture pass. Changes remain uncommitted.

## Checkpoint review and validation (2026-10-07)

All pending source, fixture, documentation, and new module files reviewed for
this checkpoint. No deleted files, generated artifacts, or credential-pattern
matches are included. The accumulated work includes repository-wide commit
monitoring and branch refresh, safeguarded/confirmed force branch removal,
shared copy controls, live execution logs and failure actions, provider editing
permissions/progress, GitHub credential persistence, boolean/conditional
handoffs, OR condition sets, all-repository defaults, and Codex catalog recovery.
Detailed docs match the current implementation; branch-trigger manual replay
remains a discussed design rather than an implemented feature.

Checks: production build (dropdown lint, TypeScript, Vite); ten frontend logic
scripts; five WebKit integration fixtures including viewport/zoom; full native
CI-style serial suite (108 passed, 4 explicitly ignored live-provider checks);
Clippy all targets completes with warnings. Default-parallel Rust testing passed
once and then hit the known unchanged Cursor wrapper-child cleanup race; serial
CI configuration passes. Repository-wide cargo fmt --check fails on pre-existing
formatting (confirmed against unchanged HEAD agent_edits.rs); new branch-removal
and credential modules pass rustfmt checks, and git diff --check passes. Existing
Vite chunk-size and occasional WebKit child allocator diagnostics remain.

Checkpoint review updated the chat fixture's mocked API/browser adapters and the
CI fixture to wait for dialog focus/menu rendering. Removed unused production
handoff wrappers (test-only now) and resolved a new Clippy formatting warning.
No live user branch deletion, paid agent run, credential change, or push was
performed. This checkpoint is intended to include all reviewed pending changes.

## ChatGPT Secret Service recovery (2026-10-07)

The active GNOME Secret Service still returned `/` for ReadAlias(default), even
though its persistent GitCerberus collection was unlocked. KDE's separate
compatibility endpoint had a kdewallet default. At the user's request to solve
the problem, set the active provider's default alias to the existing GitCerberus
collection. GNOME persisted the alias under ~/.local/share/keyrings/default.
A temporary noncredential item passed write/read/delete and was deleted. The
configured Codex runtime now reports Not logged in rather than a storage error
for the Cerberus ChatGPT identity. No real credential was read, deleted, migrated,
or created; browser sign-in is still required once. No provider was stopped or
replaced, and no plaintext fallback was enabled.

Codex RPC storage errors now explain storage repair, with read-only Linux
default-alias/lock diagnostics. Missing-account handling checks storage before
recommending reconnect. Browser login now verifies persistence through a fresh
Codex process before marking the identity connected. Regression coverage includes
a login process holding credentials that a new process cannot read.

Validation: full native serial suite passed (110 tests, 4 live-provider tests
ignored), ChatGPT account and capability frontend checks passed, Clippy all
targets completed with existing warnings, and git diff --check passed.
The temporary OS verification item was removed. No commit or push was made.

## Preserve and retry blocked actions (2026-10-07)

Handoff finish/stale cleanup retain payloads in archived/<name>/<emission>.txt
rather than deleting them. Explicit retry_handoff reclaims the exact ID and
original claimed path; archives are never polled as pending triggers. Failed
automation logs retain frozen job/account/prompt/model, incoming handoff, event
context, and conversation linkage. Retry is exposed on automation cards and in
the conversation list toolbar/context menu; composer retry delegates to the same
automation retry when applicable. Existing external-provider chats are reused.
Responses beginning Blocked retain retry context as well as provider errors.

Restored the exact reviewer-written revise payload from the earlier recovery
copy into Cerberus Git metadata's archived/revise/7e68d8c5-51a5-45cb-8c88-718092522651.txt.
Updated only the original login-failed revision log
abd2ef63-4211-4a11-9c11-0c65f2901144 with retry metadata linking that emission.
Its legacy definition is reconstructed from the saved automation with the
original logged command when the new frontend loads. Legacy conversations link
by original emission ID in their injected prompt. No queue event, paid agent
run, commit, or push was initiated. Previous keyring fixes remain uncommitted.

Validation: production build/TypeScript/dropdown lint; all frontend checks;
saved-prompt WebKit checks (blocked handoff + frozen-command retry, original
conversation retry), handoff checks; native serial suite 111 passed, 4 ignored.
Clippy all targets completed with existing warnings; viewport checks passed at
all fixture sizes/zooms. A native log round-trip check verifies retry metadata
survives persistence and is removed after a successful retry.

## Configurable handoff retention (2026-10-07)

Automation header settings opens a focused retention dialog. Native per-device
handoff-settings.json defaults to 24 hours, validates whole hours 1–8760, and
uses atomic persistence. The browser demo keeps the same setting in localStorage.
Archive timestamps start at the latest finished consuming run; retries renew
retention. Pending payloads and live claims are untouched. Stale claims archive
after their existing 30-minute lease, then receive the retention period.
Periodic/startup cleanup expires archives; saving settings also invokes cleanup.
Native retry checks age independently so expiry is enforced before deletion.
Blocked-run refresh checks retained payload availability and hides expired retry
actions in both automation and conversation lists. No real user's retention
setting was changed, and the recovered revise archive remains retained.

Validation: production build/TypeScript/dropdown lint; ten frontend checks;
saved-prompt WebKit fixture including settings persistence, 100/140/150% modal
zoom, frozen-context retry, and expired retry visibility; viewport matrix;
native serial suite 113 passed, 4 ignored; Clippy with existing warnings;
git diff --check. Native tests cover default/config persistence and expiry while
preserving old pending payloads and live claims. No commit or push.

## Automation conversation names (2026-10-07)

Both profile-based sendAgentMessage and external-provider runExternalAutomation
receive the saved automation title when creating an in-app conversation. This
prevents injected handoff instructions from becoming list titles. Existing chat
names (including user renames) are preserved on retries and continuations.
Naming is app metadata; external provider-owned titles are not modified. The
legacy AgentComposer is not mounted, so no unrelated manual composer UI was
introduced. Tests cover explicit profile-chat naming and continuation, plus
external automation naming and blocked-action retry naming in WebKit.

Naming validation: production build/TypeScript/dropdown lint, chat logic checks,
and saved-prompt WebKit checks passed. The fixture now waits for log completion
and checks the newly created named conversations rather than older fixture
records retained by WebKit storage. Whitespace review passes. No commit or push.

## Commit loading, concurrent contexts, and integration recovery (2026-10-07)

Commit requests now ignore redundant selections, survive repository metadata refreshes, and provide a bounded wait with retry. History timestamps are visible; the manual commit picker is newest first. Automation cards show separate active and recent contexts with their own logs. Identical active contexts are deduplicated; selected-revision agents use retained isolated worktrees.

Reconciled divergent wip histories and incorporated the approved bare-repository fixture correction. Both reviewed correction branches and their clean worktrees were removed after merging; no matching remote correction branches existed. Main and autosave were preserved. Older stashed account-storage and blocked-action retry fixes were recovered and combined with independent execution contexts. Safety stashes remain until the pending work is checkpointed. No push.

Recovery note: the combined implementation stores retention in `handoff-retention-hours` and retains completed payloads in `consumed` while accepting legacy `archived` payloads. Earlier sections describe the original stashed implementation.

Final verification: production build (dropdown lint, TypeScript, Vite), chat/agent logic, workflow actionlint, WebKit automation-actions/CI/handoff/viewport checks, and native serial suite (114 passed, 4 live-provider tests ignored). Clippy completed with existing warnings. Parallel native testing exposed the known Cursor child-cleanup race; serial verification passed. Saved-prompt browser coverage also checks frozen-prompt retries and expired handoff visibility.

Checkpoint review restored the consumed-input marker for successful Agent, Git, and Notification actions after the stash reconciliation. Successful actions retain their handoffs outside the pending queue rather than requeueing them.


## Durable conversations, sleep protection, and contextual retries (2026-10-08)

The browser conversation record stopped at approximately the WebView's 5 MB quota;
newer completed activities still existed in native automation logs. Added per-chat
atomic SQLite upserts (agent-conversations.db), compact browser fallback records,
stream/session checkpointing, log metadata, and startup display recovery. Legacy
history was recovered into the durable store with backups under app data's
handoff-recovery/conversations-20261008. Recovered the original first review's final
reply from its assistant.message + assistant.idle events and repaired its running
log to completed. Large Unicode activity cannot exceed native byte limits on log
checkpointing anymore.

The later review rerun (190d2a60) reviewed 718984a, not CI correction 993893e. The
correction review (37d469fd) completed and emitted integrate. Its downstream
integration (40d043d1) stopped before completion; its exact integrate emission
37d469fd remains consumed/retained. Recovery links that failed run to the original
Copilot session and handoff; it does not launch a turn. Cards show active and blocked
contexts only; the retry button is inside its specific failed row. Completed runs
remain in the log dialog.

Removed five clean completed app worktrees and their private/automation-* refs,
after proving their commits remained referenced elsewhere. Kept correction/
desktop-ci-37687266495-20261007 at 993893e and the interrupted integration checkout.
Native success cleanup applies the same policy. Dirty work and unique commits stay;
a continuation can recreate a cleaned checkout at its recorded revision. Included
the already-approved missing-login diagnostic assertion from the correction.

Native jobs acquire RAII sleep inhibitors. Detected local activity adds an expiring
heartbeat lease. Linux uses a logind fd, macOS caffeinate -i, Windows execution
state on a dedicated worker thread. Runner and UI completion timers exclude long
suspend gaps; live connections continue on wake. Provider disconnects and process
termination still require explicit retry/resume, with saved session/input intact.
The real Linux inhibitor lifecycle test registered and released its lock successfully;
macOS and Windows behavior is implemented but not exercised on this Linux machine.
No paid provider turn, push, or new commit was initiated for these changes.

Validation: production build/type checking/dropdown checks passed; native serial
tests passed (117, with five environment/provider tests ignored); the real Linux
logind lock lifecycle test was run separately and passed. Conversation quota,
streaming checkpoints, suspend waits, exact-context recovery, existing chat checks,
WebKit automation action/persistence fixtures, and viewport/zoom checks passed.
Clippy completed with existing warnings; formatting of new modules and diff
whitespace checks passed. Native changes require a desktop rebuild/restart.

## Run management and eventual checkout cleanup (2026-10-08)

Added native active-checkout leases to serialize cleanup against starts, plus
startup/30-minute safe cleanup sweeps after blocked retention. Agent instructions
explicitly assign checkout cleanup to Cerberus and require reporting verification
as pending. Dirty/unique work is retained without force. Compact run rows include
exact context with inline retry, dismiss, and delete actions. Dismissal is a durable
log flag; conversation retries remain available. Confirmed run/log deletion waits
for pending checkpoints, removes cache/disk/retry, and protects active runs.
Conversation and handoff history stay independent. The settings gear opens general
Automation settings, currently containing handoff retention.

Validation for run management: production build passed; native serial suite passed
117 tests (five ignored). WebKit actions verified persistent dismissals and confirmed
log deletion, alongside exact retries; settings/persistence and multi-size viewport
checks passed. Diff whitespace and new checkout module formatting passed.

## Bulk logs and acknowledgement regression (2026-10-08)

Added confirmed Delete all for one automation across all repositories/dismissed runs,
using full native history, serialized existing deletion, and active-run protection.
Batch cleanup runs once; partial failures include deletion counts and error details.
Fixed acknowledgement incorrectly requiring overall error state (concurrent jobs
can stay running with errorUnread true). The open log subscribes to state updates
and clears unread flags while open. Blocked row red borders now reflect unread
state, retaining neutral retry rows after inspection. Regression fixtures cover
concurrent errors, persisted acknowledgement, new errors after closure, cancelled
bulk deletion, cross-repository deletion, and retained active runs.

Validation: production build/dropdown/type checks, chat and conversation-recovery
checks, expanded WebKit action regressions, and multi-size/zoom viewport checks
passed. Bulk deletion refreshes log/cache observers once per batch. A WebKit child
teardown diagnostic appeared after one successful action run; a clean rerun passed
all assertions without that diagnostic. No new native changes in this follow-up.

Checkpoint review: safe checkout cleanup now atomically records final HEAD in a
sibling .revision file before removal, so later continuation preserves commits
made since its trigger. A regression assertion restores that final revision.
Copilot timeout ticks no longer reset under continuous events; macOS caffeinate
also watches the app PID to release on termination. CI now runs the new conversation
recovery check and expanded automation action fixture.

Native checkpoint validation exposed an existing race in Cursor's process-group
shutdown assertion: SIGKILL delivery to the wrapper child is asynchronous. The test
now polls termination for at most one second instead of checking immediately.
Production shutdown behavior is unchanged.

Review also protects resume preflight with the checkout lease. Startup recovery
now processes interrupted running logs even when a newer durable transcript exists,
preserving that full transcript while reconstructing its exact blocked retry.

Final checkpoint validation: production build/TypeScript/dropdown checks, release
version checks, four frontend logic suites, actionlint, Python/shell syntax,
formatted native module checks and whitespace checks passed. All six WebKit
fixtures passed against the existing Vite server, including four window sizes
and zoom variants (the isolated port-3000 wrapper was not used). Native unit/bin/
doc tests passed: 117 unit tests, five ignored; the real logind lifecycle test
passed separately. Clippy completed with remaining pre-existing warnings. The
Cursor termination assertion race was corrected after its initial failures.
Ignored private data, dependencies and build outputs remain excluded.

## Automation loop reconciliation and cleanup (2026-10-08)

The extra revise/integrate runs consumed newly emitted handoffs, not automatic
replays of retained consumed handoffs. An explicitly retried older CI integration
published 993893e while the local checkpoint ed7a55a still contained that fix with
a different comment. Publish requested revision over that comment conflict;
4454460 aligned it. A subsequent integration requested another revision even
though that small correction was already in the target. Several agent reports
also supplied incorrect full upstream SHAs. Prompts need verified Git evidence,
the complete original publication goal, and terminal handling of duplicate/no-op
corrections. The user disabled Review while another AI improves the prompts.

Local wip now reconciles the checkpoint, its comment correction, and upstream CI
history without dropping checkpoint features. No remote publication was performed
during this cleanup. Five inactive temporary worktrees were safely removed; final
HEAD .revision markers preserve continuation context. Nine obsolete temporary
branches are removed with normal merged-branch deletion after reconciliation.
Seven obsolete handoff payload copies from this resolved lineage were retired
from scheduler storage; conversation/log audit history and unrelated handoffs
remain intact. Pending/claimed payloads were not removed.

Recovery backup: ~/.local/share/dev.gitcerberus.app/handoff-recovery/
cleanup-20261008T194404Z/. Includes the retired handoff payloads and the reviewed
worktree's package-lock.json plus binary diff: npm had only added dev metadata
to three packages. That incidental change was restored before removing its
worktree. Main, wip, autosave, and existing recovery stashes are retained.

Cleanup validation: production build, TypeScript and dropdown checks passed
(existing bundle warnings remain); native tests passed 117 with five ignored,
and binary/doc tests passed. Diff whitespace checks passed.
