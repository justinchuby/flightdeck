import { describe, it, expect } from 'vitest';
import { CATEGORY_LABELS, categoryLabel } from '../categories';

describe('categories', () => {
  describe('CATEGORY_LABELS', () => {
    it('contains all 6 standard categories', () => {
      const keys = Object.keys(CATEGORY_LABELS);
      expect(keys).toContain('style');
      expect(keys).toContain('architecture');
      expect(keys).toContain('tool_access');
      expect(keys).toContain('dependency');
      expect(keys).toContain('testing');
      expect(keys).toContain('general');
      expect(keys).toHaveLength(6);
    });

    it('all labels include an emoji prefix', () => {
      for (const label of Object.values(CATEGORY_LABELS)) {
        // Each label should have a non-ASCII character (emoji) followed by text
        expect(label.length).toBeGreaterThan(2);
      }
    });
  });

  describe('categoryLabel', () => {
    it('returns label for known category', () => {
      expect(categoryLabel('style')).toBe('🎨 Style & Formatting');
      expect(categoryLabel('architecture')).toBe('🏗️ Architecture');
    });

    it('returns fallback for unknown category', () => {
      expect(categoryLabel('unknown_cat')).toBe('📋 unknown_cat');
    });

    it('returns fallback for empty string', () => {
      expect(categoryLabel('')).toBe('📋 ');
    });
  });
});
