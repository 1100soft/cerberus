# git-autopush

Bash utilities that keep one or more Git repositories synced by creating
systemd user units that commit and push on change. The tooling now installs as
an `autopush` command that can be run from any directory and stores its
configuration under `~/.config/autopush` (or the XDG equivalent).

## Installation

```bash
./install.sh            # installs into ~/.local/share/autopush and ~/.local/bin
```

Run the installer as your regular user; it refuses to run under sudo so that it
targets your home directory. By default the command is written to
`~/.local/bin/autopush`; make sure that directory is on your `PATH`. Override
the install prefix with `./install.sh --prefix /custom/path` or set `BIN_DIR` /
`SHARE_DIR`. The install script only copies shell files and never escalates
privileges.

To remove the tooling later, run:

```bash
./uninstall.sh         # removes ~/.local/share/autopush and the wrapper
```

Pass `--purge-config` if you also want to delete `~/.config/autopush`.

### Cleaning existing setups

If you were using an older copy of these scripts and already have git-autopush
systemd units in place, reinstalling will reuse the same unit names, so you
won't end up with duplicates. To tidy up units that no longer correspond to the
current configuration, run:

```bash
autopush prune --dry-run   # inspect what would be removed
autopush prune             # disable/remove unmanaged units
```

This scans systemd directly (like `autopush status --discover`) and removes
only units that are missing from `repos.txt`.

## Quick start

1. Install the command and ensure it is on your `PATH`.
2. Run `autopush add .` inside a Git repository that should auto-commit and
   push. The tool records the repository inside your private config file and
   regenerates the systemd units so the watcher starts immediately.
3. Check `autopush status` to see the health of the timer, watcher and service
   units for all configured repositories.

`autopush add` accepts optional flags:

- `--remote <name>` – choose a remote (defaults to `origin`, then the first remote)
- `--branch <name>` – override the branch used for automation (defaults to the
  current branch)
- `--log` – enable verbose logging for runs of `git-commit-push.sh`
- `--timer` / `--no-timer` – force-enable or disable the periodic timer for just
  that repository. Watch services are created automatically when
  `inotifywait` is available.

Run `autopush help` to view all available commands:

- `autopush list` – print the raw configuration file
- `autopush remove [path]` – stop managing a repository and tear down its units
- `autopush setup [--timers]` – rebuild units for everything in the config
- `autopush status [--discover]` – show unit health; add `--discover` to include systemd-managed entries
- `autopush prune [--dry-run]` – remove systemd units that are no longer in the config
- `autopush enable [--timers]` – rebuild units and enable lingering so they run
  after reboot
- `autopush disable [--disable-linger]` – disable timers/watchers for everything
  currently configured
- `autopush config-path` – print the location of the config file

## Configuration file

All repositories are stored in `${XDG_CONFIG_HOME:-$HOME/.config}/autopush/repos.txt`.
Each non-empty line uses whitespace-separated fields:

1. absolute repository path
2. remote name (default `origin`)
3. branch name (defaults to the repository's current branch)
4. optional logging flag – one of `log`, `--log`, `debug`, `verbose`, `true`, `1`
5. optional timer flag – `timer`/`on`/`true`/`1` to force-enable timers, or
   `no-timer`/`off`/`false`/`0` to disable them

Use `autopush add`/`remove` to edit this file safely; comments (lines beginning
with `#`) and blank lines are preserved.

## Systemd integration

`autopush setup` (run automatically by `autopush add`) generates a trio of
systemd user units per repository:

- `git-autopush-<repo>.service` – runs `git-commit-push.sh`
- `git-autopush-<repo>.timer` – optional periodic timer (5 minutes) when enabled
- `git-autopush-<repo>-watch.service` – file watcher using `inotifywait` for
  near-instant pushes

The scripts place unit files under `~/.config/systemd/user` and enable them for
your account. To keep services alive after logout, run `autopush enable`, which
activates the units and enables lingering (`loginctl enable-linger $USER`).

The helper scripts remain available in the install directory:
`setup-systemd.sh`, `enable-startup.sh`, `disable-startup.sh`, `status.sh`,
`watch-and-sync.sh`, and `git-commit-push.sh`. They look up their configuration
via the hidden config directory, so they can also be invoked manually if
needed.

## Notes

- `git-commit-push.sh` avoids creating commits when there are no changes. When
  it runs it stages everything in a temporary index, writes a new commit on the
  configured branch and pushes it to the chosen remote.
- The watcher requires `inotifywait` (from `inotify-tools`). If it is absent the
  timer continues to provide a periodic safety net.
- Automated commits default the author to the repository's configured
  credentials. Fallbacks (`Git Autopush <git-autopush@localhost>`) are used when
  nothing is configured.
- The configuration directory is version-control friendly if you want to back it
  up separately, but it is never modified unless you run an `autopush` command.
