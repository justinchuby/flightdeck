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
import { KNOWN_MODEL_IDS } from '../projects/ModelConfigDefaults.js';
import { PROVIDER_REGISTRY, PROVIDER_IDS, type ProviderId } from '@flightdeck/shared';

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

// ── Derived from ProviderRegistry ───────────────────────────

/** Which underlying model providers a CLI can access — derived from registry */
const CLI_NATIVE_PROVIDERS: Record<ProviderId, string[]> = Object.fromEntries(
  PROVIDER_IDS.map((id: ProviderId) => [id, PROVIDER_REGISTRY[id].nativeModelProviders]),
) as Record<ProviderId, string[]>;

/** Restricted model catalogs — derived from registry */
const CLI_RESTRICTED_MODELS: Partial<Record<ProviderId, Record<string, Set<string>>>> = Object.fromEntries(
  PROVIDER_IDS
    .filter((id: ProviderId) => PROVIDER_REGISTRY[id].restrictedModels)
    .map((id: ProviderId) => [
      id,
      Object.fromEntries(
        Object.entries(PROVIDER_REGISTRY[id].restrictedModels!).map(
          ([backend, models]: [string, string[]]) => [backend, new Set<string>(models)],
        ),
      ),
    ]),
) as Partial<Record<ProviderId, Record<string, Set<string>>>>;

/** Tier alias → provider model mappings — derived from registry */
const TIER_MAP: Record<ModelTier, Record<ProviderId, string>> = {
  fast: Object.fromEntries(PROVIDER_IDS.map((id: ProviderId) => [id, PROVIDER_REGISTRY[id].tierModels.fast])) as Record<ProviderId, string>,
  standard: Object.fromEntries(PROVIDER_IDS.map((id: ProviderId) => [id, PROVIDER_REGISTRY[id].tierModels.standard])) as Record<ProviderId, string>,
  premium: Object.fromEntries(PROVIDER_IDS.map((id: ProviderId) => [id, PROVIDER_REGISTRY[id].tierModels.premium])) as Record<ProviderId, string>,
};

/** Claude SDK CLI accepts short aliases instead of full model names — derived from registry */
const CLAUDE_ALIASES: Record<string, string> = PROVIDER_REGISTRY.claude.modelAliases ?? {};

/** OpenCode provider prefixes — derived from registry */
const OPENCODE_PREFIXES: Record<string, string> = PROVIDER_REGISTRY.opencode.modelPrefixes ?? {};

/** Detect which model provider a model name belongs to */
function detectModelProvider(model: string): string {
  if (model.startsWith('claude-') || model === 'opus' || model === 'sonnet' || model === 'haiku') return 'anthropic';
  if (model.startsWith('gpt-') || model.startsWith('o3') || model.startsWith('o4')) return 'openai';
  if (model.startsWith('gemini-')) return 'google';
  if (model.startsWith('grok-')) return 'xai';
  if (model.startsWith('moonshot-') || model.startsWith('kimi-') || model === 'kimi-latest') return 'moonshot';
  if (model.startsWith('qwen-')) return 'qwen';
  return 'unknown';
}

// ── Cross-Provider Equivalences ─────────────────────────────

