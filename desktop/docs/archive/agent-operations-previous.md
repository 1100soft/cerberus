# Local agent operations

GitCerberus can orchestrate agents without a hosted GitCerberus backend. The desktop app launches local provider CLIs; model inference and billing still use the provider's service. The computer and application must remain running.

## Implemented

Open the app icon → **Agents** to manage installations and API accounts. Select a local repository and activate its leftmost **Chat with agent** action (A). Choose an API account and **Analyze** or **Edit workspace** in the conversation pane, then send a message. Profiles contain a provider and API key. Executable paths are shared provider settings, reused by history and agent tasks. Keys are stored in the OS keychain, never in localStorage, command arguments or profile JSON. Profile names are user labels, not verified account names. Authentication is checked by the provider on the first run.

- **Codex:** `codex exec --json`, prompt through stdin, read-only or workspace-write sandbox, approval policy `never`. Requests requiring an escalation fail rather than silently gaining access. New sessions get a profile-specific `CODEX_HOME` under application data. Resuming imported Codex history uses its validated original session home with the explicitly selected API account. API key supplied only to the child process; shell environment policy excludes provider API keys.
- **Cursor:** the **Agent CLI** (`agent`), not `cursor-sdk-bridge`. Uses `--print --output-format stream-json --sandbox enabled`. Analyze uses Ask mode; explicitly choosing Edit uses `--force` to permit non-interactive changes while keeping the sandbox enabled. No fallback to an unsandboxed mode.
- Streamed activity, command/file events, provider errors, completion and stop controls.
- One run at a time per canonical checkout, across providers and profiles. Different checkouts may run concurrently.
- The run captures the selected provider profile and Git identity. Assigned Git author/committer name and email are applied only to that process. GitHub tokens are not passed to the agent. Existing Git credentials and SSH configuration remain independent; this is billing separation, not OS-user isolation.
- Navigation and closing to the tray keep a run alive. Stop and application quit terminate active subprocess trees. Ending a run cleans up its process group. Changes already written are retained for review.
- IDE handoff buttons remain available for interactive work.

## Current limits

API-key profiles are supported; separate ChatGPT/Cursor browser-login profiles are not yet implemented. The existing Codex history login remains separate. New profile-specific Codex sessions are on disk in their own home directories, not merged into the default provider history pane.

App chats, provider session IDs and completed output are saved locally; API keys remain in the OS keychain. Activity and responses are capped at 200,000 characters per run. Closing the app stops runs; reopening restores the chat for continuation, not the running process. Drafts remain window-session state. A storage failure is shown in the composer.

Follow-ups use `codex exec resume` or Cursor `--resume` with the recorded session ID. Resume checks bind app sessions to the API profile and canonical checkout and require local provider session storage. Imported Codex history can continue when its rollout and repository are validated. Arbitrary Cursor IDE/SDK history is not assumed to be a resumable CLI session. The composer explains unavailable sessions and offers **Start new chat**, which copies loaded messages while preserving the original. Failed resume never silently starts a fresh session.

There is no interactive approval dialog, scheduling, cloud runner, worktree queue or automatic GitHub publishing. Provider sandbox availability is platform-dependent; an unavailable sandbox fails visibly. Paid provider runs have not been live-tested.

The next step for richer orchestration is richer provider adapters using Codex app-server and Cursor SDK/bridge or ACP. Those interfaces expose richer session lifecycle and approval/event handling than the initial CLI adapter. Keep provider authentication, Git identity, repository permissions and approval decisions separate in that design.

## Official documentation consulted

