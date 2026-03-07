/**
 * Unified adapter factory for multi-backend support.
 *
 * Single entry point for creating agent adapters. Resolves the correct
 * adapter type (AcpAdapter or ClaudeSdkAdapter) based on provider config,
 * SDK mode preference, and graceful fallback when SDK is unavailable.
 *
 * Decision logic:
 *   provider='claude' AND sdkMode=true → ClaudeSdkAdapter (in-process)
 *   provider='claude' AND sdkMode=false → AcpAdapter with Claude preset (subprocess)
 *   all other providers → AcpAdapter with provider preset (subprocess)
 */
import { AcpAdapter } from './AcpAdapter.js';
import { ClaudeSdkAdapter } from './ClaudeSdkAdapter.js';
import { MockAdapter } from './MockAdapter.js';
import { getPreset } from './presets.js';
import { resolveModel } from './ModelResolver.js';
import type { ProviderId } from './presets.js';
import type {
  AgentAdapter,
  AdapterStartOptions,
} from './types.js';
import { logger } from '../utils/logger.js';

// ── Factory Config ──────────────────────────────────────────

/** Configuration for creating an adapter. Combines provider + agent-level settings. */
export interface AdapterConfig {
  /** Provider ID (e.g., 'copilot', 'claude', 'gemini') */
  provider: string;
  /** Use the in-process SDK instead of ACP subprocess (Claude only) */
  sdkMode?: boolean;
  /** Run in autopilot mode (auto-approve tool calls) */
  autopilot?: boolean;
  /** Model name or tier alias */
  model?: string;

  // ── ACP-specific fields (subprocess adapters) ──
  /** Override the preset binary path */
  binaryOverride?: string;
  /** Override the preset args */
  argsOverride?: string[];
  /** Extra environment variables for CLI process */
  envOverride?: Record<string, string>;
  /** Base CLI args from server config */
  cliArgs?: string[];
  /** Default CLI command from server config */
  cliCommand?: string;
}

/** Result of adapter creation with metadata about which backend was chosen. */
export interface AdapterResult {
  adapter: AgentAdapter;
  /** The backend type that was actually used */
  backend: 'acp' | 'claude-sdk' | 'mock';
  /** If the preferred backend was unavailable and we fell back */
  fallback: boolean;
  /** Human-readable reason for fallback (if any) */
  fallbackReason?: string;
}

// ── Backend Resolution ──────────────────────────────────────

export type BackendType = 'acp' | 'claude-sdk' | 'mock';

/**
 * Determine which backend to use based on provider and config.
 * Pure function — no side effects, safe to call for inspection.
 */
export function resolveBackend(provider: string, sdkMode?: boolean): BackendType {
  if (provider === 'mock') return 'mock';
  if (provider === 'claude' && sdkMode) return 'claude-sdk';
  return 'acp';
}

// ── Start Options Builder ───────────────────────────────────

/**
 * Build AdapterStartOptions from provider config + agent-level params.
 * Encapsulates preset resolution, model resolution, env merging,
 * and config override application.
 */
export function buildStartOptions(
  config: AdapterConfig,
  agentOpts: {
    cwd?: string;
    sessionId?: string;
    agentFlag?: string;
    maxTurns?: number;
    systemPrompt?: string;
  },
): AdapterStartOptions {
  const providerId = (config.provider || 'copilot') as ProviderId;
  const preset = getPreset(providerId);

  // Resolve model through cross-CLI model resolver
  const resolution = config.model ? resolveModel(config.model, providerId) : undefined;

  if (resolution?.translated && resolution.reason) {
    logger.info({
      module: 'adapter-factory',
      msg: `Model resolved: ${resolution.reason}`,
    });
  }

  // Apply config overrides (binaryOverride, argsOverride, envOverride)
  const binary = config.binaryOverride || preset?.binary || config.cliCommand || 'copilot';
  const baseArgs = config.argsOverride || preset?.args;

  // Merge env: config overrides take precedence, filter out empty/falsy values
  const rawEnv = { ...preset?.env, ...config.envOverride };
  const env = Object.fromEntries(
    Object.entries(rawEnv).filter(([, v]) => v),
  );

  const cliArgs = [
    ...(config.cliArgs ?? []),
    ...(agentOpts.agentFlag ? [`--agent=${agentOpts.agentFlag}`] : []),
    ...(resolution ? ['--model', resolution.model] : []),
    ...(agentOpts.sessionId ? ['--resume', agentOpts.sessionId] : []),
  ];

  return {
    cliCommand: binary,
    baseArgs,
    cliArgs,
    cwd: agentOpts.cwd ?? process.cwd(),
    env: Object.keys(env).length > 0 ? env : undefined,
    sessionId: agentOpts.sessionId,
    model: resolution?.model,
    maxTurns: agentOpts.maxTurns,
    systemPrompt: agentOpts.systemPrompt,
  };
}

// ── Factory Function ────────────────────────────────────────

/**
 * Create an adapter for the given provider configuration.
 *
 * This is the single entry point for adapter creation. It handles:
 * - Backend resolution (ACP vs Claude SDK vs Mock)
 * - Graceful fallback when SDK is unavailable
 * - Logging of backend decisions
 */
export function createAdapterForProvider(config: AdapterConfig): AdapterResult {
  const preferredBackend = resolveBackend(config.provider, config.sdkMode);

  if (preferredBackend === 'mock') {
    return { adapter: new MockAdapter(), backend: 'mock', fallback: false };
  }

  if (preferredBackend === 'claude-sdk') {
    try {
      const adapter = new ClaudeSdkAdapter({
        autopilot: config.autopilot,
        model: config.model,
      });
      logger.info({
        module: 'adapter-factory',
        msg: 'Created ClaudeSdkAdapter (in-process SDK mode)',
        provider: config.provider,
      });
      return { adapter, backend: 'claude-sdk', fallback: false };
    } catch (err) {
      // SDK construction failed — fall back to ACP
      const reason = `Claude SDK unavailable: ${(err as Error)?.message || String(err)}`;
      logger.warn({
        module: 'adapter-factory',
        msg: `SDK fallback: ${reason}. Using ACP adapter instead.`,
        provider: config.provider,
      });
      const adapter = new AcpAdapter({ autopilot: config.autopilot });
      return { adapter, backend: 'acp', fallback: true, fallbackReason: reason };
    }
  }

  // Default: ACP adapter for all subprocess-based CLIs
  const adapter = new AcpAdapter({ autopilot: config.autopilot });
  return { adapter, backend: 'acp', fallback: false };
}
