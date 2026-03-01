import { describe, it, expect } from 'vitest';
import { CommandDispatcher } from '../agents/CommandDispatcher.js';

const normalize = CommandDispatcher.normalizeBrackets;

// ── normalizeBrackets ─────────────────────────────────────────────────

describe('normalizeBrackets', () => {
  // ── Legacy triple square brackets ───────────────────────────────────

  describe('legacy triple square brackets', () => {
    it('converts [[[ to single Unicode open bracket', () => {
      expect(normalize('[[[ COMMIT {"message": "fix"} ]]]')).toBe(
        '⟦ COMMIT {"message": "fix"} ⟧',
      );
    });

    it('converts multiple legacy commands in one buffer', () => {
      const input = '[[[ LOCK_FILE {"filePath": "a.ts"} ]]]\ntext\n[[[ COMMIT {"message": "fix"} ]]]';
      const result = normalize(input);
      expect(result).toContain('⟦ LOCK_FILE');
      expect(result).toContain('⟧\ntext\n⟦');
      expect(result).toContain('COMMIT {"message": "fix"} ⟧');
    });

    it('does not affect double square brackets', () => {
      expect(normalize('[[ not a command ]]')).toBe('[[ not a command ]]');
    });

    it('does not affect single square brackets', () => {
      expect(normalize('[ not a command ]')).toBe('[ not a command ]');
    });
  });

  // ── Doubled Unicode brackets (new preferred syntax) ─────────────────

  describe('doubled Unicode brackets', () => {
    it('normalizes doubled open/close to single', () => {
      expect(normalize('⟦⟦ COMMIT {"message": "fix"} ⟧⟧')).toBe(
        '⟦ COMMIT {"message": "fix"} ⟧',
      );
    });

    it('handles multiple doubled commands', () => {
      const input = '⟦⟦ LOCK_FILE {"filePath": "a.ts"} ⟧⟧\ntext\n⟦⟦ COMMIT {"message": "fix"} ⟧⟧';
      const result = normalize(input);
      expect(result).toBe('⟦ LOCK_FILE {"filePath": "a.ts"} ⟧\ntext\n⟦ COMMIT {"message": "fix"} ⟧');
    });

    it('handles no-payload commands with doubled brackets', () => {
      expect(normalize('⟦⟦ QUERY_CREW ⟧⟧')).toBe('⟦ QUERY_CREW ⟧');
    });
  });

  // ── Single Unicode brackets (current syntax, pass-through) ──────────

  describe('single Unicode brackets (pass-through)', () => {
    it('leaves single Unicode brackets unchanged', () => {
      expect(normalize('⟦ COMMIT {"message": "fix"} ⟧')).toBe(
        '⟦ COMMIT {"message": "fix"} ⟧',
      );
    });

    it('leaves no-payload commands unchanged', () => {
      expect(normalize('⟦ QUERY_CREW ⟧')).toBe('⟦ QUERY_CREW ⟧');
    });
  });

  // ── Backslash escaping ──────────────────────────────────────────────

  describe('backslash escaping', () => {
    it('replaces backslash-escaped open bracket with inert placeholder', () => {
      const result = normalize('use \\⟦ COMMIT \\⟧ to commit');
      // Should NOT contain the actual Unicode brackets (they were escaped)
      expect(result).not.toContain('⟦');
      expect(result).not.toContain('⟧');
    });

    it('escaped brackets do not form a command pattern', () => {
      const result = normalize('\\⟦ COMMIT {"message": "fix"} \\⟧');
      // The regex should not match because brackets were replaced with placeholders
      const COMMIT_REGEX = /⟦\s*COMMIT\s*(\{.*?\})\s*⟧/s;
      expect(result.match(COMMIT_REGEX)).toBeNull();
    });

    it('mixes escaped and real brackets correctly', () => {
      const input = 'Use \\⟦ as example. ⟦ COMMIT {"message": "fix"} ⟧';
      const result = normalize(input);
      // Real command should still have its brackets
      const COMMIT_REGEX = /⟦\s*COMMIT\s*(\{.*?\})\s*⟧/s;
      expect(result.match(COMMIT_REGEX)).toBeTruthy();
    });
  });

  // ── Mixed syntax ────────────────────────────────────────────────────

  describe('mixed syntax in one buffer', () => {
    it('normalizes all three syntaxes to single Unicode brackets', () => {
      const input = [
        '[[[ LOCK_FILE {"filePath": "a.ts"} ]]]',
        '⟦⟦ AGENT_MESSAGE {"to": "abc", "content": "hi"} ⟧⟧',
        '⟦ COMMIT {"message": "fix"} ⟧',
      ].join('\n');

      const result = normalize(input);
      const lines = result.split('\n');

      // All three should now use single Unicode brackets
      expect(lines[0]).toBe('⟦ LOCK_FILE {"filePath": "a.ts"} ⟧');
      expect(lines[1]).toBe('⟦ AGENT_MESSAGE {"to": "abc", "content": "hi"} ⟧');
      expect(lines[2]).toBe('⟦ COMMIT {"message": "fix"} ⟧');
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(normalize('')).toBe('');
    });

    it('handles text with no brackets', () => {
      expect(normalize('just plain text')).toBe('just plain text');
    });

    it('handles adjacent doubled brackets (quadrupled)', () => {
      // ⟦⟦⟦⟦ should become ⟦⟦ (two pairs each become one)
      expect(normalize('⟦⟦⟦⟦')).toBe('⟦⟦');
    });

    it('handles tripled Unicode brackets', () => {
      // ⟦⟦⟦ -> first pair becomes ⟦, leftover ⟦ stays = ⟦⟦
      // But replace is global left-to-right: ⟦⟦ -> ⟦, then ⟦ stays = ⟦⟦
      const result = normalize('⟦⟦⟦');
      // JS replace(/⟦⟦/g, '⟦') on '⟦⟦⟦' matches at pos 0, replaces first pair → '⟦⟦'... 
      // Actually: '⟦⟦⟦'.replace(/⟦⟦/g, '⟦') = '⟦⟦' because after replacing pos 0-1, 
      // pos 2 is a lone ⟦, so result is ⟦ + ⟦ = '⟦⟦'
      expect(result).toBe('⟦⟦');
    });
  });
});

