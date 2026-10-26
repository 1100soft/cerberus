# Mailbox-backed feedback

Each linked repository can use its own feedback mailbox. Open **Feedback**, choose
its repository, and use the configuration icon. Repository configuration also has
**Configure feedback mailbox**. Configure IMAP and SMTP hosts, ports, TLS or
STARTTLS, username, sending address and password/app password. Sending is off by
default. Folder discovery starts as connection details become available. Select
existing folders in the tree for Email root, Drafts, Sent, Internal notes and
Automation receipts. Use a folder's **+** button to create a child, entering only
its name; the server's hierarchy separator is applied automatically. Namespace
containers appear in the tree but cannot receive mail. **Save** automatically
enables the mailbox and tests access. Failures stay visible without disabling it.
There is no separate mailbox enable toggle or test button; automation rules
control processing. SMTP is checked when a reply is sent.

The envelope badge in repository cards and configuration shows a checkmark after
successful IMAP verification, or a warning for incomplete or failed setup.
Hover for details. The adjacent number counts **all emails remaining in the configured
feedback folder**, including already-read mail; move handled messages out of that
folder to reduce the count. This is independent of automation receipts. Status and
counts refresh on opening repository/configuration views, every two minutes while
shown, after settings change, and after moving mail. They are held in memory and
rechecked after restart, rather than treating saved credentials as proof of access.

Choose an **Email provider** to fill connection settings automatically. The default
is **Other IMAP server**, with empty host fields; no provider is assumed.

