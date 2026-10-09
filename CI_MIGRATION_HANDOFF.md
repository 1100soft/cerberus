# Shared CI migration handoff

Date: 2026-10-09
Audience: Cerberus's dedicated agent

## State and existing work

Shared workflows now live in `/home/eh930/project/apps/CI`, whose remote is
`https://github.com/1100soft/CI.git`. Cerberus callers pin shared commit
`859fc753347512c1e64d50f487251d41b0778925` —
`Add reusable Tauri, Node, and APT workflows`, committed on CI's `wip` branch.
The shared checkpoint was not pushed during this work; callers cannot resolve
it on GitHub until that exact commit is published and access is permitted.

Cerberus already had substantial modified and untracked work, including its CI
callers, reusable workflow prototypes, release scripts, and CI documentation.
The migration edits were applied on top of that work and deliberately left
uncommitted. Do not stage or commit the entire working tree as a CI migration.
The existing `HANDOFF.md` was already modified and was left untouched; this
separate file records only this agent's migration scope.

## Changes in Cerberus

- `.github/workflows/ci.yml`: replaced the local reusable desktop check reference
  with `1100soft/CI/.github/workflows/tauri-check.yml` at the full SHA above.
  Existing app regression commands, Linux WebKit command, workflow validation,
  caller triggers, and autosave guards were preserved.
- `.github/workflows/desktop-packages.yml`: replaced the local package workflow
  reference with shared `tauri-package.yml` at the same SHA. Kept `desktop`, the
  `gitcerberus` artifact prefix, version checks, and all five targets: Linux
  x64/ARM64, Windows x64, and macOS Intel/Apple Silicon. Artifact names remain
  compatible with the release workflow.
- `.github/workflows/publish.yml`: replaced its inline APT transport job with
  shared `apt-publish.yml`. Kept its dependencies and Debian package validation:
  exactly one package, identity `gitcerberus`, tag-matching version, and `amd64`
  architecture. The caller preparation command copies the validated installer
  to `apt-packages`. The caller explicitly grants `actions: read` and forwards
  only `APT_DISPATCH_TOKEN`.
- The previous local `.github/workflows/tauri-check.yml` and
  `.github/workflows/tauri-package.yml` prototypes were imported and generalized
  in the CI repository, then removed locally to avoid duplicate implementations.
  They were untracked before migration, so their removal does not appear as a
  tracked deletion in `git status`.
- `docs/ci-and-releases.md`: replaced its shared-workflow migration guidance with
  the implemented ownership, pinned references, access requirements, and remaining
  hosted verification steps. Existing unrelated documentation edits were retained.

No other Cerberus files were edited by this migration. Existing application,
regression-script, README, release-tooling, and handoff changes belong to the
preexisting work and should be accommodated independently. Some touched workflow
YAML was reserialized, so its diff includes formatting changes.

## Ownership and shared behavior

Cerberus still owns stable tag/main ancestry validation, version consistency,
GitHub draft release tooling and asset assembly, promotion policy, app regression
scripts, and autosave exclusions. The shared repository owns toolchain/dependency
setup, frontend/native check mechanics, installer builds, requested-bundle checks,
artifact uploads, and APT download/upload/dispatch mechanics.

No secrets are implicitly inherited. Shared packaging defaults to a macOS
minimum deployment target of 11.0 and uses ad-hoc Apple signing. Signing,
notarization, mobile builds, and updater publication remain separate work.
APT uses already-built installers and dispatches the existing `apt-package`
payload to `1100soft/1100`; it does not confirm external index completion.

## Validation completed

- Actionlint 1.7.12 passed for shared, Cerberus, and Mountlet workflows.
- Cerberus `.github/scripts/check-release-tooling.py`: all three tests passed.
- All eight cross-repository caller input/secret contracts and package artifact
  name uniqueness passed local checks.
- Shared CI's four offline contract tests passed: requested bundle validation,
  build credential handling/isolation and failure propagation, environment
  injection rejection, and artifact download arguments/failures.
- Diff whitespace checks passed.

Full Cerberus application builds/regression suites were not run as part of this
workflow migration. Hosted Linux/Windows/macOS packaging, GitHub release
permissions, signing, and live APT publication have not been verified.

## Next steps for the dedicated agent

1. Review these four touched Cerberus files against the preexisting local work.
   Integrate the changes into the appropriate checkpoint without sweeping in
   unrelated feature work. Consult the shared CI README for exact contracts.
2. Publish the shared CI checkpoint before the Cerberus caller updates, with
   normal push authorization. No pushes were authorized/performed here.
3. Configure private-workflow access and caller Actions policy if required.
   Check branch protection/rulesets for changed nested job names.
4. Run Cerberus branch CI and manual packages on GitHub, confirming all five
   architecture artifacts and requested bundle outputs.
5. Validate the stable release gates, draft asset assembly, and APT handoff under
   existing release policy. Do not promote a release merely to test this migration.
6. Keep app checks and release policy in Cerberus; update shared SHA pins only
   after reviewing and validating the new shared implementation.

The removed local reusable prototypes are represented in the shared implementation;
restoring them as parallel maintained workflows would reintroduce duplication.

## Cerberus review (2026-10-09)

The dedicated Cerberus agent reviewed the shared check/package/APT implementations
and caller contracts. Five target artifacts, stable tag/main/version checks,
app-owned Debian validation, autosave exclusions, and explicit secret forwarding
remain consistent. Shared offline contracts (4), Cerberus release tooling tests
(3), and actionlint passed again. The earlier HANDOFF.md repository proposal is
superseded by 1100soft/CI and the pinned commit documented here. No hosted runs,
pushes, remote access-policy changes, or releases were performed by this review.
