# Release and correction workflow templates

These are reference templates for configured automations, not built-in defaults or
an automatic migration of other users' prompts. The corresponding local Release,
release-recovery, CI fix and Review automations were updated together on 2026-11-04;
their enabled settings were preserved.

## Safe release publication

`release.sh` is a Bash publisher. It requires Git, Python 3, and the runtime for
the project's version check (Node.js or Bash). Configure a manual choice input
named **progress level**, with `major`, `minor`, and `patch`, and optional emitted
handoff **(release)**. The recovery agent uses `release-recovery.md`.

The default source/target/remote are `wip`, `main`, and `origin`. Override them
with `CERBERUS_RELEASE_SOURCE_BRANCH`, `CERBERUS_RELEASE_TARGET_BRANCH`, and
`CERBERUS_RELEASE_REMOTE`; these are explicit release destinations, not ordinary
publication upstreams. There is no historical release baseline. Existing target
history is preserved and exactly one commit is appended per release; the new
commit's tree equals the captured source tree. The first release can be orphaned.

Prepare and review application version metadata **before** publication. The
publisher derives the proposed version from existing semantic version tags and
the selected increment, then validates that exact source snapshot with
`RELEASE_TAG` and `CERBERUS_RELEASE_VERSION` set. It discovers a single tracked
`scripts/check-version.mjs` or `scripts/check-release-version.mjs` at any project
level. Alternatively, set `CERBERUS_RELEASE_VERSION_CHECK` to a tracked relative
`.mjs`, `.js`, or `.sh` path. The check must verify all relevant project metadata
against `RELEASE_TAG`, exit nonzero on disagreement, and leave the snapshot
unchanged. Missing/ambiguous checks and version mismatches fail before publication
and emit the optional recovery handoff. The publisher never edits metadata or
silently chooses a different version.

Release tags default to `vX.Y.Z`; source-provenance tags use
`cerberus/source/vX.Y.Z`, outside the `v*.*.*` packaging trigger. The prefix can be
changed with `CERBERUS_RELEASE_SOURCE_TAG_PREFIX`, but must remain outside the
release-tag namespace. Source, target and tags are rechecked immediately before
an atomic push. A target-tip lease protects against concurrent updates; it is
never permission to rewrite target history. Published tags are immutable.

Recovery verifies the original run and exact release goal. Metadata corrections
are committed for Review on a verified development target, not immediately
published. A previously published invalid release requires a separately
authorized repair/superseding release. Repeated Release runs are new requests,
not a safe substitute for recovery of an uncertain publication.

## CI correction and Review

GitHub's `headBranch` field can contain a **tag name**. Both agents must verify
its actual ref type. Cerberus prepares the exact failed commit, fetching a
missing full SHA from configured remotes without moving existing branch/tag refs
or `FETCH_HEAD`; it never substitutes the current checkout. Each remote fetch
has a 60-second timeout and failures retain an actionable error for retry.

The CI fix template authorizes correction integration only through a verified
branch policy in tracked `AGENTS.md` or explicit local `cerberus.ciTarget`, plus
shared Git config on the correction branch:

- `branch.<correction>.cerberus-target`: development branch.
- `branch.<correction>.cerberus-remote`: verified remote.
- `branch.<correction>.cerberus-failed-run`: GitHub run URL.
- `branch.<correction>.cerberus-failed-commit`: failed full SHA.

Release-recovery corrections instead record `cerberus-release-run` and
`cerberus-release-source` so Review can verify the saved original Release run
and incoming handoff. These fields do not configure or impersonate an upstream.
Review independently validates this evidence and emits `integrate`; ordinary
commits still require their actual configured upstream and emit `publish`.
Missing/conflicting authorization is blocked, never guessed from branch names,
a commit trailer, ancestry, the default branch, or the agent worktree's branch.

The 2026-11-04 Mountlet chain exposed a mismatched release version, a provenance
tag triggering packaging, a remote-only commit unavailable to agent startup,
and incompatible correction/Review target rules. These changes prevent those
failure paths; they do not retroactively repair the already published release,
integrate pending corrections, or move its tags.

Validate the publisher with `python3 desktop/scripts/check-release-publisher.py`
from the repository root. Tests publish only to disposable local bare remotes.

## Revision continuation

Use `revise.md` for Revise and configure optional emitted handoff **(review)**.
Substantive tracked-file corrections must be validated and committed; the commit
triggers Review. A configuration-only repair must instead explicitly emit review
for the existing SHA once the blocker is resolved and approval is still needed.
Do not manufacture empty commits or send a duplicate handoff after committing.
Unresolved blockers emit nothing, preventing unchanged Review/Revise loops.

Ordinary revisions preserve the verified original publication target using
`cerberus-target`, `cerberus-remote`, `cerberus-revision-run`,
`cerberus-revision-source`, and `cerberus-revision-checkpoint` on their correction
branch. Review independently verifies the original Review evidence and actual
source upstream. This is integration authorization, not a fabricated upstream;
CI/release revisions preserve their own original authorization chain.