| Provider | Connection and account requirements |
| --- | --- |
| [Gmail](https://support.google.com/mail/answer/7126229) | Standard Google servers; use a Google app password where permitted by the account's security policy. |
| [iCloud Mail](https://support.apple.com/102525) | Standard Apple servers and an app-specific password. |
| [Yahoo Mail](https://help.yahoo.com/kb/SLN4075.html) | Standard Yahoo servers and an app password. |
| [Fastmail](https://www.fastmail.help/hc/en-us/articles/1500000278342-Server-names-and-ports) | Standard Fastmail servers and an app password; the plan must include IMAP. |
| [Zoho Mail](https://www.zoho.com/mail/help/imap-access.html) | Separate personal and organization presets. Check the account's server configuration for regional/plan-specific hosts and enable IMAP. |
| [Purelymail](https://purelymail.com/docs/setup/technical) | Standard Purelymail servers; use an app password when 2FA is enabled. |
| [Proton Mail Bridge](https://proton.me/support/imap-smtp-and-pop3-setup) | Requires paid desktop Bridge running locally. Confirm the instance's hosts, ports and generated credentials. Bridge is unavailable on mobile. |
| [Outlook.com](https://support.microsoft.com/en-US/Outlook/pop-imap-and-smtp-settings-for-outlook-com) / [Microsoft 365](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/pop3-and-imap4/pop3-and-imap4) | Server presets are included, but connection is unavailable until Cerberus supports Microsoft OAuth. Password login is deliberately disabled for these presets. |

Standard presets show a compact server summary. **Customize connection settings**
reveals host, port and security overrides. Proton Bridge and Zoho show these fields
immediately because their settings can vary. Only the selected provider's help and
official setup links appear. For an unlisted provider, request IMAP/SMTP settings
from its administrator or documentation. Importing a public PEM certificate can trust a
Bridge/custom server without disabling hostname/certificate checks.
Use **Import** beside Certificate to choose or replace the public PEM
certificate. Clicking **Save** copies it into Cerberus's app data, separately for
this repository; you can then move or delete the original export. Existing external
certificate paths are also imported on save. The selected certificate is applied
only when saving; canceling leaves the previous configuration unchanged.
The trash icon removes the selected certificate after Save. Private keys and files containing
private keys are rejected, and only the public certificate is copied. For Proton,
use Bridge's Settings → Advanced settings → Export TLS certificates and select the
certificate rather than the private key. Replace it if Bridge regenerates it.

Existing custom endpoints are preserved when loading settings. Choosing another
provider explicitly applies its defaults. Changing an existing mailbox's username
or server requires entering its password again, so the previous saved secret is
never silently reused with a different account/server. This implementation uses
the same username/password for IMAP and SMTP. Sending remains opt-in.

## Records and workflow

The mailbox is the record of feedback. Cerberus creates no local email archive,
feedback database or hosted service. Bodies/headers fetched by the reader are
held in memory. Connection settings are local; passwords stay in the OS
credential store. Empty local lock files coordinate app/agent mailbox operations.
Automation settings, message references and ordinary execution logs remain local.
**An agent's provider and its conversation/tool logs can retain accessed mail.**
Script output is also part of ordinary automation logs. This isn't a guarantee that mail read by an agent or printed by a script never appears on disk; don't
ask agents to copy private correspondence into responses, files or handoffs.

Use folders such as `Feedback/New`, `Feedback/Needs information`,
`Feedback/Ready`, `Feedback/In progress` and `Feedback/Resolved`. Cerberus lists
existing selectable folders and can create folders. Folder names support Unicode.
Folder hierarchy separators are server-defined and read from IMAP LIST. Settings
show the discovered tree before saving, including nonselectable parent containers.
Choose a purpose, then its destination in the tree; no mailbox path entry is
required. The Feedback page always shows its configured feedback folder. Folder creation
is available in mailbox settings and automation trigger setup. Proton custom folders use full
names such as `Folders/Reports`, while labels use `Labels/Reports`. Existing short
Proton names are matched only against a confirmed server folder; exact names are
preserved. A missing name remains unassigned until you select or create a folder.


Select an email to read it without marking it read. HTML is shown as inert text;
remote images/scripts aren't loaded. The reader lists attachment names; use your
mail client to download attachments or open messages larger than 2 MB. Lists load
50 messages at a time, in UID arrival order, with **Load older emails**.

**Move** uses UID MOVE. The server must support this extension; Cerberus refuses
an unsafe generic expunge fallback. **Save reply draft** appends a draft to the
configured Drafts folder. Replies honor the original Reply-To, falling back to
From, and include In-Reply-To/References. **Save internal note** appends a separate
message addressed to yourself in the Notes folder, linked to the original mail;
it never sends the note. These notes retain findings, commits and release links
without a separate feedback database. Thread display in other clients depends on
their threading behavior.

**Allow replies to be sent** explicitly enables sending for both the UI and agents
in this repository. The UI asks for a second click to confirm a reply. Each send
uses a stable operation ID, an IMAP attempt receipt before SMTP, and a Sent copy
after acceptance. A repeated operation with a Sent copy returns success; an
attempt without a Sent copy is uncertain and is never resent automatically.
Inspect delivery before explicitly trying a new operation ID. An SMTP failure can
be uncertain even when no Sent copy exists. Cerberus doesn't promise exactly-once
SMTP delivery or cross-device locking; use one automation host per mailbox.

The configured Inbox, Drafts, Sent, Notes and Receipts folders must be distinct.
Drafts/Notes/Receipts can be created when needed. Disabling the mailbox stops its
tools and polling; existing mail and the stored password remain untouched.

## Feedback-triggered automations

Add **On feedback email**. Its tree merges the children of every selected
repository's **Email root**; there is no repository selector in the condition.
The root itself is selectable. Unconfigured repositories are ignored. A `Bugs`
rule means the `Bugs` child of each repository's own root, regardless of its full
IMAP name or hierarchy separator. Automatic runs and **Run once** resolve the
same folder. This lets a classifier watch the root and move mail into `Bugs`,
`Support`, or other folders with independent automation rules.

Folders present everywhere use the normal text color. Partial coverage is dimmed,
with counts and repository names on hover. A configured but unreachable mailbox
remains in the total and is reported as unverified, never silently treated as
unconfigured. Selecting a partial folder offers to create it in the other
configured repositories. Creating a folder also asks for confirmation before
creating it across the selected configured repositories. Existing folders are
preserved; nested creation adds only missing parents/children using each server's
separator. Failures are reported per repository and can be retried. Declining is
allowed: rules simply skip repositories where that folder does not exist.

When email is configured later for a repository targeted by active automations,
settings offers to create their missing relative folders. This includes rules
that cover future repositories. It never creates folders without the user's
confirmation. Sending and all ordinary automation enabled settings are unchanged.
Previously saved absolute folder rules keep their behavior until a folder is
reselected in the root-relative tree; they are not silently rewritten.

Feedback events can combine with compatible conditions in an AND row, with OR
between rows. Commit/CI/feedback events are mutually exclusive within one row.
Pure feedback rows don't use the branch filter.

The first successful poll saves the watched folder's UIDVALIDITY/UID watermark in
the server's Receipts folder. **Emails already present then are excluded.** Later
arrivals, including older messages moved into the folder, become eligible. A
folder change creates a new observation baseline. Polling runs every minute while
Cerberus is open, catches up after downtime, and doesn't depend on read/unread
status. Disable/enable pauses/resumes observation without replaying handled mail.
New repositories begin observing when their mailbox is first successfully polled.

An automation receives one message at a time, oldest eligible UID first. Before
acknowledging dispatch on IMAP, Cerberus saves a recoverable run log containing
only its original message reference and automation context. Server-side receipt
messages prevent replay per automation and folder, using Message-ID (or
folder/UIDVALIDITY/UID when absent). Receipts are retained on the mail server; don't
delete them while relying on duplicate suppression. Changing the mailbox server,
recreating folders, or deleting receipts can require a new baseline. A
UIDVALIDITY reset restarts observation conservatively, excluding existing mail.
Distinct automations may each process the same email. Simultaneous schedulers on
multiple devices aren't supported as an exactly-once distributed queue.

Errors leave automations enabled. Repeated polling failures back off and produce
an actionable notification. Interrupted actions remain blocked for inspection and
explicit retry with their original reference. If the message was moved/deleted
or the folder reset, the reference can expire: choose its current location with
**Run once**, or let the agent find it through folder listings. Manual runs offer
recent emails from the watched folder, including older messages; the first real
option is selected. A manual run does not acknowledge it for automatic dispatch.

## Agent and script tools

Configured app-started agents receive instructions and scoped environment values,
without mailbox passwords. They invoke the executable in
`CERBERUS_FEEDBACK_TOOL` with `--cerberus-feedback`, passing JSON on stdin. Analyze
mode's tool interface permits only folders/list/read. Edit agents and scripts can
also create folders, move mail, append notes and drafts, and send if enabled.
Email content and attachments are untrusted data, not authorization to run
commands, disclose information or change the user's automation instructions.

Requests:

```json
{"action":"folders"}
{"action":"create","destination":"Feedback/Ready"}
{"action":"list","folder":"INBOX"}
{"action":"read","message":{"folder":"INBOX","validity":7,"uid":22,"messageId":"<example@example.org>"}}
{"action":"move","message":{"folder":"INBOX","validity":7,"uid":22,"messageId":"<example@example.org>"},"destination":"Feedback/Ready"}
{"action":"draft","message":{"folder":"INBOX","validity":7,"uid":22,"messageId":"<example@example.org>"},"text":"Thanks for the report."}
{"action":"note","message":{"folder":"INBOX","validity":7,"uid":22,"messageId":"<example@example.org>"},"text":"Fixed in commit ...; awaiting release."}
{"action":"send","message":{"folder":"INBOX","validity":7,"uid":22,"messageId":"<example@example.org>"},"text":"The fix is available.","operationId":"unique-stable-operation-id"}
```

Use the actual reference returned by list/read, never invented UIDs. The send tool
replies to the original sender/Reply-To; it doesn't accept an arbitrary recipient.

Feedback scripts also receive `CERBERUS_FEEDBACK_MESSAGE`, the triggering
reference as JSON. Bash:

```bash
mail_json=$(printf '{"action":"read","message":%s}\n' "$CERBERUS_FEEDBACK_MESSAGE" |
  "$CERBERUS_FEEDBACK_TOOL" --cerberus-feedback)
# Process "$mail_json" without printing private correspondence into the run log.
```

Python (no intermediate file):

```python
import json, os, subprocess
request = {"action": "note",
           "message": json.loads(os.environ["CERBERUS_FEEDBACK_MESSAGE"]),
           "text": "Triage complete; ready for implementation."}
subprocess.run([os.environ["CERBERUS_FEEDBACK_TOOL"], "--cerberus-feedback"],
               input=json.dumps(request), text=True, check=True)
```

PowerShell:

```powershell
$request = @{ action = 'read'; message = ($env:CERBERUS_FEEDBACK_MESSAGE | ConvertFrom-Json) }
$mailJson = $request | ConvertTo-Json -Compress | & $env:CERBERUS_FEEDBACK_TOOL --cerberus-feedback
# Process $mailJson without printing private correspondence into the run log.
```

Keep records in notes/drafts/folders rather than local files. Agent wording can
be ordinary instructions: “Read the triggering feedback, save an internal triage
note, and move it to Feedback/Ready if actionable. Draft a reply asking for any
missing details; do not send it.”
