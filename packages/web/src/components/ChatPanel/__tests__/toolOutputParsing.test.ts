import { describe, it, expect } from 'vitest';
import { splitToolOutput, findCommonPrefix } from '../../Shared/toolOutput';

describe('splitToolOutput', () => {
  it('returns a single text part when there are no Info: lines', () => {
    const result = splitToolOutput('Hello world\nNo info here');
    expect(result).toEqual([{ type: 'text', text: 'Hello world\nNo info here' }]);
  });

  it('returns a single tool-output part for only Info: lines', () => {
    const input = 'Info: /path/to/a.ts\nInfo: /path/to/b.ts';
    const result = splitToolOutput(input);
    expect(result).toEqual([
      { type: 'tool-output', lines: ['Info: /path/to/a.ts', 'Info: /path/to/b.ts'] },
    ]);
  });

  it('splits mixed text and Info: lines', () => {
    const input = 'Some text\nInfo: /path/a\nInfo: /path/b\nMore text';
    const result = splitToolOutput(input);
    expect(result).toEqual([
      { type: 'text', text: 'Some text' },
      { type: 'tool-output', lines: ['Info: /path/a', 'Info: /path/b'] },
      { type: 'text', text: 'More text' },
    ]);
  });

  it('handles multiple separate Info: groups', () => {
    const input = 'Info: /a\ntext\nInfo: /b\nInfo: /c';
    const result = splitToolOutput(input);
    expect(result).toEqual([
      { type: 'tool-output', lines: ['Info: /a'] },
      { type: 'text', text: 'text' },
      { type: 'tool-output', lines: ['Info: /b', 'Info: /c'] },
    ]);
  });

  it('treats bare absolute paths as tool output', () => {
    const input = '/usr/local/bin/node\n/usr/local/bin/npm';
    const result = splitToolOutput(input);
    expect(result).toEqual([
      { type: 'tool-output', lines: ['/usr/local/bin/node', '/usr/local/bin/npm'] },
    ]);
  });

  it('handles empty string', () => {
    const result = splitToolOutput('');
    expect(result).toEqual([{ type: 'text', text: '' }]);
  });

  it('handles single Info: line surrounded by text', () => {
    const input = 'before\nInfo: /path/file.ts\nafter';
    const result = splitToolOutput(input);
    expect(result).toEqual([
      { type: 'text', text: 'before' },
      { type: 'tool-output', lines: ['Info: /path/file.ts'] },
      { type: 'text', text: 'after' },
    ]);
  });

  it('does not treat inline Info: text as tool output', () => {
    // "Info:" not at the start of a line — should remain plain text
    const input = 'See Info: details here';
    const result = splitToolOutput(input);
    expect(result).toEqual([{ type: 'text', text: 'See Info: details here' }]);
  });

  it('handles Info: lines with spaces in paths', () => {
    const input = 'Info: /path/to/my file.ts';
    const result = splitToolOutput(input);
    expect(result).toEqual([{ type: 'tool-output', lines: ['Info: /path/to/my file.ts'] }]);
  });
});

describe('findCommonPrefix', () => {
  it('returns empty string for single path', () => {
    expect(findCommonPrefix(['/a/b/c'])).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(findCommonPrefix([])).toBe('');
  });

  it('finds common prefix for paths with shared directories', () => {
    const paths = [
      '/Users/justinc/project/src/a.ts',
      '/Users/justinc/project/src/b.ts',
      '/Users/justinc/project/src/c.ts',
    ];
    expect(findCommonPrefix(paths)).toBe('/Users/justinc/project/src/');
  });

  it('finds common prefix stopping at divergence', () => {
    const paths = [
      '/Users/justinc/project/src/a.ts',
      '/Users/justinc/project/lib/b.ts',
    ];
    expect(findCommonPrefix(paths)).toBe('/Users/justinc/project/');
  });

  it('returns empty string when paths share only root', () => {
    const paths = ['/a/file.ts', '/b/file.ts'];
    expect(findCommonPrefix(paths)).toBe('');
  });

  it('handles paths with no common prefix', () => {
    const paths = ['src/a.ts', 'lib/b.ts'];
    expect(findCommonPrefix(paths)).toBe('');
  });
});
