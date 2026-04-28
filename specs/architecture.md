---
title: Mail-Mgr System Architecture
covers-modules: []
covers-integrations: []
---

# Mail-Mgr System Architecture

Mail-mgr is a single-process Node.js/TypeScript application that connects to an IMAP server, monitors incoming email, and automatically files messages based on user-defined rules. It learns from user behavior by detecting manual moves and proposing new rules.

## Boundaries

This architecture covers the mail-mgr application itself. Out of scope:

- The upstream IMAP server (Fastmail, Gmail, etc.) — treated as an external dependency.
- Mail clients used by the user — interactions are observed indirectly via IMAP state changes.
- The host OS and container runtime.

---

## Modules

### Core Processing

| Module | Responsibility |
|--------|---------------|
| **Monitor** | Listens for new IMAP messages in INBOX via IDLE (or polling fallback), evaluates rules, executes actions on arrival. The primary message processing loop. |
| **RuleEvaluator** | Evaluates an ordered list of rules against a message. First match wins. Skips rules requiring unavailable envelope data. |
| **RuleMatcher** | Tests a single rule against a message using glob patterns (sender, recipient, subject, deliveredTo) and exact matches (visibility, readStatus). |
| **ActionExecutor** | Executes the matched rule's action: move to folder, move to review, skip, or delete. Auto-creates destination folders on first use. |
| **ReviewSweeper** | Periodically archives aged messages from the Review folder. Read messages swept after `readMaxAgeDays` (default 7), unread after `unreadMaxAgeDays` (default 14). Re-evaluates rules to determine destination. |
| **BatchEngine** | Retroactive rule application: dry-run analysis and bulk filing of existing messages in any folder. Triggered manually via the web UI. |

### User Behavior Learning

| Module | Responsibility |
|--------|---------------|
| **MoveTracker** | Scans tracked folders on a timer (default 30s), detects messages that disappeared, confirms via two-scan protocol, and feeds signals to PatternDetector. |
| **DestinationResolver** | Locates where a moved message ended up. Fast-pass checks recent/common folders; deep-scan (15-min interval) searches all mailboxes by Message-ID. |
| **PatternDetector** | Processes move signals into proposals. Tracks per-sender destination counts, computes dominant destination, and auto-resurfaces dismissed proposals after 5 new signals. |
| **SignalStore** | SQLite persistence for raw user-move signals (sender, destination, visibility, read status). |
| **ProposalStore** | SQLite persistence for detected patterns. Tracks match/contradict counts, status (active/approved/dismissed), and links to approved rules. |
| **ConflictChecker** | Detects exact-match and shadow conflicts when a user attempts to approve a proposal, preventing duplicate or unreachable rules. |

### Action Folders

| Module | Responsibility |
|--------|---------------|
| **ActionFolderPoller** | Polls four IMAP action folders (VIP, Block, Undo-VIP, Unblock) on a timer (default 15s) for messages the user has dragged in. See IX-007. |
| **ActionFolderProcessor** | Processes action folder messages: creates or removes rules, handles conflicts and duplicates idempotently, moves the message to its final destination. See IX-008. |

### Configuration & State

| Module | Responsibility |
|--------|---------------|
| **ConfigRepository** | Manages the YAML config file. Provides rule CRUD, config section updates, and change listeners that trigger subsystem reloads. |
| **ActivityLog** | SQLite database recording all system actions (arrivals, sweeps, batches, action-folder ops). Auto-prunes entries older than 30 days. Also stores persistent state (lastUid cursor). |

### IMAP & Infrastructure

| Module | Responsibility |
|--------|---------------|
| **ImapClient** | Abstraction over imapflow: connect/disconnect, fetch/move/delete messages, create mailboxes, IDLE support with polling fallback, exponential backoff reconnect. |
| **EnvelopeDiscovery** | Probes the IMAP server at startup for custom envelope header support (e.g., Delivered-To). Persists discovered header name to config. |
| **FolderCache** | TTL-based cache (default 5 min) of the IMAP folder tree to reduce LIST commands. |
| **SentinelDetector** | Tests whether a message is a system-planted sentinel via the `X-Mail-Mgr-Sentinel` header. Guards every processing boundary. |
| **SentinelScanner** | Periodically verifies all tracked sentinel messages still exist in expected folders; triggers SentinelHealer on discrepancies. |
| **SentinelLifecycle** | Reconciles which folders need sentinels based on current config (rules, review, action folders) and plants or removes them accordingly. |

### Web Interface

| Module | Responsibility |
|--------|---------------|
| **WebServer** | Fastify HTTP server serving the SPA frontend and REST API routes for rules, activity, status, config, proposals, batch operations, and folder listing. |

---

## Entity Relationships

