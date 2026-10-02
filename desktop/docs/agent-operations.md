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

Conversation providers are queried only after configuration and opt-in. Provider installers must display their exact command plan and wait for explicit in-app approval. Do not silently install tools or run a paid inference call as a diagnostic. GitHub identities and provider billing accounts are separate assignments.

The desktop `open_external_url` command accepts exact approved destinations in `src-tauri/src/lib.rs`. When adding a usage link, update that allowlist and its URL test. In the browser demo, `api.openExternalUrl` opens a new tab.

## Verification

From `desktop/`:

```bash
npm run build
node scripts/check-conversation-display.mjs
node scripts/check-chatgpt-capabilities.mjs
/usr/bin/python3 scripts/check-saved-prompts.py
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

The Agent pane header includes **Copy checkpoint commit prompt** when a repository is selected. It copies a template for an agent working in an external IDE. The template asks the agent to review the diff, finish implementation, update affected documentation, format and check code quality, run relevant tests and builds, inspect staged changes, create a checkpoint commit, and report the hash and verification results. The app copies the text only; the user pastes it into the intended agent conversation.
