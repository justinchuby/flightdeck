# R5 Phases 3-4: Structured Logging Call-Site Migration & Observability Integration

> **Status**: Spec  
> **Author**: Architect (e7f14c5e)  
> **Depends on**: R5 Phases 1-2 (done), R1 DI Container (done), R3 Coordination Reorg (done), R12 Redaction (done)

---

## Problem Statement

R5 Phases 1-2 replaced the custom 57-line logger with pino and wired AsyncLocalStorage infrastructure. But **zero call sites were migrated** — all 235 logger calls still use the backward-compatible string API (`logger.info('category', 'message')`), and the context helpers (`runWithAgentContext`, `runWithWsContext`) are **defined but never called**. Logs cannot be correlated by agent, project, or session.

**Goal**: Convert call sites to structured logging and inject AsyncLocalStorage context at key entry points so every log line carries machine-parseable fields and automatic correlation IDs.

---

## Current State

### Logger Infrastructure (Phases 1-2, in place)

```
packages/server/src/utils/logger.ts          — pino wrapper + LogContext type
packages/server/src/middleware/requestContext.ts — ALS middleware + runWithAgentContext + runWithWsContext
packages/server/src/middleware/httpLogger.ts   — HTTP request/response logging
```

### Call Site Inventory

| Level   | Count | Percentage |
|---------|-------|------------|
| `info`  | 131   | 54%        |
| `warn`  | 51    | 21%        |
| `debug` | 34    | 14%        |
| `error` | 27    | 11%        |
| **Total** | **243** | (235 logger + 8 self-referencing in logger.ts) |

**console.log/warn/error bypasses**: 16 calls across 3 files (container.ts, index.ts, config.ts).

### Call Sites by Module

| Module                     | Calls | High-Value? | Notes |
|----------------------------|-------|-------------|-------|
| `agents/commands/`         | 55    | ✅ Yes       | All command handlers — agentId always available |
| `agents/` (non-commands)   | 52    | ✅ Yes       | AgentManager (30), Agent (3), Bridge (4), etc. |
| `routes/`                  | 18    | ✅ Yes       | HTTP endpoints — requestId from ALS |
| `coordination/alerts/`     | 13    | ⚠️ Some     | EscalationManager, AlertEngine |
| `config/`                  | 10    | ❌ No        | System-level, no agent context |
| `coordination/predictions/`| 8     | ❌ No        | System service |
| `coordination/decisions/`  | 8     | ⚠️ Some     | ConflictDetectionEngine |
| `governance/`              | 7     | ✅ Yes       | Pipeline hooks have agent context |
| `coordination/scheduling/` | 7     | ⚠️ Some     | TimerRegistry — agentId available |
| `coordination/recovery/`   | 7     | ✅ Yes       | Recovery/handoff — agentId available |
| `coordination/playbooks/`  | 7     | ❌ No        | CRUD operations |
| `coordination/events/`     | 7     | ⚠️ Some     | EventPipeline — agentId in events |
| `coordination/files/`      | 7     | ⚠️ Some     | WorktreeManager — agentId available |
| `tasks/`                   | 6     | ❌ No        | EagerScheduler, TaskTemplates |
| `adapters/`                | 3     | ✅ Yes       | AcpAdapter — in agent context |
| `comms/`                   | 3     | ✅ Yes       | WebSocket server |
| `coordination/commands/`   | 3     | ❌ No        | NLCommandService |
| `coordination/sessions/`   | 2     | ❌ No        | Export/retro |
| `coordination/activity/`   | 2     | ❌ No        | ActivityLedger |
| `utils/`                   | 3     | ❌ No        | Scheduler |

### Top 10 Files by Call Count

