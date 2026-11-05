#!/usr/bin/env bash
set -Eeuo pipefail

level="${CERBERUS_INPUT_PROGRESS_LEVEL:-}"
remote_name="${CERBERUS_RELEASE_REMOTE:-origin}"
source_branch="${CERBERUS_RELEASE_SOURCE_BRANCH:-wip}"
target_branch="${CERBERUS_RELEASE_TARGET_BRANCH:-main}"
tag_prefix="${CERBERUS_RELEASE_TAG_PREFIX:-v}"
source_tag_prefix="${CERBERUS_RELEASE_SOURCE_TAG_PREFIX:-cerberus/source/}"
handoff="${CERBERUS_HANDOFF_RELEASE:-}"
approved_sha="${CERBERUS_RELEASE_APPROVED_SHA:-}"
expected_source="${CERBERUS_RELEASE_EXPECTED_SOURCE:-}"
request_source_sha="${CERBERUS_RELEASE_ORIGINAL_SOURCE:-}"
expected_target="${CERBERUS_RELEASE_EXPECTED_TARGET:-}"
requested_tag="${CERBERUS_RELEASE_TAG:-}"
request_run="${CERBERUS_RELEASE_REQUEST_RUN:-${CERBERUS_RUN_ID:-}}"
original_repository="$(git rev-parse --show-toplevel)"

case "$level" in
  major|minor|patch) ;;
  *)
    echo "Invalid progress level: $level" >&2
    exit 1
    ;;
esac

# Never leave a stale handoff from a previous execution.
if [[ -n "$handoff" ]]; then
  rm -f -- "$handoff"
fi

tmp=""
stage="initialization"
remote=""

source_sha=""
target_sha=""
candidate_sha=""
tree_sha=""

tag=""
source_tag=""

cleanup() {
  if [[ -n "$tmp" && -d "$tmp" ]]; then
    rm -rf -- "$tmp"
  fi
}
trap cleanup EXIT

emit_handoff() {
  local reason="$1"
  local details

  details="Release preparation/publication context.
Stage: $stage
Reason: $reason
Progress level: $level
Remote: $remote
Source: $remote_name/$source_branch ($source_sha)
Previous target: $target_sha
Release candidate: $candidate_sha
Release tag: $tag
Source tag: $source_tag

Release architecture:
- Source development history is preserved unchanged.
- Existing target history is preserved without requiring a historical baseline.
- A missing target starts with an orphan release commit.
- Subsequent releases add exactly one commit after the previous target tip.
- Every release commit contains the exact captured source tree.
- Version tags point to release commits on the target branch.
- Source tags identify the reviewed prepared source commits.
- Publication is atomic; an expected-tip lease guards the target against races.

Independently verify current remote state before acting.
Preserve release intent, existing tags, and source history.
Do not rewrite either branch, discard concurrent changes,
or modify active worktrees.
A version-validation failure requires a reviewed metadata correction on the verified development branch before release retry. Do not publish mismatched tags, select another version, move existing tags, or rewrite target history. Always prepare and review release version metadata AND release documentation before publication. A numerically valid version check alone is not documentation approval. Complete the exact requested release only if all validation and publication guards pass."

  echo "$details" >&2

  if [[ -n "$handoff" ]]; then
    mkdir -p -- "$(dirname -- "$handoff")"

    python3 - "$handoff" "$details" "$request_run" "$remote_name" "$remote" "$source_branch" "${request_source_sha:-${original_source_sha:-$source_sha}}" "$target_branch" "$target_sha" "$tag" "$source_tag" "$level" "$stage" <<'PY'
import json
import os
import sys
import tempfile

path, details, run, remote_name, remote, source_branch, source_sha, target_branch, target_sha, tag, source_tag, level, stage = sys.argv[1:]
context = {"details": details, "releasePlan": {"schema": 1, "requestRun": run,
    "remoteName": remote_name, "remoteUrl": remote, "sourceBranch": source_branch,
    "sourceSha": source_sha, "targetBranch": target_branch, "previousTargetSha": target_sha,
    "tag": tag, "sourceTag": source_tag, "progressLevel": level, "stage": stage,
    "tagPrefix": os.environ.get("CERBERUS_RELEASE_TAG_PREFIX", "v"),
    "sourceTagPrefix": os.environ.get("CERBERUS_RELEASE_SOURCE_TAG_PREFIX", "cerberus/source/"),
    "versionCheck": os.environ.get("CERBERUS_RELEASE_VERSION_CHECK", "")}}
directory = os.path.dirname(os.path.abspath(path))

fd, temp = tempfile.mkstemp(dir=directory)

try:
    with os.fdopen(fd, "w") as f:
        json.dump(context, f)
        f.write("\n")

    os.replace(temp, path)
finally:
    if os.path.exists(temp):
        os.unlink(temp)
PY
  fi
}

