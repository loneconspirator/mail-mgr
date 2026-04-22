import { z } from 'zod';

// --- Action schemas (discriminated union, extensible for Tier 3) ---

export const moveActionSchema = z.object({
  type: z.literal('move'),
  folder: z.string().min(1),
});

export const reviewActionSchema = z.object({
  type: z.literal('review'),
  folder: z.string().min(1).optional(),
});

export const skipActionSchema = z.object({
  type: z.literal('skip'),
});

export const deleteActionSchema = z.object({
  type: z.literal('delete'),
});

export const actionSchema = z.discriminatedUnion('type', [
  moveActionSchema,
  reviewActionSchema,
  skipActionSchema,
  deleteActionSchema,
]);

// --- Email match schema (at least one field required) ---

export const visibilityMatchEnum = z.enum(['direct', 'cc', 'bcc', 'list']);
export const readStatusMatchEnum = z.enum(['read', 'unread', 'any']);

export const emailMatchSchema = z
  .object({
    sender: z.string().optional(),
    recipient: z.string().optional(),
    subject: z.string().optional(),
    deliveredTo: z.string().optional(),
    visibility: visibilityMatchEnum.optional(),
    readStatus: readStatusMatchEnum.optional(),
  })
  .refine(
    (m) =>
      m.sender !== undefined ||
      m.recipient !== undefined ||
      m.subject !== undefined ||
      m.deliveredTo !== undefined ||
      m.visibility !== undefined ||
      m.readStatus !== undefined,
    { message: 'At least one match field is required' },
  );

// --- Rule schema ---

export const ruleSchema = z.object({
  id: z.string().min(1),
  // name is OPTIONAL — users create rules without names via config.yml and the UI.
  // Do NOT add .min(1) or make this required. This has regressed 3 times.
  name: z.string().optional(),
  match: emailMatchSchema,
  action: actionSchema,
  enabled: z.boolean().default(true),
  order: z.number().int().min(0),
});

// --- IMAP config schema ---

export const imapAuthSchema = z.object({
  user: z.string().min(1),
  pass: z.string().min(1),
});

export const imapConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().default(993),
  tls: z.boolean().default(true),
  auth: imapAuthSchema,
  idleTimeout: z.number().int().positive().default(300_000),
  pollInterval: z.number().int().positive().default(60_000),
  envelopeHeader: z.string().optional(),
});

// --- Server config schema ---

export const serverConfigSchema = z.object({
  port: z.number().int().positive().default(3000),
  host: z.string().min(1).default('0.0.0.0'),
});

// --- Sweep config schema ---

const sweepDefaults = { intervalHours: 6, readMaxAgeDays: 7, unreadMaxAgeDays: 14 } as const;

export const sweepConfigSchema = z.object({
  intervalHours: z.number().int().positive().default(sweepDefaults.intervalHours),
  readMaxAgeDays: z.number().int().positive().default(sweepDefaults.readMaxAgeDays),
  unreadMaxAgeDays: z.number().int().positive().default(sweepDefaults.unreadMaxAgeDays),
});

// --- Move tracking config schema ---

const moveTrackingDefaults = { enabled: true, scanInterval: 30 } as const;

export const moveTrackingConfigSchema = z.object({
  enabled: z.boolean().default(true),
  scanInterval: z.number().int().positive().default(30),
});

// --- Review config schema ---

const reviewDefaults = {
  folder: 'Review',
  defaultArchiveFolder: 'MailingLists',
  trashFolder: 'Trash',
  sweep: sweepDefaults,
  moveTracking: moveTrackingDefaults,
} as const;

export const reviewConfigSchema = z.object({
  folder: z.string().min(1).default(reviewDefaults.folder),
  defaultArchiveFolder: z.string().min(1).default(reviewDefaults.defaultArchiveFolder),
  trashFolder: z.string().min(1).default(reviewDefaults.trashFolder),
  sweep: sweepConfigSchema.default(sweepDefaults),
  moveTracking: moveTrackingConfigSchema.default(moveTrackingDefaults),
});

// --- Action folder config schema ---

const actionFolderDefaults = {
  enabled: true,
  prefix: 'Actions',
  pollInterval: 15,
  folders: {
    vip: '\u2B50 VIP Sender',
    block: '\uD83D\uDEAB Block Sender',
    undoVip: '\u21A9\uFE0F Undo VIP',
    unblock: '\u2705 Unblock Sender',
  },
} as const;

export const actionFolderConfigSchema = z.object({
  enabled: z.boolean().default(true),
  prefix: z.string().min(1).default('Actions'),
  pollInterval: z.number().int().positive().default(15),
  folders: z.object({
    vip: z.string().min(1).default('\u2B50 VIP Sender'),
    block: z.string().min(1).default('\uD83D\uDEAB Block Sender'),
    undoVip: z.string().min(1).default('\u21A9\uFE0F Undo VIP'),
    unblock: z.string().min(1).default('\u2705 Unblock Sender'),
  }).default(actionFolderDefaults.folders),
});

// --- Sentinel config schema ---

const sentinelDefaults = { scanIntervalMs: 300_000 } as const;

export const sentinelConfigSchema = z.object({
  scanIntervalMs: z.number().int().positive().default(300_000),
});

// --- Full config schema ---

export const configSchema = z.object({
  imap: imapConfigSchema,
  server: serverConfigSchema,
  rules: z.array(ruleSchema).default([]),
  review: reviewConfigSchema.default(reviewDefaults),
  actionFolders: actionFolderConfigSchema.default(actionFolderDefaults),
  sentinel: sentinelConfigSchema.default(sentinelDefaults),
});

// --- Inferred types ---

export type MoveAction = z.infer<typeof moveActionSchema>;
export type ReviewAction = z.infer<typeof reviewActionSchema>;
export type SkipAction = z.infer<typeof skipActionSchema>;
export type DeleteAction = z.infer<typeof deleteActionSchema>;
export type Action = z.infer<typeof actionSchema>;
export type SweepConfig = z.infer<typeof sweepConfigSchema>;
export type ReviewConfig = z.infer<typeof reviewConfigSchema>;
export type EmailMatch = z.infer<typeof emailMatchSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type ImapAuth = z.infer<typeof imapAuthSchema>;
export type ImapConfig = z.infer<typeof imapConfigSchema>;
export type ServerConfig = z.infer<typeof serverConfigSchema>;
export type Config = z.infer<typeof configSchema>;
export type ActionFolderConfig = z.infer<typeof actionFolderConfigSchema>;
export type MoveTrackingConfig = z.infer<typeof moveTrackingConfigSchema>;
export type SentinelConfig = z.infer<typeof sentinelConfigSchema>;
export type VisibilityMatch = z.infer<typeof visibilityMatchEnum>;
export type ReadStatusMatch = z.infer<typeof readStatusMatchEnum>;
