# Architecture

Flightdeck uses a **two-tier architecture** that separates the orchestration server from the user interface. Agents run in-process via the AcpAdapter and AgentAcpBridge — there is no separate agent server process.

## System Overview

```
┌─────────────────────────────────────────────────┐
│          Web Client (Vite + React 19)           │
│  Dashboards, Kanban, Chat, Settings, Timeline   │
└──────────────────┬──────────────────────────────┘
                   │ REST API + WebSocket
                   ▼
┌──────────────────────────────────────────────────┐
│       Orchestration Server (Express 5)           │
│  Projects, Sessions, Knowledge, Governance,      │
│  AgentManager, AcpAdapter, WebSocket hub         │
└──────────────────┬───────────────────────────────┘
                   │ ACP protocol (stdio) via AgentAcpBridge
                   ▼
            ┌──────────────┐
            │  CLI Binaries │
            │  (×N agents)  │
            └──────────────┘
```

## Agent Adapters

Agents run **in-process** within the orchestration server. Each agent is managed by the AgentManager and communicates with its CLI binary via the AcpAdapter and AgentAcpBridge over ACP (stdio).

### CLI Adapters

All providers use a single adapter backend that implements the `AgentAdapter` interface:

| Backend | Transport | Session Resume | Used By |
|---------|-----------|---------------|---------|
| **AcpAdapter** | ACP over stdio | Best-effort (`loadSession()`, falls back to `newSession()`) | All providers (Copilot, Claude, Gemini, Cursor, Codex, OpenCode) |
| **MockAdapter** | In-memory | N/A | Testing only |

See the [adapter-architecture-pattern](/skills) for details.

## Tier 1: Orchestration Server

The orchestration server is the main process — an Express 5 application with WebSocket support that manages projects, sessions, knowledge, governance, and agent coordination.

**Entry point:** `packages/server/src/index.ts`

### Startup Sequence

1. Load config (YAML + env vars)
2. Create DI container via `createContainer()` — 35+ services in 6 dependency tiers
3. Reconcile stale sessions/agents from previous runs
4. Mount Express routes and WebSocket server
5. Attempt session resume (non-blocking)
6. Install graceful shutdown handlers

### Service Container

Services are initialized in dependency order (Tier 0 → Tier 5):

| Tier | Services | Examples |
|------|----------|---------|
| **0** | Config & DB | `Database`, `ConfigStore` (hot-reloadable) |
| **1** | Core registries | `ProjectRegistry`, `TaskDAG`, `KnowledgeStore`, `FileLockRegistry`, `RoleRegistry` |
| **2** | Stateless services | `MessageBus`, `EventPipeline`, `ModelSelector`, `TokenBudgetOptimizer` |
| **3** | Composed services | `GovernancePipeline` (6 hooks), `SearchEngine`, `SkillsLoader`, `EscalationManager` |
| **4** | AgentManager | Central orchestrator — spawns agents, routes messages, manages delegations |
| **5** | Manager-dependent | `AlertEngine`, `ContextRefresher`, `SessionResumeManager`, `IntegrationRouter` |

### Route Modules

34 route modules provide ~279 REST endpoints:

`agents`, `analytics`, `browse`, `comms`, `config`, `conflicts`, `context`, `coordination`, `data`, `db`, `decisions`, `diff`, `integrations`, `knowledge`, `lead`, `nl`, `notifications`, `oversight`, `projects`, `replay`, `roles`, `search`, `services`, `sessions`, `settings`, `shared`, `summary`, `tasks`, `teams`

All routes receive the full `AppContext` (service container) for dependency injection.

### Key Subsystems

| Subsystem | Purpose |
|-----------|---------|
| **AgentManager** | Spawns agents, detects commands in output streams, routes messages, manages delegations |
| **GovernancePipeline** | 6 hooks (file write guard, shell blocklist, commit validation, rate limiting) intercepting agent actions |
| **KnowledgeStore** | FTS5 full-text search with 4-tier memory categories and token-budgeted injection |
| **SessionResumeManager** | Persists agent state, orchestrates resume on startup |
| **TaskDAG** | Declarative task scheduling with dependencies, status tracking, soft-delete |
| **CommandDispatcher** | Parses doubled Unicode-bracket commands from agent output, routes to 10 command modules |
| **AlertEngine** | Proactive detection: stuck agents, context pressure, duplicate edits, stale decisions |
| **IntegrationRouter** | Routes agent events to external channels (Telegram, Slack) via NotificationBatcher |