| File | Calls | Agent Context? |
|------|-------|---------------|
| `agents/AgentManager.ts` | 30 | ✅ Always (`agent.id`, `agent.projectId`) |
| `agents/commands/AgentLifecycle.ts` | 20 | ✅ Always (`agent.id`) |
| `agents/commands/CommCommands.ts` | 15 | ✅ Always (`agent.id`) |
| `agents/commands/CoordCommands.ts` | 11 | ✅ Always (`agent.id`) |
| `config/ConfigStore.ts` | 10 | ❌ System-level |
| `coordination/predictions/PredictionService.ts` | 8 | ❌ System-level |
| `routes/agents.ts` | 8 | ✅ From route params/lookup |
| `governance/GovernancePipeline.ts` | 7 | ✅ Via `action.agent` |
| `coordination/playbooks/CommunityPlaybookService.ts` | 7 | ❌ CRUD |
| `coordination/events/EventPipeline.ts` | 7 | ⚠️ From event entries |

### 30 Log Categories Currently Used

```
agent (28), delegation (18), command (18), lead (10), timer (7), 
community (7), api (7), config (6), project (6), groups (5),
pipeline (5), worktree (5), message (5), governance (5), conflicts (5),
predictions (4), commit (4), escalation (4), recovery (3), 
eager-scheduler (3), nl-command (3), retry (3), webhook (2), 
system (2), scheduler (2), acp (3), budget (1), activity (2),
crash-forensics (1), notifications (1), session (2), export (1), 
retro (1), dep-graph (1), handoff (2), alerts (2), adr (1),
diff (1), ws (3), agents (2), category (3), notification (2)
```

**Problem**: 42 categories is too many. Some are duplicates (`notification`/`notifications`, `agent`/`agents`). No hierarchy.

---

## Phase 3: AsyncLocalStorage Context Injection

### Overview

**Zero new logger API changes needed.** The `logContext` AsyncLocalStorage already exists and `getContextualLogger()` already merges context into every log line. We just need to **call the injection functions** at key entry points.

### Injection Architecture

```
                    ┌─────────────────────┐
                    │  Entry Point Layer   │   ← Inject ALS context here
                    │  (5 injection sites) │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Business Logic     │   ← 235 logger calls
                    │   (commands, agents, │      auto-get context
                    │    coordination)     │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Logger + Pino      │   ← logContext.getStore()
                    │   (auto-attach)      │      merges agentId, projectId, etc.
                    └─────────────────────┘
```

### 5 Primary Injection Points

These 5 sites wrap **~85% of all logger calls** in context:

#### 1. Command Dispatch (covers ~55 command handler calls)

**File**: `agents/CommandDispatcher.ts` ~line 170  
**Available**: `agent.id`, `agent.role.name`, `agent.projectId`

```typescript
// BEFORE:
best.handler(agent, best.text);

// AFTER:
import { runWithAgentContext } from '../middleware/requestContext.js';

runWithAgentContext(agent.id, agent.role.name, agent.projectId, () => {
  best.handler(agent, best.text);
});
```

**Impact**: ALL command handlers (AgentLifecycle, CommCommands, CoordCommands, TimerCommands, SystemCommands) get automatic context. This single change covers 55 logger calls.

#### 2. Agent Data/Event Processing (covers ~30 AgentManager calls)

**File**: `agents/AgentManager.ts` — the event listener registrations (~lines 360-600)  
**Available**: `agent.id`, `agent.role.name`, `agent.projectId`

Key callbacks to wrap:
- `onData(text)` ~line 363 — text output processing → command dispatch
- `onToolCall(info)` ~line 372 — tool call tracking  
- `onStatus(status)` ~line 456 — status change handling
- `onExit(code)` ~line 479 — exit/crash detection + auto-restart
- `onHung()` ~line 573 — hung agent detection

```typescript
// Pattern for each callback:
const onData = (text: string) => {
  runWithAgentContext(agent.id, agent.role.name, agent.projectId, () => {
    // existing logic
  });
};
```

**Impact**: 30 logger calls in AgentManager + all downstream calls from these callbacks.

#### 3. ACP Adapter Events (covers adapter + bridge calls)

**File**: `agents/AgentAcpBridge.ts` ~line 82, `wireAcpEvents()`  
**Available**: `agent.id`, `agent.role.name`, `agent.projectId`

