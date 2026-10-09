# Automation

The Automation page lists saved jobs as compact cards showing their name, scope, condition, and actions. Cards can be reordered by dragging the whole card; the order is saved locally. Clicking a card opens a detail dialog with the script or prompt and the run log in equal, independently scrolling panes. New jobs require a user-chosen name; older saved names remain intact. Long action and log content scroll inside their own equal-size panes. New automations default to all linked local repositories with **Include future repositories** enabled. Existing saved scopes are preserved when editing. **New automation** starts with an **Agent**, **Shell**, or **Notification** choice. Notification jobs show a saved message with the target repository name in the in-app notification center when their condition is met. Agent and Shell runs also post start, completion, and failure notifications. The dialog keeps the automation name in its header. A labeled Conditions row shows every selected condition as a removable chip. A chip includes its current interval, line threshold, idle time, or handoff name; clicking it opens a temporary settings dialog and blocks the main form until the dialog closes. The compact + control adds compatible conditions. The repository and labeled Branch controls divide the row equally when space permits and wrap on narrow windows. A short explanation of repository scope appears inside the expanded picker. Condition controls come before a collapsed repository picker for scheduled jobs. Conditions include manual, interval, **On file change**, **After changed lines**, **On commit**, **When CI passes**, **When CI fails**, **On push**, **On pull request**, **Handoff**, and **Idle time**. Commit, CI, push, and pull request events can be filtered with comma-separated branch patterns (`*` wildcards and an **All except** mode). The commit condition watches Git metadata with native filesystem events, compares HEAD to its baseline, and checks the branch and reflog action before running. The latter compares added plus deleted lines against `HEAD`, including staged, unstaged, and untracked files; binary files count as one. The changed-line threshold can be combined with **Idle time** to require a quiet period. Subsequent runs require another full threshold of changed lines, or a new threshold after a commit resets the count. File-change jobs use native recursive filesystem notifications for immediate changes, excluding `.git`. Add **Idle time** for a quiet period; its default is five minutes. This follows the legacy CLI watcher behavior. The scheduler also waits while Codex, Cursor, or an in-app conversation is known to be active. Each repository has its own pending change. Changes during a job run are discarded when the run finishes to avoid a self-triggered loop. The picker summarizes selected repository names on one truncated line and always shows the selected count. **Select all** takes a snapshot of current linked local repositories. **Include future repositories** turns that selection into a live scope; at run time, the job queries all linked local repositories. The summary says **All** when both options are on. Deselecting a repository clears the future-repository choice.

New automations can combine conditions. The scheduler records matching events separately for each watched repository and runs the action only after every selected condition has been observed there. The pending set resets after a run. Commit, CI pass, and CI fail exclude one another. **Idle time** is a separate condition measured from the most recent matching event or file change; combine **On file change** with **Idle time: 5 minutes** to wait for a quiet period. A branch filter applies to all scheduled conditions and defaults to `*`; branch patterns used elsewhere are suggested. Manual runs still choose one repository at run time. A watch scope never fans out an event to other repositories. A push plus CI completion must refer to the same commit SHA.

**On push** and **On pull request** use GitHub repository events from the assigned GitHub identity. The app polls while running, so delivery follows GitHub's event API latency and may be delayed. Jobs begin watching from their creation time. Codex Agent jobs can select a catalog model and a supported reasoning effort; leaving either on default lets the provider choose. Other agents currently use their provider default model because their automation adapters do not expose catalog-backed model controls.

The repository selection is a **watch scope** for event conditions. A commit, completed CI workflow, file change, changed-line threshold, or handoff in one watched repository runs the automation only for that repository; it does not fan out to the other watched repositories. Interval jobs instead run separately in every repository in their saved run scope, with an independent run per repository. Manual jobs do not select repositories at creation. **Run now** always asks for one repository and runs exactly once there, including for an automation that watches or runs in multiple repositories. For scheduled jobs, the manual choice is restricted to their saved scope and does not change that scope. Manual jobs can choose any linked local repository.

