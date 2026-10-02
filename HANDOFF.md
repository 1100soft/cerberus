# GitCerberus handoff — 2026-10-03

## First read

- Repository: `/home/eh930/project/apps/cerberus`; branch `wip`.
- This document describes the Automation and Agent UI checkpoint. Review current Git status before continuing; repository state is authoritative.
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

The Handoff name controls now share searchable suggestions from currently configured trigger and emission names. Emit is below the action field. The Automation page warns about unmatched names per repository. The tooltip explains that prompts may refer to the payload as “the handoff”; exact paths are added by the app.
