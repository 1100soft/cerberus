# Shared project feedback

Feedback is a GitHub issue queue, independent of email. In **Feedback → settings**
choose a default repository and GitHub identity, then optionally override the
repository for the selected project or disable its feedback integration. Each
project has a distinct project label. Empty labels generate stable project-ID
labels; changing a project's display name never changes its queue. Existing
reports are not automatically migrated when a repository/label changes.

One private repository can serve many projects. Mountlet continues using
`1100soft/mountlet-report` and its existing `mountlet-report` label; the URL,
issue numbers, reporting endpoint, deployed credentials and history are unchanged.
Cerberus uses `project:cerberus`; 1100 uses `project:1100`. Other/future projects
inherit the default with unique generated labels. The feedback repository need
not contain application source and need not be cloned locally.

The Feedback page lists scoped open/closed issues, reads bodies/comments, creates
issues, comments and closes/reopens issues. Lists are bounded to 50 per page and
can load older pages. Results are cached in bounded session memory, with stale
project results discarded. Navigating between pages preserves an unsent draft.
No report bodies are stored in a local feedback database. GitHub remains the
system of record; agent providers/conversations may retain accessed material.

## Intake from applications and websites

Each application submits through its own authenticated/rate-limited server
endpoint; never ship a GitHub token in a browser or desktop binary. Give that
server access only to the feedback repository. Always apply the configured
project label. Treat classification labels (`bug`, `enhancement`, `support`,
`crash`) as optional metadata; a fallback must never remove the project label.
GitHub issues cannot have per-label token permissions, so the intake server must
set its own project label rather than trusting the client's requested label.

Mountlet's source now supports `REPORT_GITHUB_PROJECT_LABEL` (defaults to its
existing `mountlet-report`). Its 422 retry drops optional labels only, retaining
that project label. These source changes need Mountlet's usual review/deployment;
its already-deployed reporter continues working with the preserved existing label.

## Project-bound agent and script tools

When a project has feedback configured, Cerberus supplies:

- `CERBERUS_ISSUE_TOOL`: executable; call with `--cerberus-issues` and JSON stdin.
- `CERBERUS_ISSUE_PROJECT`, `CERBERUS_ISSUE_REPOSITORY`, `CERBERUS_ISSUE_LABEL`:
  the bound project/scope. Do not override these to access another project.
- `CERBERUS_ISSUE_READ_ONLY`: native writes are rejected in analyze mode.

Examples (Bash; other script runtimes use their normal stdin/pipeline syntax):

```bash
printf '%s' '{"action":"list","state":"open","page":1}' |
  "$CERBERUS_ISSUE_TOOL" --cerberus-issues
printf '%s' '{"action":"read","number":12}' |
  "$CERBERUS_ISSUE_TOOL" --cerberus-issues
printf '%s' '{"action":"create","title":"Settings fail to save","body":"Redacted reproduction summary","labels":["bug"],"operationId":"report-unique-stable-id"}' |
  "$CERBERUS_ISSUE_TOOL" --cerberus-issues
```

Other actions: `status`; `comments {number,page}`; `comment {number,body,operationId}`;
`update {number,title?,body?,state:open|closed,labels?,operationId}`. Update labels
are additive and preserve the project label. Native code filters lists, rejects
PRs/ambiguous cross-project labels and checks issue scope before reading comments
or changing an issue. Project settings cannot assign the same repository/label
to two projects. Another configured project's scope label cannot be added.
Scheduled/manual Agent and Script automations can use these tools; there is no
new implicit development trigger or automatic code change per submitted report.

Writes require a stable operationId. Cross-process receipts record only a request
fingerprint and issue/comment reference, never report content. A confirmed retry
returns the saved reference; changed input with the same ID fails. An uncertain
write remains blocked for inspection rather than being resent. A definite
validation/auth rejection permits retry with the same ID after repair. Receipts
are local metadata, so this is not global exactly-once delivery across machines.
A resumed operation must not use a fresh ID simply to bypass an uncertain result.

GitHub identities need repository access and Issues read/write permission.
Credentials stay in native secure storage and never enter IPC responses or tool
environment variables. This is enforcement by the Cerberus issue tool, not a
whole-agent sandbox: an edit agent with independent broad GitHub credentials can
bypass it using other programs. Use least-privilege credentials where isolation
is a security boundary. Labels are routing metadata, not GitHub access-control
boundaries. Comments can notify GitHub participants.

## Email as an intake channel

The Email feedback prompt now uses the same project-scoped issue tool. It checks
bounded candidate issues, adds evidence to an exact match or creates a new issue,
and saves the original reference plus issue URL in an internal IMAP note. Only
an anonymized summary is copied; bodies, contact details, attachments, raw logs
and secrets stay out of GitHub. A message moves to Processed only after both
writes are confirmed. Missing configuration/uncertain outcomes remain recoverable
for human inspection. The email's privacy/security screening remains necessary;
passing screening never authorizes arbitrary issue actions.

The original email/IMAP note remains correspondence; the GitHub issue is the
cross-channel development record. Duplicate reports from web, app and email must
be matched on evidence, not only a subject/title. Do not create a code agent for
every email or issue. Future event-triggered issue intake should use a durable
cursor and explicit scope, without replaying all historical issues on setup.

The issue header's **Open on GitHub** icon opens that issue in the default browser
using the browser's existing GitHub session. Issue actions stay above the scrolling
body/comments. Historical Mountlet support-form submissions are also issues: the
website endpoint can write a support issue and send an email copy for the same
submission. Their presence does not mean Cerberus imported an inbox email.
