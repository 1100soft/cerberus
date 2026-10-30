# Project email and automation

Cerberus prioritizes email automation and consistent folder structures and rules
across projects. Provider-level account management belongs in the provider web UI;
basic reading and replying are supporting features.

The Email header’s **Open webmail** icon opens the provider in your default
browser. It reuses that browser’s session, which may belong to a different
account or require sign-in. Cerberus never transfers mailbox or Bridge passwords
or API tokens to the browser. Built-in providers have webmail destinations. For
other servers, set **Webmail URL** in Email settings; connection customization
also exposes an override for regional or organization-specific webmail. Only
HTTPS URLs without embedded credentials are accepted.

Each linked project can use its own email mailbox. Open **Email**, choose
its project, and use the configuration icon. Project configuration also has
**Email settings**. Configure IMAP and SMTP hosts, ports, TLS or
STARTTLS, username, sending address and password/app password. Sending is off by
default. Folder discovery starts as connection details become available. Select
existing folders in the tree for Internal notes and Automation receipts.
Drafts and Sent are detected from server special-use flags, with existing-folder
and common-name fallbacks. **Folder settings** exposes manual overrides when a
server lacks those flags or you want a different destination. Existing custom
assignments remain manual. Use a folder's **+** button to create a child, entering only
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
namespace parents remain expandable; automation receipt folders are visible and marked with their purpose. Folder creation
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


### Server identity synchronization

Fastmail supports bidirectional sender identity synchronization through JMAP.
Save the mailbox first, then use **Connect sync** under **Sender identities**
with a Fastmail API token that permits mail submission/identity access
([token setup](https://www.fastmail.com/dev/)). This token is separate from the
IMAP app password and is stored in the OS password store, never mailbox settings.
Connecting and **Refresh senders** import server identities; opening the Email
page refreshes connected identities independently of message/folder loading.
Refresh replaces unsaved identity edits. **Save** publishes additions, display-name
edits and permitted removals, then imports the actual server result.

Server identity email addresses are immutable; add a new identity instead of
renaming its email. The server decides which sending addresses are authorized.
Nondeletable identities are protected, and wildcard identities, signatures,
Reply-To and Bcc settings are preserved. Concurrent server edits block publishing
until refreshed. A partial server rejection can leave some edits applied; refresh
before retrying. Failed synchronization keeps the local form and last saved
configuration. Disconnecting sync stops synchronization without deleting server
identities. Folder copying never copies identities or API credentials.

IMAP and SMTP do not provide a standard sender-identity settings API. Proton
Bridge does not expose address-editing operations, and Purelymail's public API
manages routing rather than webmail sender identities. These and other providers
keep manual identity configuration; there is no promise of two-way synchronization
where the provider cannot support it.


### Organizing mail across projects

On the Email page, drag an email onto a folder to move it within the current
project. Drag a folder onto another folder (or the Mailbox strip for top level)
to move its entire subtree. Cross-project drags, collisions, and moves into the
folder's own descendants are rejected. Folder moves use IMAP RENAME; email moves
require UID MOVE, without a copy/delete fallback.

Right-click an email for read/unread, star, Move, Archive (when available) or
Trash. Shift+F10 opens the same menu; Delete moves an email to Trash. Folder menus
provide New folder, Rename (F2), Move and Delete. Ctrl/Cmd+Shift+N creates a child
of the focused folder. Creating and deleting folders opens a project scope choice:
this project, every configured project, or checked projects. Paths translate each
server's hierarchy delimiter. Unconfigured projects are not mutation targets.

Deletion never removes email silently. If a selected folder contains messages,
Cerberus switches to that project and folder and pauses deletion. Move emails
opens a destination tree and explicitly moves all emails currently in that folder;
Keep folder leaves it alone and continues with the remaining projects. Retry
deletion checks the contents again after manual organization. The native backend
rechecks emptiness before DELETE. INBOX, assigned folders and folders with children
are protected; delete children first. Nothing is permanently purged by these actions.

The header's outward/inward copy icons copy the current tree to other projects or
copy another project's tree into the current project. They create missing folders;
existing mail, identities, account credentials and assigned folder purposes stay
unchanged. Each destination is applied in one authenticated folder batch. Partial
failures are reported per project and successful changes remain undoable.

Undo/Redo buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (or Ctrl+Y) cover this page's folder
creation, deletion, rename, move, ordering and copy actions while the Email page stays open, including
successful parts of multi-project operations. Email moves are not part of folder
undo. Undo refuses to delete folders that have subsequently received mail. Text
fields retain their own editing shortcuts. Existing automation rules and saved
message references keep their old folder paths after rename/move; update those
rules explicitly if their watched folder changed.


### Shared automation sender identities

Give the default sender or any additional address an **Identity name**
in Email settings. Suggestions include names defined in other projects. For
example, assign **Support** to `support@projectA.com` in project A and
`support@projectB.com` in project B. The automation can use the same name in both
projects; the email tool resolves it against the project running the action.
Names are case-insensitive, unique within a project, and limited to 64 characters
without `@` or control characters. A missing name fails instead of choosing
another sender. An unnamed identity remains usable by its address or provider ID.

Identity names are local mappings, separate from the display name
shown to recipients. Provider identity synchronization preserves these mappings;
editing a local name does not rename the provider identity. Suggestions reuse the
name, never another project's address or credentials. The reply composer's From
menu shows the identity name alongside its current project address.

Agent prompt example: “Read the incoming email and save a reply draft using the
Support sender identity.” Agents can pass `"sender":"Support"` to draft or send.
`CERBERUS_EMAIL_SENDERS` lists each configured `identityName`, `address`, display
`name` and optional provider ID, including the default sender. Sending permission
and confirmation/idempotency rules remain unchanged.

Bash example for an email-triggered script:

```bash
printf '{"action":"draft","sender":"Support","message":%s,"text":"Thanks. We are reviewing your report."}\n' \
  "$CERBERUS_EMAIL_MESSAGE" | "$CERBERUS_EMAIL_TOOL" --cerberus-email
```

For Proton Bridge, a new top-level custom folder is created inside the server's
`Folders` namespace. Newly created folders are selected and their ancestors
expanded, so they are visible even when the parent was collapsed.


Folder menus float above the tree without changing its layout. Drop a folder on
another folder to change its parent, or on the line between rows to place it
beside a sibling. Explicit sibling order is stored locally per project (IMAP does
not synchronize folder order); untouched folders retain the functional ordering.
Folder mutations show provisional dimmed rows with spinners while the server
works. Server results replace the preview, and failures restore the confirmed
state. Tree expansion and browsing remain available. Folder batches reuse their
returned structure instead of waiting for another discovery before rendering.

An existing folder is selected rather than created again. In particular, a
folder assigned to Automation receipts is shown in the Email tree; it is not a
missing folder. Its assignment still protects it from folder deletion/movement
and from moving receipt emails. To use it for regular mail, assign a different
Automation receipts folder in Email settings first.

Email settings group provider, sign-in, connection, sender identities and folder
purposes. Every sender row uses Email address, Identity name and Display name in
the same order. Identity names such as Support are shared vocabulary for agents;
display names are the names recipients see.
