/**
 * Model Availability Fallback (pure, no I/O).
 *
 * After an ACP `newSession`, providers may report the set of models they
 * actually offer (`SessionModelState`). If the model flightdeck requested isn't
 * in that set, this module picks the nearest available substitute — but is
 * SAFE-BY-DEFAULT: it never guesses on an ambiguous/low-confidence match and
 * NO-OPs to exactly today's behavior whenever the provider reports no models.
 *
 * The actual RPC switch (`unstable_setSessionModel`) is performed by AcpAdapter;
 * this module only computes the decision.
 */
import { PROVIDER_REGISTRY, type ProviderId } from '@flightdeck/shared';
import { detectModelProvider, type ModelTier } from './ModelResolver.js';

// ── Types ───────────────────────────────────────────────────

/** A model the provider reports as available for the session. */
export interface AvailableModel {
  modelId: string;
  name?: string;
}

/** The reason behind a model selection decision. */
export type ModelSelectionReason = 'exact' | 'already-current' | 'downgrade' | 'no-op';

/** The outcome of {@link selectAvailableModel}. */
export interface ModelSelection {
  /** The model id to use (may equal the requested model when no substitution). */
  modelId: string;
  /** Whether a substitution (downgrade) actually occurred. */
  substituted: boolean;
  /** Why this model was chosen. */
  reason: ModelSelectionReason;
  /** Human-readable detail (populated for downgrades). */
  detail?: string;
}

/** Input context for {@link selectAvailableModel}. */
export interface SelectContext {
  /** The model flightdeck wants to use (already provider-resolved). */
  requested: string;
  /** Models the provider reports as available (may be empty). */
  availableModels: AvailableModel[];
  /** The model the provider says is currently active, if any. */
  currentModelId?: string;
  /** The CLI provider this session belongs to. */
  provider: ProviderId;
  /** Optional explicit tier hint; otherwise inferred from the provider registry. */
  intendedTier?: ModelTier;
}

// ── Normalization (conservative) ────────────────────────────

/**
 * Conservatively normalize a model id for fuzzy comparison:
 * - lowercase
 * - strip a leading provider prefix like `anthropic/`
 * - strip a trailing `-latest`
 * - treat `.` and `-` as equivalent separators
 */
function normalize(id: string): string {
  let s = id.toLowerCase().trim();
  const slash = s.indexOf('/');
  if (slash >= 0) s = s.slice(slash + 1);
  s = s.replace(/-latest$/, '');
  s = s.replace(/\./g, '-');
  return s;
}

const TIER_LADDER: ModelTier[] = ['premium', 'standard', 'fast'];

/**
 * Build the ordered list of tiers to try: start at the intended tier, walk DOWN
 * (premium → standard → fast), then append any remaining higher tiers (UP).
 */
function buildTierOrder(intended: ModelTier): ModelTier[] {
  const startIdx = TIER_LADDER.indexOf(intended);
  const down = TIER_LADDER.slice(startIdx);
  const up = TIER_LADDER.slice(0, startIdx).reverse();
  return [...down, ...up];
}

// ── Core selection (pure, safe-by-default) ──────────────────

/**
 * Decide which available model to use for a session.
 *
 * Safe-by-default contract:
 * - No models reported → no-op (today's behavior).
 * - Exact or unambiguous normalized match → use the real model id (no substitution).
 * - Ambiguous fuzzy match → NEVER guess; defer to currentModelId or no-op.
 * - Otherwise downgrade by tier within the same model family when possible.
 */
export function selectAvailableModel(ctx: SelectContext): ModelSelection {
  const { requested, availableModels, currentModelId, provider, intendedTier } = ctx;

  // Step 1: provider reports no models → exact no-op to today's behavior.
  if (!availableModels || availableModels.length === 0) {
    return { modelId: requested, substituted: false, reason: 'no-op' };
  }

  // Step 2: exact (case-insensitive) match → use the provider's real id.
  const requestedLower = requested.toLowerCase();
  const exact = availableModels.find((m) => m.modelId.toLowerCase() === requestedLower);
  if (exact) {
    return { modelId: exact.modelId, substituted: false, reason: 'exact' };
  }

  // Step 3: normalized match. Only resolve when EXACTLY ONE candidate matches —
  // anything ambiguous (0 or >1) must not be guessed.
  const requestedNorm = normalize(requested);
  const normMatches = availableModels.filter((m) => normalize(m.modelId) === requestedNorm);
  if (normMatches.length === 1) {
    return { modelId: normMatches[0].modelId, substituted: false, reason: 'exact' };
  }

  // Step 4: downgrade by tier + family.
  const tierModels = PROVIDER_REGISTRY[provider]?.tierModels;
  if (tierModels) {
    // Determine the intended tier: explicit hint, else infer from the registry,
    // else default to 'standard'.
    const tier: ModelTier = intendedTier ?? inferTier(tierModels, requested) ?? 'standard';

    const order = buildTierOrder(tier);
    const requestedFamily = detectModelProvider(requested);
    const hasSameFamilyAvailable = availableModels.some(
      (m) => detectModelProvider(m.modelId) === requestedFamily,
    );

    for (const t of order) {
      const candidate = tierModels[t];
      if (!candidate) continue;
      // Family constraint: only cross families when NO same-family model exists.
      if (hasSameFamilyAvailable && detectModelProvider(candidate) !== requestedFamily) {
        continue;
      }
      const candidateNorm = normalize(candidate);
      const match = availableModels.find((m) => normalize(m.modelId) === candidateNorm);
      if (match) {
        return {
          modelId: match.modelId,
          substituted: true,
          reason: 'downgrade',
          detail: `${requested} → ${match.modelId} (nearest available)`,
        };
      }
    }
  }

  // Step 5: give up safely. Prefer the provider's current model when it's real.
  if (currentModelId) {
    const currentLower = currentModelId.toLowerCase();
    const currentPresent = availableModels.some((m) => m.modelId.toLowerCase() === currentLower);
    if (currentPresent) {
      return { modelId: currentModelId, substituted: false, reason: 'already-current' };
    }
  }

  return { modelId: requested, substituted: false, reason: 'no-op' };
}

/**
 * Infer the intended tier by locating `requested` among a provider's tierModels.
 * Returns undefined when it doesn't match any tier.
 */
function inferTier(
  tierModels: { fast: string; standard: string; premium: string },
  requested: string,
): ModelTier | undefined {
  const requestedNorm = normalize(requested);
  for (const tier of TIER_LADDER) {
    if (normalize(tierModels[tier]) === requestedNorm) return tier;
  }
  return undefined;
}
