# Repository creation and GitHub accounts

Use **Add repository → Create new repository**, enter a display name and local
folder, and choose **github** as the host. **Create remote repository on GitHub**
is enabled by default. Select the GitHub account and visibility (private by
default). Without a remote URL, the destination uses that account's username and
the display name, replacing unsupported characters with hyphens. Enter an
organization repository URL to create under an organization instead.

Cerberus initializes the local repository, creates an empty GitHub repository,
and configures `origin` and the selected identity. It does not commit or push
files. Turn off remote creation to link an existing remote instead. Creation
requires a connected account with repository-creation permissions and, for an
organization, permission under that organization's policies.

If remote creation fails after local initialization, the local repository and
files remain available, and the app displays a warning. Open its configuration
to retry. If the request's outcome was uncertain, check GitHub first; if the
remote exists, turn off remote creation and enter its URL to link it. Existing
remote repositories are never overwritten or automatically adopted.

GitHub accounts remain available in the assignment list even when a repository
is new or absent from the cached GitHub catalog. Assignment checks access with
GitHub directly; appearing in the list does not grant repository access.

In the commit history pane, the fast-forward icon shows the selected branch’s
configured upstream and ahead/behind counts. Unsafe states display a reason and
disable the action: divergence, local changes (including untracked files), or an
unfinished Git operation. Counts use the last fetched remote state. The action
fetches that branch’s configured remote and rechecks before advancing, uses the
linked worktree when checked out, and never merges, rebases, stashes, or forces.
Branches without an upstream must be configured first. Refresh history to recheck.

Automatic fast-forwarding is enabled by default. Turn off **Auto fast-forward**
at the bottom of the sidebar to opt out on this device. On repository updates,
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
scheduled time while the app is closed does not cancel cleanup. Each repository
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
pages and ignores responses for a repository or branch that is no longer selected.

## Agent/Script activity

The Repositories page's **Agent/Script** pane combines agent conversations and
script automation runs for the selected repository, newest first. Provider
checkboxes remain opt-in; the independent **Script** checkbox is on by default
and remembers its setting on this device. Select a script run to read or copy
its saved log. Running scripts stream output into the same view. Output follows
the bottom until you scroll up. Refresh reloads saved activity, including logs
whose automation has since been removed. Archived applies to agent conversations.

Run and message timestamps show **Now** during the first minute, local **HH:mm**
for the past 24 hours, a month/day for older entries, and the year when different
from the current year. Hover for the full local date and time. New script output
chunks retain their arrival times; old logs retain their known run time. Provider
messages use recorded timestamps when available; **—** means older history did
not supply a time.

A compact handoff trail shows the source run, handoff name and downstream runs,
for example **Review → revise → Revision**. Links in the Repositories pane open
the related script run or agent conversation (enable its filter first). The
Automation log dialog also shows the relationship overview. Relationships use
recorded handoff emission/run IDs within the same repository, never matching
names alone. Emitted handoffs without a recorded consumer are marked **Emitted**;
removed source logs are shown as unavailable. Conditional handoffs appear as
emitted only when publication actually succeeded.
