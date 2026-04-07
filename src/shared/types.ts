// Canonical API types shared between backend routes and frontend.
// Derived from Zod schemas where possible; hand-written only for
// API-layer shapes that don't exist in config (e.g. masked IMAP, activity rows).

export type {
  Rule,
  Action,
  MoveAction,
  ReviewAction,
  SkipAction,
  DeleteAction,
  EmailMatch,
  ImapConfig,
  ReviewConfig,
  SweepConfig,
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
  messageId: string | null;
  from: string | null;
  to: string | null;
  subject: string | null;
  ruleId: string | null;
  ruleName: string | null;
  action: string;
  folder: string | null;
  source: string;
  success: number;
  error: string | null;
}

// GET /api/review/status response
export interface ReviewStatusResponse {
  folder: string;
  totalMessages: number;
  unreadMessages: number;
  readMessages: number;
  nextSweepAt: string | null;
  lastSweep: {
    completedAt: string;
    messagesArchived: number;
    errors: number;
  } | null;
}

// GET /api/status response
export interface StatusResponse {
  connectionStatus: string;
  lastProcessedAt: string | null;
  messagesProcessed: number;
}

// IMAP folder hierarchy node (converted from imapflow ListTreeResponse)
export interface FolderNode {
  path: string;
  name: string;
  delimiter: string;
  flags: string[];
  specialUse?: string;
  disabled?: boolean;
  children: FolderNode[];
}

// GET /api/folders response
export interface FolderTreeResponse {
  folders: FolderNode[];
  cachedAt: string;
  stale: boolean;
}
