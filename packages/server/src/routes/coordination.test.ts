import { describe, it, expect } from 'vitest';
import { normalize, isAbsolute } from 'node:path';

/** Mirror of the guard in coordination.ts — tested in isolation. */
function isTraversalPath(p: string): boolean {
  if (isAbsolute(p)) return true;
  const normalized = normalize(p).replace(/\\/g, '/');
  return normalized.startsWith('../') || normalized === '..' || normalized.includes('/../') || p.includes('\0');
}

describe('coordination path validation', () => {
  it('rejects ../ traversal', () => {
    expect(isTraversalPath('../etc/passwd')).toBe(true);
    expect(isTraversalPath('foo/../../etc/passwd')).toBe(true);
    expect(isTraversalPath('..')).toBe(true);
  });

  it('rejects absolute paths', () => {
    expect(isTraversalPath('/etc/passwd')).toBe(true);
  });

  it('rejects null bytes', () => {
    expect(isTraversalPath('foo\0bar')).toBe(true);
  });

  it('allows normal relative paths', () => {
    expect(isTraversalPath('src/index.ts')).toBe(false);
    expect(isTraversalPath('packages/server/src/routes/coordination.ts')).toBe(false);
    expect(isTraversalPath('README.md')).toBe(false);
  });

  it('allows paths with dots that are not traversal', () => {
    expect(isTraversalPath('.gitignore')).toBe(false);
    expect(isTraversalPath('src/.env')).toBe(false);
    expect(isTraversalPath('.flightdeck/config.yaml')).toBe(false);
  });
});
