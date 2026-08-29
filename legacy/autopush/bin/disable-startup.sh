#!/usr/bin/env bash
#
# disable-startup.sh
#
# Disables watcher services and timers for all repos listed in config/repos.txt.
# Optionally disables lingering.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/autopush-common.sh"

config_file="$AUTOPUSH_CONFIG_FILE"

disable_linger=false
log_enabled=false

usage() {
  cat <<USAGE
Usage: $0 [--log] [--disable-linger]

  --log             Verbose output
  --disable-linger  Also disable systemd user lingering for this user
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --log)
      log_enabled=true
      shift
      ;;
    --disable-linger)
      disable_linger=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

log() {
  if [[ "$log_enabled" == true ]]; then
    printf '[disable-startup] %s\n' "$*"
  fi
}

if [[ ! -f "$config_file" ]]; then
  echo "Configuration file '$config_file' not found. Nothing to disable." >&2
  exit 1
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  read -r -a fields <<< "$line"
  repo_path="${fields[0]:-}"
  [[ -z "$repo_path" ]] && continue

  sanitized=$(autopush_sanitize_unit_name "$repo_path")
  timer_name="git-autopush-${sanitized}.timer"
  watch_name="git-autopush-${sanitized}-watch.service"

  if systemctl --user is-enabled "$watch_name" >/dev/null 2>&1 || [[ -f "$AUTOPUSH_SYSTEMD_DIR/$watch_name" ]]; then
    systemctl --user disable --now "$watch_name" >/dev/null 2>&1 || true
    echo "Disabled watcher $watch_name"
    log "Disabled watcher $watch_name"
  fi

  if systemctl --user is-enabled "$timer_name" >/dev/null 2>&1 || [[ -f "$AUTOPUSH_SYSTEMD_DIR/$timer_name" ]]; then
    systemctl --user disable --now "$timer_name" >/dev/null 2>&1 || true
    echo "Disabled timer $timer_name"
    log "Disabled timer $timer_name"
  fi
done < "$config_file"

if [[ "$disable_linger" == true ]]; then
  if ! loginctl disable-linger "$USER" >/dev/null 2>&1; then
    echo "Note: Could not disable lingering automatically. You may run:"
    echo "  sudo loginctl disable-linger $USER"
  else
    echo "Disabled lingering for user '$USER'."
  fi
fi

echo "Autostart disabled for listed repositories."
