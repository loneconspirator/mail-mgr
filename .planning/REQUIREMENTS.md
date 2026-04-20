# Requirements: Mail Manager v0.6

**Defined:** 2026-04-20
**Core Value:** Dramatically reduce inbox volume without losing visibility

## v0.6 Requirements

Requirements for Action Folders milestone. Each maps to roadmap phases.

### Folder Lifecycle

- [ ] **FOLD-01**: System creates `Actions/` folder hierarchy on startup if folders don't exist
- [ ] **FOLD-02**: Action folders are always empty after processing completes
- [ ] **FOLD-03**: System processes pending messages in action folders on startup before entering normal monitoring loop

### Action Processing

- [ ] **PROC-01**: User can VIP a sender by moving a message to `Actions/VIP Sender` — creates sender-only `skip` rule, message returned to INBOX
- [ ] **PROC-02**: User can block a sender by moving a message to `Actions/Block Sender` — creates sender-only `delete` rule, message moved to Trash
- [ ] **PROC-03**: User can undo VIP by moving a message to `Actions/Undo VIP` — removes matching sender-only `skip` rule, message returned to INBOX
- [ ] **PROC-04**: User can unblock a sender by moving a message to `Actions/Unblock Sender` — removes matching sender-only `delete` rule, message returned to INBOX
- [ ] **PROC-05**: Sender is extracted from From header as lowercase bare email address
- [ ] **PROC-06**: If no parseable From address, message is moved to INBOX and error is logged
- [ ] **PROC-07**: Processing the same message twice does not create duplicate rules
- [ ] **PROC-08**: Undo operations with no matching rule still move the message to its destination

### Rule Integration

- [ ] **RULE-01**: Rules created via action folders pass the same Zod validation as web UI rules
- [ ] **RULE-02**: Rules created via action folders have unique UUID and descriptive name (e.g., `"VIP: sender@example.com"`)
- [ ] **RULE-03**: Rules created via action folders are appended at end of rule list
- [ ] **RULE-04**: Rules created via action folders are indistinguishable from web UI rules in rule list and disposition views

### Monitoring

- [ ] **MON-01**: Action folders are monitored via poll-based STATUS checks alongside INBOX/Review
- [ ] **MON-02**: Action folder processing takes priority over regular arrival routing

### Activity Logging

- [ ] **LOG-01**: Action folder operations are logged with `source = 'action-folder'` and standard message fields
- [ ] **LOG-02**: Activity log entries include rule_id/rule_name for created or removed rules

### Configuration

- [ ] **CONF-01**: Action folder prefix and folder names are configurable with sensible defaults
- [ ] **CONF-02**: Action folders can be enabled/disabled via config
- [ ] **CONF-03**: Poll interval is configurable

### Extensibility

- [ ] **EXT-01**: Action types are defined in a registry pattern where each entry specifies folder name, processing function, and message destination

## Future Requirements

### Enhanced Action Folder Monitoring

- **MON-03**: IDLE-based monitoring for action folders (if poll latency proves insufficient)

### Extended Action Types

- **EXT-02**: Nested action folders for folder-based filing (e.g., `Actions/File to/Projects/`)
- **EXT-03**: Non-sender rule actions via action folders

## Out of Scope

| Feature | Reason |
|---------|--------|
| Nested action folders | Future extension — own milestone |
| Bulk action folder operations | One message = one rule; bulk stays in web UI |
| Non-sender rule actions | Only sender-only dispositions; complex rules require web UI |
| IMAP NOTIFY extension | Standard IDLE/poll is sufficient |
| IDLE-based action folder monitoring | Poll-based is sufficient for v0.6; revisit if latency is a problem |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOLD-01 | — | Pending |
| FOLD-02 | — | Pending |
| FOLD-03 | — | Pending |
| PROC-01 | — | Pending |
| PROC-02 | — | Pending |
| PROC-03 | — | Pending |
| PROC-04 | — | Pending |
| PROC-05 | — | Pending |
| PROC-06 | — | Pending |
| PROC-07 | — | Pending |
| PROC-08 | — | Pending |
| RULE-01 | — | Pending |
| RULE-02 | — | Pending |
| RULE-03 | — | Pending |
| RULE-04 | — | Pending |
| MON-01 | — | Pending |
| MON-02 | — | Pending |
| LOG-01 | — | Pending |
| LOG-02 | — | Pending |
| CONF-01 | — | Pending |
| CONF-02 | — | Pending |
| CONF-03 | — | Pending |
| EXT-01 | — | Pending |

**Coverage:**
- v0.6 requirements: 23 total
- Mapped to phases: 0
- Unmapped: 23 ⚠️

---
*Requirements defined: 2026-04-20*
*Last updated: 2026-04-20 after initial definition*
