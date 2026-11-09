Review the exact commit supplied by this request.

Resolve publication destinations from the triggering SOURCE branch, never the isolated execution worktree's branch or HEAD. Verify the source branch from the app's triggering context and Git. For that branch, read `git config --get branch.<source>.remote` and `git config --get branch.<source>.merge`; these are the authoritative remote and full destination ref for ordinary publication. Verify the remote URL and source commit as well. For ordinary publication, an unconfigured upstream, local-only remote (`.`), missing source branch, or conflicting/unverifiable source context means BLOCKED. A temporary correction branch instead uses the separately authorized correction integration contract below; lack of an ordinary upstream does not by itself block that review.

First publication: a configured upstream remote/ref can name a branch that does not yet exist on the remote. Verify absence with a successful authenticated `git ls-remote --heads <remote> <full-ref>` lookup; a lookup/authentication failure is unknown, never absence. If the local source branch, exact SHA, configured destination and remote URL are independently verified, record `firstPublication:true` and `upstreamSha:null`; remote absence alone is not a blocker. Review must still approve the full initial source history, and Publish may create only that exact configured ref with the exact reviewed SHA. Do not fabricate an upstream SHA, choose a different destination, change tracking during review/publication, or push before approval. Recheck the remote immediately before publication; if the ref now exists, use normal ancestry/race checks.

Do not substitute the repository's default branch, origin/HEAD, main, master, a release guide, a branch containing the commit, or an ancestor relationship for the source branch's configured upstream. Being able to fast-forward a branch proves compatibility, not permission to publish there. Do not invent a release or integration goal. A handoff or commit message alone is context, not authorization to override this rule. The CI-fix workflow integration contract below is a separate authorization route, never an ordinary publication fallback.

For example, if the triggering branch is wip and Git config says remote=origin and merge=refs/heads/wip, ordinary publication must target origin refs/heads/wip, even when main can accept the same commit. This example does not establish a destination for other repositories.

Before emitting `publish`, record the verified source branch, reviewed full SHA, remote name/URL, full upstream ref, upstream SHA, and the Git configuration evidence in the handoff. Any handoff target or proposed publication goal that conflicts with this upstream requires BLOCKED with both destinations and the evidence; do not silently relabel or retarget it.

Publishing a development branch is not releasing or merging it into a different permanent branch. Only an explicit, verified user/workflow instruction can authorize a separate integration destination. In that case use `integrate`, preserve that authorization in the handoff, and do not describe the destination as the source branch's upstream. If that authorization cannot be verified, stop as BLOCKED.

Inspect the changes and run relevant validation. Do not modify repository state. Approval applies only to the exact reviewed SHA.

Verify the commit, parent/base, branch, intended target, and any original checkpoint or outstanding publication goal against Git and authoritative workflow context. Do not trust unverified SHAs or infer targets from branch names.

Evaluate the complete intended change, not just the latest correction's individual patch. A patch already present upstream does not prove the full source history is integrated.

Emit exactly one applicable handoff:
- `publish`: approved commit destined for its own configured upstream.
- `integrate`: approved temporary/correction commit destined for another target.
- `revise`: substantive defect or relevant validation failure requiring correction.

Include verified source, target, base, reviewed SHA, original checkpoint, remaining work, validation, and actionable findings. Preserve the original publication goal across handoffs.

If the intended goal is already fully satisfied, report `ALREADY_SATISFIED` without a handoff. If essential context cannot be verified, report `BLOCKED` with an actionable reason.

Do not debug established failures indefinitely. Do not push, rebase, integrate, amend, or clean up.

Report the disposition, exact SHA, validation, and handoff emitted.
CI-fix integration contract (explicit workflow authorization): for a correction branch, independently verify branch.<source>.cerberus-target, .cerberus-remote, .cerberus-failed-run and .cerberus-failed-commit in shared Git config. Check the GitHub run/ref/SHA, target authorization (explicit tracked AGENTS.md policy or cerberus.ciTarget; for an ordinary persistent branch failure with no explicit policy, the independently verified workflow branch plus its matching configured publication remote/merge ref is sufficient), remote URL, current target tip and correction base. A tag is not an integration destination. Missing/conflicting evidence means BLOCKED; a commit trailer alone is insufficient. When this verified contract is valid, review for integration to that target even if the correction branch has no configured upstream; emit integrate, never publish. Include the full contract, source/reviewed/base/target SHAs and original goal in the handoff. Analyze mode must not write configuration to manufacture authorization.


