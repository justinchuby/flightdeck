/**
 * Cross-CLI Model Resolver.
 *
 * Resolves model specifications (tier aliases or exact model names) to the
 * correct model name for a given CLI provider. Handles cross-provider
 * equivalence mapping when a model isn't natively available on the target CLI.
 *
 * Resolution order:
 * 1. Tier alias ('fast', 'standard', 'premium') → provider-specific model
 * 2. Native model on target CLI → passthrough (with alias/prefix for Claude/OpenCode)
 * 3. Cross-provider equivalence → mapped equivalent + log
 * 4. Fallback → provider's standard-tier default + warn
 */
import { logger } from '../utils/logger.js';
import type { ProviderId } from './presets.js';

// ── Types ───────────────────────────────────────────────────

export type ModelTier = 'fast' | 'standard' | 'premium';

export interface ModelResolution {
  /** The resolved model name to pass to the CLI */
  model: string;
  /** Whether the model was translated (not a passthrough) */
  translated: boolean;
  /** Original model name before resolution */
  original: string;
  /** Human-readable reason for the resolution */
  reason?: string;
}

// ── Provider Detection ──────────────────────────────────────

/** Which underlying model providers a CLI can access */
const CLI_NATIVE_PROVIDERS: Record<ProviderId, string[]> = {
  copilot: ['anthropic', 'openai', 'google', 'xai'],
  claude: ['anthropic'],
  gemini: ['google'],
  cursor: ['anthropic', 'openai', 'google'],
  codex: ['openai'],
  opencode: ['anthropic', 'openai', 'google', 'local'],
};

/** Detect which model provider a model name belongs to */
function detectModelProvider(model: string): string {
  if (model.startsWith('claude-') || model === 'opus' || model === 'sonnet' || model === 'haiku') return 'anthropic';
  if (model.startsWith('gpt-') || model.startsWith('o3') || model.startsWith('o4')) return 'openai';
  if (model.startsWith('gemini-')) return 'google';
  if (model.startsWith('grok-')) return 'xai';
  return 'unknown';
}

// ── Tier Aliases ────────────────────────────────────────────

const TIER_MAP: Record<ModelTier, Record<ProviderId, string>> = {
  fast: {
    copilot: 'claude-haiku-4.5',
    claude: 'haiku',
    gemini: 'gemini-2.5-flash-lite',
    cursor: 'claude-haiku-4.5',
    codex: 'gpt-5.1-codex-mini',
    opencode: 'anthropic/claude-haiku-4-5',
  },
  standard: {
    copilot: 'claude-sonnet-4.6',
    claude: 'sonnet',
    gemini: 'gemini-2.5-flash',
    cursor: 'claude-sonnet-4.6',
    codex: 'gpt-5.1-codex',
    opencode: 'anthropic/claude-sonnet-4-6',
  },
  premium: {
    copilot: 'claude-opus-4.6',
    claude: 'opus',
    gemini: 'gemini-2.5-pro',
    cursor: 'claude-opus-4.6',
    codex: 'gpt-5.2-codex',
    opencode: 'anthropic/claude-opus-4-6',
  },
};

// ── Cross-Provider Equivalences ─────────────────────────────

const EQUIVALENCES: Record<string, Record<string, string>> = {
  // Anthropic → others
  'claude-opus-4.6': { openai: 'gpt-5.2-codex', google: 'gemini-2.5-pro' },
  'claude-opus-4.5': { openai: 'gpt-5.1-codex-max', google: 'gemini-2.5-pro' },
  'claude-sonnet-4.6': { openai: 'gpt-5.1-codex', google: 'gemini-2.5-flash' },
  'claude-sonnet-4.5': { openai: 'gpt-5.1-codex', google: 'gemini-2.5-flash' },
  'claude-sonnet-4': { openai: 'gpt-4.1', google: 'gemini-2.5-flash' },
  'claude-haiku-4.5': { openai: 'gpt-5.1-codex-mini', google: 'gemini-2.5-flash-lite' },

  // OpenAI → others
  'gpt-5.4': { anthropic: 'claude-opus-4.6', google: 'gemini-2.5-pro' },
  'gpt-5.3-codex': { anthropic: 'claude-opus-4.6', google: 'gemini-2.5-pro' },
  'gpt-5.2-codex': { anthropic: 'claude-opus-4.6', google: 'gemini-2.5-pro' },
  'gpt-5.2': { anthropic: 'claude-sonnet-4.6', google: 'gemini-2.5-flash' },
  'gpt-5.1-codex-max': { anthropic: 'claude-opus-4.5', google: 'gemini-2.5-pro' },
  'gpt-5.1-codex': { anthropic: 'claude-sonnet-4.6', google: 'gemini-2.5-flash' },
  'gpt-5.1-codex-mini': { anthropic: 'claude-haiku-4.5', google: 'gemini-2.5-flash-lite' },
  'gpt-5.1': { anthropic: 'claude-sonnet-4.6', google: 'gemini-2.5-flash' },
  'gpt-5-mini': { anthropic: 'claude-haiku-4.5', google: 'gemini-2.5-flash-lite' },
  'gpt-4.1': { anthropic: 'claude-sonnet-4', google: 'gemini-2.5-flash' },

  // Google → others
  'gemini-3-pro-preview': { anthropic: 'claude-sonnet-4.6', openai: 'gpt-5.1-codex' },
  'gemini-2.5-pro': { anthropic: 'claude-opus-4.6', openai: 'gpt-5.2-codex' },
  'gemini-2.5-flash': { anthropic: 'claude-sonnet-4.6', openai: 'gpt-5.1-codex' },
  'gemini-2.5-flash-lite': { anthropic: 'claude-haiku-4.5', openai: 'gpt-5.1-codex-mini' },
};

