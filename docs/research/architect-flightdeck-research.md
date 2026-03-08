# Flightdeck — Architecture Research Report

**Author:** Architect Agent (e7f14c5e)  
**Date:** 2026-03-07  
**Repo:** `/Users/justinc/Documents/GitHub/flightdeck`  
**Version:** 0.3.2

---

## 1. What the Project Does

**Flightdeck** is a multi-agent orchestration platform for [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli). It runs as a local Node.js server with a real-time web dashboard, enabling users to manage teams of specialized AI agents that work on software engineering tasks in parallel.

### Core Value Proposition
Instead of one AI doing everything sequentially, Flightdeck spins up **multiple specialized agents simultaneously** — a developer writes code, a reviewer checks it, an architect designs the system, a secretary tracks progress — all coordinated through a Project Lead agent that decomposes tasks into a DAG and delegates work.

### Key Capabilities
- **Team orchestration**: 13 specialized roles (Lead, Developer, Architect, Reviewer, etc.) with distinct system prompts and default models
- **Task DAG**: Declarative task scheduling with dependencies; auto-links agents via delegation
- **Real-time web UI**: Dashboard with agent fleet overview, timeline, canvas graph, mission control, analytics, and chat
- **Structured communication**: Direct messages, broadcasts, group chats, @mentions between agents
- **File locking**: Pessimistic locks preventing concurrent edits on the same files
- **Human-in-the-loop**: Message any agent directly, approve decisions, pause/resume system
- **Persistence**: SQLite database for projects, sessions, decisions, activity logs surviving restarts

### Published as npm Package
```bash
npm install -g @flightdeck-ai/flightdeck
flightdeck
```

---

## 2. Current Architecture and Key Patterns

### 2.1 Monorepo Structure (npm workspaces)

```
Flightdeck/
├── bin/flightdeck.mjs          # CLI entry point
├── scripts/dev.mjs             # Sequential dev launcher
├── packages/
│   ├── server/                 # Express 5 + WebSocket backend (~29k LoC)
│   ├── web/                    # React 19 + Vite frontend (~50k LoC)
│   └── docs/                   # VitePress documentation site
├── presentations/              # Slidev presentation deck
├── .github/
│   ├── workflows/              # CI (Ubuntu + Windows), E2E, deploy-docs, release
│   └── skills/                 # 9 reusable skill documents for agent sessions
└── docs/images/                # Screenshot assets
```

### 2.2 Server Architecture (packages/server)

The server follows a **service-oriented in-process architecture** — many distinct services instantiated in `index.ts` and wired together through constructor injection and event listeners.

#### Entry Point (`index.ts` — 411 lines)
A massive "composition root" that:
1. Instantiates ~35+ service objects
2. Wires event listeners between them
3. Mounts Express middleware and routes
4. Starts the HTTP server with retry logic

#### Core Domain Modules

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `agents/` | Agent lifecycle, command dispatch, roles | `AgentManager.ts` (1037 LoC), `Agent.ts` (670 LoC), `CommandDispatcher.ts` (276 LoC), `RoleRegistry.ts` (748 LoC) |
| `agents/commands/` | 10 command handler modules | `AgentCommands.ts`, `CommCommands.ts`, `TaskCommands.ts`, `CoordCommands.ts`, `SystemCommands.ts`, `DeferredCommands.ts`, `TimerCommands.ts`, `CapabilityCommands.ts`, `DirectMessageCommands.ts`, `TemplateCommands.ts` |
| `acp/` | Copilot CLI process management | `AcpConnection.ts` (397 LoC) — spawns child processes, uses `@agentclientprotocol/sdk` |
| `comms/` | Communication infrastructure | `MessageBus.ts`, `ChatGroupRegistry.ts` (369 LoC), `WebSocketServer.ts` (542 LoC) |
| `coordination/` | Cross-cutting coordination services | ~47 files covering activity logging, alerts, decisions, file locking, context refresh, search, analytics, notifications, escalation, etc. |
| `tasks/` | Task DAG, scheduling, decomposition | `TaskDAG.ts` (906 LoC), `EagerScheduler.ts`, `TaskDecomposer.ts`, `TaskTemplates.ts` |
| `db/` | Database layer | `database.ts`, `schema.ts` (313 LoC), `ConversationStore.ts` |
| `routes/` | 30 Express route modules | Organized by domain: agents, roles, config, coordination, lead, decisions, search, etc. |
| `projects/` | Project persistence | `ProjectRegistry.ts` (351 LoC), `ModelConfigDefaults.ts` |
| `middleware/` | Auth, CORS, rate limiting | `auth.ts`, `originValidation.ts`, `rateLimit.ts` |

