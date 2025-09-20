# Project overview

This repository contains scripts and configuration files to automate commits and pushes for multiple Git repositories on a Linux system.  Each repository you wish to monitor is listed in a simple configuration file, and systemd user units are generated to run a commit‑and‑push routine at regular intervals.  The directory can itself be versioned with git and contains everything required to set up and monitor the automation.

## Structure

- `repos.txt` – a plain text file listing pairs of local repository paths and remote names (with optional fields for the branch, logging flag, and timer control).  Lines beginning with `#` are comments and ignored.  Each non-empty line must contain at least two fields separated by whitespace:
  
  1. an absolute path to the local git repository
  2. the remote name to push to (for example, `origin`)
  3. *(optional)* the branch name that should receive the automated commits; defaults to `wip` if omitted
  4. *(optional)* a logging flag (`log`, `--log`, `debug`, `verbose`, `true` or `1`) to enable verbose output from the commit script
  5. *(optional)* timer control: `no-timer`/`off`/`false`/`0` to disable the periodic timer for this repo (watcher still used if available); `timer`/`on`/`true`/`1` to force-enable

- `git‑commit‑push.sh` – a bash script that snapshots the working tree, writes a commit on the designated branch (default `wip`) and pushes it to the chosen remote without disturbing your current branch.  It accepts a repository path, remote name, optional branch name and an optional `--log` flag for verbose output.  When no Git identity is configured, it falls back to `Git Autopush <git-autopush@localhost>` so commits can always be created.

- `setup‑systemd.sh` – a bash script that reads `repos.txt` and generates a dedicated `service` for each repository. If `inotifywait` is available, it also generates a long‑running watcher service that syncs immediately on file changes. Timers are optional and disabled by default; enable them globally with `--timers` or per‑repo via the 5th column. Units are installed into `~/.config/systemd/user`, the daemon is reloaded, and timers/watchers are enabled as configured.

- `status.sh` – a helper script to display the current status of all generated services and timers.  It lists each repository defined in `repos.txt` and shows whether its corresponding systemd units are active.
 
- `watch-and-sync.sh` – a small helper invoked by the watcher services. It uses `inotifywait` to monitor the repo recursively (excluding `.git/`) and triggers `git-commit-push.sh` when files change.

- `.gitignore` – excludes logs and transient systemd unit files from version control.

### Usage

1. Edit `repos.txt` and add one line per repository you want to manage.  For example:

   ```
   # local path                       remote     branch     log        timer
   /home/username/projects/repo1      origin     wip        --log      no-timer
   /home/username/work/notes          upstream   backups
   ```

2. Run `setup‑systemd.sh` to generate and enable the systemd units:

   ```bash
   ./setup-systemd.sh                 # timers are disabled by default; add --timers to enable
   ./setup-systemd.sh --timers        # enable timers globally (in addition to watchers)
   ```

   This script must be run with your user account.  It will place service and timer units in `~/.config/systemd/user` and enable them so they start automatically on boot.  If `inotifywait` is present, a watcher service is also enabled per repo to sync immediately on file changes.  To allow timers/watchers to run when you are not logged in, enable lingering for your user with `loginctl enable‑linger $USER`.

3. Check the status of the units at any time with:

   ```bash
   ./status.sh
   ```

4. The `git‑commit‑push.sh` script can also be invoked manually to commit and push a specific repository:

   ```bash
   ./git-commit-push.sh /home/username/projects/repo1 origin wip
   ```

### Autostart on Boot

- Enable autostart (generates units, enables watchers/timers as configured, and enables lingering):

  ```bash
  ./enable-startup.sh         # add --timers to also enable timers globally
  ```

- Disable autostart (disables watchers/timers; optionally disable lingering):

  ```bash
  ./disable-startup.sh        # add --disable-linger to also disable lingering
  ```

### Notes

- The commit message used by the automation includes a timestamp.  No commit is made when there are no staged changes.
- Automated commits are always written to the configured branch (default `wip`) so that work-in-progress history can be squashed later.
- Pass `--log` to `git-commit-push.sh` (or add the logging flag in `repos.txt`) to emit detailed diagnostics about staging, commit creation and pushes; omit it for quiet operation.
- For immediate syncs, install `inotify-tools` (provides `inotifywait`). The setup script will generate and enable a watcher service that reacts to changes instantly. Without it, the timer still runs periodically as a fallback.
- Systemd unit names are derived from the repository paths by replacing non‑alphanumeric characters with underscores.  This ensures unique and valid unit names.
