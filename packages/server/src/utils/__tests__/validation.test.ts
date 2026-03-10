import { describe, it, expect } from 'vitest';
import { parseIntBounded } from '../validation.js';

describe('parseIntBounded', () => {
  it('parses valid integer within bounds', () => {
    expect(parseIntBounded('50', 1, 100, 10)).toBe(50);
  });

  it('clamps value above max', () => {
    expect(parseIntBounded('500', 1, 100, 10)).toBe(100);
  });

  it('returns fallback for value below min', () => {
    expect(parseIntBounded('0', 1, 100, 10)).toBe(10);
    expect(parseIntBounded('-5', 1, 100, 10)).toBe(10);
  });

  it('returns fallback for NaN input', () => {
    expect(parseIntBounded('abc', 1, 100, 10)).toBe(10);
    expect(parseIntBounded(undefined, 1, 100, 10)).toBe(10);
    expect(parseIntBounded(null, 1, 100, 10)).toBe(10);
    expect(parseIntBounded('', 1, 100, 10)).toBe(10);
  });

  it('handles exact boundary values', () => {
    expect(parseIntBounded('1', 1, 100, 10)).toBe(1);
    expect(parseIntBounded('100', 1, 100, 10)).toBe(100);
  });

  it('handles numeric input', () => {
    expect(parseIntBounded(42, 1, 100, 10)).toBe(42);
  });
});
