# R12: Secret/Sensitive Data Redaction — Implementation Spec

**Author:** Critical Reviewer (bb14c13b)  
**Date:** 2026-03-07  
**Status:** ✅ **Implemented** (2026-03-07)  
**Priority:** Quick Win (synthesis classification)  
**Inspired by:** Paperclip's `redaction.ts` pattern-based detection  
**Security level:** Defense-in-depth — catches secrets that escape through any output channel

---

## 1. Current State: Where Sensitive Data Can Leak

### 1.1 Data Flow Map

Sensitive data (API keys, tokens, credentials, private URLs) can enter the system through two primary vectors:

1. **Agent output** — LLMs encounter secrets during their work (reading `.env` files, `git log` with credentials, error messages containing tokens) and include them in their text output
2. **System operations** — Server startup logs, error stack traces, config endpoints

Once in the system, data flows through **8 unfiltered channels**:

```
LLM Output (raw text)
    │
    ├─→ agent.messages[]              → stored in memory (Agent.ts:77)
    │       └─→ getRecentOutput()     → included in agent.toJSON() → WS /init payload
    │
    ├─→ AgentManager emit('agent:text') → WebSocket broadcast to all subscribed clients
    │       └─→ flushTextBuffer()     → batched every 100ms (WebSocketServer.ts:493)
    │
    ├─→ ConversationStore.addMessage() → SQLite `messages` table (permanent storage)
    │
    ├─→ CommandDispatcher buffer       → parsed for commands, but raw text stored
    │
    ├─→ ActivityLedger.log()           → SQLite `activity_log` table (details field)
    │       └─→ emit('activity')       → WebSocket broadcast as `activity` event
    │
    ├─→ logger.info/warn/error()       → process.stdout/stderr (container logs)
    │       └─→ details via JSON.stringify() (logger.ts:37)
    │
    └─→ CompletionTracking             → del.result stores getTaskOutput(16000)
```

### 1.2 Specific Risk Points

| # | Location | File:Line | What Leaks | Severity |
|---|----------|-----------|------------|----------|
| 1 | WS `agent:text` broadcast | WebSocketServer.ts:493-500 | Raw LLM output including any secrets the agent encountered | **CRITICAL** |
| 2 | Agent message storage | Agent.ts:77 (`messages[]`) | Entire LLM text stream in memory | **CRITICAL** |
| 3 | Conversation DB storage | ConversationStore.ts:`addMessage()` | Raw messages persisted to SQLite | **HIGH** |
| 4 | Activity ledger details | ActivityLedger.ts:68 | `details` JSON object stored unfiltered | **HIGH** |
| 5 | Agent JSON serialization | Agent.ts:`toJSON()` | 4000-char output preview in WS `/init` | **HIGH** |
| 6 | Logger details field | logger.ts:37 | `JSON.stringify(details)` to stdout | **MEDIUM** |
| 7 | Delegation result storage | CompletionTracking.ts:63 | `del.result = agent.getTaskOutput(16000)` | **MEDIUM** |
| 8 | Auth token on startup | auth.ts + index.ts | Auto-generated token printed to console | **LOW** (intentional for local use) |
| 9 | Config GET endpoint | routes/config.ts:16-18 | DB path, CLI path exposed via API | **LOW** |

### 1.3 What Does NOT Need Redaction

- **Agent-to-agent messages** (in-band commands): These are server-internal and not exposed to external observers. Redacting them would break command parsing.
- **Database paths / file paths**: These are operational, not secrets. Low risk.
- **Model names / role names**: Not sensitive.
- **The auth token printed at startup**: This is intentional UX for local development (user needs it to connect). Could add a `--quiet` flag later.

---

## 2. Redaction Strategy

### 2.1 Core Principle: Redact at the Boundary, Not at the Source

Don't try to scrub data as it enters `agent.messages[]` — that would break command parsing, context building, and debugging. Instead, **redact at every output boundary**:

- Before WebSocket broadcast
- Before database write
- Before logger output
- Before API response serialization

This means the server's internal representation remains unredacted (for debugging, command parsing, and context building), but no external observer (UI, logs, DB dumps) ever sees raw secrets.

### 2.2 Pattern-Based Detection

Inspired by Paperclip's `redaction.ts`, use regex patterns to detect sensitive data:

