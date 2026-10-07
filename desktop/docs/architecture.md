# Desktop architecture

The desktop app has a React frontend (`src/`) and Tauri commands in Rust (`src-tauri/src/`). `App.tsx` owns repository selection and the Repository, Identity, and Agents views. The Agent pane is `components/CodexHistory.tsx`; it currently reads history and delegates interactive work to VS Code or Cursor. The old composer and local runner code still exists but is not presented in that pane.

## Data flow

1. Rust lists local repositories from SQLite and GitHub repositories through the assigned GitHub identity. `lib/repositories.ts` merges these into the visible repository list.
2. `components/RepositoryCard.tsx` renders repository status, assigned provider badges, and available agent activity. Local app-run status comes from `lib/agentChats.ts`; loaded provider status comes from `lib/conversationCache.ts`.
3. `components/CodexHistory.tsx` requests only enabled providers. `lib/conversationCache.ts` caches thread lists and messages, deduplicates requests, and refreshes the selected repository on focus and a timer. `lib/conversationDisplay.ts` folds consecutive assistant updates under one final response; `components/AgentActivity.tsx` opens all updates with one disclosure.
4. `components/IdentitiesPanel.tsx` renders GitHub identities and provider identity cards. `components/IdentitySignIn.tsx` is the single sign-in control used there and in the Agent header. Account initials are chosen and persisted by `lib/identityInitials.ts`, with the editor in `components/IdentityCard.tsx`.
5. UI colors should refer to `src/palette.css`. Dropdowns must use `components/Select.tsx` as specified in `AGENTS.md`.
6. `lib/savedPrompts.ts` stores automation jobs and checks due triggers while the app is running. Agent jobs start new in-app conversations per selected repository; shell jobs run scripts through `shell_automation.rs`. Older fixed Git jobs remain runnable, and exact-session jobs are disabled migration candidates. See [automation](saved-prompts.md) for recovery behavior.

## Provider capabilities

| Provider | Conversation source | Usage shown in Identity | Working state |
| --- | --- | --- | --- |
| Codex | Local Codex app-server sessions and validated rollout files | Available ChatGPT 5h/7d windows, credits, and reset times | App runs and Codex thread/rollout status |
| Cursor | Read-only editor `state.vscdb` history, plus one reused SDK bridge for local agents | Link to Cursor Spending dashboard | Editor composer activity, cleared when Cursor's completion notification arrives |
| GitHub Copilot | Read-only VS Code or Cursor Copilot Chat `chatSessions` JSONL for that folder | Premium requests only, and only when `premium_interactions.entitlementRequests` is greater than zero | App runs only |
| Claude | Local Claude Code JSONL transcripts | Link to Claude Usage settings | App runs only; the transcript reader does not report live state |

All four conversation providers are opt-in through the Agent pane. The presence of a GitHub identity does not install or authenticate the local Copilot CLI. Cursor and Claude web usage buttons open the browser's current session; the app cannot select that browser's active provider account.

## Credentials and persistence

- GitHub OAuth/CLI tokens and agent API keys use the OS credential store. Do not print or copy their values into logs, tests, or documentation.
- GitHub APIs and Copilot share `github_credentials.rs`. On Linux, new GitHub tokens use a persistent Secret Service collection named GitCerberus, rather than relying on the default collection alias. Older tokens remain readable by service/user lookup across collections. Sign-in verifies a fresh credential lookup before reporting success; disconnect removes matching tokens. Storage-access failures and missing tokens have distinct messages. macOS and Windows retain their native credential-store entries.
- Repository metadata and assignments are in the app-data SQLite database or provider-specific app-data settings.
- ChatGPT subscription identities use account-specific Codex homes and provider-managed credentials.
- UI preferences, initials, provider checkboxes, selected models, and local chat metadata use localStorage. Provider transcripts remain in their own local storage.
- The Rust adapters are `codex.rs`, `cursor.rs`, `cursor_editor.rs`, `copilot.rs`, and `claude_history.rs`. Tauri command routing and external URL allowlisting are in `lib.rs`.

## Known integration boundary

Copilot conversations are replayed from the editor's `chatSessions` JSONL (`copilot_history.rs`). They do not come from the Copilot CLI. Quota still uses the Copilot SDK in `copilot.rs`, started with the saved GitHub token and the bundled runtime. `request cancelled` during `Client::start` is a transport failure before `account.getQuota`. The Identity card shows that startup error and keeps **Open Copilot usage**. Chat and Completions quotas of 0/0 are unlimited and are not rendered. A Premium requests row appears only when `premium_interactions.entitlementRequests` is greater than zero.

GitHub's [Copilot SDK quota documentation](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing) describes `quotaSnapshots`. Do not fabricate a missing quota from a GitHub repository assignment.

Conversation order is newest change first. Codex rollout files also move when settings are rewritten; `conversation_updated_at` uses the last message or task boundary so that rewrite does not sort an idle conversation above a later one. Cursor editor times and Codex times may be seconds or milliseconds; `updatedMillis` compares both as milliseconds.

The working spinner uses the provider color in the Agent pane (`--provider-codex`, `--provider-cursor`, `--provider-copilot`, `--provider-claude`) and the app accent (`--accent-codex`) on the repository row. On Linux, `cursor_notifications.rs` watches the session bus for Cursor's completion notification (`Done • …`, `Agent complete`, or `Cloud agent complete`). That event clears the spinner immediately. The composer database can otherwise keep an unfinished checkpoint for up to three minutes after the task ends.
