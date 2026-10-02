#!/usr/bin/env bash
#
# status.sh
#
# Displays the status of git-autopush systemd units. By default it reads the
# configuration file, but it can also discover units directly from systemd.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/autopush-common.sh"

usage() {
  cat <<'USAGE'
Usage: autopush status [--discover]

Options:
  --discover   Include git-autopush units discovered directly from systemd.
  -h, --help   Show this help message.
USAGE
}

discover=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --discover|--systemd)
      discover=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Must be run as the owning user; running under sudo/root will not
# see the per-user systemd bus and yields misleading statuses.
if [[ $EUID -eq 0 ]]; then
  if [[ -n "${SUDO_USER:-}" ]]; then
    echo "Please run status.sh as ${SUDO_USER} (without sudo)." >&2
  else
    echo "Please run status.sh as a regular user (not root)." >&2
  fi
  exit 1
fi

config_file="$AUTOPUSH_CONFIG_FILE"
config_available=false
if [[ -f "$config_file" ]]; then
  config_available=true
fi

if [[ "$discover" == false && "$config_available" == false ]]; then
  echo "Configuration file '$config_file' not found. Use 'autopush add <path>' or rerun with --discover to query systemd." >&2
  exit 1
fi

declare -A repo_paths=()
declare -A seen_sanitized=()
sanitized_order=()

add_sanitized() {
  local key="$1"
  if [[ -z "${seen_sanitized[$key]:-}" ]]; then
    seen_sanitized[$key]=1
    sanitized_order+=("$key")
  fi
}

if [[ "$config_available" == true ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    repo_path="$(echo "$line" | awk '{print $1}')"
    sanitized="$(autopush_sanitize_unit_name "$repo_path")"
    repo_paths["$sanitized"]="$repo_path"
    add_sanitized "$sanitized"
  done < "$config_file"
fi

if [[ "$discover" == true ]]; then
  while IFS= read -r unit_name || [[ -n "$unit_name" ]]; do
    [[ -z "$unit_name" ]] && continue
    case "$unit_name" in
      git-autopush-*-watch.service)
        sanitized="${unit_name#git-autopush-}"
        sanitized="${sanitized%-watch.service}"
        ;;
      git-autopush-*.service)
        sanitized="${unit_name#git-autopush-}"
        sanitized="${sanitized%.service}"
        ;;
      git-autopush-*.timer)
        sanitized="${unit_name#git-autopush-}"
        sanitized="${sanitized%.timer}"
        ;;
      *)
        continue
        ;;
    esac
    add_sanitized "$sanitized"
  done < <(systemctl --user list-unit-files --no-legend --no-pager 'git-autopush-*' 2>/dev/null | awk '{print $1}')
fi

if [[ ${#sanitized_order[@]} -eq 0 ]]; then
  echo "No git-autopush units found."
  exit 0
fi

echo "Status of git-autopush units:"
echo

for sanitized in "${sanitized_order[@]}"; do
  repo_label="${repo_paths[$sanitized]:-}"
  if [[ -z "$repo_label" ]]; then
    repo_label="<unknown repository> (unit key: $sanitized)"
  fi

  service_name="git-autopush-${sanitized}.service"
  timer_name="git-autopush-${sanitized}.timer"
  watch_name="git-autopush-${sanitized}-watch.service"

  service_status=$(systemctl --user is-active "$service_name" 2>/dev/null || true)
  timer_status=$(systemctl --user is-active "$timer_name" 2>/dev/null || true)
  watch_status=$(systemctl --user is-active "$watch_name" 2>/dev/null || true)

  printf "%s\n" "Repository: $repo_label"
  printf "  Service (%s): %s\n" "$service_name" "${service_status:-unknown}"
  printf "  Timer   (%s): %s\n" "$timer_name" "${timer_status:-unknown}"
  printf "  Watch   (%s): %s\n" "$watch_name" "${watch_status:-unknown}"
  echo
done