CI conditions monitor completed GitHub Actions workflow runs whose event is `push`. Their branch selector accepts comma-separated branch patterns, `*` wildcards, and **All except**, using the same matching rules as the commit condition. It defaults to `*` (all branches), preserving the behavior of CI automations saved before the selector was added. The field suggests complete branch sets currently used by other automations, narrows the list as the user types, and still accepts a new set. Success triggers **When CI passes**; failure, timeout, or startup failure triggers **When CI fails**. Each completed workflow run attempt is a separate event in its own repository, even when several workflows belong to the same push. The app polls GitHub every 60 seconds while running, using the repository’s assigned GitHub identity and its Actions read access. The assigned account needs `repo` scope for private repositories with a classic token, or Actions read permission with a fine-grained token ([GitHub workflow runs API](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository)). CI automations only accept local GitHub repositories with assigned GitHub identities. New automations begin observing completions after they are saved; enabling a disabled CI automation resets that starting point. Handled run IDs and attempts are stored locally so later polls do not repeat them. GitHub returns the latest 100 matching runs per poll, so an unusually high volume of completions between polls can exceed this window. Agent actions receive the workflow name, branch, commit SHA, and run URL ahead of the saved prompt; the saved prompt itself is unchanged. CI monitoring polls every eligible GitHub repository in the saved scope, including repositories without an observed local push, because pushes may originate elsewhere. An empty workflow list is normal and triggers nothing. A failed monitoring request is separate from a failed workflow: the app retains the transport/HTTP cause, checks up to four repositories concurrently, and retries failed checks with exponential backoff (one minute up to fifteen minutes). GitHub rate-limit retry/reset delays take precedence. An initial transient failure creates no in-app alert; after three failures the app posts one combined **CI checks delayed** notice for the ongoing outage. Authentication and Actions-access failures produce a grouped, actionable **CI access needs attention** notice. Neither monitoring notice runs an automation or disables it. Healthy repositories continue being checked, and recovery resumes normal polling without replaying handled workflow attempts. Live scopes skip repositories that are not local GitHub checkouts with an assigned GitHub identity.

The Save button is disabled until required fields and account assignments are complete. A concise reason appears beside it in the dialog footer. The form closes only after localStorage write verification. The Edit action opens the same form with the saved name, content, provider, trigger, interval, and repository scope. Saving replaces that entry under its existing ID and retains its position. Drafting from Edit starts with a request to revise the current script or prompt; later drafting messages are sent unchanged to the same agent session. Running entries cannot be edited until they finish. Older Git actions open as equivalent Shell scripts, and older exact-conversation targets open as new in-app agent conversations.

An **Agent** automation starts a new in-app conversation in each target repository, using its assigned account and tool access. Copilot uses the repository's GitHub identity directly; it has no separate Copilot login or assignment. When the GitHub catalog finds exactly one connected identity for an unassigned local repository, catalog sync persists that identity as the repository assignment. The repository page, Automation, and backend then use the same assignment. If multiple identities can access a repository, the user must choose one. For a newly linked repository in a live scope, the account is resolved at run time. If the account is missing, that repository records an error while other repositories continue. The bookmark icon on a user prompt bubble opens the dialog with the prompt, provider, and source repository prefilled.

