#!/usr/bin/env bash
# Common utilities for git-autopush scripts.
# Defines installation/layout paths and helper functions to keep scripts
# location-agnostic once installed.

set -euo pipefail

_autopush_common_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# AUTOPUSH_ROOT resolves to the project root (one level above bin/)
export AUTOPUSH_ROOT="${AUTOPUSH_ROOT:-$(cd "${_autopush_common_dir}/../.." && pwd)}"
export AUTOPUSH_BIN_DIR="${AUTOPUSH_BIN_DIR:-${AUTOPUSH_ROOT}/bin}"

# Resolve config/data directories following XDG when available.
_autopush_default_config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
_autopush_default_data_home="${XDG_DATA_HOME:-$HOME/.local/share}"

export AUTOPUSH_CONFIG_DIR="${AUTOPUSH_CONFIG_DIR:-${_autopush_default_config_home}/autopush}"
export AUTOPUSH_DATA_DIR="${AUTOPUSH_DATA_DIR:-${_autopush_default_data_home}/autopush}"
export AUTOPUSH_CONFIG_FILE="${AUTOPUSH_CONFIG_FILE:-${AUTOPUSH_CONFIG_DIR}/repos.txt}"
export AUTOPUSH_SYSTEMD_DIR="${AUTOPUSH_SYSTEMD_DIR:-$HOME/.config/systemd/user}"
export AUTOPUSH_MIN_DELAY="${AUTOPUSH_MIN_DELAY:-60}"

# Ensure directories exist when scripts need them. Call lazily.
autopush_ensure_config_dir() {
  mkdir -p "${AUTOPUSH_CONFIG_DIR}"
}

autopush_ensure_data_dir() {
  mkdir -p "${AUTOPUSH_DATA_DIR}"
}

autopush_sanitize_unit_name() {
  local path="$1"
  echo "$path" | sed 's/[^A-Za-z0-9]/_/g'
}
