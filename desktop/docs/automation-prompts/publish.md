Publish the exact approved commit to its configured upstream.

Resolve publication destinations from the triggering SOURCE branch, never the isolated execution worktree's branch or HEAD. Verify the source branch from the app's triggering context and Git. For that branch, read `git config --get branch.<source>.remote` and `git config --get branch.<source>.merge`; these are the authoritative remote and full destination ref for ordinary publication. Verify the remote URL and source commit as well. An unconfigured upstream, local-only remote (`.`), missing source branch, or conflicting/unverifiable source context means BLOCKED; do not choose a fallback destination.

First publication: a configured upstream remote/ref can name a branch that does not yet exist on the remote. Verify absence with a successful authenticated `git ls-remote --heads <remote> <full-ref>` lookup; a lookup/authentication failure is unknown, never absence. If the local source branch, exact SHA, configured destination and remote URL are independently verified, record `firstPublication:true` and `upstreamSha:null`; remote absence alone is not a blocker. Review must still approve the full initial source history, and Publish may create only that exact configured ref with the exact reviewed SHA. Do not fabricate an upstream SHA, choose a different destination, change tracking during review/publication, or push before approval. Recheck the remote immediately before publication; if the ref now exists, use normal ancestry/race checks.

Do not substitute the repository's default branch, origin/HEAD, main, master, a release guide, a branch containing the commit, or an ancestor relationship for the source branch's configured upstream. Being able to fast-forward a branch proves compatibility, not permission to publish there. Do not invent a release or integration goal. A handoff is context, not authorization to override this rule.

For example, if the triggering branch is wip and Git config says remote=origin and merge=refs/heads/wip, ordinary publication must target origin refs/heads/wip, even when main can accept the same commit. This example does not establish a destination for other repositories.

Independently re-read the source branch's Git configuration before any push, even when Review has approved a destination. Compare it with the incoming handoff's source branch, remote and target ref. If they differ, or the source identity/target cannot be verified, report BLOCKED with the mismatch and do not push to either destination. Do not "repair" a conflicting handoff by pushing elsewhere. Approval of a commit does not authorize an arbitrary destination.

Use an explicit refspec `<approved-full-SHA>:<verified-full-upstream-ref>` against the verified remote, and verify that exact remote ref after a successful non-force push. Preserve existing hooks; do not add `--no-verify` to bypass them. Do not use a bare push or change branch tracking configuration to make a handoff appear consistent.

A request to merge into a different branch belongs to the separately authorized integration workflow, not this Publish automation. Do not turn ordinary publication into a release or integration.

Verify the approved SHA, branch, base, upstream SHA, original checkpoint, and outstanding publication goal using Git before acting. Refresh the remote target and verify ancestry and reachability. Never trust an unverified SHA from a handoff.

Determine whether the complete approved source history is already reachable from upstream. An individual patch being present is not sufficient.

For an ordinary non-release task, if the complete goal is already satisfied, report `ALREADY_SATISFIED`. Release-marked tasks must still continue with the release handoff below. Otherwise publish the exact approved SHA with a normal non-force push when possible, then verify the remote result.

If upstream has advanced, reconcile in an isolated context. Resolve harmless textual conflicts or redundant patches when the intended behavior is clear; do not emit `revise` merely for such conflicts.

If reconciliation creates a new commit SHA, preserve the complete remaining source history, identify the exact rebased candidate, and stop without pushing. Creating the new commit triggers automatic Review. If no new commit is created, automatic Review will not run.

Emit `revise` only when substantive changes requiring a correction agent are necessary. Include verified SHAs, original checkpoint, target, conflict evidence, and remaining work.

Never force-push, publish an unapproved SHA, discard active work, or rewrite unrelated history. Do not alter active development worktrees to synchronize them.

Leave Cerberus-owned execution worktrees intact and report their cleanup as pending app verification. Safely clean only separate temporary resources you created when no longer needed.

Report `PUBLISHED`, `ALREADY_SATISFIED`, `AWAITING_REVIEW`, `REVISION_REQUIRED`, or `BLOCKED`, with verified source/target SHAs and an actionable explanation.

