# Automation

The Automation page lists saved jobs as compact cards showing their name, scope, condition, and actions. Cards can be reordered by dragging the whole card; the order is saved locally. Clicking a card opens a detail dialog with the script or prompt and the run log in equal, independently scrolling panes. New jobs require a user-chosen name; older saved names remain intact. Long action and log content scroll inside their own equal-size panes. **New automation** starts with an **Agent**, **Shell**, or **Notification** choice. Notification jobs show a saved message with the target repository name in the in-app notification center when their condition is met. Agent and Shell runs also post start, completion, and failure notifications. The dialog keeps the automation name in its header. A labeled Conditions row shows every selected condition as a removable chip. A chip includes its current interval, line threshold, idle time, or handoff name; clicking it opens a temporary settings dialog and blocks the main form until the dialog closes. The compact + control adds compatible conditions. The repository and labeled Branch controls divide the row equally when space permits and wrap on narrow windows. A short explanation of repository scope appears inside the expanded picker. Condition controls come before a collapsed repository picker for scheduled jobs. Conditions include manual, interval, **On file change**, **After changed lines**, **On commit**, **When CI passes**, **When CI fails**, **On push**, **On pull request**, **Handoff**, and **Idle time**. Commit, CI, push, and pull request events can be filtered with comma-separated branch patterns (`*` wildcards and an **All except** mode). The commit condition watches Git metadata with native filesystem events, compares HEAD to its baseline, and checks the branch and reflog action before running. The latter compares added plus deleted lines against `HEAD`, including staged, unstaged, and untracked files; binary files count as one. The changed-line threshold can be combined with **Idle time** to require a quiet period. Subsequent runs require another full threshold of changed lines, or a new threshold after a commit resets the count. File-change jobs use native recursive filesystem notifications for immediate changes, excluding `.git`. Add **Idle time** for a quiet period; its default is five minutes. This follows the legacy CLI watcher behavior. The scheduler also waits while Codex, Cursor, or an in-app conversation is known to be active. Each repository has its own pending change. Changes during a job run are discarded when the run finishes to avoid a self-triggered loop. The picker summarizes selected repository names on one truncated line and always shows the selected count. **Select all** takes a snapshot of current linked local repositories. **Include future repositories** turns that selection into a live scope; at run time, the job queries all linked local repositories. The summary says **All** when both options are on. Deselecting a repository clears the future-repository choice.

New automations can combine conditions. The scheduler records matching events separately for each watched repository and runs the action only after every selected condition has been observed there. The pending set resets after a run. Commit, CI pass, and CI fail exclude one another. **Idle time** is a separate condition measured from the most recent matching event or file change; combine **On file change** with **Idle time: 5 minutes** to wait for a quiet period. A branch filter applies to all scheduled conditions and defaults to `*`; branch patterns used elsewhere are suggested. Manual runs still choose one repository at run time. A watch scope never fans out an event to other repositories. A push plus CI completion must refer to the same commit SHA.

**On push** and **On pull request** use GitHub repository events from the assigned GitHub identity. The app polls while running, so delivery follows GitHub's event API latency and may be delayed. Jobs begin watching from their creation time. Codex Agent jobs can select a catalog model and a supported reasoning effort; leaving either on default lets the provider choose. Other agents currently use their provider default model because their automation adapters do not expose catalog-backed model controls.

The repository selection is a **watch scope** for event conditions. A commit, completed CI workflow, file change, changed-line threshold, or handoff in one watched repository runs the automation only for that repository; it does not fan out to the other watched repositories. Interval jobs instead run separately in every repository in their saved run scope, one after another. Manual jobs do not select repositories at creation. **Run now** always asks for one repository and runs exactly once there, including for an automation that watches or runs in multiple repositories. For scheduled jobs, the manual choice is restricted to their saved scope and does not change that scope. Manual jobs can choose any linked local repository.