// ── Integration: regex matching after normalization ────────────────────

describe('Command regex matching after normalization', () => {
  const COMMIT_REGEX = /⟦\s*COMMIT\s*(\{.*?\})\s*⟧/s;
  const QUERY_CREW_REGEX = /⟦\s*QUERY_CREW\s*⟧/s;
  const AGENT_MSG_REGEX = /⟦\s*AGENT_MESSAGE\s*(\{.*?\})\s*⟧/s;
  const BROADCAST_REGEX = /⟦\s*BROADCAST\s*(\{.*?\})\s*⟧/s;
  const DELEGATE_REGEX = /⟦\s*DELEGATE\s*(\{.*?\})\s*⟧/s;

  it('legacy triple brackets match COMMIT regex after normalization', () => {
    const input = normalize('[[[ COMMIT {"message": "fix bug"} ]]]');
    const match = input.match(COMMIT_REGEX);
    expect(match).toBeTruthy();
    expect(JSON.parse(match![1]).message).toBe('fix bug');
  });

  it('doubled Unicode brackets match COMMIT regex after normalization', () => {
    const input = normalize('⟦⟦ COMMIT {"message": "fix bug"} ⟧⟧');
    const match = input.match(COMMIT_REGEX);
    expect(match).toBeTruthy();
    expect(JSON.parse(match![1]).message).toBe('fix bug');
  });

  it('single Unicode brackets match COMMIT regex (pass-through)', () => {
    const input = normalize('⟦ COMMIT {"message": "fix bug"} ⟧');
    const match = input.match(COMMIT_REGEX);
    expect(match).toBeTruthy();
    expect(JSON.parse(match![1]).message).toBe('fix bug');
  });

  it('legacy QUERY_CREW matches after normalization', () => {
    expect(normalize('[[[ QUERY_CREW ]]]').match(QUERY_CREW_REGEX)).toBeTruthy();
  });

  it('doubled QUERY_CREW matches after normalization', () => {
    expect(normalize('⟦⟦ QUERY_CREW ⟧⟧').match(QUERY_CREW_REGEX)).toBeTruthy();
  });

  it('legacy AGENT_MESSAGE matches after normalization', () => {
    const input = normalize('[[[ AGENT_MESSAGE {"to": "abc", "content": "hello"} ]]]');
    const match = input.match(AGENT_MSG_REGEX);
    expect(match).toBeTruthy();
    expect(JSON.parse(match![1]).content).toBe('hello');
  });

  it('doubled BROADCAST matches after normalization', () => {
    const input = normalize('⟦⟦ BROADCAST {"content": "team update"} ⟧⟧');
    const match = input.match(BROADCAST_REGEX);
    expect(match).toBeTruthy();
    expect(JSON.parse(match![1]).content).toBe('team update');
  });

  it('legacy DELEGATE matches after normalization', () => {
    const input = normalize('[[[ DELEGATE {"to": "dev", "task": "Fix auth"} ]]]');
    const match = input.match(DELEGATE_REGEX);
    expect(match).toBeTruthy();
    expect(JSON.parse(match![1]).to).toBe('dev');
  });

  it('escaped brackets do NOT match any command regex', () => {
    const input = normalize('\\⟦ COMMIT {"message": "fix"} \\⟧');
    expect(input.match(COMMIT_REGEX)).toBeNull();
  });

  it('mixed: real command found alongside escaped brackets', () => {
    const input = normalize(
      'See \\⟦ COMMIT \\⟧ for examples.\n⟦⟦ BROADCAST {"content": "done"} ⟧⟧'
    );
    // Escaped should not match
    expect(input.match(COMMIT_REGEX)).toBeNull();
    // Real doubled command should match
    expect(input.match(BROADCAST_REGEX)).toBeTruthy();
  });
});

