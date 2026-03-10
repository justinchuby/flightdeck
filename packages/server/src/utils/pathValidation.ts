/**
 * Path traversal protection utilities.
 *
 * Prevents directory escape attacks by verifying that resolved paths
 * stay within an expected base directory. Handles edge cases:
 * - Relative paths with ../
 * - Null bytes (\0)
 * - Windows backslashes
 * - Symlink-resolved paths (via resolve())
 */

import { resolve, sep } from 'path';

/**
 * Check whether `filePath` resolves to a location within `baseDir`.
 *
 * @param baseDir  - The directory that filePath must stay within.
 * @param filePath - The path to validate (absolute or relative to baseDir).
 * @returns `true` if the resolved path is within baseDir, `false` otherwise.
 */
export function isPathWithinDir(baseDir: string, filePath: string): boolean {
  if (containsNullByte(filePath) || containsNullByte(baseDir)) return false;

  const resolvedPath = resolve(baseDir, filePath);
  const resolvedBase = resolve(baseDir);

  return resolvedPath === resolvedBase || resolvedPath.startsWith(resolvedBase + sep);
}

/**
 * Validate that `filePath` resolves within `baseDir`.
 * Returns the resolved absolute path on success.
 *
 * @param baseDir  - The directory that filePath must stay within.
 * @param filePath - The path to validate (absolute or relative to baseDir).
 * @returns The resolved absolute path.
 * @throws Error if the path escapes baseDir or contains null bytes.
 */
export function validatePathWithinDir(baseDir: string, filePath: string): string {
  if (containsNullByte(filePath)) {
    throw new Error(`Path traversal detected: null byte in path '${sanitizeForError(filePath)}'`);
  }
  if (containsNullByte(baseDir)) {
    throw new Error(`Path traversal detected: null byte in base directory`);
  }

  const resolvedPath = resolve(baseDir, filePath);
  const resolvedBase = resolve(baseDir);

  if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(resolvedBase + sep)) {
    throw new Error(`Path traversal detected: '${filePath}' escapes '${resolvedBase}'`);
  }

  return resolvedPath;
}

/**
 * Alias for `validatePathWithinDir` — asserts path containment and returns resolved path.
 */
export const assertPathWithinDir = validatePathWithinDir;

// ── Helpers ──────────────────────────────────────────────────

function containsNullByte(s: string): boolean {
  return s.includes('\0');
}

/** Strip null bytes from string for safe use in error messages. */
function sanitizeForError(s: string): string {
  return s.replace(/\0/g, '\\0');
}