// ── Claude CLI Aliases ──────────────────────────────────────

/** Claude SDK CLI accepts short aliases instead of full model names */
const CLAUDE_ALIASES: Record<string, string> = {
  'claude-opus-4.6': 'opus',
  'claude-opus-4.5': 'opus',
  'claude-sonnet-4.6': 'sonnet',
  'claude-sonnet-4.5': 'sonnet',
  'claude-sonnet-4': 'sonnet',
  'claude-haiku-4.5': 'haiku',
};

// ── OpenCode Provider Prefix ────────────────────────────────

/** Map a model provider name to OpenCode's provider prefix */
const OPENCODE_PREFIXES: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
};

// ── Core Resolution ─────────────────────────────────────────

/**
 * Resolve a model specification to the actual model name for a provider.
 *
 * @param modelSpec - A tier alias ('fast', 'standard', 'premium') or exact model name
 * @param provider - The CLI provider to resolve for
 * @returns ModelResolution with the resolved model, or undefined if no model specified
 */
export function resolveModel(
  modelSpec: string | undefined,
  provider: ProviderId,
): ModelResolution | undefined {
  if (!modelSpec) return undefined;

  const original = modelSpec;

  // Step 1: Tier alias resolution
  if (isTierAlias(modelSpec)) {
    const resolved = TIER_MAP[modelSpec as ModelTier]?.[provider];
    if (resolved) {
      return { model: resolved, translated: true, original, reason: `tier '${modelSpec}' → ${resolved}` };
    }
    // Tier alias recognized but no mapping for this provider — warn and continue to fallback
    logger.warn({
      module: 'model-resolver',
      msg: `Tier '${modelSpec}' has no model mapping for provider '${provider}', falling back`,
    });
  }

  // Step 2: Check if model is natively supported on this CLI
  const modelProvider = detectModelProvider(modelSpec);
  const cliProviders = CLI_NATIVE_PROVIDERS[provider] ?? [];

  if (cliProviders.includes(modelProvider)) {
    // Model's provider is available on this CLI — apply CLI-specific transforms
    if (provider === 'claude' && modelSpec in CLAUDE_ALIASES) {
      return { model: CLAUDE_ALIASES[modelSpec], translated: true, original, reason: 'alias for Claude CLI' };
    }
    if (provider === 'opencode') {
      const prefix = OPENCODE_PREFIXES[modelProvider];
      if (prefix) {
        return { model: `${prefix}/${modelSpec}`, translated: true, original, reason: 'OpenCode provider prefix' };
      }
    }
    return { model: modelSpec, translated: false, original };
  }

  // Step 3: Cross-provider equivalence mapping
  const equivalences = EQUIVALENCES[modelSpec];
  if (equivalences) {
    for (const cliProv of cliProviders) {
      if (equivalences[cliProv]) {
        let resolved = equivalences[cliProv];

        // Apply Claude aliases to the resolved model
        if (provider === 'claude' && resolved in CLAUDE_ALIASES) {
          resolved = CLAUDE_ALIASES[resolved];
        }
        // Apply OpenCode prefix to the resolved model
        if (provider === 'opencode') {
          const prefix = OPENCODE_PREFIXES[cliProv];
          if (prefix) {
            resolved = `${prefix}/${resolved}`;
          }
        }

        logger.info({
          module: 'model-resolver',
          msg: `Model '${modelSpec}' not available on ${provider}, using equivalent '${resolved}'`,
        });

        return {
          model: resolved,
          translated: true,
          original,
          reason: `${modelSpec} → ${resolved} (${provider} equivalent)`,
        };
      }
    }
  }

  // Step 4: Fallback to standard tier
  const fallback = TIER_MAP.standard?.[provider];
  if (fallback) {
    logger.warn({
      module: 'model-resolver',
      msg: `Model '${modelSpec}' has no mapping for ${provider}, falling back to standard tier: ${fallback}`,
    });
    return {
      model: fallback,
      translated: true,
      original,
      reason: 'unmapped model, fell back to standard tier',
    };
  }

  // No resolution possible — return original and let CLI handle the error
  return { model: modelSpec, translated: false, original };
}

// ── Helper Functions ────────────────────────────────────────

/** Check if a string is a tier alias */
export function isTierAlias(model: string): model is ModelTier {
  return model in TIER_MAP;
}

/** Get all provider model names for a tier */
export function getTierModels(tier: string): Record<string, string> | undefined {
  return TIER_MAP[tier as ModelTier];
}

/** List available tier alias names */
export function listTiers(): ModelTier[] {
  return Object.keys(TIER_MAP) as ModelTier[];
}

/** Validate that a model name is known (either a tier, a mapped model, or detectable provider) */
export function isValidModel(model: string, provider: ProviderId): boolean {
  if (isTierAlias(model)) return true;

  const modelProvider = detectModelProvider(model);
  const cliProviders = CLI_NATIVE_PROVIDERS[provider] ?? [];

  // Native support
  if (cliProviders.includes(modelProvider)) return true;

  // Has equivalence mapping
  if (model in EQUIVALENCES) return true;

  return false;
}
