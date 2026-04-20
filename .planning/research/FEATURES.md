# Feature Research: Action Folders

**Domain:** Email management -- mail-client-driven rule management via IMAP folders
**Researched:** 2026-04-20
**Confidence:** HIGH (well-scoped PRD, existing codebase understood, clear prior art from SaneBox)

## Feature Landscape

### Table Stakes (Users Expect These)

Features that must work correctly or the action folder concept is dead on arrival. The user moved a message to a folder and expects something to happen -- if it doesn't, trust is permanently broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Folder auto-creation on startup | User should not have to manually create `Actions/*` folders. System infrastructure, not user taxonomy. | LOW | `ImapFlowLike.mailboxCreate` already available. Create `Actions/` prefix + 4 subfolders. Handle "already exists" gracefully (IMAP CREATE on existing folder = error on some servers, no-op on others). |
| Always-empty-after-processing | Messages sitting in action folders = confusion. User expects immediate effect, not accumulation. | MEDIUM | Must process on every poll/IDLE cycle AND on startup (restart recovery). The "always empty" invariant is the core UX promise. |
| Restart recovery | If system crashes with messages in action folders, they must be processed on next startup, not lost or ignored. | MEDIUM | Pre-scan action folders before entering normal monitor loop. Depends on: startup sequencing in `src/index.ts`. |
| Correct sender extraction | User moves a message from `sender@example.com` and expects a rule for exactly that sender. Lowercase, bare address, no display name. | LOW | `EmailMessage.from.address` already normalized in `parseMessage`. Just use it. |
| Idempotent processing | Crash after rule creation but before message move must not create duplicate rules on restart. | MEDIUM | Check for existing enabled sender-only rule with same glob + action type before creating. Depends on: `isSenderOnly()` from `dispositions.ts`, `ConfigRepository.getRules()`. |
| Message lands in correct destination | VIP/Undo VIP -> archive, Block -> Trash, Unblock -> INBOX. Message must not vanish or stay in action folder. | LOW | Reuse `executeMove` from `src/actions/index.ts`. Destinations are deterministic per action type. |
| Activity logging with distinct source | User must be able to see "this rule was created because I moved a message to VIP Sender" in the activity log. | LOW | New `source = 'action-folder'` value. Existing `logActivity` signature already accepts source string. |
| Rules appear in disposition views | VIP rule shows in Priority Senders, Block rule shows in Blocked Senders. No special handling needed because action folder rules ARE standard sender-only rules. | LOW | Zero work if rules are created correctly via `ConfigRepository.addRule()`. The disposition query API in `dispositions.ts` filters by `isSenderOnly()` + action type. This is the key architectural win of the v0.5 design. |
| Rules appear in main rule list | Action folder rules are editable/deletable from the web UI like any other rule. No second-class citizens. | LOW | Same as above -- standard rules via `ConfigRepository.addRule()`. |
| Configurable folder names and prefix | IMAP hierarchy separators vary (`.` vs `/`), users may want different names. | LOW | New `actionFolders` section in config schema. Defaults to `Actions/VIP Sender` etc. |
| Duplicate prevention (create operations) | Moving 3 messages from same sender to VIP Sender should create ONE rule, not three. | MEDIUM | Before creating: query existing rules for matching sender glob + action type. Depends on: ability to query rules by sender, which `dispositions.ts` already does implicitly. |
| No-op tolerance (undo operations) | `Undo VIP` with no matching VIP rule should still move the message to archive, not error. | LOW | Just log "no matching rule found" and proceed with message move. |
| Error handling for malformed From | Message with no parseable From address must not silently disappear. Move to INBOX + log error. | LOW | Defensive check on `message.from.address` before processing. |

### Differentiators (Competitive Advantage)

