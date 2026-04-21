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
- [ ] **PROC-09**: If any existing sender-only rule for the same sender conflicts with the intended action, the conflicting rule is removed and the new rule is created. Both the removal and creation are logged to activity.
- [ ] **PROC-10**: If a more specific rule exists for the same sender (matching on additional fields beyond sender), it is preserved and the action folder rule is appended after it in the rule list.

### Rule Integration

- [ ] **RULE-01**: Rules created via action folders pass the same Zod validation as web UI rules
- [ ] **RULE-02**: Rules created via action folders have unique UUID and descriptive name (e.g., `"VIP: sender@example.com"`)
- [ ] **RULE-03**: Rules created via action folders are appended at end of rule list
- [ ] **RULE-04**: Rules created via action folders are indistinguishable from web UI rules in rule list and disposition views

### Monitoring

- [ ] **MON-01**: Action folders are monitored via poll-based STATUS checks alongside INBOX/Review
- [ ] **MON-02**: Action folder processing takes priority over regular arrival routing

### Activity Logging

- [x] **LOG-01**: Action folder operations are logged with `source = 'action-folder'` and standard message fields
- [x] **LOG-02**: Activity log entries include rule_id/rule_name for created or removed rules

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
| FOLD-01 | Phase 17 | Pending |
| FOLD-02 | Phase 20 | Pending |
| FOLD-03 | Phase 20 | Pending |
| PROC-01 | Phase 19 | Pending |
| PROC-02 | Phase 19 | Pending |
| PROC-03 | Phase 19 | Pending |
| PROC-04 | Phase 19 | Pending |
| PROC-05 | Phase 19 | Pending |
| PROC-06 | Phase 19 | Pending |
| PROC-07 | Phase 21 | Pending |
| PROC-08 | Phase 21 | Pending |
| PROC-09 | Phase 19 | Pending |
| PROC-10 | Phase 19 | Pending |
| RULE-01 | Phase 19 | Pending |
| RULE-02 | Phase 19 | Pending |
| RULE-03 | Phase 19 | Pending |
| RULE-04 | Phase 19 | Pending |
| MON-01 | Phase 20 | Pending |
| MON-02 | Phase 20 | Pending |
| LOG-01 | Phase 18, 23 | Complete |
| LOG-02 | Phase 18, 23 | Complete |
| CONF-01 | Phase 17 | Pending |
| CONF-02 | Phase 17 | Pending |
| CONF-03 | Phase 17 | Pending |
| EXT-01 | Phase 18 | Pending |

**Coverage:**
- v0.6 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-04-20*
*Last updated: 2026-04-20 after roadmap creation*