#### Key Architectural Patterns

1. **TypedEmitter Event Bus**: Core services extend `TypedEmitter<T>` for type-safe event propagation. `AgentManager` defines 30+ event types that flow to `WebSocketServer` for real-time UI updates.

2. **Command Parsing via Regex**: Agents emit commands in their text output wrapped in doubled Unicode brackets (`⟦⟦ COMMAND {...} ⟧⟧`). `CommandDispatcher` scans text buffers with regex patterns and routes to handler modules. This is a clever in-band signaling approach that works within the LLM text stream.

3. **Command Module Decomposition**: Commands are split across 10 modules (`AgentCommands`, `CommCommands`, etc.), each returning `CommandEntry[]` arrays that the dispatcher assembles. Clean separation of concerns.

4. **Pessimistic File Locking**: SQLite-backed locks with TTL, glob support, and expiry notifications prevent agents from editing the same files simultaneously.

5. **Activity Ledger with Batched Writes**: Batched activity logging (flushes every 250ms or 64 entries) for performance. Used as an event source that the `EventPipeline` reacts to.

6. **Reactive Event Pipeline**: Handlers register for activity events (task completion, commits, delegations) and can trigger automated actions (run tests, send webhooks, log summaries).

7. **SQLite + Drizzle ORM**: WAL mode with optimized pragmas. 19 migration files showing steady schema evolution. 14+ tables covering conversations, roles, settings, file locks, activity logs, decisions, agent memory, chat groups, DAG tasks, deferred issues, agent plans, projects, sessions, timers, cost records, collective memory.

8. **Scoped Git Commits**: `git add` only stages files the agent has locked — prevents leaking other agents' uncommitted work.

### 2.3 Frontend Architecture (packages/web)

| Layer | Technology | Pattern |
|-------|-----------|---------|
| Framework | React 19 | Functional components, lazy loading |
| Build | Vite 7.3 | Dev proxy to server, git hash injection |
| State | Zustand 5 | 6 stores: app, lead, group, settings, timeline, timer |
| Styling | Tailwind CSS 4 | Custom theme tokens, dark mode |
| Routing | React Router 7 | 14 routes with lazy loading |
| Charts | @visx | Overview charts, analytics |
| Graph | @xyflow/react | Canvas agent topology |
| Search | fuse.js | Client-side fuzzy search |
| Virtualization | react-virtuoso | Chat panel scrolling |

#### Key Frontend Patterns

1. **WebSocket-Driven Real-Time Updates**: Single WebSocket connection subscribes to all agent events. WS handlers split into `agentHandlers.ts`, `groupHandlers.ts`, `systemHandlers.ts`.

2. **Lazy Route Loading**: ~40-50% initial bundle reduction via `React.lazy()` for all route components.

3. **Command Palette**: Cmd/Ctrl+K powered by `NLCommandRegistry`, `PaletteSearchEngine`, `PaletteSuggestionEngine`.

4. **50+ Component Directories**: Rich UI including Lead Dashboard, Agent Dashboard, Timeline (swim-lane Gantt), Canvas (ReactFlow), Mission Control (8 configurable panels), Analytics, Group Chat, Task Queue, Approval Queue, Settings, etc.

### 2.4 ACP Integration

The server communicates with Copilot CLI through the **Agent Client Protocol (ACP)**:
- `AcpConnection` spawns a child process per agent
- Uses `@agentclientprotocol/sdk` for structured message exchange
- Supports autopilot mode, permission requests, session resume
- Handles tool calls, plan entries, content streaming, thinking indicators
- Prompt queue with priority support for interrupt messages

### 2.5 Documentation Site (packages/docs)

VitePress-based documentation with:
- **35 guide pages**: architecture, auto-dag, canvas, chat, commands, coordination, mobile, onboarding, playbooks, timeline, workflows, etc.
- **11 reference pages**: API, architecture decisions, configuration, database, WebSocket, etc.
- **1 design document**: Docker sandboxing proposal
- **Blog section**: Present but content not explored

---

## 3. Tech Stack and Dependencies

### Runtime Dependencies
| Dependency | Version | Purpose |
|-----------|---------|---------|
| `express` | ^5.2.1 | HTTP server (Express 5 — latest major) |
| `ws` | ^8.19.0 | WebSocket server |
| `better-sqlite3` | ^12.6.2 | Embedded SQLite database |
| `drizzle-orm` | ^0.45.1 | Type-safe ORM |
| `@agentclientprotocol/sdk` | ^0.14.1 | Copilot CLI integration |
| `zod` | ^4.3.6 | Runtime validation |
| `helmet` | ^8.1.0 | Security headers |
| `cors` | ^2.8.6 | CORS middleware |
| `uuid` | ^13.0.0 | UUID generation |

