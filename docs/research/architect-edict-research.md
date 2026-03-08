# Edict (三省六部) — Research Report

> **Repository**: `/Users/justinc/Documents/GitHub/edict`
> **Analyzed by**: Architect agent 5699527d
> **Codebase**: ~12,500 LOC across Python + TypeScript/React

---

## 1. What the Project Does

Edict is a **multi-agent AI orchestration framework** that models its architecture on China's 1,300-year-old imperial governance system: the **Three Departments and Six Ministries** (三省六部). Instead of letting agents self-organize (like CrewAI or AutoGen), Edict enforces a rigid bureaucratic pipeline with institutional review gates, separation of powers, and full auditability.

### The Core Pipeline

```
Emperor (User) → Crown Prince (Triage) → Planning Dept (中书省) → Review Dept (门下省)
    → Dispatch Dept (尚书省) → Six Ministries (parallel execution) → Report Back
```

**12 specialized agents** each have a defined role:
- **太子 (Crown Prince)**: Message triage — separates casual chat from actionable commands
- **中书省 (Planning)**: Breaks commands into actionable sub-task plans
- **门下省 (Review)**: **Mandatory** quality gate — can veto and force re-planning (up to 3 rounds)
- **尚书省 (Dispatch)**: Routes approved plans to specialist ministries
- **Six Ministries**: 礼部 (Docs/UI), 户部 (Data/Analytics), 兵部 (Infrastructure/DevOps), 刑部 (Testing/Compliance), 工部 (Engineering), 吏部 (HR/Agent Management)
- **早朝官 (Morning Briefing)**: Daily news aggregation agent

### Key Differentiator

The **门下省 (Review Department)** is architecturally mandatory — every plan must pass through it. This is not an optional plugin; it's baked into the state machine. If the review rejects, the plan loops back to planning. This is the project's "killer feature" and a genuine innovation in multi-agent orchestration.

---

## 2. Architecture and Key Design Patterns

### 2.1 Dual Architecture (Legacy + Event-Driven)

The project has **two parallel architectures** in an active migration:

**Legacy Architecture** (`dashboard/server.py` + `scripts/`):
- Python stdlib HTTP server (no framework dependencies!)
- JSON file-based persistence (`data/tasks_source.json`)
- File-level locking via `fcntl` for multi-agent concurrent access
- CLI tool (`kanban_update.py`) as the agent-to-system interface
- 5-second HTTP polling for dashboard updates

**New Event-Driven Architecture** (`edict/backend/` + `edict/frontend/`):
- FastAPI + async SQLAlchemy + PostgreSQL + Redis Streams
- Event bus pattern with consumer groups and ACK guarantees
- WebSocket real-time push (replaces HTTP polling)
- Separate worker processes (Orchestrator + Dispatcher)
- Alembic database migrations

### 2.2 State Machine

Tasks flow through a **strict finite state machine** with 11 states:

```
Taizi → Zhongshu → Menxia → Assigned → Doing → Review → Done
                      ↕ (封驳 loop)
                   Zhongshu
```

State transitions are **whitelist-validated** — `STATE_TRANSITIONS` dict defines exactly which transitions are legal. This prevents agents from skipping steps or corrupting the workflow.

### 2.3 Event-Driven Architecture (New)

```
                ┌──────────────┐
                │  Redis       │
                │  Streams     │◄── Event Bus (publish/subscribe)
                └──────┬───────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
   ┌──────▼──────┐ ┌──▼─────────┐ ┌▼───────────┐
   │ Orchestrator │ │ Dispatcher  │ │  WebSocket  │
   │   Worker     │ │   Worker    │ │   Relay     │
   └──────────────┘ └─────────────┘ └─────────────┘
```

**Event Topics**: `task.created`, `task.planning.request`, `task.review.request`, `task.dispatch`, `agent.thoughts`, `agent.heartbeat`, etc.

The **Orchestrator Worker** is a state machine driver — it consumes events and automatically routes tasks to the next agent based on state transitions. The **Dispatch Worker** executes agent calls via OpenClaw CLI with concurrency control (semaphore, max 3 concurrent).

### 2.4 Agent Configuration via SOUL.md

Each agent is defined by a `SOUL.md` file — a markdown document that serves as the agent's system prompt. This is a clean, human-readable approach to agent configuration. The SOUL files contain:
- Role definition and personality
- Specific workflow instructions
- Kanban CLI command templates
- Progress reporting requirements
- Examples and anti-patterns

### 2.5 Subagent Composition Pattern

The Three Departments use a **subagent call chain**: 中书省 calls 门下省 as a subagent, then calls 尚书省 as a subagent, which in turn calls individual ministries as subagents. This creates a **hierarchical execution tree** rather than a flat peer network.

---

## 3. Notable Techniques and Innovations

### 3.1 Institutional Review as Architecture (门下省)

This is genuinely novel. While other frameworks offer optional human-in-the-loop, Edict makes automated review **mandatory and structural**. The Review Department can reject plans with specific feedback, forcing re-planning. After 3 rounds, it force-approves with caveats. This creates a natural quality improvement loop.

