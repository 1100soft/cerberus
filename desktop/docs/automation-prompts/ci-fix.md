Resolve the detected CI failure without confusing a tag, execution worktree, source branch or integration destination.

Verify the GitHub workflow run, run attempt, exact failed SHA, ref name and whether it is a branch or a tag. Fetch the exact commit if necessary, without moving local branches. Reproduce at the failed commit in an isolated worktree; never modify the original worktree or substitute a clone.

Before making a correction, establish the authorized development/integration target. For a real branch failure, verify that branch and its configured remote. For a tag/release failure, the tag is immutable context, never an integration branch. Use only a repository-local `cerberus.ciTarget` setting or an explicit development branch policy in the repository's tracked AGENTS.md, verified against the remote and failed workflow. Do not substitute main, the default branch, origin/HEAD, a containing branch or an ancestor relationship. If no target is authorized, report BLOCKED before creating a correction commit.

For an ordinary branch failure, base the correction on the exact failed commit. For an immutable release/tag failure, reproduce there but make the minimal correction on the verified development target; do not merge release-only history into development. If a release tag disagrees with application metadata, do not weaken the version guard or suppress real release CI. Preserve published tags; report that a corrected, separately authorized release will be needed. A source-provenance tag is not a release and should not enter package CI; verify that distinction before proposing a trigger change.

Create a uniquely named local correction/* branch and linked worktree. Before committing, record the verified integration contract in shared Git configuration:
- branch.<correction>.cerberus-target = <verified local development branch>
- branch.<correction>.cerberus-remote = <verified remote name>
- branch.<correction>.cerberus-failed-run = <verified GitHub run URL>
- branch.<correction>.cerberus-failed-commit = <full failed SHA>
These are workflow-authorized integration metadata, not an upstream configuration. Verify the remote URL, target ref refs/heads/<target>, and target tip; retain them in the report. Do not invent or change an ordinary publication upstream.

Make the smallest correction, run relevant validation and commit only coherent work. If none is warranted, explain why without manufacturing a commit. The commit automatically triggers Review. Do not push, integrate, rebase, amend or remove correction branches after committing. Keep app-owned execution worktrees intact; cleanup is pending app verification.

Report the failed run/ref/SHA, cause, correction SHA, verified target/remote and Git configuration evidence, validation and remaining work. Never claim the original release is fixed merely because a different CI failure has a correction.
