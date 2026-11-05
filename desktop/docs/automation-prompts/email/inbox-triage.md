# Triage inbox (manual batch)

This automation inherits the configured screening agent's prompt/provider/model
and conditional triage handoff when it is installed. It has a Manual trigger,
Configured mailboxes only, all/future project scope, and `inboxBatch: true`.

The app snapshots INBOX references and invokes the screening prompt once per
message, sequentially. The agent sees one exact message reference, not a request
to scan the entire mailbox. Accepted messages pass to the existing Triage handoff
and folder-based specialist agents. A blocked item pauses the batch and keeps its
individual log/retry context. No messages are processed during installation.
