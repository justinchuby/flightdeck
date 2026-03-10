import { describe, it, expect } from 'vitest';
import { join, resolve, sep } from 'path';
import { isPathWithinDir, validatePathWithinDir, assertPathWithinDir } from '../pathValidation.js';

const BASE = '/tmp/project';

describe('isPathWithinDir', () => {
  it('accepts a simple filename', () => {
    expect(isPathWithinDir(BASE, 'file.txt')).toBe(true);
  });

  it('accepts a nested path', () => {
    expect(isPathWithinDir(BASE, 'sub/dir/file.txt')).toBe(true);
  });

  it('accepts the base directory itself', () => {
    expect(isPathWithinDir(BASE, '.')).toBe(true);
    expect(isPathWithinDir(BASE, '')).toBe(true);
  });

  it('rejects ../ that escapes the base', () => {
    expect(isPathWithinDir(BASE, '../escape.txt')).toBe(false);
  });

  it('rejects deeply nested ../ escape', () => {
    expect(isPathWithinDir(BASE, 'sub/../../escape.txt')).toBe(false);
  });

  it('allows ../ that stays within base', () => {
    expect(isPathWithinDir(BASE, 'sub/../file.txt')).toBe(true);
  });

  it('rejects null bytes in path', () => {
    expect(isPathWithinDir(BASE, 'file\0.txt')).toBe(false);
  });

  it('rejects null bytes in base dir', () => {
    expect(isPathWithinDir('/tmp\0/project', 'file.txt')).toBe(false);
  });

  it('rejects absolute path outside base', () => {
    expect(isPathWithinDir(BASE, '/etc/passwd')).toBe(false);
  });

  it('accepts absolute path within base', () => {
    expect(isPathWithinDir(BASE, join(BASE, 'file.txt'))).toBe(true);
  });

  it('rejects base dir prefix that is not a directory boundary', () => {
    // /tmp/project-evil should NOT match /tmp/project
    expect(isPathWithinDir(BASE, '/tmp/project-evil/file.txt')).toBe(false);
  });
});

describe('validatePathWithinDir', () => {
  it('returns resolved path for valid paths', () => {
    const result = validatePathWithinDir(BASE, 'file.txt');
    expect(result).toBe(resolve(BASE, 'file.txt'));
  });

  it('returns resolved path for nested paths', () => {
    const result = validatePathWithinDir(BASE, 'a/b/c.txt');
    expect(result).toBe(resolve(BASE, 'a/b/c.txt'));
  });

  it('returns base dir for empty path', () => {
    const result = validatePathWithinDir(BASE, '');
    expect(result).toBe(resolve(BASE));
  });

  it('throws on ../ escape', () => {
    expect(() => validatePathWithinDir(BASE, '../escape')).toThrow('Path traversal detected');
  });

  it('throws with descriptive message including file path', () => {
    expect(() => validatePathWithinDir(BASE, '../../etc/passwd')).toThrow("escapes '/tmp/project'");
  });

  it('throws on null byte in path', () => {
    expect(() => validatePathWithinDir(BASE, 'file\0.txt')).toThrow('null byte');
  });

  it('throws on null byte in base dir', () => {
    expect(() => validatePathWithinDir('/tmp\0/evil', 'file.txt')).toThrow('null byte');
  });

  it('throws on absolute path outside base', () => {
    expect(() => validatePathWithinDir(BASE, '/etc/shadow')).toThrow('Path traversal detected');
  });

  it('handles Windows-style backslashes in path', () => {
    // On Unix, backslash is a valid filename char, but resolve normalizes it
    // The key behavior: no escape should be possible regardless of separator
    expect(() => validatePathWithinDir(BASE, '..\\..\\etc\\passwd')).not.toThrow();
    // The above doesn't escape on Unix because \\ is treated as literal chars in filename
    // On Windows, resolve() would normalize backslashes and catch the traversal
  });
});

describe('assertPathWithinDir', () => {
  it('is an alias for validatePathWithinDir', () => {
    expect(assertPathWithinDir).toBe(validatePathWithinDir);
  });

  it('returns resolved path on success', () => {
    const result = assertPathWithinDir(BASE, 'sub/file.txt');
    expect(result).toBe(resolve(BASE, 'sub/file.txt'));
  });

  it('throws on escape', () => {
    expect(() => assertPathWithinDir(BASE, '../escape')).toThrow('Path traversal detected');
  });
});