```mermaid
erDiagram
    CONFIG {
        string host "IMAP server"
        number port "IMAP port"
        string auth_user "IMAP username"
        string review_folder "Review folder name"
        string defaultArchiveFolder "Sweep fallback"
        string trashFolder "Trash folder name"
        number sweep_intervalHours "Sweep frequency"
        number readMaxAgeDays "Read message age limit"
        number unreadMaxAgeDays "Unread message age limit"
    }

    RULE {
        string id PK "UUID"
        string name "Display name (optional)"
        number order "Evaluation priority"
        boolean enabled "Active flag"
    }

    RULE_MATCH {
        string sender "Glob pattern"
        string recipient "Glob pattern"
        string subject "Glob pattern"
        string deliveredTo "Glob pattern"
        string visibility "direct/cc/bcc/list"
        string readStatus "read/unread/any"
    }

    RULE_ACTION {
        string type "move/review/skip/delete"
        string folder "Destination (move/review)"
    }

    ACTIVITY {
        integer id PK
        string timestamp
        integer message_uid
        string message_id
        string message_from
        string message_to
        string message_subject
        string rule_id FK
        string rule_name
        string action "move/skip/delete/review"
        string folder "Destination"
        string source "arrival/sweep/batch/action-folder"
        boolean success
        string error "Failure reason"
    }

    MOVE_SIGNAL {
        integer id PK
        string timestamp
        string message_id
        string sender
        string envelope_recipient
        string subject
        string read_status "read/unread"
        string visibility "direct/cc/bcc/list"
        string source_folder
        string destination_folder
    }

    PROPOSED_RULE {
        integer id PK
        string sender
        string envelope_recipient
        string source_folder
        string destination_folder "Dominant destination"
        integer matching_count
        integer contradicting_count
        string destination_counts "JSON map"
        string status "active/approved/dismissed"
        string approved_rule_id FK "Links to created rule"
    }

    SENTINEL {
        string message_id PK
        string folder_path
        string folder_purpose "review/rule-target/action-folder"
        string created_at
    }

    EMAIL_MESSAGE {
        integer uid
        string messageId
        string from
        string to
        string cc
        string subject
        string date
        string flags "IMAP flags"
        string envelopeRecipient
        string visibility "direct/cc/bcc/list"
    }

    CONFIG ||--o{ RULE : contains
    RULE ||--|| RULE_MATCH : has
    RULE ||--|| RULE_ACTION : has
    RULE ||--o{ ACTIVITY : "referenced by"
    MOVE_SIGNAL }o--|| PROPOSED_RULE : "aggregated into"
    PROPOSED_RULE |o--o| RULE : "approved as"
    EMAIL_MESSAGE ||--o{ ACTIVITY : "logged in"
    EMAIL_MESSAGE ||--o{ MOVE_SIGNAL : "detected as"
```

---

## Component Map

```mermaid
graph TB
    subgraph External
        IMAP["IMAP Server"]
        USER["User / Mail Client"]
        BROWSER["Browser"]
    end

    subgraph "Mail-Mgr Process"
        subgraph "IMAP Layer"
            IC[ImapClient]
            ED[EnvelopeDiscovery]
            FC[FolderCache]
        end

        subgraph "Core Processing"
            MON[Monitor]
            RE[RuleEvaluator]
            RM[RuleMatcher]
            AE[ActionExecutor]
        end

        subgraph "Sweep & Batch"
            RS[ReviewSweeper]
            BE[BatchEngine]
        end

        subgraph "User Behavior Learning"
            MT[MoveTracker]
            DR[DestinationResolver]
            PD[PatternDetector]
            SS[SignalStore]
            PS[ProposalStore]
            CC[ConflictChecker]
        end

        subgraph "Action Folders"
            AFP[ActionFolderPoller]
            AFPR[ActionFolderProcessor]
        end

        subgraph "Sentinel System"
            SD[SentinelDetector]
            SC[SentinelScanner]
            SL[SentinelLifecycle]
        end

        subgraph "State & Config"
            CR[ConfigRepository]
            AL[ActivityLog]
            DB[(SQLite)]
        end

        subgraph "Web Interface"
            WS[WebServer / API]
        end
    end

    IMAP <-->|IDLE / FETCH / MOVE| IC
    USER -->|moves messages| IMAP
    BROWSER <-->|HTTP| WS

    IC --> MON
    IC --> RS
    IC --> BE
    IC --> MT
    IC --> AFP
    IC --> SC

    MON --> SD
    MON --> RE
    RE --> RM
    MON --> AE
    AE --> IC

    RS --> SD
    RS --> RE
    RS --> IC

    BE --> RE
    BE --> IC

    MT --> DR
    DR --> IC
    DR --> AL
    MT --> PD
    PD --> PS
    MT --> SS

    AFP --> AFPR
    AFPR --> CR
    AFPR --> IC
    AFPR --> AL

    SC --> SL

    MON --> AL
    RS --> AL
    BE --> AL

    CR --> DB
    AL --> DB
    SS --> DB
    PS --> DB

    WS --> CR
    WS --> AL
    WS --> PS
    WS --> CC
    WS --> BE
    WS --> MON
    WS --> RS
    WS --> FC
```

