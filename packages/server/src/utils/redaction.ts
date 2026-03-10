/**
 * Secret/Sensitive Data Redaction Engine (R12).
 *
 * Boundary redaction: redact at output (WS, DB, logs), not at the source.
 * Internal agent.messages[] stays raw for command parsing and context building.
 *
 * Inspired by Paperclip's pattern-based redaction.ts approach.
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface RedactionPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

export interface RedactionConfig {
  enabled: boolean;
  logRedactions: boolean;
  extraPatterns: RedactionPattern[];
  disabledPatterns: Set<string>;
}

export interface RedactResult {
  text: string;
  redactionCount: number;
}

export interface RedactObjectResult {
  data: Record<string, unknown>;
  redactionCount: number;
}

// ── Configuration ─────────────────────────────────────────────────────

const defaultConfig: RedactionConfig = {
  enabled: true,
  logRedactions: false,
  extraPatterns: [],
  disabledPatterns: new Set(),
};

let config: RedactionConfig = { ...defaultConfig, disabledPatterns: new Set() };

/**
 * Configure redaction behavior. Merges with current config.
 * Call with no args to reset to defaults.
 */
export function configureRedaction(opts?: Partial<{
  enabled: boolean;
  logRedactions: boolean;
  extraPatterns: RedactionPattern[];
  disabledPatterns: string[];
}>): void {
  if (!opts) {
    config = { ...defaultConfig, disabledPatterns: new Set() };
    return;
  }
  if (opts.enabled !== undefined) config.enabled = opts.enabled;
  if (opts.logRedactions !== undefined) config.logRedactions = opts.logRedactions;
  if (opts.extraPatterns) config.extraPatterns = opts.extraPatterns;
  if (opts.disabledPatterns) config.disabledPatterns = new Set(opts.disabledPatterns);
}

// ── Built-in Patterns ─────────────────────────────────────────────────

/** Keys in objects whose values should always be redacted */
const SENSITIVE_KEY_PATTERN = /^(?:api[-_]?key|secret[-_]?key|access[-_]?token|auth[-_]?token|bearer[-_]?token|client[-_]?secret|private[-_]?key|signing[-_]?key|encryption[-_]?key|database[-_]?url|connection[-_]?string|password|passwd|credentials?)$/i;

