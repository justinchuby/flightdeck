# R5: Structured Logging with Contextual Correlation — Implementation Spec

**Author:** Architect (e7f14c5e)  
**Date:** 2026-03-07  
**Status:** ✅ **Implemented** — Phases 1-2 done (2026-03-07); Phases 3-4 in progress  
**Priority:** 2 (from synthesis report)  
**Estimated Effort:** Medium (~3-5 days)

---

## 1. Current State

### How Logging Works Today

Flightdeck uses a custom logger at `packages/server/src/utils/logger.ts` — a 57-line module that wraps `process.stdout.write` and `process.stderr.write` with ANSI color formatting.

```typescript
// Current API — every call site looks like this:
logger.info('agent', `Agent ${agent.id.slice(0, 8)} spawned`, { role: role.id });
logger.warn('delegation', `Delegation failed for ${agentId.slice(0, 8)}`);
logger.error('acp', `ACP start failed: ${errorMsg}`, { cliCommand, cwd, role });
```

**Logger signature:** `logger.<level>(category: string, message: string, details?: Record<string, unknown>)`

**Output format (human-readable, not structured):**
```
14:32:05.123 ℹ️  [agent] Agent abc12345 spawned {"role":"developer"}
14:32:05.456 ⚠️  [delegation] Delegation failed for def67890
```

### Current Logger Statistics

| Metric | Value |
|--------|-------|
| Files importing `logger` | 49 |
| Total `logger.*()` call sites | 267 |
| `console.log/warn/error` call sites (bypassing logger) | 15 (all in `index.ts` and `config.ts`) |
| Unique categories used | ~30 (`agent`, `acp`, `api`, `ws`, `delegation`, `message`, `timer`, `lead`, `command`, `pipeline`, `escalation`, `recovery`, `conflicts`, `community`, `worktree`, `project`, `groups`, `predictions`, `nl-command`, `export`, `webhook`, `handoff`, `eager-scheduler`, `task-template`, `model-config`, `session`, `activity`, etc.) |
| Usage by level | ~150 info, ~50 warn, ~30 error, ~25 debug |

### What's Missing

1. **No structured output** — Logs are human-readable ANSI strings. Cannot be parsed by log aggregation tools (Loki, Elasticsearch, CloudWatch). Cannot be queried with `jq`.

2. **No contextual correlation** — When debugging an agent issue, you must manually grep for agent ID fragments (`slice(0, 8)`). There's no way to filter "all log lines from agent X during task Y in session Z."

3. **No request context** — HTTP API logs don't carry request IDs. WebSocket message handling has no correlation to the originating client.

4. **No agent/session threading** — Agent lifecycle events, command dispatch, ACP events, and delegation tracking all log independently. Reconstructing the timeline for a single agent requires reading the entire log.

5. **No log levels control** — Debug logs are always emitted. No way to set log level per category or globally.

6. **No performance data** — No duration tracking for operations. No way to identify slow operations.

7. **15 `console.log` bypasses** — Startup messages in `index.ts` bypass the logger entirely.

---

## 2. Proposed Approach

### Core: pino + AsyncLocalStorage

Replace the custom logger with **[pino](https://github.com/pinojs/pino)** (the fastest Node.js JSON logger) and use **`AsyncLocalStorage`** from `node:async_hooks` to automatically thread contextual fields through every log line within a request/agent/session scope.

### Why pino?

- **Performance:** pino is 5-10x faster than winston/bunyan. It uses worker threads for formatting, keeping the event loop unblocked.
- **JSON by default:** Every log line is a JSON object, ready for `jq` or any log aggregation tool.
- **Child loggers:** `logger.child({ agentId, role })` creates a scoped logger that automatically includes those fields in every log call — no manual threading.
- **Transport ecosystem:** pino-pretty for dev, pino-file for production, pino-elasticsearch/pino-loki for aggregation.
- **Zero config in production, pretty in dev:** `pino.transport({ target: 'pino-pretty' })` in dev mode.

### Why AsyncLocalStorage?

When an HTTP request arrives or an agent event fires, we enter an `AsyncLocalStorage` context with correlation fields (`requestId`, `agentId`, `sessionId`, `projectId`). Every logger call within that async scope automatically picks up these fields — no need to manually pass context through every function call.

```
HTTP Request arrives
  └─ als.run({ requestId: uuid(), ... }, () => {
       // Everything in this scope gets requestId automatically
       logger.info('Processing request');  // includes requestId
       someService.doWork();               // logger calls inside also get requestId
     })
```

---

## 3. Log Format Design

### JSON Output (Production)

```json
{
  "level": 30,
  "time": 1709789525123,
  "pid": 12345,
  "hostname": "dev-machine",
  "module": "agent",
  "msg": "Agent spawned",
  "agentId": "abc12345-6789-...",
  "agentRole": "developer",
  "sessionId": "sess-xyz",
  "projectId": "proj-abc",
  "taskId": "task-123",
  "parentId": "lead-456",
  "model": "claude-opus-4.6",
  "durationMs": 142
}
```

### Pretty Output (Development)

```
14:32:05.123 INFO  [agent] Agent spawned  agentId=abc12345 role=developer sessionId=sess-xyz
14:32:05.456 WARN  [delegation] Delegation failed  agentId=def67890 reason="concurrency limit"
```

### Standard Fields

#### Always Present (Base Logger)
| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `level` | number | pino | Log level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal) |
| `time` | number | pino | Unix epoch milliseconds |
| `pid` | number | pino | Process ID |
| `module` | string | call site | Replaces current `category` — the subsystem emitting the log |