---

## Integration Chains

Detailed sequence diagrams for each integration live in the `integrations/` spec files. This section shows how integrations chain together to fulfill use cases.

### UC-001: Manual move → proposed rule → auto-filing

```mermaid
flowchart TD
    subgraph "Phase 1 — Message arrives, no rule exists"
        A1["Message arrives in INBOX"] --> A2["IX-001: Arrival Detection & Rule Evaluation"]
        A2 -->|no match| A3["Message stays in INBOX"]
    end

    subgraph "Phase 2 — User moves message, system learns"
        B1["User moves message to 'Newsletters'"] --> B2["IX-003: User Move Detection & Destination Resolution"]
        B2 -->|confirmed user move| B3["IX-004: Signal Logging & Proposal Creation"]
        B3 --> B4["Proposal created (status: active)"]
    end

    subgraph "Phase 3 — User approves proposed rule"
        C1["User opens web UI"] --> C2["IX-005: Proposal Approval & Rule Creation"]
        C2 --> C3["New rule active in config"]
    end

    subgraph "Phase 4 — Next message auto-filed"
        D1["Second message arrives"] --> D2["IX-001: Arrival Detection & Rule Evaluation"]
        D2 -->|rule matches| D3["IX-002: Action Execution & Activity Logging"]
        D3 --> D4["Message moved to 'Newsletters'"]
    end

    A3 -.->|user acts| B1
    B4 -.->|user acts| C1
    C3 -.->|next arrival| D1

    style A2 fill:#e8f4fd,stroke:#1e88e5
    style B2 fill:#e8f4fd,stroke:#1e88e5
    style B3 fill:#e8f4fd,stroke:#1e88e5
    style C2 fill:#e8f4fd,stroke:#1e88e5
    style D2 fill:#e8f4fd,stroke:#1e88e5
    style D3 fill:#e8f4fd,stroke:#1e88e5
```

### UC-001.c Variant: Review sweep delayed filing

```mermaid
flowchart LR
    D1["Second message arrives"] --> D2["IX-001"]
    D2 -->|rule match: review| D3["IX-002: move to Review"]
    D3 --> D4["User reads message"]
    D4 -->|7 days pass| D5["IX-006: Review Sweep"]
    D5 --> D6["Message archived to destination"]

    style D2 fill:#e8f4fd,stroke:#1e88e5
    style D3 fill:#e8f4fd,stroke:#1e88e5
    style D5 fill:#e8f4fd,stroke:#1e88e5
```

---

## Data Flow Overview

```mermaid
flowchart LR
    subgraph Input
        IDLE["IMAP IDLE/Poll"]
        USERMOVE["User Moves"]
        ACTIONDROP["Action Folder Drops"]
        WEBUI["Web UI Actions"]
    end

    subgraph Processing
        MON["Monitor"]
        MT["MoveTracker"]
        AFP["ActionFolderPoller"]
        RS["ReviewSweeper"]
        BE["BatchEngine"]
    end

    subgraph Intelligence
        RE["RuleEvaluator"]
        PD["PatternDetector"]
        CC["ConflictChecker"]
    end

    subgraph State
        CONFIG["config.yml<br/>(rules)"]
        SQLITE["SQLite<br/>(activity, signals,<br/>proposals, sentinels)"]
    end

    subgraph Output
        MOVE["IMAP Move"]
        DELETE["IMAP Delete"]
        SKIP["No-op"]
        PROPOSAL["New Proposal"]
        NEWRULE["New Rule"]
    end

    IDLE --> MON
    USERMOVE --> MT
    ACTIONDROP --> AFP
    WEBUI --> BE
    WEBUI --> CC

    MON --> RE
    RS --> RE
    BE --> RE
    MT --> PD

    RE --> MOVE
    RE --> DELETE
    RE --> SKIP
    PD --> PROPOSAL

    AFP --> NEWRULE
    CC --> NEWRULE

    MON --> SQLITE
    RS --> SQLITE
    BE --> SQLITE
    AFP --> SQLITE
    MT --> SQLITE
    PD --> SQLITE

    NEWRULE --> CONFIG
    AFP --> CONFIG

    CONFIG -.->|reload| MON
    CONFIG -.->|reload| RS
    CONFIG -.->|reload| BE
```
