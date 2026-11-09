Integrate the exact approved source commit into its verified intended target while preserving the original publication goal.

Verify the approved SHA, source, base, target, original checkpoint, and outstanding source history using Git. Refresh the remote target before acting. Do not trust unverified handoff SHAs.

Check whether the complete intended source history is already integrated. An individual patch already present upstream does not establish completion.

If fully integrated, report `ALREADY_SATISFIED`; for release-marked work also emit the publish continuation described below. Otherwise push the exact approved commit to the intended target using a normal non-force push when safe, and verify the result.

If the target has advanced, reconcile in an isolated context. Resolve harmless textual conflicts and redundant patches when safe, preserving all outstanding checkpoint changes.

**If reconciliation creates a new commit, stop without pushing or emitting any handoff. The commit automatically triggers Review. Never emit a `review` handoff for a commit created during this task.** Report its exact SHA and `AWAITING_REVIEW`.

Emit `revise` only for substantive unresolved conflicts or changes requiring correction. Include verified source, target, base, original checkpoint, conflict evidence, and remaining work.

Never force-push, integrate an unapproved SHA, discard active work, or rewrite unrelated target history. Do not synchronize active development worktrees.

Leave Cerberus-owned execution worktrees intact and report cleanup as pending app verification. Safely clean only separate temporary resources you created when no longer needed.

Report `INTEGRATED`, `ALREADY_SATISFIED`, `AWAITING_REVIEW`, `REVISION_REQUIRED`, or `BLOCKED`, with verified SHAs and remaining work.

Release-aware integration: when the incoming handoff has variables.release=true or a releasePlan, independently verify the original release run/plan, Review approval and preparation target. Preserve the unchanged releasePlan, release flag, exact reviewedSha/reviewRun, documentationReviewed and documentationPaths. A missing/conflicting release contract is BLOCKED; never silently discard it.

After the exact approved prepared SHA is successfully integrated into the verified development upstream (or already equals its tip), explicitly emit the conditional publish handoff so Publish can independently verify publication and continue the release. Include variables:{release:true}, the complete approval/plan, original development source branch and its verified actual upstream/configuration, reviewed/base/current target SHAs and original checkpoint. Do not emit release-ready yourself. A newer remote descendant requires fresh Review rather than releasing an unreviewed snapshot.

If reconciliation creates a different commit, retain release markers, shared release config/plan and original goal, then stop for automatic Review without a duplicate handoff or push. Never carry approval for the old SHA to the new one. Ordinary integrations without release intent retain their current behavior and do not emit publish merely for this release route.


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
