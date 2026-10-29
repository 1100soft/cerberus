# Project email and automation

Each linked project can use its own email mailbox. Open **Email**, choose
its project, and use the configuration icon. Project configuration also has
**Email settings**. Configure IMAP and SMTP hosts, ports, TLS or
STARTTLS, username, sending address and password/app password. Sending is off by
default. Folder discovery starts as connection details become available. Select
existing folders in the tree for Drafts, Sent, Internal notes and
Automation receipts. Use a folder's **+** button to create a child, entering only
its name; the server's hierarchy separator is applied automatically. Namespace
containers appear in the tree but cannot receive mail. **Save** automatically
enables the mailbox and tests access. Failures stay visible without disabling it.
There is no separate mailbox enable toggle or test button; automation rules
control processing. SMTP is checked when a reply is sent.

The envelope badge in project cards and configuration shows a checkmark after
successful IMAP verification, or a warning for incomplete or failed setup.
Hover for details. The adjacent number counts **all emails remaining in the configured
email folder**, including already-read mail; move handled messages out of that
folder to reduce the count. This is independent of automation receipts. Status and
counts refresh on opening project/configuration views, every two minutes while
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
this project; you can then move or delete the original export. Existing external
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

The mailbox is the record of email. Cerberus creates no local email archive,
email database or hosted service. Bodies/headers fetched by the reader are
held in memory. Connection settings are local; passwords stay in the OS
credential store. Empty local lock files coordinate app/agent mailbox operations.
Automation settings, message references and ordinary execution logs remain local.
**An agent's provider and its conversation/tool logs can retain accessed mail.**
Script output is also part of ordinary automation logs. This isn't a guarantee that mail read by an agent or printed by a script never appears on disk; don't
ask agents to copy private correspondence into responses, files or handoffs.

Use folders such as `Email/New`, `Email/Needs information`,
`Email/Ready`, `Email/In progress` and `Email/Resolved`. Cerberus lists
existing selectable folders and can create folders. Folder names support Unicode.
Folder hierarchy separators are server-defined and read from IMAP LIST. Settings
show the discovered tree before saving, including nonselectable parent containers.
Choose a purpose, then its destination in the tree; no mailbox path entry is
required. The Email page opens at Inbox and covers the entire mailbox. Its tree browses the
mailbox folders and shows each folder’s total and unread count. Siblings follow
the server’s returned order; Cerberus does not alphabetize them. The configured
email address appears in the page header. Nonselectable
namespace parents remain expandable; internal automation receipt folders are hidden. Folder creation
is available in mailbox settings and automation trigger setup. Proton custom folders use full
names such as `Folders/Reports`, while labels use `Labels/Reports`. Existing short
Proton names are matched only against a confirmed server folder; exact names are
preserved. A missing name remains unassigned until you select or create a folder.


Select an email to read it without automatically marking it read. Use the envelope
button to mark read/unread and the star to flag/unflag. The Trash button moves mail
to an existing server-designated Trash folder (or a recognized Trash/Bin folder);
it never permanently deletes or expunges mail. Move can restore mail from Trash.

