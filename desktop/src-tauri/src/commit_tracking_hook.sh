#!/bin/sh
# All paths/data are supplied as environment values; never interpolated as code.
hook=${0##*/}
original_git() { GIT_CONFIG_COUNT="$CERBERUS_TRACK_CONFIG_COUNT" git "$@"; }
original=$(original_git rev-parse --git-path "hooks/$hook" 2>/dev/null)
record() {
    case "$1" in *[!0-9a-fA-F]*|'') return;; esac
    case ${#1} in 40|64) ;; *) return;; esac
    common=$(original_git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
    associated=false
    if [ "$common" = "$CERBERUS_TRACK_COMMON" ]; then
        associated=true
    elif [ -n "$CERBERUS_TRACK_REMOTES" ]; then
        urls=$(original_git config --get-regexp '^remote\..*\.url$' 2>/dev/null | cut -d ' ' -f 2-)
        while IFS= read -r url; do
            if [ -n "$url" ] && printf '%s\n' "$CERBERUS_TRACK_REMOTES" | grep -Fxq -- "$url"; then associated=true; break; fi
        done <<URLS
$urls
URLS
    fi
    if [ "$associated" = true ]; then
        # One tiny file per SHA; concurrent hook invocations are idempotent.
        : > "$CERBERUS_TRACK_RECORDS/$1" 2>/dev/null || :
    fi
}
case "$hook" in
post-commit)
    if [ -f "$CERBERUS_TRACK_RECORDS/.pending-$PPID" ]; then
        sha=$(cat "$CERBERUS_TRACK_RECORDS/.pending-$PPID")
        rm -f "$CERBERUS_TRACK_RECORDS/.pending-$PPID"
        record "$sha"
    fi;;
reference-transaction)
    input=$(mktemp) || { if [ -n "$original" ] && [ -x "$original" ]; then exec "$original" "$@"; fi; exit 0; }
    cat > "$input"
    if [ "$1" = committed ]; then
        while read -r old new ref; do
            case "$ref" in HEAD|refs/heads/*)
                # The post-commit hook consumes this exact transaction SHA. Reading
                # HEAD there would race another writer, and reflogs may be disabled.
                case "$new" in *[!0-9a-fA-F]*|'') ;; *)
                    if [ "$new" != "$old" ] && [ -n "$(printf '%s' "$new" | tr -d 0)" ]; then
                        printf '%s\n' "$new" > "$CERBERUS_TRACK_RECORDS/.pending-$PPID" 2>/dev/null || :
                    fi;;
                esac
                entry=$(original_git reflog -1 --format='%H %gs' "$ref" 2>/dev/null)
                case "$entry" in
                    "$new commit"*|"$new revert:"*|"$new am:"*) record "$new";;
                    "$new cherry-pick:"*) case "$entry" in "$new cherry-pick: fast-forward"*) ;; *) record "$new";; esac;;
                    "$new merge "*) case "$entry" in *Fast-forward*) ;; *) record "$new";; esac;;
                esac
            esac
        done < "$input"
    fi
    if [ -n "$original" ] && [ -x "$original" ]; then "$original" "$@" < "$input"; result=$?; else result=0; fi
    rm -f "$input"
    exit "$result";;
post-rewrite)
    input=$(mktemp) || { if [ -n "$original" ] && [ -x "$original" ]; then exec "$original" "$@"; fi; exit 0; }
    cat > "$input"
    while read -r old new rest; do [ "$old" = "$new" ] || record "$new"; done < "$input"
    if [ -n "$original" ] && [ -x "$original" ]; then "$original" "$@" < "$input"; result=$?; else result=0; fi
    rm -f "$input"
    exit "$result";;
esac
if [ -n "$original" ] && [ -x "$original" ]; then exec "$original" "$@"; fi
exit 0
