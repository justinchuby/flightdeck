/**
 * Unit tests for the pure model-availability selector.
 *
 * Covers the safe-by-default contract: no-op when nothing reported, exact and
 * normalized resolution, ambiguity deference, same-family tier downgrade, and
 * tier inference from the provider registry.
 */
import { describe, it, expect } from 'vitest';
import { selectAvailableModel, type SelectContext } from './ModelAvailability.js';

function ctx(partial: Partial<SelectContext> & Pick<SelectContext, 'requested'>): SelectContext {
  return {
    availableModels: [],
    provider: 'claude',
    ...partial,
  };
}

describe('selectAvailableModel', () => {
  it('no-ops to today behavior when no models are reported', () => {
    const result = selectAvailableModel(ctx({ requested: 'claude-opus-4.8', availableModels: [] }));
    expect(result).toEqual({ modelId: 'claude-opus-4.8', substituted: false, reason: 'no-op' });
  });

  it('no-ops when availableModels is undefined', () => {
    const result = selectAvailableModel(
      ctx({ requested: 'claude-opus-4.8', availableModels: undefined as any }),
    );
    expect(result.substituted).toBe(false);
    expect(result.reason).toBe('no-op');
    expect(result.modelId).toBe('claude-opus-4.8');
  });

  it('resolves an exact (case-insensitive) match without substitution', () => {
    const result = selectAvailableModel(
      ctx({
        requested: 'claude-opus-4.8',
        availableModels: [{ modelId: 'claude-opus-4.8' }, { modelId: 'claude-sonnet-4.6' }],
        currentModelId: 'claude-sonnet-4.6',
      }),
    );
    expect(result).toEqual({ modelId: 'claude-opus-4.8', substituted: false, reason: 'exact' });
  });

  it('downgrades to an available same-family lower tier when requested is missing', () => {
    const result = selectAvailableModel(
      ctx({
        requested: 'claude-opus-4.8', // premium, unavailable
        availableModels: [{ modelId: 'claude-sonnet-4.6' }, { modelId: 'claude-haiku-4.5' }],
        currentModelId: 'claude-sonnet-4.6',
        provider: 'copilot',
      }),
    );
    expect(result.substituted).toBe(true);
    expect(result.reason).toBe('downgrade');
    expect(result.modelId).toBe('claude-sonnet-4.6');
    expect(result.detail).toContain('claude-opus-4.8');
    expect(result.detail).toContain('claude-sonnet-4.6');
  });

  it('resolves a single normalized variant to the real id (separator + prefix)', () => {
    const result = selectAvailableModel(
      ctx({
        requested: 'claude-opus-4.6',
        availableModels: [{ modelId: 'anthropic/claude-opus-4-6' }],
        currentModelId: 'anthropic/claude-opus-4-6',
        provider: 'opencode',
      }),
    );
    expect(result.substituted).toBe(false);
    expect(result.reason).toBe('exact');
    expect(result.modelId).toBe('anthropic/claude-opus-4-6');
  });

  it('does NOT guess when two plausible normalized matches exist; defers to current', () => {
    const result = selectAvailableModel(
      ctx({
        // Both available ids normalize-equal to the requested id.
        requested: 'claude-opus-4.6',
        availableModels: [
          { modelId: 'claude-opus-4-6' },
          { modelId: 'anthropic/claude-opus-4-6' },
          { modelId: 'claude-sonnet-4.6' },
        ],
        currentModelId: 'claude-sonnet-4.6',
        provider: 'claude',
        // Force step 4 to not fire by giving an unknown tier hint family mismatch:
        // there is no exact claude-opus-4.6 tier entry, downgrade ladder will look
        // for premium/standard/fast which are claude-opus-4.8/sonnet-4.6/haiku-4.5.
      }),
    );
    // Ambiguous normalized → step 4 downgrade may still resolve to a tier model.
    // The contract: never resolve the ambiguous fuzzy match to one of the two
    // variants. Acceptable outcomes are a tier downgrade or already-current.
    expect(['claude-opus-4-6', 'anthropic/claude-opus-4-6']).not.toContain(result.modelId);
  });

  it('falls back to currentModelId when present and no downgrade target exists', () => {
    const result = selectAvailableModel(
      ctx({
        requested: 'gpt-5.5', // openai family, unavailable, cross-family request on claude provider
        availableModels: [{ modelId: 'some-unknown-model-xyz' }, { modelId: 'current-special' }],
        currentModelId: 'current-special',
        provider: 'claude',
      }),
    );
    expect(result.substituted).toBe(false);
    expect(result.reason).toBe('already-current');
    expect(result.modelId).toBe('current-special');
  });

  it('no-ops (returns requested) when nothing matches and no usable current model', () => {
    const result = selectAvailableModel(
      ctx({
        requested: 'gpt-5.5',
        availableModels: [{ modelId: 'some-unknown-model-xyz' }],
        currentModelId: 'not-in-list',
        provider: 'claude',
      }),
    );
    expect(result.substituted).toBe(false);
    expect(result.reason).toBe('no-op');
    expect(result.modelId).toBe('gpt-5.5');
  });

  it('infers premium tier and downgrades to standard when premium is unavailable', () => {
    // copilot premium = claude-opus-4.8, standard = claude-sonnet-4.6, fast = claude-haiku-4.5
    const result = selectAvailableModel(
      ctx({
        requested: 'claude-opus-4.8', // premium, unavailable
        availableModels: [{ modelId: 'claude-sonnet-4.6' }],
        currentModelId: 'claude-sonnet-4.6',
        provider: 'copilot',
      }),
    );
    expect(result.substituted).toBe(true);
    expect(result.reason).toBe('downgrade');
    expect(result.modelId).toBe('claude-sonnet-4.6');
  });

  it('respects an explicit intendedTier hint for the downgrade ladder', () => {
    const result = selectAvailableModel(
      ctx({
        requested: 'claude-opus-4.8',
        availableModels: [{ modelId: 'claude-haiku-4.5' }],
        currentModelId: 'claude-haiku-4.5',
        provider: 'copilot',
        intendedTier: 'fast',
      }),
    );
    expect(result.substituted).toBe(true);
    expect(result.modelId).toBe('claude-haiku-4.5');
  });

  it('only crosses family when no same-family model is available', () => {
    // requested claude (premium); only gemini models available → cross-family allowed.
    // With class-based tier inference (MAJOR-A) the requested opus is premium, so
    // the nearest available cross-family model is the premium gemini (pro), not flash.
    const result = selectAvailableModel(
      ctx({
        requested: 'claude-opus-4.8',
        availableModels: [{ modelId: 'gemini-3.1-flash' }, { modelId: 'gemini-3.1-pro' }],
        currentModelId: 'gemini-3.1-flash',
        provider: 'gemini',
      }),
    );
    expect(result.substituted).toBe(true);
    expect(result.reason).toBe('downgrade');
    expect(result.modelId).toBe('gemini-3.1-pro');
  });

  it('infers tier from the requested model CLASS, not the provider tier-triple (MAJOR-A)', () => {
    // copilot premium=claude-opus-4.8, standard=claude-sonnet-4.6, fast=claude-haiku-4.5.
    // The requested id (claude-opus-4.6) is NOT in copilot's tier-triple, but it
    // IS a known premium model class — so we must downgrade to the available
    // premium Opus (4.8), NOT over-downgrade to Sonnet.
    const result = selectAvailableModel(
      ctx({
        requested: 'claude-opus-4.6', // premium class, unavailable as-is
        availableModels: [
          { modelId: 'claude-opus-4.8' },
          { modelId: 'claude-sonnet-4.6' },
          { modelId: 'claude-haiku-4.5' },
        ],
        currentModelId: 'claude-sonnet-4.6',
        provider: 'copilot',
      }),
    );
    expect(result.substituted).toBe(true);
    expect(result.reason).toBe('downgrade');
    expect(result.modelId).toBe('claude-opus-4.8');
  });

  it('skips an ambiguous tier candidate (>1 normalized match) rather than guessing (MAJOR-E)', () => {
    // copilot premium=claude-opus-4.8 has TWO normalized matches available
    // (claude-opus-4.8 and claude-opus-4-8) → premium tier is ambiguous and must
    // be skipped. The next tier (standard=claude-sonnet-4.6) has a single match
    // and is selected instead.
    const result = selectAvailableModel(
      ctx({
        requested: 'claude-opus-4.6', // premium class, unavailable as-is
        availableModels: [
          { modelId: 'claude-opus-4.8' },
          { modelId: 'claude-opus-4-8' },
          { modelId: 'claude-sonnet-4.6' },
        ],
        currentModelId: 'claude-sonnet-4.6',
        provider: 'copilot',
      }),
    );
    expect(result.substituted).toBe(true);
    expect(result.reason).toBe('downgrade');
    expect(result.modelId).toBe('claude-sonnet-4.6');
  });
});