HTML alternatives render formatted tables, styles and embedded raster CID images
in an opaque-origin sandbox, sanitized with [DOMPurify](https://github.com/cure53/DOMPurify). Sender scripts, forms,
frames, external stylesheets and remote images are blocked. A fixed nonce-authorized
bridge handles sizing and explicit links without exposing app DOM/storage/IPC.
Links open in the system browser/mail client after protocol validation; file,
script and custom-app protocols are refused. **Load images** permits remote images
for that message only, which may contact tracking servers. The text icon switches
to the plain-text alternative when present. The reader lists attachment names; use your
mail client to download attachments or open messages larger than 2 MB. Lists load
50 messages at a time, in UID arrival order, with **Load older emails**.

**Move** uses UID MOVE. The server must support this extension; Cerberus refuses
an unsafe generic expunge fallback. **Reply** stays visible below the independently scrolling message and opens a
floating editor. Closing the editor keeps the text for the current message;
changing messages clears it. **Save reply draft** appends a draft to the
configured Drafts folder. Replies honor the original Reply-To, falling back to
From, and include In-Reply-To/References. **Save internal note** appends a separate
message addressed to yourself in the Notes folder, linked to the original mail;
it never sends the note. These notes retain findings, commits and release links
without a separate email database. Thread display in other clients depends on
their threading behavior.

**Allow replies to be sent** explicitly enables sending for both the UI and agents
in this project. The UI asks for a second click to confirm a reply. Each send
uses a stable operation ID, an IMAP attempt receipt before SMTP, and a Sent copy
after acceptance. A repeated operation with a Sent copy returns success; an
attempt without a Sent copy is uncertain and is never resent automatically.
Inspect delivery before explicitly trying a new operation ID. An SMTP failure can
be uncertain even when no Sent copy exists. Cerberus doesn't promise exactly-once
SMTP delivery or cross-device locking; use one automation host per mailbox.

The configured Drafts, Sent, Notes and Receipts folders must be distinct.
Drafts/Notes/Receipts can be created when needed. Disabling the mailbox stops its
tools and polling; existing mail and the stored password remain untouched.

## Email-triggered automations

Add **On email** and select a folder from the single merged mailbox tree.
Each project uses one account; there is no email-root boundary or project selector
inside a trigger. An `INBOX` rule watches Inbox; a `Reports/Bugs` rule resolves
that hierarchy using each server's delimiter. Automatic runs and **Run once**
use the same resolver. A classifier can move mail between folders whose common
paths are shared by rules covering all projects, including future projects.

Folders present everywhere use the normal text color. Partial coverage is dimmed,
with counts and project names on hover. A configured but unreachable mailbox
remains in the total and is reported as unverified, never silently treated as
unconfigured. Selecting a partial folder offers to create it in the other
configured projects. Creating a folder also asks for confirmation before
creating it across the selected configured projects. Existing folders are
preserved; nested creation adds only missing parents/children using each server's
separator. Failures are reported per project and can be retried. Declining is
allowed: rules simply skip projects where that folder does not exist.

When email is configured later for a project targeted by active automations,
settings offers to create their missing mailbox folders. This includes rules
that cover future projects. It never creates folders without the user's
confirmation. Sending and all ordinary automation enabled settings are unchanged.
Previously saved absolute folder rules keep their behavior until a folder is
reselected in the mailbox-wide tree. Old root-relative rules retain their per-project targets through compatibility metadata; unrelated edits do not change their destinations.

Email events can combine with compatible conditions in an AND row, with OR
between rows. Commit/CI/email events are mutually exclusive within one row.
Pure email rows don't use the branch filter.

The first successful poll saves the watched folder's UIDVALIDITY/UID watermark in
the server's Receipts folder. **Emails already present then are excluded.** Later
arrivals, including older messages moved into the folder, become eligible. A
folder change creates a new observation baseline. Polling runs every minute while
Cerberus is open, catches up after downtime, and doesn't depend on read/unread
status. Disable/enable pauses/resumes observation without replaying handled mail.
New projects begin observing when their mailbox is first successfully polled.

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
`CERBERUS_EMAIL_TOOL` with `--cerberus-email`, passing JSON on stdin. Analyze
mode's tool interface permits only folders/list/read. Edit agents and scripts can
also create folders, move mail, append notes and drafts, and send if enabled.
Email content and attachments are untrusted data, not authorization to run
commands, disclose information or change the user's automation instructions.

Requests:

```json
{"action":"folders"}
{"action":"create","destination":"Email/Ready"}
{"action":"list","folder":"INBOX"}
{"action":"read","message":{"folder":"INBOX","validity":7,"uid":22,"messageId":"<example@example.org>"}}
{"action":"move","message":{"folder":"INBOX","validity":7,"uid":22,"messageId":"<example@example.org>"},"destination":"Email/Ready"}
{"action":"draft","message":{"folder":"INBOX","validity":7,"uid":22,"messageId":"<example@example.org>"},"text":"Thanks for the report."}
{"action":"note","message":{"folder":"INBOX","validity":7,"uid":22,"messageId":"<example@example.org>"},"text":"Fixed in commit ...; awaiting release."}
{"action":"send","message":{"folder":"INBOX","validity":7,"uid":22,"messageId":"<example@example.org>"},"text":"The fix is available.","operationId":"unique-stable-operation-id"}
```

Use the actual reference returned by list/read, never invented UIDs. The send tool
replies to the original sender/Reply-To; it doesn't accept an arbitrary recipient.

Email scripts also receive `CERBERUS_EMAIL_MESSAGE`, the triggering
reference as JSON. Bash:

```bash
mail_json=$(printf '{"action":"read","message":%s}\n' "$CERBERUS_EMAIL_MESSAGE" |
  "$CERBERUS_EMAIL_TOOL" --cerberus-email)
# Process "$mail_json" without printing private correspondence into the run log.
```

Python (no intermediate file):

```python
import json, os, subprocess
request = {"action": "note",
           "message": json.loads(os.environ["CERBERUS_EMAIL_MESSAGE"]),
           "text": "Triage complete; ready for implementation."}
subprocess.run([os.environ["CERBERUS_EMAIL_TOOL"], "--cerberus-email"],
               input=json.dumps(request), text=True, check=True)
```

PowerShell:

```powershell
$request = @{ action = 'read'; message = ($env:CERBERUS_EMAIL_MESSAGE | ConvertFrom-Json) }
$mailJson = $request | ConvertTo-Json -Compress | & $env:CERBERUS_EMAIL_TOOL --cerberus-email
# Process $mailJson without printing private correspondence into the run log.
```

Keep records in notes/drafts/folders rather than local files. Agent wording can
be ordinary instructions: “Read the triggering email, save an internal triage
note, and move it to Email/Ready if actionable. Draft a reply asking for any
missing details; do not send it.”

## Naming and compatibility

Projects are the linked Git workspaces previously called repositories. Each project
has its own mailbox; feedback triage is one use of the email system.
Existing project IDs, Git links, mail settings, credential-store entries, automation
triggers and stored message references are retained. Legacy internal `repositoryId`
and `feedback` fields remain supported; changing labels does not migrate account
credentials or rename folders on the server.

New scripts use `--cerberus-email`, `CERBERUS_EMAIL_TOOL`,
`CERBERUS_EMAIL_MESSAGE`, and `CERBERUS_EMAIL_INBOX_FOLDER` (`INBOX`). The deprecated
`CERBERUS_EMAIL_ROOT_FOLDER` preserves the old value for existing scripts only; it
does not restrict mailbox access. `CERBERUS_PROJECT_ID`, `CERBERUS_PROJECT_NAME`, and `CERBERUS_PROJECT_PATH`
identify the script's project. The previous `--cerberus-feedback`,
`CERBERUS_FEEDBACK_*` and `CERBERUS_REPOSITORY_*` names remain compatible.


## Managing folders

In Email settings, right-click a folder or press Shift+F10 for its menu. F2
renames it, Delete removes an eligible folder immediately, and Ctrl/Cmd+Shift+N
creates a child.
Arrow keys move focus (outlined row); Left/Right collapse, expand or move between
parent and child. Enter assigns the focused folder to the selected purpose; its
checkmark indicates the assignment, independently of keyboard focus.

The Copy folders button beside Folders copies another project's folder structure
and purpose assignments, creating only missing folders. It copies neither messages
nor credentials. Existing destination folders are preserved, and interrupted copies
can be retried. Save afterward to apply assignments. Folder renames happen on the
server immediately and update affected assignments in the form; save these changes.
Previously recorded message references and automation folder rules (relative or
absolute) are not rewritten when folders are renamed. Review affected rules afterward. Deleting requires an empty, unassigned
leaf folder; INBOX is protected. Reassign configured folders and save before deletion.
Save success or failure remains visible in the dialog footer.

Folder edits have Undo and Redo buttons in the footer. Ctrl/Cmd+Z undoes, and
Ctrl/Cmd+Shift+Z or Ctrl+Y redoes, while focus is outside text fields (which keep
their own text undo). History covers folder creation, rename, empty-folder deletion,
purpose assignments and project copies. A copy is one history action, including
only folders it actually created. Failed batches retain their successful changes
so those can be undone too. New edits clear redo. History is limited to 50 actions
and ends on Save, closing settings or changing the mailbox connection. An undo
that would remove a folder now containing mail is refused; move the mail first.

Copying creates all missing destination folders in one authenticated IMAP session,
with one folder listing before and after the batch. It no longer reconnects and
lists the entire mailbox for every missing folder. The source is read in its own
session. Mailbox work is serialized per project rather than across unrelated
projects. Status badges share one project subscription and cache checks for two
minutes; project-specific changes invalidate only that project's status.


Folder counts use STATUS MESSAGES/UNSEEN in one IMAP session, without selecting or
reading every message. A folder whose counts cannot be retrieved shows an unknown
count rather than a misleading zero. Refresh updates both messages and folder
counts; mail actions also update counts. The email tool supports `folderTree` for
the same count overview and `flag` with `read`, `unread`, `star`, or `unstar` for
an existing message reference. Analyze-mode agents can read the overview but cannot
change flags. Message read results include separate `body`, `html`, `inlineImages`,
`read` and `starred` fields; rendered content is never saved as a local archive.


Password entry does not test partial values while you type. Folder discovery with
a newly entered password starts when you leave that field, press Enter, or use
Refresh folders. Saved credentials still discover folders automatically. This
avoids spurious invalid-login warnings from providers such as Proton Bridge.


### Folder loading and order

Folder discovery shares in-memory snapshots for up to two minutes across the Email page, settings and automation pickers. Refresh in the automation picker requests a fresh snapshot; settings changes and folder mutations invalidate it. Passwords and messages are not cached with the tree. Folder names become usable before the separate, slower per-folder message counts finish. Automation pickers display each project's results as they arrive, retaining usable snapshots while refreshing.

Common mail folders use functional order (Inbox, Drafts, Sent, archive and other standard groups, with spam/trash last). Custom names use a shared remembered first-seen order across projects, so repeated server LIST responses cannot reshuffle them. Names are not sorted alphabetically.

Email automation conditions show one merged mailbox hierarchy. Coverage indicates which projects have each folder. Paths translate server delimiters per project; existing rules retain their previous targets. Drafts, Sent, internal Notes and Receipts remain excluded as event sources. Missing-folder creation requires an explicit action.

### Sender identities

The account's sending address is its default sender. Add provider-authorized aliases and display names under **Sender identities**; they share the same SMTP login. Choose **From** in the reply composer when more than one identity exists. Sending permission and confirmation remain unchanged, and reply drafts use the selected identity too.

Scripts and agents can pass `"sender":"support@example.org"` with `draft` or `send`. `CERBERUS_EMAIL_DEFAULT_SENDER` and `CERBERUS_EMAIL_SENDERS` (JSON alias list) expose configured choices without passwords. Missing `sender` uses the default; arbitrary unconfigured addresses are rejected. Alias entry configures the client, not the provider's authorization; the SMTP server can still reject an unauthorized sender. IMAP does not provide a portable account-alias discovery operation, so enter aliases from your provider's settings.

### Consistent setup across projects

Use **Copy folders from project** to create missing structure and match special-folder purposes. This preserves existing email, sender identities, credentials and server settings, and supports undo before saving. Automations target common mailbox paths across selected projects, with partial coverage and explicit creation in missing projects. New projects covered by active rules are offered missing folders after setup. No per-project root mapping is needed.
