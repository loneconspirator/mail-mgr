# Shared Types Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the hand-maintained frontend type definitions that are already drifting from the backend Zod schemas. The frontend should import API response types from a shared module so the compiler catches mismatches.

**Architecture:** Create a `src/shared/types.ts` module that re-exports the Zod-inferred types from `src/config/schema.ts` and adds API-specific response types (like the masked IMAP config and activity entries). The frontend `api.ts` imports from shared. The backend route files also import response types from shared when constructing responses. The Zod schemas stay in `src/config/schema.ts` — we are not moving them.

**Tech Stack:** TypeScript, Zod (`z.infer<>`), esbuild (frontend bundler — must be able to resolve the shared import)

---

### Task 1: Create the shared types module

**Files:**
- Create: `src/shared/types.ts`

**Step 1: Write the shared types file**

```typescript
// src/shared/types.ts
//
// Canonical API types shared between backend routes and frontend.
// Derived from Zod schemas where possible; hand-written only for
// API-layer shapes that don't exist in config (e.g. masked IMAP, activity rows).

export type {
  Rule,
  Action,
  MoveAction,
  EmailMatch,
  ImapConfig,
} from '../config/schema.js';

// The IMAP config as returned by GET /api/config/imap (password masked)
export interface ImapConfigResponse {
  host: string;
  port: number;
  tls: boolean;
  auth: { user: string; pass: string };
  idleTimeout: number;
  pollInterval: number;
}

// GET /api/activity response row
export interface ActivityEntry {
  id: number;
  timestamp: string;
  uid: number;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  ruleId: string;
  ruleName: string;
  action: string;
  folder: string;
  success: number;
  error: string | null;
}

// GET /api/status response
export interface StatusResponse {
  connectionStatus: string;
  lastProcessedAt: string | null;
  messagesProcessed: number;
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add shared types module for API request/response shapes"
```

---

### Task 2: Update the frontend api.ts to import from shared types

**Files:**
- Modify: `src/web/frontend/api.ts:1-35` (remove hand-written interfaces, import from shared)

**Step 1: Verify the current broken state**

Note the current frontend `Rule` interface at `src/web/frontend/api.ts:3-10`:
```typescript
export interface Rule {
  id: string;
  name: string;
  match: { sender?: string; subject?: string; from?: string };  // <-- "from" is wrong
  action: { type: string; folder: string };
  enabled: boolean;
  order: number;
}
```

This has `from` which doesn't exist on the backend `Rule` type, and is missing `recipient`.

**Step 2: Replace the hand-written types with imports**

Replace the top of `src/web/frontend/api.ts` with:

```typescript
// API wrapper — all fetch calls to the backend

import type { Rule, ImapConfig } from '../../shared/types.js';
import type { ActivityEntry, StatusResponse } from '../../shared/types.js';

// Re-export for frontend consumers
export type { Rule, ImapConfig, ActivityEntry, StatusResponse };

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  rules: {
    list: () => request<Rule[]>('/api/rules'),
    create: (rule: Omit<Rule, 'id'>) => request<Rule>('/api/rules', { method: 'POST', body: JSON.stringify(rule) }),
    update: (id: string, rule: Omit<Rule, 'id'>) => request<Rule>(`/api/rules/${id}`, { method: 'PUT', body: JSON.stringify(rule) }),
    delete: (id: string) => request<void>(`/api/rules/${id}`, { method: 'DELETE' }),
    reorder: (items: { id: string; order: number }[]) => request<Rule[]>('/api/rules/reorder', { method: 'PUT', body: JSON.stringify(items) }),
  },
  activity: {
    list: (limit = 25, offset = 0) => request<ActivityEntry[]>(`/api/activity?limit=${limit}&offset=${offset}`),
  },
  status: {
    get: () => request<StatusResponse>('/api/status'),
  },
  config: {
    getImap: () => request<ImapConfig>('/api/config/imap'),
    updateImap: (cfg: ImapConfig) => request<ImapConfig>('/api/config/imap', { method: 'PUT', body: JSON.stringify(cfg) }),
  },
};
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/web/frontend/api.ts
git commit -m "refactor: frontend api.ts imports types from shared module"
```