const EQUIVALENCES: Record<string, Record<string, string>> = {
  // Anthropic → others
  'claude-opus-4.6': { openai: 'gpt-5.2-codex', google: 'gemini-3.1-pro' },
  'claude-opus-4.5': { openai: 'gpt-5.1-codex-max', google: 'gemini-3.1-pro' },
  'claude-sonnet-4.6': { openai: 'gpt-5.3-codex', google: 'gemini-3.1-flash' },
  'claude-sonnet-4.5': { openai: 'gpt-5.3-codex', google: 'gemini-3.1-flash' },
  'claude-sonnet-4': { openai: 'gpt-4.1', google: 'gemini-3.1-flash' },
  'claude-haiku-4.5': { openai: 'gpt-5.1-codex-mini', google: 'gemini-3.1-flash-lite' },

  // OpenAI → others
  'gpt-5.4': { anthropic: 'claude-opus-4.6', google: 'gemini-3.1-pro' },
  'gpt-5.3-codex': { anthropic: 'claude-opus-4.6', google: 'gemini-3.1-pro' },
  'gpt-5.2-codex': { anthropic: 'claude-opus-4.6', google: 'gemini-3.1-pro' },
  'gpt-5.2': { anthropic: 'claude-sonnet-4.6', google: 'gemini-3.1-flash' },
  'gpt-5.1-codex-max': { anthropic: 'claude-opus-4.5', google: 'gemini-3.1-pro' },
  'gpt-5.1-codex': { anthropic: 'claude-sonnet-4.6', google: 'gemini-3.1-flash' },

  'gpt-5.1-codex-mini': { anthropic: 'claude-haiku-4.5', google: 'gemini-3.1-flash-lite' },
  'gpt-5.1': { anthropic: 'claude-sonnet-4.6', google: 'gemini-3.1-flash' },
  'gpt-5-mini': { anthropic: 'claude-haiku-4.5', google: 'gemini-3.1-flash-lite' },
  'gpt-4.1': { anthropic: 'claude-sonnet-4', google: 'gemini-3.1-flash' },

  // Google → others
  'gemini-3-pro-preview': { anthropic: 'claude-opus-4.6', openai: 'gpt-5.2-codex' },
  'gemini-3-flash-preview': { anthropic: 'claude-sonnet-4.6', openai: 'gpt-5.3-codex' },
  'gemini-3.1-pro': { anthropic: 'claude-opus-4.6', openai: 'gpt-5.2-codex' },
  'gemini-3.1-flash': { anthropic: 'claude-sonnet-4.6', openai: 'gpt-5.3-codex' },
  'gemini-3.1-flash-lite': { anthropic: 'claude-haiku-4.5', openai: 'gpt-5.1-codex-mini' },
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
      // Apply Claude aliases to tier-resolved models
      if (provider === 'claude' && resolved in CLAUDE_ALIASES) {
        return { model: CLAUDE_ALIASES[resolved], translated: true, original, reason: `tier '${modelSpec}' → ${CLAUDE_ALIASES[resolved]}` };
      }
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
    // Check for restricted model catalogs (e.g., Copilot only supports certain Google models)
    const restricted = CLI_RESTRICTED_MODELS[provider]?.[modelProvider];
    if (restricted && !restricted.has(modelSpec)) {
      // Model family is supported but this specific model is not — fall through to equivalence mapping
    } else {
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
  let fallback = TIER_MAP.standard?.[provider];
  if (fallback) {
    // Apply Claude aliases to the fallback model
    if (provider === 'claude' && fallback in CLAUDE_ALIASES) {
      fallback = CLAUDE_ALIASES[fallback];
    }
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

  // Native support (with model restrictions check)
  if (cliProviders.includes(modelProvider)) {
    const restricted = CLI_RESTRICTED_MODELS[provider]?.[modelProvider];
    if (!restricted || restricted.has(model)) return true;
    // Model family supported but specific model restricted — check equivalences
  }

  // Has equivalence mapping
  if (model in EQUIVALENCES) return true;

  return false;
}

// ── Provider-Scoped Model Lists ─────────────────────────────

/**
 * Get the list of models natively supported by a CLI provider.
 * Uses CLI_NATIVE_PROVIDERS + CLI_RESTRICTED_MODELS + detectModelProvider()
 * to filter KNOWN_MODEL_IDS to only models the provider can actually use.
 */
export function getModelsForProvider(provider: ProviderId): string[] {
  const cliProviders = CLI_NATIVE_PROVIDERS[provider] ?? [];
  return [...KNOWN_MODEL_IDS].filter((model) => {
    const modelProvider = detectModelProvider(model);
    if (!cliProviders.includes(modelProvider)) return false;
    const restricted = CLI_RESTRICTED_MODELS[provider]?.[modelProvider];
    if (restricted && !restricted.has(model)) return false;
    return true;
  });
}

/**
 * Get per-provider model lists for all known providers.
 * Used by the /models endpoint to drive provider-scoped UI tabs.
 */
export function getModelsByProvider(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const provider of Object.keys(CLI_NATIVE_PROVIDERS) as ProviderId[]) {
    result[provider] = getModelsForProvider(provider);
  }
  return result;
}
