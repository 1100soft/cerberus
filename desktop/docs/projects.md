# Project creation and GitHub accounts

Use **Add project → Create new project**, enter a display name and local
folder, and choose **github** as the host. **Create remote repository on GitHub**
is enabled by default. Select the GitHub identity first, then enter the repository
name separately from the project's display name. Cerberus generates the remote
URL from that account's username and repository name. Optionally enter an
organization name to use it as the owner instead. Choose visibility (private by
default) when creating the remote. Turning off remote creation uses the generated
URL to link an existing repository.

Cerberus initializes the local project, creates an empty GitHub repository,
and configures `origin` and the selected identity. It does not commit or push
files. Turn off remote creation to link an existing remote instead. Creation
requires a connected account with project-creation permissions and, for an
organization, permission under that organization's policies.

If remote creation fails after local initialization, the local project and
files remain available, and the app displays a warning. Open its configuration
to retry. If the request's outcome was uncertain, check GitHub first; if the
remote exists, turn off remote creation and enter its URL to link it. Existing
remote repositories are never overwritten or automatically adopted.

GitHub accounts remain available in the assignment list even when a project
is new or absent from the cached GitHub catalog. Assignment checks access with
GitHub directly; appearing in the list does not grant project access.

In the commit history pane, the fast-forward icon shows the selected branch’s
configured upstream and ahead/behind counts. Unsafe states display a reason and
disable the action: divergence, local changes (including untracked files), or an
unfinished Git operation. Counts use the last fetched remote state. The action
fetches that branch’s configured remote and rechecks before advancing, uses the
linked worktree when checked out, and never merges, rebases, stashes, or forces.
Branches without an upstream must be configured first. Refresh history to recheck.

Automatic fast-forwarding is enabled by default. Turn off **Auto fast-forward**
at the bottom of the sidebar to opt out on this device. On project updates,
app focus, and every 15 seconds, Cerberus checks all local branches against their
already-fetched upstream references, including linked worktrees. It advances
only clean, strictly-behind branches with no unfinished Git operation, while no
app jobs or detected local agents are active. App job startup is coordinated with
these updates. Unsafe branches remain unchanged; select one to inspect its reason.
Automatic updates do not fetch over the network, merge divergent history, or
trigger commit automations. Fetch normally to discover remote changes.

Branch tabs are grouped into Permanent, Temporary in use, and Temporary retained
for reruns, with distinct borders and labels. Temporary namespaces are `private/`,
`correction/`, `integration/`, `revision/`, `temp/`, and `tmp/`; other names remain
permanent. A running app-managed checkout is in use, while an idle managed
checkout or an unchecked temporary branch is retained. Temporary branches held
by other worktrees are in use; grouping does not promise automatic cleanup or
that a saved agent conversation can resume. Full names expand when selected,
hovered, or keyboard-focused. Navigation crosses group boundaries.

Retained app-managed branches show trash and clock icons with a compact local
HH:mm cleanup time in the top-right corner. The full date and safety details
appear on hover. The time uses the automation retention setting (24 hours by default). This is the earliest
periodic cleanup attempt, not a guarantee: active/retry-protected runs, dirty
worktrees, and unique commits remain safe.
Unmanaged branches show only the icons, with “No deletion scheduled” in their
help text; Cerberus does not claim to
delete worktrees it does not own. Hover names overlay neighboring tabs without
changing tab positions; selecting a branch may expand its tab normally.

Overdue cleanup runs immediately when the app starts, independently of conversation
recovery, and retries after recovery and during periodic maintenance. Missing the
scheduled time while the app is closed does not cancel cleanup. Each project
is swept independently. Clean temporary branches created or selected by agents
inside managed worktrees are eligible too, provided another ref preserves their
commits. Arbitrary branch names (such as `test-rebase`), dirty worktrees, active
runs, and unique commits are preserved for inspection.

