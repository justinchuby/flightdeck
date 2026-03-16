// packages/server/src/integrations/messageChunker.ts
// Markdown-aware message splitting for Telegram's 4096-char limit.
// Replaces the old truncation approach with multi-message delivery.

/** Telegram's maximum message length. */
const TELEGRAM_MAX_LENGTH = 4096;

/** Part indicator suffix like " (2/3)" — max 8 chars. */
const PART_SUFFIX_MAX = 8;

/** Effective max per chunk, reserving space for part indicator. */
const EFFECTIVE_MAX = TELEGRAM_MAX_LENGTH - PART_SUFFIX_MAX;

/** Minimum fraction of maxLen before we accept a split point (avoid tiny first chunks). */
const MIN_SPLIT_FRACTION = 0.3;

/**
 * Split a long message into Telegram-safe chunks.
 * Splitting priority (preserves readability):
 *   1. Double newline (paragraph boundary)
 *   2. Single newline (line boundary)
 *   3. Space (word boundary)
 *   4. Hard cut (last resort)
 *
 * Markdown fence awareness: never splits inside a ``` block.
 * Returns array of strings, each ≤ 4096 chars including part suffix.
 */
export function chunkMessage(text: string, maxLength = TELEGRAM_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const effectiveMax = maxLength - PART_SUFFIX_MAX;
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= effectiveMax) {
      chunks.push(remaining);
      break;
    }

    const splitAt = findSplitPoint(remaining, effectiveMax);
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (chunks.length > 1) {
    return chunks.map((chunk, i) => `${chunk} (${i + 1}/${chunks.length})`);
  }
  return chunks;
}

/**
 * Find the best split point in text within maxLen characters.
 * Respects code fences, paragraph boundaries, line boundaries, and word boundaries.
 */
function findSplitPoint(text: string, maxLen: number): number {
  const candidate = text.slice(0, maxLen);
  const minSplit = Math.floor(maxLen * MIN_SPLIT_FRACTION);

  // 1. Check for unclosed code fences in the candidate slice
  const fenceCount = (candidate.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) {
    // Inside a code fence — find the opening fence and split before it
    const lastFence = candidate.lastIndexOf('```');
    if (lastFence > 0) return lastFence;
  }

  // 2. Double newline (paragraph boundary)
  const doubleNl = candidate.lastIndexOf('\n\n');
  if (doubleNl > minSplit) return doubleNl + 2;

  // 3. Single newline (line boundary)
  const singleNl = candidate.lastIndexOf('\n');
  if (singleNl > minSplit) return singleNl + 1;

  // 4. Space (word boundary)
  const space = candidate.lastIndexOf(' ');
  if (space > minSplit) return space + 1;

  // 5. Hard cut (last resort)
  return maxLen;
}
