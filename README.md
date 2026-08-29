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

- **Sign in with GitHub** uses GitCerberus’s client ID (`GITCERBERUS_GITHUB_CLIENT_ID`
  at build or runtime). Enable Device Flow on that one app. The client ID is
  public; tokens stay in the OS credential store.
- **GitHub CLI** reuses `gh auth login` on this machine.
- **Personal access token** needs `read:user` and `user:email`.

SQLite stores only a `keyring:github:<identity-id>` reference, never the token.

Repository navigation uses Up/Down, action selection uses Left/Right, and Enter
runs the chosen action. Direct shortcuts are `E` (VS Code), `G` (hosted page),
`F` (fetch), and `P` (push). Ctrl/Cmd+0 resets UI zoom.

The core deliberately does not assume GitHub, does not mutate global Git configuration, and does not infer identity from whichever account happens to be active elsewhere.
