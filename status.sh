#!/usr/bin/env bash
#
# status.sh
#
# Displays the status of all git-autopush systemd units defined in repos.txt.
# It checks both the service and the timer for each repository and prints
# whether they are active.  Run this script as the same user that created
# the systemd units.

set -euo pipefail

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

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_file="$project_dir/repos.txt"

if [[ ! -f "$config_file" ]]; then
  echo "Configuration file '$config_file' not found." >&2
  exit 1
fi

echo "Status of git-autopush units:"
echo

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  repo_path="$(echo "$line" | awk '{print $1}')"
  sanitized=$(echo "$repo_path" | sed 's/[^A-Za-z0-9]/_/g')
  service_name="git-autopush-${sanitized}.service"
  timer_name="git-autopush-${sanitized}.timer"

  service_status=$(systemctl --user is-active "$service_name" 2>/dev/null || true)
  timer_status=$(systemctl --user is-active "$timer_name" 2>/dev/null || true)

  printf "%s\n" "Repository: $repo_path"
  printf "  Service (%s): %s\n" "$service_name" "${service_status:-unknown}"
  printf "  Timer   (%s): %s\n" "$timer_name" "${timer_status:-unknown}"
  echo
done < "$config_file"
