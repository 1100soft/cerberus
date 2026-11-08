# Desktop operations

## Run the app

From `desktop/`, run `npm run dev` for the browser demo or `npm run tauri dev` for native Git, SQLite, credentials, and provider commands. `npm run build` checks TypeScript, the dropdown convention, and the production bundle.

The Project view lists local and GitHub repositories. Select a local checkout to
read its enabled provider conversations in the Agent/Script pane. Codex
conversations can be started and continued directly here: use the new-conversation
icon, or select an existing Codex thread and type a follow-up. Ctrl+Enter sends;
the square button stops the current task. Other providers remain history viewers
with links to their editors. The Agents view is for provider setup and accounts.

Codex uses the project's assigned ChatGPT identity, or a selected connected Codex
API account when no ChatGPT identity is assigned. Existing app conversations keep
their account binding; changing the assigned account requires a separate chat.
Available subscription models and reasoning choices come from that account's
runtime catalog. Permissions default to Project access and can be set to Read
only or Full access. New conversations work in the primary project checkout;
continuing an automation conversation preserves its original isolated context.

Imported Codex/IDE conversations resume the same local session when supported.
A missing or busy session never silently becomes a different conversation: the
composer reports the resume problem and offers an explicit separate chat using
the loaded history when available. Prompt drafts survive navigation between
conversations/projects while the app stays open. Account or authentication errors
remain visible without disabling automations. The VS Code link is optional for
Codex work; its extension does not need to be running.

The Identity page manages ChatGPT, GitHub, Cursor, and Claude identities. Each identity icon carries editable initials beside the account name. ChatGPT rate limits display on its account card when available. GitHub cards try Copilot CLI quota and always offer a web usage link. Cursor and Claude cards link to their web usage pages. A web link uses the browser's current login, which may differ from the card's account.

Codex's project email/feedback tool guidance is supplied as runtime developer
context, separately from the message you type. Native project/repository/label
checks still enforce scope. Older app-created histories restore the original
visible prompt when a recognized helper suffix can be matched to the saved
message; raw history is preserved. Ordinary authored or quoted instructions are
not removed by guessing.

While a conversation runs, the pane shows assistant checkpoint/status responses
without tool commands, raw activity or file-edit details. Completed activity
remains available in collapsed details. Conversation search follows what is
currently visible rather than matching hidden live traces.

Conversation output follows the bottom only while you are already there. Scroll
up to read without being pulled back; returning to the bottom resumes following.
Opening another conversation goes to its latest response, not its latest prompt.
Sending a prompt explicitly returns to the bottom and resumes following, even
when you were reading older messages; an active in-conversation search is cleared.
Completion and delayed content resizing preserve this behavior. Search keeps its
current match during incoming updates, and older-message requests cannot move a
different conversation after switching. A delayed provider-history refresh must
confirm the completed turn before replacing its saved response. If another Codex
conversation is running in the same checkout, **View running conversation** opens
it; Stop is available only in the conversation it controls.

## Conversation storage

Desktop conversations are saved in Cerberus's native SQLite database. WebKit's
localStorage quota is separate from agent credits and disk capacity. The desktop
keeps only a small pending recovery snapshot in browser storage, removing it once
the corresponding full conversation records are durable. Legacy browser backups
are preserved until their records have migrated successfully. Browser-only demo
backups are bounded recent-message previews, not a complete history archive.

A browser backup quota failure does not mean a successful native database save
failed. Genuine database/restore failures remain visible, and successful recovery
clears the sidebar and composer warning. Do not clear all application data to fix
a quota warning: that would also remove unrelated settings.

## Copilot startup and quota

Copilot conversations are the editor chat sessions saved for the project folder. Listing them does not start the Copilot CLI. Quota still uses the official Copilot SDK with the connected GitHub account's saved token. A connected GitHub identity does not by itself install a CLI.

If the Agent pane says the Copilot CLI stopped during startup:

1. Check that `copilot` is installed and available to the desktop app's `PATH` (`copilot --version`).
2. Check the CLI's own sign-in/status using its documented commands, then update it if its SDK protocol is incompatible.
3. Reopen the Identity page or refresh the Agent pane. The web **Open Copilot usage** button remains available while local quota fails.

The previous raw `Copilot CLI: request cancelled` message came from SDK `Client::start`; it did **not** prove that `account.getQuota` rejected the GitHub identity. The current backend translates this transport error into a startup diagnostic. The CLI was absent from the development shell's `PATH` during this handoff, so live quota recovery was not verified here.

The Identity card labels `premium_interactions` as **Premium requests** only when that bucket has a positive entitlement. Chat, Completions, and a 0/0 premium snapshot are unlimited and stay hidden. Usage is not repeated on the project action tray. The source is `src-tauri/src/copilot.rs`; the renderer is `src/components/CopilotQuota.tsx`.

