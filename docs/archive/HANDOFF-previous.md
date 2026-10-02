# Handoff — GitCerberus desktop (this conversation)

**Repo:** `/home/eh930/project/apps/cerberus`  
**Branch:** `wip` (tracks `origin/wip`)  
**Last pushed commit:** `d01ee27` — *Keep repository navigation dense and off the conversation render path.*  
**This conversation’s work is uncommitted** (plus untracked `desktop/src/lib/conversationCache.ts`).

Eric is the engineer. The app is Tauri 2 + React 18 + Vite (port 3000). Use `desktop/src/components/Select.tsx` for dropdowns (no native `<select>`). Dashboard panes fill the viewport; conversation providers are opt-in. Do not hide repository details to solve overflow.

---

## What shipped on `wip` already (`d01ee27`)

Dense single-line repo cards, owner/visibility corner labels, Assign account (person button, not an inline combobox that stole Up/Down), account badge with GitHub avatar, official Cursor cube icon, Disconnect/Reconnect for GitHub identities. That commit is on the remote.

---

## What this conversation added (working tree)

### 1. Conversation pane: cache, recency scroll, no deferred render

Switching repositories was slow (~1s) and no longer scrolled to the latest user prompt. `useDeferredValue` / remounting was the wrong fix.

**Approach:** in-memory cache in `desktop/src/lib/conversationCache.ts`.

- Key thread lists and messages by repository + provider; treat a thread as fresh when cached `updatedAt` is ≥ the list entry’s `updatedAt`.
- Show cache immediately, revalidate in the background. Dedupe in-flight fetches. Warm local repos (`warmRepository`: list + first 8 threads’ messages).
- Revalidate on window focus, a 20s poll, and explicit Refresh (Refresh forces message refetch).
- `CodexHistory.tsx` peeks cache during render; `useLayoutEffect` scrolls to the last `.codex-message.user` (plus rAF). Markdown nodes are reused for the same message text.

`App.tsx` passes a live `historyRepository` (not a deferred value) and `localRepositories` for prefetch.

### 2. Commit history branch must not be remembered

`CommitHistory` remounts with `key={historyRepository?.id}`. On repository switch, always open that repo’s **current** branch. Do not keep a previously selected branch name just because it also exists on the next repo.

### 3. Control tray position

Selected-card action tray is horizontally centered (`left: 50%; transform: translateX(-50%)`) so it mainly covers the **next** card’s branch column, not the whole row. `selectControl` scrolls the tray into view (nested rAF) so it is not clipped by the list pane.

### 4. “Last updated” sort

It previously took `max(github.updatedAt, lastCommitAt)`. GitHub `updated_at` includes issues/wiki, and git `%cI` dates were stored with a trailing newline so `Date.parse` often failed — local commits dropped to 0 and noisy GitHub timestamps won.

**Now:**

- Local: last commit time; uncommitted changes sort first.
- GitHub-only: `pushedAt`, then `updatedAt`.
- Rust trims `last_commit_at`. Catalog includes `pushed_at`.

Logic lives in `lastUpdated` / `filterAndSortRepositories` in `desktop/src/lib/repositories.ts`.

### 5. Filters, counts, owners, then compact toolbar

Facet counts: each option shows how many repos would match if you chose it with the other filters held (`filterMatchCount`). `Select` options may include `count` (rendered as `.option-count`). `data-value` is on options for tests.

Owner filter is a **checkbox list** (multi-select; none checked = all owners). Persisted as `owners: string[]`; old `owner` string in localStorage is migrated.

Status (dirty / ahead / behind / mismatch) moved in with visibility, presence, and owners. Sort is a separate control.

**Latest layout:** filter and sort are **hidden behind toolbar icon toggles** next to a short search field (`placeholder="Search…"`, no ⌘K chip). Filter = `ListFilter`, Sort = `ArrowDownWideNarrow`. A purple dot (`.toolbar-icon.armed`) means a non-default filter or sort is active. Add repository is a quiet plus; it is only for local checkouts GitHub did not list.

### 6. Identity assignment requires GitHub access

Any identity could be assigned to any repo. That is not meaningful for GitHub remotes.

