import { describe, it, expect } from 'vitest';
import { normalizeWsText } from '../normalizeText';

describe('normalizeWsText', () => {
  it('returns plain strings as-is', () => {
    expect(normalizeWsText('hello world')).toBe('hello world');
  });

  it('returns empty string as-is', () => {
    expect(normalizeWsText('')).toBe('');
  });

  it('extracts .text from object with text property', () => {
    expect(normalizeWsText({ text: 'from object' })).toBe('from object');
  });

  it('JSON-serializes objects without .text property', () => {
    expect(normalizeWsText({ foo: 'bar' })).toBe('{"foo":"bar"}');
  });

  it('JSON-serializes numbers', () => {
    expect(normalizeWsText(42)).toBe('42');
  });

  it('JSON-serializes null', () => {
    expect(normalizeWsText(null)).toBe('null');
  });

  it('JSON-serializes arrays', () => {
    expect(normalizeWsText([1, 2])).toBe('[1,2]');
  });

  it('handles object with non-string .text by JSON-serializing', () => {
    expect(normalizeWsText({ text: 123 })).toBe('{"text":123}');
  });
});