Features that go beyond "it works" into "this is actually pleasant to use."

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Extensible action type registry | Adding future action types (e.g., `Route to Review`, `File to [Folder]`) requires registering an entry, not modifying processing logic. | MEDIUM | Each action type = { folderName, processFn(message, configRepo), destinationFolder }. Registry pattern over switch statement. Not strictly needed for v0.6's 4 folder types, but prevents technical debt. |
| Descriptive auto-generated rule names | Rules created via action folders get names like `"VIP: sender@example.com"` or `"Block: sender@example.com"`. | LOW | Uses existing optional `name` field. Makes disposition views and rule list more scannable. |
| Near-instant responsiveness | User moves message, rule exists within seconds (one poll cycle). SaneBox benchmark: 2-5 minutes. We can beat that significantly with IDLE or short poll intervals. | MEDIUM | If action folders are IDLE-monitored (not just polled), response time drops to seconds. Current monitor uses IDLE for INBOX. Extending to action folders means multiple IDLE connections or a polling fallback with short interval. IMAP only allows one IDLE per connection. |
| Multi-folder monitoring integration | Action folders monitored alongside INBOX and Review, not as a separate subsystem. Unified processing pipeline. | MEDIUM | Extends the `Monitor` class or creates a sibling `ActionFolderProcessor`. Must not block or delay normal INBOX processing. |
| Priority processing | Action folder messages processed before regular arrival routing. The user explicitly requested an action -- it takes precedence. | LOW | Check action folders first in the processing loop, before INBOX scan. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Bulk action folder operations (move 50 messages = 50 rules) | "I want to VIP all messages from a newsletter" | Creates 50 duplicate rule creation attempts, all but 1 are no-ops. Wastes processing time. User intent is ambiguous -- do they want 1 rule or 50? The answer is 1. | Duplicate prevention handles this naturally. 50 messages from same sender = 1 rule + 49 no-ops + 50 message moves. Document this as expected behavior. |
| Nested action folders (`Actions/File to/Projects/`) | Power users want folder-based filing | Dramatically increases complexity: folder name becomes parameter, requires parsing subfolder paths, folder creation/discovery changes. Out of scope for v0.6 per PRD. | Defer to future milestone. Web UI already handles complex routing rules. |
| Action folders for non-sender rules | "I want to route based on subject from action folder" | A message doesn't carry enough context to define a subject/recipient rule. Sender is the only unambiguous dimension extractable from a single message. | Keep action folders sender-only. Complex rules require the web UI. |
| IMAP NOTIFY for instant detection | "I want zero latency" | IMAP NOTIFY is poorly supported across servers and clients. imapflow doesn't support it. IDLE + short poll achieves sub-10-second latency which is plenty. | IDLE on primary connection + poll on action folders at 10-15 second intervals. |
| Undo/redo system for action folder ops | "I accidentally VIP'd someone" | Undo VIP and Unblock Sender folders already exist as the undo mechanism. A separate undo system is redundant complexity. | The 4-folder design IS the undo system: VIP/Undo VIP, Block/Unblock. |
| Confirmation/notification after processing | "Did it work?" | Would require push notifications, email replies, or a separate notification channel. The action folder being empty IS the confirmation -- if the message is gone, it worked. | Activity log in web UI for auditing. Message disappearance from action folder = confirmation. |
| Auto-creating rules with `move` action type from action folders | "I want to file to specific folders from mail client" | Requires knowing the destination folder, which can't be inferred from the action folder name alone (unless nested folders, which is anti-feature above). | `skip` (VIP) and `delete` (Block) are the only action types that need no additional parameters. `move` requires a folder target -- use web UI. |

## Feature Dependencies

```
[Config schema: actionFolders section]
    |-- required by --> [Folder auto-creation on startup]
    |                       |-- required by --> [Monitoring integration]
    |                                               |-- required by --> [Message processing]
    |                                                                       |-- required by --> [Activity logging]
    |
    |-- required by --> [Action type registry]
                            |-- required by --> [Message processing]

[Existing: isSenderOnly() + disposition query API (v0.5)]
    |-- required by --> [Duplicate prevention / idempotent processing]
    |-- required by --> [Rule creation via ConfigRepository.addRule()]

[Existing: ConfigRepository.addRule() / deleteRule()]
    |-- required by --> [Rule creation from action folders]
    |-- required by --> [Rule removal (undo operations)]

[Existing: executeAction / executeMove (src/actions/)]
    |-- required by --> [Message destination routing after processing]

[Existing: ActivityLog.logActivity() with source param]
    |-- required by --> [Activity logging with 'action-folder' source]

[Existing: Monitor IDLE/poll loop]
    |-- enhances --> [Multi-folder monitoring for action folders]
```

### Dependency Notes

- **Config schema must come first:** Everything downstream needs to know folder names, prefix, and enabled state.
- **Folder creation depends on config:** Can't create folders without knowing their names.
- **Monitoring depends on folder existence:** Can't watch folders that don't exist yet.
- **Processing depends on monitoring:** Can't process messages you're not watching.
- **Duplicate prevention depends on v0.5 disposition infrastructure:** The `isSenderOnly()` predicate and rule querying from `dispositions.ts` are the foundation for checking "does a matching rule already exist?"
- **Rule creation/removal depends on ConfigRepository:** `addRule()` and `deleteRule()` handle validation, persistence, and change notification. Action folders must use these, not bypass them.
- **Activity logging depends on processing:** Log after the action, not before.

## MVP Definition

### Launch With (v0.6 core)

These are the features that make action folders functional and trustworthy.

