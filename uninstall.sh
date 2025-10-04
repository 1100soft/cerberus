#!/usr/bin/env bash
# Remove an existing git-autopush installation created by install.sh.

set -euo pipefail

if [[ $EUID -eq 0 ]]; then
  if [[ -n "${SUDO_USER:-}" ]]; then
    echo "Please run uninstall.sh as the target user without sudo." >&2
  else
    echo "uninstall.sh is intended for per-user installs and should not be run as root." >&2
  fi
  exit 1
fi

PREFIX="${PREFIX:-$HOME/.local}"
BIN_DIR=""
SHARE_DIR=""
PURGE_CONFIG=false
FORCE=false

usage() {
  cat <<'USAGE'
Usage: ./uninstall.sh [--prefix DIR] [--bin-dir DIR] [--share-dir DIR] [--purge-config] [--force]

Removes the git-autopush wrapper from the bin directory and deletes the copied
scripts from the share directory. Pass --purge-config to delete
${XDG_CONFIG_HOME:-$HOME/.config}/autopush (or AUTOPUSH_CONFIG_DIR).
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      [[ $# -lt 2 ]] && { echo "Missing value for --prefix" >&2; exit 2; }
      PREFIX="$2"
      shift 2
      ;;
    --bin-dir)
      [[ $# -lt 2 ]] && { echo "Missing value for --bin-dir" >&2; exit 2; }
      BIN_DIR="$2"
      shift 2
      ;;
    --share-dir)
      [[ $# -lt 2 ]] && { echo "Missing value for --share-dir" >&2; exit 2; }
      SHARE_DIR="$2"
      shift 2
      ;;
    --purge-config)
      PURGE_CONFIG=true
      shift
      ;;
    --force)
      FORCE=true
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

BIN_DIR="${BIN_DIR:-${PREFIX}/bin}"
SHARE_DIR="${SHARE_DIR:-${PREFIX}/share/autopush}"
DEST_WRAPPER="${BIN_DIR}/autopush"
DEST_BIN_DIR="${SHARE_DIR}/bin"

removed_something=false

if [[ -e "$DEST_WRAPPER" ]]; then
  rm -f "$DEST_WRAPPER"
  echo "Removed wrapper: $DEST_WRAPPER"
  removed_something=true
elif [[ "$FORCE" == false ]]; then
  echo "Wrapper not found at $DEST_WRAPPER" >&2
fi

if [[ -d "$DEST_BIN_DIR" ]]; then
  rm -rf "$SHARE_DIR"
  echo "Removed share directory: $SHARE_DIR"
  removed_something=true
elif [[ "$FORCE" == false ]]; then
  echo "Share directory not found at $SHARE_DIR" >&2
fi

if [[ "$PURGE_CONFIG" == true ]]; then
  CONFIG_DIR="${AUTOPUSH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/autopush}"
  if [[ -d "$CONFIG_DIR" ]]; then
    rm -rf "$CONFIG_DIR"
    echo "Purged config directory: $CONFIG_DIR"
  elif [[ "$FORCE" == false ]]; then
    echo "Config directory not found at $CONFIG_DIR" >&2
  fi
fi

systemctl --user daemon-reload >/dev/null 2>&1 || true

if [[ "$removed_something" == false && "$PURGE_CONFIG" == false ]]; then
  echo "Nothing removed. If you installed to a non-default prefix, pass --prefix/--bin-dir/--share-dir." >&2
fi

echo "Uninstall complete."
