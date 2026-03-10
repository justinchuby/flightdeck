import { randomBytes } from 'crypto';

/** Max length of the slug portion (before the -xxxx suffix) */
const MAX_SLUG_LENGTH = 40;

/** Default slug when title produces no usable characters */
const DEFAULT_SLUG = 'project';

/** Windows reserved device names that cannot be used as directory/file names */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Convert a title string to a URL-safe slug.
 * - Lowercases
 * - Replaces non-alphanumeric chars with hyphens
 * - Collapses consecutive hyphens
 * - Trims leading/trailing hyphens
 * - Truncates to MAX_SLUG_LENGTH
 */
export function slugify(title: string): string {
  let slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics (é→e, ñ→n)
    .replace(/[^a-z0-9]+/g, '-')     // non-alphanumeric → hyphens
    .replace(/-{2,}/g, '-')          // collapse multiple hyphens
    .replace(/^-|-$/g, '');          // trim leading/trailing hyphens

  if (!slug) return DEFAULT_SLUG;

  // Prevent Windows reserved device names (CON, NUL, PRN, AUX, COM1-9, LPT1-9)
  if (WINDOWS_RESERVED.test(slug)) slug = `p-${slug}`;

  // Truncate to max length, but don't cut in the middle of a word if possible
  if (slug.length > MAX_SLUG_LENGTH) {
    slug = slug.slice(0, MAX_SLUG_LENGTH);
    // Clean up trailing hyphen from truncation
    slug = slug.replace(/-$/, '');
  }

  return slug || DEFAULT_SLUG;
}

/**
 * Generate a random hex suffix of the given length.
 */
function randomHexSuffix(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Generate a human-readable project ID from a title.
 * Format: `slugified-title-xxxxxx` where xxxxxx is 6 random hex chars.
 *
 * @param title - Project title (can be empty, unicode, special chars, etc.)
 * @param existingIds - Set of existing project IDs to check for collisions
 * @param maxRetries - Maximum collision retries before using 12 hex chars (default: 5)
 * @returns A unique, human-readable project ID
 */
export function generateProjectId(
  title: string,
  existingIds?: Set<string> | ((id: string) => boolean),
  maxRetries = 5,
): string {
  const slug = slugify(title.trim());
  const isCollision = typeof existingIds === 'function'
    ? existingIds
    : existingIds
      ? (id: string) => existingIds.has(id)
      : () => false;

  // Try with 6 hex chars (3 bytes = 16.7M possibilities)
  for (let i = 0; i < maxRetries; i++) {
    const id = `${slug}-${randomHexSuffix(3)}`;
    if (!isCollision(id)) return id;
  }

  // Fallback: 12 hex chars (6 bytes) — practically collision-free
  const id = `${slug}-${randomHexSuffix(6)}`;
  return id;
}

/**
 * Check whether a string looks like a valid project ID (slug format).
 * Accepts both the new slug format and legacy UUIDs for backward compatibility.
 */
export function isValidProjectId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  // Legacy UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return true;
  // New slug format: slug-xxxxxx (6 hex) or slug-xxxxxxxxxxxx (12 hex fallback)
  if (/^[a-z0-9][a-z0-9-]*-[a-f0-9]{4,12}$/.test(id)) return true;
  return false;
}
