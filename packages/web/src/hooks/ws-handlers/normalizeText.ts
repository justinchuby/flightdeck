/**
 * Normalize incoming WS text payloads to a plain string.
 *
 * Server messages send text in three shapes:
 *   1. A plain string: "hello"
 *   2. An object with a `.text` property: { text: "hello" }
 *   3. Something else (rare): JSON-serialize it
 *
 * This single function replaces the 3 inline coercion patterns scattered
 * across useWebSocket.ts and useLeadWebSocket.ts.
 */
export function normalizeWsText(text: unknown): string {
  if (typeof text === 'string') return text;
  if (text && typeof text === 'object' && 'text' in text) {
    const inner = (text as Record<string, unknown>).text;
    if (typeof inner === 'string') return inner;
  }
  if (text === undefined || text === null) return '';
  return JSON.stringify(text);
}