const BUILT_IN_PATTERNS: RedactionPattern[] = [
  // AWS access keys (AKIA...)
  { name: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: 'AKIA***REDACTED***' },
  // GitHub tokens (ghp_, gho_, ghs_, ghu_)
  { name: 'github-token', pattern: /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9_]{36,}\b/g, replacement: '***GITHUB_TOKEN_REDACTED***' },
  // GitHub fine-grained PATs
  { name: 'github-pat', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, replacement: '***GITHUB_PAT_REDACTED***' },
  // Anthropic API keys (sk-ant-...)
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9-]{20,}\b/g, replacement: '***ANTHROPIC_KEY_REDACTED***' },
  // OpenAI API keys (sk-... but NOT sk-ant which is Anthropic)
  { name: 'openai-key', pattern: /\bsk-(?!ant-)[A-Za-z0-9-]{20,}\b/g, replacement: '***OPENAI_KEY_REDACTED***' },
  // JWTs (three base64url segments separated by dots)
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: '***JWT_REDACTED***' },
  // Generic Bearer tokens in Authorization headers
  { name: 'bearer-token', pattern: /(?<=Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/g, replacement: '***BEARER_REDACTED***' },
  // Connection strings (postgres://, mysql://, mongodb://, redis://, amqp://)
  { name: 'connection-string', pattern: /\b(?:postgres|postgresql|mysql|mongodb|redis|amqp|mssql):\/\/[^\s'")\]}>]+/gi, replacement: '***CONNECTION_STRING_REDACTED***' },
  // Private keys (PEM format)
  { name: 'private-key', pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, replacement: '***PRIVATE_KEY_REDACTED***' },
  // .env-style sensitive values (API_KEY=..., SECRET=..., etc.)
  { name: 'env-value', pattern: /(?<=(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|CLIENT_SECRET|PRIVATE_KEY|SIGNING_KEY|ENCRYPTION_KEY|DATABASE_URL|DB_PASSWORD|SECRET|TOKEN|PASSWORD)\s*=\s*).+/gim, replacement: '***REDACTED***' },
  // Hex tokens after key/token/secret context (32+ hex chars)
  { name: 'hex-token', pattern: /(?<=(?:token|key|secret|password|credential)\s*[=:]\s*['"]?)[0-9a-f]{32,}\b/gi, replacement: '***TOKEN_REDACTED***' },
  // Base64-encoded secrets after key context (32+ base64 chars)
  { name: 'base64-secret', pattern: /(?<=(?:secret|key|token|password|credential)\s*[=:]\s*['"]?)[A-Za-z0-9+/]{32,}={0,2}\b/gi, replacement: '***SECRET_REDACTED***' },
];

// ── Core Functions ────────────────────────────────────────────────────

function getActivePatterns(): RedactionPattern[] {
  const builtIn = BUILT_IN_PATTERNS.filter(p => !config.disabledPatterns.has(p.name));
  return [...builtIn, ...config.extraPatterns];
}

/**
 * Redact sensitive data from a string.
 * Returns the redacted string and a count of redactions applied.
 */
export function redact(input: string): RedactResult {
  if (!config.enabled) return { text: input, redactionCount: 0 };
  if (!input || input.length < 8) return { text: input, redactionCount: 0 };

  let text = input;
  let redactionCount = 0;
  const patterns = getActivePatterns();

  for (const { name, pattern, replacement } of patterns) {
    // Reset lastIndex for sticky/global regexes
    pattern.lastIndex = 0;
    const before = text;
    text = text.replace(pattern, replacement);
    if (text !== before) {
      const matches = (before.match(pattern) || []).length;
      // Re-reset after match count
      pattern.lastIndex = 0;
      redactionCount += matches;
      if (config.logRedactions) {
        // Use stderr to avoid recursion through the logger
        process.stderr.write(`[redaction] ${matches} ${name} pattern(s) redacted\n`);
      }
    }
  }

  return { text, redactionCount };
}

/**
 * Check if a string contains any detectable secrets.
 * Short-circuits on first match. Faster than redact() for conditional checks.
 */
export function containsSecrets(input: string): boolean {
  if (!config.enabled) return false;
  if (!input || input.length < 8) return false;

  const patterns = getActivePatterns();
  for (const { pattern } of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(input)) {
      pattern.lastIndex = 0;
      return true;
    }
  }
  return false;
}

/**
 * Redact sensitive data from a JSON-serializable object.
 * Walks string values recursively. Also redacts values whose keys match
 * sensitive key patterns (api_key, password, etc.).
 */
export function redactObject(input: Record<string, unknown>): RedactObjectResult {
  if (!config.enabled) return { data: input, redactionCount: 0 };

  let totalRedactions = 0;

  function walk(value: unknown, key?: string): unknown {
    if (value === null || value === undefined) return value;

    // If the key name indicates a secret, redact the entire value
    if (key && typeof value === 'string' && SENSITIVE_KEY_PATTERN.test(key)) {
      totalRedactions++;
      return '***REDACTED***';
    }

    if (typeof value === 'string') {
      const result = redact(value);
      totalRedactions += result.redactionCount;
      return result.text;
    }

    if (Array.isArray(value)) {
      return value.map((item) => walk(item));
    }

    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = walk(v, k);
      }
      return result;
    }

    return value;
  }

  const data = walk(input) as Record<string, unknown>;
  return { data, redactionCount: totalRedactions };
}

/**
 * Redact a WebSocket message object based on message type.
 * Only redacts message types that contain free-text fields.
 */
export function redactWsMessage(msg: Record<string, unknown>): Record<string, unknown> {
  if (!config.enabled) return msg;

  const type = msg.type as string;
  if (!type) return msg;

  switch (type) {
    case 'agent:text':
    case 'agent:thinking':
      if (typeof msg.text === 'string') {
        return { ...msg, text: redact(msg.text).text };
      }
      return msg;

    case 'agent:content':
    case 'agent:message_sent':
      if (typeof msg.content === 'string') {
        return { ...msg, content: redact(msg.content).text };
      }
      return msg;

    case 'agent:exit':
    case 'agent:crashed':
      return redactObject(msg as Record<string, unknown>).data;

    case 'activity':
      if (msg.entry && typeof msg.entry === 'object') {
        const entry = msg.entry as Record<string, unknown>;
        const redactedEntry: Record<string, unknown> = { ...entry };
        if (typeof entry.summary === 'string') {
          redactedEntry.summary = redact(entry.summary).text;
        }
        if (entry.details && typeof entry.details === 'object') {
          redactedEntry.details = redactObject(entry.details as Record<string, unknown>).data;
        }
        return { ...msg, entry: redactedEntry };
      }
      return msg;

    default:
      // Non-text message types pass through unmodified
      return msg;
  }
}

// ── Environment Variable Config (loaded once at import time) ──────────

function loadEnvConfig(): void {
  const envEnabled = process.env.FLIGHTDECK_REDACTION;
  if (envEnabled === 'off' || envEnabled === 'false') {
    config.enabled = false;
  }

  const envLog = process.env.FLIGHTDECK_REDACTION_LOG;
  if (envLog === 'true') {
    config.logRedactions = true;
  }

  const envExtra = process.env.FLIGHTDECK_REDACTION_EXTRA_PATTERNS;
  if (envExtra) {
    try {
      const parsed = JSON.parse(envExtra) as Array<{ name: string; pattern: string; replacement: string }>;
      config.extraPatterns = parsed.map(p => ({
        name: p.name,
        pattern: new RegExp(p.pattern, 'g'),
        replacement: p.replacement,
      }));
    } catch {
      process.stderr.write(`[redaction] Failed to parse FLIGHTDECK_REDACTION_EXTRA_PATTERNS\n`);
    }
  }
}

loadEnvConfig();
