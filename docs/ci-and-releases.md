# CI and release foundations

## Workflows

- **Desktop CI** (`.github/workflows/ci.yml`) runs on branch pushes, pull
  requests, and manual dispatches, excluding `autosave` and `autosave/**` branches.
  Push and PR target filters prevent automatic runs for those branches; job guards
  also skip autosave PR source branches and manual dispatches. It validates workflow syntax, installs dependencies
  from the lockfiles, builds the frontend (including dropdown rules and TypeScript),
  checks release version consistency, runs frontend logic tests, and compiles the
  native application and tests on Linux, Windows, and macOS. Linux additionally
  runs native regression tests serially and mocked WebKitGTK integration fixtures
  for automations, CI recovery, handoffs, repository reordering, and viewport zoom.
  Live provider/GitHub tests stay ignored; CI requires no account credentials.
- **Desktop packages** (`.github/workflows/desktop-packages.yml`) is manual or
  called by the stable release workflow. Autosave branches are skipped. It builds
  Debian/AppImage for Linux x64/ARM64, NSIS for Windows x64, and DMGs for Intel and
  Apple Silicon macOS. All requested bundles must exist. Architecture-named
  artifacts remain available for 30 days. This workflow itself does not publish.
- **Stable desktop release** (`.github/workflows/publish.yml`) runs on `v*.*.*`
  tags, or can be rerun with a version-tag ref. Only strict stable `vMAJOR.MINOR.PATCH`
  tags matching the app version and reachable from `main` are accepted. It runs
  Desktop CI at that tag, waits for every installer build, and creates a GitHub
  **draft** release with uniquely named installers and SHA256SUMS. Retrying a draft
  can replace its partial uploads; an already published release is never modified
  by the drafting script. It forwards the already-built x64 Debian package to
  `1100soft/1100`, preserving the APT dispatch payload and `APT_DISPATCH_TOKEN`.
  APT publication is asynchronous: dispatch success is not confirmation that the
  external index has updated. The external APT service remains app-independent.

Checks/builds use read-only tokens; GitHub release jobs alone request contents
write permission. CI cancels superseded branch runs; packaging and releases do
not cancel in-progress work. Stable tags use the release workflow's CI gate,
without also launching a duplicate standalone CI/package build. Matrix failures
do not cancel other platforms. Linux ARM64 and Intel macOS use their explicit
hosted runner labels; runner availability/billing follows organization settings.

The existing Rust source is not rustfmt-clean, so CI does not enforce a new
repository-wide formatting policy. There is no configured ESLint suite.

## Preparing a desktop release

1. Update `version` in both `desktop/src-tauri/Cargo.toml` and
   `desktop/src-tauri/tauri.conf.json`, and regenerate Cargo.lock as necessary.
   `node desktop/scripts/check-release-version.mjs` checks agreement;
   `RELEASE_TAG=v0.1.0 node desktop/scripts/check-release-version.mjs` additionally
   checks a proposed tag. The npm package is private build tooling, not the native
   application release version authority.
2. Require successful Desktop CI through GitHub branch protection/rulesets, then
   manually run Desktop packages on the candidate commit. Repository rules must
   be configured separately in GitHub; adding YAML does not enable protection.
3. Install and smoke-test every target artifact on real machines: first launch,
   Git discovery, credential storage, tray lifecycle, provider commands, updates,
   and uninstallation. A successful compile is not a native runtime smoke test.
4. Before public distribution, add Windows signing and Apple Developer signing
   plus notarization using protected GitHub environments and scoped secrets.
   Ad-hoc signing is useful for test artifacts, but does not establish a trusted
   public publisher. Configure updater signing and update endpoints if an updater
   is implemented; the current app has no release updater pipeline.