```typescript
// ── Pattern Categories ──

/** Environment variable names that indicate secrets */
const SENSITIVE_KEY_PATTERNS = /(?:^|['"=\s])(?:api[-_]?key|secret[-_]?key|access[-_]?token|auth[-_]?token|bearer[-_]?token|client[-_]?secret|private[-_]?key|signing[-_]?key|encryption[-_]?key|database[-_]?url|connection[-_]?string|password|passwd|credentials?)(?:\s*[=:])/gi;

/** Common secret value formats */
const SECRET_VALUE_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  // AWS keys (AKIA...)
  { name: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: 'AKIA***REDACTED***' },
  // AWS secret keys (40-char base64)
  { name: 'aws-secret-key', pattern: /(?<=(?:aws[-_]?secret[-_]?(?:access[-_]?)?key|secret[-_]?access[-_]?key)\s*[=:]\s*['"]?)[A-Za-z0-9/+=]{40}\b/g, replacement: '***REDACTED***' },
  // GitHub tokens (ghp_, gho_, ghs_, ghu_, github_pat_)
  { name: 'github-token', pattern: /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9_]{36,}\b/g, replacement: '***GITHUB_TOKEN_REDACTED***' },
  { name: 'github-pat', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, replacement: '***GITHUB_PAT_REDACTED***' },
  // OpenAI API keys (sk-...)
  { name: 'openai-key', pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, replacement: '***OPENAI_KEY_REDACTED***' },
  // Anthropic API keys (sk-ant-...)
  { name: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9-]{20,}\b/g, replacement: '***ANTHROPIC_KEY_REDACTED***' },
  // Generic Bearer tokens in headers
  { name: 'bearer-token', pattern: /(?<=Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/g, replacement: '***BEARER_REDACTED***' },
  // JWTs (three base64url segments separated by dots)
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: '***JWT_REDACTED***' },
  // Generic hex tokens (32+ chars, commonly session tokens, API keys)
  { name: 'hex-token', pattern: /(?<=(?:token|key|secret|password|credential)\s*[=:]\s*['"]?)[0-9a-f]{32,}\b/gi, replacement: '***TOKEN_REDACTED***' },
  // Base64-encoded secrets (contextual — only after key= or similar)
  { name: 'base64-secret', pattern: /(?<=(?:secret|key|token|password|credential)\s*[=:]\s*['"]?)[A-Za-z0-9+/]{32,}={0,2}\b/gi, replacement: '***SECRET_REDACTED***' },
  // Connection strings (postgres://, mysql://, mongodb://, redis://)
  { name: 'connection-string', pattern: /\b(?:postgres|postgresql|mysql|mongodb|redis|amqp|mssql):\/\/[^\s'"]+/gi, replacement: '***CONNECTION_STRING_REDACTED***' },
  // Private keys (PEM format)
  { name: 'private-key', pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g, replacement: '***PRIVATE_KEY_REDACTED***' },
  // .env file lines with sensitive values
  { name: 'env-value', pattern: /(?<=(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH_TOKEN|ACCESS_KEY|PRIVATE_KEY|SIGNING_KEY|ENCRYPTION_KEY|DATABASE_URL|DB_PASSWORD)\s*=\s*).+/gim, replacement: '***REDACTED***' },
];
```

### 2.3 Redaction Function API

```typescript
/**
 * Redact sensitive data from a string.
 * Returns the redacted string and a count of redactions applied.
 */
export function redact(input: string): { text: string; redactionCount: number };

/**
 * Redact sensitive data from a JSON-serializable object.
 * Walks string values recursively and applies redact() to each.
 * Also redacts keys whose names match SENSITIVE_KEY_PATTERNS.
 */
export function redactObject(input: Record<string, unknown>): { data: Record<string, unknown>; redactionCount: number };

/**
 * Check if a string contains any detectable secrets.
 * Faster than redact() — returns on first match. Use for conditional logging.
 */
export function containsSecrets(input: string): boolean;
```

### 2.4 Performance Considerations

- **Pattern compilation**: All regexes compiled once at module load, reused across calls. No dynamic regex construction per call.
- **Short-circuit**: `containsSecrets()` returns on first match — use before expensive `redact()` when possible.
- **Batch optimization**: For `agent:text` events (high frequency, batched every 100ms), redact the merged batch, not individual chunks.
- **Size guard**: Skip redaction for strings under 8 characters (no secret is that short). Skip for strings over 1MB (performance — log a warning instead).
- **Benchmark target**: < 1ms per typical agent output chunk (< 4KB). This will be validated in tests.

