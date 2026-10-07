# Desktop operations

## Run the app

From `desktop/`, run `npm run dev` for the browser demo or `npm run tauri dev` for native Git, SQLite, credentials, and provider commands. `npm run build` checks TypeScript, the dropdown convention, and the production bundle.

The Repository view lists local and GitHub repositories. Select a local checkout to read its enabled provider conversations in the Agent pane. Use the VS Code or Cursor button to continue interactive work. The Agents view is for provider setup and accounts; the Agent conversation pane currently has no composer or model selector.

The Identity page manages ChatGPT, GitHub, Cursor, and Claude identities. Each identity icon carries editable initials beside the account name. ChatGPT rate limits display on its account card when available. GitHub cards try Copilot CLI quota and always offer a web usage link. Cursor and Claude cards link to their web usage pages. A web link uses the browser's current login, which may differ from the card's account.

## Copilot startup and quota

Copilot conversations are the editor chat sessions saved for the repository folder. Listing them does not start the Copilot CLI. Quota still uses the official Copilot SDK with the connected GitHub account's saved token. A connected GitHub identity does not by itself install a CLI.

If the Agent pane says the Copilot CLI stopped during startup:

1. Check that `copilot` is installed and available to the desktop app's `PATH` (`copilot --version`).
2. Check the CLI's own sign-in/status using its documented commands, then update it if its SDK protocol is incompatible.
3. Reopen the Identity page or refresh the Agent pane. The web **Open Copilot usage** button remains available while local quota fails.

The previous raw `Copilot CLI: request cancelled` message came from SDK `Client::start`; it did **not** prove that `account.getQuota` rejected the GitHub identity. The current backend translates this transport error into a startup diagnostic. The CLI was absent from the development shell's `PATH` during this handoff, so live quota recovery was not verified here.

The Identity card labels `premium_interactions` as **Premium requests** only when that bucket has a positive entitlement. Chat, Completions, and a 0/0 premium snapshot are unlimited and stay hidden. Usage is not repeated on the repository action tray. The source is `src-tauri/src/copilot.rs`; the renderer is `src/components/CopilotQuota.tsx`.

## Provider setup rules

GitHub repository access and Copilot use the same native token. On Linux, a
`Secret Service: no result found` error can mean that the active password manager
has no default collection. New connections use the named GitCerberus collection
and verify that the saved token can be read before confirming sign-in. The system
password manager may prompt to create or unlock that collection. Keep the same
Secret Service provider active between sign-in and execution; switching between
GNOME Keyring and KDE's service can make another provider's saved tokens invisible.
Unlock or repair unavailable storage before reconnecting accounts. No plaintext
token fallback is used. Reconnection queues a fresh repository catalog lookup
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

The first Rust test checks usage-link allowlisting. The full suite also covers provider parsing and repository behavior. Tests use fixtures and do not start a real paid agent turn.

The Agent pane header includes **Copy checkpoint commit prompt** and an adjacent editor when a repository is selected. The prompt is copied for use with an agent working in an external IDE. Its built-in wording asks the agent to account for all working-tree changes, complete the current task, update affected documentation, run relevant quality checks, inspect staged changes, make a coherent commit without pushing, and report the result. Users can edit the template; the custom text is stored locally under `gitcerberus.checkpointCommitPrompt.v1`. **Restore default** restores the built-in wording in the editor, and Save applies it. The app copies the text only; the user pastes it into the intended agent conversation.

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
is kept. Cleanup never removes the agent's separate correction branch or a blocked
run's checkout. Resuming a cleaned conversation recreates its original revision.

Sleep protection requests an OS inhibitor during active app jobs or detected local
agent work. Long suspend gaps do not consume the runner's active timeout budget.
A surviving connection continues on wake; a broken connection requires explicit
retry with the saved session and inputs. No upstream handoff or paid turn is replayed
automatically merely because the machine wakes.