### Frontend Dependencies
| Dependency | Version | Purpose |
|-----------|---------|---------|
| `react` / `react-dom` | ^19.2.4 | UI framework (React 19) |
| `react-router-dom` | ^7.13.1 | Client routing |
| `zustand` | ^5.0.11 | State management |
| `@xyflow/react` | ^12.10.1 | Canvas graph visualization |
| `@visx/*` | ^3.12.0 | Charts and data visualization |
| `react-virtuoso` | ^4.18.3 | Virtual scrolling |
| `fuse.js` | ^7.1.0 | Fuzzy search |
| `lucide-react` | ^0.577.0 | Icons |

### Dev Dependencies
| Tool | Version | Purpose |
|------|---------|---------|
| `typescript` | ^5.9.3 | Type system |
| `vitest` | ^4.0.18 | Unit testing |
| `@playwright/test` | ^1.58.2 | E2E testing |
| `@testing-library/react` | ^16.3.2 | Component testing |
| `tailwindcss` | ^4.2.1 | CSS framework |
| `vite` | ^7.3.1 | Frontend build tool |
| `tsx` | ^4.21.0 | Dev-time TypeScript execution |
| `drizzle-kit` | ^0.31.9 | Database migrations |
| `eslint` | ^10.0.2 | Linting |
| `prettier` | ^3.8.1 | Code formatting |

### Build & CI
- **Node.js >= 20** required
- **ESM-only** (`"type": "module"` in all packages)
- **TypeScript**: ES2022 target, NodeNext module resolution, strict mode
- **CI**: GitHub Actions on Ubuntu and Windows, separate E2E workflow, docs deployment

---

## 4. Testing Approach

### Server Tests
- **125 test files** in `packages/server/src/__tests__/` (~38,300 lines)
- **Framework**: Vitest with global mode, node environment
- **Coverage**: V8 provider with text, lcov, json-summary reporters
- **Pattern**: Tests import service classes directly, create instances with mock dependencies (no test framework-level mocking visible — tests build their own helpers)
- **Helpers directory**: `packages/server/src/__tests__/helpers/` for shared test utilities
- **Test naming**: Descriptive, domain-focused (e.g., `AutoDAG.integration.test.ts`, `FileLockRegistry.test.ts`, `TaskDAG.e2e.test.ts`)
- **Integration tests**: Several files (e.g., `api.integration.test.ts`, `TaskDAG.e2e.test.ts`, `AutoDAG.integration.test.ts`)

### Frontend Tests
- **67 test files** across `packages/web/src/`
- **Framework**: Vitest + Testing Library (React) + jsdom
- **E2E**: 7 Playwright spec files in `packages/web/e2e/` covering smoke, agent dashboard, coordination, error states, settings, multi-agent, terminal panel
- **Test collocation**: Tests in `__tests__/` directories within component folders

### Test Coverage Assessment
- **Server**: Excellent coverage — 125 tests covering nearly every service (every file in `coordination/` and `agents/` has a matching test file)
- **Frontend**: Moderate coverage — 67 unit tests + 7 E2E specs. Could use more component-level tests
- **CI**: Tests run on push/PR for both Ubuntu and Windows

---

## 5. Areas for Improvement

### 5.1 🔴 Critical: God Object in `index.ts` (Composition Root)

**Problem**: `index.ts` is a 411-line file that manually instantiates ~35+ services and wires them together through ad-hoc event listeners. The `apiRouter()` function takes **35+ positional parameters**. This is brittle, hard to test, and painful to extend.

**Recommendation**: Introduce a **Dependency Injection Container** or at minimum an `AppContext` object that bundles all services. The route modules already use an `AppContext` type — extend this pattern to the full server bootstrap. Consider a simple DI approach:

```typescript
// services/container.ts
export function createContainer(config: ServerConfig): AppContext {
  const db = new Database(config.dbPath);
  const lockRegistry = new FileLockRegistry(db);
  // ... build all services in dependency order
  return { db, lockRegistry, ... };
}
```

This would eliminate the 35-parameter function signature and make testing the composition trivial.

### 5.2 🔴 Critical: `apiRouter` 35-Parameter Function Signature

**Problem**: `api.ts` exports `apiRouter()` that takes 35+ positional parameters, each a different service. This is unmaintainable — adding a new service requires changing the call site, the function signature, and manually threading it through.