CI conditions monitor completed GitHub Actions workflow runs whose event is `push`. Their branch selector accepts comma-separated branch patterns, `*` wildcards, and **All except**, using the same matching rules as the commit condition. It defaults to `*` (all branches), preserving the behavior of CI automations saved before the selector was added. The field suggests complete branch sets currently used by other automations, narrows the list as the user types, and still accepts a new set. Success triggers **When CI passes**; failure, timeout, or startup failure triggers **When CI fails**. Each completed workflow run attempt is a separate event in its own repository, even when several workflows belong to the same push. The app polls GitHub every 60 seconds while running, using the repository’s assigned GitHub identity and its Actions read access. The assigned account needs `repo` scope for private repositories with a classic token, or Actions read permission with a fine-grained token ([GitHub workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository)). CI automations only accept local GitHub repositories with assigned GitHub identities. New automations begin observing completions after they are saved; enabling a disabled CI automation resets that starting point. Handled run IDs and attempts are stored locally so later polls do not repeat them. GitHub returns the latest 100 matching runs per poll, so an unusually high volume of completions between polls can exceed this window. Agent actions receive the workflow name, branch, commit SHA, and run URL ahead of the saved prompt; the saved prompt itself is unchanged. CI monitoring polls every eligible GitHub repository in the saved scope, including repositories without an observed local push, because pushes may originate elsewhere. An empty workflow list is normal and triggers nothing. A failed monitoring request is separate from a failed workflow: the app retains the transport/HTTP cause, checks up to four repositories concurrently, and retries failed checks with exponential backoff (one minute up to fifteen minutes). GitHub rate-limit retry/reset delays take precedence. An initial transient failure creates no in-app alert; after three failures the app posts one combined **CI checks delayed** notice for the ongoing outage. Authentication and Actions-access failures produce a grouped, actionable **CI access needs attention** notice. Neither monitoring notice runs an automation or disables it. Healthy repositories continue being checked, and recovery resumes normal polling without replaying handled workflow attempts. Live scopes skip repositories that are not local GitHub checkouts with an assigned GitHub identity.

The Save button is disabled until required fields and account assignments are complete. A concise reason appears beside it in the dialog footer. The form closes only after localStorage write verification. The Edit action opens the same form with the saved name, content, provider, trigger, interval, and repository scope. Saving replaces that entry under its existing ID and retains its position. Drafting from Edit starts with a request to revise the current script or prompt; later drafting messages are sent unchanged to the same agent session. Running entries cannot be edited until they finish. Older Git actions open as equivalent Shell scripts, and older exact-conversation targets open as new in-app agent conversations.

An **Agent** automation starts a new in-app conversation in each target repository, using its assigned account and tool access. Copilot uses the repository's GitHub identity directly; it has no separate Copilot login or assignment. When the GitHub catalog finds exactly one connected identity for an unassigned local repository, catalog sync persists that identity as the repository assignment. The repository page, Automation, and backend then use the same assignment. If multiple identities can access a repository, the user must choose one. For a newly linked repository in a live scope, the account is resolved at run time. If the account is missing, that repository records an error while other repositories continue. The bookmark icon on a user prompt bubble opens the dialog with the prompt, provider, and source repository prefilled.

A **Shell** automation accepts a Bash command or multiline script. Run opens a read-only live terminal showing stdout and stderr. Every shell and agent run writes a structured JSON log under the app data directory at `automation-logs/<automation-id>/<repository-id>/<run-id>.json`. Clicking the automation card opens its saved action and log side by side, with a run picker in the log pane. Shell logs include both output streams, while agent logs include the final response and available activity. Log files remain after automation edits. A failed attempt also writes a per-repository log when execution reached that repository. Its editable field has Bash syntax highlighting, and the inspection view highlights the saved script too. It runs from each repository folder with no stdin, bounded output, and a 15-minute limit per repository. The **Draft with AI** feature button opens drafting alongside the editable result. Drafting starts hidden, giving the result the full editor width. A visible note explains that generating and revising drafts consumes the selected agent’s usage quota. The execution agent selector is in the Agent prompt heading, parallel to the drafting agent selector. It has clipboard Paste for the result field and Copy for its output. Both text fields support Ctrl+Z undo and Ctrl+Y or Ctrl+Shift+Z redo, including generated text and submitted request replacements. Both modes have a **Draft with agent** exchange: choose a drafting provider and optionally a repository for context, describe the task, then press Generate draft or Ctrl+Enter. **Auto context** displays the repository it will use: for scheduled jobs it is the first selected repository with the drafting provider assigned; for manual jobs it is the first local repository with that provider assigned. On submission, the task description field shows the exact request sent. The app launches the agent with that repository as its working directory; the prompt does not repeat the repository name or path. Actual permission limits come from the agent runtime configuration, not from the text of the prompt. Copilot drafting exposes only file-viewing tools and denies write and shell permission requests; Codex drafting uses its read-only sandbox. The response fills the editable prompt or command field. In Agent mode, the execution provider is chosen separately; Shell mode has no execution agent. After the initial task is converted, follow-up text is sent raw into the same provider session to revise the result; each response replaces the editable output. Stop cancels the active Codex/Cursor profile run, Copilot SDK turn, or Cursor/Claude CLI process, while preserving the last successful output. Changing the drafting agent or context starts a new draft conversation. Drafting uses the selected agent's quota. Generation errors stay visible in the dialog. A live Copilot draft request was verified with the connected account; the WebKit fixture mocks the response.

