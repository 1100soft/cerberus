# Release and correction workflow templates

These are reference templates for configured automations, not built-in defaults or
an automatic migration of other users' prompts. The corresponding local Release,
release-recovery, CI fix, Revise and Review automations were updated on 2026-11-04,
and Release publish was added. Existing enabled settings were preserved.

## Release chain, including documentation

Configure these stages together:

1. **Release** (`release.sh`, manual Bash script): input **progress level** with
   `major`, `minor`, `patch`; optional emitted handoff **(release)**. It captures
   the exact requested version/source/target as a schema-1 `releasePlan` and
   delegates to the agent. It never publishes directly, even if numeric versions
   already match. The original automation run ID is retained.
2. **Release preparation/recovery** (`release-recovery.md`, agent on `release`):
   updates version manifests/lockfiles and relevant current-version docs,
   changelog/release notes and migration notes in an isolated preparation branch.
   It verifies rather than rewrites intentional historical references. All
   substantive edits are committed together and trigger Review. If the existing
   SHA already satisfies preparation, optional **(review)** explicitly requests
   approval without manufacturing a commit. No direct publication/retry bypass.
3. **Review** (`review.md`): independently verifies original release intent,
   prepared snapshot, project validation and release documentation. For this
   route it emits optional **(release-ready)** with the `releaseReady` flag only
   after approval, preserving the original plan and exact reviewed SHA. Defects
   use Revise while retaining the release plan; unresolved evidence blocks.
4. **Release publish** (`release-publish.sh`, Bash script on `release-ready`,
   required flag **releaseReady**): requires structured approval with
   `documentationReviewed:true`, documentation paths, review run and exact SHA.
   It executes an embedded copy of the maintained publisher in approved mode.
   Regenerate that embedded body whenever `release.sh` changes; the publisher
   fixture rejects drift. It performs no AI work and consumes no agent quota.

The default source/target/remote are `wip`, `main`, and `origin`. Override them
with `CERBERUS_RELEASE_SOURCE_BRANCH`, `CERBERUS_RELEASE_TARGET_BRANCH`, and
`CERBERUS_RELEASE_REMOTE` in the manual request. The plan preserves these values,
original source/previous-target SHAs, exact tag, progress level and original run.
Publication rechecks all of them; it never derives a different version on retry.

The agent must update release-specific documentation even when content-related
documentation was already maintained with development commits. Numeric version
validation cannot author release notes. Review may accept already correct docs,
but must inspect and record them. Published historical releases are not rewritten
to repair missing notes without separate authorization.

`release.sh` requires Git, Python 3, and the project version-check runtime (Node.js
or Bash). It discovers a single tracked `scripts/check-version.mjs` or
`scripts/check-release-version.mjs` at any project level. Alternatively, set
`CERBERUS_RELEASE_VERSION_CHECK` to a tracked relative `.mjs`, `.js`, or `.sh`
path. The plan preserves explicit check/tag-prefix overrides. The check must
validate project metadata against `RELEASE_TAG`, exit nonzero on disagreement,
and leave the captured snapshot unchanged.

The approved publisher uses `CERBERUS_RELEASE_APPROVED_SHA`,
`CERBERUS_RELEASE_EXPECTED_SOURCE`, `CERBERUS_RELEASE_EXPECTED_TARGET`,
`CERBERUS_RELEASE_TAG` and `CERBERUS_RELEASE_REQUEST_RUN`; these are populated
from Review's verified handoff by Release publish, not manual input fields.
The prepared commit must preserve the original source ancestry. One atomic push
advances the development source to that reviewed prepared SHA, appends one release
commit to the previous release-target tip, and creates annotated release and
provenance tags. The release tree equals the reviewed prepared tree. An absent
initial target may start with an orphan release; subsequent history is preserved.
Both branch-tip leases prevent overwriting concurrent work. A race requires
fresh verification/review, not an automatic rebase or new tag guess.

Release tags default to `vX.Y.Z`; provenance tags use `cerberus/source/vX.Y.Z`,
outside the `v*.*.*` packaging trigger. Existing tags remain immutable. Failure
handoffs preserve the original request and route through the same preparation
agent. Recovery checks for prior publication before acting and blocks uncertain,
conflicting or already published invalid releases instead of republishing them.

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