fail() {
  emit_handoff "$1"
  exit 1
}

on_error() {
  local status="$1"
  local command="$2"

  trap - ERR
  emit_handoff "Command failed (exit $status): $command"
  exit "$status"
}

trap 'on_error "$?" "$BASH_COMMAND"' ERR

# ------------------------------------------------------------
# Establish an isolated repository.
# ------------------------------------------------------------

stage="repository setup"

[[ "$source_branch" != "$target_branch" ]] || fail "Source and target branches must differ"
git check-ref-format "refs/heads/$source_branch"
git check-ref-format "refs/heads/$target_branch"
[[ "$remote_name" != -* ]] || fail "Invalid remote name"
remote="$(git remote get-url --push "$remote_name")"
# Resolve relative local remotes before entering the isolated repository.
if [[ -d "$remote" ]]; then
  remote="$(cd -- "$remote" && pwd -P)"
fi
tmp="$(mktemp -d)"

git -C "$tmp" init -q
git -C "$tmp" remote add origin "$remote"

# ------------------------------------------------------------
# Fetch remote state.
# ------------------------------------------------------------

stage="fetch"

git -C "$tmp" fetch -q origin \
  "+refs/heads/$source_branch:refs/remotes/origin/source" \
  'refs/tags/*:refs/tags/*'

# The target may not exist before the first release.
if [[ -n "$(
  git -C "$tmp" ls-remote origin "refs/heads/$target_branch"
)" ]]; then
  git -C "$tmp" fetch -q origin \
    "+refs/heads/$target_branch:refs/remotes/origin/target"
fi

# ------------------------------------------------------------
# Capture the source and previous release.
# ------------------------------------------------------------

stage="capture release state"

source_sha="$(
  git -C "$tmp" rev-parse --verify \
    'refs/remotes/origin/source^{commit}'
)"

tree_sha="$(
  git -C "$tmp" rev-parse --verify \
    "$source_sha^{tree}"
)"

if git -C "$tmp" show-ref --verify --quiet \
  refs/remotes/origin/target; then

  target_sha="$(
    git -C "$tmp" rev-parse --verify \
      'refs/remotes/origin/target^{commit}'
  )"
fi

# Existing target history can contain ordinary commits, merges or older releases.
# Preserve it unchanged; the new candidate's parent/tree are verified below.

# ------------------------------------------------------------
# Determine the next version.
# ------------------------------------------------------------

stage="determine version"

latest_version() {
  python3 -c '
import re, sys
prefix = sys.argv[1]
pattern = re.compile(re.escape(prefix) + r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
versions = []
for line in sys.stdin:
    match = pattern.fullmatch(line.strip())
    if match:
        versions.append(tuple(map(int, match.groups())))
print(prefix + ".".join(map(str, max(versions))) if versions else "")
' "$tag_prefix"
}
local_tags="$(git -C "$tmp" tag -l)"
latest="$(printf '%s\n' "$local_tags" | latest_version)"

version="${latest#"$tag_prefix"}"
version="${version:-0.0.0}"

IFS=. read -r major minor patch <<< "$version"

case "$level" in
  major)
    major=$((major + 1))
    minor=0
    patch=0
    ;;
  minor)
    minor=$((minor + 1))
    patch=0
    ;;
  patch)
    patch=$((patch + 1))
    ;;
esac

tag="$tag_prefix$major.$minor.$patch"
git check-ref-format "refs/tags/$tag"
source_tag="$source_tag_prefix$tag"
[[ "$source_tag" != "$tag" ]] || fail "Source and release tags must differ"
git check-ref-format "refs/tags/$source_tag"

# Every manual request goes through the documentation/version agent, even when
# the existing manifests happen to match. Only a separately reviewed snapshot
# can enter the publication path below.
if [[ -z "$approved_sha" ]]; then
  stage="prepare release documentation"
  [[ -n "$request_run" ]] || fail "Original automation run ID is required"
  [[ -n "$handoff" ]] || fail "Configure the optional release handoff; no release was published"
  emit_handoff "Prepare version metadata and release documentation, then request Review. Nothing has been published."
  trap - ERR
  echo "AWAITING_RELEASE_PREPARATION $tag"
  exit 0
