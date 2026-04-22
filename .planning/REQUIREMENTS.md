# Requirements: Mail Manager v0.7

**Defined:** 2026-04-22
**Core Value:** Dramatically reduce inbox volume without losing visibility

## v0.7 Requirements

Requirements for Sentinel Message System milestone. Each maps to roadmap phases.

### Sentinel Core

- [ ] **SENT-01**: System plants a sentinel message in every tracked folder on startup, and automatically plants sentinels in new folders when rules are created or config changes add new folder references
- [ ] **SENT-02**: Sentinel messages have a unique Message-ID, custom `X-Mail-Mgr-Sentinel` header, `\Seen` flag, and descriptive subject/body
- [ ] **SENT-03**: Sentinel Message-ID to folder purpose mappings are persisted in SQLite
- [ ] **SENT-04**: Sentinel body text explains the message's purpose to the user (for action folders, explains what the action folder does)
- [ ] **SENT-05**: INBOX does not receive a sentinel (cannot be renamed/deleted)
- [ ] **SENT-06**: Startup self-test verifies the IMAP server supports SEARCH by custom header before planting
- [ ] **SENT-07**: When a folder is no longer tracked (rule deleted, config reference removed), its sentinel message is deleted from IMAP and the mapping removed from SQLite

### Detection & Scanning

- [ ] **SCAN-01**: Periodic scan checks each sentinel's expected folder via IMAP SEARCH by Message-ID
- [ ] **SCAN-02**: When a sentinel is not found in its expected folder, a deep scan searches all IMAP folders
- [ ] **SCAN-03**: Scan runs on its own timer (configurable, default 5 minutes), independent of mail processing poll
- [ ] **SCAN-04**: Scanning does not block or significantly delay INBOX monitoring

### Auto-Healing

- [ ] **HEAL-01**: When a sentinel is found in a different folder than recorded, all config/rule references to the old path are updated to the new path
- [ ] **HEAL-02**: Config reference updates are atomic and do not trigger full pipeline rebuilds (action folder poller, monitor, sweeper)
- [ ] **HEAL-03**: When a sentinel is missing but its folder still exists, the sentinel is re-planted with a new Message-ID
- [ ] **HEAL-04**: Activity log records all healing events (rename detected, references updated, sentinel re-planted)

### Failure Handling

- [ ] **FAIL-01**: When both sentinel and folder are gone, associated rules and behaviors are disabled
- [ ] **FAIL-02**: An explanatory notification message is APPENDed to INBOX describing what broke and how to fix it
- [ ] **FAIL-03**: System does not auto-recreate deleted folders

### Pipeline Guards

- [ ] **GUARD-01**: Action folder processor ignores sentinel messages
- [ ] **GUARD-02**: Monitor rule engine ignores sentinel messages
- [ ] **GUARD-03**: Review sweeper ignores sentinel messages
- [ ] **GUARD-04**: Batch filing engine ignores sentinel messages
- [ ] **GUARD-05**: Move tracker ignores sentinel messages

### UI Cleanup

- [ ] **UI-01**: Folder rename card is removed from the settings page
- [ ] **UI-02**: Folder rename API endpoint is removed or deprecated

## Future Requirements

### Enhanced Sentinel Features

- **SENT-F01**: MAILBOXID (RFC 8474) integration as optimization on supporting servers
- **SENT-F02**: Sentinel health dashboard UI showing per-folder tracking status
- **SENT-F03**: Sentinel health API endpoint (GET /api/sentinels/health)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Hidden/invisible sentinel messages | Impossible with standard IMAP — no way to hide messages from clients |
| Global cross-folder IMAP search | Does not exist in protocol — must iterate folders individually |
| Real-time rename detection (IDLE/NOTIFY) | IDLE monitors one folder only; NOTIFY (RFC 5465) barely supported |
| Automatic folder recreation on deletion | User may have intentionally deleted — notify, don't auto-create |
| Sentinel in INBOX | INBOX cannot be renamed/deleted, sentinel provides zero value |
| CONDSTORE/QRESYNC for rename detection | Already rejected in v0.4 — tracks flag changes, not folder renames |
| Modifying message headers as tracking | IMAP doesn't support header modification; custom flags unreliable across servers |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SENT-01 | Phase 28 | Pending |
| SENT-02 | Phase 26 | Pending |
| SENT-03 | Phase 26 | Pending |
| SENT-04 | Phase 27 | Pending |
| SENT-05 | Phase 26 | Pending |
| SENT-06 | Phase 27 | Pending |
| SENT-07 | Phase 28 | Pending |
| SCAN-01 | Phase 30 | Pending |
| SCAN-02 | Phase 30 | Pending |
| SCAN-03 | Phase 30 | Pending |
| SCAN-04 | Phase 30 | Pending |
| HEAL-01 | Phase 31 | Pending |
| HEAL-02 | Phase 31 | Pending |
| HEAL-03 | Phase 31 | Pending |
| HEAL-04 | Phase 31 | Pending |
| FAIL-01 | Phase 31 | Pending |
| FAIL-02 | Phase 31 | Pending |
| FAIL-03 | Phase 31 | Pending |
| GUARD-01 | Phase 29 | Pending |
| GUARD-02 | Phase 29 | Pending |
| GUARD-03 | Phase 29 | Pending |
| GUARD-04 | Phase 29 | Pending |
| GUARD-05 | Phase 29 | Pending |
| UI-01 | Phase 32 | Pending |
| UI-02 | Phase 32 | Pending |

**Coverage:**
- v0.7 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-04-22*
*Last updated: 2026-04-22 after roadmap creation*
