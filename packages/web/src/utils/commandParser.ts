/**
 * Depth-aware command block parser for ⟦⟦ ... ⟧⟧ delimited commands.
 *
 * Unlike a simple regex split, this correctly handles nested ⟦⟦ ⟧⟧ brackets
 * that appear inside command JSON payloads — e.g. DELEGATE tasks containing
 * example commands for the delegated agent to use.
 *
 * Mirrors the server-side `isInsideCommandBlock` logic in CommandDispatcher.ts.
 */

/**
 * Split text into segments, separating outermost ⟦⟦ command ⟧⟧ blocks from plain text.
 * Nested ⟦⟦ ⟧⟧ inside JSON string values are tracked via bracket depth so the
 * outer command isn't prematurely terminated.
 *
 * Returns an array of strings where command-block segments start with '⟦⟦'
 * and (when complete) end with '⟧⟧'. Plain text segments are interspersed.
 */
export function splitCommandBlocks(text: string): string[] {
  const segments: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      current += ch;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      current += ch;
      continue;
    }

    if (ch === '"' && depth > 0) {
      inString = !inString;
      current += ch;
      continue;
    }

    if (inString) {
      current += ch;
      continue;
    }

    // Opening doubled brackets
    if (ch === '⟦' && i + 1 < text.length && text[i + 1] === '⟦') {
      if (depth === 0) {
        // Start of outermost command block — flush preceding plain text
        if (current) {
          segments.push(current);
          current = '';
        }
      }
      depth++;
      current += '⟦⟦';
      i++; // skip second bracket
      continue;
    }

    // Closing doubled brackets
    if (ch === '⟧' && i + 1 < text.length && text[i + 1] === '⟧') {
      if (depth > 0) {
        depth--;
        current += '⟧⟧';
        i++; // skip second bracket
        if (depth === 0) {
          // End of outermost command block — flush the command segment
          segments.push(current);
          current = '';
        }
        continue;
      }
      // depth === 0: dangling ⟧⟧, treat as regular text
      current += '⟧⟧';
      i++;
      continue;
    }

    current += ch;
  }

  if (current) {
    segments.push(current);
  }

  return segments;
}

/**
 * Check if text ends with an unclosed outermost ⟦⟦ command block.
 * Properly tracks bracket depth and respects JSON string boundaries
 * inside commands, unlike the simple `lastIndexOf('⟦') > lastIndexOf('⟧')` heuristic.
 */
export function hasUnclosedCommandBlock(text: string): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }

    if (ch === '"' && depth > 0) {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '⟦' && i + 1 < text.length && text[i + 1] === '⟦') {
      depth++;
      i++;
    } else if (ch === '⟧' && i + 1 < text.length && text[i + 1] === '⟧') {
      depth = Math.max(0, depth - 1);
      i++;
    }
  }

  return depth > 0;
}
