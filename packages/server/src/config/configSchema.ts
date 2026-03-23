// packages/server/src/config/configSchema.ts
// Zod schema + TypeScript types for the hot-reloadable config file.

import { z } from 'zod';
import { PROVIDER_IDS } from '@flightdeck/shared';

// ── Section schemas ────────────────────────────────────────

const serverSchema = z.object({
  maxConcurrentAgents: z.number().int().min(1).max(1000).default(50),
});

const heartbeatSchema = z.object({
  idleThresholdMs: z.number().int().min(10_000).max(600_000).default(60_000),
  crewUpdateIntervalMs: z.number().int().min(30_000).max(600_000).default(180_000),
  staleTimerCleanupDays: z.number().int().min(1).max(90).default(7),
});

const DEFAULT_KNOWN_MODELS = [
  'claude-opus-4.6', 'claude-sonnet-4.6', 'claude-sonnet-4.5', 'claude-haiku-4.5',
  'claude-opus-4.5', 'claude-sonnet-4',
  'gemini-3-pro-preview', 'gemini-3-flash-preview',
  'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
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

// ── Provider schema ────────────────────────────────────────

// Provider IDs derived from the central ProviderRegistry.
// Cast to tuple for Zod .enum() which requires a const tuple.
const VALID_PROVIDERS = PROVIDER_IDS as unknown as readonly [string, ...string[]];

// ── Cloud Provider schema (Bedrock / Vertex / Anthropic) ───

const bedrockSchema = z.object({
  type: z.literal('bedrock'),
  awsRegion: z.string().default('us-east-1'),
  awsProfile: z.string().optional(),
});

const vertexSchema = z.object({
  type: z.literal('vertex'),
  projectId: z.string(),
  region: z.string().default('us-central1'),
});

const anthropicSchema = z.object({
  type: z.literal('anthropic'),
  apiKey: z.string().optional(),
});

const cloudProviderSchema = z.discriminatedUnion('type', [
  bedrockSchema,
  vertexSchema,
  anthropicSchema,
]).optional();

export type CloudProvider = z.infer<typeof cloudProviderSchema>;

/**
 * Translate structured cloudProvider config into the environment variables
 * that the Claude Agent SDK expects. Returns empty object for anthropic
 * (default) since it uses ANTHROPIC_API_KEY from the environment.
 */
export function cloudProviderToEnv(cp: CloudProvider): Record<string, string> {
  if (!cp) return {};
  switch (cp.type) {
    case 'bedrock': {
      const env: Record<string, string> = {
        CLAUDE_CODE_USE_BEDROCK: '1',
        AWS_REGION: cp.awsRegion,
      };
      if (cp.awsProfile) env.AWS_PROFILE = cp.awsProfile;
      return env;
    }
    case 'vertex':
      return {
        CLAUDE_CODE_USE_VERTEX: '1',
        ANTHROPIC_VERTEX_PROJECT_ID: cp.projectId,
        CLOUD_ML_REGION: cp.region,
      };
    case 'anthropic': {
      const env: Record<string, string> = {};
      if (cp.apiKey) env.ANTHROPIC_API_KEY = cp.apiKey;
      return env;
    }
  }
}

const providerSchema = z.object({
  id: z.enum(VALID_PROVIDERS).default('copilot'),
  /** Override the preset's default binary path */
  binaryOverride: z.string().optional(),
  /** Override the preset's default spawn args */
  argsOverride: z.array(z.string()).optional(),
  /** Extra environment variables to pass to the CLI process */
  envOverride: z.record(z.string(), z.string()).optional(),
  /** Structured cloud provider config (Bedrock, Vertex, or Anthropic direct) */
  cloudProvider: cloudProviderSchema,
});

const telegramSchema = z.object({
  enabled: z.boolean().default(false),
  /** Bot token — prefer TELEGRAM_BOT_TOKEN env var over config file. */
  botToken: z.string().default(''),
  /** Chat IDs allowed to interact with the bot. Empty = allow all. */
  allowedChatIds: z.array(z.string()).default([]),
  /** Max inbound messages per minute per user. */
  rateLimitPerMinute: z.number().int().min(1).max(120).default(20),
});

// ── Oversight section (Trust Dial) ─────────────────────────
// Preprocess migrates old tier names (detailed/standard/minimal) to new names
const oversightSchema = z.preprocess(
  (val: unknown) => {
    const v = val as Record<string, unknown> | undefined;
    if (v?.level === 'detailed') v.level = 'supervised';
    if (v?.level === 'standard') v.level = 'balanced';
    if (v?.level === 'minimal') v.level = 'autonomous';
    return val;
  },
  z.object({
    level: z.enum(['supervised', 'balanced', 'autonomous']).default('autonomous'),
    customInstructions: z.string().max(500).optional(),
  }),
);

// ── Notifications section ──────────────────────────────────
const notificationChannelSchema = z.object({
  id: z.string(),
  type: z.string(),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).default({}),
  tiers: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
});

const notificationPreferenceSchema = z.object({
  event: z.string(),
  tier: z.string(),
  channels: z.array(z.string()).default([]),
});

const quietHoursSchema = z.object({
  enabled: z.boolean().default(false),
  start: z.string().default('22:00'),
  end: z.string().default('08:00'),
  timezone: z.string().default('America/New_York'),
});

const notificationsSchema = z.object({
  channels: z.array(notificationChannelSchema).default([]),
  preferences: z.array(notificationPreferenceSchema).default([]),
  quietHours: sectionDefault(quietHoursSchema),
});

// ── Predictions config section ─────────────────────────────
const predictionTypeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  thresholds: z.record(z.string(), z.number()).optional(),
});

const predictionsSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMs: z.number().int().min(10_000).max(3_600_000).default(300_000),
  types: z.record(z.string(), predictionTypeConfigSchema).default({}),
});

// ── Per-provider settings section ──────────────────────────
const providerSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  models: z.array(z.string()).default([]),
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
    provider: sectionDefault(providerSchema),
    oversight: sectionDefault(oversightSchema),
    telegram: sectionDefault(telegramSchema),
    notifications: sectionDefault(notificationsSchema),
    predictions: sectionDefault(predictionsSchema),
    providerSettings: z.preprocess((val) => val ?? {}, z.record(z.string(), providerSettingsSchema)),
    /** Ordered provider preference list — first = most preferred */
    providerRanking: z.preprocess((val) => val ?? [], z.array(z.string())).default([]),
  }),
);

export type FlightdeckConfig = z.infer<typeof flightdeckConfigSchema>;

export { DEFAULT_KNOWN_MODELS, VALID_PROVIDERS };

/** Returns a config with all defaults filled in (equivalent to empty file). */
export function getDefaultConfig(): FlightdeckConfig {
  return flightdeckConfigSchema.parse({});
}
