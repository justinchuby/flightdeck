# Architecture

## System Overview

```
React UI ←→ WebSocket ←→ Node.js Server ←→ ACP ←→ Copilot CLI ×N
                              │                         ↕
                         AgentManager          MCP SSE (crew_* tools)
                        ┌─────┴──────┐
                   MessageBus    ActivityLedger (batched)
                   DecisionLog   FileLockRegistry
                   Scheduler     ContextRefresher
                   CrewMcpServer (42 tools)
```

## Core Components

### AgentManager

The central orchestrator. Extends `TypedEmitter<AgentManagerEvents>` with 27 typed events.

**Responsibilities:**
- Spawns and manages agent lifecycle (creating → running → idle → completed)
- Manages MCP server endpoints for crew tool dispatch
- Routes inter-agent messages via MessageBus
- Manages delegations (parent → child task assignment)
- Persists agent plans to SQLite
- Monitors agent health (heartbeat, crash recovery)

### Agent

Wraps a single Copilot CLI process using ACP (Agent Client Protocol). Connects to a per-agent MCP server for crew coordination tools.

**Lifecycle:** `creating` → `running` → `idle` → `completed` / `failed`

Each agent has:
- A **role** (developer, architect, etc.) with a specialized system prompt
- A **model** (Claude, GPT, Gemini) that can be changed at runtime
- A `.agent.md` file that persists role instructions across context compaction
- Optional **parent** relationship for delegation tracking

### CrewMcpServer

Exposes 42 crew coordination tools as MCP tools with Zod-validated schemas. Each agent connects via Streamable HTTP transport to a per-agent MCP endpoint. Tool calls are dispatched to the same command handler modules used previously.

### MessageBus

Routes messages between agents with short ID resolution. Supports:
- **Direct messages** (agent-to-agent)
- **Broadcasts** (one-to-all)
- **Group chats** via ChatGroupRegistry

### ActivityLedger

Logs all agent actions to SQLite with **batched writes** — flushes every 250ms or every 64 entries. Read operations trigger a flush for consistency.

### DecisionLog

Records architectural decisions with title, rationale, alternatives, and optional user confirmation. Decisions surface in the dashboard for async review.

### FileLockRegistry

Prevents edit conflicts when multiple agents work on the same files. Agents acquire locks before editing and release them when done.

### ContextRefresher

Listens for `agent:context_compacted` events and re-injects crew context (team roster, active delegations, coordination rules) into the affected agent.

### Scheduler

Runs periodic background tasks:
- **Expired lock cleanup** (every 1 minute)
- **Activity log pruning** (every 1 hour)

## Database

SQLite with WAL mode and Drizzle ORM. Optimized pragmas:

```sql
PRAGMA journal_mode = WAL
PRAGMA synchronous = NORMAL
PRAGMA busy_timeout = 5000
PRAGMA cache_size = -64000
PRAGMA foreign_keys = ON
PRAGMA wal_checkpoint(PASSIVE)
```

See [Database Schema](/reference/database) for table definitions.

## Event System

The `TypedEmitter<AgentManagerEvents>` provides compile-time type safety for all 27 events. Each event maps to a single typed payload object.

See [WebSocket Events](/reference/websocket) for the full event list.
