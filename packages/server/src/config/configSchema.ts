// packages/server/src/config/configSchema.ts
// Zod schema + TypeScript types for the hot-reloadable config file.

import { z } from 'zod';

// ── Section schemas ────────────────────────────────────────

const serverSchema = z.object({
  maxConcurrentAgents: z.number().int().min(1).max(200).default(50),
});

const heartbeatSchema = z.object({
  idleThresholdMs: z.number().int().min(10_000).max(600_000).default(60_000),
  crewUpdateIntervalMs: z.number().int().min(30_000).max(600_000).default(180_000),
  staleTimerCleanupDays: z.number().int().min(1).max(90).default(7),
});

const DEFAULT_KNOWN_MODELS = [
  'claude-opus-4.6', 'claude-sonnet-4.6', 'claude-sonnet-4.5', 'claude-haiku-4.5',
  'claude-opus-4.5', 'claude-sonnet-4',
  'gemini-3-pro-preview',
  'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2',
  'gpt-5.1-codex-max', 'gpt-5.1-codex', 'gpt-5.1', 'gpt-5.1-codex-mini',
  'gpt-5-mini', 'gpt-4.1',
] as const;

const modelsSchema = z.object({
  known: z.array(z.string()).min(1).default([...DEFAULT_KNOWN_MODELS]),
  defaults: z.record(z.string(), z.array(z.string()).min(1)).default({}),
});

const roleOverrideSchema = z.object({
  model: z.string().optional(),
}).passthrough();

const budgetThresholdsSchema = z.object({
  warning: z.number().min(0).max(1).default(0.7),
  critical: z.number().min(0).max(1).default(0.9),
  pause: z.number().min(0).max(1).default(1.0),
});

const budgetSchema = z.object({
  limit: z.number().nullable().default(null),
  thresholds: budgetThresholdsSchema.optional(),
});

// ── Top-level config ───────────────────────────────────────
// Use z.preprocess to coerce undefined sections to {} before validation,
// so that each section's field-level .default() values are applied.

function sectionDefault<T extends z.ZodType>(schema: T) {
  return z.preprocess((val) => val ?? {}, schema);
}

export const flightdeckConfigSchema = z.preprocess(
  (val) => val ?? {},
  z.object({
    server: sectionDefault(serverSchema),
    heartbeat: sectionDefault(heartbeatSchema),
    models: sectionDefault(modelsSchema),
    roles: z.preprocess((val) => val ?? {}, z.record(z.string(), roleOverrideSchema)),
    budget: sectionDefault(budgetSchema),
  }),
);

export type FlightdeckConfig = z.infer<typeof flightdeckConfigSchema>;

export { DEFAULT_KNOWN_MODELS };

/** Returns a config with all defaults filled in (equivalent to empty file). */
export function getDefaultConfig(): FlightdeckConfig {
  return flightdeckConfigSchema.parse({});
}
