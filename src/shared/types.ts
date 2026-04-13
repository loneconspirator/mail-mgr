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

// GET /api/config/envelope response
export interface EnvelopeStatus {
  envelopeHeader: string | null;
}

// GET /api/status response
export interface StatusResponse {
  connectionStatus: string;
  lastProcessedAt: string | null;
  messagesProcessed: number;
}

// GET /api/tracking/status response
export interface MoveTrackerStatusResponse {
  enabled: boolean;
  lastScanAt: string | null;
  messagesTracked: number;
  signalsLogged: number;
  pendingDeepScan: number;
}

// POST /api/tracking/deep-scan response
export interface DeepScanResponse {
  resolved: number;
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

// Batch filing types
export interface DryRunMessage {
  uid: number;
  from: string;
  subject: string;
  date: string;
  ruleName: string;
}

export interface DryRunGroup {
  destination: string;
  action: string;
  count: number;
  messages: DryRunMessage[];
}

export type BatchStatus = 'idle' | 'dry-running' | 'previewing' | 'executing' | 'completed' | 'cancelled' | 'error';

export interface BatchStatusResponse {
  status: BatchStatus;
  sourceFolder: string | null;
  totalMessages: number;
  processed: number;
  moved: number;
  skipped: number;
  errors: number;
  cancelled: boolean;
  dryRunResults: DryRunGroup[] | null;
  completedAt: string | null;
}

export interface DryRunResponse {
  results: DryRunGroup[];
}

// Proposed rule from pattern detection (Phase 11)
export interface ProposedRule {
  id: number;
  sender: string;
  envelopeRecipient: string | null;
  sourceFolder: string;
  destinationFolder: string;
  matchingCount: number;
  contradictingCount: number;
  destinationCounts: Record<string, number>;
  status: 'active' | 'approved' | 'dismissed';
  dismissedAt: string | null;
  signalsSinceDismiss: number;
  approvedRuleId: string | null;
  createdAt: string;
  updatedAt: string;
  lastSignalAt: string;
  // Computed
  strength: number;
}

export interface ProposalKey {
  sender: string;
  envelopeRecipient: string | null;
  sourceFolder: string;
}

export interface ExampleMessage {
  subject: string;
  date: string;
  destinationFolder: string;
}

export interface ProposedRuleCard extends ProposedRule {
  strengthLabel: string;
  examples: ExampleMessage[];
  conflictAnnotation: string | null;
  resurfacedNotice: string | null;
}
