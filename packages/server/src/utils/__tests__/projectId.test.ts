import { describe, it, expect } from 'vitest';
import { slugify, generateProjectId, isValidProjectId } from '../projectId.js';

describe('slugify', () => {
  it('converts simple title to slug', () => {
    expect(slugify('My Cool Project')).toBe('my-cool-project');
  });

  it('handles special characters', () => {
    expect(slugify('Hello, World! @2024')).toBe('hello-world-2024');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('foo---bar')).toBe('foo-bar');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  it('returns default slug for empty string', () => {
    expect(slugify('')).toBe('project');
  });

  it('returns default slug for whitespace-only', () => {
    expect(slugify('   ')).toBe('project');
  });

  it('returns default slug for only special characters', () => {
    expect(slugify('!!!@@@###')).toBe('project');
  });

  it('handles unicode/diacritics', () => {
    expect(slugify('Café Résumé')).toBe('cafe-resume');
  });

  it('handles CJK/emoji by stripping them', () => {
    const result = slugify('项目 🚀 Launch');
    expect(result).toBe('launch');
  });

  it('truncates long titles to 40 chars', () => {
    const longTitle = 'a'.repeat(60);
    const slug = slugify(longTitle);
    expect(slug.length).toBeLessThanOrEqual(40);
  });

  it('does not leave trailing hyphen after truncation', () => {
    const title = 'word-'.repeat(10); // "word-word-word-..." → truncated
    const slug = slugify(title);
    expect(slug).not.toMatch(/-$/);
  });

  it('handles mixed case', () => {
    expect(slugify('FlightDeck Server')).toBe('flightdeck-server');
  });

  it('handles numbers', () => {
    expect(slugify('Project v2.0')).toBe('project-v2-0');
  });

  it('prefixes Windows reserved device names', () => {
    expect(slugify('CON')).toBe('p-con');
    expect(slugify('nul')).toBe('p-nul');
    expect(slugify('PRN')).toBe('p-prn');
    expect(slugify('AUX')).toBe('p-aux');
    expect(slugify('COM1')).toBe('p-com1');
    expect(slugify('LPT9')).toBe('p-lpt9');
  });

  it('does not prefix non-reserved names containing reserved words', () => {
    expect(slugify('console')).toBe('console');
    expect(slugify('null-project')).toBe('null-project');
    expect(slugify('auxiliary')).toBe('auxiliary');
  });
});

describe('generateProjectId', () => {
  it('produces slug-xxxxxx format (6 hex chars)', () => {
    const id = generateProjectId('My Project');
    expect(id).toMatch(/^my-project-[a-f0-9]{6}$/);
  });

  it('handles empty title', () => {
    const id = generateProjectId('');
    expect(id).toMatch(/^project-[a-f0-9]{6}$/);
  });

  it('handles whitespace-only title', () => {
    const id = generateProjectId('   ');
    expect(id).toMatch(/^project-[a-f0-9]{6}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateProjectId('Test'));
    }
    // With 3 bytes of randomness (16.7M possibilities), 100 should always be unique
    expect(ids.size).toBe(100);
  });

  it('avoids collisions with existing IDs', () => {
    const existing = new Set(['test-aabbcc', 'test-ddeeff']);
    const id = generateProjectId('Test', existing);
    expect(existing.has(id)).toBe(false);
    expect(id).toMatch(/^test-[a-f0-9]{6}$/);
  });

  it('falls back to 12 hex chars after maxRetries collisions', () => {
    // Collision function that always returns true for 6-char suffixes
    let callCount = 0;
    const alwaysCollides = (id: string) => {
      callCount++;
      // Allow the final 12-char attempt through
      return id.match(/^test-[a-f0-9]{6}$/) !== null;
    };
    const id = generateProjectId('Test', alwaysCollides, 3);
    expect(callCount).toBe(3); // 3 retries (fallback doesn't check)
    expect(id).toMatch(/^test-[a-f0-9]{12}$/);
  });

  it('accepts function-based collision checker', () => {
    const blocked = 'my-project-0000';
    const id = generateProjectId('My Project', (candidate) => candidate === blocked);
    expect(id).not.toBe(blocked);
  });

  it('handles unicode titles', () => {
    const id = generateProjectId('Café Résumé');
    expect(id).toMatch(/^cafe-resume-[a-f0-9]{6}$/);
  });

  it('handles very long titles', () => {
    const longTitle = 'This is a very long project title that exceeds the maximum slug length limit';
    const id = generateProjectId(longTitle);
    // slug portion (before last -xxxxxx) should be ≤ 40 chars
    const parts = id.split('-');
    const suffix = parts.pop()!;
    const slugPortion = parts.join('-');
    expect(suffix).toMatch(/^[a-f0-9]{6}$/);
    expect(slugPortion.length).toBeLessThanOrEqual(40);
  });
});

describe('isValidProjectId', () => {
  it('accepts new slug format with 6 hex chars', () => {
    expect(isValidProjectId('my-project-a3f7b2')).toBe(true);
  });

  it('accepts fallback slug format with 12 hex chars', () => {
    expect(isValidProjectId('my-project-a3f7b2e1c4d5')).toBe(true);
  });

  it('still accepts legacy 4 hex char format', () => {
    expect(isValidProjectId('my-project-a3f7')).toBe(true);
  });

  it('accepts legacy UUID format', () => {
    expect(isValidProjectId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidProjectId('')).toBe(false);
  });

  it('rejects random strings', () => {
    expect(isValidProjectId('not-a-valid-id')).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(isValidProjectId(null as any)).toBe(false);
    expect(isValidProjectId(undefined as any)).toBe(false);
  });

  it('accepts simple slug-hex pattern', () => {
    expect(isValidProjectId('project-abcd')).toBe(true);
    expect(isValidProjectId('flightdeck-1234')).toBe(true);
  });
});
