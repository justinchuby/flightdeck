import { describe, it, expect } from 'vitest';
import { splitCommandBlocks, hasUnclosedCommandBlock } from '../commandParser';

describe('splitCommandBlocks', () => {
  it('returns plain text unchanged', () => {
    expect(splitCommandBlocks('hello world')).toEqual(['hello world']);
  });

  it('splits a simple complete command', () => {
    const text = 'before ⟦⟦ CMD {} ⟧⟧ after';
    expect(splitCommandBlocks(text)).toEqual(['before ', '⟦⟦ CMD {} ⟧⟧', ' after']);
  });

  it('handles command with escaped newlines in JSON', () => {
    const text = '⟦⟦ DELEGATE {"task": "Fix\\n\\n## Summary\\n..."} ⟧⟧';
    const segments = splitCommandBlocks(text);
    expect(segments).toEqual([text]);
    expect(segments[0]).toMatch(/^⟦⟦/);
    expect(segments[0]).toMatch(/⟧⟧$/);
  });

  it('handles command with actual newlines in JSON', () => {
    const text = '⟦⟦ DELEGATE {"task": "Fix\n\n## Summary\n..."} ⟧⟧';
    const segments = splitCommandBlocks(text);
    expect(segments).toEqual([text]);
  });

  it('handles nested ⟦⟦ ⟧⟧ inside command JSON values', () => {
    const text = '⟦⟦ DELEGATE {"task": "Use ⟦⟦ COMMIT {} ⟧⟧ when done"} ⟧⟧';
    const segments = splitCommandBlocks(text);
    expect(segments).toEqual([text]);
    expect(segments[0]).toMatch(/^⟦⟦ DELEGATE/);
    expect(segments[0]).toMatch(/"} ⟧⟧$/);
  });

  it('handles multiple nested command examples in task', () => {
    const text = '⟦⟦ DELEGATE {"task": "Use ⟦⟦ LOCK_FILE {} ⟧⟧ then ⟦⟦ COMMIT {} ⟧⟧ when done"} ⟧⟧';
    const segments = splitCommandBlocks(text);
    expect(segments).toEqual([text]);
  });

  it('handles text before and after command with nested brackets', () => {
    const text = 'Planning:\n⟦⟦ DELEGATE {"task": "Fix.\\nUse ⟦⟦ COMPLETE_TASK {} ⟧⟧"} ⟧⟧\nDone.';
    const segments = splitCommandBlocks(text);
    expect(segments).toEqual([
      'Planning:\n',
      '⟦⟦ DELEGATE {"task": "Fix.\\nUse ⟦⟦ COMPLETE_TASK {} ⟧⟧"} ⟧⟧',
      '\nDone.',
    ]);
  });

  it('handles two consecutive commands', () => {
    const text = '⟦⟦ CMD1 {} ⟧⟧⟦⟦ CMD2 {} ⟧⟧';
    const segments = splitCommandBlocks(text);
    expect(segments).toEqual(['⟦⟦ CMD1 {} ⟧⟧', '⟦⟦ CMD2 {} ⟧⟧']);
  });

  it('handles unclosed command (streaming)', () => {
    const text = 'text ⟦⟦ DELEGATE {"task": "Fix';
    const segments = splitCommandBlocks(text);
    expect(segments).toEqual(['text ', '⟦⟦ DELEGATE {"task": "Fix']);
  });

  it('handles dangling ⟧⟧ (from previous message split)', () => {
    const text = ' the bug."} ⟧⟧ more text';
    const segments = splitCommandBlocks(text);
    // Dangling close brackets stay in the plain text segment
    expect(segments).toEqual([' the bug."} ⟧⟧ more text']);
  });

  it('handles empty string', () => {
    expect(splitCommandBlocks('')).toEqual([]);
  });

  it('handles escaped quotes in JSON strings', () => {
    const text = '⟦⟦ CMD {"msg": "He said \\"use ⟦⟦ COMMIT ⟧⟧\\""} ⟧⟧';
    const segments = splitCommandBlocks(text);
    expect(segments).toEqual([text]);
  });

  it('regression: multi-line DELEGATE with command examples does not truncate', () => {
    // This is the exact bug scenario: DELEGATE task contains \n and nested command examples
    const text = '⟦⟦ DELEGATE {"task": "Fix the bug.\\n\\n## Summary\\n\\nThe problem is in the parser.\\n\\n## What to do\\n\\nAcquire file locks before editing. Commit with COMMIT command when done.\\n\\nUse COMPLETE_TASK when finished:\\n⟦⟦ COMPLETE_TASK {\\"summary\\": \\"what you did\\"} ⟧⟧"} ⟧⟧';
    const segments = splitCommandBlocks(text);
    expect(segments.length).toBe(1);
    expect(segments[0]).toBe(text);
    expect(segments[0]).toMatch(/^⟦⟦ DELEGATE/);
    expect(segments[0]).toMatch(/"} ⟧⟧$/);
  });

  it('contrast: old regex would truncate at inner ⟧⟧', () => {
    const text = '⟦⟦ DELEGATE {"task": "Use ⟦⟦ COMMIT {} ⟧⟧ when done"} ⟧⟧';
    // Old regex behavior (broken):
    const oldSegments = text.split(/(⟦⟦[\s\S]*?⟧⟧)/g);
    expect(oldSegments[1]).not.toBe(text); // old regex truncates
    // New parser behavior (correct):
    const newSegments = splitCommandBlocks(text);
    expect(newSegments[0]).toBe(text); // new parser captures full command
  });
});

describe('hasUnclosedCommandBlock', () => {
  it('returns false for plain text', () => {
    expect(hasUnclosedCommandBlock('hello world')).toBe(false);
  });

  it('returns false for complete command', () => {
    expect(hasUnclosedCommandBlock('⟦⟦ CMD {} ⟧⟧')).toBe(false);
  });

  it('returns true for unclosed command', () => {
    expect(hasUnclosedCommandBlock('⟦⟦ DELEGATE {"task": "Fix')).toBe(true);
  });

  it('returns false for text after complete command', () => {
    expect(hasUnclosedCommandBlock('⟦⟦ CMD {} ⟧⟧ more text')).toBe(false);
  });

  it('returns true for unclosed command with nested complete command inside', () => {
    // Key regression: inner ⟧⟧ should NOT close the outer command
    const text = '⟦⟦ DELEGATE {"task": "Use ⟦⟦ COMPLETE_TASK {} ⟧⟧';
    expect(hasUnclosedCommandBlock(text)).toBe(true);
  });

  it('contrast: old heuristic fails with nested brackets', () => {
    const text = '⟦⟦ DELEGATE {"task": "Use ⟦⟦ COMPLETE_TASK {} ⟧⟧';
    // Old heuristic (broken):
    const oldResult = text.lastIndexOf('⟦') > text.lastIndexOf('⟧');
    expect(oldResult).toBe(false); // old heuristic says "closed" — WRONG
    // New function (correct):
    expect(hasUnclosedCommandBlock(text)).toBe(true);
  });

  it('returns true for unclosed command with multiple nested commands', () => {
    const text = '⟦⟦ DELEGATE {"task": "Use ⟦⟦ LOCK {} ⟧⟧ then ⟦⟦ COMMIT {} ⟧⟧';
    expect(hasUnclosedCommandBlock(text)).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(hasUnclosedCommandBlock('')).toBe(false);
  });

  it('returns false for dangling ⟧⟧', () => {
    expect(hasUnclosedCommandBlock('"} ⟧⟧')).toBe(false);
  });

  it('handles escaped quotes in JSON strings', () => {
    const text = '⟦⟦ CMD {"msg": "He said \\"use ⟦⟦ COMMIT ⟧⟧\\"';
    expect(hasUnclosedCommandBlock(text)).toBe(true);
  });
});
