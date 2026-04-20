# Phase 11: Pattern Detection & Proposed Rules - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-12
**Phase:** 11-pattern-detection
**Areas discussed:** Pattern matching strategy, Proposed rules lifecycle, UI presentation, Analysis trigger

---

## Pattern Matching Strategy

### Signal Grouping
| Option | Description | Selected |
|--------|-------------|----------|
| Sender-to-folder | Group by exact sender → destination | |
| Domain-to-folder | Group by sender domain → destination | |
| Multi-level | Sender first, then domain rollup | |
| User-defined model | Sender + envelope_recipient + source_folder combo with strength scoring | ✓ |

**User's choice:** Custom model — one proposal per sender+envelope_recipient+source_folder combo. Strength increases for same destination, decreases for different destination. Negative strength = ambiguous counterindication, retained as data.
**Notes:** User explicitly designed this model. Key insight: seeing a move once = weak proposal, repeated = stronger, conflicting destinations = negative/ambiguous. Ambiguous proposals are valuable data that may be resolved by manual refinement or future LLM analysis.

### Conflict Handling
| Option | Description | Selected |
|--------|-------------|----------|
| Two separate proposals | Each destination combo is its own proposal | |
| One conflicted proposal | Dominant destination wins, contradicting signals reduce strength | ✓ |

**User's choice:** One conflicted proposal with the dominant destination. Contradictions reduce strength. User resolves ambiguity manually during review by adding visibility, subject matching, or other refinements.
**Notes:** User noted that future phases (LLM) could also help resolve ambiguity, but that's out of Phase 11 scope.

### Visibility Threshold
| Option | Description | Selected |
|--------|-------------|----------|
| Show all (strength >= 1) | Every pattern visible, including ambiguous | ✓ |
| Show strong only (>= 3) | Only high-confidence patterns | |
| Configurable threshold | User sets in settings | |

**User's choice:** Show all (strength >= 1). Maximum transparency.

### Strength Display
| Option | Description | Selected |
|--------|-------------|----------|
| Plain language | "Strong pattern (7 moves)", "Weak", "Ambiguous" | ✓ |
| Numeric score | Raw +7, +1, -1 numbers | |
| Both | Plain language + numeric | |

**User's choice:** Plain language only. No raw numeric scores.

---

## Proposed Rules Lifecycle

### Storage
| Option | Description | Selected |
|--------|-------------|----------|
| SQLite table | New proposed_rules table, separate from config | ✓ |
| In config.yml with flag | Mixed with real rules, proposed: true flag | |
| In-memory only | Recomputed from signals on demand | |

**User's choice:** SQLite proposed_rules table. Approve copies to config.yml.

### Dismiss Behavior
| Option | Description | Selected |
|--------|-------------|----------|
| Permanently suppressed | Never comes back | |
| Suppressed until new signals | Resurfaces after 5+ new moves post-dismiss | ✓ |
| You decide | Claude's discretion | |

**User's choice:** Suppressed until significant new signals. System notes "you dismissed this but kept moving these messages."

### Approved Row Handling
| Option | Description | Selected |
|--------|-------------|----------|
| Mark approved, keep row | Audit trail retained | |
| Delete after approval | Clean up | |
| You decide | Claude's discretion | ✓ |

**User's choice:** Claude's discretion.

---

## UI Presentation

### Location
| Option | Description | Selected |
|--------|-------------|----------|
| Own nav tab | "Proposed" in top nav bar | ✓ |
| Section within Rules page | Proposed rules section on Rules page | |
| Notification badge | Badge on Rules tab, inline banner | |

**User's choice:** Own "Proposed" nav tab.

### Modify Flow
| Option | Description | Selected |
|--------|-------------|----------|
| Open in rule editor | Pre-fill existing editor with proposal data | ✓ |
| Inline editing | Edit on the card directly | |
| You decide | Claude's discretion | |

**User's choice:** Open existing rule editor pre-filled.

### Example Messages
| Option | Description | Selected |
|--------|-------------|----------|
| Yes, show examples | 2-3 recent subjects/dates on each card | ✓ |
| No examples | Minimal display | |
| Expandable details | Collapsed by default | |

**User's choice:** Show 2-3 examples on each card.

---

## Analysis Trigger

### When to Run
| Option | Description | Selected |
|--------|-------------|----------|
| After each move signal | Real-time, scoped to affected combo | ✓ |
| Periodic (every 15 min) | Batch recalculation on timer | |
| On-demand only | User clicks button | |
| Hybrid | Signal + periodic full sweep | |

**User's choice:** After each move signal. Real-time updates.

---

## Claude's Discretion

- Approved proposal row retention vs deletion
- SQL schema details for proposed_rules table
- Conflicting destination storage format
- Exact plain-language strength thresholds
- Resurface-after-dismiss tracking mechanism
- Proposal sorting/ordering in UI
- Badge count on Proposed tab

## Deferred Ideas

- LLM analysis to resolve ambiguous proposals (future phase)
- Auto-detected subject/visibility pattern refinements (user wants manual-only in Phase 11)