## Provider setup rules

GitHub repository access and Copilot use the same native token. On Linux, a
`Secret Service: no result found` error can mean that the active password manager
has no default collection. New connections use the named GitCerberus collection
and verify that the saved token can be read before confirming sign-in. The system
password manager may prompt to create or unlock that collection. Keep the same
Secret Service provider active between sign-in and execution; switching between
GNOME Keyring and KDE's service can make another provider's saved tokens invisible.
Unlock or repair unavailable storage before reconnecting accounts. No plaintext
token fallback is used. Reconnection queues a fresh project catalog lookup
after any in-flight lookup and discards pre-reconnection results.

Conversation providers are queried only after configuration and opt-in. Provider installers must display their exact command plan and wait for explicit in-app approval. Do not silently install tools or run a paid inference call as a diagnostic. GitHub identities and provider billing accounts are separate assignments.

The desktop `open_external_url` command accepts exact approved destinations in `src-tauri/src/lib.rs`. When adding a usage link, update that allowlist and its URL test. In the browser demo, `api.openExternalUrl` opens a new tab.

## Verification

Commit history's trash button removes the selected local branch after a review
dialog lists the linked worktrees and matching remote branch. Removal uses
`git worktree remove` without force and `git branch -d` by default. Unmerged
branches require a second confirmation showing the branch and commit, plus an
explicit acknowledgement, before `git branch -D` is allowed. That confirmation
is bound to the inspected commit and merge status; changed plans require review
again. Forced branch deletion never forces worktree removal. Git's merge
check uses the branch's upstream when available, otherwise HEAD. The primary
worktree and the app-linked checkout are protected; switch their checkout before
removing their branch. Dirty and locked worktrees remain protected by Git.

The remote defaults to origin; the app's `REMOTE` environment variable can select
another configured remote. If origin is not configured, removal is local only.
Remote existence is checked by exact `refs/heads/<branch>` before confirmation;
network/authentication failures stop preparation. The plan is revalidated before
execution. A matching remote branch is deleted with a normal Git push, followed
by fetch/prune. This uses Git's configured authentication. A later push or fetch
can fail after local removal: the dialog reports completed steps and the error,
and refreshes the branch list. Cancellation is available during preparation;
execution runs through Git's steps once confirmed, without automatic rollback.

From `desktop/`:

```bash
npm run build
node scripts/check-conversation-display.mjs
node scripts/check-chatgpt-capabilities.mjs
/usr/bin/python3 scripts/check-saved-prompts.py
/usr/bin/python3 scripts/check-ci-automation.py
/usr/bin/python3 scripts/check-handoffs.py
/usr/bin/python3 scripts/check-card-reorder.py
/usr/bin/python3 scripts/check-viewport.py 900 620
/usr/bin/python3 scripts/check-repository-ui.py 900 620
```

The WebKit UI check requires a Vite server on port 3000 and GTK/WebKitGTK packages. It exercises 100%, 140%, and 150% zoom, including the shared sign-in menu, folded activity, usage button wiring, and initials placement. Some Linux WebKit test processes print a GLib allocator warning after a passing JSON result; use the process exit code and JSON `passed` value together.

From `desktop/src-tauri/`:

```bash
cargo test --quiet external_url_tests -- --test-threads=1
cargo test --quiet -- --test-threads=1
```

The first Rust test checks usage-link allowlisting. The full suite also covers provider parsing and project behavior. Tests use fixtures and do not start a real paid agent turn.

The Agent pane header includes **Copy checkpoint commit prompt** and an adjacent editor when a project is selected. The prompt is copied for use with an agent working in an external IDE. Its built-in wording asks the agent to account for all working-tree changes, complete the current task, update affected documentation, run relevant quality checks, inspect staged changes, make a coherent commit without pushing, and report the result. Users can edit the template; the custom text is stored locally under `gitcerberus.checkpointCommitPrompt.v1`. **Restore default** restores the built-in wording in the editor, and Save applies it. The app copies the text only; the user pastes it into the intended agent conversation.

## ChatGPT credential storage on Linux

Cerberus uses Codex's OS-keyring mode for ChatGPT accounts, with a separate
account home for each identity. It does not fall back to plaintext credentials.
A successful browser login is verified through a fresh Codex process before
the app marks the identity connected.

The Secret Service provider owning `org.freedesktop.secrets` must expose a
persistent default collection. An unlocked KDE wallet cannot supply that
collection when GNOME Keyring owns the endpoint. A missing default alias, locked
collection, or unavailable service is a storage problem; repair it before
reconnecting. Logout errors leave the identity state unchanged until credential
deletion succeeds. The app never silently skips deletion.

