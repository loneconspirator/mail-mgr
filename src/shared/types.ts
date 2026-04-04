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