---

## 3. Integration Points

### 3.1 WebSocket Serializer (CRITICAL — highest impact)

**Where:** `WebSocketServer.ts`, `broadcast()` method (line 449)

**Current code:**
```typescript
private broadcast(msg: any, filter: (c: ClientConnection) => boolean): void {
  const payload = JSON.stringify(msg);
  // ...sends to clients
}
```

**Change:** Intercept before serialization. Create a `redactWsMessage()` function that handles message-type-specific redaction:

```typescript
private broadcast(msg: any, filter: (c: ClientConnection) => boolean): void {
  const payload = JSON.stringify(redactWsMessage(msg));
  // ...
}
```

**Message types requiring redaction:**
| Message Type | Field(s) to Redact |
|---|---|
| `agent:text` | `text` |
| `agent:content` | `text` within resource objects |
| `agent:thinking` | `text` |
| `agent:exit` | `error` |
| `agent:crashed` | `error`, `stack` |
| `activity` | `entry.summary`, `entry.details` (parsed JSON) |
| `decision:*` | `rationale` |
| `agent:permission_request` | `metadata` fields |

**Message types NOT needing redaction** (no free-text fields):
`agent:spawned`, `agent:terminated`, `dag:updated`, `lock:*`, `timer:*`, `system:paused`

### 3.2 ActivityLedger Storage (HIGH)

**Where:** `ActivityLedger.ts`, `log()` method (line 60)

**Change:** Redact `summary` and `details` before storage:

```typescript
log(agentId, agentRole, actionType, summary, details = {}, projectId = '') {
  const { text: redactedSummary } = redact(summary);
  const { data: redactedDetails } = redactObject(details);
  const detailsJson = JSON.stringify(redactedDetails);
  this.buffer.push({ agentId, agentRole, actionType, summary: redactedSummary, details: detailsJson, projectId });
  // ...event emission also uses redacted data
}
```

### 3.3 ConversationStore (HIGH)

**Where:** `ConversationStore.ts`, `addMessage()`

**Change:** Redact `content` before database insert:

```typescript
addMessage(conversationId, role, content) {
  const { text: redactedContent } = redact(content);
  this.db.drizzle.insert(messages).values({
    conversationId, role, content: redactedContent, timestamp: utcNow(),
  }).run();
}
```

### 3.4 Logger Utility (MEDIUM)

**Where:** `logger.ts`, `log()` function (line 32)

**Change:** Redact `message` and `details` before output:

```typescript
function log(level: LogLevel, category: string, message: string, details?: Record<string, unknown>): void {
  const safeMessage = redact(message).text;
  const detailStr = details ? ` ${DIM}${JSON.stringify(redactObject(details).data)}${RESET}` : '';
  const line = `${time} ${icon} ${cat} ${safeMessage}${detailStr}`;
  // ...
}
```

### 3.5 Agent JSON Serialization (HIGH)

**Where:** `Agent.ts`, `toJSON()` method

**Change:** Redact the `outputPreview` field:

```typescript
toJSON() {
  return {
    // ...other fields
    outputPreview: redact(this.getRecentOutput(4000)).text,
  };
}
```

### 3.6 Delegation Result Storage (MEDIUM)

**Where:** `CompletionTracking.ts`, lines 63, 134, 144

**Change:** Redact `del.result` before assignment:

```typescript
del.result = redact(agent.getTaskOutput(16000)).text;
```

---

## 4. Configuration

### 4.1 Default Configuration (No Setup Required)

The redaction module ships with all patterns from Section 2.2 enabled by default. Zero configuration needed — this is the security-first stance.

### 4.2 Runtime Configuration via Environment Variables

```bash
# Disable redaction entirely (for debugging — NEVER in production)
FLIGHTDECK_REDACTION=off

# Add custom patterns (JSON array of {name, pattern, replacement})
FLIGHTDECK_REDACTION_EXTRA_PATTERNS='[{"name":"internal-key","pattern":"INTERNAL-[A-Z0-9]{32}","replacement":"***INTERNAL_REDACTED***"}]'

# Log when redactions occur (useful for auditing)
FLIGHTDECK_REDACTION_LOG=true
```

### 4.3 Programmatic Configuration