#### Context Fields (from AsyncLocalStorage)
| Field | Type | Scope | Description |
|-------|------|-------|-------------|
| `requestId` | string | HTTP request | UUID per incoming API request |
| `agentId` | string | Agent operation | Agent being operated on |
| `agentRole` | string | Agent operation | Role of the agent |
| `sessionId` | string | Agent session | Copilot CLI session ID |
| `projectId` | string | Project scope | Project UUID |
| `leadId` | string | Team scope | Lead agent ID for the team |
| `taskId` | string | Task scope | DAG task ID |
| `wsClientId` | string | WebSocket | WebSocket client connection ID |

#### Optional Fields (per log call)
| Field | Type | Description |
|-------|------|-------------|
| `durationMs` | number | Operation duration in milliseconds |
| `tokenCount` | number | Tokens consumed in an operation |
| `err` | object | Error object (pino auto-serializes) |
| `filePath` | string | File being operated on |
| `commandName` | string | ACP command being dispatched |

### Log Levels

| Level | pino Value | Usage |
|-------|-----------|-------|
| `trace` | 10 | Ultra-verbose debugging (ACP protocol messages, event bus traffic) |
| `debug` | 20 | Detailed operational info (command parsing, event dispatch) |
| `info` | 30 | Normal operations (agent spawn/terminate, task start/complete, delegation) |
| `warn` | 40 | Recoverable issues (delegation failure, lock denied, retry) |
| `error` | 50 | Errors requiring attention (ACP crash, unhandled rejection, DB failure) |
| `fatal` | 60 | Unrecoverable errors (server startup failure) |

**Default level:** `info` in production, `debug` in development. Configurable via `LOG_LEVEL` env var.

---

## 4. Integration Points

### 4.1 Express Middleware (Request Context)

```typescript
// middleware/requestContext.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  agentId?: string;
  projectId?: string;
}

export const requestALS = new AsyncLocalStorage<RequestContext>();

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const ctx: RequestContext = {
    requestId: randomUUID(),
    method: req.method,
    path: req.path,
    // Extract agentId from URL params if present (e.g., /api/agents/:id/...)
    agentId: req.params?.id,
  };
  requestALS.run(ctx, () => next());
}
```

### 4.2 HTTP Request Logging

```typescript
// middleware/httpLogger.ts
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export function httpLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]({
      module: 'http',
      msg: `${req.method} ${req.path}`,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}
```

### 4.3 WebSocket Handlers

```typescript
// In WebSocketServer.ts — when handling messages from a client:
const wsContext = { wsClientId: client.id, projectId: client.subscribedProject };
requestALS.run(wsContext, () => {
  // All logging inside this handler gets wsClientId automatically
  this.handleMessage(client, parsedMessage);
});
```

### 4.4 Agent Operations (AgentManager)

When spawning or operating on an agent, enter an agent context:

```typescript
// In AgentManager.spawn():
const agentContext = { agentId: agent.id, agentRole: role.id, projectId, leadId: parentId };
// Store on the agent for use in its event handlers
agent._logContext = agentContext;

// In event handlers wired in AgentManager constructor:
agent.onData((text) => {
  requestALS.run(agent._logContext, () => {
    this.dispatcher.appendText(agent, text);
    // All logger calls inside appendText/command dispatch get agentId automatically
  });
});
```

### 4.5 Command Dispatch

```typescript
// In CommandDispatcher — when handling a matched command:
logger.info({
  module: 'command',
  msg: `Dispatching ${entry.name}`,
  commandName: entry.name,
  // agentId, sessionId come from ALS context automatically
});
```

### 4.6 Startup Logging (Replace console.log)

