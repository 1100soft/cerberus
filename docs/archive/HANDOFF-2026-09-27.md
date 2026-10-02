# GitCerberus handoff — 2026-09-27

## First read

- Repository: `/home/eh930/project/apps/cerberus`; branch `wip`; last commit `d01ee27`.
- The working tree contains extensive **uncommitted and untracked** changes from the ongoing session. Do not reset, clean, or assume all changes belong to the latest request. No commit or push was requested.
- Current docs: [README](README.md), [documentation index](docs/README.md), [desktop architecture](desktop/docs/architecture.md), [desktop operations](desktop/docs/agent-operations.md), and [UI conventions](desktop/AGENTS.md).
- Earlier running notes were moved to `docs/archive/HANDOFF-previous.md` and `desktop/docs/archive/agent-operations-previous.md`. They contain superseded composer and identity descriptions.

## Product direction and current UI

The app is a repository-first viewer for multiple local agent histories and provider availability. The Repository Agent pane is read-only: it lists Codex, Cursor, Copilot, and Claude conversations when each provider is enabled and offers editor handoff buttons. The Identity page owns account connection and usage. `AgentsPanel` owns provider setup. Legacy composer/runner files still exist but are not exposed in the Agent pane.

Important paths:

| Area | Files |
| --- | --- |
| Repository and view state | `desktop/src/App.tsx`, `components/RepositoryCard.tsx`, `lib/repositories.ts` |
| Conversations and activity | `components/CodexHistory.tsx`, `components/AgentActivity.tsx`, `lib/conversationCache.ts`, `lib/conversationDisplay.ts` |
| Identity and usage | `components/IdentitiesPanel.tsx`, `components/IdentityCard.tsx`, `components/IdentitySignIn.tsx`, `components/CopilotQuota.tsx`, `lib/chatgptCapabilities.ts` |
| Provider backends | `desktop/src-tauri/src/{codex,cursor,cursor_editor,copilot,claude_history}.rs` |
| Tauri commands and external URL policy | `desktop/src-tauri/src/lib.rs` |
| Shared colors | `desktop/src/palette.css` |

`IdentitySignIn` is literally the same component in the Agent header and Identity page. Its menu has explicit shared CSS to avoid parent-pane button styles. `IdentityCard` places a visible **Initials** label and underlined text input beside the identity name; `identityInitials.ts` stores overrides. One Activity disclosure expands all intermediate updates, which are dimmed relative to the final answer. `conversationDisplay.ts` groups consecutive assistant messages from editor history without changing cached raw messages.

## Copilot diagnosis and remaining work

The user reported **“Copilot quota unavailable”** and **“Copilot: Copilot CLI: request cancelled.”** The prefixed error proves the failure occurs in `Client::start` in `copilot.rs`, before `account.getQuota` or `session.list`. The Copilot SDK classifies `RequestCancelled` as a transport failure: the CLI process or connection stopped during startup. The development shell has `gh` but no `copilot` executable on `PATH`; the user's desktop environment may differ. Do not claim an authentication or quota-permission failure without a live CLI diagnostic.

This turn added `start_client` to convert that raw SDK error into **“Copilot CLI stopped during startup. Check that the Copilot CLI is installed, up to date, and signed in; then retry.”** The Identity card now shows the actual error and retains **Open Copilot usage**. The CLI-backed quota path remains unable to show a number until its startup succeeds. Installing a provider tool must use the explicit in-app plan/approval flow in `desktop/AGENTS.md`; do not install one silently.

The SDK's `account.getQuota` result has a `quotaSnapshots` map. `premium_interactions` is rendered as **Premium requests**; other buckets, including AI credits when returned, also display. GitHub's current billing API can report AI-credit usage with a token that has the required Plan permission, but that is a different data source and was not added here. Existing OAuth device scopes are `read:user user:email repo`; do not assume they authorize the billing endpoint. GitHub's [SDK quota guide](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing) and [billing API reference](https://docs.github.com/en/rest/billing/usage) are the primary references.

Recommended next diagnosis on a machine with Copilot CLI installed: confirm `copilot --version`, the CLI's own login/status, and whether a minimal SDK `Client::start` succeeds with the assigned identity token. Do not log tokens. If startup succeeds, inspect only the shape of `quotaSnapshots` and verify the `premium_interactions` bucket for that account. A normal browser session may show usage even while the CLI path fails.

## Current request changes

- Replaced generic Copilot cancellation text with an accurate startup diagnostic in all Copilot calls.
- Made initials visibly editable with an inline label and underlined input, without adding a card row.
- Reorganized the project README and active desktop docs. Preserved old notes under archive directories.

## Verification and environment

This turn passed `npm run build` in `desktop/`; `cargo test --quiet -- --test-threads=1` in `desktop/src-tauri/` (54 passed, 2 ignored); the conversation-display and ChatGPT-capability checks; and `check-repository-ui.py 900 620` at zoom 100%, 140%, and 150%. `check-viewport.py 900 620` also passed at zoom 75%, 100%, 140%, and 150%. The WebKit UI checks require Vite on `127.0.0.1:3000`; do not start a second server on the same port. The real Copilot CLI startup and quota response could not be verified because `copilot` is absent from this development shell. See `desktop/docs/agent-operations.md` for commands.

Other provider limits: browser usage links cannot choose the active browser account; Claude transcript history currently reports no live processing state; repository Working reflects local app runs plus working state in loaded provider lists. Conversation providers remain opt-in.