Wrap each `conn.on(...)` callback:
- `text` — agent output streaming
- `tool_call` — tool invocation tracking
- `exit` — agent process exit
- `prompt_complete` — turn completion
- `permission_request` — permission handling
- `usage` — token usage tracking

```typescript
conn.on('text', (text: string) => {
  runWithAgentContext(agent.id, agent.role.name, agent.projectId, () => {
    // existing logic
  });
});
```

**Impact**: 4 logger calls in AcpAdapter + 4 in AgentAcpBridge, plus all downstream.

#### 4. WebSocket Message Handling (covers WS calls)

**File**: `comms/WebSocketServer.ts` ~line 74  
**Available**: `client.id` (wsClientId), `client.subscribedProject` (projectId)

```typescript
// In handleMessage():
import { runWithWsContext } from '../middleware/requestContext.js';

private handleMessage(client: WsClient, msg: WsClientMessage) {
  runWithWsContext(client.id, client.subscribedProject, () => {
    // existing switch/case for message types
  });
}
```

**Impact**: 3 logger calls in WebSocketServer + downstream (input delivery hits AgentManager which has its own context).

#### 5. Timer Fire Callbacks (covers timer delivery)

**File**: `container.ts` — `timerRegistry.on('timer:fired', ...)` callback  
**Available**: `timer.agentId`, agent lookup for role, `projectId`

```typescript
timerRegistry.on('timer:fired', (timer) => {
  const agent = agents.get(timer.agentId);
  const projectId = agent?.projectId;
  runWithAgentContext(timer.agentId, agent?.role.name ?? 'unknown', projectId, () => {
    // existing delivery logic
  });
});
```

**Impact**: 6 logger calls in TimerRegistry + message delivery path.

### Secondary Injection Points (remaining ~15%)

These are lower priority — implement after the 5 primary points:

| Site | File | Context | Logger Calls |
|------|------|---------|-------------|
| HTTP route handlers | `routes/agents.ts`, `routes/projects.ts` | `requestId` (already set), `agentId` from params | 18 |
| Recovery callbacks | `coordination/recovery/RecoveryService.ts` | `originalAgentId` | 5 |
| EventPipeline handlers | `coordination/events/EventPipeline.ts` | `entry.agentId` | 7 |
| Worktree operations | `coordination/files/WorktreeManager.ts` | `agentId` parameter | 5 |

For HTTP routes, `requestId` is already set by `requestContextMiddleware`. To add `agentId`:

```typescript
// routes/agents.ts — after agent lookup:
const agent = agents.get(req.params.id);
if (!agent) return res.status(404).json({ error: 'agent not found' });

runWithAgentContext(agent.id, agent.role.name, agent.projectId, () => {
  // route handler body
});
```

### Phase 3 Deliverables

1. **5 files modified** for primary injection: CommandDispatcher.ts, AgentManager.ts, AgentAcpBridge.ts, WebSocketServer.ts, container.ts
2. **4 files modified** for secondary injection: routes/agents.ts, routes/projects.ts, RecoveryService.ts, EventPipeline.ts
3. **0 logger call sites changed** — context flows automatically via ALS
4. **Verification**: Run server in dev mode, trigger agent spawn + command → confirm log lines include `agentId`, `projectId`, `requestId`

---

## Phase 4: Call-Site Migration to Structured API

### Structured Field Schema

#### Standard Fields (auto-attached via ALS — never pass manually)

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `requestId` | `string` | ALS | HTTP request correlation ID |
| `agentId` | `string` | ALS | Agent UUID |
| `agentRole` | `string` | ALS | Role name (e.g., "developer") |
| `projectId` | `string` | ALS | Project UUID |
| `sessionId` | `string` | ALS | Session ID |
| `wsClientId` | `string` | ALS | WebSocket client ID |

#### Domain Fields (pass explicitly per call site)