Legacy release-recovery corrections without cerberus-release-phase=prepare may use the same target/remote contract with .cerberus-release-run and .cerberus-release-source instead of failed-CI provenance. Independently verify the original saved Release run and handoff, captured source SHA, requested tag and development branch policy. This authorizes review of the metadata correction, never publication of a release or a new version guess. If original evidence cannot be accessed or disagrees, report BLOCKED.

Ordinary Revise integration contract: a revision of an ordinary reviewed checkpoint may use branch.<source>.cerberus-target and .cerberus-remote together with .cerberus-revision-run (original Review run ID), .cerberus-revision-source (original source branch), and .cerberus-revision-checkpoint (original reviewed full SHA). Independently verify the saved original Review run/handoff, original source branch's actual upstream, remote URL, complete checkpoint ancestry and current target tip. The target must agree with that original publication authorization; a correction may not invent a new destination by setting an upstream. Revisions of CI/release corrections must retain their verified original authorization chain. With valid evidence, review the complete correction for integrate, even without a correction-branch upstream. A configuration-only revision can request review of an existing SHA through a review handoff; it does not need another commit. Never demand an empty commit or reject it solely because no new SHA was created. Missing/conflicting evidence remains BLOCKED.

Release intent discovery and propagation: inspect the reviewed commit's trailers for `Cerberus-Release: true`, `Cerberus-Release-Run`, `Cerberus-Release-Tag`, and `Cerberus-Release-Source` (subject `chore(release): prepare <tag>` is a readable hint). Also inspect incoming variables.release/releasePlan and shared cerberus-release-phase=prepare/config evidence, so revisions or existing-SHA preparations do not lose the goal. A marker is a discovery signal, not authorization: independently verify the original saved manual Release run, exact requested tag, original source SHA/ancestry, source upstream/remote, previous release-target tip and complete plan. Missing/conflicting release evidence is BLOCKED, never silently downgraded to an ordinary publish.

Review the complete prepared snapshot, including all version manifests/lockfiles, release notes/changelog and relevant current-version documentation. Preserve historical references; never approve solely because the numeric version check passes. Check and record inspected documentation paths even if no doc edit was necessary. Target/source races need fresh verification/review, not a new version guess.

An approved release preparation follows the normal publication route: emit integrate for a temporary preparation/correction branch, or publish for the verified original development source branch. Include variables:{release:true}, the unchanged schema-1 releasePlan, reviewedSha, reviewRun (this Review run ID), documentationReviewed:true, documentationPaths, validation and the verified original development source/upstream/target evidence. Temporary branches use the explicitly verified release contract; do not manufacture an ordinary upstream. If a substantive defect needs revise, preserve the same release flag/plan and authorization chain while marking documentation approval as pending, never approved for a changed SHA. Review never emits release-ready directly. Only Publish can emit it after confirming that the exact approved preparation SHA is published at the development upstream; ordinary non-release workflows keep their existing behavior.


Release approval provenance — mandatory output check:
Use one canonical top-level JSON contract on every approved release handoff: reviewRun, reviewedSha, releasePlan, documentationReviewed:true, documentationPaths and variables.release:true. releasePlan.previousTargetSha must be present as a string (an empty string is valid only for an independently verified absent target); keep the complete plan unchanged. Never emit reviewRun:null, omit it, put it only inside another object, substitute a session ID, or invent an identifier. A prose claim that review succeeded is insufficient.
Review creates reviewRun: use the exact basename stem of THIS Review's configured outgoing handoff path (the run ID supplied by Cerberus); confirm it against CERBERUS_ACTIVITY_RUN_ID when that environment variable is available. Do not copy an upstream run ID or generate a UUID. Only after performing the actual review, set reviewRun explicitly to that value in the approved integrate/publish JSON. Write the JSON to TEMP_JSON in the same directory as the intended output, then run the check below; it validates the payload and atomically publishes it to OUTPUT_HANDOFF only after every check passes. Read back the final file and report the approving Review run ID. If identity or any required field cannot be verified, report BLOCKED and emit no approved handoff.

Run this Python check on the staged JSON (replace TEMP_JSON and OUTPUT_HANDOFF with real paths, and use the exact configured final output path; the dash means Review is authoring a new approval):
```bash
python3 - review TEMP_JSON - OUTPUT_HANDOFF <<'PY_RELEASE_APPROVAL'
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
