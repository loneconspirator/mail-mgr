import type { ImapClient } from '../imap/index.js';
import type { SentinelStore, Sentinel } from './store.js';
import { findSentinel } from './imap-ops.js';
import type pino from 'pino';

// ── Types ─────────────────────────────────────────────────────────────────

export type ScanStatus = 'found-in-place' | 'found-in-different-folder' | 'not-found';

export interface ScanResultBase {
  messageId: string;
  expectedFolder: string;
  folderPurpose: string;
}

export interface FoundInPlace extends ScanResultBase {
  status: 'found-in-place';
}

export interface FoundInDifferentFolder extends ScanResultBase {
  status: 'found-in-different-folder';
  actualFolder: string;
}

export interface NotFound extends ScanResultBase {
  status: 'not-found';
}

export type ScanResult = FoundInPlace | FoundInDifferentFolder | NotFound;

export interface ScanReport {
  scannedAt: string;
  results: ScanResult[];
  deepScansTriggered: number;
  errors: number;
}

export interface SentinelScannerDeps {
  client: ImapClient;
  sentinelStore: SentinelStore;
  scanIntervalMs: number;
  enabled: boolean;
  logger?: pino.Logger;
  onScanComplete?: (report: ScanReport) => void;
}

export interface SentinelScannerState {
  enabled: boolean;
  lastScanAt: string | null;
  lastReport: ScanReport | null;
}

// ── Scanner ───────────────────────────────────────────────────────────────

export class SentinelScanner {
  private deps: SentinelScannerDeps;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastScanAt: string | null = null;
  private lastReport: ScanReport | null = null;

  constructor(deps: SentinelScannerDeps) {
    this.deps = deps;
  }

  /** Start the scan loop. Does nothing if enabled=false. */
  start(): void {
    if (!this.deps.enabled) {
      return;
    }

    this.stop();

    // Fire-and-forget initial scan
    this.runScan().catch((err) => {
      this.deps.logger?.error({ err }, 'SentinelScanner initial scan failed');
    });

    this.scanTimer = setInterval(() => {
      this.runScan().catch((err) => {
        this.deps.logger?.error({ err }, 'SentinelScanner scan failed');
      });
    }, this.deps.scanIntervalMs);
  }

  /** Stop the scan timer. */
  stop(): void {
    if (this.scanTimer !== null) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  /** Return current scanner state. */
  getState(): SentinelScannerState {
    return {
      enabled: this.deps.enabled,
      lastScanAt: this.lastScanAt,
      lastReport: this.lastReport,
    };
  }

  /** Exposed for testing — runs a single scan cycle and returns the report. */
  async runScanForTest(): Promise<ScanReport> {
    return this.runScan();
  }

  /** Main scan: check each sentinel via fast-path, then deep scan on miss. */
  private async runScan(): Promise<ScanReport> {
    if (this.running || this.deps.client.state !== 'connected') {
      return { scannedAt: new Date().toISOString(), results: [], deepScansTriggered: 0, errors: 0 };
    }

    this.running = true;
    try {
      const sentinels = this.deps.sentinelStore.getAll();
      const results: ScanResult[] = [];
      let deepScansTriggered = 0;
      let errors = 0;

      // Get all folders once (for deep scans)
      let allFolderPaths: string[] | null = null;

      for (const sentinel of sentinels) {
        // Fast path: check expected folder
        const fastUid = await findSentinel(
          this.deps.client,
          sentinel.folderPath,
          sentinel.messageId,
        );

        if (fastUid !== undefined) {
          results.push({
            status: 'found-in-place',
            messageId: sentinel.messageId,
            expectedFolder: sentinel.folderPath,
            folderPurpose: sentinel.folderPurpose,
          });
          continue;
        }

        // Deep scan: sentinel not in expected folder
        deepScansTriggered++;

        // Lazy-load folder list
        if (allFolderPaths === null) {
          const mailboxes = await this.deps.client.listMailboxes();
          allFolderPaths = mailboxes
            .map((mb) => mb.path)
            .filter((p) => p.toUpperCase() !== 'INBOX');
        }

        const deepResult = await this.scanDeep(
          sentinel,
          allFolderPaths,
        );
        results.push(deepResult.result);
        errors += deepResult.errors;
      }

      const report: ScanReport = {
        scannedAt: new Date().toISOString(),
        results,
        deepScansTriggered,
        errors,
      };

      this.lastScanAt = report.scannedAt;
      this.lastReport = report;

      if (this.deps.onScanComplete) {
        this.deps.onScanComplete(report);
      }

      return report;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'NoConnection' || code === 'ETIMEOUT') {
        this.deps.logger?.debug({ err }, 'SentinelScanner scan skipped (transient IMAP error)');
        return { scannedAt: new Date().toISOString(), results: [], deepScansTriggered: 0, errors: 0 };
      }
      throw err;
    } finally {
      this.running = false;
    }
  }

  /** Deep scan: search all folders (except expected + INBOX) for a sentinel. */
  private async scanDeep(
    sentinel: Sentinel,
    allFolderPaths: string[],
  ): Promise<{ result: ScanResult; errors: number }> {
    let errors = 0;
    const base: ScanResultBase = {
      messageId: sentinel.messageId,
      expectedFolder: sentinel.folderPath,
      folderPurpose: sentinel.folderPurpose,
    };

    for (const folder of allFolderPaths) {
      // Skip expected folder (already checked in fast path)
      if (folder === sentinel.folderPath) {
        continue;
      }

      try {
        const uid = await findSentinel(this.deps.client, folder, sentinel.messageId);
        if (uid !== undefined) {
          // Short-circuit: found it
          return {
            result: { ...base, status: 'found-in-different-folder', actualFolder: folder },
            errors,
          };
        }
      } catch (err) {
        errors++;
        this.deps.logger?.debug({ err, folder }, 'Error scanning folder during deep scan');
      }
    }

    return {
      result: { ...base, status: 'not-found' },
      errors,
    };
  }
}
