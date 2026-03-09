# Architecture

Flightdeck uses a **three-tier architecture** that separates agent process management from orchestration logic and the user interface. This separation ensures that agent processes survive orchestrator restarts and that the system can recover gracefully from crashes.

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
│  AgentManager, 35 route modules, WebSocket hub   │
└──────────────────┬───────────────────────────────┘
                   │ IPC (parent→child) + TCP (reconnect)
                   ▼
┌──────────────────────────────────────────────────┐
│       Agent Server (Detached Child Process)       │
│  CLI adapters (Copilot, Claude, Gemini, etc.)    │
│  Process isolation, PID files, event replay       │
└──────────────────┬───────────────────────────────┘
                   │ SDK / ACP protocol
                   ▼
            ┌──────────────┐
            │  CLI Binaries │
            │  (×N agents)  │
            └──────────────┘
```

## Tier 1: Agent Server

The agent server runs as a **detached child process** that manages CLI agent lifecycles. It survives orchestrator restarts, enabling session resume without losing running agents.

**Entry point:** `packages/server/src/agent-server-entry.ts`

### Process Model

1. The orchestrator forks the agent server with `detached: true`
2. The agent server writes PID, port, and auth token files to `~/.flightdeck/`
3. Communication flows over Node.js IPC (parent↔child pipe)
4. If the orchestrator restarts, it reconnects via TCP using the port file

```
~/.flightdeck/
  agent-server.pid       # PID of running agent server
  agent-server.port      # TCP port for reconnection
  agent-server.token     # 256-bit hex auth token (timingSafeEqual)
```

### Key Components

| Component | Responsibility |
|-----------|---------------|
| **AgentServer** | Message dispatch for spawn, terminate, prompt, cancel, list, subscribe, shutdown. Orphan self-termination timer (12h). |
| **ForkListener** | Dual-mode listener: IPC (primary) + TCP localhost (reconnection). Auth timeout: 5s. |
| **ManagedAgent** | Wraps a CLI adapter instance with lifecycle state and event forwarding. |
| **EventBuffer** | Replays missed events on reconnect via `lastSeenEventId` cursor. |
| **AgentServerPersistence** | Saves agent state to SQLite on lifecycle events (spawn, terminate, exit). |

### IPC Messages

**Orchestrator → Agent Server:**
`spawn_agent`, `send_message`, `terminate_agent`, `cancel_agent`, `list_agents`, `subscribe`, `ping`, `authenticate`

**Agent Server → Orchestrator:**
`agent_spawned`, `agent_event` (text, thinking, tool_call, usage, etc.), `agent_exited`, `agent_list`, `pong`, `auth_result`, `error`

### CLI Adapters

Three adapter backends implement the `AgentAdapter` interface:

| Backend | Transport | Session Resume | Used By |
|---------|-----------|---------------|---------|
| **AcpAdapter** | ACP over stdio | Best-effort | All 6 providers |
| **ClaudeSdkAdapter** | `@anthropic-ai/claude-agent-sdk` | Explicit (`query({ resume })`) | Claude |
| **CopilotSdkAdapter** | `@github/copilot-sdk` JSON-RPC | Explicit (`client.resumeSession()`) | Copilot |

All SDK imports are **lazy** (`dynamic import()`) so the server starts without any SDK installed. See the [adapter-architecture-pattern](/skills) for details.

## Tier 2: Orchestration Server

The orchestration server is the main process — an Express 5 application with WebSocket support that manages projects, sessions, knowledge, governance, and agent coordination.

**Entry point:** `packages/server/src/index.ts`

### Startup Sequence

1. Load config (YAML + env vars)
2. Create DI container via `createContainer()` — 35+ services in 6 dependency tiers
3. Reconcile stale sessions/agents from previous runs
4. Fork or reconnect to the agent server
5. Mount Express routes and WebSocket server
6. Attempt session resume (non-blocking)
7. Install graceful shutdown handlers

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

35 route modules provide ~279 REST endpoints:

`agents`, `agent-server`, `analytics`, `browse`, `comms`, `community`, `config`, `conflicts`, `context`, `coordination`, `data`, `db`, `debates`, `decisions`, `diff`, `handoffs`, `integrations`, `knowledge`, `lead`, `nl`, `notifications`, `playbooks`, `predictions`, `projects`, `recovery`, `replay`, `roles`, `search`, `services`, `sessions`, `settings`, `shared`, `summary`, `tasks`, `teams`

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

## Tier 3: Web Client

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

### IPC (Orchestration Server ↔ Agent Server)

Binary-safe JSON messages over Node.js IPC channel (primary) or TCP localhost (reconnection). See [Tier 1: Agent Server](#tier-1-agent-server) for message types.

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

Flightdeck loads configuration from three sources (later overrides earlier):

1. **Built-in defaults** — sensible defaults for all settings
2. **YAML config file** — `flightdeck.config.yaml` in project root (hot-reloadable)
3. **Environment variables** — startup-only overrides

Key environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `FLIGHTDECK_PORT` | `3000` | Server port |
| `FLIGHTDECK_HOST` | `127.0.0.1` | Bind address |
| `FLIGHTDECK_CONFIG` | `./flightdeck.config.yaml` | Config file path |
| `FLIGHTDECK_STATE_DIR` | `~/.flightdeck` | State directory (PID files, etc.) |

See [Configuration Reference](/reference/configuration) for the full config schema and `flightdeck.config.example.yaml` for an annotated example.