Intervals and pending changes are checked every 30 seconds while GitCerberus is running, including while its Tauri window is hidden. They do not run after the app shuts down. Errors leave scheduled jobs enabled. Failure notifications offer Open log for the failed run and Disable automation for an explicit opt-out, both in the toast and notification history. Preparation failures also create error logs. Interval preparation failures advance the next scheduled time instead of retrying on every scheduler tick. Disabling a job during execution does not cancel its current run, and completion preserves the disabled state. A `running` job left after a crash stays paused for review. Each agent interval starts a new conversation in each selected repository. Older fixed Git jobs remain runnable. Older exact-conversation jobs remain visible with schedules disabled; Edit converts them to a new in-app conversation target.

Jobs are stored in `gitcerberus.savedPrompts.v1` in localStorage. Implementation: `src/lib/savedPrompts.ts` stores and runs jobs; `src/lib/automationAccounts.ts` resolves assigned identities; `src/components/SavedPromptsPanel.tsx` renders the page; `src/lib/agentChats.ts` records agent conversations; `src-tauri/src/shell_automation.rs` runs scripts; `src-tauri/src/automation_logs.rs` writes per-repository log files; `src-tauri/src/repository_watcher.rs` owns native recursive file watchers and emits events to the scheduler; `src-tauri/src/repository_changes.rs` counts changed lines for the card metric and threshold trigger. Verification: `npm run build`, `cargo check`, `/usr/bin/python3 scripts/check-ci-automation.py`, `/usr/bin/python3 scripts/check-saved-prompts.py` with Vite on port 3000, and `/usr/bin/python3 scripts/check-viewport.py`. The WebKit fixture covers failed-save recovery, folded repository selection, live-scope summary, manual runtime targeting, per-repository agent identities, prompt prefill, and zoomed layout.

## Handoffs

An automation can listen for one named handoff in each selected repository and can emit one or more named handoffs. Names use 1–64 ASCII letters, numbers, hyphens, or underscores; the first character must be a letter or number. The UI normalizes names to lowercase. Users enter names in the Automation dialog and never need to manage paths. Both incoming and outgoing name fields suggest the union of trigger and emission names currently used by saved automations; typing filters the suggestions, and new names remain valid. The Automation page warns when an emission has no matching trigger, or a trigger has no matching emission, within the same repository. A warning can be resolved by creating the other half of the pair. The Emit field sits below the action prompt or script. In an Agent prompt with one outgoing name, the user can call the payload simply "the handoff"—for example, "Write the details of the issues in the handoff." When several outgoing names are configured, refer to the intended name. The app adds the file instructions when it dispatches the action. When an Agent automation runs, the app places an instruction before the action prompt requiring the agent to read the exact incoming payload path before taking action, and supplies each outgoing payload path. The saved action prompt stays unchanged. Shell automations receive `CERBERUS_HANDOFF_INPUT` and `CERBERUS_HANDOFF_<NAME>` environment variables instead. Shell variable names are uppercase with hyphens converted to underscores; names that would collide after conversion cannot be saved. A shell script emits a handoff by writing its UTF-8 payload to the corresponding output path.

