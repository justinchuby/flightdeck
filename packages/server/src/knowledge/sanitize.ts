/**
 * Knowledge content sanitization — shared utility.
 *
 * Extracted from KnowledgeInjector to enable write-boundary sanitization
 * in KnowledgeStore.put() without circular imports.
 *
 * Defense-in-depth: sanitize at WRITE time (KnowledgeStore.put) AND
 * at READ time (KnowledgeInjector.inject) so content is always safe.
 */

/** Maximum characters per knowledge entry after sanitization. */
export const MAX_ENTRY_CHARS = 500;

const TRUNCATION_SUFFIX = '…';

/**
 * Patterns that indicate prompt injection attempts.
 * Matched case-insensitively against entry content.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?prior\s+instructions/i,
  /disregard\s+(all\s+)?previous/i,
  /override\s+(system|previous)\s+(prompt|instructions)/i,
  /you\s+are\s+now\s+a/i,
  /new\s+instructions?\s*:/i,
  /system\s*:\s*you/i,
  /\bdo\s+not\s+follow\b.*\binstructions\b/i,
  /\bforget\b.*\binstructions\b/i,
  /\bact\s+as\b.*\binstead\b/i,
];

/**
 * Sanitize knowledge content to prevent prompt injection and control char attacks.
 *
 * 1. Strip control characters (except newline and tab).
 * 2. Strip XML closing tags that could break the trust boundary.
 * 3. Remove prompt-injection-style patterns.
 * 4. Truncate to MAX_ENTRY_CHARS.
 */
export function sanitizeContent(content: string): string {
  // Strip control characters (keep \n and \t for readability)
  // eslint-disable-next-line no-control-regex
  let sanitized = content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Strip XML closing tags that could escape the <project-context> boundary.
  sanitized = sanitized.replace(/<\s*\/?\s*project-context\s*>/gi, '[tag-removed]');

  // Neutralize prompt-injection patterns by replacing with [redacted]
  for (const pattern of INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[redacted]');
  }

  // Truncate to max length
  if (sanitized.length > MAX_ENTRY_CHARS) {
    sanitized = sanitized.slice(0, MAX_ENTRY_CHARS - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
  }

  return sanitized.trim();
}