### 3.2 Data Sanitization Pipeline

The `_sanitize_text()` function in `kanban_update.py` is surprisingly sophisticated — it strips file paths, URLs, `Conversation` metadata bleed-through from chat platforms, "传旨" prefixes, and code blocks from task titles. There's also a minimum title length check and a junk-title blacklist. This solves a real-world problem: LLMs tend to paste raw input as titles.

### 3.3 Atomic JSON File Operations

The legacy system uses `fcntl` file locking with **temp-file-and-rename** atomic writes:
```python
tmp_fd, tmp_path = tempfile.mkstemp(dir=str(path.parent))
os.fdopen(tmp_fd, 'w').write(json.dumps(data))
os.replace(tmp_path, str(path))  # Atomic on POSIX
```
This prevents data corruption when multiple agents write simultaneously — a common problem in file-based multi-agent systems.

### 3.4 Redis Streams with ACK Recovery

The new event bus solves the critical reliability problem: if a worker crashes, unacknowledged events are **automatically reclaimed** by other consumers via `xautoclaim`. The `_recover_pending()` method on startup claims stale events older than 30-60 seconds. This eliminates the "lost dispatch" problem of the legacy daemon approach.

### 3.5 Dual Pub/Sub + Streams

Events are published to both Redis Streams (for reliable consumption) AND Redis Pub/Sub (for WebSocket real-time relay). This is a smart pattern — Streams guarantee at-least-once delivery for workers, while Pub/Sub provides low-latency push to the dashboard without the overhead of consumer groups.

### 3.6 Zero-Dependency Dashboard Server

The legacy `dashboard/server.py` is a ~1000-line Python stdlib HTTP server — no Flask, no FastAPI, no npm. It serves the React build artifacts, JSON APIs, and handles CORS, all with just `http.server.BaseHTTPRequestHandler`. This makes deployment trivially simple: `python3 dashboard/server.py`.

### 3.7 Progress Reporting Protocol

Every agent SOUL.md mandates calling `kanban_update.py progress` at key steps with a structured format:
```
"分析派发方案✅|派发工部✅|派发刑部🔄|汇总结果|回传中书省"
```
This creates a **pipeline visualization string** with emoji status indicators (✅ done, 🔄 in-progress, no emoji = pending). Clever use of structured text for real-time observability.

### 3.8 Court Ceremony (上朝仪式)

A delightful UX touch — the dashboard plays a court ceremony animation on first daily visit, showing today's statistics. This reinforces the imperial metaphor and makes the tool memorable.

---

## 4. Tech Stack and Dependencies

### Backend (Legacy)
| Layer | Technology |
|-------|-----------|
| Server | Python stdlib `http.server` (zero deps!) |
| Storage | JSON files with `fcntl` file locking |
| Agent CLI | `kanban_update.py` (CLI tool agents call) |
| Agent Runtime | OpenClaw (external AI agent platform) |

### Backend (New Event-Driven)
| Layer | Technology |
|-------|-----------|
| API | FastAPI ≥0.115 + Uvicorn |
| Database | PostgreSQL 16 + SQLAlchemy 2.0 (async) |
| Event Bus | Redis 7 Streams + Pub/Sub |
| ORM | SQLAlchemy async + Pydantic v2 |
| Migrations | Alembic |
| HTTP Client | httpx (async) |
| Config | pydantic-settings + dotenv |

### Frontend
| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript |
| State | Zustand 4.5 |
| Build | Vite 6 |
| Styling | Tailwind CSS 3.4 |
| Icons | lucide-react |
| Utilities | clsx |

### Infrastructure
| Layer | Technology |
|-------|-----------|
| Container | Docker multi-stage build (Node 20 + Python 3.11) |
| Orchestration | Docker Compose |
| CI/CD | Not yet visible (roadmap item) |

### Notable: Minimal Dependencies

The legacy backend has **zero Python dependencies** — purely stdlib. The new backend uses only 10 pip packages. The frontend has only 3 runtime dependencies (React, Zustand, lucide-react). This is remarkably lean for the feature set.

---

## 5. Testing Approach

### Test Suite
- **`test_kanban.py`**: Unit tests for the kanban CLI tool — create, state transitions, block/unblock
- **`test_e2e_kanban.py`**: End-to-end tests for the data sanitization pipeline — 9 scenarios, 17+ assertions covering dirty titles, path stripping, conversation metadata removal, short title rejection, prefix stripping, state updates
- **`test_server.py`**: HTTP server health check test
- **`test_file_lock.py`**: Concurrent file access tests (not examined in detail)

### Testing Patterns
- Tests use `tmp_path` pytest fixture for isolation
- Monkey-patching module-level `TASKS_FILE` to redirect to temp directories
- `autouse` fixture backs up and restores production data (for E2E tests that run against real data files)
- Tests validate both positive behavior AND rejection of bad input (negative testing)