## Tier 2: Web Client

A React 19 single-page application built with Vite and Tailwind CSS 4.

**Entry point:** `packages/web/src/main.tsx`

### State Management

7 Zustand stores manage client state:

| Store | Scope |
|-------|-------|
| **useAgentStore** | Agent roster, status, messages |
| **useProjectStore** | Projects, sessions, active selection |
| **useNavigationStore** | Tab state, history, breadcrumbs |
| **useSettingsStore** | User preferences, Trust Dial level |
| **useWebSocketStore** | Connection state, event subscriptions |
| **useSearchStore** | Global search state |
| **useNotificationStore** | Toast and notification queue |

### Real-Time Data Flow

The client uses a **signal + refetch** pattern for real-time updates:

1. Server emits lightweight WebSocket signal (e.g., `attention:updated`)
2. Client receives signal, refetches from REST endpoint
3. Zustand store updates, React re-renders

This avoids tight coupling between WebSocket event schemas and component expectations. Agent text streaming is the exception — streamed directly over WebSocket for low latency.

### Error Handling

- **RouteErrorBoundary** on all 19 routes — catches render errors, shows retry UI
- **SectionErrorBoundary** on feed sections, sidebar, header — isolates failures
- **30-second fetch timeout** on all API calls via `AbortController`
- Error boundaries auto-reset on navigation

## Communication Protocols

### REST API (Client ↔ Orchestration Server)

Standard REST with JSON payloads. Auth via bearer token (auto-generated on first start). Key endpoint groups:

- `/agents` — Agent lifecycle and messaging
- `/projects` — Project CRUD, sessions, resume
- `/tasks` — DAG task management (Kanban board)
- `/decisions` — Decision log with accept/reject
- `/knowledge` — Knowledge store CRUD and search
- `/settings` — Configuration management

### WebSocket (Orchestration Server → Client)

40+ event types pushed to connected clients. Key events:

| Event | Purpose |
|-------|---------|
| `agent:spawned` / `agent:terminated` | Agent lifecycle |
| `agent:text` / `agent:thinking` | Streaming output |
| `lead:decision` / `lead:progress` | Lead updates |
| `attention:updated` | AttentionBar refresh signal |
| `alert:new` | System alerts |
| `context_compacted` | Context window compaction |

## Database

SQLite with WAL mode and Drizzle ORM. 30+ tables across domains:

- **Agent state:** `agent_roster`, `active_delegations`, `agent_plans`
- **Tasks:** `dag_tasks` (with soft-delete via `archivedAt`)
- **Knowledge:** `knowledge_entries`, `collective_memory`
- **Activity:** `activity_log`, `decision_log`, `message_queue`
- **Configuration:** `settings`, `timers`, `contacts`

Optimized pragmas:
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -256000;  -- 256MB
PRAGMA foreign_keys = ON;
```

See [Database Schema](/reference/database) for table definitions.

## Configuration

Flightdeck loads configuration from multiple sources (later overrides earlier):

1. **Built-in defaults** — sensible defaults for all settings
2. **User config** — `~/.flightdeck/config.yaml` (auto-created on first run)
3. **Repo-level config** — `flightdeck.config.yaml` in the project root
4. **Environment variable override** — `FLIGHTDECK_CONFIG` points to a specific file
5. **Environment variables** — startup-only overrides for individual settings

Config is hot-reloadable via chokidar file watcher — changes to the YAML file take effect without restarting the server.

Key environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `FLIGHTDECK_PORT` | `3000` | Server port |
| `FLIGHTDECK_HOST` | `127.0.0.1` | Bind address |
| `FLIGHTDECK_CONFIG` | `./flightdeck.config.yaml` | Config file path |
| `FLIGHTDECK_STATE_DIR` | `~/.flightdeck` | State directory |

See [Configuration Reference](/reference/configuration) for the full config schema and `flightdeck.config.example.yaml` for an annotated example.
