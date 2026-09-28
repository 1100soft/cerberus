# GitCerberus handoff — 2026-09-28

## First read

- Repository: `/home/eh930/project/apps/cerberus`; branch `wip`; last commit `31b2140`.
- The working tree has extensive **uncommitted and untracked** changes. Do not reset, clean, or assume every diff belongs to the latest request. No commit or push was requested.
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

Passed: `cargo test --lib settings_rewrites_do_not_make_a_conversation_newer` and `cargo test --lib recognizes_cursor_completion_notifications`.

Not re-run this turn: the full Rust suite, `npm run build`, and the WebKit UI scripts. The spinner colors and the live notification path were not exercised in a browser. The desktop app has to be rebuilt by the existing `tauri dev` before the notification listener and Codex timestamp override are in the running binary. Do not start a second Vite server on port 3000, and do not kill the user's `tauri dev` process.

## Constraints that still apply

- Conversation providers are opt-in. Installers show the command plan and wait for in-app approval. No privilege elevation and no paid inference as a diagnostic.
- Use `src/components/Select.tsx` for dropdowns.
- Cursor editor state and Copilot chat files are read-only.
- A connected GitHub identity is enough for Copilot. Do not demand another sign-in, and do not point the SDK at a random `copilot` binary.
- UI tests expect four agent cards, Codex and Cursor setup copy, and Copilot/Claude conversation checkboxes that start unchecked. Do not auto-enable Copilot because a GitHub identity exists.
