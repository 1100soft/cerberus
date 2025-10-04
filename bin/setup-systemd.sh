#!/usr/bin/env bash
#
# setup-systemd.sh
#
# Reads config/repos.txt and generates systemd user units to automatically commit
# and push each repository listed.  This script must be run under the
# account that owns the repositories.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/autopush-common.sh"

log_enabled=false
create_timers=false
declare -A selected_repos=()
selection_active=false

# Parse optional flags: --log, --no-timer/--no-timers, --enable-timer
while [[ $# -gt 0 ]]; do
  case "$1" in
    --log)
      log_enabled=true
      shift
      ;;
    --no-timer|--no-timers|--disable-timer)
      create_timers=false
      shift
      ;;
    --enable-timer|--timers)
      create_timers=true
      shift
      ;;
    --repo|--only)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --repo" >&2
        exit 2
      fi
      repo_arg="$2"
      shift 2
      if [[ -d "$repo_arg" ]]; then
        repo_arg="$(cd "$repo_arg" && pwd)"
      fi
      sanitized_arg=$(autopush_sanitize_unit_name "$repo_arg")
      selected_repos["$sanitized_arg"]="$repo_arg"
      selection_active=true
      ;;
    *)
      break
      ;;
  esac
done

log() {
  if [[ "$log_enabled" == true ]]; then
    printf '[setup-systemd] %s\n' "$*"
  fi
}

# systemd user units must be managed as the owning user so that the
# per-user bus is available.  If the script is invoked via sudo, bail
# out with a clear message instead of letting systemctl fail later.
if [[ $EUID -eq 0 ]]; then
  if [[ -n "${SUDO_USER:-}" ]]; then
    cat <<EOF >&2
This script manages systemd user units and must run as the target user.
Re-run without sudo (for example, "${SUDO_USER}" should run ./setup-systemd.sh).
EOF
  else
    echo "This script must not be run as root." >&2
  fi
  exit 1
fi

bin_dir="$AUTOPUSH_BIN_DIR"
config_file="$AUTOPUSH_CONFIG_FILE"
service_dir="$AUTOPUSH_SYSTEMD_DIR"
have_inotify=false
if command -v inotifywait >/dev/null 2>&1; then
  have_inotify=true
fi

# Ensure directories exist
mkdir -p "$service_dir"
autopush_ensure_config_dir

if [[ ! -f "$config_file" ]]; then
  echo "Configuration file '$config_file' not found. Add repositories with 'autopush add <path>'." >&2
  exit 1
fi

declare -A processed_repos=()
processed_any=false

while IFS= read -r line || [[ -n "$line" ]]; do
  # Skip comments and empty lines
  [[ -z "$line" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  # Split the line into repo path, remote, optional branch, logging flag, and optional timer flag
  read -r -a fields <<< "$line"
  repo_path="${fields[0]:-}"
  remote_name="${fields[1]:-origin}"
  branch_name="${fields[2]:-}"
  field_count=${#fields[@]}
  log_flag=""
  timer_flag=""
  if (( field_count >= 4 )); then
    candidate="${fields[3]}"
    case "$candidate" in
      timer|on|true|1|no-timer|notimer|off|false|0)
        if (( field_count == 4 )); then
          timer_flag="$candidate"
        else
          log_flag="$candidate"
        fi
        ;;
      *)
        log_flag="$candidate"
        ;;
    esac
  fi
  if (( field_count >= 5 )); then
    timer_flag="${fields[4]}"
  fi

  if [[ -z "$repo_path" ]]; then
    echo "Skipping invalid entry: '$line'" >&2
    continue
  fi

  # Default branch to current branch if not specified
  if [[ -z "$branch_name" ]]; then
    if git -C "$repo_path" rev-parse --abbrev-ref HEAD >/dev/null 2>&1; then
      branch_name="$(git -C "$repo_path" rev-parse --abbrev-ref HEAD)"
    else
      branch_name="main"
    fi
  fi

  enable_logging=false
  if [[ -n "$log_flag" ]]; then
    case "$log_flag" in
      log|--log|debug|verbose|true|1)
        enable_logging=true
        ;;
    esac
  fi

  # Decide whether to create/enable a timer for this repo
  enable_timer_for_repo=$create_timers
  if [[ -n "$timer_flag" ]]; then
    case "$timer_flag" in
      no-timer|notimer|off|false|0)
        enable_timer_for_repo=false
        ;;
      timer|on|true|1)
        enable_timer_for_repo=true
        ;;
    esac
  fi

  # Preflight: warn and skip if repo doesn't exist or isn't a git repo
  if [[ ! -d "$repo_path" ]]; then
    echo "Warning: repo path '$repo_path' does not exist; skipping." >&2
    log "Skipping missing path $repo_path"
    continue
  fi
  if ! git -C "$repo_path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "Warning: '$repo_path' is not a git repository; skipping." >&2
    log "Skipping non-git path $repo_path"
    continue
  fi

  # Sanitize the repository path for unit naming
  sanitized=$(autopush_sanitize_unit_name "$repo_path")
  service_name="git-autopush-${sanitized}.service"
  timer_name="git-autopush-${sanitized}.timer"
  watch_name="git-autopush-${sanitized}-watch.service"

  service_path="$service_dir/$service_name"
  timer_path="$service_dir/$timer_name"
  watch_path="$service_dir/$watch_name"

  log_suffix=""
  if [[ "$enable_logging" == true ]]; then
    log_suffix=" --log"
  fi

  log "Generating units for $repo_path (remote=$remote_name branch=$branch_name logging=$enable_logging)"

  # Create the service unit file
  cat > "$service_path" <<EOF