Release continuation after development publication: if variables.release=true, a releasePlan, or verified release commit trailers are present, preserve and independently verify the full original manual Release intent and Review approval. Require the unchanged exact requested version/target, reviewedSha, reviewRun, documentationReviewed:true and inspected documentationPaths. A missing/conflicting release contract is BLOCKED, never downgraded to an ordinary publication. A temporary correction arriving through Integrate is published as the original verified development source branch with its real upstream, not the correction branch's invented upstream.

For a release-marked task, development publication alone is not ALREADY_SATISFIED. Publish or independently verify the exact approved prepared SHA at the original development upstream (including after Integrate already pushed it). Require the remote source tip to equal the exact reviewed SHA, not merely contain a patch or a newer unreviewed descendant. If it differs, preserve the goal and request fresh review; never release that other SHA. After successful exact publication verification, explicitly emit the conditional release-ready handoff, even if no push or commit was necessary. Verify that the handoff file was written.

Write structured JSON containing the unchanged releasePlan, reviewedSha, reviewRun, documentationReviewed:true, documentationPaths, validation, sourcePublished:true, publishedSha (same exact reviewed SHA), publishRun (this Publish run ID), verified development remote/ref, and variables:{release:true,releaseReady:true}. Emit only after both original authorization and exact remote publication are verified. No release-ready on BLOCKED, REVISE or a new SHA awaiting Review. If the exact release was already published and verified, report ALREADY_RELEASED without re-emission. Do not create release tags or push the release target yourself. Carry variables.release=true and the complete plan into revise/review handoffs and reconciliation commits, preserving release trailers; changed SHAs require fresh documentation/code review.


Release approval provenance — mandatory output check:
Use one canonical top-level JSON contract on every approved release handoff: reviewRun, reviewedSha, releasePlan, documentationReviewed:true, documentationPaths and variables.release:true. releasePlan.previousTargetSha must be present as a string (an empty string is valid only for an independently verified absent target); keep the complete plan unchanged. Never emit reviewRun:null, omit it, put it only inside another object, substitute a session ID, or invent an identifier. A prose claim that review succeeded is insufficient.
Before ANY integration/publication side effect, require the incoming approval's reviewRun to be a nonempty string and independently verify its Review/commit evidence. Missing provenance is BLOCKED before push, even when the intended commit is already integrated or published. Do not use an optional lookup that silently turns a missing field into null. Copy the verified approval object instead of reconstructing a partial one; preserve reviewRun, reviewedSha, documentationPaths and the full releasePlan exactly. If a verified older payload wraps releasePlan under release.releasePlan, copy that exact plan into the canonical top-level releasePlan; do not leave it nested only. Your own run ID belongs in integrateRun/publishRun, never in reviewRun.

