# GitCerberus

GitCerberus is a repository-first desktop workspace manager for developers who use multiple Git identities. It keeps the repository, Git author, editor environment, browser session, and automation context together so changing projects is one deliberate action.

This repository is transitioning from the original Linux `git-autopush` scripts to the cross-platform Tauri application described in `private/project_spec.docx`. The former implementation is consolidated under `legacy/autopush/` as reference material for the future automation engine; it is not part of the desktop application.

## Layout

```text
desktop/              Tauri 2 + React application
  src/                Dashboard UI and typed command client
  src-tauri/          Rust backend, tray, Git, SQLite
  migrations/         Forward-only SQLite migrations
website/              Product site (static)
docs/                 Roadmap and notes
legacy/autopush/      Former shell implementation (reference only)
```

## Website

The public site lives in `website/` and is the product destination linked from 1100 Software’s Products section. It uses the same framed tab layout (Home and Contact today; more sections can be added the same way) and Quicksand, with GitCerberus’s accent color. Open it locally with:

```bash
python3 -m http.server -d website 4173
```

Then visit `http://localhost:4173`. The app logo on the site is a placeholder.

## Current slice

The initial implementation includes:

- A React/TypeScript repository dashboard with responsive search and Git-state filters.
- Repository cards showing identity, branch, dirty counts, ahead/behind state, tags, last commit, and identity mismatches.
- Persistent drag ordering through a Tauri command.
- A resident tray lifecycle: closing hides the dashboard; tray actions restore it or quit.
- Persistent UI zoom with Ctrl/Cmd + mouse wheel, `+`, `-`, and `0` reset.
- Local repository import and refresh.
- Native filesystem folder selection when importing a repository.
- GitHub OAuth device flow, OS-keychain token storage, and repository-to-identity assignment.
- Dense 42px repository rows with hover/focus details and keyboard-first actions.
- A versioned SQLite schema covering devices, repositories, identities, tags, snapshots, identity bindings, and automation rules/runs.
- A typed Rust Git service with explicit working directories, non-interactive execution, structured errors, canonical remote handling, and per-repository mutation locks.
- Fetch, fast-forward-only pull, push, stage, unstage, and commit command foundations.
- VS Code and hosted-remote launch actions.
- A browser-only demonstration mode for UI development; real filesystem/Git operations activate inside Tauri.

Identity creation, device-specific editor/browser bindings, tray lifecycle, notifications, and the interval automation runner are the next end-to-end increment. The database already reserves their stable data model.

## Development

Prerequisites: Node.js 20+, Rust stable, the [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/), and Git. On Ubuntu/Debian, install the native desktop headers before the first Tauri build:

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

```bash
cd desktop
npm install
npm run dev          # browser demo with representative local data
npm run build        # type-check and production UI build
npm run tauri dev    # complete desktop application
```

Rust tests run with:

```bash
cd desktop/src-tauri
cargo test
```

Application data is stored in the OS-specific Tauri application-data directory as `gitcerberus.db`. Secrets do not belong in this database; only future credential-store references will be persisted.

### GitHub identities

You do **not** register your own GitHub OAuth App. GitHub also cannot sign an
app in with only a username: a token has to be issued through the product OAuth
app (browser device flow), GitHub CLI, or a personal access token.

- **Sign in with GitHub** uses GitCerberus’s public client ID from
  `desktop/build.env`, which is embedded by the Rust build script. Enable Device
  Flow on that one app. `GITCERBERUS_GITHUB_CLIENT_ID` can override the embedded
  value at runtime; tokens stay in the OS credential store.
- **GitHub CLI** reuses `gh auth login` on this machine.
- **Personal access token** needs `read:user` and `user:email`.

SQLite stores only a `keyring:github:<identity-id>` reference, never the token.

Repository navigation uses Up/Down, action selection uses Left/Right, and Enter
runs the chosen action. Direct shortcuts are `E` (VS Code), `G` (hosted page),
`F` (fetch), and `P` (push). Ctrl/Cmd+0 resets UI zoom.

