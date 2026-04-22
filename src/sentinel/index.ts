export { buildSentinelMessage, purposeBody } from './format.js';
export type { SentinelMessage, BuildSentinelOpts, FolderPurpose } from './format.js';
export { SentinelStore } from './store.js';
export type { Sentinel, SentinelRow } from './store.js';
export { appendSentinel, findSentinel, deleteSentinel, runSentinelSelfTest } from './imap-ops.js';
export type { AppendSentinelResult } from './imap-ops.js';
export { collectTrackedFolders, reconcileSentinels } from './lifecycle.js';