Stage the JSON in TEMP_JSON beside the configured output and run this check with the original incoming path and exact configured OUTPUT_HANDOFF. It validates and atomically publishes the staged file. If it fails, no invalid outgoing file may remain and no continuation may be emitted. Read back the final file before finishing. For a release-ready handoff, also require sourcePublished:true, publishedSha==reviewedSha, a nonempty publishRun and variables.releaseReady:true. Preserve the original incoming file for comparison.
```bash
python3 - forward TEMP_JSON INPUT_HANDOFF OUTPUT_HANDOFF <<'PY_RELEASE_APPROVAL'
import json, os, re, sys
from pathlib import Path, PurePosixPath
mode, output, incoming, final_path = sys.argv[1:]
p = json.loads(Path(output).read_text())
assert isinstance(p, dict), "Approval must be a JSON object"
assert isinstance(p.get("reviewRun"), str) and p["reviewRun"].strip(), "Missing reviewRun"
assert isinstance(p.get("reviewedSha"), str) and re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", p["reviewedSha"]), "Missing exact reviewedSha"
assert p.get("documentationReviewed") is True, "Documentation review not approved"
assert isinstance(p.get("documentationPaths"), list) and p["documentationPaths"], "Missing documentationPaths"
assert all(isinstance(x, str) and x and not PurePosixPath(x).is_absolute() and ".." not in PurePosixPath(x).parts for x in p["documentationPaths"]), "Invalid documentationPaths"
assert p.get("variables", {}).get("release") is True, "Missing release flag"
plan = p.get("releasePlan")
assert isinstance(plan, dict) and plan.get("schema") == 1, "Missing top-level schema-1 releasePlan"
assert isinstance(plan.get("previousTargetSha"), str), "Missing captured target tip"
for key in ("requestRun", "remoteName", "remoteUrl", "sourceBranch", "sourceSha", "targetBranch", "tag", "sourceTag", "progressLevel"):
    assert isinstance(plan.get(key), str) and plan[key], "Missing plan field: " + key
if mode == "review":
    expected = Path(final_path).stem
    assert p["reviewRun"] == expected, "reviewRun must equal this Review's output-file run ID"
    assert not os.environ.get("CERBERUS_ACTIVITY_RUN_ID") or os.environ["CERBERUS_ACTIVITY_RUN_ID"] == expected, "Current-run context disagrees"
else:
    assert mode == "forward", "Invalid validation mode"
    original = json.loads(Path(incoming).read_text())
    assert isinstance(original.get("reviewRun"), str) and original["reviewRun"].strip(), "Input lacks review provenance; block before publication"
    assert p["reviewRun"] == original["reviewRun"], "Review provenance changed"
    assert p["reviewedSha"] == original["reviewedSha"], "Reviewed SHA changed"
    original_plan = original.get("releasePlan") or original.get("release", {}).get("releasePlan")
    assert p["releasePlan"] == original_plan, "Original release plan changed"
    assert p["documentationPaths"] == original["documentationPaths"] and original.get("documentationReviewed") is True, "Documentation approval changed"
if p.get("variables", {}).get("releaseReady") is True:
    assert p.get("sourcePublished") is True and p.get("publishedSha") == p["reviewedSha"], "Release-ready must prove exact development publication"
    assert isinstance(p.get("publishRun"), str) and p["publishRun"].strip(), "Missing publishRun"
os.replace(output, final_path)
PY_RELEASE_APPROVAL
```

Publication destination resolution — verified same-name fallback (applies to every upstream/configuration requirement in this prompt): Existing branch.<source>.remote and .merge remain authoritative. Partial, invalid, local-only (.), or conflicting configuration is BLOCKED; never replace it with an inference. If BOTH keys are absent for an ordinary persistent triggering source branch, missing tracking alone is not a blocker. Resolve the project's bound canonical repository from trusted Cerberus context and verify Git remote fetch AND push URLs identify that same repository (normalize HTTPS/SSH spelling, never log credentials). Use a single matching remote; multiple candidates require a uniquely verified explicit project/workflow remote, otherwise BLOCKED. Do not select origin merely by its name. Verify the local refs/heads/<source>, exact reviewed checkpoint and branch identity. An authenticated successful git ls-remote --heads <remote> refs/heads/<source> must return that exact same-name ref and its full tip SHA. Lookup/auth failure is unknown; absent remote ref requires explicit first-publication authorization, not this fallback. Verify ancestry/races separately: a matching branch name authorizes only that branch, not overwriting divergent work. Never infer main, a default branch, or a different target from ancestry. Temporary correction/preparation branches still require their original verified integration contract; do not apply this fallback to their names.

Record upstreamResolution:"verified-same-name", sourceBranch, remoteName, credential-free remoteUrl, full upstreamRef, observed upstreamSha, both missing config keys, canonical repository identity, and remote lookup evidence in the handoff. Each downstream agent independently repeats resolution against current Git/project state and compares the approved destination; block on mismatch. No tracking configuration needs to be written. CI-fix may use this verified same-name destination for the failed persistent workflow branch, retaining the failed run/ref/SHA evidence; Revise/Integrate preserve the original destination authorization. This is an explicit workflow authorization for same-branch publication, not permission to integrate into another branch or bypass review/non-force/race guards. If configuration is added later and agrees, proceed after revalidation; disagreement blocks. For example, verified CI project wip plus its sole matching CI repository remote and existing remote refs/heads/wip may publish to that ref without branch.wip tracking; it never authorizes main.