// ── Ordering safety: normalization prevents partial matching (#b735f62b) ──

describe('Doubled brackets cannot be partially consumed by single-bracket regex', () => {
  const COMMIT_REGEX = /⟦\s*COMMIT\s*(\{.*?\})\s*⟧/s;
  const LOCK_REGEX = /⟦\s*LOCK_FILE\s*(\{.*?\})\s*⟧/s;

  it('doubled open bracket does not leave a stray single bracket after match', () => {
    // Concern: if regex ran on raw '⟦⟦ COMMIT ... ⟧⟧', it might match the
    // inner '⟦ COMMIT ... ⟧' and leave stray ⟦ and ⟧ in the buffer.
    // normalizeBrackets prevents this by collapsing doubled to single first.
    const raw = '⟦⟦ COMMIT {"message": "fix"} ⟧⟧';
    const normalized = normalize(raw);

    // After normalization, exactly one ⟦ and one ⟧ remain
    expect(normalized).toBe('⟦ COMMIT {"message": "fix"} ⟧');
    expect((normalized.match(/⟦/g) || []).length).toBe(1);
    expect((normalized.match(/⟧/g) || []).length).toBe(1);

    // The regex matches cleanly
    const match = normalized.match(COMMIT_REGEX);
    expect(match).toBeTruthy();

    // After consuming the match, no stray brackets remain
    const remainder = normalized.replace(COMMIT_REGEX, '');
    expect(remainder).not.toContain('⟦');
    expect(remainder).not.toContain('⟧');
  });

  it('adjacent doubled commands do not interfere with each other', () => {
    const raw = '⟦⟦ LOCK_FILE {"filePath": "a.ts"} ⟧⟧ text ⟦⟦ COMMIT {"message": "done"} ⟧⟧';
    const normalized = normalize(raw);

    // Both commands should be independently matchable
    expect(normalized.match(LOCK_REGEX)).toBeTruthy();
    expect(normalized.match(COMMIT_REGEX)).toBeTruthy();

    // Exactly two of each bracket
    expect((normalized.match(/⟦/g) || []).length).toBe(2);
    expect((normalized.match(/⟧/g) || []).length).toBe(2);
  });

  it('mixed doubled and single commands in same buffer are all matchable', () => {
    const raw = '⟦⟦ LOCK_FILE {"filePath": "a.ts"} ⟧⟧ then ⟦ COMMIT {"message": "done"} ⟧';
    const normalized = normalize(raw);

    expect(normalized.match(LOCK_REGEX)).toBeTruthy();
    expect(normalized.match(COMMIT_REGEX)).toBeTruthy();
  });

  it('doubled brackets inside JSON strings do not leak', () => {
    // If an agent puts doubled brackets inside a JSON value string,
    // the normalization converts them but isInsideCommandBlock catches them
    const raw = '⟦⟦ COMMIT {"message": "use ⟦⟦ LOCK ⟧⟧ syntax"} ⟧⟧';
    const normalized = normalize(raw);

    // The outer command should match
    const match = normalized.match(COMMIT_REGEX);
    expect(match).toBeTruthy();
    // The JSON value contains normalized brackets but that's handled by isInsideCommandBlock
  });
});

// ── isInsideCommandBlock works with normalized content ─────────────────

describe('isInsideCommandBlock after normalization', () => {
  const check = CommandDispatcher.isInsideCommandBlock;

  it('works with legacy brackets after normalization', () => {
    const buf = normalize('[[[ OUTER [[[ INNER ]]] ]]]');
    // After normalization: ⟦ OUTER ⟦ INNER ⟧ ⟧
    const innerPos = buf.indexOf('⟦', 2);
    expect(check(buf, innerPos)).toBe(true);
  });

  it('works with doubled brackets after normalization', () => {
    const buf = normalize('⟦⟦ OUTER ⟦⟦ INNER ⟧⟧ ⟧⟧');
    // After normalization: ⟦ OUTER ⟦ INNER ⟧ ⟧
    const innerPos = buf.indexOf('⟦', 2);
    expect(check(buf, innerPos)).toBe(true);
  });
});