- `mergeRepositories` records `accessibleIdentityIds` from every catalog row for that remote (not only the first identity).
- UI (`RepositoryCard`, configure/create dialog) only offers Unassigned + identities that appear in the catalog for that remote (`identitiesWithRepositoryAccess`). Until the catalog has loaded, GitHub-connected identities are still listed.
- Backend: `github::ensure_identity_access` does `GET /repos/{owner}/{repo}` with that identity’s token. Used from `assign_repository_identity`, `update_repository`, and `create_repository`. Non-GitHub remotes are not checked this way (commit identity still applies).

Demo `api.assignIdentity` uses the same catalog rule.

### 7. Refresh GitHub button removed

It only re-fetched the GitHub catalog; local git status already refreshed on focus. Catalog + local list now refresh on **focus / visibility** and every **30s** while the window is visible. Summary can show “Updating GitHub…” and existing warning text. There is no manual refresh control.

---

## Files to know

| Path | Role |
|------|------|
| `desktop/src/lib/conversationCache.ts` | Thread/message cache, warm, `updatedAt` freshness |
| `desktop/src/components/CodexHistory.tsx` | Cache-backed browser, scroll to last user prompt |
| `desktop/src/components/CommitHistory.tsx` | Branch reset via remount key from App |
| `desktop/src/lib/repositories.ts` | Merge, access IDs, filters, last-updated sort |
| `desktop/src/App.tsx` | Toolbar toggles, GitHub poll, filter state, `selectControl` scroll |
| `desktop/src/components/RepositoryCard.tsx` | Assign-account menu filtered by access |
| `desktop/src/components/RepositoryConfigDialog.tsx` | Same access filter on Identity field |
| `desktop/src/components/Select.tsx` | Option counts, `data-value` |
| `desktop/src-tauri/src/github.rs` | `pushed_at`, `ensure_identity_access` |
| `desktop/src-tauri/src/lib.rs` | Trim commit date; assign/update/create access checks |
| `desktop/scripts/check-repositories.mjs` | Merge, sort, owners, access unit checks |
| `desktop/scripts/check-repository-ui.py` | WebKitGTK UI: toggles, filters, tray, zoom |

---

## Persistence

`localStorage`:

- `gitcerberus.repositoryFilters` — `{ owners, visibility, presence, status, sort }`
- `gitcerberus.paneSplit`, `gitcerberus.uiZoom`, `gitcerberus.providers`

Filter/sort **panels** are not persisted; they start closed. Active criteria still apply (dot on the icon).

---

## How to verify

```bash
cd desktop
./node_modules/.bin/tsc --noEmit
node scripts/check-repositories.mjs
node scripts/check-dropdowns.mjs
# Vite on :3000, GTK/WebKitGTK:
/usr/bin/python3 scripts/check-repository-ui.py
```

Last full UI run in this conversation: passed at 900×620, 1100×700, 1720×1080, 2200×700, zooms 1 / 1.4 / 1.5.

WebKitGTK often prints `free(): corrupted unsorted chunks` / `corrupted double-linked list` after a **successful** check; that is process teardown noise, not a test failure.

Manual:

- Last updated: dirty local work first, then local commit time; GitHub-only by push time.
- Assign account on a GitHub checkout: only identities that list that repo (e.g. demo `backend-api` → Unassigned + `@octocat`, not the personal account).
- Filter/sort icons open the panels; Add repository is icon-only; no Refresh GitHub.

---

## Conventions / traps

- Do not put a combobox in the selected-card tray in a way that captures ArrowUp/Down; Assign account is a button that opens `Select` only on click/`I`.
- `check-repository-ui.py` must **open** Filter/Sort toggles if they are closed; do not click a toggle that is already `aria-pressed=true` (that closes the panel). Combined filter case: northstar checkbox + Private + Folder not linked → `design-system`.
- Conversation cache must not be imported from `check-conversations.mjs` if that pulls `./api` in Node.
- GitHub OAuth client id in `desktop/build.env` is public (`GITCERBERUS_GITHUB_CLIENT_ID`); not a secret.

---

## Not done

- No commit/push of this working tree (Eric did not ask).
- Identity access for GitLab/Bitbucket is not API-checked.
- GitHub poll is 30s, not a live webhook.
- Filter/sort disclosure state is session-only.
- `cargo test` / `cargo check` were not re-run after the `ensure_identity_access` / `pushed_at` Rust edits in the last pass.

---