5. Tag the reviewed commit on `main` with its exact `vMAJOR.MINOR.PATCH` version.
   The stable workflow runs checks and packaging before staging the draft and APT
   dispatch. Review installer behavior and edit the generated draft release notes.
   Publish the draft manually when ready. To enable workflow promotion, configure
   required reviewers on the `stable-release` environment first, then set repository
   variable `CERBERUS_PUBLISH_STABLE_RELEASE=true`. Promotion waits for both draft
   creation and successful APT dispatch. This variable defaults to disabled.
   Windows packages remain unsigned and macOS uses ad-hoc signing; approval does
   not add publisher signing/notarization. Store and updater publication remain
   separate future integrations.

Node 22 and Rust stable are used, with npm/Cargo lockfiles enforced. Stable Rust
is intentionally rolling; pin a tested toolchain when release reproducibility
requires it. Linux artifacts are built on Ubuntu 24.04 and need testing against
intended distribution baselines; AppImage does not eliminate libc compatibility
requirements. Windows ARM64 is not included yet.

## Mobile readiness

Tauri 2 supports Android and iOS, but this repository is currently a desktop app.
There are no generated Android/iOS projects or mobile entry point, and the native
startup unconditionally creates a system tray. Git, shell execution, local editor
handoffs, and provider CLI processes require a desktop-style environment. The UI
also assumes a minimum 900 × 620 desktop window. Mobile icons alone do not make
these features mobile-compatible.

Before enabling mobile builds:

1. Decide which mobile features operate locally and which use a paired desktop or
   service. Define platform adapters for repository access, credentials, provider
   execution, notifications, and handoffs; gate unavailable desktop commands.
2. Guard tray/window startup and desktop dependencies with platform configuration,
   add Tauri's mobile entry point, and implement touch/small-screen layouts.
3. Initialize and commit the generated Android/iOS projects. Add Android JDK/SDK/
   NDK and Rust target builds, and macOS/Xcode iOS simulator builds to CI. Start
   with credential-free debug/simulator artifacts and platform adapter tests.
4. Add protected release jobs for signed Android AABs and iOS archives, with
   keystore/provisioning secrets, device smoke tests, and explicit store promotion.

No placeholder mobile job reports success today. Add actual compile gates once
these dependencies and generated projects exist.

References: [Tauri GitHub Actions](https://v2.tauri.app/distribute/pipelines/github/),
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/), and
[GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

## Running the Linux UI suite locally

With GTK3, WebKitGTK 4.1, Python GI, Xvfb, xauth, and frontend dependencies installed,
run `bash desktop/scripts/check-webkit-ci.sh`. It owns a strict-port Vite server on
3000, waits for readiness, runs fixtures sequentially in virtual displays, and
stops its server on exit. Stop an existing port-3000 server first. Individual
Python fixtures can also use an already running development server.


## Shared workflows

Desktop checks and packages now call `1100soft/CI` reusable workflows pinned to
one reviewed full commit SHA. APT publication also calls the shared repository;
Cerberus still validates the built Debian identity/version/architecture before
forwarding it. These calls check out Cerberus, retain its app-owned regression
commands, and preserve the five-target package matrix and artifact names. Autosave
exclusions remain in the caller jobs. No caller secrets are implicitly inherited;
only the APT job explicitly forwards `APT_DISPATCH_TOKEN` and adds `actions: read`.

The shared repository's README defines the complete input, matrix, secret, hook,
and artifact contracts. Its generic desktop/package mechanics also serve Mountlet,
whose rclone variants, Store checks, and installed-runtime probes remain app hooks.
Cerberus retains stable tag validation, GitHub draft release tooling, promotion
policy, frontend/native fixtures, and its small caller workflows.

The shared CI commit must be pushed before these caller changes can run on GitHub.
For a private shared repository, grant same-organization callers access in its
Actions settings and allow the reusable workflows in caller policies. Pin consumers
to reviewed commits and update explicitly. Update branch protection if nested job
names change, and run actual hosted checks/packages before rollout. The previous
local `tauri-check.yml` and `tauri-package.yml` implementations have moved into
the shared repository and their duplicate local files have been removed.

Remote access/settings and signing are not configured by this migration. Local
lint and offline regression tests do not verify hosted Windows/macOS builds,
release permissions, or asynchronous APT publication.

References: [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows),
[private workflow access](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations),
and [hosted runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
