#!/usr/bin/env bash
#
# git-commit-push.sh
#
# Stages, commits and pushes changes for a single git repository.  This
# script ensures that only repositories with remote tracking branches are
# processed and makes no commit when there are no changes.

set -euo pipefail


# Validate arguments
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
    printf '[git-autopush] %s\n' "$*"
  fi
}

# Prevent overlapping runs for the same repo using a per-repo lock.
# This avoids race conditions when the timer and watcher fire together.
lock_file="$repo/.git/.git-autopush.lock"
mkdir -p "$(dirname "$lock_file")" 2>/dev/null || true
exec 9>"$lock_file" || true
if ! flock -n 9; then
  log "Another git-autopush run is in progress for $repo; exiting."
  exit 0
fi

timestamp="$(date '+%Y-%m-%d %H:%M:%S')"

# Ensure repository exists
if [[ ! -d "$repo" ]]; then
  echo "Directory '$repo' does not exist; skipping." >&2
  exit 0
fi

# Ensure it's a git repository
if ! git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Directory '$repo' is not a git repository; skipping." >&2
  exit 0
fi

# Ensure the remote exists in this repository
if ! git -C "$repo" remote | grep -Fxq "$remote"; then
  echo "Remote '$remote' not found in '$repo'; skipping." >&2
  log "Remote $remote missing; aborting run."
  exit 1
fi

# Ensure author/committer identity is available for commit-tree
author_name=${GIT_AUTHOR_NAME:-}
author_email=${GIT_AUTHOR_EMAIL:-}

if [[ -z "$author_name" ]]; then
  author_name=$(git -C "$repo" config user.name || true)
fi

if [[ -z "$author_email" ]]; then
  author_email=$(git -C "$repo" config user.email || true)
fi

if [[ -z "$author_name" ]]; then
  author_name="Git Autopush"
  log "user.name not configured; using default '$author_name'"
fi

if [[ -z "$author_email" ]]; then
  author_email="git-autopush@localhost"
  log "user.email not configured; using default '$author_email'"
fi

export GIT_AUTHOR_NAME="$author_name"
export GIT_AUTHOR_EMAIL="$author_email"
export GIT_COMMITTER_NAME="$author_name"
export GIT_COMMITTER_EMAIL="$author_email"

# Ensure we have the latest remote tip for the target branch to avoid
# non-fast-forward pushes.
fetched_head=""
if git -C "$repo" ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
  git -C "$repo" fetch --no-tags --quiet "$remote" "$branch" || true
  fetched_head=$(git -C "$repo" rev-parse --verify --quiet FETCH_HEAD || true)
  if [[ -n "$fetched_head" ]]; then
    log "Fetched $remote/$branch tip $fetched_head"
  else
    log "No FETCH_HEAD found after fetch; proceeding without it"
  fi
else
  log "Remote branch $remote/$branch does not exist; will create it on push"
fi

# Capture outstanding changes; no-op when tree is clean
if [[ -z "$(git -C "$repo" status --porcelain)" ]]; then
  log "No changes detected in $repo; exiting."
  exit 0
fi

# Stage everything into a temporary index so the user's index stays untouched
tmp_index=$(mktemp)
trap 'rm -f "$tmp_index"' EXIT

# Remove the placeholder file so git can initialise the temporary index
rm -f "$tmp_index"

log "Staging changes for $repo into temporary index $tmp_index"
GIT_INDEX_FILE="$tmp_index" git -C "$repo" add -A

# Write the snapshot to a tree and craft a commit on the dedicated branch
tree=$(GIT_INDEX_FILE="$tmp_index" git -C "$repo" write-tree)
log "Created tree $tree for branch $branch"

# Determine the parent for the branch: prefer fetched remote tip, then local branch, 
# then tracking ref, then HEAD.
parent_ref=""
if [[ -n "$fetched_head" ]]; then
  parent_ref="$fetched_head"
elif git -C "$repo" rev-parse --verify --quiet "refs/heads/$branch" >/dev/null; then
  parent_ref=$(git -C "$repo" rev-parse "refs/heads/$branch")
elif git -C "$repo" rev-parse --verify --quiet "refs/remotes/$remote/$branch" >/dev/null; then
  parent_ref=$(git -C "$repo" rev-parse "refs/remotes/$remote/$branch")
elif git -C "$repo" rev-parse --verify --quiet HEAD >/dev/null; then
  parent_ref=$(git -C "$repo" rev-parse HEAD)
fi

commit_args=(commit-tree "$tree" -m "auto commit on ${timestamp}")
if [[ -n "$parent_ref" ]]; then
  commit_args+=(-p "$parent_ref")
fi

new_commit=$(git -C "$repo" "${commit_args[@]}")
log "Created commit $new_commit (parent ${parent_ref:-none})"

# Update (or create) the branch reference and push it out
old_branch_ref=""
if git -C "$repo" rev-parse --verify --quiet "refs/heads/$branch" >/dev/null; then
  old_branch_ref=$(git -C "$repo" rev-parse "refs/heads/$branch")
fi

if [[ -n "$old_branch_ref" ]]; then
  git -C "$repo" update-ref "refs/heads/$branch" "$new_commit" "$old_branch_ref"
  log "Updated existing branch $branch from $old_branch_ref to $new_commit"
else
  git -C "$repo" update-ref "refs/heads/$branch" "$new_commit"
  log "Created branch $branch at $new_commit"
fi

log "Pushing $new_commit to $remote/$branch"
git -C "$repo" push "$remote" "refs/heads/$branch:refs/heads/$branch"

rm -f "$tmp_index"
trap - EXIT
log "Completed run for $repo"