Replace the 15 `console.log` calls in `index.ts` and `config.ts` with `logger.info({ module: 'server', ... })`. The port announcement (`FLIGHTDECK_PORT=NNNN`) must remain on raw stdout for `dev.mjs` to parse it — use `process.stdout.write()` explicitly for that single line.

---

## 5. Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `src/utils/logger.ts` | **Replace entirely** — new pino-based logger with ALS integration |
| `src/middleware/requestContext.ts` | AsyncLocalStorage middleware for Express and general operation contexts |
| `src/middleware/httpLogger.ts` | HTTP request/response logging middleware |

### Modified Files (267 call sites across 49 files)

The API change is minimal. Current:
```typescript
logger.info('agent', 'Agent spawned', { role: role.id });
```

New:
```typescript
logger.info({ module: 'agent', msg: 'Agent spawned', role: role.id });
```

Or using the compatibility wrapper (see Migration Strategy):
```typescript
logger.info('agent', 'Agent spawned', { role: role.id }); // still works via wrapper
```

#### Key Files Requiring Changes

| File | Call Sites | Notes |
|------|-----------|-------|
| `agents/AgentManager.ts` | 31 | Highest-density file. Add agent context entry on spawn/events. |
| `agents/commands/AgentLifecycle.ts` | 21 | Agent spawn/terminate logging. Add agent context. |
| `agents/commands/CommCommands.ts` | 16 | Communication logging. Add sender/receiver context. |
| `agents/commands/CoordCommands.ts` | 12 | Coordination logging. |
| `routes/lead.ts` | 9 | Lead API endpoints. Context from request middleware. |
| `routes/agents.ts` | 9 | Agent API endpoints. Context from request middleware. |
| `index.ts` | 15 | Startup logging. Replace `console.log`. |
| `comms/WebSocketServer.ts` | (few) | Add WS client context on message handling. |
| `coordination/TimerRegistry.ts` | 7 | Timer operations. |
| `acp/AcpConnection.ts` | 4 | ACP process lifecycle. |

### Config Files

| File | Change |
|------|--------|
| `package.json` (server) | Add `pino`, `pino-pretty` (dev dependency) |

---

## 6. Migration Strategy

### Phase 1: Drop-in Replacement with Compatibility Wrapper (~1 day)

Replace `logger.ts` with a pino-based implementation that preserves the existing call signature:

```typescript
// utils/logger.ts — new implementation with backward-compatible API
import pino from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';

export const logContext = new AsyncLocalStorage<Record<string, unknown>>();

const transport = process.env.NODE_ENV === 'production'
  ? undefined  // JSON to stdout (pino default)
  : pino.transport({ target: 'pino-pretty', options: { colorize: true } });

const baseLogger = pino({ level: process.env.LOG_LEVEL || 'info' }, transport);

function getContextualLogger(): pino.Logger {
  const ctx = logContext.getStore();
  return ctx ? baseLogger.child(ctx) : baseLogger;
}

// Backward-compatible API: logger.info('category', 'message', { details })
// Also supports new API: logger.info({ module: 'x', msg: 'y', ...data })
function logCompat(
  level: pino.Level,
  categoryOrObj: string | Record<string, unknown>,
  message?: string,
  details?: Record<string, unknown>,
): void {
  const log = getContextualLogger();
  if (typeof categoryOrObj === 'object') {
    log[level](categoryOrObj);
  } else {
    log[level]({ module: categoryOrObj, ...details }, message);
  }
}

export const logger = {
  info: (cat: string | Record<string, unknown>, msg?: string, details?: Record<string, unknown>) =>
    logCompat('info', cat, msg, details),
  warn: (cat: string | Record<string, unknown>, msg?: string, details?: Record<string, unknown>) =>
    logCompat('warn', cat, msg, details),
  error: (cat: string | Record<string, unknown>, msg?: string, details?: Record<string, unknown>) =>
    logCompat('error', cat, msg, details),
  debug: (cat: string | Record<string, unknown>, msg?: string, details?: Record<string, unknown>) =>
    logCompat('debug', cat, msg, details),
  trace: (cat: string | Record<string, unknown>, msg?: string, details?: Record<string, unknown>) =>
    logCompat('trace', cat, msg, details),
  fatal: (cat: string | Record<string, unknown>, msg?: string, details?: Record<string, unknown>) =>
    logCompat('fatal', cat, msg, details),
  // Expose child logger creation for specialized use
  child: (bindings: Record<string, unknown>) => baseLogger.child(bindings),
};
```

**Result:** All 267 existing call sites work unchanged. Output switches from ANSI to JSON (or pino-pretty in dev). Zero breaking changes. Tests pass.

### Phase 2: Add AsyncLocalStorage Context (~1 day)

