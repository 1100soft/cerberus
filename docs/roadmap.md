# GitCerberus implementation roadmap

## Now — foundation

- [x] Tauri 2, React, and TypeScript project structure
- [x] Initial SQLite migration and device-local repository binding
- [x] Repository import, status parsing, snapshots, and mutation serialization
- [x] Searchable, filterable, reorderable repository dashboard
- [x] Identity display and repository Git-author mismatch detection
- [x] Safe command boundary for routine Git actions
- [ ] Identity CRUD and assignment UI
- [ ] Device-specific VS Code and browser-profile binding UI

## MVP completion

- Diff and file-level stage/unstage/commit surfaces
- Branch list/create/checkout/delete
- Tray lifecycle and native notifications on all supported platforms
- Interval-fetch automation, remote-change detection, and execution history
- Non-secret settings export/import
- Integration fixtures covering remotes, spaces, Unicode, concurrency, and identity isolation

## Later

- Account-aware hosted status adapters
- Cross-device logical configuration sync
- Worktrees and advanced Git operation UI
- Additional editors, browser adapters, saved searches, and repository groups

The former auto-push behavior should only return as an explicit, opt-in data-driven automation action with protected-branch safeguards and visible execution history.

Its complete pre-Tauri implementation is retained together under
`legacy/autopush/` for behavioral reference.
