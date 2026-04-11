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

export const emailMatchSchema = z
  .object({
    sender: z.string().optional(),
    recipient: z.string().optional(),
    subject: z.string().optional(),
  })
  .refine(
    (m) => m.sender !== undefined || m.recipient !== undefined || m.subject !== undefined,
    { message: 'At least one match field (sender, recipient, or subject) is required' },
  );

// --- Rule schema ---

export const ruleSchema = z.object({
  id: z.string().min(1),
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

// --- Review config schema ---

const reviewDefaults = {
  folder: 'Review',
  defaultArchiveFolder: 'MailingLists',
  trashFolder: 'Trash',
  sweep: sweepDefaults,
} as const;

export const reviewConfigSchema = z.object({
  folder: z.string().min(1).default(reviewDefaults.folder),
  defaultArchiveFolder: z.string().min(1).default(reviewDefaults.defaultArchiveFolder),
  trashFolder: z.string().min(1).default(reviewDefaults.trashFolder),
  sweep: sweepConfigSchema.default(sweepDefaults),
});

// --- Full config schema ---

export const configSchema = z.object({
  imap: imapConfigSchema,
  server: serverConfigSchema,
  rules: z.array(ruleSchema).default([]),
  review: reviewConfigSchema.default(reviewDefaults),
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