1. Create `requestContext.ts` middleware
2. Wire it into Express pipeline in `index.ts` (before `apiRouter`)
3. Add agent context entry points in `AgentManager` event handlers
4. Add WebSocket context in `WebSocketServer` message handlers

**Result:** Log lines automatically gain `requestId`, `agentId`, `sessionId`, `projectId` without changing any existing call sites.

### Phase 3: Migrate Call Sites to New API (1-2 days, can be gradual)

Progressively update the 267 call sites to use the richer object-based API:

```typescript
// Before (still works):
logger.info('agent', `Agent ${agent.id.slice(0, 8)} spawned`, { role: role.id });

// After (richer, searchable, no ID truncation):
logger.info({ module: 'agent', msg: 'Agent spawned', model: agent.model });
// agentId, role, sessionId, projectId come from ALS context automatically
```

This phase can be done incrementally — the compatibility layer means both APIs coexist.

### Phase 4: Replace console.log in index.ts (~30 minutes)

Replace the 15 `console.log` calls with `logger.info/warn/error`, except for the `FLIGHTDECK_PORT=` line which must remain raw stdout.

---

## 7. Testing Strategy

### Unit Tests for Logger

- Verify JSON output format
- Verify ALS context fields appear in output
- Verify backward-compatible API produces correct output
- Verify log level filtering works

### Integration Tests

- Verify request context propagation through Express middleware → route → service → logger
- Verify agent context propagation from spawn → event handler → command dispatch → logger
- Verify no context leakage between concurrent requests

### Existing Test Compatibility

The backward-compatible wrapper ensures no existing tests break. The 125 server test files that import logger will continue working without changes.

---

## 8. Success Criteria

1. **Every log line is valid JSON** in production mode
2. **`jq 'select(.agentId=="X")'`** filters all log lines for a specific agent
3. **`jq 'select(.requestId=="Y")'`** traces a single HTTP request through all services
4. **`jq 'select(.projectId=="Z")'`** isolates logs for a specific project
5. **Zero existing test failures** after Phase 1
6. **Development mode** shows human-readable colorized output via pino-pretty
7. **Log level** is controllable via `LOG_LEVEL` environment variable
8. **No `console.log`** calls remain in production code (except the FLIGHTDECK_PORT announcement)

---

## 9. Dependencies

| Package | Version | Purpose | Type |
|---------|---------|---------|------|
| `pino` | ^9.x | Core structured logger | production |
| `pino-pretty` | ^13.x | Dev-mode pretty printing | devDependency |

Both are lightweight, well-maintained, and have zero transitive dependencies that conflict with existing packages.

---

## 10. DI Container Integration (R1 Dependency)

The R5 logger is a natural fit for DI registration. Today, all 49 files import `logger` as a module-level singleton. With R1's DI container, the logger becomes an injectable service.

### Registration

```typescript
// In container setup:
container.registerSingleton('Logger', () => {
  const transport = config.isDev
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
    : undefined;
  return pino({ level: config.logLevel }, transport);
});

container.registerSingleton('LogContext', () => new AsyncLocalStorage<Record<string, unknown>>());
```

### Consumption

Services receive the logger via constructor injection rather than module import:

```typescript
class AgentManager {
  constructor(
    private logger: pino.Logger,
    private logContext: AsyncLocalStorage<Record<string, unknown>>,
    // ...other deps
  ) {}
}
```

### Migration Path

- **Phase 1 (pre-DI):** The module-level `logger` singleton works unchanged. The compatibility wrapper exports a global.
- **Post-R1:** Refactor to inject `pino.Logger` via the container. The `logContext` (AsyncLocalStorage) is also registered as a singleton and injected where context entry points are needed (Express middleware, AgentManager, WebSocketServer).
- The backward-compatible `logger` export can remain as a fallback for code not yet migrated to DI.

### Note on R3 (Coordination Reorg)

If R3 moves files from `coordination/` to new directories, the 267 logger call sites in those files will have their import paths updated as part of that refactor. The logger API itself is unaffected — only import paths change. The R5 migration should coordinate with R3 to avoid merge conflicts: either R3 lands first (and R5 updates imports in the new locations) or R5 lands first (and R3 preserves the logger imports when moving files).

---

## 11. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| pino-pretty adds startup latency in dev | pino-pretty runs in a worker thread; negligible impact |
| JSON output breaks existing log-grepping workflows | pino-pretty in dev mode preserves human-readable output |
| AsyncLocalStorage performance overhead | Measured at <1% in Node.js 20+; negligible for this workload |
| Context leakage between async operations | ALS is designed for this; each `run()` creates an isolated scope |
| 267 call site changes could introduce typos | Phase 1 compatibility wrapper means zero call site changes needed initially |
