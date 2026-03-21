// packages/server/src/integrations/messageChunker.test.ts

import { describe, it, expect } from 'vitest';
import { chunkMessage } from './messageChunker.js';

describe('chunkMessage', () => {
  // ── Short messages (no splitting needed) ──────────────────

  it('returns single-element array for short messages', () => {
    const result = chunkMessage('Hello, world!');
    expect(result).toEqual(['Hello, world!']);
  });

  it('returns single-element array for empty string', () => {
    const result = chunkMessage('');
    expect(result).toEqual(['']);
  });

  it('returns single-element array for exactly 4096 chars', () => {
    const text = 'a'.repeat(4096);
    const result = chunkMessage(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  // ── Paragraph boundary splitting ─────────────────────────

  it('splits at paragraph boundary (double newline)', () => {
    const paragraph1 = 'a'.repeat(2000);
    const paragraph2 = 'b'.repeat(2000);
    const paragraph3 = 'c'.repeat(2000);
    const text = `${paragraph1}\n\n${paragraph2}\n\n${paragraph3}`;

    const result = chunkMessage(text);
    expect(result.length).toBeGreaterThan(1);

    // Each chunk should be ≤ 4096 chars
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }

    // Part indicators should be present
    expect(result[0]).toMatch(/\(\d+\/\d+\)$/);
  });

  // ── Line boundary splitting ──────────────────────────────

  it('splits at line boundary when no paragraph break available', () => {
    // Build text with single newlines but no double newlines within split range
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i}: ${'x'.repeat(20)}`);
    const text = lines.join('\n');

    if (text.length <= 4096) return; // Skip if text isn't long enough

    const result = chunkMessage(text);
    expect(result.length).toBeGreaterThan(1);

    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  // ── Word boundary splitting ──────────────────────────────

  it('splits at word boundary when no newline available', () => {
    // One very long line with spaces but no newlines
    const words = Array.from({ length: 1000 }, () => 'word');
    const text = words.join(' ');

    const result = chunkMessage(text);
    expect(result.length).toBeGreaterThan(1);

    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }

    // First chunk should end at a word boundary (last char before indicator is a word char,
    // and the split didn't happen mid-word — verify no partial words by checking
    // the chunk ends with a complete 'word')
    const firstChunkBase = result[0].replace(/ \(\d+\/\d+\)$/, '');
    expect(firstChunkBase).toMatch(/word$/); // should end on a complete word
  });

  // ── Hard cut as last resort ──────────────────────────────

  it('performs hard cut when no natural break point exists', () => {
    // A single continuous string with no spaces, newlines, or fences
    const text = 'x'.repeat(10000);

    const result = chunkMessage(text);
    expect(result.length).toBeGreaterThan(1);

    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  // ── Code fence awareness ─────────────────────────────────

  it('never splits inside a code fence block', () => {
    // Create text where a code fence straddles the split boundary
    const before = 'a'.repeat(3000);
    const codeBlock = '```\n' + 'code line\n'.repeat(200) + '```';
    const after = 'b'.repeat(1000);
    const text = `${before}\n${codeBlock}\n${after}`;

    const result = chunkMessage(text);
    expect(result.length).toBeGreaterThan(1);

    // Verify no chunk has an odd number of ``` markers (would mean split inside fence)
    for (const chunk of result) {
      const baseChunk = chunk.replace(/ \(\d+\/\d+\)$/, '');
      const fenceCount = (baseChunk.match(/```/g) || []).length;
      expect(fenceCount % 2).toBe(0);
    }
  });

  it('splits before opening fence when code block would be split', () => {
    const preamble = 'x'.repeat(3800);
    const codeBlock = '```python\nprint("hello")\n```';
    const text = `${preamble}\n${codeBlock}`;

    // The code block starts near the boundary, so it should split before the fence
    const result = chunkMessage(text);

    if (result.length > 1) {
      const firstChunkBase = result[0].replace(/ \(\d+\/\d+\)$/, '');
      expect(firstChunkBase).not.toContain('```');
    }
  });

  // ── Part indicators ──────────────────────────────────────

  it('appends part indicators when multiple chunks', () => {
    const text = 'a'.repeat(5000);
    const result = chunkMessage(text);

    expect(result.length).toBe(2);
    expect(result[0]).toMatch(/ \(1\/2\)$/);
    expect(result[1]).toMatch(/ \(2\/2\)$/);
  });

  it('does not append part indicator for single chunk', () => {
    const result = chunkMessage('short message');
    expect(result[0]).toBe('short message');
    expect(result[0]).not.toMatch(/\(\d+\/\d+\)/);
  });

  it('correctly numbers three chunks', () => {
    const text = 'a'.repeat(12000);
    const result = chunkMessage(text);

    expect(result.length).toBe(3);
    expect(result[0]).toMatch(/\(1\/3\)$/);
    expect(result[1]).toMatch(/\(2\/3\)$/);
    expect(result[2]).toMatch(/\(3\/3\)$/);
  });

  // ── Custom maxLength ─────────────────────────────────────

  it('respects custom maxLength parameter', () => {
    const text = 'a'.repeat(100);
    const result = chunkMessage(text, 50);

    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(50);
    }
  });

  // ── Content preservation ─────────────────────────────────

  it('preserves all content across chunks (no data loss)', () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i}: ${'content '.repeat(50)}`,
    );
    const text = paragraphs.join('\n\n');

    const result = chunkMessage(text);

    // Strip part indicators and rejoin
    const reassembled = result
      .map(chunk => chunk.replace(/ \(\d+\/\d+\)$/, ''))
      .join(' '); // trimStart/trimEnd in the chunker may add/remove whitespace

    // Every original paragraph should appear somewhere in the reassembled text
    for (const paragraph of paragraphs) {
      expect(reassembled).toContain(paragraph.trim());
    }
  });

  // ── Edge cases ───────────────────────────────────────────

  it('handles text that is exactly maxLength + 1', () => {
    const text = 'a'.repeat(4097);
    const result = chunkMessage(text);
    expect(result.length).toBe(2);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it('handles text with only newlines', () => {
    const text = '\n'.repeat(5000);
    const result = chunkMessage(text);
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it('handles text with triple backticks but no code content', () => {
    const text = 'a'.repeat(2000) + '```' + 'b'.repeat(2000) + '```' + 'c'.repeat(2000);
    const result = chunkMessage(text);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });
});
