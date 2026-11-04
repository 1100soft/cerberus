Resolve the substantive findings, authorization/configuration blocker or integration conflict supplied by the incoming revision context. Preserve the original publication goal.

Verify the original Review run and incoming handoff, reviewed full SHA/checkpoint, original source branch, base, intended target, current remote target and outstanding work against Git. The source branch's real configured upstream remains authoritative for ordinary publication. Do not invent a destination or manufacture an upstream on a correction branch to bypass an authorization blocker.

Create or reuse a safe isolated correction/* branch and linked worktree. Preserve active worktrees, source history and the original checkpoint. Before committing, record the revision integration contract in shared Git config:
- branch.<correction>.cerberus-target = verified target branch
- branch.<correction>.cerberus-remote = verified remote
- branch.<correction>.cerberus-revision-run = original Review automation run ID
- branch.<correction>.cerberus-revision-source = original source branch
- branch.<correction>.cerberus-revision-checkpoint = original reviewed full SHA

Independently verify the original source branch's remote/merge configuration, remote URL, target ref/tip and original Review evidence. For revisions of an already authorized correction, preserve and verify its existing CI/release/revision authorization chain instead of relabeling it as ordinary publication. If evidence cannot be verified, report BLOCKED; do not create misleading metadata or guess a target.

Make the smallest complete correction. Findings describe problems, not mandatory remedies. Validate and commit every substantive tracked-file correction as a coherent commit; do not leave changed tracked files uncommitted. Do not create an empty commit solely to wake another automation. A new correction commit automatically triggers Review, so do not also emit a duplicate review handoff for that same commit.

If a configuration-only fix, conflict inspection or other no-commit action resolves a real blocker and the original goal still needs approval/publication, explicitly emit the conditional review handoff. Include the exact existing correction/review SHA, source branch, base, original checkpoint, original Review run, verified authorization contract, target remote/ref/current tip, findings resolved and validation. This is a request for fresh Review, never permission to bypass it or publish directly. Verify that the handoff file was actually written; a final response saying review is pending does not dispatch it.

If no correction or forward progress is possible, report BLOCKED with an actionable reason and emit no handoff. If the complete original goal is already satisfied, report ALREADY_SATISFIED without a commit or handoff. A redundant individual patch does not establish that the entire goal is satisfied. Do not repeatedly emit review for an unchanged unresolved blocker.

Do not push, integrate, amend previously reviewed commits, force-update branches or remove resources needed downstream. Leave app-owned worktrees intact; cleanup is pending app verification.

Report the original checkpoint, source/target/base, correction SHA, findings resolved, validation and remaining work. End with exactly one disposition: COMMITTED_FOR_REVIEW (new SHA), HANDED_OFF_FOR_REVIEW (existing SHA and handoff emitted), ALREADY_SATISFIED, or BLOCKED. Commit tracked changes when needed; explicitly hand off successful no-commit repairs when needed. Never silently stop between revision and Review.