## Follow-up: anchored filters, responsive sidebar, local agents

The later changes below supersede the owner/filter notes above:

- Owner checkboxes are vertical under **Select all**, with mixed state. All selected → clear all (zero results); otherwise → all owners. `ownersExplicit` distinguishes an explicit empty selection from the historical `owners: []` meaning all. Legacy preferences migrate without changing their results.
- Filters open directly beneath the filter button, clamped to the viewport; Sort is now a single-click `Select` icon with its choices directly underneath. Escape/outside dismissal and zoom positioning are covered by UI checks.
- Sidebar labels have explicit flexible bounds and wrap instead of clipping in the narrow repository layout. Card density and floating trays are preserved.
- The former inert Automation navigation now opens **Agents**. `components/AgentsPanel.tsx`, `src-tauri/src/agents.rs` and `lib/agentOutput.ts` implement named API-key billing profiles in the OS keychain, explicit local checkout selection, sandboxed Codex/Cursor analysis and edits, streamed logs, cancellation, and a per-checkout run lock. Profile credentials and Git identities are distinct. Cursor execution uses Agent CLI, while the SDK bridge remains for history.
- See `desktop/docs/agent-operations.md` for exact operations, official documentation, setup and limitations. No paid inference was run; no CLI was silently installed. Browser-login multi-account auth, persistent run restoration, resume, interactive approvals and scheduling are future work.
- Tests: production build, repository logic, agent event formatting, Rust unit suite, WebKitGTK viewport and actual UI matrices. Updated UI checks include all/none owner semantics, vertical stacking, anchored popovers, sidebar bounds, and Agents navigation/dropdown placement at 100/140/150% zoom.
- Existing work is preserved. No commit or push made.


## Shared provider setup follow-up (September 20)

- `ProviderSetup.tsx` is now shared by history and Agents. Removed duplicated CLI path fields and terminal instructions; advanced path selection, auto-detection reset, optional Cursor SDK installation and reference docs live under Advanced settings.
- `provider_paths.rs` resolves existing saved settings, environment overrides, PATH, common locations and legacy profile paths. Codex history and agent tasks use the same saved executable. Cursor Agent and the history bridge remain distinct executables managed in the same screen. Cursor editor history still needs no executable.
- Agent execution resolves shared settings at run time. New profile names are generated; custom names are advanced. Missing executables automatically bring new-profile setup into view; the selected repository is carried into Agents.
- Added app-driven Cursor Agent installation using the official platform installer. All installers show their plan with a single explicit install button and save detected paths. No tools were installed on this developer machine and no paid inference was used to validate this change.
- Codex reset clears the cached app-server connection. Existing profile API credentials and history opt-in settings remain separate.
- Verification: production build, 29 Rust tests (2 live-history tests ignored), and shared-setup UI checks at 100/140/150% zoom. Final UI matrix passed all four window sizes at 100/140/150% zoom, including both shared-setup routes. An earlier demo-load failure during concurrent edits did not recur.


## Account/setup clarity and installer progress follow-up

- Empty billing-profile picker replaced with an explicit “Connect AI account” empty state explaining API-key credentials versus GitHub identity. Existing single-account configurations are selected automatically; multiple identities still require a choice. Disconnect lives under account settings. Removed duplicate provider-setup entry in the connection form.
- Removed redundant Done button from Agents setup. History setup explicitly says “Use for conversations”; Close setup dismisses already-saved settings. Close/path changes are disabled during installation; Stop remains available.
- Agent editor-launch buttons now reuse Cursor/VS Code logo components.
- Diagnosed user's Cursor installer: it was downloading/extracting, not stopped. The official archive was 182,574,768 bytes. That user-started attempt finished successfully; `~/.local/bin/agent --version` returned `2026.09.18-9a7762b`, and the shared path file was saved. No repeat installation is needed.
- Replaced newline-buffered installer readers with incremental chunk decoding (`terminal_text.rs`) that handles split UTF-8, CSI/OSC escapes and carriage-return progress. Added elapsed-time status, bounded curl connection/stall retries, clearer timeout errors and pre-install reuse detection. Added tests proving progress arrives before subprocess exit.
- Provider setup polls for externally completed installations while idle. Cursor detection includes the legacy `cursor-agent` alias and completed, non-temporary version directories.

