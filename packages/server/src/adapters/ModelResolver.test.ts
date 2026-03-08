import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveModel,
  isTierAlias,
  getTierModels,
  listTiers,
  isValidModel,
} from './ModelResolver.js';
import type { ModelResolution, ModelTier } from './ModelResolver.js';
import type { ProviderId } from './presets.js';

// Suppress logger output during tests
vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('ModelResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Tier Alias Resolution ──────────────────────────────

  describe('tier alias resolution', () => {
    it('resolves "fast" to provider-specific models', () => {
      expect(resolveModel('fast', 'copilot')?.model).toBe('claude-haiku-4.5');
      expect(resolveModel('fast', 'claude')?.model).toBe('haiku');
      expect(resolveModel('fast', 'gemini')?.model).toBe('gemini-2.5-flash-lite');
      expect(resolveModel('fast', 'cursor')?.model).toBe('claude-haiku-4.5');
      expect(resolveModel('fast', 'codex')?.model).toBe('gpt-5.1-codex-mini');
      expect(resolveModel('fast', 'opencode')?.model).toBe('anthropic/claude-haiku-4-5');
    });

    it('resolves "standard" to provider-specific models', () => {
      expect(resolveModel('standard', 'copilot')?.model).toBe('claude-sonnet-4.6');
      expect(resolveModel('standard', 'claude')?.model).toBe('sonnet');
      expect(resolveModel('standard', 'gemini')?.model).toBe('gemini-2.5-flash');
      expect(resolveModel('standard', 'cursor')?.model).toBe('claude-sonnet-4.6');
      expect(resolveModel('standard', 'codex')?.model).toBe('gpt-5.1-codex');
      expect(resolveModel('standard', 'opencode')?.model).toBe('anthropic/claude-sonnet-4-6');
    });

    it('resolves "premium" to provider-specific models', () => {
      expect(resolveModel('premium', 'copilot')?.model).toBe('claude-opus-4.6');
      expect(resolveModel('premium', 'claude')?.model).toBe('opus');
      expect(resolveModel('premium', 'gemini')?.model).toBe('gemini-2.5-pro');
      expect(resolveModel('premium', 'cursor')?.model).toBe('claude-opus-4.6');
      expect(resolveModel('premium', 'codex')?.model).toBe('gpt-5.2-codex');
      expect(resolveModel('premium', 'opencode')?.model).toBe('anthropic/claude-opus-4-6');
    });

    it('marks tier resolutions as translated', () => {
      const result = resolveModel('premium', 'copilot')!;
      expect(result.translated).toBe(true);
      expect(result.original).toBe('premium');
      expect(result.reason).toContain('tier');
    });
  });

  // ── Native Passthrough ─────────────────────────────────

  describe('native model passthrough', () => {
    it('passes Anthropic models through on Copilot (multi-gateway)', () => {
      const result = resolveModel('claude-opus-4.6', 'copilot')!;
      expect(result.model).toBe('claude-opus-4.6');
      expect(result.translated).toBe(false);
    });

    it('passes OpenAI models through on Copilot', () => {
      const result = resolveModel('gpt-5.2-codex', 'copilot')!;
      expect(result.model).toBe('gpt-5.2-codex');
      expect(result.translated).toBe(false);
    });

    it('passes Google models through on Copilot', () => {
      const result = resolveModel('gemini-3-pro-preview', 'copilot')!;
      expect(result.model).toBe('gemini-3-pro-preview');
      expect(result.translated).toBe(false);
    });

    it('passes OpenAI models through on Codex', () => {
      const result = resolveModel('gpt-5.1-codex', 'codex')!;
      expect(result.model).toBe('gpt-5.1-codex');
      expect(result.translated).toBe(false);
    });

    it('passes Google models through on Gemini', () => {
      const result = resolveModel('gemini-2.5-pro', 'gemini')!;
      expect(result.model).toBe('gemini-2.5-pro');
      expect(result.translated).toBe(false);
    });
  });

  // ── Claude CLI Aliases ─────────────────────────────────

  describe('Claude CLI short aliases', () => {
    it('translates claude-opus-4.6 to "opus" for Claude CLI', () => {
      const result = resolveModel('claude-opus-4.6', 'claude')!;
      expect(result.model).toBe('opus');
      expect(result.translated).toBe(true);
      expect(result.reason).toContain('alias');
    });

    it('translates claude-sonnet-4.6 to "sonnet" for Claude CLI', () => {
      const result = resolveModel('claude-sonnet-4.6', 'claude')!;
      expect(result.model).toBe('sonnet');
      expect(result.translated).toBe(true);
    });

    it('translates claude-haiku-4.5 to "haiku" for Claude CLI', () => {
      const result = resolveModel('claude-haiku-4.5', 'claude')!;
      expect(result.model).toBe('haiku');
      expect(result.translated).toBe(true);
    });

    it('translates older claude-sonnet-4 to "sonnet"', () => {
      const result = resolveModel('claude-sonnet-4', 'claude')!;
      expect(result.model).toBe('sonnet');
      expect(result.translated).toBe(true);
    });
  });

  // ── OpenCode Provider Prefix ───────────────────────────

  describe('OpenCode provider prefix', () => {
    it('adds anthropic/ prefix for Anthropic models', () => {
      const result = resolveModel('claude-opus-4.6', 'opencode')!;
      expect(result.model).toBe('anthropic/claude-opus-4.6');
      expect(result.translated).toBe(true);
      expect(result.reason).toContain('OpenCode');
    });

    it('adds openai/ prefix for OpenAI models', () => {
      const result = resolveModel('gpt-5.2-codex', 'opencode')!;
      expect(result.model).toBe('openai/gpt-5.2-codex');
      expect(result.translated).toBe(true);
    });

    it('adds google/ prefix for Google models', () => {
      const result = resolveModel('gemini-2.5-pro', 'opencode')!;
      expect(result.model).toBe('google/gemini-2.5-pro');
      expect(result.translated).toBe(true);
    });
  });

  // ── Cross-Provider Equivalences ────────────────────────

  describe('cross-provider equivalence mapping', () => {
    it('maps claude-opus-4.6 to gemini-2.5-pro on Gemini', () => {
      const result = resolveModel('claude-opus-4.6', 'gemini')!;
      expect(result.model).toBe('gemini-2.5-pro');
      expect(result.translated).toBe(true);
      expect(result.reason).toContain('equivalent');
    });

    it('maps claude-opus-4.6 to gpt-5.2-codex on Codex', () => {
      const result = resolveModel('claude-opus-4.6', 'codex')!;
      expect(result.model).toBe('gpt-5.2-codex');
      expect(result.translated).toBe(true);
    });

    it('maps gpt-5.2-codex to claude-opus-4.6 on Claude (as "opus")', () => {
      const result = resolveModel('gpt-5.2-codex', 'claude')!;
      expect(result.model).toBe('opus');
      expect(result.translated).toBe(true);
    });

    it('maps gpt-4.1 to gemini-2.5-flash on Gemini', () => {
      const result = resolveModel('gpt-4.1', 'gemini')!;
      expect(result.model).toBe('gemini-2.5-flash');
      expect(result.translated).toBe(true);
    });

    it('maps gemini-2.5-pro to claude-opus-4.6 on Copilot (passthrough since multi-gateway)', () => {
      // Copilot supports Google, so gemini models pass through
      const result = resolveModel('gemini-2.5-pro', 'copilot')!;
      expect(result.model).toBe('gemini-2.5-pro');
      expect(result.translated).toBe(false);
    });

    it('maps gemini-2.5-pro to gpt-5.2-codex on Codex', () => {
      const result = resolveModel('gemini-2.5-pro', 'codex')!;
      expect(result.model).toBe('gpt-5.2-codex');
      expect(result.translated).toBe(true);
    });

    it('maps gemini-3-pro-preview to sonnet on Claude', () => {
      const result = resolveModel('gemini-3-pro-preview', 'claude')!;
      expect(result.model).toBe('sonnet');
      expect(result.translated).toBe(true);
    });

    it('maps claude-haiku-4.5 to gpt-5.1-codex-mini on Codex', () => {
      const result = resolveModel('claude-haiku-4.5', 'codex')!;
      expect(result.model).toBe('gpt-5.1-codex-mini');
      expect(result.translated).toBe(true);
    });

    it('maps cross-provider models with OpenCode prefix', () => {
      // claude-opus-4.6 on OpenCode → passthrough with prefix (Anthropic is native)
      const result = resolveModel('claude-opus-4.6', 'opencode')!;
      expect(result.model).toBe('anthropic/claude-opus-4.6');
    });
  });

  // ── Fallback to Standard Tier ──────────────────────────

  describe('fallback to standard tier', () => {
    it('falls back for completely unknown models', () => {
      const result = resolveModel('llama-3.3-70b', 'gemini')!;
      expect(result.model).toBe('gemini-2.5-flash');
      expect(result.translated).toBe(true);
      expect(result.reason).toContain('standard tier');
    });

    it('falls back for unknown model on Codex', () => {
      const result = resolveModel('some-obscure-model', 'codex')!;
      expect(result.model).toBe('gpt-5.1-codex');
      expect(result.translated).toBe(true);
    });

    it('falls back for unknown model on Claude', () => {
      const result = resolveModel('mystery-model', 'claude')!;
      expect(result.model).toBe('sonnet');
      expect(result.translated).toBe(true);
    });
  });

  // ── Undefined / Empty Input ────────────────────────────

  describe('undefined and empty input', () => {
    it('returns undefined for undefined model', () => {
      expect(resolveModel(undefined, 'copilot')).toBeUndefined();
    });

    it('returns fallback for empty string model', () => {
      // Empty string is falsy, but typeof '' !== undefined
      // Our implementation checks !modelSpec which catches empty string
      expect(resolveModel('', 'copilot')).toBeUndefined();
    });
  });

  // ── Resolution preserves original ─────────────────────

  describe('resolution metadata', () => {
    it('always includes original model name', () => {
      const result = resolveModel('claude-opus-4.6', 'gemini')!;
      expect(result.original).toBe('claude-opus-4.6');
    });

    it('includes reason for translated models', () => {
      const result = resolveModel('premium', 'gemini')!;
      expect(result.reason).toBeDefined();
      expect(result.reason!.length).toBeGreaterThan(0);
    });

    it('has no reason for passthrough models', () => {
      const result = resolveModel('claude-opus-4.6', 'copilot')!;
      expect(result.reason).toBeUndefined();
    });
  });

  // ── Role Model Mapping (Integration Scenarios) ────────

  describe('real-world role model mapping', () => {
    const roleModels: Record<string, string> = {
      architect: 'claude-opus-4.6',
      developer: 'claude-opus-4.6',
      'code-reviewer': 'gemini-3-pro-preview',
      'qa-tester': 'claude-sonnet-4.6',
      secretary: 'gpt-4.1',
      'product-manager': 'gpt-5.3-codex',
    };

    const providers: ProviderId[] = ['copilot', 'claude', 'gemini', 'cursor', 'codex', 'opencode'];

    it('resolves all role models for all providers without errors', () => {
      for (const [role, model] of Object.entries(roleModels)) {
        for (const provider of providers) {
          const result = resolveModel(model, provider);
          expect(result).toBeDefined();
          expect(result!.model).toBeTruthy();
        }
      }
    });

    it('architect (claude-opus-4.6) maps correctly across providers', () => {
      expect(resolveModel('claude-opus-4.6', 'copilot')?.model).toBe('claude-opus-4.6');
      expect(resolveModel('claude-opus-4.6', 'claude')?.model).toBe('opus');
      expect(resolveModel('claude-opus-4.6', 'gemini')?.model).toBe('gemini-2.5-pro');
      expect(resolveModel('claude-opus-4.6', 'cursor')?.model).toBe('claude-opus-4.6');
      expect(resolveModel('claude-opus-4.6', 'codex')?.model).toBe('gpt-5.2-codex');
      expect(resolveModel('claude-opus-4.6', 'opencode')?.model).toBe('anthropic/claude-opus-4.6');
    });

    it('secretary (gpt-4.1) maps correctly across providers', () => {
      expect(resolveModel('gpt-4.1', 'copilot')?.model).toBe('gpt-4.1');
      expect(resolveModel('gpt-4.1', 'claude')?.model).toBe('sonnet');
      expect(resolveModel('gpt-4.1', 'gemini')?.model).toBe('gemini-2.5-flash');
      expect(resolveModel('gpt-4.1', 'cursor')?.model).toBe('gpt-4.1');
      expect(resolveModel('gpt-4.1', 'codex')?.model).toBe('gpt-4.1');
      expect(resolveModel('gpt-4.1', 'opencode')?.model).toBe('openai/gpt-4.1');
    });
  });

  // ── Helper Functions ───────────────────────────────────

  describe('isTierAlias()', () => {
    it('returns true for valid tier aliases', () => {
      expect(isTierAlias('fast')).toBe(true);
      expect(isTierAlias('standard')).toBe(true);
      expect(isTierAlias('premium')).toBe(true);
    });

    it('returns false for model names', () => {
      expect(isTierAlias('claude-opus-4.6')).toBe(false);
      expect(isTierAlias('gpt-5.2')).toBe(false);
    });

    it('returns false for empty/unknown strings', () => {
      expect(isTierAlias('')).toBe(false);
      expect(isTierAlias('ultra')).toBe(false);
    });
  });

  describe('getTierModels()', () => {
    it('returns provider map for valid tier', () => {
      const models = getTierModels('premium');
      expect(models).toBeDefined();
      expect(models!['copilot']).toBe('claude-opus-4.6');
      expect(models!['gemini']).toBe('gemini-2.5-pro');
      expect(models!['codex']).toBe('gpt-5.2-codex');
    });

    it('returns undefined for invalid tier', () => {
      expect(getTierModels('ultra')).toBeUndefined();
      expect(getTierModels('')).toBeUndefined();
    });

    it('returns all 6 providers for each tier', () => {
      for (const tier of listTiers()) {
        const models = getTierModels(tier)!;
        expect(Object.keys(models)).toHaveLength(6);
      }
    });
  });

  describe('listTiers()', () => {
    it('returns exactly 3 tiers', () => {
      const tiers = listTiers();
      expect(tiers).toHaveLength(3);
      expect(tiers).toContain('fast');
      expect(tiers).toContain('standard');
      expect(tiers).toContain('premium');
    });
  });

  describe('isValidModel()', () => {
    it('returns true for tier aliases', () => {
      expect(isValidModel('fast', 'copilot')).toBe(true);
      expect(isValidModel('premium', 'gemini')).toBe(true);
    });

    it('returns true for native models', () => {
      expect(isValidModel('claude-opus-4.6', 'copilot')).toBe(true);
      expect(isValidModel('gpt-5.2-codex', 'codex')).toBe(true);
      expect(isValidModel('gemini-2.5-pro', 'gemini')).toBe(true);
    });

    it('returns true for models with equivalence mappings', () => {
      expect(isValidModel('claude-opus-4.6', 'gemini')).toBe(true);
      expect(isValidModel('gpt-5.2-codex', 'claude')).toBe(true);
    });

    it('returns false for unknown models on single-provider CLIs', () => {
      expect(isValidModel('some-unknown-model', 'gemini')).toBe(false);
      expect(isValidModel('llama-3', 'codex')).toBe(false);
    });
  });
});