```typescript
import { configureRedaction } from './utils/redaction.js';

configureRedaction({
  enabled: true,  // default: true
  logRedactions: false,  // default: false — log when secrets are caught
  extraPatterns: [
    { name: 'custom', pattern: /CUSTOM-[A-Z0-9]+/g, replacement: '***CUSTOM***' },
  ],
  disabledPatterns: ['hex-token'],  // disable specific built-in patterns by name
});
```

### 4.4 Why NOT a YAML/JSON Config File

The synthesis suggested configuration customization. However, for a security feature:
- **Defaults must be secure** — requiring configuration to be safe is an anti-pattern
- **Extra patterns** are rare and project-specific — env vars suffice
- **A config file** creates a security risk if it's accidentally committed without patterns

Environment variables and programmatic config are sufficient.

---

## 5. Files to Create / Modify

### New Files

| File | Purpose | Estimated Lines |
|------|---------|-----------------|
| `packages/server/src/utils/redaction.ts` | Core redaction engine — patterns, `redact()`, `redactObject()`, `containsSecrets()`, `configureRedaction()` | ~200 |
| `packages/server/src/utils/__tests__/redaction.test.ts` | Unit tests for redaction engine | ~350 |
| `packages/server/src/__tests__/RedactionIntegration.test.ts` | Integration tests verifying redaction at all boundaries | ~200 |

### Modified Files

| File | Change | Impact |
|------|--------|--------|
| `packages/server/src/comms/WebSocketServer.ts` | Add `redactWsMessage()` call in `broadcast()` | 1 function call + import |
| `packages/server/src/coordination/ActivityLedger.ts` | Redact `summary` and `details` in `log()` | 3 lines changed |
| `packages/server/src/db/ConversationStore.ts` | Redact `content` in `addMessage()` | 2 lines changed |
| `packages/server/src/utils/logger.ts` | Redact `message` and `details` in `log()` | 3 lines changed |
| `packages/server/src/agents/Agent.ts` | Redact `outputPreview` in `toJSON()` | 1 line changed |
| `packages/server/src/agents/commands/CompletionTracking.ts` | Redact `del.result` assignments (3 locations) | 3 lines changed |

### NOT Modified

- `Agent.ts` internal `messages[]` — kept raw for command parsing and context building
- `CommandDispatcher.ts` — needs raw text to parse commands
- `AgentAcpBridge.ts` — raw text flows to Agent.messages and event emitters; redaction happens downstream at boundaries
- `auth.ts` — startup token display is intentional for local DX

---

## 6. Testing Strategy

### 6.1 Unit Tests (redaction.test.ts)

**Pattern coverage** — one test per pattern category:

```typescript
describe('redact()', () => {
  // AWS keys
  it('redacts AWS access keys (AKIA...)', () => {
    expect(redact('key=AKIA1234567890ABCDEF').text).toBe('key=AKIA***REDACTED***');
  });

  // GitHub tokens
  it('redacts GitHub PATs (ghp_...)', () => {
    expect(redact('token: ghp_abcdefghijklmnopqrstuvwxyz1234567890').text)
      .toContain('***GITHUB_TOKEN_REDACTED***');
  });

  // OpenAI keys
  it('redacts OpenAI API keys (sk-...)', () => {
    expect(redact('OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx').text)
      .toContain('***OPENAI_KEY_REDACTED***');
  });

  // Anthropic keys
  it('redacts Anthropic API keys (sk-ant-...)', () => { /* ... */ });

  // JWTs
  it('redacts JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    expect(redact(`Authorization: Bearer ${jwt}`).text).toContain('***JWT_REDACTED***');
  });

  // Connection strings
  it('redacts database connection strings', () => {
    expect(redact('DATABASE_URL=postgres://user:pass@host:5432/db').text)
      .toContain('***CONNECTION_STRING_REDACTED***');
  });

  // PEM private keys
  it('redacts PEM private keys', () => { /* ... */ });

  // .env lines
  it('redacts env var values for sensitive keys', () => {
    expect(redact('API_KEY=my-secret-value-12345').text).toBe('API_KEY=***REDACTED***');
  });

  // Bearer tokens
  it('redacts Bearer tokens in auth headers', () => { /* ... */ });
});
```

**Edge cases:**