## Unified agent popup and card-based Agents page (2026-09-20)

- `App` now owns one `ProviderSetup` popup, opened by both conversation setup and agent cards. It portals outside the inert app shell, traps focus, restores focus, supports Escape/backdrop dismissal, and scrolls internally. Provider dropdown menus sit above the popup and follow app zoom. Installing/saving prevents accidental dismissal.
- Replaced route-specific “Use for conversations”/“Close setup” buttons with an explicit persisted history checkbox and one Close button. Shared `providerPreferences.ts` synchronizes changes with history and agent cards; opening setup alone never opts into history.
- Agents now shows Codex/Cursor cards with detected installation, API-account count, history visibility, running count, and per-account New task actions. Installed agents sort first. Removed the central account picker and inline account/setup forms. Running output remains mounted across navigation.
- Popup manages API accounts and provides inline key-creation instructions plus direct OpenAI API keys/Cursor dashboard buttons (exact URLs allowlisted in Rust). Account naming and executable overrides are under advanced settings. Saved keys are labeled “Key saved,” not authenticated; actual credentials are checked by the provider on run.
- Existing optional ChatGPT history sign-in remains in the conversation header. API-key task execution behavior is unchanged.
- Build, 31 Rust tests (2 integration tests ignored), agent-output/repository checks and viewport matrix passed. Updated WebKit interaction coverage checks identical modal content from both entry points, keyboard provider switching, Escape hierarchy, focus restoration and popup bounds. No paid agent request or credential creation performed.

## Repository-first chat UI (2026-09-21)

Supersedes the prior popup checkbox / Agents task-composer layout:

- Navigation is hidden initially and opens as an overlay from the top-left app icon. Search leaves room for the icon; navigation does not resize repository tracks. Keyboard reference is available from this menu.
- History provider checkboxes live only in the conversation header. Removed their duplicate from ProviderSetup. Setup still has one shared popup and automatic installation/path detection/account management.
- Agents is configuration/status only. Actual chat lives in the selected local repository’s conversation pane: compact title-only history cards (metadata in tooltips), app chat cards, bottom composer, explicit API account and Analyze/Edit permissions, Send and Stop. Agent activity is collapsed beneath replies. Imported IDE history remains readable.
- `agentChats.ts` keeps app chats/runs alive across repository/tab navigation without keeping UI panes mounted. Follow-ups pass prior messages as context to the existing CLI runner. Replying to IDE history creates a new app chat from loaded messages, explicitly labeled in the composer. It does NOT resume or mutate the original IDE session. Chats and drafts are currently window-session state, not restart-persistent. No paid run was used in validation.
- New leftmost/default repository action: Chat with agent (A). It focuses the composer; Escape restores the selected repository control. Ctrl+Up/Down cycles new/app/imported conversations without changing focus or repository selection. Ctrl+Enter sends; plain Enter inserts a newline. Hover does not steal focus from the composer. Drafts are scoped to repository and conversation, and selected conversations survive repository navigation.
- `shortcuts.ts` centralizes stable command IDs, labels, modifiers and aliases for repository/control/conversation/commit/branch/zoom navigation and send/focus actions; repository action keys also live there. Control-local accessibility behavior stays in controls. No user customization UI yet; definitions are ready to extend.
- Validation: production build, repository logic, agent event formatting, new mocked chat tests (routing, account isolation, multi-turn context, streaming, cancellation/failure, prompt byte bounds, shortcut matching), WebKit viewport matrix and interactive UI across 900×620, 1100×700, 1720×1080 and 2200×700 at 100/140/150% zoom. Additional minimum-size regression checks cover draft isolation/restoration, A/Escape focus, hover protection, Ctrl+Up/Down and composer permissions menu. WebKit may print allocator warnings during successful test-process teardown (existing environment issue).

## Provider legend, scoped setup, and focus ownership (2026-09-21)

