import { describe, it, expect } from 'vitest';
import { CommandDispatcher } from '../agents/CommandDispatcher.js';

describe('isInsideCommandBlock', () => {
  const check = CommandDispatcher.isInsideCommandBlock;

  it('returns false for top-level position', () => {
    expect(check('some text here', 5)).toBe(false);
  });

  it('returns true when inside a [[[ ]]] block', () => {
    //                     pos 10 is inside the outer block
    const buf = '[[[ OUTER [[[ INNER ]]] ]]]';
    expect(check(buf, 10)).toBe(true);
  });

  it('returns false after a closed [[[ ]]] block', () => {
    const buf = '[[[ FIRST ]]] second part';
    expect(check(buf, 14)).toBe(false);
  });

  it('returns true when inside a JSON string literal', () => {
    // The [[[ at pos 21 is inside the "task" string value
    const buf = '{"task": "use [[[ COMMIT ]]] here"}';
    const pos = buf.indexOf('[[[', 10);
    expect(check(buf, pos)).toBe(true);
  });

  it('returns false when after a closed JSON string', () => {
    const buf = '"example" [[[ COMMIT {"message": "fix"} ]]]';
    const pos = buf.indexOf('[[[');
    expect(check(buf, pos)).toBe(false);
  });

  it('handles escaped quotes inside strings', () => {
    // The string contains an escaped quote — [[[  is still inside the string
    const buf = '{"task": "He said \\"use [[[ COMMIT ]]]\\"."}';
    const pos = buf.indexOf('[[[');
    expect(check(buf, pos)).toBe(true);
  });

  it('handles backtick code examples as regular text (not strings)', () => {
    // Backticks are not JSON strings — [[[ should be parseable
    const buf = 'Use `[[[ COMMIT {"message": "fix"} ]]]` to commit';
    const pos = buf.indexOf('[[[');
    expect(check(buf, pos)).toBe(false);
  });

  it('returns false for command at start of buffer', () => {
    const buf = '[[[ COMMIT {"message": "fix"} ]]]';
    expect(check(buf, 0)).toBe(false);
  });

  it('handles real-world CREATE_AGENT with embedded command in task', () => {
    const buf = '[[[ CREATE_AGENT {"role": "dev", "task": "Fix bug. Use [[[ COMMIT ]]] to commit"} ]]]';
    const innerPos = buf.indexOf('[[[', 4); // second [[[ inside the JSON string
    expect(check(buf, innerPos)).toBe(true);
  });

  it('handles multiple sequential commands correctly', () => {
    const buf = '[[[ LOCK_FILE {"filePath": "a.ts"} ]]] some text [[[ COMMIT {"message": "fix"} ]]]';
    const secondPos = buf.indexOf('[[[', 4);
    expect(check(buf, secondPos)).toBe(false);
  });
});
