# Automation handoffs

## Names and payloads

An automation can listen for one named handoff in each selected repository and can emit one or more named handoffs. Names use 1–64 ASCII letters, numbers, hyphens, or underscores; the first character must be a letter or number. The UI normalizes names to lowercase. Users enter names in the Automation dialog and never need to manage paths. Both incoming and outgoing name fields suggest the union of trigger and emission names currently used by saved automations; typing filters the suggestions, and new names remain valid. The Automation page warns when an emission has no matching trigger, or a trigger has no matching emission, within the same repository. A warning can be resolved by creating the other half of the pair. The Emit field sits below the action prompt or script. In an Agent prompt with one outgoing name, the user can call the payload simply "the handoff"—for example, "Write the details of the issues in the handoff." When several outgoing names are configured, refer to the intended name. The app adds the file instructions when it dispatches the action. When an Agent automation runs, the app places an instruction before the action prompt requiring the agent to read the exact incoming payload path before taking action, and supplies each outgoing payload path. The saved action prompt stays unchanged. Shell automations receive `CERBERUS_HANDOFF_INPUT` and `CERBERUS_HANDOFF_<NAME>` environment variables instead. Shell variable names are uppercase with hyphens converted to underscores; names that would collide after conversion cannot be saved. A shell script emits a handoff by writing its UTF-8 payload to the corresponding output path.

The backend stores handoffs under the repository's Git metadata directory in `cerberus-handoffs`, outside the working tree. Each run has a unique output file for each configured name. After the action, an existing output file is atomically moved to a pending queue; absent files emit nothing. Handoff automations check that queue every two seconds while the app is running. Claiming moves one file atomically to a claimed path so concurrent checks cannot take the same emission. The claimed payload remains available while the triggered action runs, then moves to an archive outside the pending queue. Failed actions retain their original prompt, repository, model/account selection, trigger context, and incoming emission in the run log. Use **Retry blocked action** in the conversation list (also its context menu), or the retry icon on the automation card. Retry explicitly reclaims the same archived emission and resumes the original conversation when possible; it does not select a different pending handoff or use a newly edited automation prompt. Review partial work before retrying an action that already made changes. A fresh manual Run once is a separate action and does not replay a previous handoff. Claims left by a crashed run are archived after 30 minutes and never automatically requeued. Archives remain in Git metadata for recovery. Repeated runs can emit the same name because each file has a unique run ID. Handoffs are scoped to the repository that emitted them; an automation with multiple repositories consumes each repository's queue independently. A cycle such as `review → correction → review` works when each step writes its outgoing payload conditionally.

Implementation: `src-tauri/src/handoffs.rs` validates names and owns queue transitions; Tauri commands in `src-tauri/src/lib.rs` expose paths and claims; `src/lib/savedPrompts.ts` augments agent prompts and schedules consumers. `scripts/check-handoffs.py` covers saved configuration, prompt augmentation, payload delivery, one-time consumption, and repeated emissions. Rust tests cover native path safety and concurrent claims.

## Handoff flags (boolean variables)

In the Handoff condition dialog, **Require flags to be true** accepts optional comma-separated flag names, such as `v, ready`. Names are case-sensitive ASCII identifiers (letters or underscore first, then letters, digits, or underscores). All listed variables must be JSON boolean `true` in the same incoming payload:

```json
{"variables":{"v":true,"ready":true},"details":"Context for the next automation"}
```

Agents receive this format in their outgoing handoff instructions. Shell scripts write the same JSON to their supplied handoff output path; a Notification automation can use JSON as its message payload. Missing variables, `false`, strings such as `"true"`, and invalid JSON do not match. Without variable requirements, ordinary text payloads still trigger as before. Nonmatching emissions remain pending and do not block a later matching emission. Matching is applied during both queue inspection and atomic claiming, including composite conditions. Queue consumption is still shared: one emission runs one consumer, rather than broadcasting to every matching automation.

Agent prompts can set flags using ordinary wording: “Set v in the handoff when the review passes,” “mark v as true,” or “raise the ready flag.” The injected instructions tell the agent to preserve names and case, evaluate the stated condition, and serialize actual JSON booleans in the `variables` object alongside context such as `details`. Flags and variables refer to the same values; existing payloads and saved conditions remain compatible.

In Shell mode, write the JSON yourself to the supplied outgoing path. For a handoff named `review`:

```bash
printf '%s\n' '{"variables":{"v":true},"details":"Review passed"}' > "$CERBERUS_HANDOFF_REVIEW"
```

The Emit handoffs info popover summarizes Agent wording and Shell output paths; this guide provides the full commands.

## Conditional emission

In **Emit handoffs**, enter `(review)` to mark review as conditional, or `summary, (review)` to combine normal and conditional names. Parentheses are saved and restored by the editor, but are stripped from actual handoff names, suggestions, pairing checks, and output paths. Do not list both `review` and `(review)`. Conditional emission is available for Agent and Shell actions.

Agent prompt example: “Emit the review handoff only if you find issues; otherwise do not emit it.” The app supplies instructions and the exact output path, requiring the agent to leave the file absent when it chooses not to emit. Plain names request normal emission.

Shell example, with `(review)` configured:

```bash
if [ "$needs_review" = true ]; then
  printf '%s\n' 'Issues found' > "$CERBERUS_HANDOFF_REVIEW"
fi
```

The app publishes only files actually written by the action; it never creates a payload for an omitted conditional emission. Empty files still emit, so leave the file absent to skip. A conditional payload can also include boolean flags using the JSON format above.