- Restored Codex green and Cursor purple name labels in the Agent header, using the same CSS variables as conversation-card accents. App-created chats also carry their provider accent. Each provider has its own adjacent setup button.
- ProviderSetup now takes the chosen provider from its entry point, titles itself Codex/Cursor setup, and has no provider selector. Removed the repeated installation/history explanation and shortened account copy. Installation and account-key instructions remain.
- `workspaceFocus.ts` owns repository-screen focus. Clicking browsing controls preserves the selected repository control/chat input; Tab cycles between those two. Conversation/message/commit browsing and dropdown menus cannot take DOM focus. Commit navigation no longer calls focus(). Select uses keyboard event forwarding when opened in this workspace, preserving its prior focus owner while retaining arrows/typeahead/Enter/Escape/outside-close behavior. Modals and explicit search/settings text entry remain editable. This interpretation was stated while an optional clarification question about the scope of the focus rule was pending.
- Official documentation confirms the current new-chat/restart limitation is our adapter's implementation, not a provider-wide prohibition: Codex app-server powers its VS Code extension and supports thread/resume followed by turn/start; codex exec supports resume too. Cursor ACP supports session/load. Neither that ACP documentation nor reading an IDE transcript establishes that arbitrary Cursor IDE database records are resumable CLI sessions. Our current adapter still replays context in fresh CLI runs and keeps UI chats in window memory; native resume/persistence is not implemented in this UI-fix pass.
- Verification includes production build, chat/repository/event checks, viewport matrix, and UI regression tests for provider color agreement, provider-specific setup from both entry routes, no provider selector, commit/conversation focus preservation, two-stop Tab cycle and dropdown navigation without transferring focus.


## Full-card scrolling, native chat continuation and key confirmation (2026-09-21)

- `repositoryScroll.ts` scrolls the repository viewport to reveal the entire selected card, accounting for CSS zoom. The floating tray is included when it fits; it never takes priority over the card. `App.selectControl` remains the common selection entry point.
- Native continuation replaces transcript replay for resumable sessions: Codex `exec resume` and Cursor `--resume`. `agent_sessions.rs` persists session/profile/canonical-repository associations; preflight and execution both validate them and local provider storage. Imported Codex history can resume after validating its rollout and original home. Cursor IDE/SDK records are explicitly marked as requiring a new chat, rather than assuming CLI compatibility. Missing or mismatched sessions never silently fall back to new runs.
- App chats persist in localStorage without credentials, retain provider session IDs across restarts, and show interrupted runs as stopped. The composer offers Continue chat or explains New chat required with an explicit Start new chat action that carries loaded context and preserves the original. Ctrl+Enter does not silently replace an unresumable conversation. Native follow-ups send only the new prompt. Output reader threads finish before run completion is reported.
- ProviderSetup replaces the key form after successful OS-keychain storage with API key added, Add another key and Close. Close receives focus; Add another clears/focuses the input. Duplicate submissions and saving during installation are blocked. This confirms storage, not provider authentication.
- UI regression tests now cover full-card keyboard scrolling, successful key submission/repeat/close, and native-resume/unavailable indicators. The composer scrolls internally if expanded status text exceeds the available space at high zoom. Test startup reports an unavailable Vite server immediately.
- Final verification: production build; 35 Rust tests passed, 2 live-history tests ignored; chat/repository/activity checks; WebKit interaction matrix at 900×620, 1100×700, 1720×1080 and 2200×700 at 100/140/150% zoom; viewport matrix also at 75%. All passed. No paid inference, credential creation, commit or push.

## Chat defaults, permissions, edit summaries and resume diagnostics (2026-09-22)

