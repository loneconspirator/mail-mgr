# Milestones

## v0.3 Folder Taxonomy & Batch Filing (Shipped: 2026-04-11)

**Phases completed:** 5 phases, 10 plans, 17 tasks

**Key accomplishments:**

- FolderCache with 5-min TTL serving IMAP folder hierarchy at GET /api/folders, with stale fallback and force-refresh support
- Non-blocking folder validation warnings on rule save endpoints using FolderCache.hasFolder() lookup
- Backend recent-folders endpoint and frontend API client methods for folder tree picker data sources
- Interactive tree picker with expand/collapse, recent folders, and selection state replacing text input in rule editor modal
- 1. [Rule 1 - Bug] Removed type assertion hack in BatchEngine
- renderBatch()
- Optional rule names with behavior-driven descriptions replacing name-first display in rule table
- Fixed batch dry-run no-match display bug, migrated cursor toggle to api wrapper, and replaced all catch(e: any) with type-safe catch(e: unknown)

---