---

### Task 3: Update frontend app.ts imports

**Files:**
- Modify: `src/web/frontend/app.ts:2` (update import path)

**Step 1: Update the import**

The current import at line 2:
```typescript
import type { Rule, ActivityEntry, ImapConfig } from './api.js';
```

This should still work because `api.ts` re-exports these types. Verify the re-exports cover everything `app.ts` needs.

Check that `app.ts` references to `Rule.match.from` don't exist (they don't — the modal uses `rule?.match?.sender`). The `from` field was only in the dead type definition.

**Step 2: Verify the frontend build works**

Run: `npm run build:frontend`
Expected: builds without errors

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: PASS

**Step 4: Commit (if any changes needed)**

```bash
git add src/web/frontend/app.ts
git commit -m "chore: verify frontend app.ts works with shared types"
```

---

### Task 4: Update backend route files to use shared response types

**Files:**
- Modify: `src/web/routes/activity.ts` (import `ActivityEntry` from shared, use as return type annotation)
- Modify: `src/web/routes/status.ts` (import `StatusResponse` from shared)
- Modify: `src/web/routes/imap-config.ts` (import `ImapConfigResponse` from shared, use in `maskImapConfig`)

**Step 1: Update activity.ts**

Add import and type the return mapping:

```typescript
import type { ActivityEntry } from '../../shared/types.js';
```

Update the `.map()` return to satisfy `ActivityEntry`:

```typescript
const rows = deps.activityLog.getRecentActivity(limit, offset);
return rows.map((r): ActivityEntry => ({
  id: r.id,
  timestamp: r.timestamp,
  uid: r.message_uid,
  messageId: r.message_id,
  from: r.message_from,
  to: r.message_to,
  subject: r.message_subject,
  ruleId: r.rule_id,
  ruleName: r.rule_name,
  action: r.action,
  folder: r.folder,
  success: r.success,
  error: r.error,
}));
```

**Step 2: Update status.ts**

```typescript
import type { StatusResponse } from '../../shared/types.js';
```

```typescript
app.get('/api/status', async (): Promise<StatusResponse> => {
  const state = deps.monitor.getState();
  return {
    connectionStatus: state.connectionStatus,
    lastProcessedAt: state.lastProcessedAt?.toISOString() ?? null,
    messagesProcessed: state.messagesProcessed,
  };
});
```

**Step 3: Update imap-config.ts**

```typescript
import type { ImapConfigResponse } from '../../shared/types.js';
```

```typescript
function maskImapConfig(imap: { host: string; port: number; tls: boolean; auth: { user: string; pass: string }; idleTimeout: number; pollInterval: number }): ImapConfigResponse {
  return { ...imap, auth: { user: imap.auth.user, pass: PASSWORD_MASK } };
}
```

**Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 5: Run all tests**

Run: `npx vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add src/web/routes/activity.ts src/web/routes/status.ts src/web/routes/imap-config.ts
git commit -m "refactor: backend routes use shared response types"
```

---

### Task 5: Verify esbuild frontend bundle resolves the shared import

**Files:**
- Read: `esbuild.mjs` (check entrypoints and bundle config)

**Step 1: Check the esbuild config handles the `../../shared/types.js` import**

esbuild bundles everything from entrypoints, so a relative import from `frontend/api.ts` → `../../shared/types.ts` should resolve naturally as long as the path is correct. Since these are `import type` statements, they'll be erased at compile time and produce zero runtime code — esbuild handles this correctly.

**Step 2: Run the full build**

Run: `npm run build`
Expected: compiles backend (tsc) and frontend (esbuild) without errors

**Step 3: Run all tests one final time**

Run: `npx vitest run`
Expected: PASS

**Step 4: Commit (if any esbuild config changes needed)**

Only commit if you had to touch `esbuild.mjs`. If the build worked without changes, no commit needed.