- Conversation account menus contain only real accounts for the selected provider. A sole matching key is automatically selected even when other providers have keys. Multiple accounts retain an explicit selection; the unselected trigger text is not an option. App chats retain their original account binding.
- Repository entry opens the newest conversation across imported history and local app chats. Explicit browsing/New chat remains respected until leaving that repository. Removed remembered New chat defaults. Edit workspace is the default permission; Analyze remains selectable and both still enforce the backend sandbox.
- Composer grows with text to a bounded, scrollable size; typing scrolls the message pane to its bottom. Removed the persistent monitoring toast. Actual operation notices live in the existing summary row with dismissal, without overlaying content.
- Diagnosed the user's exact saved continuation failure: Codex reported `already has an active writer`, not an authentication or CLI argument failure. Another Codex process owns the selected session. Never kill it or break provider locks. Streamed error details are now included in rejected runs with key redaction; UI translates writer conflicts into instructions to close the other session and retry or explicitly start a separate chat. Failed-before-turn attempts offer Retry last message without duplicating the user prompt. Existing saved writer errors migrate to the readable explanation/retry state.
- Codex imported history attaches completed fileChange items (including available diffs) to each turn's last assistant response; failed/declined edits are excluded. Cursor local editor history recognizes completed edit_file_v2 tool metadata with before/after content IDs and relativeWorkspacePath, attaching file summaries to the response at the end of that user turn. Unsupported formats remain without fabricated summaries.
- App runs collect completed Codex file_change and Cursor writeToolCall events, plus a before/after fingerprint comparison of tracked and non-ignored untracked files to catch shell edits. No index changes or file contents are persisted by the snapshot. Pre-existing unchanged dirt is excluded; observed concurrent changes are labeled as such. Summaries persist with each assistant turn and appear beneath its response. Absolute provider paths normalize to the checkout before combining summaries.
- UI matrix passed four window sizes at 100/140/150%, including provider-filtered sole-key selection, latest-on-repository-entry, growing composer, and no overlay. Added tests for edit attribution, active-writer explanation, retry prompt deduplication, and existing dirty worktree comparisons. The existing Vite server was user-started; leave it running (do not repeat the prior testing-server port conflict).
- Final checks: production build and frontend logic checks passed; 38 Rust tests passed, 2 live-history tests ignored. Minimum-window regression also passed with a long scrolling transcript and rendered edit overview. One earlier fixture-executable run hit transient Linux ETXTBSY; the final full Rust run passed. No paid inference or forced session takeover was performed.

## Conversation rail, searches, isolated edit review and billing errors (2026-09-22)

- `shortcuts.ts` adds F repository search, Ctrl+F repository conversation search, Ctrl+Shift+F current-transcript search, Ctrl+Shift+Home/End beginning/end and Ctrl+PgUp/PgDn prompt/response navigation. The right-hand rail displays matching shortcut hints; actions preserve repository/chat focus. Search text fields are explicit editable exceptions. Modal shortcuts do not leak to repository selection.
- `conversationSearch.ts` walks enabled providers' active/archived list pages and all message pages, includes local app chats, cancels stale query work between requests, and reports partial search errors. `ConversationSearch.tsx` displays snippets and opens matching conversations. In-conversation search loads older pages as needed, highlights text safely through a rehype tree transform, and cycles matching messages. Navigating to the beginning loads older pages.
- File details moved from inline expanding details to a compact review button plus `EditReview.tsx` portal dialog. File list, colored +/- diff lines and hunk headers, independent scrolling, unavailable-diff copy, focus trapping, Escape and backdrop close; transcript geometry stays unchanged.
- Main composer button says Send for resumable chats as well as fresh chats. Explicit Start new chat remains for nonresumable history. Actions are sticky within the composer so long input/status content does not hide the primary action.
- User's new error is explicit API credit exhaustion after successful session initialization. Added provider-diagnostic detection that stops retries and preserves billing-specific status, readable item.error activity and Open API billing action. No credits were added, credentials changed, paid requests made or other sessions killed.
- `agent_sessions::recorded_model` reads validated local rollout metadata and selects the last completed turn's model (first recorded fallback), ignoring a later failed resume's default. `--model` is passed on resume; installed CLI syntax verified using --help without inference. Existing session/profile/repository validation remains.
- Final validation: production build, 41 Rust tests (2 live-history tests ignored), chat/event/repository/search logic checks, four-window viewport and interaction matrix at 100/140/150% zoom (viewport also 75%). Final minimum-window rerun explicitly verifies Send stays inside the composer. User-started Vite server retained; no testing server started or left behind. No commit/push.

## ChatGPT identities and direct search navigation (2026-09-23)