**Recommendation**: Already partially solved with `AppContext` in routes. Complete the migration: have `apiRouter` accept a single `AppContext` object. The `mountAllRoutes` function already expects `AppContext`.

### 5.3 🟡 Moderate: Large Files Needing Decomposition

Several files exceed 600 lines and do too many things:

| File | Lines | Concern |
|------|-------|---------|
| `AgentManager.ts` | 1,037 | Agent lifecycle + delegation + crew updates + health monitoring |
| `NLCommandService.ts` | 923 | Natural language command parsing |
| `TaskDAG.ts` | 906 | Task graph + dependency resolution + auto-linking + status reporting |
| `AgentLifecycle.ts` | 855 | Agent spawning + restart + termination |
| `RoleRegistry.ts` | 748 | Role definitions + CRUD + system prompts |
| `ConflictDetectionEngine.ts` | 743 | Multiple conflict detection strategies |
| `DecisionLog.ts` | 673 | Decision CRUD + confirmation + batching |
| `Agent.ts` | 670 | Agent state + ACP bridge + context building |
| `TaskCommands.ts` | 637 | 8+ task-related command handlers |

**Recommendation**: `AgentManager` could be split into `AgentLifecycleManager` (spawn/terminate/restart), `AgentCrewManager` (crew updates/formatting), and `AgentDelegationManager` (delegation tracking). `RoleRegistry` could extract role definitions into a separate `built-in-roles.ts` data file.

### 5.4 🟡 Moderate: `coordination/` Directory is a Catch-All (47 Files)

**Problem**: The `coordination/` directory contains 47 files covering vastly different concerns: activity logging, alerts, analytics, budgets, community playbooks, complexity monitoring, conflict detection, context refresh, coverage tracking, debate detection, decisions, dependencies, diffs, escalation, events, file dependencies, handoffs, knowledge transfer, NL commands, notifications, predictions, project templates, recovery, reports, search, sessions, synthesis, timers, webhooks, worktrees.

**Recommendation**: Sub-organize into domain clusters:
```
coordination/
├── activity/          # ActivityLedger, SmartActivityFilter
├── alerts/            # AlertEngine, EscalationManager, NotificationManager, NotificationService
├── code-quality/      # CoverageTracker, ComplexityMonitor, DependencyScanner, ConflictDetectionEngine
├── decisions/         # DecisionLog, DecisionRecords, DebateDetector
├── events/            # EventPipeline, WebhookManager
├── files/             # FileLockRegistry, FileDependencyGraph, DiffService, WorktreeManager
├── knowledge/         # KnowledgeTransfer, CollectiveMemory, SearchEngine
├── projects/          # ProjectTemplates, SessionExporter, SessionRetro, SessionReplay
├── recovery/          # RecoveryService, HandoffService
├── reporting/         # ReportGenerator, PerformanceScorecard, AnalyticsService
├── scheduling/        # TimerRegistry, Scheduler
└── ...
```

### 5.5 🟡 Moderate: Frontend `LeadDashboard.tsx` is 2,577 Lines

**Problem**: The Lead Dashboard component is 2,577 lines — nearly 5% of the entire frontend codebase. This is a monolithic component that likely handles project creation, lead chat, agent overview, task management, and more in a single file.

**Recommendation**: Decompose into focused sub-components: `ProjectCreationDialog`, `LeadChatPanel`, `AgentFleetOverview`, `TaskProgressSummary`, etc. Each should be independently testable and comprehensible.

### 5.6 🟢 Opportunity: Rethink In-Band Command Parsing

**Current approach**: Commands are embedded in LLM text output using Unicode brackets (`⟦⟦ CMD {...} ⟧⟧`) and parsed via regex from text buffers.

**Observation**: This is actually quite clever for the LLM-to-server channel — it's the only practical way to extract structured commands from a text stream. However, the buffer management and regex parsing is error-prone (see `isInsideCommandBlock.test.ts`, `LegacyBracketCompat.test.ts`).

**Recommendation**: Consider whether ACP tool calls could replace some command types (if ACP supports custom tools), which would give structured data instead of text parsing. For commands that must remain text-based, consider a streaming JSON parser approach rather than regex.

### 5.7 🟢 Opportunity: Feature Flags / Feature Toggles

**Problem**: Several features appear to be in various states of development or deprecation (WorktreeManager is "in development", PredictionService was "removed from frontend", CommunityPlaybooks, etc.) but the code is still present and initialized.

**Recommendation**: Introduce a simple feature flag system to cleanly enable/disable experimental features without dead code paths running at startup.

### 5.8 🟢 Opportunity: Shared Types Package