The core deliberately does not assume GitHub, does not mutate global Git configuration, and does not infer identity from whichever account happens to be active elsewhere.

### Codex conversation history

The lower dashboard panel reads conversations from the local Codex App Server.
Install a current Codex CLI and make `codex` available on the desktop app's PATH.
Use **Setup → Choose Codex executable** in the conversations panel if a desktop
launch cannot find it. GitCerberus validates and remembers the chosen location
across restarts. `GITCERBERUS_CODEX_PATH` is a fallback when no path is saved.
The panel reports an actionable error and offers refresh if Codex cannot start.

GitCerberus reuses the local Codex account, or offers **Sign in with ChatGPT**
through Codex's browser flow. Codex owns credential storage; GitCerberus does not
copy tokens into its database. Stored sessions can also be browsed before sign-in.

Selecting a repository lists sessions whose working directory matches that
repository directory. Archived sessions have a separate toggle. Select a session
to read user and assistant messages, and use Refresh to pick up new activity.
Lists and long conversations support pagination. The viewer does not resume
sessions or send prompts. This is local Codex history, not an account-wide ChatGPT
chat archive; sessions started in a different directory or another worktree are
not included. Attachments are shown as placeholders and tool execution details
are omitted.

The integration uses the documented `initialize`, `account/read`,
`account/login/start`, `account/login/cancel`, `thread/list`, and `thread/read`
methods. It opts into experimental `thread/turns/list` for paginated messages,
with a full-history fallback on older servers that do not support pagination.
Protocol reference: https://learn.chatgpt.com/docs/app-server

### Cursor and the combined conversation list

The Conversations panel combines Codex and Cursor sessions, newest first. Each
entry has a named, colored provider badge. Provider checkboxes filter the list;
**Configured** labels distinguish a hidden provider from one that has not been
added. **Archived conversations** selects archived sessions. A provider
connection failure does not hide the other provider's sessions. Prompt bubbles,
plain assistant responses, and scrolling to the latest prompt apply to both.

Use **Add provider**, choose Codex or Cursor, and follow only that provider’s
installation instructions. Configured providers have their own **Setup** button.
Providers are opt-in: unconfigured or unchecked providers are never queried, and
configuration/filter choices persist across restarts.
For Cursor, install `pip install cursor-sdk`, or download a standalone
[`cursor-sdk-bridge` release](https://github.com/cursor/sdk-bridge/releases).
Check `cursor-sdk-bridge --help`, then choose that executable in GitCerberus if
it isn't on the desktop application's PATH. The chosen path is remembered;
`GITCERBERUS_CURSOR_PATH` is the fallback. This adapter was checked against bridge
v1.0.31 and the published `sdk.v1` JSON protocol.

Local history reads do not require a Cursor API key. For authenticated SDK
operations outside this viewer, create a user API key in the Cursor dashboard
and export `CURSOR_API_KEY` before launching the application; an editor sign-in
alone does not configure the bridge. GitCerberus does not store this key.

Cursor history now combines repository-linked editor conversations from the local
Cursor user-data directory with SDK sessions. The editor database is opened
read-only; its workspace mapping must match the selected repository before any
messages are read. This compatibility reader supports the editor’s
`composerHeaders` / `cursorDiskKV` format. Custom installations can set
`GITCERBERUS_CURSOR_USER_DIR` to their Cursor `User` directory. Cloud sessions
and conversations without a matching local workspace are not included.

**Install automatically…** opens an installation terminal within provider setup.
It shows the command plan and requires **Allow and install** before downloading
anything. Output streams into the panel; **Stop installation** cancels the
installer process tree. Packages are installed into GitCerberus’s own data
directory using the current user’s permissions, without elevation. Node/npm
(for Codex) or Python with venv/pip (for Cursor SDK) must already be installed.
The executable is validated and saved, and successful setup closes automatically.
This console is limited to provider installation commands, not a general shell.

Codex conversation lists include user-facing CLI, editor, and app-server sessions;
internal approval-review subagents are excluded. Long conversation titles are
limited to two visible lines, with the full title available on hover.
