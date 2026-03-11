/**
 * Unified adapter factory for multi-backend support.
 *
 * Single entry point for creating agent adapters. All providers use the
 * AcpAdapter (subprocess via ACP stdio protocol).
 *
 * Decision logic:
 *   provider='mock' → MockAdapter
 *   all other providers → AcpAdapter with provider preset (subprocess)
 *
 * Session resume is handled via ACP protocol's session/load RPC.
 */
import { getPreset } from './presets.js';
import { resolveModel } from './ModelResolver.js';
import { cloudProviderToEnv } from '../config/configSchema.js';
import type { CloudProvider } from '../config/configSchema.js';
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
  /** Model name or tier alias */
  model?: string;

  // ── ACP-specific fields (subprocess adapters) ──
  /** Override the preset binary path */
  binaryOverride?: string;
  /** Override the preset args */
  argsOverride?: string[];
  /** Extra environment variables for CLI process */
  envOverride?: Record<string, string>;
  /** Structured cloud provider config (Bedrock, Vertex, Anthropic) — translated to env vars */
  cloudProvider?: CloudProvider;
  /** Base CLI args from server config */
  cliArgs?: string[];
  /** Default CLI command from server config */
  cliCommand?: string;
}

/** Result of adapter creation with metadata about which backend was chosen. */
export interface AdapterResult {
  adapter: AgentAdapter;
  /** The backend type that was actually used */
  backend: BackendType;
  /** If the preferred backend was unavailable and we fell back */
  fallback: boolean;
  /** Human-readable reason for fallback (if any) */
  fallbackReason?: string;
}

// ── Backend Resolution ──────────────────────────────────────

export type BackendType = 'acp' | 'mock';

/**
 * Determine which backend to use based on provider.
 * All providers use ACP (subprocess) by default.
 */
export function resolveBackend(provider: string): BackendType {
  if (provider === 'mock') return 'mock';
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

  // Merge env: cloudProvider → preset → explicit envOverride (last wins)
  const cloudEnv = cloudProviderToEnv(config.cloudProvider);
  const rawEnv = { ...cloudEnv, ...preset?.env, ...config.envOverride };

  // Gemini: deliver system prompt via GEMINI_WRITE_SYSTEM_MD env var
  if (providerId === 'gemini' && agentOpts.systemPrompt) {
    rawEnv['GEMINI_WRITE_SYSTEM_MD'] = agentOpts.systemPrompt;
  }

  const env = Object.fromEntries(
    Object.entries(rawEnv).filter(([, v]) => v),
  );

  // NOTE: Session resume is handled via the ACP protocol's session/load RPC
  // (opts.sessionId below). All providers now use AcpAdapter.
  const cliArgs = [
    ...(config.cliArgs ?? []),
    ...(agentOpts.agentFlag ? [`--agent=${agentOpts.agentFlag}`] : []),
    ...(resolution ? ['--model', resolution.model] : []),
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
    provider: providerId,
  };
}

// ── Factory Function ────────────────────────────────────────

/**
 * Create an adapter for the given provider configuration.
 *
 * This is the single entry point for adapter creation. All providers
 * use AcpAdapter (subprocess via ACP stdio protocol).
 */
export async function createAdapterForProvider(config: AdapterConfig): Promise<AdapterResult> {
  const preferredBackend = resolveBackend(config.provider);

  if (preferredBackend === 'mock') {
    const { MockAdapter } = await import('./MockAdapter.js');
    return { adapter: new MockAdapter(), backend: 'mock', fallback: false };
  }

  // Default: ACP adapter for all subprocess-based CLIs
  const { AcpAdapter } = await import('./AcpAdapter.js');
  const adapter = new AcpAdapter();
  return { adapter, backend: 'acp', fallback: false };
}
