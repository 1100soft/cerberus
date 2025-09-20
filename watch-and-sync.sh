#!/usr/bin/env bash
#
# watch-and-sync.sh
#
# Watches a repository for filesystem changes (recursively, excluding .git)
# and triggers git-commit-push.sh immediately when events occur.

set -euo pipefail


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

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log "Watching $repo for changes; syncing to $remote/$branch"

# Run a persistent monitor; each event will attempt a sync. The commit
# script itself uses a lock, so bursts are safely coalesced.
inotifywait -m -r -e close_write,create,delete,move --exclude '(^|/)\.git($|/)' "$repo" | \
while read -r _; do
  /usr/bin/env bash "$project_dir/git-commit-push.sh" "$repo" "$remote" "$branch" $([[ "$log_enabled" == true ]] && echo --log || true)
done

