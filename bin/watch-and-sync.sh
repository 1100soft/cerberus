#!/usr/bin/env bash
#
# watch-and-sync.sh
#
# Watches a repository for filesystem changes (recursively, excluding .git)
# and schedules debounced commits via git-commit-push.sh. File changes that
# arrive within AUTOPUSH_MIN_DELAY seconds are batched together so that only
# one commit/push occurs once the repository has been quiet for that window.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/lib/autopush-common.sh"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <repo-path> [remote-name] [branch-name] [--log]" >&2
  exit 1
fi

repo="$1"
remote="${2:-origin}"
branch="${3:-}"
log_enabled=false

# Handle --log flag
if [[ $# -ge 2 && "$2" == "--log" ]]; then
  log_enabled=true
  remote="origin"
fi
if [[ $# -ge 3 && "$3" == "--log" ]]; then
  log_enabled=true
  branch=""
fi
if [[ $# -ge 4 && "$4" == "--log" ]]; then
  log_enabled=true
fi

if [[ ! -d "$repo" ]]; then
  echo "Repository path '$repo' not found." >&2
  exit 1
fi
repo="$(cd "$repo" && pwd)"

# Default branch to current branch if not specified
if [[ -z "$branch" ]]; then
  if git -C "$repo" rev-parse --abbrev-ref HEAD >/dev/null 2>&1; then
    branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD)"
  else
    branch="main"
  fi
fi

log() {
  if [[ "$log_enabled" == true ]]; then
    printf '[git-autopush-watch] %s\n' "$*"
  fi
}

if ! command -v inotifywait >/dev/null 2>&1; then
  echo "inotifywait (from inotify-tools) is required for watch mode." >&2
  exit 0
fi

min_delay=$(( AUTOPUSH_MIN_DELAY + 0 ))
autopush_ensure_data_dir
state_file="$(autopush_repo_state_file "$repo")"
pid_file="$(autopush_repo_debounce_pid_file "$repo")"

cleanup() {
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || echo "")"
    if [[ -n "$pid" ]]; then
      kill "$pid" >/dev/null 2>&1 || true
      wait "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$pid_file"
  fi
}
trap cleanup EXIT

commit_repo() {
  local args=("$repo" "$remote" "$branch")
  if [[ "$log_enabled" == true ]]; then
    args+=("--log")
  fi
  /usr/bin/env bash "$AUTOPUSH_BIN_DIR/git-commit-push.sh" "${args[@]}"
}

launch_debounce_worker() {
  (
    trap 'rm -f "$pid_file"' EXIT
    while true; do
      sleep "$min_delay"
      local last
      last="$(cat "$state_file" 2>/dev/null || echo "")"
      if [[ -z "$last" ]]; then
        break
      fi
      if [[ ! "$last" =~ ^[0-9]+$ ]]; then
        break
      fi
      local now
      now="$(date +%s)"
      if (( now - last >= min_delay )); then
        log "Quiet period met; committing $repo"
        commit_repo
        local after
        after="$(cat "$state_file" 2>/dev/null || echo "")"
        if [[ -z "$after" || "$after" == "$last" ]]; then
          rm -f "$state_file"
          break
        fi
      fi
    done
  ) &
  echo $! > "$pid_file"
}

ensure_worker_running() {
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || echo "")"
    if [[ -n "$pid" && kill -0 "$pid" >/dev/null 2>&1 ]]; then
      return
    fi
    rm -f "$pid_file"
  fi
  launch_debounce_worker
  log "Scheduled debounced commit in ${min_delay}s"
}

schedule_commit() {
  local now
  now="$(date +%s)"
  printf '%s\n' "$now" > "$state_file"
  ensure_worker_running
}

log "Watching $repo for changes; batching commits every ${min_delay}s of inactivity"

# If there are already pending changes when the watcher starts, ensure they are
# flushed after the debounce window.
if [[ -n "$(git -C "$repo" status --porcelain || true)" ]]; then
  initial_now=$(date +%s)
  printf '%s\n' $(( initial_now - min_delay )) > "$state_file"
  ensure_worker_running
fi

while read -r _; do
  schedule_commit
done < <(inotifywait -m -r -e close_write,create,delete,move --exclude '(^|/)\.git($|/)' "$repo")
