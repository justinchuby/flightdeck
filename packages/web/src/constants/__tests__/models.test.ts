import { describe, it, expect } from 'vitest';
import { AVAILABLE_MODELS } from '../models';

describe('models', () => {
  describe('AVAILABLE_MODELS', () => {
    it('is a non-empty array of strings', () => {
      expect(Array.isArray(AVAILABLE_MODELS)).toBe(true);
      expect(AVAILABLE_MODELS.length).toBeGreaterThan(0);
      for (const m of AVAILABLE_MODELS) {
        expect(typeof m).toBe('string');
      }
    });

    it('contains major model families', () => {
      const hasAnthropic = AVAILABLE_MODELS.some((m) => m.startsWith('claude'));
      const hasOpenAI = AVAILABLE_MODELS.some((m) => m.startsWith('gpt'));
      const hasGoogle = AVAILABLE_MODELS.some((m) => m.startsWith('gemini'));
      expect(hasAnthropic).toBe(true);
      expect(hasOpenAI).toBe(true);
      expect(hasGoogle).toBe(true);
    });

    it('has no duplicate entries', () => {
      const unique = new Set(AVAILABLE_MODELS);
      expect(unique.size).toBe(AVAILABLE_MODELS.length);
    });
  });
});