| Field | Type | Used By | Description |
|-------|------|---------|-------------|
| `targetAgentId` | `string` | Messages, delegation | Recipient agent |
| `targetRole` | `string` | Messages, delegation | Recipient role |
| `command` | `string` | Command dispatch | Command name (COMMIT, DELEGATE, etc.) |
| `delegationId` | `string` | Delegation lifecycle | Delegation UUID |
| `taskId` | `string` | Task/DAG operations | DAG task ID |
| `groupName` | `string` | Group operations | Chat group name |
| `filePath` | `string` | File lock/worktree | File being operated on |
| `timerId` | `string` | Timer operations | Timer ID |
| `timerLabel` | `string` | Timer operations | Timer label |
| `durationMs` | `number` | Performance events | Operation duration |
| `exitCode` | `number` | Agent exit | Process exit code |
| `errorMessage` | `string` | Error events | Error description |
| `count` | `number` | Batch operations | Items affected |

### Category Consolidation

Reduce 42 categories to 12 modules:

| New Module | Old Categories | Calls |
|------------|----------------|-------|
| `agent` | agent, agents, retry, crash-forensics | 36 |
| `command` | command, commit | 22 |
| `delegation` | delegation, category | 21 |
| `comms` | message, groups, ws, notification, notifications | 16 |
| `api` | api | 7 |
| `coordination` | pipeline, escalation, alerts, recovery, handoff | 22 |
| `config` | config, budget | 11 |
| `timer` | timer, scheduler, eager-scheduler | 13 |
| `governance` | governance | 7 |
| `project` | project, session, export, retro | 10 |
| `files` | worktree, diff, dep-graph, adr | 8 |
| `acp` | acp | 3 |

Each module maps to a pino child logger with `module` field preset.

### Migration Patterns

#### Pattern 1: Simple message → structured object (low-value, skip or batch)

```typescript
// BEFORE (fine as-is):
logger.info('timer', `TimerRegistry started — ${this.pending.size} pending timers loaded`);

// AFTER (optional, minor improvement):
logger.info({ module: 'timer', msg: 'TimerRegistry started', pendingCount: this.pending.size });
```

**Recommendation**: Only migrate if adding a searchable field. Don't touch purely informational messages.

#### Pattern 2: Agent operation → structured with IDs (high-value)

```typescript
// BEFORE:
logger.info('agent', `${agent.role.name} (${agent.id.slice(0, 8)}) created ${role.name}: ${child.id.slice(0, 8)}`);

// AFTER (agentId auto-attached via ALS):
logger.info({
  module: 'agent',
  msg: 'Agent created',
  childAgentId: child.id,
  childRole: role.name,
  model: req.model,
});
```

**Key insight**: After Phase 3 injects ALS context, the `agentId` in the log message (`agent.id.slice(0, 8)`) is redundant — it's auto-attached. The structured version is shorter and machine-parseable.

#### Pattern 3: Error with context (high-value)

```typescript
// BEFORE:
logger.error('acp', `Spawn error for "${opts.cliCommand}": ${err.message}`, {
  error: err.message, cwd: opts.cwd,
});

// AFTER:
logger.error({
  module: 'acp',
  msg: 'Spawn error',
  err: { message: err.message, code: (err as any).code },
  cliCommand: opts.cliCommand,
  cwd: opts.cwd,
});
```

#### Pattern 4: Command parse failure (keep as debug, minimal change)

```typescript
// BEFORE (18 instances, all identical pattern):
logger.debug('command', 'Failed to parse LOCK_FILE command', { error: (err as Error).message });

// AFTER (batch rename only):
logger.debug({ module: 'command', msg: 'Parse failed', command: 'LOCK_FILE', err: (err as Error).message });
```

**Recommendation**: These 18 calls are fine as-is. Batch-rename only if we want consistent field names.

#### Pattern 5: Delegation lifecycle (high-value — 18 calls)

```typescript
// BEFORE:
logger.info('delegation', `Lead ${agent.id.slice(0, 8)} cancelled ${cancelledCount} delegation(s) to ${targetAgent.role.name} (${targetId.slice(0, 8)}), cleared ${cleared.count} queued message(s)`);

// AFTER (agentId from ALS):
logger.info({
  module: 'delegation',
  msg: 'Delegations cancelled',
  targetAgentId: targetId,
  targetRole: targetAgent.role.name,
  cancelledCount,
  clearedMessages: cleared.count,
});
```

