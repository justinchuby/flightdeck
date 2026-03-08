# R1: DI Container for Server Bootstrap — Implementation Spec

**Status**: ✅ **Implemented** — Draft → Reviewed → Implemented (2026-03-07)
**Author**: Architect (cc29bb0d)
**Priority**: P1 (Highest — eliminates #1 maintainability risk)
**Estimated Effort**: 2-3 days
**Prerequisite**: None (this is the foundation for R2 and R3)

---

## 1. Problem Statement

### The God Function

`packages/server/src/index.ts` (410 lines) is a single procedural script that:
1. Imports 44 classes/modules via top-level and inline `import` statements
2. Manually instantiates ~35 services in a fragile order
3. Manually wires cross-service event subscriptions (timers → agents, DAG → scheduler, etc.)
4. Passes all services into `apiRouter()` as **35 positional parameters**

`apiRouter()` in `api.ts` re-packs those 35 params into an `AppContext` object and passes it to `mountAllRoutes()`. This means `AppContext` is defined redundantly:
- As function params in `api.ts` (lines 22-57)
- As an interface in `routes/context.ts` (lines 21-56)
- As object construction in `api.ts` (lines 60-95)

### Why This Matters

| Problem | Impact |
|---|---|
| Adding a new service requires editing 4 files | Developer friction; easy to miss a file |
| 35 positional params are untyped at call site | Reordering or missing a param is a silent bug |
| No lifecycle management — start/stop manually wired | Forgetting to stop a service causes zombie timers |
| Hard to test — no way to inject mocks without constructing everything | Integration tests are all-or-nothing |
| `services.ts` route pulls 27 of 35 services | One route file is a god-route; hard to reason about |
| Event wiring scattered across 230 lines of index.ts | Adding a new event subscription requires reading the entire file |

### What We're NOT Doing

We are NOT:
- Adopting a heavyweight DI framework (InversifyJS, tsyringe, etc.) — they add decorator magic, reflect-metadata, and complexity that makes the codebase harder for AI agents to navigate
- Rewriting services — they stay exactly as they are
- Changing the route system — routes continue to receive `AppContext`
- Breaking the API contract — zero external-facing changes

---

## 2. Design: Service Container

### 2.1 Core Insight

The problem isn't "we need dependency injection" — it's "we need to eliminate the manual wiring." The services already have clean constructor signatures. We just need a **typed registry that builds them in order and manages their lifecycle**.

### 2.2 Approach: Custom `ServiceContainer` (No Library)

A simple, hand-written container. ~150 lines. No decorators, no reflection, no magic. Just a typed object with a `build()` factory and `shutdown()` lifecycle.

**Why not a library?**
- InversifyJS/tsyringe require decorators + reflect-metadata (build complexity)
- awilix is the lightest option but still adds proxy magic and dynamic resolution
- Our dependency graph is static (known at compile time) — we don't need runtime resolution
- A custom container is greppable, debuggable, and AI-agent-friendly

### 2.3 Architecture

```
                    ┌─────────────────────┐
                    │   createContainer() │  ← Pure factory, called once at startup
                    │   (container.ts)    │
                    └──────────┬──────────┘
                               │ returns
                    ┌──────────▼──────────┐
                    │  ServiceContainer   │  ← Typed object, all services as fields
                    │  {                  │
                    │    db, config,      │
                    │    agentManager,    │  Route handlers receive this via
                    │    lockRegistry,    │  AppContext (unchanged interface)
                    │    ...35 services   │
                    │    shutdown()       │  ← Lifecycle: stops all started services
                    │  }                  │
                    └──────────┬──────────┘
                               │ extends
                    ┌──────────▼──────────┐
                    │    AppContext       │  ← Existing interface (routes/context.ts)
                    │    (unchanged)      │  ← Routes see no change
                    └─────────────────────┘
```

---

## 3. Interface Definitions

### 3.1 `ServiceContainer` Interface

```typescript
// packages/server/src/container.ts

import type { AppContext } from './routes/context.js';

/**
 * ServiceContainer extends AppContext with lifecycle management.
 * Routes receive AppContext (unchanged). Only index.ts sees ServiceContainer.
 *
 * Two-stage construction avoids null-as-any type holes:
 *   1. createContainer() → ServiceContainer (all services, no HTTP layer)
 *   2. wireHttpLayer(container, httpServer) → sets wsServer and alert→WS bridge
 */
export interface ServiceContainer extends AppContext {
  /** Shuts down all services with lifecycle methods, in reverse creation order. */
  shutdown(): Promise<void>;

  /** Starts all lifecycle services (call after HTTP server is listening). */
  startAll(): void;

  /** Services that are only needed for wiring, not for routes. */
  internal: {
    messageBus: import('./comms/MessageBus.js').MessageBus;
    agentMemory: import('./agents/AgentMemory.js').AgentMemory;
    chatGroupRegistry: import('./comms/ChatGroupRegistry.js').ChatGroupRegistry;
    taskDAG: import('./tasks/TaskDAG.js').TaskDAG;
    deferredIssueRegistry: import('./tasks/DeferredIssueRegistry.js').DeferredIssueRegistry;
    contextRefresher: import('./coordination/ContextRefresher.js').ContextRefresher;
    scheduler: import('./utils/Scheduler.js').Scheduler;
    wsServer: import('./comms/WebSocketServer.js').WebSocketServer | null;
    worktreeManager: import('./coordination/WorktreeManager.js').WorktreeManager;
    timerRegistry: import('./coordination/TimerRegistry.js').TimerRegistry;
  };
}

/**
 * Wires the HTTP layer (WebSocket server + alert broadcast).
 * Called after Express app and httpServer are created.
 * Eliminates the null-as-any type hole from the original design.
 */
export function wireHttpLayer(
  container: ServiceContainer,
  httpServer: import('http').Server,
  wsServer: import('./comms/WebSocketServer.js').WebSocketServer,
): void;
```

> **Review fix #1 (from @e7f14c5e)**: Eliminated `httpServer: null as any` and `wsServer: null as any` type holes. The container is now fully typed at construction — `wsServer` is `| null` in the type and set via `wireHttpLayer()` after HTTP server creation. No `as any` casts.

### 3.2 `createContainer()` Factory Signature

```typescript
// packages/server/src/container.ts

export interface ContainerConfig {
  /** Server config (port, host, dbPath, etc.) */
  config: ServerConfig;
  /** Repo root path for file operations */
  repoRoot: string;
}

/**
 * Builds all services in dependency order. Pure factory — no side effects
 * except service construction. Call startAll() after HTTP server is listening,
 * then shutdown() when done.
 */
export async function createContainer(opts: ContainerConfig): Promise<ServiceContainer>;
```

### 3.3 `AppContext` — MINIMAL CHANGES

The existing `AppContext` interface in `routes/context.ts` gets **one addition**: `costTracker`. This fixes a bug where `routes/config.ts` currently creates its own `CostTracker` instance instead of using the shared one from index.ts.

> **Review fix #3 (from @e7f14c5e)**: `costTracker` was in Tier 1 of the container but missing from AppContext. Investigation revealed `routes/config.ts` line 11 instantiates `new CostTracker(_db)` locally — the DI container should eliminate this duplication.

---

## 4. Implementation Details

### 4.1 Service Build Order (Dependency Tiers)

Services must be built in dependency order. Here are the tiers:

```
Tier 0 — Config & Database (no dependencies)
  ├── config (from opts)
  ├── db = new Database(config.dbPath)
  └── repoRoot (from opts)

Tier 1 — Core Registries (depend only on db)
  ├── lockRegistry = new FileLockRegistry(db)
  ├── activityLedger = new ActivityLedger(db)
  ├── roleRegistry = new RoleRegistry(db)
  ├── decisionLog = new DecisionLog(db)
  ├── agentMemory = new AgentMemory(db)
  ├── chatGroupRegistry = new ChatGroupRegistry(db)
  ├── taskDAG = new TaskDAG(db)
  ├── deferredIssueRegistry = new DeferredIssueRegistry(db)
  ├── projectRegistry = new ProjectRegistry(db)
  ├── timerRegistry = new TimerRegistry(db.drizzle)
  └── costTracker = new CostTracker(db)

Tier 2 — Stateless Services (no deps or value-only deps)
  ├── messageBus = new MessageBus()
  ├── eventPipeline = new EventPipeline()
  ├── taskTemplateRegistry = new TaskTemplateRegistry()
  ├── capabilityInjector = new CapabilityInjector()
  ├── retryManager = new RetryManager()
  ├── crashForensics = new CrashForensics()
  ├── notificationManager = new NotificationManager()
  ├── modelSelector = new ModelSelector()
  ├── tokenBudgetOptimizer = new TokenBudgetOptimizer()
  ├── reportGenerator = new ReportGenerator()
  ├── projectTemplateRegistry = new ProjectTemplateRegistry()
  ├── knowledgeTransfer = new KnowledgeTransfer()
  ├── decisionRecordStore = new DecisionRecordStore()
  ├── coverageTracker = new CoverageTracker()
  ├── complexityMonitor = new ComplexityMonitor(repoRoot)
  └── dependencyScanner = new DependencyScanner(repoRoot)

Tier 3 — Composed Services (depend on Tier 1+2)
  ├── taskDecomposer = new TaskDecomposer(taskTemplateRegistry)
  ├── fileDependencyGraph = new FileDependencyGraph(repoRoot)
  ├── worktreeManager = new WorktreeManager(repoRoot, lockRegistry)
  ├── escalationManager = new EscalationManager(decisionLog, taskDAG)
  ├── eagerScheduler = new EagerScheduler(taskDAG)
  └── searchEngine = new SearchEngine(activityLedger, decisionLog)

Tier 4 — AgentManager (depends on most Tier 1+2+3)
  └── agentManager = new AgentManager(
        config, roleRegistry, lockRegistry, activityLedger,
        messageBus, decisionLog, agentMemory, chatGroupRegistry,
        taskDAG, { db, deferredIssueRegistry, timerRegistry,
        capabilityInjector, taskTemplateRegistry, taskDecomposer,
        worktreeManager, costTracker }
      )
      agentManager.setProjectRegistry(projectRegistry)

Tier 5 — Services depending on AgentManager
  ├── contextRefresher = new ContextRefresher(agentManager, lockRegistry, activityLedger)
  ├── capabilityRegistry = new CapabilityRegistry(db, lockRegistry, () => agentManager.getAll())
  ├── alertEngine = new AlertEngine(agentManager, lockRegistry, decisionLog, activityLedger, taskDAG)
  ├── agentMatcher = new AgentMatcher(agentManager, capabilityRegistry, activityLedger)
  ├── sessionRetro = new SessionRetro(db, agentManager, activityLedger, decisionLog, taskDAG, lockRegistry)
  ├── sessionExporter = new SessionExporter(agentManager, activityLedger, decisionLog, taskDAG, chatGroupRegistry)
  └── performanceTracker = new PerformanceTracker(activityLedger, agentManager)

Tier 6 — HTTP/WS layer (depends on everything)
  ├── httpServer = createServer(app)
  └── wsServer = new WebSocketServer(httpServer, agentManager, lockRegistry, activityLedger, decisionLog, chatGroupRegistry)
```

### 4.2 Event Wiring (Moved into Container)

All event subscriptions currently scattered in `index.ts` move into a `wireEvents()` function called at the end of `createContainer()`:

```typescript
function wireEvents(c: ServiceContainer): void {
  // EventPipeline handlers
  c.eventPipeline!.register(taskCompletedHandler);
  c.eventPipeline!.register(commitQualityGateHandler);
  c.eventPipeline!.register(delegationTracker);
  c.eventPipeline!.connectToLedger(c.activityLedger);

  // Webhook relay
  c.internal.webhookManager?.fire && c.eventPipeline!.register({
    name: 'webhook-relay',
    eventTypes: '*',
    handle: (event) => { ... },
  });

  // Timer → Agent message delivery
  c.internal.timerRegistry.on('timer:fired', ...);
  c.internal.timerRegistry.on('timer:created', ...);
  c.internal.timerRegistry.on('timer:cancelled', ...);

  // DAG → Eager scheduler
  c.internal.taskDAG.on('dag:updated', () => c.eagerScheduler!.evaluate());

  // Eager scheduler → Lead notification
  c.eagerScheduler!.on('task:ready', ...);

  // Lock events → Capability registry
  c.lockRegistry.on('lock:acquired', ...);

  // Decision log → Decision record store
  c.decisionLog.on('decision', ...);

  // Alert engine → WS broadcast
  c.alertEngine!.on('alert:new', ...);
}
```

### 4.3 Lifecycle Management

The container tracks services that need `start()` and `stop()`:

```typescript
interface LifecycleService {
  start?(): void;
  stop?(): void;
}

const lifecycleServices: Array<{ name: string; service: LifecycleService }> = [];

// During build, register services with lifecycle:
lifecycleServices.push({ name: 'lockRegistry', service: lockRegistry });
lifecycleServices.push({ name: 'eagerScheduler', service: eagerScheduler });
// ... etc

// Start all (in order):
function startAll(): void {
  for (const { name, service } of lifecycleServices) {
    service.start?.();
  }
}

// Shutdown (in reverse order — non-mutating copy):
async function shutdown(): Promise<void> {
  for (const { name, service } of [...lifecycleServices].reverse()) {
    try {
      service.stop?.();
    } catch (err) {
      console.warn(`[container] ${name} stop failed:`, err);
    }
  }
  db.close();
}
```

> **Review fix #2 (from @e7f14c5e)**: Uses `[...lifecycleServices].reverse()` instead of `lifecycleServices.reverse()` to avoid mutating the array. Prevents double-shutdown race (SIGTERM then SIGINT) from iterating in wrong order on second call.

Services with lifecycle methods (in start order):
1. `lockRegistry.startExpiryCheck()`
2. `retryManager.start()`
3. `eagerScheduler.start()`
4. `timerRegistry.start()`
5. `scheduler.register(...)` + implicit start
6. `contextRefresher.start()`
7. `escalationManager.start()`
8. `alertEngine.start()`

Shutdown reverses this list, plus:
- `wsServer.close()`
- `agentManager.shutdownAll()`
- `activityLedger.stop()`
- `lockRegistry.cleanExpired()`
- `db.close()`
- `httpServer.close()`

### 4.4 `services.ts` Route Refactoring (Bonus — Optional in Phase 1)

The `services.ts` route file currently destructures 27 services from `ctx`. This is a symptom, not a cause. The DI container fixes the root cause (wiring), but if we want to clean this up:

**Option A (Recommended)**: Leave `services.ts` as-is for now. It's a dashboard/admin API — accessing many services is legitimate.

**Option B (Future)**: Split `services.ts` into sub-route files by domain (alerts, search, reports, etc.), each accessing only 2-3 services.

---

## 5. Exact Files to Create/Modify

### New Files

| File | Purpose | Size |
|---|---|---|
| `packages/server/src/container.ts` | `ServiceContainer` interface + `createContainer()` factory + `wireEvents()` + lifecycle management | ~250 lines |

### Modified Files

| File | Changes | Risk |
|---|---|---|
| `packages/server/src/index.ts` | **Major rewrite**: Replace ~300 lines of manual wiring with `const container = await createContainer(...)`. Keep Express app setup, HTTP listener, graceful shutdown (now calls `container.shutdown()`). Target: ~100 lines. | Medium — most code moves, not changes |
| `packages/server/src/api.ts` | **Delete or simplify**: The `apiRouter()` function becomes a thin wrapper that takes `AppContext` (which is what `ServiceContainer` extends). Potentially reduce to `export function apiRouter(ctx: AppContext): Router`. | Low — mechanical change |
| `packages/server/src/routes/context.ts` | **Add `costTracker` field**: Add `costTracker?: import('../agents/CostTracker.js').CostTracker` to AppContext. Remove `getRecentCommits()` helper (move to a utility). | Minimal |
| `packages/server/src/routes/config.ts` | **Remove local CostTracker instantiation**: Replace `const costTracker = new CostTracker(_db)` (line 11) with `const { costTracker } = ctx`. Eliminates duplicate instance. | Minimal |

### Files NOT Modified

- All route files (`routes/*.ts`) — they receive `AppContext` unchanged
- All service files — constructors unchanged
- All test files — existing tests continue to work
- `packages/web/` — zero frontend changes
- `packages/shared/` — no shared type changes

---

## 6. Migration Strategy (Incremental Adoption)

### Phase 1: Create Container, Rewire index.ts (Day 1)

**Goal**: Replace the god function without changing any service code.

1. Create `container.ts` with `ServiceContainer` interface and `createContainer()` factory
2. Move all service instantiation from `index.ts` into `createContainer()`
3. Move all event wiring from `index.ts` into `wireEvents()`
4. Rewrite `index.ts` to:
   ```typescript
   const container = await createContainer({ config, repoRoot });
   const app = createExpressApp(container);
   const port = await listenWithRetry(config.port, config.host);
   container.internal.contextRefresher.start();
   // ... minimal startup code
   ```
5. Simplify `api.ts` to accept `AppContext` directly
6. Run `pnpm typecheck && pnpm test:run && pnpm build` — everything must pass

**Verification**: `git diff --stat` should show:
- `container.ts` created (~250 lines)
- `index.ts` shrunk from 410 → ~100 lines
- `api.ts` shrunk from 101 → ~15 lines
- No other files changed

### Phase 2: Add Container Tests (Day 2)

**Goal**: Prove the container is testable with mock injection.

1. Create `packages/server/src/__tests__/container.test.ts`
2. Test that `createContainer()` builds successfully
3. Test that `shutdown()` calls all stop methods
4. Test that a route handler works with a partial mock container:
   ```typescript
   const mockContainer = {
     agentManager: createMockAgentManager(),
     // ... only the fields this test needs
   } as AppContext;
   ```

### Phase 3: Extract createExpressApp() (Day 2-3)

**Goal**: Separate Express app setup from service wiring.

1. Move Express middleware setup (CORS, helmet, JSON, auth) into a `createExpressApp(container: ServiceContainer)` function
2. This makes the Express app independently testable with supertest
3. `index.ts` becomes pure orchestration: config → container → app → listen → shutdown

### Rollback Plan

If anything goes wrong:
- `container.ts` is a new file — delete it
- `index.ts` and `api.ts` changes are revertible via git
- Zero changes to services or routes means zero blast radius

---

## 7. Testing Strategy

### 7.1 Unit Tests for Container

```typescript
// packages/server/src/__tests__/container.test.ts

describe('createContainer', () => {
  it('builds all services without errors', async () => {
    const container = await createContainer({
      config: createTestConfig(),
      repoRoot: '/tmp/test-repo',
    });
    expect(container.agentManager).toBeDefined();
    expect(container.lockRegistry).toBeDefined();
    // ... assert all 35 services exist
    await container.shutdown();
  });

  it('shutdown calls stop on all lifecycle services', async () => {
    const container = await createContainer({
      config: createTestConfig(),
      repoRoot: '/tmp/test-repo',
    });
    // Spy on stop methods
    const spies = [
      vi.spyOn(container.eagerScheduler!, 'stop'),
      vi.spyOn(container.internal.timerRegistry, 'stop'),
      // ...
    ];
    await container.shutdown();
    for (const spy of spies) {
      expect(spy).toHaveBeenCalled();
    }
  });

  it('shutdown handles errors in individual services gracefully', async () => {
    const container = await createContainer({
      config: createTestConfig(),
      repoRoot: '/tmp/test-repo',
    });
    // Make one service throw on stop
    vi.spyOn(container.eagerScheduler!, 'stop').mockImplementation(() => {
      throw new Error('stop failed');
    });
    // Should not throw — just warns
    await expect(container.shutdown()).resolves.toBeUndefined();
  });
});
```

### 7.2 Integration Test Pattern (Mock Injection)

The container enables testing routes with partial mocks:

```typescript
// Example: testing alerts route with mock alertEngine
describe('GET /api/coordination/alerts', () => {
  it('returns alerts from alertEngine', async () => {
    const mockAlerts = [{ id: '1', type: 'stuck_agent', severity: 'warn' }];
    const ctx: Partial<AppContext> = {
      alertEngine: { getAlerts: () => mockAlerts } as any,
    };
    const router = servicesRoutes(ctx as AppContext);
    // ... supertest against router
  });
});
```

### 7.3 Existing Tests — Zero Changes Required

All existing tests in `packages/server/src/__tests__/` test individual services or routes. They don't depend on `index.ts` wiring. Therefore:
- All 41 existing test files pass unchanged
- Run `pnpm test:run` after each phase to verify

---

## 8. Code Template

Here's the skeleton of `container.ts` that developers should implement:

```typescript
// packages/server/src/container.ts

import { createServer, type Server as HttpServer } from 'http';
import type { ServerConfig } from './config.js';
import type { AppContext } from './routes/context.js';

// ── Imports: Tier 0 (Config/DB) ────────────────────────────
import { Database } from './db/database.js';

// ── Imports: Tier 1 (Core Registries) ──────────────────────
import { FileLockRegistry } from './coordination/FileLockRegistry.js';
import { ActivityLedger } from './coordination/ActivityLedger.js';
import { RoleRegistry } from './agents/RoleRegistry.js';
import { DecisionLog } from './coordination/DecisionLog.js';
import { AgentMemory } from './agents/AgentMemory.js';
import { ChatGroupRegistry } from './comms/ChatGroupRegistry.js';
import { TaskDAG } from './tasks/TaskDAG.js';
import { DeferredIssueRegistry } from './tasks/DeferredIssueRegistry.js';
import { ProjectRegistry } from './projects/ProjectRegistry.js';
import { TimerRegistry } from './coordination/TimerRegistry.js';
import { CostTracker } from './agents/CostTracker.js';

// ── Imports: Tier 2 (Stateless) ────────────────────────────
import { MessageBus } from './comms/MessageBus.js';
import { EventPipeline, taskCompletedHandler, commitQualityGateHandler, delegationTracker } from './coordination/EventPipeline.js';
import { TaskTemplateRegistry } from './tasks/TaskTemplates.js';
import { CapabilityInjector } from './agents/capabilities/CapabilityInjector.js';
import { RetryManager } from './agents/RetryManager.js';
import { CrashForensics } from './agents/CrashForensics.js';
import { NotificationManager } from './coordination/NotificationManager.js';
import { ModelSelector } from './agents/ModelSelector.js';
import { TokenBudgetOptimizer } from './agents/TokenBudgetOptimizer.js';
import { ReportGenerator } from './coordination/ReportGenerator.js';
import { ProjectTemplateRegistry } from './coordination/ProjectTemplates.js';
import { KnowledgeTransfer } from './coordination/KnowledgeTransfer.js';
import { DecisionRecordStore } from './coordination/DecisionRecords.js';
import { CoverageTracker } from './coordination/CoverageTracker.js';
import { ComplexityMonitor } from './coordination/ComplexityMonitor.js';
import { DependencyScanner } from './coordination/DependencyScanner.js';

// ── Imports: Tier 3 (Composed) ─────────────────────────────
import { TaskDecomposer } from './tasks/TaskDecomposer.js';
import { FileDependencyGraph } from './coordination/FileDependencyGraph.js';
import { WorktreeManager } from './coordination/WorktreeManager.js';
import { EscalationManager } from './coordination/EscalationManager.js';
import { EagerScheduler } from './tasks/EagerScheduler.js';
import { SearchEngine } from './coordination/SearchEngine.js';
import { WebhookManager } from './coordination/WebhookManager.js';

// ── Imports: Tier 4-5 (AgentManager + dependents) ──────────
import { AgentManager } from './agents/AgentManager.js';
import { ContextRefresher } from './coordination/ContextRefresher.js';
import { CapabilityRegistry } from './coordination/CapabilityRegistry.js';
import { AlertEngine } from './coordination/AlertEngine.js';
import { AgentMatcher } from './coordination/AgentMatcher.js';
import { SessionRetro } from './coordination/SessionRetro.js';
import { SessionExporter } from './coordination/SessionExporter.js';
import { PerformanceTracker } from './coordination/PerformanceScorecard.js';
import { WebSocketServer } from './comms/WebSocketServer.js';
import { Scheduler } from './utils/Scheduler.js';

// ── Types ──────────────────────────────────────────────────

export interface ContainerConfig {
  config: ServerConfig;
  repoRoot: string;
}

export interface ServiceContainer extends AppContext {
  shutdown(): Promise<void>;
  httpServer: HttpServer;
  internal: {
    messageBus: MessageBus;
    agentMemory: AgentMemory;
    chatGroupRegistry: ChatGroupRegistry;
    taskDAG: TaskDAG;
    deferredIssueRegistry: DeferredIssueRegistry;
    contextRefresher: ContextRefresher;
    scheduler: Scheduler;
    wsServer: WebSocketServer;
    worktreeManager: WorktreeManager;
    timerRegistry: TimerRegistry;
  };
}

// ── Lifecycle tracking ─────────────────────────────────────

interface Stoppable {
  stop?(): void;
  close?(): void;
  shutdownAll?(): void;
  stopExpiryCheck?(): void;
  cleanExpired?(): void;
}

// ── Factory ────────────────────────────────────────────────

export async function createContainer(opts: ContainerConfig): Promise<ServiceContainer> {
  const { config, repoRoot } = opts;
  const stopList: Array<{ name: string; fn: () => void }> = [];

  // Helper to register a shutdown action
  function onShutdown(name: string, fn: () => void) {
    stopList.push({ name, fn });
  }

  // ── Tier 0: Config & Database ──────────────────────────
  const db = new Database(config.dbPath);
  onShutdown('db', () => db.close());

  // Restore persisted settings
  const persistedMaxAgents = db.getSetting('maxConcurrentAgents');
  if (persistedMaxAgents) {
    const parsed = parseInt(persistedMaxAgents, 10);
    if (!isNaN(parsed) && parsed > 0) {
      // Note: caller should updateConfig before passing config in,
      // or we accept mutable config here
    }
  }

  // ── Tier 1: Core Registries ────────────────────────────
  const lockRegistry = new FileLockRegistry(db);
  lockRegistry.startExpiryCheck();
  onShutdown('lockRegistry', () => {
    lockRegistry.stopExpiryCheck();
    lockRegistry.cleanExpired();
  });

  const activityLedger = new ActivityLedger(db);
  onShutdown('activityLedger', () => activityLedger.stop());

  const roleRegistry = new RoleRegistry(db);
  const decisionLog = new DecisionLog(db);
  const agentMemory = new AgentMemory(db);
  const chatGroupRegistry = new ChatGroupRegistry(db);
  const taskDAG = new TaskDAG(db);
  const deferredIssueRegistry = new DeferredIssueRegistry(db);
  const projectRegistry = new ProjectRegistry(db);
  const timerRegistry = new TimerRegistry(db.drizzle);
  const costTracker = new CostTracker(db);

  // ── Tier 2: Stateless Services ─────────────────────────
  const messageBus = new MessageBus();
  const eventPipeline = new EventPipeline();
  const taskTemplateRegistry = new TaskTemplateRegistry();
  const capabilityInjector = new CapabilityInjector();

  const retryManager = new RetryManager();
  retryManager.start();
  onShutdown('retryManager', () => retryManager.stop());

  const crashForensics = new CrashForensics();
  const notificationManager = new NotificationManager();
  const modelSelector = new ModelSelector();
  const tokenBudgetOptimizer = new TokenBudgetOptimizer();
  const reportGenerator = new ReportGenerator();
  const projectTemplateRegistry = new ProjectTemplateRegistry();
  const knowledgeTransfer = new KnowledgeTransfer();
  const decisionRecordStore = new DecisionRecordStore();
  const coverageTracker = new CoverageTracker();
  const complexityMonitor = new ComplexityMonitor(repoRoot);
  const dependencyScanner = new DependencyScanner(repoRoot);
  const webhookManager = new WebhookManager();

  // ── Tier 3: Composed Services ──────────────────────────
  const taskDecomposer = new TaskDecomposer(taskTemplateRegistry);
  const fileDependencyGraph = new FileDependencyGraph(repoRoot);
  const worktreeManager = new WorktreeManager(repoRoot, lockRegistry);
  worktreeManager.cleanupOrphans().catch(err => {
    console.warn(`[container] Orphan cleanup failed: ${err.message}`);
  });

  const escalationManager = new EscalationManager(decisionLog, taskDAG);
  const eagerScheduler = new EagerScheduler(taskDAG);
  eagerScheduler.start();
  onShutdown('eagerScheduler', () => eagerScheduler.stop());

  const searchEngine = new SearchEngine(activityLedger, decisionLog);

  // ── Tier 4: AgentManager ───────────────────────────────
  const agentManager = new AgentManager(
    config, roleRegistry, lockRegistry, activityLedger,
    messageBus, decisionLog, agentMemory, chatGroupRegistry,
    taskDAG, {
      db, deferredIssueRegistry, timerRegistry, capabilityInjector,
      taskTemplateRegistry, taskDecomposer, worktreeManager, costTracker,
    },
  );
  agentManager.setProjectRegistry(projectRegistry);
  onShutdown('agentManager', () => agentManager.shutdownAll());

  // ── Tier 5: AgentManager-dependent services ────────────
  const contextRefresher = new ContextRefresher(agentManager, lockRegistry, activityLedger);
  const capabilityRegistry = new CapabilityRegistry(db, lockRegistry, () => agentManager.getAll());
  const alertEngine = new AlertEngine(agentManager, lockRegistry, decisionLog, activityLedger, taskDAG);
  alertEngine.start();
  onShutdown('alertEngine', () => alertEngine.stop());

  const agentMatcher = new AgentMatcher(agentManager, capabilityRegistry, activityLedger);
  const sessionRetro = new SessionRetro(db, agentManager, activityLedger, decisionLog, taskDAG, lockRegistry);
  const sessionExporter = new SessionExporter(agentManager, activityLedger, decisionLog, taskDAG, chatGroupRegistry);
  const performanceTracker = new PerformanceTracker(activityLedger, agentManager);

  // ── Timers & Scheduler ─────────────────────────────────
  timerRegistry.start();
  onShutdown('timerRegistry', () => timerRegistry.stop());

  const scheduler = new Scheduler();
  scheduler.register({
    id: 'activity-log-prune',
    interval: 3_600_000,
    run: () => activityLedger.prune(50_000),
  });
  scheduler.register({
    id: 'stale-delegation-cleanup',
    interval: 300_000,
    run: () => { agentManager.cleanupStaleDelegations(); },
  });
  onShutdown('scheduler', () => scheduler.stop());

  onShutdown('escalationManager', () => escalationManager.stop());

  // ── Build the container object ─────────────────────────
  const container: ServiceContainer = {
    // AppContext fields (used by routes)
    agentManager,
    roleRegistry,
    config,
    db,
    lockRegistry,
    activityLedger,
    decisionLog,
    projectRegistry,
    alertEngine,
    capabilityRegistry,
    sessionRetro,
    sessionExporter,
    eagerScheduler,
    fileDependencyGraph,
    agentMatcher,
    retryManager,
    crashForensics,
    webhookManager,
    taskTemplateRegistry,
    taskDecomposer,
    searchEngine,
    performanceTracker,
    decisionRecordStore,
    coverageTracker,
    complexityMonitor,
    dependencyScanner,
    notificationManager,
    escalationManager,
    modelSelector,
    tokenBudgetOptimizer,
    reportGenerator,
    projectTemplateRegistry,
    knowledgeTransfer,
    eventPipeline,
    costTracker,

    // Lifecycle
    async shutdown() {
      for (const { name, fn } of [...stopList].reverse()) {
        try { fn(); } catch (err) {
          console.warn(`[container] ${name} shutdown failed:`, err);
        }
      }
    },

    // Start all lifecycle services (call after HTTP server is listening)
    startAll() {
      contextRefresher.start();
      escalationManager.start();
    },

    // HTTP server — set via wireHttpLayer() after Express app creation
    // (no null-as-any; wsServer is typed as | null)

    // Internal services (not exposed to routes)
    internal: {
      messageBus,
      agentMemory,
      chatGroupRegistry,
      taskDAG,
      deferredIssueRegistry,
      contextRefresher,
      scheduler,
      wsServer: null, // set via wireHttpLayer()
      worktreeManager,
      timerRegistry,
    },
  };

  // ── Wire cross-service events ──────────────────────────
  wireEvents(container);

  return container;
}

// ── Event Wiring ───────────────────────────────────────────

function wireEvents(c: ServiceContainer): void {
  const {
    eventPipeline, activityLedger, lockRegistry, decisionLog,
    alertEngine, eagerScheduler, agentManager, webhookManager,
    capabilityRegistry, decisionRecordStore,
  } = c;
  const { taskDAG, timerRegistry, wsServer } = c.internal;

  // EventPipeline handlers
  eventPipeline!.register(taskCompletedHandler);
  eventPipeline!.register(commitQualityGateHandler);
  eventPipeline!.register(delegationTracker);
  eventPipeline!.connectToLedger(activityLedger);

  // Webhook relay
  eventPipeline!.register({
    name: 'webhook-relay',
    eventTypes: '*',
    handle: (event: any) => {
      webhookManager?.fire(event.entry.actionType, {
        agentId: event.entry.agentId,
        agentRole: event.entry.agentRole,
        summary: event.entry.summary,
        details: event.entry.details,
      });
    },
  });

  // Timer events → agent message delivery + WS broadcast
  timerRegistry.on('timer:fired', (timer: { agentId: string; label: string; message: string }) => {
    const agent = agentManager.get(timer.agentId);
    if (agent && agent.status !== 'completed' && agent.status !== 'failed' && agent.status !== 'terminated') {
      agent.queueMessage(`[System Timer "${timer.label}"] ${timer.message}`);
    }
    const projectId = agentManager.getProjectIdForAgent(timer.agentId);
    c.internal.wsServer?.broadcastEvent({ type: 'timer:fired', timer }, projectId);
  });
  timerRegistry.on('timer:created', (timer: { id: string; agentId: string; label: string }) => {
    const projectId = agentManager.getProjectIdForAgent(timer.agentId);
    c.internal.wsServer?.broadcastEvent({ type: 'timer:created', timer }, projectId);
  });
  timerRegistry.on('timer:cancelled', (timer: { id: string; agentId: string; label: string }) => {
    const projectId = agentManager.getProjectIdForAgent(timer.agentId);
    c.internal.wsServer?.broadcastEvent({ type: 'timer:cancelled', timer }, projectId);
  });

  // DAG → Eager scheduler re-evaluation
  taskDAG.on('dag:updated', () => eagerScheduler!.evaluate());

  // Eager scheduler → Lead notification
  eagerScheduler!.on('task:ready', ({ taskId }: { taskId: string }) => {
    const lead = agentManager.getAll().find(a => a.role?.id === 'lead' && a.status === 'running');
    if (lead) {
      lead.sendMessage(`[System] ⚡ Eager Scheduler: task now ready: ${taskId.slice(0, 8)}`);
    }
  });

  // Lock events → Capability registry
  lockRegistry.on('lock:acquired', ({ agentId, agentRole, filePath }: { agentId: string; agentRole: string; filePath: string }) => {
    const agent = agentManager.get(agentId);
    const leadId = agent?.parentId ?? agentId;
    capabilityRegistry!.recordFileTouch(agentId, agentRole, leadId, filePath);
  });

  // Decision log → Decision record store
  decisionLog.on('decision', (decision: any) => {
    decisionRecordStore!.createFromDecision(decision);
  });

  // Alert engine → WS broadcast (deferred — wsServer set after HTTP server creation)
  // This is wired in index.ts after httpServer is created
}
```

### Resulting `index.ts` (~100 lines)

```typescript
// packages/server/src/index.ts

import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getConfig, updateConfig } from './config.js';
import { originValidation } from './middleware/originValidation.js';
import { authMiddleware, initAuth, getAuthSecret } from './middleware/auth.js';
import { createContainer, wireHttpLayer } from './container.js';
import { apiRouter } from './api.js';
import { WebSocketServer } from './comms/WebSocketServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const authToken = initAuth();
const config = getConfig();

// ── Build service container ────────────────────────────────
const container = await createContainer({ config, repoRoot });

// ── Express app ────────────────────────────────────────────
const app = express();
app.use(cors({ origin: (origin, cb) => { /* same as before */ }, credentials: true }));
app.use(helmet());
app.use(originValidation);
app.use(express.json({ limit: '10mb' }));

const httpServer = createServer(app);

// Wire HTTP layer (WebSocket server + alert→WS bridge)
const wsServer = new WebSocketServer(
  httpServer, container.agentManager, container.lockRegistry,
  container.activityLedger, container.decisionLog, container.internal.chatGroupRegistry,
);
wireHttpLayer(container, httpServer, wsServer);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agents: container.agentManager.getAll().length });
});
app.use('/api', authMiddleware);
app.use('/api', apiRouter(container));

// Static file serving (same as before)
const webDistPath = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDistPath)) { /* same as before */ }

// ── Start ──────────────────────────────────────────────────
const port = await listenWithRetry(config.port, config.host);
container.startAll(); // starts contextRefresher, escalationManager
console.log(`🚀 Flightdeck running on http://${config.host}:${port}`);

// ── Graceful shutdown ──────────────────────────────────────
function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down...`);
  wsServer.close();
  container.shutdown().then(() => {
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  });
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

---

## 9. Design Decisions & Tradeoffs

| Decision | Rationale | Alternative Considered |
|---|---|---|
| Custom container, no library | Static dependency graph; greppable; AI-agent-friendly | awilix (adds proxy magic), InversifyJS (needs decorators) |
| `ServiceContainer extends AppContext` | Zero route changes (except costTracker fix); backward compatible | Separate types (would require route changes) |
| `internal` namespace for non-route services | Clear separation of what routes can access | Flat object (everything visible to routes) |
| Lifecycle via `stopList` array, `[...stopList].reverse()` | Simple, deterministic shutdown order. Non-mutating copy prevents double-shutdown race. | EventEmitter-based (harder to debug order) |
| Event wiring in dedicated `wireEvents()` | Isolatable, testable, documentable | Inline in factory (harder to read) |
| Two-stage construction: `createContainer()` + `wireHttpLayer()` | Eliminates `null as any` type holes. HTTP server needed first but container is fully typed at each stage. | Single factory with `httpServer: null as any` (type-unsafe) |
| `startAll()` method for deferred lifecycle start | Clean separation of build vs. start. Caller controls when lifecycle services begin (after HTTP listen). | Auto-start in factory (couples service lifecycle to construction) |
| Phase 1 = zero service changes | Minimizes risk; proves the pattern first | Refactor services to use interfaces (too much scope) |

---

## 10. Success Criteria

After implementation, these must be true:

- [ ] `pnpm typecheck` passes with zero errors
- [ ] `pnpm test:run` passes — all 41 existing tests unchanged
- [ ] `pnpm build` succeeds
- [ ] `index.ts` is ≤120 lines
- [ ] `api.ts` is ≤20 lines
- [ ] Adding a new service requires editing only `container.ts` (and optionally `routes/context.ts` if the route needs it)
- [ ] `container.shutdown()` calls `stop()` on all lifecycle services
- [ ] No service constructor signatures changed
- [ ] No route file changes
- [ ] At least one container test exists proving mock injection works

---

## 11. Open Questions (Resolved)

1. ~~**Should `httpServer` be created inside the container?**~~ **RESOLVED: No.** Keep it outside. Express app setup is a deployment concern. Container uses `wireHttpLayer()` to connect after HTTP server creation. (Per @e7f14c5e review)

2. ~~**Should `contextRefresher.start()` and `escalationManager.start()` be called inside `createContainer()` or by the caller?**~~ **RESOLVED: `startAll()` method.** Container exposes `startAll()` which the caller invokes after HTTP server is listening. Clean separation of build vs. start. (Per @e7f14c5e review)

3. **Should we add a `createTestContainer()` helper that builds with in-memory DB?** **Deferred to Phase 2.** Accepted recommendation — will dramatically improve integration test DX for R5/R9/R4 testing strategies. (Per @e7f14c5e review)

---

## 12. Review Log

| Date | Reviewer | Issues Found | Resolution |
|---|---|---|---|
| 2026-03-07 | @e7f14c5e | 3 issues: (1) `null as any` type holes, (2) `stopList.reverse()` mutation bug, (3) missing `costTracker` in AppContext | All 3 fixed. Added `wireHttpLayer()`, non-mutating reverse, `costTracker` to AppContext. Also added `startAll()` per recommendation. |

---

*This spec is designed to be implementable without further questions. Every file path, interface, and dependency order is explicit. Developers: start with Phase 1 — create `container.ts`, rewrite `index.ts`, verify all tests pass.*
