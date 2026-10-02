# GitCerberus

GitCerberus is a Tauri desktop workspace for repositories, GitHub identities, and local agent conversation history. The Repository view delegates work to VS Code and Cursor; the Agent pane reads conversations from enabled providers and shows activity where the provider exposes it.

## Project map

| Location | Purpose |
| --- | --- |
| `desktop/src/` | React interface, provider state, and typed Tauri calls |
| `desktop/src-tauri/` | Rust commands, Git/SQLite services, identity storage, provider adapters |
| `desktop/scripts/` | Frontend logic and WebKitGTK regression checks |
| `desktop/docs/` | Current desktop architecture and operations |
| `website/` | Static product site |
| `legacy/` | Earlier shell implementation, retained as reference |
| `docs/archive/` | Superseded project notes |

Start with [the documentation index](docs/README.md) for current behavior. [HANDOFF.md](HANDOFF.md) records the present working tree, verification, and unresolved integration limits.

## Development

Prerequisites: Node.js 20+, Rust stable, Git, and the [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/). On Debian/Ubuntu, WebKitGTK and appindicator development packages are needed for the desktop build.

```bash
cd desktop
npm install
npm run dev       # Browser demo on port 3000
npm run build     # Dropdown convention check, TypeScript, production bundle
npm run tauri dev # Desktop app
```

Rust checks:

```bash
cd desktop/src-tauri
cargo test
```

The browser demo uses fixture repositories and does not run native Git or provider commands. See [desktop verification](desktop/docs/agent-operations.md#verification) for the WebKitGTK UI checks.

## Identity and agent boundaries

GitHub tokens and agent API keys are kept in the OS credential store. Repository metadata and identity assignments are kept in the Tauri application-data directory. The UI stores presentation preferences and local chat metadata in localStorage. Provider CLIs and browsers retain their own sessions.

Conversation providers are opt-in. Codex, Cursor, Copilot, and Claude adapters expose different kinds of local history; [the provider matrix](desktop/docs/architecture.md#provider-capabilities) describes what each can and cannot report. A signed-in GitHub identity alone does not install or authenticate the Copilot CLI needed by the current local Copilot adapter.

Provider installation is an explicit in-app action with a displayed command plan. Nothing should install a provider CLI silently.
