# Shared project feedback

Feedback is a GitHub issue queue, independent of email. In **Feedback → settings**
choose a default repository and GitHub identity, then optionally override the
repository for the selected project or disable its feedback integration. Each
project has a **Feedback name**, defaulting to its project name. Users and agents
refer to this friendly name; they do not need routing prefixes or identifiers.
Cerberus maps it to the actual GitHub label internally. Existing prefixed/legacy
labels retain their exact mapping, with the routing prefix hidden in the UI. New
queues use the plain name. Saving freezes the initial name so renaming a project
does not move its queue. Changing the feedback name migrates existing issues before the new mapping is
saved. If the target already has open or closed issues, Save asks whether to
choose a different name (default) or **Acquire issues**, merging the target queue
into this project. No migration or setting change starts before that decision.
Names assigned to another configured project cannot be acquired. GitHub label renames retain issue numbers, comments, states and other
labels; an already-existing destination is merged without replacing other labels.
Interrupted migrations are recorded locally: reopen settings and retry Save to
resume. Issue-tool operations wait while saving and refuse access during an
incomplete migration. Existing write receipts remain valid after renaming.
Repository changes are separate; rename first if changing both. Names must resolve to distinct labels in each shared
repository (case-insensitively).

A shared repository such as
[`1100soft/1100-shared-feedback`](https://github.com/1100soft/1100-shared-feedback)
can serve arbitrary projects. Its [integration instructions](https://github.com/1100soft/1100-shared-feedback#names-and-internal-routing)
explain the distinction between friendly names and internal routing. Agents use
the project-bound tool to resolve it; direct intake integrations read the exact
GitHub label from trusted configuration rather than guessing from a name.

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
body/comments. Support-form submissions may also create issues and send an email copy for the
same submission. Their presence does not necessarily mean an inbox email was
imported.

Feedback names preserve the capitalization entered by the user, including when
derived from a project name. Case-insensitive matching prevents duplicate queues;
it must never lowercase the stored or displayed name.