- [x] Config schema for `actionFolders` section with defaults -- gates everything else
- [x] Folder auto-creation on startup -- system infrastructure
- [x] Restart recovery (pre-scan action folders before monitor loop) -- crash safety
- [x] Sender extraction + rule creation via ConfigRepository -- the actual point of the feature
- [x] Sender extraction + rule removal for undo operations -- completes the 4-folder set
- [x] Duplicate prevention / idempotent processing -- prevents garbage rules
- [x] Message destination routing (archive, Trash, INBOX) -- messages must go somewhere
- [x] Activity logging with `action-folder` source -- auditability
- [x] Monitoring integration (poll-based at minimum) -- detection mechanism
- [x] Error handling for malformed From -- defensive edge case
- [x] Descriptive auto-generated rule names -- low effort, high clarity

### Add After Validation (v0.6.x if needed)

- [ ] IDLE-based monitoring for action folders (if poll latency proves annoying in practice)
- [ ] UI indicator showing action folder status (enabled/disabled, last processed)
- [ ] Activity log filtering by `action-folder` source in the web UI

### Future Consideration (v0.7+)

- [ ] Extensible action type registry for additional folder types -- defer until a second action type is needed
- [ ] Nested action folders for folder-based filing -- complex, needs own milestone
- [ ] `Actions/Route to Review` folder type -- simple extension once registry exists

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Folder auto-creation on startup | HIGH | LOW | P1 |
| Always-empty-after-processing | HIGH | MEDIUM | P1 |
| Restart recovery | HIGH | MEDIUM | P1 |
| Correct sender extraction | HIGH | LOW | P1 |
| Idempotent processing | HIGH | MEDIUM | P1 |
| Message destination routing | HIGH | LOW | P1 |
| Activity logging | MEDIUM | LOW | P1 |
| Duplicate prevention | HIGH | MEDIUM | P1 |
| Configurable folder names | MEDIUM | LOW | P1 |
| Descriptive rule names | MEDIUM | LOW | P1 |
| Error handling (malformed From) | MEDIUM | LOW | P1 |
| No-op tolerance (undo) | MEDIUM | LOW | P1 |
| Extensible action registry | LOW | MEDIUM | P2 |
| Near-instant responsiveness (IDLE) | MEDIUM | HIGH | P2 |
| Priority processing | LOW | LOW | P2 |
| Multi-folder monitoring (IDLE) | MEDIUM | HIGH | P2 |

## Competitor Feature Analysis

| Feature | SaneBox | Mail-Mgr Action Folders | Notes |
|---------|---------|------------------------|-------|
| Folder-based training | Move email to SaneLater/SaneBlackHole to train AI | Move to VIP/Block/Undo VIP/Unblock to create/remove deterministic rules | SaneBox uses ML; we use explicit sender-only rules. Simpler, more predictable. |
| Responsiveness | 2-5 minute sync cycle | Sub-60-second poll, potentially sub-10-second with IDLE | We win on responsiveness because we run locally against the IMAP server. |
| Folder creation | SaneBox creates folders automatically | Same -- auto-create on startup | Parity. |
| Undo mechanism | Move email back to Inbox to undo | Dedicated Undo VIP / Unblock Sender folders | Our approach is more explicit and discoverable. SaneBox requires knowing to move back to Inbox. |
| Bulk operations | Supports bulk move-to-train | One rule per unique sender regardless of message count | Handled via duplicate prevention. Same end result. |
| Rule visibility | Hidden ML model, no rule list | Full rule list in web UI, disposition views, editable | Transparency advantage -- user can see and modify every rule. |
| Non-sender rules | AI classifies by content, not just sender | Sender-only from action folders | Intentional limitation -- complex rules need web UI. |

## Sources

- [SaneBox: How to train/teach SaneBox](https://www.sanebox.com/help/140-how-do-i-train-teach-sanebox) -- folder-based training UX
- [SaneBox: Email Organize bulk operations](https://www.sanebox.com/help/80-sanebox-email-organize-quickly-process-email-in-bulk) -- bulk action handling
- [SaneBox: Sane folder choices](https://www.sanebox.com/help/138-beyond-sanelater-more-sane-folder-choices) -- folder naming patterns
- [SaneBox Review 2025](https://www.fahimai.com/sanebox) -- responsiveness and UX expectations
- Existing codebase: `src/web/routes/dispositions.ts` (isSenderOnly predicate), `src/config/repository.ts` (addRule/deleteRule), `src/monitor/index.ts` (IDLE/poll pattern), `src/actions/index.ts` (executeMove), `src/config/schema.ts` (rule validation)
- PRD: `docs/prd-v0.6.md` -- authoritative requirements

---
*Feature research for: Action Folders (v0.6 milestone)*
*Researched: 2026-04-20*