A **Shell** automation accepts a Bash command or multiline script. Run opens a read-only live terminal showing stdout and stderr. Every shell and agent run writes a structured JSON log under the app data directory at `automation-logs/<automation-id>/<repository-id>/<run-id>.json`. Clicking the automation card opens its saved action and log side by side, with a run picker in the log pane. Shell logs include both output streams, while agent logs include the final response and available activity. Log files remain after automation edits. A failed attempt also writes a per-repository log when execution reached that repository. Its editable field has Bash syntax highlighting, and the inspection view highlights the saved script too. It runs from each repository folder with no stdin, bounded output, and a 15-minute limit per repository. The **Draft with AI** feature button opens drafting alongside the editable result. Drafting starts hidden, giving the result the full editor width. A visible note explains that generating and revising drafts consumes the selected agent’s usage quota. The execution agent selector is in the Agent prompt heading, parallel to the drafting agent selector. It has clipboard Paste for the result field and Copy for its output. Both text fields support Ctrl+Z undo and Ctrl+Y or Ctrl+Shift+Z redo, including generated text and submitted request replacements. Both modes have a **Draft with agent** exchange: choose a drafting provider and optionally a repository for context, describe the task, then press Generate draft or Ctrl+Enter. **Auto context** displays the repository it will use: for scheduled jobs it is the first selected repository with the drafting provider assigned; for manual jobs it is the first local repository with that provider assigned. On submission, the task description field shows the exact request sent. The app launches the agent with that repository as its working directory; the prompt does not repeat the repository name or path. Actual permission limits come from the agent runtime configuration, not from the text of the prompt. Copilot drafting exposes only file-viewing tools and denies write and shell permission requests; Codex drafting uses its read-only sandbox. The response fills the editable prompt or command field. In Agent mode, the execution provider is chosen separately; Shell mode has no execution agent. After the initial task is converted, follow-up text is sent raw into the same provider session to revise the result; each response replaces the editable output. Stop cancels the active Codex/Cursor profile run, Copilot SDK turn, or Cursor/Claude CLI process, while preserving the last successful output. Changing the drafting agent or context starts a new draft conversation. Drafting uses the selected agent's quota. Generation errors stay visible in the dialog. A live Copilot draft request was verified with the connected account; the WebKit fixture mocks the response.

Intervals and pending changes are checked every 30 seconds while GitCerberus is running, including while its Tauri window is hidden. They do not run after the app shuts down. Errors leave scheduled jobs enabled. Failure notifications offer Open log for the failed run and Disable automation for an explicit opt-out, both in the toast and notification history. Preparation failures also create error logs. Interval preparation failures advance the next scheduled time instead of retrying on every scheduler tick. Disabling a job during execution does not cancel its current run, and completion preserves the disabled state. A `running` agent job left after a crash stays paused for review. Orphan notification runs are finalized on startup without replay or disablement, with uncertain delivery or handoff emission recorded as an error. Each agent interval starts a new conversation in each selected repository. Older fixed Git jobs remain runnable. Agent automation conversations use the automation’s name. Older exact-conversation jobs remain visible with an unsupported-target error and their enabled setting preserved; Edit converts them to a new in-app conversation target.

Jobs are stored in `gitcerberus.savedPrompts.v1` in localStorage. Implementation: `src/lib/savedPrompts.ts` stores and runs jobs; `src/lib/automationAccounts.ts` resolves assigned identities; `src/components/SavedPromptsPanel.tsx` renders the page; `src/lib/agentChats.ts` records agent conversations; `src-tauri/src/shell_automation.rs` runs scripts; `src-tauri/src/automation_logs.rs` writes per-repository log files; `src-tauri/src/repository_watcher.rs` owns native recursive file watchers and emits events to the scheduler; `src-tauri/src/repository_changes.rs` counts changed lines for the card metric and threshold trigger. Verification: `npm run build`, `cargo check`, `/usr/bin/python3 scripts/check-ci-automation.py`, `/usr/bin/python3 scripts/check-saved-prompts.py` with Vite on port 3000, and `/usr/bin/python3 scripts/check-viewport.py`. The WebKit fixture covers failed-save recovery, folded repository selection, live-scope summary, manual runtime targeting, per-repository agent identities, prompt prefill, and zoomed layout.

## Handoffs

Handoffs pass context and boolean flags to another automation in the same repository. Normal outgoing names request emission; parentheses such as `(review)` allow an Agent or Shell action to choose whether to emit. See the [handoff guide](handoffs.md) for Agent wording, Shell commands, flags, and queue lifecycle.

