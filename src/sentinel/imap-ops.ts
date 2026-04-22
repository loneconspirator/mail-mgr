import type { ImapClient } from '../imap/index.js';
import type { SentinelStore } from './store.js';
import type { FolderPurpose } from './format.js';
import { buildSentinelMessage } from './format.js';

export interface AppendSentinelResult {
  messageId: string;
  uid: number | undefined;
}

interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
}

/**
 * Build and APPEND a sentinel message to the given folder.
 * Optionally records the sentinel in the local store.
 */
export async function appendSentinel(
  client: ImapClient,
  folder: string,
  purpose: FolderPurpose,
  store?: SentinelStore,
): Promise<AppendSentinelResult> {
  const msg = buildSentinelMessage({ folderPath: folder, folderPurpose: purpose });
  const result = await client.appendMessage(folder, msg.raw, msg.flags);
  if (store) {
    store.upsert(msg.messageId, folder, purpose);
  }
  return { messageId: msg.messageId, uid: result.uid };
}

/**
 * Search for a sentinel in a folder by its X-Mail-Mgr-Sentinel header value.
 * Returns the first matching UID or undefined if not found.
 */
export async function findSentinel(
  client: ImapClient,
  folder: string,
  messageId: string,
): Promise<number | undefined> {
  const uids = await client.searchByHeader(folder, 'X-Mail-Mgr-Sentinel', messageId);
  return uids.length > 0 ? uids[0] : undefined;
}

/**
 * Delete a sentinel message by UID. Optionally removes it from the local store.
 */
export async function deleteSentinel(
  client: ImapClient,
  folder: string,
  uid: number,
  store?: SentinelStore,
  messageId?: string,
): Promise<boolean> {
  const result = await client.deleteMessage(folder, uid);
  if (store && messageId) {
    store.deleteByMessageId(messageId);
  }
  return result;
}

/**
 * Perform a full APPEND -> SEARCH -> DELETE round-trip to verify that the
 * IMAP server supports SEARCH HEADER for sentinel detection.
 *
 * Returns true if the round-trip succeeds, false otherwise.
 * Never throws — failures are logged as warnings and the sentinel system
 * should be gracefully disabled by the caller.
 */
export async function runSentinelSelfTest(
  client: ImapClient,
  testFolder: string,
  logger: Logger,
): Promise<boolean> {
  let appendedUid: number | undefined;
  let appendedMessageId: string | undefined;
  let searchPassed = false;

  try {
    // Step 1: APPEND a test sentinel
    const appendResult = await appendSentinel(client, testFolder, 'rule-target');
    appendedUid = appendResult.uid;
    appendedMessageId = appendResult.messageId;

    // Step 2: SEARCH for it by header
    const foundUid = await findSentinel(client, testFolder, appendResult.messageId);

    if (foundUid !== undefined) {
      searchPassed = true;
      logger.info('Sentinel self-test passed: SEARCH HEADER supported');
    } else {
      logger.warn('Sentinel self-test failed: SEARCH HEADER did not find the test sentinel');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Sentinel self-test failed: ${msg}`);
  } finally {
    // Step 3: Clean up — best effort
    if (appendedUid !== undefined) {
      try {
        await deleteSentinel(client, testFolder, appendedUid);
      } catch {
        // Best-effort cleanup — ignore delete failures
      }
    } else if (appendedMessageId) {
      // No UIDPLUS — try to find the UID via search for cleanup
      try {
        const uid = await findSentinel(client, testFolder, appendedMessageId);
        if (uid !== undefined) {
          await deleteSentinel(client, testFolder, uid);
        }
      } catch {
        // Best-effort cleanup — ignore failures
      }
    }
  }

  return searchPassed;
}