- ChatGPT browser authentication now lives in Identities, using official Codex app-server `account/login/start`, completion notifications, account read, cancel and logout. Each identity has a UUID-scoped CODEX_HOME and Codex-managed OS keyring credentials. The older history-only sign-in control was removed. CLI installation/path setup stays shared.
- First completed authentication becomes the inherited default for existing and future repositories. Identities → Default account settings changes it. Repository tray action T assigns an explicit account, no account, or inherited default. Stable remote keys retain assignments when a listed GitHub repo is linked/cloned. GitHub identities remain independent.
- Subscription runs force ChatGPT authentication and remove API-key/access-token environment overrides. Assigned accounts take priority; disconnected assignments cannot silently fall back to API billing. API profiles remain available where no subscription is assigned. Switching the account of a saved app chat requires explicitly starting a new chat. Imported Codex history is validated and copied to the selected identity's private session directory for continuation without changing the IDE history or credentials.
- Repository search highlights the existing cards, selects the first result and scrolls to a highlighted occurrence. Enter advances through occurrences and then across matching conversations, including archives; Shift+Enter reverses across boundaries. Local conversation search uses the same next/previous keys. Searches retain provider opt-in and complete-page loading. No separate snippet-result list.
- Dropdown positioning clamps offscreen anchors to the viewport, including default account settings at high zoom.
- Verification includes mocked browser-auth completion/default behavior, credential isolation, private rollout-copy safety, inherited/explicit/disabled assignment semantics, and UI forward/backward search across conversation boundaries. No real browser login or paid inference is performed by these tests.
- Final checks: production build and frontend logic checks passed; 43 Rust tests passed, 2 live-history tests ignored. Four-window interaction matrix passed at 100/140/150% with mocked sign-in, repository assignment/reset, Escape/outside dismissal, and Enter/Shift+Enter across conversations. Viewport matrix also passed at 75%. Existing dev server was no longer running on continuation; the temporary server started for these checks was stopped afterward to free port 3000. No commit/push or paid inference.

## Unified identities and subscription runtime correction (2026-09-23)

- One identity list combines GitHub and ChatGPT cards, distinguished by logos. Removed separate account headings and explanatory paragraphs. ChatGPT sign-in moved into Add identity; the OpenAI icon in the conversation header opens the same global popup in place. Popup supports cancellation, Escape, focus containment, and concise status. Default selection stays collapsed.
- Local read-only diagnosis confirmed the existing saved account is recognized as ChatGPT by both CLI login status and a newly spawned app-server with the account's private home/keyring settings. No token contents were printed and no model turn was run. The supplied failed exec/resume log was unauthenticated at the API endpoint; the precise internal exec credential-loss cause was not proven.
- Subscription execution now uses `subscription_run.rs`: launch app-server with isolated credentials, verify account type/email in that process, start/resume thread, and start a turn with explicit never-approve/read-only or workspace-write policy. Use recorded model on resume; keep Git identity environment. This removes the unverified exec authentication handoff. API and Cursor runs retain their prior runner.
- Client transport optionally queues early notifications so streaming events preceding an RPC response are retained. Completed responses/commands/file changes map to existing frontend events. Turn errors and cancellation terminate the owned process tree; 401 errors stop retries and mark the assigned identity disconnected for reconnection. No API fallback for subscription identities.
- OpenAI mark vendored from Simple Icons 13.21.0 (`icons/openai.svg`, CC0 collection); render locally, no external image request at runtime.
- Additional live protocol-only validation: the affected subscription session was accepted by `thread/resume` with read-only/never-approve settings; `account/read` reported ChatGPT before and after resume. No `turn/start` request or inference was performed. The diagnostic process was terminated afterward, releasing the session.
- Validation: production build, frontend logic checks, full Rust suite (47 passed / 2 live-history tests ignored before the added 401 regression), and four-window interaction/viewport matrices passed at 100/140/150% (viewport also 75%). Dedicated subscription tests cover same-process auth/resume/turn ordering, early notifications, permissions, missing credentials, and immediate 401 retry termination. Existing user-started Vite server was left running; no extra server was started. No commit/push or inference.

## Explicit ChatGPT labels and compact repository account badges (2026-09-23)

- Reused the existing unified identity list, Add identity cascade, Conversation header sign-in, and shared login popup. Default summary, identity marker, no-default option, and repository assignment option now explicitly name ChatGPT.
- Repository headings show a compact OpenAI logo + colored account initials badge beside the existing GitHub avatar, without adding a row or changing card height. The same badge appears in the unified identity list. Tooltips expose full account label, inherited default, and disconnection. Dashed logo/dash means no account; a dashed colored badge denotes disconnection. The assignment tray uses the OpenAI logo too.
- Production build, account/default logic checks, repository checks, and diff whitespace check passed. GUI checks were attempted but this restricted session cannot access GTK's display or the local dev-server socket (Operation not permitted); the changed layout has not been revalidated in the zoom matrix here. No server was started, no credentials accessed, no inference or commit/push.