### What's Missing
- No tests for the new FastAPI backend (event bus, task service, workers)
- No frontend tests (React components)
- No integration tests for the full agent pipeline
- No load/stress tests for concurrent agent access

---

## 6. What's Particularly Clever or Inspiring

### 6.1 🏆 The Metaphor IS the Architecture

Most projects use metaphors as decoration. Edict makes the Tang Dynasty governance system **the actual architecture**. The separation of planning, review, dispatch, and execution is not just naming — it creates real structural guarantees about quality and auditability. This is the most innovative aspect of the project.

**Takeaway for other projects**: Domain metaphors can be architectural blueprints, not just naming conventions. The constraints of the historical system (mandatory review, no skipping levels, audit trails) translate directly into software quality guarantees.

### 6.2 🏆 Agent Observability as First-Class Concern

The 10-panel dashboard with real-time pipeline visualization, heartbeat monitoring, flow logs, activity streams, and intervention controls is far ahead of any open-source multi-agent framework. The `progress` command protocol with emoji-encoded pipeline stages is simple but effective.

**Takeaway**: Multi-agent systems need observability dashboards as much as distributed systems need monitoring. Build observability in from day one.

### 6.3 🏆 Data Sanitization for LLM-Generated Content

The `_sanitize_text()` pipeline addresses a real pain point: LLMs generate messy titles with file paths, URLs, metadata bleed-through, and raw user input. The regex-based cleaning pipeline with junk detection is a practical solution.

**Takeaway**: Any system where LLMs generate user-facing text needs a sanitization layer. Build it early and test it with adversarial inputs.

### 6.4 🏆 CLI-as-Interface for Agent Actions

Instead of HTTP APIs or function calls, agents interact with the system by calling `kanban_update.py` via CLI. This is brilliant for several reasons:
- Zero SDK dependency for agents
- Works with any LLM that can generate shell commands
- Naturally auditable (command history)
- Easy to test (just call the Python function)
- Compatible with any agent runtime

**Takeaway**: CLI tools are an underrated interface for multi-agent systems. They're universal, auditable, and LLM-friendly.

### 6.5 🏆 Graceful Architecture Migration

The project maintains two working architectures simultaneously — the legacy file-based system and the new event-driven system. The new backend includes a `legacy.py` API router for backward compatibility. This demonstrates how to evolve a system without a big-bang rewrite.

### 6.6 Notable Details
- **Heartbeat detection** with three levels (🟢 active, 🟡 warn, 🔴 stalled)
- **Template library** with 9 pre-built task templates including parameter forms and cost estimates
- **News aggregation agent** (早朝简报官) that fetches daily tech/finance news — unusual but practical
- **Memorial system** (奏折阁) that archives completed tasks with full timeline replay
- **Model hot-swapping** per agent from the dashboard UI

---

## 7. Areas for Improvement

### Architectural Concerns
1. **Legacy/New split creates confusion**: Two parallel architectures mean two codepaths, two data stores, and potential state drift. The migration should be prioritized.
2. **No authentication/authorization**: The API has no auth. CORS is `*` in development. Fine for local use but blocks production deployment.
3. **Synchronous OpenClaw CLI calls**: The Dispatch Worker shells out to `subprocess.run` with a 300s timeout. This blocks a thread per agent call. Consider using async HTTP to an agent runtime instead.
4. **Hardcoded agent paths**: SOUL.md files reference absolute paths (`/Users/bingsen/clawd/...`). This breaks portability.

### Testing Gaps
- The new FastAPI backend has zero test coverage
- No integration tests for the event bus pipeline
- Frontend has no tests

### Scalability
- The legacy system's file-based JSON storage won't scale beyond a few hundred tasks
- The new PostgreSQL-based system addresses this but isn't fully deployed yet
- Redis Streams consumer group setup is single-consumer (`orch-1`, `disp-1`) — scaling would require consumer naming strategy

---

## 8. Relevance to Our Projects

Several patterns from Edict are directly applicable:

| Pattern | Edict Implementation | Potential Application |
|---------|---------------------|----------------------|
| **Mandatory review gates** | 门下省 state machine constraint | Any multi-agent pipeline needing quality control |
| **Event-driven orchestration** | Redis Streams + consumer groups + ACK | Reliable agent coordination without polling |
| **Agent observability dashboard** | 10-panel React dashboard | Any multi-agent system needing real-time visibility |
| **CLI-as-agent-interface** | `kanban_update.py` | Universal agent action interface |
| **Data sanitization** | `_sanitize_text()` pipeline | Any LLM-generated user-facing content |
| **Atomic JSON file ops** | `fcntl` + temp-file-rename | File-based systems with concurrent access |
| **SOUL.md agent config** | Markdown system prompts with examples | Agent configuration pattern |
| **Structured progress encoding** | Emoji pipeline strings (`✅|🔄|...`) | Lightweight status visualization |

---

*Report complete. The most transferable insight: structural constraints (like mandatory review) create better outcomes than relying on agent intelligence alone. Build quality gates into the architecture, not the prompts.*