Inspect the active password manager and its default collection before changing
it. On the diagnosed desktop, the existing unlocked `GitCerberus` collection
was made GNOME Keyring's default. A temporary write/read/delete probe passed;
Codex then reported an ordinary signed-out state. Reconnect once to restore
the missing ChatGPT credential. Keep the same provider active across sessions.

App-owned automation conversations use durable SQLite storage rather than relying
on the WebView storage quota. Output and session identifiers are saved during a
turn, not only at completion. Successful runs release clean app-created worktrees
when every commit remains referenced elsewhere; dirty or uniquely committed work
is kept. Cleanup never removes the agent's separate correction branch. Active and
recently blocked runs retain their checkouts through the retention period. Resuming
a cleaned conversation recreates its final saved checkout revision.

Sleep protection requests an OS inhibitor during active app jobs or detected local
agent work. Long suspend gaps do not consume the runner's active timeout budget.
A surviving connection continues on wake; a broken connection requires explicit
retry with the saved session and inputs. No upstream handoff or paid turn is replayed
automatically merely because the machine wakes.

Account status is verified when Identities opens and when the app regains focus.
GitHub credentials rejected by GitHub and missing/expired ChatGPT authentication
show Disconnected with Reconnect. Network, runtime and credential-store errors
show Unavailable with Retry check and the specific error. Verification snapshots
do not persist a user logout or clear account assignments. A restart may expose
a credential persistence problem, but warnings do not claim it caused sign-out.

Cursor editor history is read locally without changing Cursor's databases.
The reader supports both older inline message indexes and the newer chunked
conversation indexes. Keep Cursor checked in the Agent/Script pane to include
these conversations; updating Cerberus's native reader requires an app restart.


Project activity indicators receive filesystem hints for Codex turn starts and
completion, even when another project or page is open. Hints update known threads
immediately and revalidate the affected project/provider after a short debounce.
They can discover a new conversation without first opening its project's pane.
Only enabled providers are queried. Cursor database changes also request activity
refreshes. Five-second reconciliation of known-working projects remains a fallback;
returning to the app checks known provider views. Failed reads do not imply that
work finished. Notifications contain session identifiers/status and project paths,
not prompts, tool output or credentials.

### Alternating between VS Code and Cerberus

Both clients use the native Codex conversation ID and shared history index.
Cerberus keeps authentication in its assigned account's private home while pointing
its Codex runtime at the editor runtime's resolved SQLite history directory
(`sqlite_home`, including `CODEX_SQLITE_HOME`/configuration overrides). New Cerberus
subscription conversations are discoverable through that index too. Resume uses
the indexed rollout path and `excludeTurns`, rather than treating paginated history
as unsupported or copying the active history into a separate conversation.

Migrated paginated sessions may depend on older immutable rollout files. Cerberus
validates that lineage and makes those bases available in its account home without
copying authentication or the active rollout. Original session and repository checks
remain enforced; a different session ID returned by the runtime stops execution.
Known-active turns in the other client must finish before continuing here. Work
alternately in the same session, rather than running overlapping turns from both
clients. Account selection remains explicit and independent of shared history.


Project change counts and change-count automation triggers exclude untracked
`.agent-artifacts/` scratch files. Ordinary untracked source files still count.
Explicitly staged or tracked artifact files count because they are part of the
commit's changes. This filter does not delete files or modify Git ignore rules.


### Diagnosing Linux native crashes

An AppIndicator deprecation warning is not itself fatal. A later `stack smashing`
message means a native stack-canary check failed; do not disable that check or
assume the tray caused it. Renderer-process reports must also be distinguished
from an abort of the main `gitcerberus` process.

For a reproducible native backtrace, quit other Cerberus instances, then run
`npm run diagnose:native` from `desktop/`. This builds the debug app, verifies its
frontend is reachable and runs it under GDB, stopping at a stack
canary failure or fatal native signal. Use the app normally until the failure.
Logs stay local under `$XDG_STATE_HOME/gitcerberus/native-crashes/` (normally
`~/.local/state/gitcerberus/native-crashes/`), with owner-only permissions. The
capture includes thread backtraces and loaded library paths, excludes frame
arguments/locals, and does not dump process memory or environment variables.
Native stderr is also recorded, so review a log before sharing it. Nothing is
uploaded. GDB is required. The launcher reuses a running Cerberus Vite server or
starts its own on port 3000 and stops only that process group on exit/failure. It
refuses an occupied port serving another application, and never silently changes
ports. Using an already-built binary still requires a working frontend. No system
crash settings or in-app signal handlers are changed.

`python3 scripts/check-native-crash-diagnostics.py` validates capture with small
sacrificial programs, without opening Cerberus or running any automations.