- [OpenAI non-interactive mode](https://developers.openai.com/codex/noninteractive/): JSONL events, API-key override, sandbox permissions and resume.
- [OpenAI app-server](https://developers.openai.com/codex/app-server/): JSON-RPC sessions, turn lifecycle, authentication and approval requests.
- [Cursor headless CLI](https://cursor.com/docs/cli/headless): streaming and explicit non-interactive file modification.
- [Cursor CLI parameters](https://cursor.com/docs/cli/reference/parameters): Ask mode, sandbox, workspace, API key and resume options.
- [Cursor authentication](https://cursor.com/docs/cli/reference/authentication).
- [Cursor SDK](https://cursor.com/docs/sdk/typescript) and [bridge](https://cursor.com/docs/sdk/bridge): local runtime and programmatic agent sessions.

Validation uses mock subprocesses and WebKitGTK UI tests; it makes no paid inference requests.

## Shared provider setup

Both the conversation pane’s setup icon and Agents → Setup open the same separate popup. Codex uses the existing `codex-executable.txt` setting for history and execution; Cursor retains separate `cursor-executable.txt` (optional SDK bridge) and `cursor-agent-executable.txt` (Agent CLI) settings within that screen. Plain Cursor editor history requires neither executable.

Detection checks saved configuration, provider environment overrides, PATH, common per-user locations, managed SDK installations and legacy billing-profile executable paths. A broken explicit override is reported rather than silently replaced; Advanced settings offers automatic detection and path selection. Agent runs resolve the shared settings every time, so an existing billing profile picks up changes immediately.

Missing tools have an in-app installer with a displayed command plan and one installation button. Codex and the bridge use application-local npm/venv installation; Cursor Agent uses the official platform installer in the user account and saves the resulting path automatically. No shell commands need to be copied. API keys still come from the account owner; profile names are generated automatically and can be customized under Advanced settings. Provider setup never changes history visibility. Provider checkboxes live only in the conversation pane.


The UI calls API-key profiles **AI accounts** and explains the empty state before offering a selector. These credentials are not automatically imported from the editor or from GitHub. Setup paths save immediately, API keys save with Connect account, and Close dismisses the popup. Repository editor-launch buttons include the editor logos.

Installer output is streamed in chunks with terminal control sequences removed, including carriage-return progress. Elapsed time remains visible during quiet network operations. Cursor downloads use bounded connection/stall retries; existing executables are reused instead of installed again.

## Keyboard navigation

Navigation is hidden until the top-left app icon is activated. Agents is configuration-only; the repository conversation pane owns chat. Repository arrows cycle cards/actions; A or the first action focuses chat. Escape returns to the selected repository action, after dismissing any open menu. Ctrl+Up/Down cycles conversations without stealing focus; Ctrl+Enter sends and Enter inserts a newline. Shift+arrows navigate commits/branches.

`src/lib/shortcuts.ts` defines stable command IDs, bindings, labels and modifier matching. The navigation menu includes a keyboard-shortcut reference. Control-local accessibility keys (dropdown arrows, Tab, dialog Escape) remain with their controls. Future customization can replace command bindings without coupling them to visual positions.

## Provider session interfaces

[Codex app-server](https://learn.chatgpt.com/docs/app-server) is also the interface used by the Codex VS Code extension and exposes `thread/resume` followed by `turn/start`. This adapter uses [non-interactive Codex](https://learn.chatgpt.com/docs/non-interactive-mode) resume instead. [Cursor ACP](https://cursor.com/docs/cli/acp) exposes `session/load` and `session/prompt`; the current adapter uses Cursor CLI resume for sessions created here. Those interfaces do not establish compatibility with arbitrary transcripts from Cursor IDE storage.

Provider setup opens directly for the agent whose setup button was clicked; there is no second provider choice in the popup. Browsing focus stays with repository controls or the chat input, including during dropdown navigation. Search and modal text fields remain editable.


After an API key is stored, setup shows **API key added** with **Add another key** and **Close**. This confirms OS-keychain storage; provider authentication is checked on the first message.

## Conversation defaults and edits

Selecting a repository opens its latest conversation. Account options match that conversation's provider; a sole matching account is selected automatically. **Edit workspace** is the default permission level, with **Analyze** available for read-only requests. This does not grant unrestricted machine access or automatic escalation.

Completed Codex history changes and recognized Cursor editor writes appear after their turn's final assistant response. App runs save provider edit events and a workspace fingerprint comparison to catch shell edits. The latter excludes unchanged pre-existing modifications but may include concurrent user/editor changes, which the summary notes. Historical formats without usable edit metadata cannot be reconstructed retroactively.

Codex can reject continuation when another process owns the session (`already has an active writer`). Close the conversation in that other Codex process or IDE, then use **Retry last message** here. This app does not break the provider's writer lock. Alternatively, explicitly start a separate chat. Failed attempts before a turn begins can be retried without duplicating their displayed prompt; later failures require a follow-up because some work may already have happened.

## Navigation, search and review

The conversation's right rail jumps to the beginning/end (Ctrl+Shift+Home/End) and previous/next prompt or response (Ctrl+PageUp/PageDown). Beginning loads earlier message pages when necessary. F focuses repository filtering, Ctrl+F searches the selected repository's conversations, and Ctrl+Shift+F searches the current transcript. Bare F does not interrupt typing. Searches include older pages; repository conversation search includes archives and only queries enabled providers. It reports incomplete history instead of treating retrieval errors as no matches. Enter/Shift+Enter move between matching messages in the current transcript.

Each response's **Review changed files** button opens a separate, bounded dialog with a file list and colored additions/deletions, rather than expanding the transcript. Missing historical diffs are explicitly labeled. Escape closes the review and restores focus. **Send** remains the primary action for new or resumable conversations; replacing an unresumable conversation still requires the explicit Start new chat action.

Codex resume now passes the model from the last completed recorded turn, or the first recorded model when completion metadata is unavailable. A failed resume's default model does not override the preceding completed turn. Model metadata comes from the validated local rollout; no inference request is needed to find it. The provider's explicit exhausted-credit diagnostic terminates its reconnect loop, preserves the billing failure as the status, and exposes Open API billing. Account credits cannot be added automatically. Tests do not make paid requests.

## ChatGPT subscription identities

Open **Identities → Sign in with ChatGPT** and finish authentication in your browser. Codex must be installed; **Codex installation settings** opens its shared setup if needed. The app completes sign-in automatically and shows the account and plan. Subscription usage is separate from API billing.

The first authenticated account becomes the default for every existing and future repository. Change it under **Default account settings** in Identities. The repository tray's **Assign ChatGPT account** action (T) can override it for one repository, disable subscription assignment, or restore **Use default**. GitHub account assignment controls GitHub access and remains separate.

Each account uses a private Codex home and provider-managed keyring credentials. Subscription runs do not receive API keys. Disconnect logs out that account while keeping assignments available for reconnection. Running chats must finish or stop before disconnection. When an assignment differs from a saved app chat's account, starting a new chat is explicit. Imported Codex sessions are copied into the account's private history before continuation; original IDE history stays unchanged.

Repository-wide search now highlights conversation cards and immediately displays the first matching text. **Enter** advances through occurrences, continuing into the next matching conversation; **Shift+Enter** goes backward. Both keys also work in the current-conversation search, where navigation stays within that conversation. Arrow buttons provide the same actions.

## Unified sign-in and subscription execution

ChatGPT and GitHub identities share one list. The OpenAI and GitHub icons distinguish them. **Add identity** offers both sign-in methods. The OpenAI button in the conversation header opens the same ChatGPT login popup without leaving the repository. Defaults stay under the collapsed **Default account** setting.

ChatGPT turns now run through Codex app-server rather than the separate exec entry point. The process checks `account/read` before `thread/start` or `thread/resume`, then runs `turn/start` with explicit approval and sandbox settings. This keeps the verified account and the turn in the same process. Missing or mismatched credentials prevent inference; a provider 401 stops the run and marks the identity for reconnection. Codex continues to own token storage and refresh. Responses, edits, Git author settings, cancellation, and native resume remain supported.

Reference: [official Codex app-server authentication and turns](https://learn.chatgpt.com/docs/app-server).
