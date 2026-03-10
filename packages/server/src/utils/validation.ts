/**
 * Shared input validation utilities for route parameters.
 */

/**
 * Parse a string to an integer with bounds checking.
 * Returns `fallback` if the value is not a valid integer or is outside [min, max].
 */
export function parseIntBounded(value: unknown, min: number, max: number, fallback: number): number {
  const n = parseInt(String(value ?? ''), 10);
  if (isNaN(n) || n < min) return fallback;
  return Math.min(n, max);
}