New automations start with no condition selected. Manual is exclusive and hides repository and branch selection; its repository is chosen at run time and its saved branch scope is unrestricted. Branch-set suggestions include “All except” and restore the checkbox when applied. Condition parameter dialogs close with Done, Enter, or Escape (Enter first applies an open name suggestion). Drafting starts hidden; the Draft with AI feature button toggles the drafting pane and gives the full editor width to the prompt or shell script while closed. The automation list scrolls within its pane.

Agent prompt, Shell command, and Notification message keep separate text and undo histories when switching type. Codex model and reasoning selectors share the action heading with the execution agent; Refresh Codex models loads the assigned accounts’ model catalogs and reasoning metadata through the configured Codex runtime. No static model list is substituted.

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

Run once bypasses event timing and runs in the selected repository’s current checkout; it does not switch branches. Its input dialog offers matching branches and recent commits, matching pending or retained handoffs with required flags, completed CI runs, or GitHub events. For OR triggers, choose a condition set. The selected context is passed to the agent or shell. Automatic runs retain their branch filters. Run once preselects the first available in-scope local repository. The displayed
selection and execution target use the same value; changing the repository keeps
that choice while it remains available. With no eligible repositories, running
is disabled. Live logs scroll to the newest output until you scroll up; scrolling
back to the bottom resumes following. Selecting a different run starts at its
latest output.

## Alternative condition sets

**Add condition set (OR)** adds another colored row. Every condition in a row
must match (AND); any complete row can run the automation (OR). For example,
`On commit AND On push` OR `On pull request AND On file change`. Pending events
are tracked separately per set and repository. A successful match clears the
repository's pending events for all sets, preventing another row from replaying
the same match. Existing single-set automations retain their behavior.

Repository and branch scope apply to every row. Settings for repeated condition
types (interval duration, changed-line threshold, handoff name/flags, idle time)
are shared across rows, as indicated in the editor. Clicking a condition in an
alternative row moves that row into the primary editing position. Manual is
exclusive and cannot be combined with alternative sets. Empty sets must be
filled or removed before saving. Saved `conditionSets` stores the ordered arrays
of conditions; older `conditions` records remain supported.

The in-app handoff popover gives a brief summary and Agent/Shell examples. The separate [handoff guide](handoffs.md) provides detailed instructions and commands. Automation cards grow to display their full names and scope/condition summaries. They do not shrink as more cards are added; the containing automation list scrolls within its pane.

Codex model discovery uses the configured CLI’s model/list catalog, independently of its account/usage check. Usage or sign-in warnings do not erase the model catalog. Hidden models and explicit model rejections are excluded for the affected account/configuration. A catalog RPC failure is reported through the model-availability info button. Provider default remains available.

Right-click an automation card, or focus it and press Shift+F10, for Open log, Edit, Run once, Enable/Disable, and Remove. Opening its log clears the card’s unread error indicator while retaining the error details. Previous/Next buttons in Edit, or Alt+Left/Alt+Right, save before switching to the adjacent automation without closing the dialog; validation errors block navigation. Only explicit user actions disable automations, including after migration or clearing pending state. Handoff retention defaults to 24 hours and is configurable in the Automation header; see [handoffs.md](handoffs.md).

## Concurrent execution contexts

An automation card contains its definition and a Runs section. Each active context has its own status, repository, branch/commit or handoff, timestamp, and log button. Completed contexts appear only in the log dialog. Blocked contexts appear separately on the card with the exact repository, commit or handoff, time, and their own retry button. Run once stays available while other contexts execute. An identical active context cannot be started twice. Opening a specific run pins its log selection; another run starting does not steal focus. Interrupted runs are labeled separately from active executions.

Execution guards use automation + repository + branch + commit + handoff emission, rather than a single automation-wide lock. Scheduled contexts in separate repositories can progress concurrently, and completing one does not clear another’s running state or output. Explicit disabling affects future triggers; failures never disable the definition.