The backend stores handoffs under the repository's Git metadata directory in `cerberus-handoffs`, outside the working tree. Each run has a unique output file for each configured name. After the action, an existing output file is atomically moved to a pending queue; absent files emit nothing. Handoff automations check that queue every two seconds while the app is running. Claiming moves one file atomically to a claimed path so concurrent checks cannot take the same emission. The claimed payload remains available while the triggered action runs, then is removed. If execution could not start, the claim is released back to the queue for a later explicit retry after the job is fixed. Claims left by a crashed run are discarded after 30 minutes, longer than the agent and shell run limit. They are never requeued after execution began, so an interruption cannot replay the same emission. Repeated runs can emit the same name because each file has a unique run ID. Handoffs are scoped to the repository that emitted them; an automation with multiple repositories consumes each repository's queue independently. A cycle such as `review → correction → review` works when each step writes its outgoing payload conditionally.

Implementation: `src-tauri/src/handoffs.rs` validates names and owns queue transitions; Tauri commands in `src-tauri/src/lib.rs` expose paths and claims; `src/lib/savedPrompts.ts` augments agent prompts and schedules consumers. `scripts/check-handoffs.py` covers saved configuration, prompt augmentation, payload delivery, one-time consumption, and repeated emissions. Rust tests cover native path safety and concurrent claims.

New automations start with no condition selected. Manual is exclusive and hides repository and branch selection; its repository is chosen at run time and its saved branch scope is unrestricted. Branch-set suggestions include “All except” and restore the checkbox when applied. Condition parameter dialogs close with Done, Enter, or Escape (Enter first applies an open name suggestion). Drafting starts hidden; the Draft with AI feature button toggles the drafting pane and gives the full editor width to the prompt or shell script while closed. The automation list scrolls within its pane.

Agent prompt, Shell command, and Notification message keep separate text and undo histories when switching type. Codex model and reasoning selectors share the action heading with the execution agent; Refresh Codex models reloads the assigned account’s catalog from the configured Codex runtime. Catalog availability depends on the runtime version and account, rather than a hardcoded list.

Emit handoffs is available for all three automation types. Its info button opens help; notifications publish their message as the handoff payload under each configured outgoing name, using the normal per-repository queue and cleanup lifecycle.

Shell context help lists the exported Bash variables. Commands run in the targeted repository and may use `"$CERBERUS_REPOSITORY_PATH"`, `"$CERBERUS_REPOSITORY_ID"`, `"$CERBERUS_REPOSITORY_NAME"`, `"$CERBERUS_BRANCH"`, and `"$CERBERUS_COMMIT_SHA"`. Branch and SHA come from the triggering event when supplied, otherwise from the current checkout; the app does not switch branches. Run metadata is in `CERBERUS_AUTOMATION_ID`, `CERBERUS_AUTOMATION_NAME`, `CERBERUS_RUN_ID`, and comma-separated `CERBERUS_CONDITIONS` (`manual` for Run now). CI context is in `CERBERUS_CI_RUN_URL` and `CERBERUS_CI_CONCLUSION`, empty for non-CI runs. Existing `CERBERUS_HANDOFF_INPUT` and outgoing `CERBERUS_HANDOFF_<NAME>` variables provide payload paths. Quote variable expansions; values are exported as environment data, never interpolated into command text. Inherited `CERBERUS_` variables are cleared before the current run’s context is set.

To diagnose live CI access without invoking an agent or running an automation, set `CERBERUS_TEST_DATABASE` to the app database path and run `cargo test --lib github::tests::live_ci_catalog -- --ignored --nocapture` from `src-tauri/`. This opt-in diagnostic reads workflow catalogs using the assigned keyring credentials; credentials remain native and are not printed.