Commit history displays all locally known tags pointing directly at each commit,
including annotated and lightweight tags. Branch cards show the nearest reachable
tag (`git describe --tags --abbrev=0`), rather than the highest version number or
a tag on an unrelated branch. No badge is shown when no tag is reachable. Fetch
tags first if a remote tag is not yet available locally.

History refreshes on local commit/tag ref changes, when the app regains focus,
and through a 15-second polling fallback while visible. Refresh history reloads
commit labels and branch metadata. Background refresh includes loaded history
pages and ignores responses for a project or branch that is no longer selected.

## Agent/Script activity

The Projects page's **Agent/Script** pane combines agent conversations and
script automation runs for the selected project, newest first. Provider
checkboxes remain opt-in; the independent **Script** checkbox is on by default
and remembers its setting on this device. Select a script run to read or copy
its saved log. Running scripts stream output into the same view. Output follows
the bottom until you scroll up. Refresh reloads saved activity, including logs
whose automation has since been removed. Archived applies to agent conversations.

Automation rows use their recorded run time, even if provider metadata is later
updated; the clock refreshes immediately on focus and visibility changes after
sleep. Run and message timestamps show **Now** during the first minute, local **HH:mm**
for the past 24 hours, a month/day for older entries, and the year when different
from the current year. Hover for the full local date and time. New script output
chunks retain their arrival times; old logs retain their known run time. Provider
messages use recorded timestamps when available; **—** means older history did
not supply a time.

A compact handoff trail shows the source run, handoff name and downstream runs,
for example **Review → revise → Revision**. Links in the Projects pane open
the related script run or agent conversation (enable its filter first). The
Automation log dialog also shows the relationship overview. Relationships use
recorded handoff emission/run IDs within the same project, never matching
names alone. Emitted handoffs without a recorded consumer are marked **Emitted**;
removed source logs are shown as unavailable. Conditional handoffs appear as
emitted only when publication actually succeeded.

## Automatic commit relationships

Cerberus automatically records commits created by app-started agent conversations
and script automations. Agents and scripts do not need to announce commits or
write a handoff. The activity trail can show **Implementation → commit SHA →
Review**, with navigation to the original conversation or script log and the
commit-triggered run. Full SHAs and project identity establish the relationship;
branch names and timing do not. A commit being an action's input revision does
not make that action its author. OR trigger sets link commits only when the
matched set actually included a commit condition.

Tracking applies to the process launched for the run and its children. Git's
[hook protocol](https://git-scm.com/docs/githooks), including reference-transaction, post-commit and rewrite hooks capture ordinary commits, amendments,
cherry-picks and rewritten commits, while existing hooks retain their arguments,
stdin and exit status. A process-local Git proxy also captures `git commit-tree`
without changing its stdin, stdout or exit status. Project Git configuration
and hooks on disk are left unchanged. Temporary clones are associated only when
they share a configured remote URL with the triggering project. Unrelated
projects, other writers, fetched history and fast-forwards are not attributed
to a run. Explicitly overriding the tracking hooks/environment, or calling an
absolute Git binary for hookless plumbing, or using a Git library that bypasses
the Git executable/hooks, can bypass tracking; Cerberus does not
guess when evidence is unavailable.

Commit records persist independently of temporary worktrees. New commit-triggered
logs retain their trigger identity, so relationships remain available after
completion and app restart while the source conversation/log remains available. Deleting a saved run also
removes its associated commit records.
Retries retain the worktree they need but record newly produced commits against
the new run. Existing runs from before tracking was introduced cannot be
reliably attributed retroactively.

## Email mailboxes

Each linked project can have its own IMAP/SMTP mailbox. Open **Email** and
choose the project, or use **Email settings** in project
settings. Connection details load the server folder tree; select destinations or
create folders there. Save automatically enables and tests the mailbox. Read and
organize emails, save server-side reply drafts and internal
notes, and optionally enable sending. **On email** automations watch a
folder and receive tools plus the original message reference. No hosted email
service or local mail archive is required. See [Feedback](email.md) for setup,
server-side receipts, privacy limits and agent/script examples.