### Migration Tiers

#### Tier 1: High-Value Agent Operations (107 calls, 15 files)

Files: `AgentManager.ts`, `AgentLifecycle.ts`, `CommCommands.ts`, `CoordCommands.ts`, `AgentAcpBridge.ts`, `Agent.ts`, `GovernancePipeline.ts`, `CommandDispatcher.ts`, `HeartbeatMonitor.ts`, `RetryManager.ts`, `CrashForensics.ts`, `CompletionTracking.ts`, `SystemCommands.ts`, `TimerCommands.ts`, `ContextCompressor.ts`

These all operate within agent context (ALS will have agentId). Structured fields enable:
- Per-agent log filtering
- Command execution tracing
- Delegation flow visualization
- Error correlation by agent

#### Tier 2: HTTP/API Operations (18 calls, 4 files)

Files: `routes/agents.ts`, `routes/projects.ts`, `routes/sessions.ts`, `routes/decisions.ts`

Already have `requestId` from Phase 1 middleware. Add structured fields for API operations.

#### Tier 3: Coordination Services (48 calls, 14 files)

Files: All `coordination/` subdirectories.

Mixed value — some have agent context (recovery, worktree), some are system-level (predictions, playbooks). Migrate agent-context ones in Tier 3a, leave system-level for 3b.

#### Tier 4: System/Infrastructure (20 calls, 6 files)

Files: `ConfigStore.ts`, `PredictionService.ts`, `CommunityPlaybookService.ts`, `WebSocketServer.ts`, `Scheduler.ts`, `TaskTemplates.ts`

Low-value for structured migration. These are informational/diagnostic — the category string is sufficient.

### console.log Migration (16 calls)

| File | Calls | Action |
|------|-------|--------|
| `index.ts` | 12 | **Keep as console.log** — startup banner, shutdown messages. These MUST go to stdout before pino is initialized and after shutdown. |
| `container.ts` | 2 | **Keep as console.warn** — shutdown error handling. Logger may be unavailable. |
| `config.ts` | 1 | **Migrate to logger** — DB migration message. |
| `index.ts` | 1 | **Migrate to logger** — unhandled rejection. |

**Decision**: 14 of 16 stay as `console.*`. Only 2 migrate.

---

## Phase 4b: Observability Integration (Optional/Future)

### Log-Based Metrics

If we add a metrics layer later, these log events are natural metric sources:

| Metric | Log Source | Type |
|--------|-----------|------|
| `agent.spawn_total` | `agent` module, msg="Agent created" | Counter |
| `agent.exit_total` | `agent` module, msg="Agent exited" | Counter (labeled by exitCode) |
| `command.dispatch_total` | `command` module | Counter (labeled by command name) |
| `delegation.total` | `delegation` module, msg="Delegated" | Counter |
| `acp.prompt_duration_ms` | `acp` module, msg="Prompt complete" | Histogram |
| `timer.fire_total` | `timer` module, msg="Timer fired" | Counter |

**Implementation**: pino transport that increments Prometheus counters. Not in scope for Phase 4 but the structured fields make it trivial.

### Log Shipping Config

R15's ConfigStore can optionally expose:

```yaml
logging:
  level: debug          # Already supported via LOG_LEVEL
  format: json | pretty # Already supported via NODE_ENV
  # Future:
  # output: stdout | file | loki
  # filePath: /var/log/flightdeck.log
```

**Decision**: Defer log shipping. ConfigStore integration is a 1-line change when needed.

---

## Implementation Plan

### Ordering

```
Phase 3 (ALS injection) MUST come before Phase 4 (call-site migration).
Phase 3 alone provides ~80% of the observability value with ~10% of the effort.
```

### Phase 3 Work Breakdown