```typescript
describe('edge cases', () => {
  it('handles empty strings', () => {
    expect(redact('').text).toBe('');
    expect(redact('').redactionCount).toBe(0);
  });

  it('handles strings with no secrets', () => {
    const safe = 'This is a normal log message about a build step.';
    expect(redact(safe).text).toBe(safe);
    expect(redact(safe).redactionCount).toBe(0);
  });

  it('handles multiple secrets in one string', () => {
    const input = 'key1=ghp_abc123def456ghi789jkl012mno345pqr678 and key2=sk-ant-secret12345678901234';
    const result = redact(input);
    expect(result.redactionCount).toBe(2);
    expect(result.text).not.toContain('ghp_');
    expect(result.text).not.toContain('sk-ant-');
  });

  it('does not redact short strings that happen to match partial patterns', () => {
    expect(redact('sk-').text).toBe('sk-');  // too short to be real
  });

  it('handles strings with unicode and special characters', () => {
    expect(redact('パスワード=ghp_abc123def456ghi789jkl012mno345pqr678').text)
      .toContain('***GITHUB_TOKEN_REDACTED***');
  });

  it('preserves surrounding context', () => {
    const input = 'Connecting with token ghp_abc123def456ghi789jkl012mno345pqr678 to github.com';
    const result = redact(input);
    expect(result.text).toContain('Connecting with token');
    expect(result.text).toContain('to github.com');
    expect(result.text).not.toContain('ghp_');
  });
});
```

**Performance tests:**

```typescript
describe('performance', () => {
  it('redacts a typical agent output chunk in < 1ms', () => {
    const chunk = 'x'.repeat(4000);  // typical 4KB chunk
    const start = performance.now();
    for (let i = 0; i < 100; i++) redact(chunk);
    const elapsed = (performance.now() - start) / 100;
    expect(elapsed).toBeLessThan(1);  // < 1ms per call
  });

  it('handles large strings without catastrophic backtracking', () => {
    const large = 'a'.repeat(100_000);
    const start = performance.now();
    redact(large);
    expect(performance.now() - start).toBeLessThan(100);  // < 100ms for 100KB
  });
});
```

**`redactObject()` tests:**

```typescript
describe('redactObject()', () => {
  it('redacts string values in nested objects', () => {
    const obj = { config: { key: 'ghp_abc123def456ghi789jkl012mno345pqr678' } };
    const result = redactObject(obj);
    expect(result.data.config.key).toContain('***GITHUB_TOKEN_REDACTED***');
  });

  it('redacts values whose keys match sensitive patterns', () => {
    const obj = { api_key: 'some-value-here', name: 'safe' };
    const result = redactObject(obj);
    expect(result.data.api_key).toBe('***REDACTED***');
    expect(result.data.name).toBe('safe');
  });

  it('handles arrays within objects', () => { /* ... */ });
  it('handles null and undefined values', () => { /* ... */ });
  it('does not mutate the original object', () => { /* ... */ });
});
```

**Configuration tests:**

```typescript
describe('configureRedaction()', () => {
  it('can disable redaction entirely', () => { /* ... */ });
  it('supports extra custom patterns', () => { /* ... */ });
  it('supports disabling specific built-in patterns', () => { /* ... */ });
  it('logs when redactions occur if logRedactions is true', () => { /* ... */ });
});
```

### 6.2 Integration Tests (RedactionIntegration.test.ts)

These verify redaction at each integration point:

```typescript
describe('WebSocket broadcast redaction', () => {
  it('redacts secrets in agent:text messages before broadcast', () => {
    // Set up mock WS server, emit agent:text with a secret
    // Verify the payload sent over WS is redacted
  });

  it('does not redact agent:spawned messages (no free-text fields)', () => {
    // Verify non-text messages pass through unchanged
  });
});

describe('ActivityLedger redaction', () => {
  it('redacts secrets in summary field before DB write', () => {
    // Call ledger.log() with a secret in summary
    // Verify the DB entry is redacted
  });

  it('redacts secrets in details object before DB write', () => {
    // Call ledger.log() with a secret in details
    // Verify the stored JSON is redacted
  });
});

describe('ConversationStore redaction', () => {
  it('redacts secrets in message content before DB write', () => {
    // Add a message with a secret
    // Read it back and verify redacted
  });
});

describe('Logger redaction', () => {
  it('redacts secrets in log messages before stdout', () => {
    // Capture stdout, log a message with a secret
    // Verify output is redacted
  });
});
```

### 6.3 Adversarial Tests

Test inputs that attackers or LLMs might generate:

