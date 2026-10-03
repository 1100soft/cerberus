# GitCerberus handoff — 2026-10-03

## First read

- Repository: `/home/eh930/project/apps/cerberus`; branch `wip`.
- This document describes the committed Automation and Agent UI checkpoint and the uncommitted CI reliability follow-up below. Review current Git status before continuing; repository state is authoritative.
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


## CI monitoring reliability follow-up — 2026-10-04 (uncommitted)

The user's saved monitoring notices contained “Could not reach GitHub” for Cerberus, Mountlet, 1100, and InDEx, with roughly 30-second spacing matching the old request timeout. These were monitoring transport errors, not workflow failures. The old code discarded the underlying error cause and sent an alert per repository. The exact historical transport cause cannot be reconstructed from those messages. A read-only live native diagnostic with each repository's assigned GitHub credential succeeded for all four: Cerberus/1100/InDEx returned no push-triggered workflow runs; Mountlet returned 100. No agent inference, workflow dispatch, or credential changes were used.

The native CI command now returns structured timeout/transport, authentication/access, rate-limit, server, and response errors; details preserve transport causes without request URLs. GitHub retry/reset headers are retained, and connection setup has a ten-second timeout within the existing thirty-second request timeout. Frontend polling uses four workers to check eligible repositories, keeps per-repository retry health, backs off to fifteen minutes, respects larger GitHub retry delays, and groups persistent outages into one “CI checks delayed” notice after three failures. Access failures get actionable grouped notices. These monitoring notices have message status and cannot trigger automations. Healthy repositories continue checking while another request fails or stalls. All-repository scopes still poll without a local push prerequisite, so remote/editor pushes remain detectable; non-GitHub or unassigned future repositories are skipped.

The CI WebKit fixture now tests a slow failed poll alongside a real matching failure in another repository, transient-alert suppression, grouped persistent notices, backoff, rate-limit delays, access guidance, recovery deduplication, and eligible live-scope filtering. Native tests cover error categories, retry headers, JSON error serialization, and timeout cause retention without request URLs. The opt-in `live_ci_catalog` test reads existing workflow catalogs without running automations.

Validation for this follow-up: production build (dropdown convention and TypeScript included), full `cargo test -- --test-threads=1` (86 passed, 4 opt-in tests ignored), CI recovery WebKit fixture, saved-prompt and handoff WebKit regressions, and `git diff --check`. The live catalog diagnostic was explicitly run and passed against all four assigned repositories, both before and after the native error-handling changes. Existing bundle-size and Rust dead-code warnings remain. Retry deadlines use response time so slow requests do not shorten GitHub's retry delay. These changes have not been committed.
