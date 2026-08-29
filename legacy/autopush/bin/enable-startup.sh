#!/usr/bin/env bash
#
# enable-startup.sh
#
# Generates/updates units and enables them to run automatically.
# Also attempts to enable systemd user lingering so services start on boot.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/autopush-common.sh"

bin_dir="$AUTOPUSH_BIN_DIR"

log_enabled=false
timers_flag=""  # empty = respect per-repo/defaults; "--timers" to enable timers globally

usage() {
  cat <<USAGE
Usage: $0 [--log] [--timers]

  --log     Verbose output during setup
  --timers  Enable periodic timers globally in addition to watchers
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --log)
      log_enabled=true
      shift
      ;;
    --timers|--enable-timer)
      timers_flag="--timers"
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

log_arg=""
if [[ "$log_enabled" == true ]]; then
  log_arg="--log"
fi

# Regenerate units and enable per configuration
"$bin_dir/setup-systemd.sh" $log_arg $timers_flag

# Try to enable lingering so user services start at boot without login
if ! loginctl enable-linger "$USER" >/dev/null 2>&1; then
  echo "Note: Could not enable lingering automatically. If you want services to start at boot without login, run:"
  echo "  sudo loginctl enable-linger $USER"
else
  echo "Enabled lingering for user '$USER' (user services will start at boot)."
fi

echo "Autostart setup complete."
