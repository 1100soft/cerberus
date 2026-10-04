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
- **Desktop packages** (`.github/workflows/desktop-packages.yml`) runs manually or
  on `v*.*.*` tags. Manual builds on autosave branches are skipped. It builds Debian/AppImage installers for Linux x64 and ARM64,
  an NSIS installer for Windows x64, and DMGs for Intel and Apple Silicon macOS.
  Installers are uploaded as separate architecture-named artifacts, retained for
  30 days. It does not create a GitHub release or publish to stores. macOS uses
  ad-hoc signing; Windows packages are unsigned. Native ARM Linux hosted runners
  require a public repository; private hosting needs an eligible ARM runner.
- **Publish Debian package** (`.github/workflows/publish.yml`) is the existing tag
  workflow. It validates and forwards the x64 Debian artifact to the external APT
  publication repository using `APT_DISPATCH_TOKEN`. The new packaging workflow
  does not change this publication path or require that secret.

Workflow tokens are read-only. CI cancels superseded branch runs; packaging does
not cancel an in-progress build. Matrix failures do not cancel other platforms.
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
5. Push a matching version tag when ready for the existing APT publishing path.
   Tag builds reject tags that disagree with the native application version.
   Download artifacts from Actions; public GitHub/store release publication is a
   separate future step.

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
