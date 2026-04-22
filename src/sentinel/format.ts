// STUB: replaced by Plan 01
// Minimal type exports so that src/sentinel/index.ts compiles.
// Plan 26-01 will replace this file with the real implementation.

export type FolderPurpose = 'action' | 'review' | 'archive' | 'sweep';

export interface SentinelMessage {
  messageId: string;
  from: string;
  subject: string;
  body: string;
  headers: Record<string, string>;
}

export interface BuildSentinelOpts {
  folderPath: string;
  folderPurpose: FolderPurpose;
}

// STUB: replaced by Plan 01
export function buildSentinelMessage(_opts: BuildSentinelOpts): SentinelMessage {
  throw new Error('STUB: buildSentinelMessage not yet implemented (see Plan 26-01)');
}

// STUB: replaced by Plan 01
export function purposeBody(_purpose: FolderPurpose): string {
  throw new Error('STUB: purposeBody not yet implemented (see Plan 26-01)');
}