| Step | Files | Description |
|------|-------|-------------|
| 3.1 | CommandDispatcher.ts | Wrap `best.handler()` in `runWithAgentContext()` |
| 3.2 | AgentManager.ts | Wrap 6 event callbacks in `runWithAgentContext()` |
| 3.3 | AgentAcpBridge.ts | Wrap 6 `conn.on()` callbacks |
| 3.4 | WebSocketServer.ts | Wrap `handleMessage()` in `runWithWsContext()` |
| 3.5 | container.ts | Wrap `timer:fired` callback |
| 3.6 | routes/agents.ts, projects.ts | Wrap route handler bodies after agent/project lookup |
| 3.7 | Verify | Run tests, check dev logs show agentId/projectId |

**Estimated scope**: 9 files modified, 0 API changes, 0 new files.

### Phase 4 Work Breakdown

| Step | Files | Calls | Description |
|------|-------|-------|-------------|
| 4.1 | 15 agent files | 107 | Tier 1: agent operations → structured API |
| 4.2 | 4 route files | 18 | Tier 2: HTTP/API → structured API |
| 4.3a | 7 coordination files | 28 | Tier 3a: agent-context coordination |
| 4.3b | 7 coordination files | 20 | Tier 3b: system-level coordination |
| 4.4 | 6 infrastructure files | 20 | Tier 4: system/infrastructure |

**Estimated scope**: ~50 files touched, 193 call sites migrated (42 skipped/kept as-is).

### Dependencies

- Phase 3 requires: **nothing** — all infrastructure is in place from Phase 1-2
- Phase 4 requires: Phase 3 (otherwise structured fields include manual agentId that's redundant with ALS)
- Phase 4 Tier 1 can proceed **in parallel** across files (each file is independent)

### Risk Mitigation

1. **Backward compat**: The `logCompat()` function handles both old and new API simultaneously. No big-bang migration needed.
2. **Test impact**: Logger is mocked in tests as `{ info: vi.fn(), ... }`. Mock signature doesn't change — it still receives `(categoryOrObj, msg?, details?)`.
3. **Review burden**: Phase 4 is pure call-site changes with no logic changes. Can be done file-by-file with small PRs.

---

## Before/After Examples

### Agent Spawn (AgentLifecycle.ts)

**Before** (no ALS context, manual ID slicing):
```
INFO [agent] developer (d3ec686e) created qa-tester: 31dd89b0
```

**After** (ALS auto-attaches agentId, structured fields):
```json
{"level":"info","module":"agent","msg":"Agent created","agentId":"d3ec686e-...","agentRole":"developer","projectId":"abc123","childAgentId":"31dd89b0-...","childRole":"qa-tester","model":"claude-sonnet-4-20250514"}
```

### Command Dispatch (CoordCommands.ts)

**Before**:
```
INFO [commit] COMMIT for developer (d3ec686e): 3 files — fix: address review findings
```

**After**:
```json
{"level":"info","module":"command","msg":"COMMIT executed","agentId":"d3ec686e-...","agentRole":"developer","projectId":"abc123","command":"COMMIT","fileCount":3,"commitMessage":"fix: address review findings"}
```

### Error Correlation (Agent.ts)

**Before**:
```
ERROR [agent] Prompt failed for developer (d3ec686e): Connection reset
```

**After**:
```json
{"level":"error","module":"agent","msg":"Prompt failed","agentId":"d3ec686e-...","agentRole":"developer","projectId":"abc123","err":{"message":"Connection reset","code":"ECONNRESET"}}
```

---

## Summary

| | Phase 3 | Phase 4 |
|---|---------|---------|
| **What** | Inject ALS context at 5-9 entry points | Migrate 193 call sites to structured API |
| **Files changed** | 9 | ~50 |
| **New files** | 0 | 0 |
| **API changes** | 0 | 0 |
| **Risk** | Very low (additive) | Very low (backward compat) |
| **Value** | 80% (auto-correlation) | 20% (machine-parseable fields) |
| **Effort** | Low | Medium-high |

**Recommendation**: Ship Phase 3 immediately — it's 9 file changes with massive observability gains. Phase 4 can be done incrementally, starting with Tier 1 (agent operations) which covers 107 of 235 calls.
