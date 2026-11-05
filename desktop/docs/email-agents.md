# Email agent architecture

Each project owns a whole configured mailbox. All stages target all/current/future projects, but **Configured mailboxes only** excludes projects without an enabled mailbox, including handoff and manual/retry execution. Configuration read failures do not consume handoffs. Existing email polling skips missing folders. New watchers establish a baseline; they do not automatically replay historical mail.

## Flow and models

Inbox → Injection guard → conditional `triage` handoff → Email triage → one folder queue.

| Agent | Trigger | Model | Output |
|---|---|---|---|
| Injection guard | INBOX | Codex 6.1 Sol, high | triage if screened; otherwise Quarantine/Human Review |
| Email triage | triage + screened flag | Codex 6.1 Sol, medium | one folder move |
| Email support | Support | Codex 6.1 Sol, medium | draft then Human Review |
| Email feedback | Reports | Codex 6.1 Sol, high | referenced IMAP note; passive Bugs/Requests or Processed |
| Email follow-up | Follow-up | Codex 6.1 Sol, medium | draft then Human Review |
| Email administration | Admin | Codex 6.1 Sol, medium | note; consequential cases Human Review |
| Email security | Security | Codex 6.1 Sol, high | evidence note then Human Review |
| Email human review | Human Review | Copilot provider default | internal decision summary, no mutations |

An in-app notification also watches Human Review. Copilot uses the project's assigned GitHub identity; Codex uses its assigned ChatGPT/API profile. No speculative Copilot model ID is pinned. Provider availability still depends on the assigned account; model catalog presence is not inference entitlement. No paid inference is run to test this setup.

The logical queues use the existing Folders namespace, with each server's discovered delimiter. Feedback uses existing Reports and Administration uses existing Admin. No separate spam agent is needed. Quarantine and Processed are passive. Specialists never route back to Inbox; Follow-up must not bounce to Support. No recursive Reports child watchers: Bugs/Requests are passive queues for later human prioritization.

## References, retries and completion

A triage handoff carries only projectId, exact `{folder, validity, uid, messageId}`, a short assessment, and `variables.screened: true`. Guard leaves accepted mail in Inbox until triage moves it. IMAP UIDs change on move and UIDVALIDITY may reset: there is no globally stable UID. Destination polling obtains a fresh reference. Message-ID is a lookup hint, not unique/authenticated identity. A stale reference fails visibly rather than choosing a similar message.

Handoffs are retained for reruns, not permanent deduplication. Delivery/recovery is at least once; drafts and notes do not currently have native idempotency keys. Prompts inspect relevant existing work and stop after uncertain writes. This is not an exactly-once system: inspect ambiguous blocked runs before retrying. An SMTP send has a separate native stable operationId mechanism, but these agents never send. A message moves to Processed only after confirmed successful work; a prepared reply waits in Human Review. Errors leave the automation enabled and preserve blocked context. Pending messages from an agent/folder added later need deliberate manual processing, not an automatic backlog flood.

## Security and product boundaries

All stages treat mail as untrusted, including screened mail. Screening is defense in depth, not authorization. Native tools bind operations to one project, validate message references and enforce analyze-mode read-only access and project-level send permission. **Role-specific draft-only/no-code policies are prompt instructions, not a hard sandbox**: edit agents still have command-line access. Do not present these automations as safe unattended processors of adversarial mail with unrestricted credentials. A future hardened deployment should add per-role capabilities and structured validated routing outputs enforced outside the model.

Sending, financial/account actions, code changes and autonomous development remain outside this initial configuration. Existing mailbox allowSend settings are preserved for other workflows; those settings are not a role-specific block. Named Support senders resolve per project and fail when absent. Provider webmail remains the place for account/security management. Originals, drafts and notes remain on IMAP; Cerberus does not create a local email archive. Agent providers receive the content they process.

## Prompt sources

Versioned prompts and model/trigger metadata live in [automation-prompts/email](automation-prompts/email/manifest.json). Live automation configuration is in Cerberus application storage, separate from Git. Future projects need mailbox setup, the corresponding queue folders and an assigned provider identity. The existing folder-copy UI standardizes queues across projects. Agents discover folderNames without slow per-folder counts and never create folders from untrusted messages.