Agent actions with commit, branch, CI, or handoff inputs start in independent worktrees under the application data directory’s `automation-worktrees/<repository>/<run>` folder, on `private/automation-<run>` branches. Commit/CI actions start at the selected SHA. A branch-only context starts at that branch; a handoff without a selected revision starts at the repository’s HEAD. The original checkout stays intact. Clean app-owned checkouts are removed after successful completion when their commits are still reachable from another local or remote ref. Dirty worktrees, unique commits, agent-created branches, and blocked contexts remain for review and resume. A later continuation recreates a removed clean checkout at its final saved HEAD, including any commits the agent made after the trigger. Use safeguarded branch removal after review to clean retained work. File-change and ordinary interval/manual agent jobs retain the primary checkout so they can see current uncommitted files, and its one-writer guard remains in effect. Shell actions retain their existing working directory and receive the selected context through environment variables.

Commit history shows date and time in Git date order. The manual commit picker sorts recent choices by commit time, newest first, with visible timestamps. Reselecting the current branch/repository/condition set does not start a loader. History requests survive repository metadata refreshes, have a 30-second UI timeout, and offer refresh/retry; late cancelled/timed-out responses cannot overwrite the current branch’s commits. Native history runs off the UI thread.

## Retrying blocked actions

Failed runs retain the original automation definition, repository/account/model,
trigger context, conversation ID, and incoming handoff in the run log. The retry
icon on an automation card retries that specific failed run. In the conversation
list, select the blocked conversation and use **Retry blocked action**, or choose
it from the conversation's context menu. A pre-execution failure can also use
**Retry last message**. These actions replay the original request, preserving the
handoff, even when the automation's prompt has since been edited. Existing
conversations are reused when possible. An agent response beginning with
“Blocked” is treated as a blocked action and retains the same retry context.

Handoffs are archived outside the pending queue, so a blocked action does not
loop automatically. Explicit retry reclaims the exact original emission. Review
partial changes before retrying a run that already performed work. **Run once**
starts a separate manual execution and does not replay a prior handoff.

The **Handoff retention** button beside **New automation** opens handoff retention settings.
Archived handoffs default to 24 hours of retention after the latest run finishes.
Choose 1–8760 whole hours; pending payloads and active runs are preserved.
Expired handoffs cannot be retried and require a new upstream emission.

Agent automation conversations use the automation's name in the app conversation
list, including when handoff instructions are prepended to the prompt. Retries
preserve the existing conversation name, including user renames. Provider-owned
conversation titles outside Cerberus are managed separately by the provider.

## Conversation durability and sleep

Full app conversation records, including streamed activity and provider session IDs,
are checkpointed into `agent-conversations.db` in the application data directory.
The browser stores a compact fallback index instead of multi-megabyte transcripts.
This avoids the WebView localStorage quota. Completed automation logs also retain
the conversation identity, account, original prompt, session, and checkout revision.
On startup the app recovers missing conversations from those logs. Interrupted runs
keep their exact input and offer explicit retry; recovery never starts a provider turn.
Legacy records without a saved definition use their logged command and the available
account assignment when reconstructing display/retry metadata.

The app holds a system sleep inhibitor while its native agent/shell jobs run and
while it detects active local agents or automation contexts. It releases the lock
when work finishes. Linux uses logind; macOS uses `caffeinate -i -w <app-pid>`;
Windows requests system execution through a dedicated thread. Detected activity has a heartbeat lease,
so a stopped WebView cannot keep an otherwise idle app awake indefinitely.

Agent waits and runner deadlines exclude long scheduling gaps during system sleep.
If the process and provider connection survive, work continues after waking without
resending the prompt. Forced sleep, logout, app termination, and provider/network
failures can still disconnect a session. Its transcript, session ID, worktree, and
handoff remain available for explicit retry/resume. Sleep protection cannot promise
that a remote provider will keep a disconnected request alive.