Commit conditions observe local branch tips repository-wide, including branches
checked out in other Git worktrees and detached worktree HEADs. Shared Git metadata
is watched, with a 30-second snapshot fallback while the app runs. Existing tips
are baselined on startup; creating a branch or checking out an existing commit
alone does not trigger. New commit/merge/cherry-pick reflog entries trigger on the
changed branch, subject to its branch patterns. Repeated watcher events are
deduplicated; pending commit-only events from different branches are queued. Snapshots observe
latest tips, so several rapid commits on the same branch can coalesce. Detached
commits have an empty branch name and match `*` (all branches). The branch browser
lists all local branches shared across worktrees and refreshes directly on Git
changes, window focus/visibility, and every 15 seconds while visible;
it does not include remote-tracking refs as local branches. Automations receive
the observed branch/SHA as context but execute in the repository's linked checkout
without switching it. File-change and changed-line conditions still apply to that
linked checkout.

The automation details dialog has **Copy log**, which copies its displayed live
output, selected saved run (stdout, stderr, response, and activity), and errors.
It falls back to the last result when no output exists. Copy success or failure
is reported in the dialog.


Agent automations in edit mode now use the provider's full-access execution mode:
this permits Git metadata writes (branches, commits, and worktrees) and network
access for CI diagnostics and dependencies. For Codex this is `danger-full-access`
with no interactive approval, not a workspace-scoped write grant. Existing edit
jobs use this on their next run. Analyze-only jobs and AI drafting remain
read-only; interactive agent conversations retain their selected permission mode.
Prompt instructions still determine whether an agent should push or integrate
changes; access does not add such an instruction. A completed/stopped session
must start another run to receive the new policy.

All copy controls use an icon with a green corner check badge, following
Mountlet's clipboard-state behavior. The icon remains visible; the badge clears
when the value or clipboard changes, rather than after a fixed timer. Clipboard
reads are checked on focus and every 400 ms while focused; platforms that deny
reads retain known in-app copy state. Copy failures are announced and available
in the button tooltip.


Every executing repository run creates its log before the action starts, including
notifications. The real running entry is selected by default when opening details
or starting another run. Live shell streams, profile-agent messages/activity,
Copilot session events, and available external CLI output update that same entry;
checkpoints are serialized and saved at most every 500 ms, with a final flush on
completion/error. Selecting history shows only that run. Atomic log replacement
keeps reads valid during updates. An empty history omits the selector rather than
adding a placeholder option. No placeholder options are permitted in any app
menu; None, Automatic, and Provider default are real behaviors, not placeholders.

Permission names are normalized across adapters: Copilot edit/full both approve
its requested tool permissions, while analyze restricts tools to reading. Cursor
full uses its force execution mode; Claude full uses bypassPermissions. These are
provider-specific policies, not Codex's sandbox names. Codex full continues using
danger-full-access. Logs stream only the progress a provider actually emits.

Run once bypasses trigger conditions and branch filters and runs in the selected repository’s current checkout; it does not switch branches. Automatic runs retain their branch filters. Run once preselects the first available in-scope local repository. The displayed
selection and execution target use the same value; changing the repository keeps
that choice while it remains available. With no eligible repositories, running
is disabled. Live logs scroll to the newest output until you scroll up; scrolling
back to the bottom resumes following. Selecting a different run starts at its
latest output.

### Handoff flags (boolean variables)

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

Both examples are included in the Emit handoffs info popover.

### Conditional emission

In **Emit handoffs**, enter `(review)` to mark review as conditional, or `summary, (review)` to combine normal and conditional names. Parentheses are saved and restored by the editor, but are stripped from actual handoff names, suggestions, pairing checks, and output paths. Do not list both `review` and `(review)`. Conditional emission is available for Agent and Shell actions.

Agent prompt example: “Emit the review handoff only if you find issues; otherwise do not emit it.” The app supplies instructions and the exact output path, requiring the agent to leave the file absent when it chooses not to emit. Plain names request normal emission.

Shell example, with `(review)` configured:

```bash
if [ "$needs_review" = true ]; then
  printf '%s\n' 'Issues found' > "$CERBERUS_HANDOFF_REVIEW"
fi
```

The app publishes only files actually written by the action; it never creates a payload for an omitted conditional emission. Empty files still emit, so leave the file absent to skip. A conditional payload can also include boolean flags using the JSON format above.