**Problem**: Frontend types are defined in `packages/web/src/types/index.ts` and server types are scattered across modules. There's likely duplication of interfaces like `AgentInfo`, `Role`, `Decision`, etc.

**Recommendation**: Extract a `packages/shared` or `packages/types` package with common interfaces shared between server and client. This eliminates drift between what the server sends and what the client expects.

### 5.9 🟢 Opportunity: WebSocket Protocol Type Safety

**Problem**: WebSocket messages are typed as string unions on the client (`WsMessage` type) but constructed ad-hoc on the server (`broadcastEvent({ type: 'alert:new', alert }, ...)`). No shared schema ensures server and client agree on message shapes.

**Recommendation**: Define a shared WebSocket protocol schema (using Zod or TypeScript discriminated unions) that both server and client import. This catches protocol drift at compile time.

### 5.10 🟢 Opportunity: Database Migration Strategy

**Observation**: 19 migration files, some auto-named (`0000_red_titania.sql`, `0007_violet_tyrannus.sql`) and some descriptively named (`0005_archived_groups.sql`, `0010_dag_task_title.sql`). The auto-naming makes it hard to understand migration history at a glance.

**Recommendation**: Standardize migration naming to always include a descriptive suffix. Consider adding a migration documentation convention.

### 5.11 🟢 Opportunity: Server Startup Performance

**Problem**: `index.ts` eagerly initializes every service on startup, including features that may never be used in a session (NLCommandService, PredictionService, CommunityPlaybooks, etc.).

**Recommendation**: Lazy-initialize services on first use. Services like `ComplexityMonitor`, `DependencyScanner`, `ReportGenerator`, `KnowledgeTransfer` could be created on demand rather than at boot.

### 5.12 🟢 Opportunity: `@deprecated` Raw SQL Methods

**Problem**: `Database` class has `run()`, `get()`, `all()` methods marked `@deprecated` in favor of Drizzle ORM, but they're still present.

**Recommendation**: Complete the Drizzle migration and remove the raw SQL methods. Grep for usage first — if still referenced, migrate those call sites.

---

## 6. Architecture Strengths Worth Preserving

1. **SQLite with WAL mode** — Excellent choice for a local-first application. Zero configuration, survives crashes, and WAL enables concurrent reads during writes. The pragma tuning is well done.

2. **Command module decomposition** — The `CommandDispatcher` → command modules pattern is clean and extensible. Adding a new command means adding a handler function to the appropriate module.

3. **Event-driven architecture** — `TypedEmitter` provides type-safe events throughout the server. The `EventPipeline` enables reactive automation without tight coupling.

4. **Lazy route loading** — Smart frontend optimization with 40-50% bundle size reduction.

5. **Comprehensive test suite** — 125 server test files covering nearly every service is impressive for a project of this size.

6. **Skills system** — `.github/skills/` provides reusable knowledge for future agent sessions — a meta-learning system.

7. **Scoped git commits** — Preventing `git add -A` from leaking other agents' work is a critical safety feature for multi-agent development.

8. **Session persistence** — Projects and state survive server restarts via SQLite, which is essential for reliability.

9. **Multi-model diversity** — Different roles default to different AI models (Opus for complex reasoning, Sonnet for review, GPT for writing, Gemini for critical review). This is a thoughtful optimization.

---

## 7. Summary Statistics

| Metric | Value |
|--------|-------|
| Server source (non-test) | ~29,400 lines TypeScript |
| Server tests | ~38,300 lines across 125 files |
| Frontend source (inc. tests) | ~50,400 lines TypeScript/TSX |
| Frontend E2E tests | 7 Playwright spec files |
| Database tables | 14+ tables |
| Database migrations | 19 |
| API route modules | 30 |
| Agent roles | 13 built-in |
| ACP command types | 30+ |
| Documentation pages | 46+ |
| CI workflows | 5 (CI, CI-Windows, E2E, deploy-docs, release) |
| npm package | `@flightdeck-ai/flightdeck` |

---

## 8. Questions for Further Investigation

1. **How does context compaction work?** — `ContextCompressor.ts` and `ContextRefresher.ts` handle context window management, but the exact strategy for when/how to compact deserves analysis.
2. **WorktreeManager status** — Described as "in development" but wired into AgentManager. What's blocking it?
3. **Token budget optimization** — `TokenBudgetOptimizer.ts` and `ModelSelector.ts` are initialized but their actual effectiveness at model/budget selection is unclear.
4. **Community playbooks** — Feature presence suggests multi-user/team scenarios. Is this used?
5. **CollectiveMemory** — Cross-session knowledge persistence is a fascinating capability. How well does it work in practice?