## Automation settings and saved-run cleanup

The top-right gear opens Automation settings; handoff retention is one setting.
Active and blocked rows summarize repository, branch/commit or handoff, status,
and time, using one line when space allows. Dismiss hides a blocked row persistently
while retaining its log and conversation retry. Delete on a blocked row or in the
log dialog confirms permanent removal of that saved run and its log/retry action.
Conversation history and retained handoffs have independent lifetimes and stay.
Running contexts cannot be deleted.

Agents must leave their app-owned execution worktree in place and report cleanup
as pending app verification. Clean checkouts whose commits remain referenced are
removed after successful completion. Startup and periodic checks revisit retained
checkouts, protecting active native jobs and blocked runs for the handoff retention
period. Dirty worktrees and unique commits always remain for manual review; the app
never forces their deletion. Dismissing a row does not discard work or its lease.

The log dialog's **Delete all** removes every completed or blocked log for that
automation across its repositories, including dismissed entries, after confirmation.
Active contexts and their logs are kept. Cancelling changes nothing; deletion reports
its count and any errors, and leaves conversations/handoff payloads independent.
Opening the log acknowledges the automation's unread error even if another context
is still running. Errors arriving while the log stays open are acknowledged too;
new failures after closing it show a fresh indicator. Blocked runs remain available
for retry with neutral styling after acknowledgement.

## Manual inputs

Add **Manual inputs** in an automation's edit dialog. Give each input a unique
name and a Text, Number, Boolean, or Choice type. The same name appears in the
run dialog. A script identifier is generated automatically: `Version change`
becomes `version_change`, exported as `CERBERUS_INPUT_VERSION_CHANGE`. The editor
shows the exact variable. Names that generate the same identifier are rejected.
Existing inputs retain their previous script identifiers until renamed.
Choices are listed one per line; defaults prefill **Run once**. Text and Number
can be required or optional. Booleans use checkboxes, up to four choices use
radio buttons, and longer choice lists use the app's dropdown. Required inputs
must be valid before running. Inputs are collected on any manual run, including
manual runs of event-triggered automations; automatic triggers do not supply them.

For a release, define a Choice named `version` with `major`, `minor`, and `patch`
and default `patch`. Agent prompts receive a JSON object such as
`{"version":"minor"}` ahead of the saved instructions. In Shell mode use
`npm version "$CERBERUS_INPUT_VERSION"`. Text stays text, numbers are finite
numbers, and booleans are `true`/`false` (exported as strings in Bash). Optional
empty inputs export an empty string. Values are environment data and are never
substituted into shell source; quote expansions. They are saved with the run log
and preserved on blocked-action retries even after editing the automation.
These inputs are intended for ordinary parameters, not secrets. Notification
runs collect and record them but do not interpolate the notification message.

Codex model choices and execution use the same configured runtime and ChatGPT
account. Automatic discovery compares installed CLI versions (including Codex
bundled with local VS Code/Cursor extensions) and selects the newest. Explicit
Advanced-settings or environment overrides remain authoritative. The **Codex
catalog source** info button shows the exact executable and version. Changing
provider configuration refreshes the catalog, as does **Refresh Codex models**.

The picker follows the runtime's catalog, excludes hidden entries, and intersects
choices when several accounts are in scope. There is no hardcoded model list or
history-based model injection. Model lists can differ across CLI versions even
for the same account: 0.154.0 omitted GPT-6.1 Sol while 0.162.0-alpha.17.2 listed it
in a controlled comparison. The catalog is advisory: a listed model can still be
rejected during inference. Explicit server rejections are excluded for 24 hours.
A rejection that explicitly names ChatGPT account support survives runtime changes
for that account; other model rejections apply to the runtime binary that produced
them. Network and login errors never exclude models. No inference requests probe
model access.

The automation editor is anchored near the top of the viewport. Previous/next
buttons keep the same vertical position across actions while the body scrolls.