fi
stage="verify reviewed release plan"
[[ "$approved_sha" =~ ^([a-fA-F0-9]{40}|[a-fA-F0-9]{64})$ ]] || fail "Approval must identify a full commit SHA"
[[ -n "$expected_source" && "$source_sha" == "$expected_source" ]] || fail "Remote source no longer matches the reviewed release plan"
[[ "$source_sha" == "$approved_sha" ]] || fail "Reviewed preparation must be published to the development source before release"
[[ "$request_source_sha" =~ ^([a-fA-F0-9]{40}|[a-fA-F0-9]{64})$ ]] || fail "Original release source SHA is required"
[[ "$target_sha" == "$expected_target" ]] || fail "Remote target no longer matches the reviewed release plan"
[[ -n "$requested_tag" && "$tag" == "$requested_tag" ]] || fail "Requested release tag no longer matches the reviewed release plan"
[[ -n "$request_run" ]] || fail "Original release request run is required"
original_source_sha="$source_sha"
# Fetch the already published, reviewed preparation object explicitly. The
# release publisher never updates the development branch or original checkout.
git -C "$tmp" fetch -q --no-tags -- "$original_repository" "$approved_sha"
resolved_approval="$(git -C "$tmp" rev-parse --verify "$approved_sha^{commit}")"
[[ "$resolved_approval" == "$approved_sha" ]] || fail "Reviewed commit could not be verified"
git -C "$tmp" merge-base --is-ancestor "$request_source_sha" "$approved_sha" || fail "Prepared release discarded original source history"
source_sha="$approved_sha"
tree_sha="$(git -C "$tmp" rev-parse "$source_sha^{tree}")"

