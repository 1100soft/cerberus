# Desktop architecture

The desktop app has a React frontend (`src/`) and Tauri commands in Rust (`src-tauri/src/`). `App.tsx` owns repository selection and the Repository, Identity, and Agents views. The Agent pane is `components/CodexHistory.tsx`; it currently reads history and delegates interactive work to VS Code or Cursor. The old composer and local runner code still exists but is not presented in that pane.

## Data flow

1. Rust lists local repositories from SQLite and GitHub repositories through the assigned GitHub identity. `lib/repositories.ts` merges these into the visible repository list.
2. `components/RepositoryCard.tsx` renders repository status, assigned provider badges, and available agent activity. Local app-run status comes from `lib/agentChats.ts`; loaded provider status comes from `lib/conversationCache.ts`.
3. `components/CodexHistory.tsx` requests only enabled providers. `lib/conversationCache.ts` caches thread lists and messages, deduplicates requests, and refreshes the selected repository on focus and a timer. `lib/conversationDisplay.ts` folds consecutive assistant updates under one final response; `components/AgentActivity.tsx` opens all updates with one disclosure.
4. `components/IdentitiesPanel.tsx` renders GitHub identities and provider identity cards. `components/IdentitySignIn.tsx` is the single sign-in control used there and in the Agent header. Account initials are chosen and persisted by `lib/identityInitials.ts`, with the editor in `components/IdentityCard.tsx`.
5. UI colors should refer to `src/palette.css`. Dropdowns must use `components/Select.tsx` as specified in `AGENTS.md`.

## Provider capabilities

| Provider | Conversation source | Usage shown in Identity | Working state |
| --- | --- | --- | --- |
| Codex | Local Codex app-server sessions and validated rollout files | Available ChatGPT 5h/7d windows, credits, and reset times | App runs and Codex thread/rollout status |
| Cursor | Local editor history and optional SDK bridge | Link to Cursor Spending dashboard | SDK status where available; app runs |
| GitHub Copilot | Local Copilot CLI sessions through the Copilot SDK | `account.getQuota` snapshots, including `premium_interactions` when returned; web usage link | CLI processing state for recently listed sessions where supported |
| Claude | Local Claude Code JSONL transcripts | Link to Claude Usage settings | App runs only; the transcript reader does not report live state |

All four conversation providers are opt-in through the Agent pane. The presence of a GitHub identity does not install or authenticate the local Copilot CLI. Cursor and Claude web usage buttons open the browser's current session; the app cannot select that browser's active provider account.

## Credentials and persistence

- GitHub OAuth/CLI tokens and agent API keys use the OS credential store. Do not print or copy their values into logs, tests, or documentation.
- Repository metadata and assignments are in the app-data SQLite database or provider-specific app-data settings.
- ChatGPT subscription identities use account-specific Codex homes and provider-managed credentials.
- UI preferences, initials, provider checkboxes, selected models, and local chat metadata use localStorage. Provider transcripts remain in their own local storage.
- The Rust adapters are `codex.rs`, `cursor.rs`, `cursor_editor.rs`, `copilot.rs`, and `claude_history.rs`. Tauri command routing and external URL allowlisting are in `lib.rs`.

## Known integration boundary

The Copilot SDK launches a local `copilot` process. `request cancelled` during `Client::start` is a transport/startup failure before any quota or conversation request. The UI now reports that the CLI stopped during startup and keeps the GitHub web usage link visible. The exact exit cause must be diagnosed on a machine with a working Copilot CLI; the development shell for this handoff has `gh` but no `copilot` executable on `PATH`.

GitHub's [Copilot SDK quota documentation](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing) describes `quotaSnapshots`, including `premium_interactions`. Newer plans may report AI credits rather than a premium-request entitlement. Do not fabricate a missing quota from a GitHub repository assignment.