```typescript
describe('adversarial inputs', () => {
  it('catches secrets split across lines', () => {
    // API_KEY=\nsk-abcdef...
  });

  it('catches secrets in JSON strings', () => {
    // {"key": "ghp_abc123..."}
  });

  it('catches secrets in markdown code blocks', () => {
    // ```\nAWS_SECRET_KEY=AKIA...\n```
  });

  it('does not cause false positives on normal code', () => {
    // Common code patterns that look like but aren't secrets
    const falsePositiveCandidates = [
      'const skeleton = "loading..."',
      'skip-navigation-link',
      'sk_test_placeholder',  // test mode stripe key — still redact? Yes.
    ];
  });
});
```

---

## 7. Architectural Decisions

### 7.1 Why Boundary Redaction, Not Source Redaction

**Decision:** Redact at output boundaries (WS, DB, logs), NOT when data enters `agent.messages[]`.

**Rationale:**
- Command parsing (`CommandDispatcher`) needs raw text to extract Unicode-bracket commands
- Context building needs accurate text for agent prompts
- Debugging in the server process needs raw data
- Redacting at the source would require un-redacting for internal use — fragile and error-prone

**Trade-off:** In-memory data is unredacted. If the server process is compromised, secrets in memory are exposed. This is acceptable because: (a) the server runs locally on the user's machine, (b) if the process is compromised, the attacker already has access to the filesystem including `.env` files.

### 7.2 Why Regex, Not ML-Based Detection

**Decision:** Use pattern-based regex detection, not ML or heuristic approaches.

**Rationale:**
- Deterministic — same input always produces same output (testable)
- Fast — compiled regexes are O(n) on input length
- No dependencies — no ML models or external services
- Transparent — patterns are readable and auditable
- Paperclip uses this approach successfully in production

**Trade-off:** Won't catch novel secret formats not covered by patterns. Acceptable because: (a) major providers (AWS, GitHub, OpenAI, Anthropic) have well-known key formats, (b) custom patterns can be added via configuration.

### 7.3 Why NOT Redact agent.messages[] In-Place

**Decision:** The `agent.messages[]` array stays raw. Only outputs are redacted.

**Rationale:** `agent.messages` is the source of truth for the agent's conversation. It's used by:
- `CommandDispatcher.appendToBuffer()` — needs raw text for command regex matching
- `Agent.getBufferedOutput()` — used for context building when agent restarts
- `ContextCompressor` — needs accurate text for summarization

Redacting in-place would break all of these.

### 7.4 Redaction Marker Convention

**Decision:** Use `***CATEGORY_REDACTED***` format for all redactions.

**Rationale:**
- Clearly indicates content was removed (not just empty)
- Category suffix helps debugging ("was this a JWT or an API key?")
- Triple-asterisk prefix/suffix is unlikely to appear in normal text
- Consistent with Paperclip's approach

---

## 8. Rollout Plan

### Phase 1: Core Engine (< 1 day)

1. Create `packages/server/src/utils/redaction.ts` with all patterns
2. Create `packages/server/src/utils/__tests__/redaction.test.ts`
3. Verify performance benchmarks pass

### Phase 2: Integration (< 1 day)

1. Add redaction to `WebSocketServer.broadcast()` — highest impact first
2. Add redaction to `ActivityLedger.log()`
3. Add redaction to `ConversationStore.addMessage()`
4. Add redaction to `logger.ts`
5. Add redaction to `Agent.toJSON()`
6. Add redaction to `CompletionTracking.ts` result storage
7. Create `RedactionIntegration.test.ts`

### Phase 3: Validation

1. Run full test suite — ensure no regressions
2. Start a session with known test secrets in the workspace
3. Verify secrets don't appear in: WS messages (browser dev tools), SQLite DB (query directly), stdout logs
4. Verify command parsing still works (commands contain `⟦⟦` delimiters, not secrets)

---

## 9. Future Enhancements (Not in Scope)

- **Audit logging of redactions**: Log when and where secrets were caught (useful for security auditing)
- **Secret rotation alerts**: Detect secrets that appear repeatedly, suggesting they should be rotated
- **LLM output sanitization** (separate from redaction): Clean up messy titles, metadata bleed-through — per Edict's `_sanitize_text()` pattern. This is a data quality concern, not a security concern, and should be a separate spec.
- **Request/response body redaction**: Express middleware to redact API request/response bodies. Lower priority since the API is local-only.

---

*This spec is designed for implementation by a single developer in 1-2 days. The redaction module is self-contained with a clear public API, well-defined integration points, and comprehensive test coverage requirements.*