[Unit]
Description=Auto-commit and push for $repo_path
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
Environment="GIT_SSH_COMMAND=/usr/bin/ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
ExecStart=/usr/bin/env bash "$bin_dir/git-commit-push.sh" "$repo_path" "$remote_name" "$branch_name"${log_suffix}
EOF

  # Create the timer unit file (optional)
  if [[ "$enable_timer_for_repo" == true ]]; then
    cat > "$timer_path" <<EOF
[Unit]
Description=Run git-autopush for $repo_path

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  fi

  # Create the watcher service if inotify is available
  if [[ "$have_inotify" == true ]]; then
    cat > "$watch_path" <<EOF
[Unit]
Description=Watch and auto-sync for $repo_path
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Restart=always
RestartSec=2s
Environment="GIT_SSH_COMMAND=/usr/bin/ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
ExecStart=/usr/bin/env bash "$bin_dir/watch-and-sync.sh" "$repo_path" "$remote_name" "$branch_name"${log_suffix}

[Install]
WantedBy=default.target
EOF
    log "Wrote watcher to $watch_path"
  else
    log "inotifywait not found; skipping watcher for $repo_path"
  fi

  echo "Created unit files for $repo_path ($service_name and $timer_name)"
  log "Wrote service to $service_path and timer to $timer_path"
done < "$config_file"

# Reload systemd and enable timers/watchers
systemctl --user daemon-reload

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  read -r -a fields <<< "$line"
  repo_path="${fields[0]:-}"
  sanitized=$(autopush_sanitize_unit_name "$repo_path")
  timer_name="git-autopush-${sanitized}.timer"
  watch_name="git-autopush-${sanitized}-watch.service"

  # Determine if we should enable the timer for this repo
  field_count=${#fields[@]}
  timer_flag=""
  if (( field_count >= 4 )); then
    candidate="${fields[3]}"
    case "$candidate" in
      no-timer|notimer|off|false|0|timer|on|true|1)
        if (( field_count == 4 )); then
          timer_flag="$candidate"
        fi
        ;;
    esac
  fi
  if (( field_count >= 5 )); then
    timer_flag="${fields[4]}"
  fi
  enable_timer_for_repo=$create_timers
  if [[ -n "$timer_flag" ]]; then
    case "$timer_flag" in
      no-timer|notimer|off|false|0)
        enable_timer_for_repo=false
        ;;
      timer|on|true|1)
        enable_timer_for_repo=true
        ;;
    esac
  fi

  # Enable and start the timer (if configured and present)
  if [[ "$enable_timer_for_repo" == true && -f "$service_dir/$timer_name" ]]; then
    systemctl --user enable --now "$timer_name" >/dev/null 2>&1 || true
    echo "Enabled and started timer $timer_name"
    log "Enabled timer unit $timer_name"
  else
    log "Timer disabled or not present for $repo_path ($timer_name)"
  fi
  
  # Enable and start the watcher (if present)
  if [[ -f "$service_dir/$watch_name" ]]; then
    systemctl --user enable --now "$watch_name" >/dev/null 2>&1 || true
    echo "Enabled watcher $watch_name"
    log "Enabled watcher unit $watch_name"
  fi
done < "$config_file"

echo "Setup complete.  Services are active; timers/watchers enabled as configured."