# Validate the exact source snapshot against the proposed release tag BEFORE any
# publication. Project-owned checks retain responsibility for their own metadata.
stage="validate release version"
git -C "$tmp" checkout -q --detach "$source_sha"
version_check="${CERBERUS_RELEASE_VERSION_CHECK:-}"
if [[ -z "$version_check" ]]; then
  checks=()
  while IFS= read -r path; do
    case "$path" in
      scripts/check-version.mjs|*/scripts/check-version.mjs|scripts/check-release-version.mjs|*/scripts/check-release-version.mjs) checks+=("$path");;
    esac
  done < <(git -C "$tmp" ls-tree -r --name-only "$source_sha")
  [[ ${#checks[@]} == 1 ]] || fail "Provide one project-owned release version check through CERBERUS_RELEASE_VERSION_CHECK. No release was published."
  version_check="${checks[0]}"
fi
[[ "$version_check" != /* && "$version_check" != -* && "$version_check" != *..* ]] || fail "Version check must be a tracked relative project path"
git -C "$tmp" cat-file -e "$source_sha:$version_check" || fail "Version check is not tracked in the captured source"
(
  cd -- "$tmp"
  export RELEASE_TAG="$tag" CERBERUS_RELEASE_VERSION="$major.$minor.$patch"
  case "$version_check" in
    *.mjs|*.js) node "$version_check";;
    *.sh) bash "$version_check";;
    *) fail "Unsupported version-check extension; use a project-owned .mjs, .js or .sh check";;
  esac
)
[[ -z "$(git -C "$tmp" status --porcelain --untracked-files=all)" ]] || fail "Version check changed the source snapshot"
[[ "$source_tag" != "$tag_prefix"* ]] || fail "Source provenance tag must use a separate, non-release namespace"


# ------------------------------------------------------------
# Verify that both tag names are available.
# ------------------------------------------------------------

stage="verify tag names"

for name in "$tag" "$source_tag"; do

  if git -C "$tmp" show-ref --verify --quiet \
    "refs/tags/$name"; then

    fail "Release tag already exists: $name"
  fi

done

# ------------------------------------------------------------
# Construct the release commit locally.
#
# Tree: exact source tree.
# Parent: previous target commit, if one exists.
#
# No source ancestry is incorporated.
# ------------------------------------------------------------

stage="create release commit"

if [[ -z "$target_sha" ]]; then

  # First release: create an orphan commit.
  candidate_sha="$(
    printf 'Release %s\n\nSource: %s\n' \
      "$tag" "$source_sha" |
      git -C "$tmp" \
        -c user.name="Cerberus Release" \
        -c user.email="cerberus@localhost" \
        commit-tree "$tree_sha"
  )"

else

  # Subsequent release: one new commit on the target.
  candidate_sha="$(
    printf 'Release %s\n\nSource: %s\n' \
      "$tag" "$source_sha" |
      git -C "$tmp" \
        -c user.name="Cerberus Release" \
        -c user.email="cerberus@localhost" \
        commit-tree "$tree_sha" -p "$target_sha"
  )"

fi

# ------------------------------------------------------------
# Verify the constructed release commit.
# ------------------------------------------------------------

stage="verify release commit"

release_tree="$(
  git -C "$tmp" rev-parse "$candidate_sha^{tree}"
)"

[[ "$release_tree" == "$tree_sha" ]] ||
  fail "Release tree differs from source tree"

parent_line="$(
  git -C "$tmp" rev-list --parents -n 1 "$candidate_sha"
)"

read -r -a commit_parts <<< "$parent_line"
parent_count=$(( ${#commit_parts[@]} - 1 ))

if [[ -z "$target_sha" ]]; then

  [[ "$parent_count" == 0 ]] ||
    fail "Initial release commit is not an orphan"

else

  [[ "$parent_count" == 1 ]] ||
    fail "Release commit has unexpected parent count"

  [[ "${commit_parts[1]}" == "$target_sha" ]] ||
    fail "Release commit has incorrect parent"

fi

# ------------------------------------------------------------
# Create annotated tags locally.
# ------------------------------------------------------------

stage="create tags"

git -C "$tmp" \
  -c user.name="Cerberus Release" \
  -c user.email="cerberus@localhost" \
  tag -a "$tag" \
  -m "Release $tag" \
  "$candidate_sha"

git -C "$tmp" \
  -c user.name="Cerberus Release" \
  -c user.email="cerberus@localhost" \
  tag -a "$source_tag" \
  -m "Source for release $tag" \
  "$source_sha"

# ------------------------------------------------------------
# Refresh remote state before publication.
# ------------------------------------------------------------

stage="verify remote state"

remote_main="$(
  git -C "$tmp" ls-remote origin "refs/heads/$target_branch" |
    cut -f1
)"

remote_wip="$(
  git -C "$tmp" ls-remote origin "refs/heads/$source_branch" |
    cut -f1
)"

[[ "$remote_main" == "$target_sha" ]] ||
  fail "Remote target branch changed during release preparation"

[[ "$remote_wip" == "$original_source_sha" ]] ||
  fail "Remote source branch changed during release preparation"

for name in "$tag" "$source_tag"; do

  remote_tag="$(
    git -C "$tmp" ls-remote origin "refs/tags/$name" |
      cut -f1
  )"

  [[ -z "$remote_tag" ]] ||
    fail "Release tag appeared remotely: $name"

done

# Detect version changes visible before publication.
remote_tags="$(git -C "$tmp" ls-remote --tags --refs origin)"
remote_latest="$(printf '%s\n' "$remote_tags" | awk '{print $2}' | sed -n 's#^refs/tags/##p' | latest_version)"

[[ "$remote_latest" == "$latest" ]] ||
  fail "Remote version namespace changed during preparation"

# ------------------------------------------------------------
# Publish atomically.
#
# The candidate was verified to descend directly from the captured target.
# The lease is a compare-and-swap guard, never permission to rewrite that history:
# - First release creates the target.
# - Subsequent releases fast-forward the target.
# - Both tags are newly created.
# ------------------------------------------------------------

stage="publish"

git -C "$tmp" push --atomic \
  "--force-with-lease=refs/heads/$target_branch:$target_sha" origin \
  "$candidate_sha:refs/heads/$target_branch" \
  "refs/tags/$tag:refs/tags/$tag" \
  "refs/tags/$source_tag:refs/tags/$source_tag"

# ------------------------------------------------------------
# Verify remote publication.
# ------------------------------------------------------------

stage="verify publication"

published_main="$(
  git -C "$tmp" ls-remote origin "refs/heads/$target_branch" |
    cut -f1
)"

published_release="$(
  git -C "$tmp" ls-remote origin "refs/tags/$tag^{}" |
    cut -f1
)"

published_source="$(
  git -C "$tmp" ls-remote origin "refs/tags/$source_tag^{}" |
    cut -f1
)"

if [[ "$published_main" != "$candidate_sha" ||
      "$published_release" != "$candidate_sha" ||
      "$published_source" != "$source_sha" ]]; then

  fail "Remote publication verification failed"
fi

trap - ERR

echo "RELEASED $tag"
echo "$target_branch: $candidate_sha"
echo "source: $source_sha"
echo "release tag: $tag"
echo "source tag: $source_tag"
