#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_TAG:?}"
: "${RELEASE_SHA:?}"
[[ "$RELEASE_TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]
# Verify the live tag still identifies the source commit, including annotated tags.
tag_object=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/${RELEASE_TAG}" \
  --jq '.object | [.type,.sha] | @tsv')
IFS=$'\t' read -r object_type object_sha <<<"$tag_object"
while [ "$object_type" = tag ]; do
  tag_object=$(gh api "repos/${GITHUB_REPOSITORY}/git/tags/${object_sha}" \
    --jq '.object | [.type,.sha] | @tsv')
  IFS=$'\t' read -r object_type object_sha <<<"$tag_object"
done
test "$object_type" = commit && test "$object_sha" = "$RELEASE_SHA" || {
  echo 'Release tag moved away from the built commit' >&2; exit 1;
}
mapfile -d '' assets < <(find release-assets -maxdepth 1 -type f -print0 | sort -z)
test "${#assets[@]}" -gt 1
# Query the full release list: transport/auth errors must not be mistaken for 404.
release=$(gh api --paginate "repos/${GITHUB_REPOSITORY}/releases?per_page=100" \
  --jq ".[] | select(.tag_name == \"${RELEASE_TAG}\") | [.draft, .target_commitish] | @tsv")
if [ -n "$release" ]; then
  IFS=$'\t' read -r draft target <<<"$release"
  test "$draft" = true || { echo 'Refusing to modify an already published release' >&2; exit 1; }
  test "$target" = "$RELEASE_SHA" || { echo 'Existing draft belongs to a different commit' >&2; exit 1; }
else
  gh release create "$RELEASE_TAG" --verify-tag --target "$RELEASE_SHA" \
    --draft --title "GitCerberus ${RELEASE_TAG#v}" \
    --notes-file docs/stable-release-notes.md
fi
# Retrying a partially uploaded draft is safe; published releases are immutable here.
gh release upload "$RELEASE_TAG" "${assets[@]}" --clobber
