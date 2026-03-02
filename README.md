# Flightdeck — Multi-Agent Copilot CLI Orchestrator

> [!WARNING]
> This is purely AI generated code. Use the project with this understanding in mind.

A real-time web UI that orchestrates teams of [Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) agents — each with a specialized role, its own context window, and the ability to collaborate through structured messaging. A **Project Lead** agent breaks down your task, assembles a team of developers, architects, reviewers, and more, then coordinates their work while you stay in the loop.

**Why Flightdeck?** Instead of one AI agent doing everything sequentially, Flightdeck runs multiple agents in parallel — each focused on what they do best. A developer writes code while a reviewer checks it, an architect designs the system, and a secretary tracks progress. The result: faster, higher-quality work with built-in checks and balances.

## Features

### 🎯 Team Orchestration
- **Project Lead** — Breaks down tasks, assembles a team, creates a task DAG, delegates work, and synthesizes results
- **Sub-Lead Delegation** — Architects can also create agents and delegate tasks, enabling hierarchical team structures
- **13 Specialized Roles** — Purpose-built agents with distinct system prompts and model diversity (see [Agent Roles](#agent-roles))
- **Task DAG** — Declarative task scheduling with dependencies; `PROGRESS` auto-reads DAG state when one exists. DAG auto-links to agents via `DELEGATE`/`CREATE_AGENT` — no manual tracking needed.
- **Human-in-the-Loop** — Message any agent directly; queued messages show with blue bubbles and a spinner. Remove or reorder queued messages before delivery.
- **System Pause/Resume** — Halt all message delivery system-wide; agents are notified to hold position. Queued messages stay in place until resumed.

### 💬 Communication
- **Direct Messaging** — Agents send structured messages to each other by ID
- **@Mentions** — Type `@` in chat to autocomplete agent names; mentioned agents receive the message
- **Group Chat** — Create groups by member ID or role; auto-created when 3+ agents work on the same feature; auto-archived when all members finish
- **Broadcasts** — Send a message to every active agent at once

### 📈 Visualization & Monitoring
- **Mission Control** — Single-screen project overview with 8 configurable panels: health summary, agent fleet, token economics, alerts, activity feed, DAG minimap, comm heatmap, and performance scorecards. Drag-and-drop panel reordering in Settings.
- **Timeline** — Swim-lane visualization of agent activity with filtering (role, status, comm type), interactive brush time selector, keyboard navigation, live auto-scroll mode, idle hatch patterns, hover tooltips showing task details and duration, **project tabs** for multi-project sessions, **Zustand store persistence** (state survives tab switches), **adaptive date display** (time-only for <24h sessions, date+time for multi-day), and **Clear Timeline** button for resetting cached data
- **Org Chart** — Team hierarchy visualization with **project tabs** for switching between active projects
- **DAG / Gantt Chart** — Scrollable and zoomable task Gantt chart with local timezone display
- **Token Economics** — Per-agent token breakdown with context pressure bars (80% yellow, 90% red warning thresholds)
- **Proactive Alerts** — Automatic detection of context pressure (>85%), duplicate file edits, idle agents with ready tasks, and stale decisions (>10min). _Note: Stuck agent detection is currently disabled to reduce noise in long-running sessions._
- **Real-Time Dashboard** — Live activity feed, team status, user-message highlighting (blue tint), agent reply highlighting via WebSocket
- **User-Directed Message Highlighting** — Lead marks messages intended for the user with `@user`; these render with accent border + background to stand out from system reactions
- **Three-Tier Messages** — Comms feed classifies messages as Critical (red), Notable (blue), or Routine (dimmed) with filter toggles
- **Catch-Up Summary** — After 60s of inactivity, a floating banner summarizes what happened while you were away
- **Project Health Header** — `CREW_UPDATE` messages include a health summary: completion %, agent fleet status, pending decisions, blocked tasks
- **Project Grouping** — Group and filter projects in the Tasks view with duplicate task detection

### ✅ Decision & Progress Tracking
- **Decision Log** — Track architectural decisions with accept/reject actions and reason comments; grouped by project with project names (not IDs); optimistic UI updates
- **PROGRESS/DAG Consolidation** — A single `PROGRESS` command auto-reads DAG state, eliminating the need for separate queries
- **Global Search** — Search across messages, tasks, decisions, and activity

### 🔒 Coordination & Safety
- **File Locking** — Pessimistic locks with TTL and glob support prevent concurrent edits
- **Scoped COMMIT** — The `COMMIT` command executes `git add` only on files the agent has locked, then commits and runs post-commit verification (`git diff --name-only HEAD~1`) to confirm the expected files actually landed. Prevents `git add -A` from leaking other agents' uncommitted work.
- **Merge Scope Validation** — When merging agent branches, `WorktreeManager.merge()` validates that only locked files were modified — defense-in-depth against accidental cross-contamination
- **Worktree Isolation** — ⚠️ _In development, not yet enabled._ Per-agent git worktrees are implemented in the backend (`WorktreeManager`) but not yet active in production. Agents currently share the repository working directory. See the [Coordination guide](packages/docs/guide/coordination.md) for details.
- **Event Pipeline** — Reactive event handlers auto-trigger actions (e.g., run tests after commits, log summaries on task completion)
- **Agent Controls** — Interrupt, terminate, restart agents; change models on the fly
- **Security** — Auto-generated auth tokens, CORS lockdown, rate limiting, path traversal validation

### 💾 Persistence & Recovery
- **Session Resume** — Resume from a previous Copilot session ID
- **Persistent Projects** — Projects survive lead sessions; resume with full context briefing. Chat history and project state auto-load on app startup.
- **Context Re-injection** — Automatic crew context recovery after context window compaction
- **Theme Persistence** — Light, Dark, and Follow System themes persist across sessions via shared store

## Quick Start

```bash
npx @flightdeck-ai/flightdeck
```

That's it — this downloads and runs Flightdeck, then opens the web UI in your browser.

**Options:** `--port=4000`, `--host=0.0.0.0`, `--no-browser`, `-v` / `--version`, `-h` / `--help`

### Local Development

```bash
npm install
npm run build
npm start
```

For development with hot reload:

```bash
npm run dev
```

- **Server**: `http://localhost:3001`
- **Web UI**: `http://localhost:5173` (dev) or `http://localhost:3001` (production)

### Creating a Project

1. Open the web UI — the **Lead** page is the default view
2. Click **Create Project**, provide a name, task, and optionally a working directory
3. The lead analyzes the task, creates agents, and starts delegating

## Architecture

**Monorepo** (`npm workspaces`):

| Package | Description |
|---------|-------------|
| `packages/server` | Express 5 + WebSocket server, ACP agent management, SQLite/Drizzle ORM |
| `packages/web` | React 19 + Vite frontend, Tailwind CSS 4, Zustand state, ReactFlow DAG, Mission Control |

**Tech stack**: Node.js · TypeScript · Express 5 · SQLite (WAL) · Drizzle ORM · React 19 · Vite · Tailwind CSS 4 · Zustand · ReactFlow · WebSocket (ws)

```
React UI ←→ WebSocket ←→ Node.js Server ←→ ACP ←→ Copilot CLI ×N
                              │
                         AgentManager (TypedEmitter)
                        ┌─────┴──────┐
                   MessageBus    ActivityLedger (batched writes)
                   DecisionLog   FileLockRegistry
                   Scheduler     ContextRefresher
                   ProjectRegistry  ChatGroupRegistry
                   CommandDispatcher  TimelineStore
                   DeferredIssueRegistry  EventPipeline
                   AlertEngine  TimerRegistry
```

### Key Components

| Component | Responsibility |
|-----------|---------------|
| **AgentManager** | Spawns agents, routes messages, manages delegations. Cascade termination with visited-set guard. |
| **CommandDispatcher** | Thin router that delegates to 10 command modules. Parses doubled Unicode-bracket commands (U+27E6/U+27E7) from agent output. |
| **Command Modules** | `AgentCommands`, `CommCommands`, `DirectMessageCommands`, `TaskCommands`, `CoordCommands`, `SystemCommands`, `DeferredCommands`, `TimerCommands`, `CapabilityCommands`, `TemplateCommands` — domain-grouped command handlers |
| **Agent** | Wraps a Copilot CLI process (ACP) with lifecycle management, message buffering, and memory bounds |
| **RoleRegistry** | Role definitions with system prompts, icons, colors, default models. `receivesStatusUpdates` flag for secretary auto-refresh. |
| **MessageBus** | Routes inter-agent messages and group chats |
| **FileLockRegistry** | Pessimistic file locking with TTL, glob support, expiry notifications. SQLite-backed. |
| **WorktreeManager** | ⚠️ _In development._ Per-agent git worktrees — create/merge/cleanup lifecycle. Wired into AgentManager but not yet enabled. |
| **ChatGroupRegistry** | Group lifecycle — create, archive, role-based membership, auto-creation for parallel work. Auto-adds new agents matching group role criteria. |
| **ActivityLedger** | Batched activity logging (flushes every 250ms or 64 entries) |
| **DecisionLog** | Decision tracking with accept/reject/reason workflow |
| **AlertEngine** | Proactive detection: stuck agents (with exemptions for leads, new agents, prompting agents), context pressure, duplicate edits, idle+ready mismatch, stale decisions |
| **ContextRefresher** | Re-injects crew context with health header after compaction events. Auto-refreshes secretary roles. |
| **Scheduler** | Background tasks: expired lock cleanup, activity pruning, delegation cleanup |
| **ProjectRegistry** | Persistent project management — CRUD, session tracking, briefing generation |
| **HeartbeatMonitor** | DAG-aware stall detection — nudges idle leads with remaining work |
| **EventPipeline** | Reactive event handlers: run CI after commits, log summaries on task completion, trigger webhooks |
| **CapabilityRegistry** | Tracks acquired agent expertise (files, technologies, domains) for smart matching |
| **EagerScheduler** | Pre-assigns upcoming tasks to idle agents before they become active |
| **TaskTemplates** | Reusable task templates with natural-language decomposition |
| **SearchEngine** | Full-text search across messages, tasks, decisions, and activity |
| **PerformanceScorecard** | Agent performance metrics: throughput, first-pass rate, velocity, cost efficiency |
| **DecisionRecords** | ADR-style structured decision records with status tracking |
| **CoverageTracker** | Test coverage monitoring with regression detection and trend analysis |
| **ComplexityMonitor** | File complexity analysis with 4-tier scoring and hotspot detection |
| **NotificationManager** | User notification preferences, quiet hours, priority-based routing |
| **EscalationManager** | Auto-escalation for stale decisions and blocked tasks |
| **ModelSelector** | Auto-picks optimal model based on task complexity, agent role, and budget |
| **TokenBudgetOptimizer** | Priority-weighted token allocation across active agents |
| **ParallelAnalyzer** | DAG bottleneck detection with critical path analysis |
| **ReportGenerator** | Session report generation in HTML and Markdown |
| **KnowledgeTransfer** | Cross-project knowledge sharing and context reuse |

> See the [Architecture Decisions](packages/docs/reference/architecture-decisions.md) page for the rationale behind key design choices.

## Agent Roles

Each agent is assigned a role with a specialized system prompt. The lead creates agents and assigns them tasks.

| Role | Icon | Focus | Default Model |
|------|------|-------|---------------|
| **Project Lead** | 👑 | Orchestration, delegation, team coordination | Claude Opus 4.6 |
| **Developer** | 💻 | Code implementation, tests, bug fixes | Claude Opus 4.6 |
| **Architect** | 🏗️ | System design, technical debt, architecture decisions. Can delegate tasks. | Claude Opus 4.6 |
| **Code Reviewer** | 📖 | Readability, maintainability, code patterns | Gemini 3 Pro |
| **Critical Reviewer** | 🛡️ | Security, performance, edge cases | Gemini 3 Pro |
| **Product Manager** | 🎯 | User needs, product quality, UX review | GPT-5.3 Codex |
| **Technical Writer** | 📝 | Documentation, API design review, developer experience | GPT-5.2 |
| **Designer** | 🎨 | UI/UX, interaction design, accessibility | Claude Opus 4.6 |
| **Generalist** | 🔧 | Cross-disciplinary problem solving | Claude Opus 4.6 |
| **Radical Thinker** | 🚀 | Challenge assumptions, propose bold alternatives | Gemini 3 Pro |
| **Secretary** | 📋 | Plan tracking, status reports, session summaries | GPT-4.1 |
| **QA Tester** | 🧪 | Test strategy, quality assurance, coverage analysis | Claude Sonnet 4.6 |
| **Agent** | ⚙️ | Neutral general-purpose agent, no role-specific instructions | CLI default |

Custom roles can be created via the Settings UI with your own system prompts, colors, and icons.

## ACP Command Reference

Agents communicate via structured commands wrapped in doubled Unicode brackets (`⟦⟦ COMMAND {...} ⟧⟧`, U+27E6/U+27E7) detected in their output stream. Commands are parsed by the `CommandDispatcher` and routed to the appropriate subsystem.

### Team Management (Lead + Architect)

| Command | Description |
|---------|-------------|
| `CREATE_AGENT {"role": "developer", "task": "..."}` | Spawn a new agent with a specific role. Optionally assign a task and model. |
| `SPAWN_AGENT {"role": "developer", "task": "..."}` | Alias for `CREATE_AGENT`. Available to non-lead agents (delegates to parent). |
| `DELEGATE {"to": "agent-id", "task": "...", "context": "..."}` | Assign a task to an existing agent. Leads and architects can delegate. |
| `TERMINATE_AGENT {"id": "agent-id", "reason": "..."}` | Terminate an agent and free its slot. Logs session ID for potential resume. |
| `INTERRUPT {"to": "agent-id", "content": "..."}` | Send a priority interrupt to a child agent, immediately stopping their current work. *(Parent agents only)* |

### Communication (All agents)

| Command | Description |
|---------|-------------|
| `AGENT_MESSAGE {"to": "agent-id", "content": "..."}` | Send a direct message to another agent by ID. |
| `DIRECT_MESSAGE {"to": "agent-id-prefix", "content": "..."}` | Queue a message to another agent without interrupting their current work. Matches by ID prefix. |
| `BROADCAST {"content": "..."}` | Send a message to all active agents. |
| `CREATE_GROUP {"name": "...", "members": ["id1"], "roles": ["developer"]}` | Create a named chat group. Specify members by ID, by role, or both. Lead is auto-included. |
| `GROUP_MESSAGE {"group": "...", "content": "..."}` | Send a message to all members of a group. Sender must be a member. |
| `ADD_TO_GROUP {"group": "...", "members": ["id"]}` | Add agents to an existing group. New members receive recent message history. |
| `REMOVE_FROM_GROUP {"group": "...", "members": ["id"]}` | Remove agents from a group. The lead cannot be removed. |
| `QUERY_GROUPS` | List all groups the agent belongs to, with member counts and last message preview. |
| `QUERY_PEERS` | Discover other active agents for direct messaging. |
| `REACT {"group": "...", "emoji": "👍"}` | Add an emoji reaction to the latest (or specified) message in a group. |

### Task & Progress (Lead-only unless noted)

| Command | Description |
|---------|-------------|
| `DECLARE_TASKS {"tasks": [...]}` | Declare a task DAG with dependencies. Tasks have `id`, `title`, `depends_on`. |
| `PROGRESS {"summary": "..."}` | Report progress. Auto-reads DAG state when a DAG exists — no need to query separately. |
| `COMPLETE_TASK {"id": "task-id", "summary": "...", "output": "..."}` | Mark a DAG task as done. Non-lead agents relay to parent's DAG with auth validation. Supports `id`, `summary`, `status`, `output` fields. *(Any agent)* |
| `TASK_STATUS` | Query current task DAG status. |
| `PAUSE_TASK {"taskId": "..."}` | Pause a pending/ready task in the DAG. *(Lead-only)* |
| `RETRY_TASK {"taskId": "..."}` | Retry a failed task. *(Lead-only)* |
| `SKIP_TASK {"taskId": "..."}` | Skip a task and unblock dependents. *(Lead-only)* |
| `ADD_TASK {"task": {...}}` | Add a new task to an existing DAG. *(Lead-only)* |
| `CANCEL_TASK {"taskId": "..."}` | Cancel a task. *(Lead-only)* |
| `RESET_DAG` | Reset the entire DAG (clear all tasks). *(Lead-only)* |
| `DECISION {"title": "...", "rationale": "..."}` | Log a decision. Users can accept/reject with a reason comment from the dashboard. |
| `QUERY_TASKS` | Query current task DAG status (alias for TASK_STATUS). |
| `CANCEL_DELEGATION {"delegationId": "...", "reason": "..."}` | Cancel an active delegation. |
| `ASSIGN_TASK {"taskId": "...", "agentId": "..."}` | Assign a ready DAG task to an agent and move it to running state. *(Lead-only)* |
| `REASSIGN_TASK {"taskId": "...", "agentId": "..."}` | Reassign a running task from one agent to another. *(Lead-only)* |
| `ADD_DEPENDENCY {"taskId": "...", "depends_on": ["dep-id"]}` | Add dependency edges to tasks in the DAG. Prevents circular dependencies. |
| `FORCE_READY {"id": "task-id"}` | Force a pending/blocked task to ready state, overriding dependency checks. *(Lead-only)* |

### Coordination (All agents)

| Command | Description |
|---------|-------------|
| `LOCK_FILE {"filePath": "...", "reason": "..."}` | Acquire a file lock. Prevents other agents from editing the same file. |
| `UNLOCK_FILE {"filePath": "..."}` | Release a file lock. |
| `COMMIT {"message": "..."}` | Scoped git commit — executes `git add` only on locked files, commits, then verifies files landed via `git diff --name-only HEAD~1`. Warns if expected files are missing. |
| `QUERY_CREW` | Get the current roster of agents with IDs, roles, models, and status. |
| `DEFER_ISSUE {"description": "...", "severity": "P2"}` | Flag a quality issue for later resolution. Tracked per-project with severity levels. |
| `QUERY_DEFERRED {"status": "open"}` | List deferred issues. Optional status filter (open/resolved/dismissed). |
| `RESOLVE_DEFERRED {"id": 42}` | Mark a deferred issue as resolved. Use `"dismiss": true` to dismiss instead. |
| `HALT_HEARTBEAT` | Pause automatic heartbeat nudges from the system. *(Lead-only)* |
| `REQUEST_LIMIT_CHANGE {"limit": 10, "reason": "..."}` | Request to increase max concurrent agents. Requires user approval. *(Lead-only)* |

### Capabilities & Timers (All agents)

| Command | Description |
|---------|-------------|
| `ACQUIRE_CAPABILITY {"capability": "code-review", "reason": "..."}` | Temporarily gain capabilities beyond the agent's role (code-review, architecture, delegation, testing, devops). |
| `RELEASE_CAPABILITY {"capability": "code-review"}` | Release a previously acquired capability. |
| `LIST_CAPABILITIES` | List currently held capabilities. |
| `SET_TIMER {"label": "name", "delay": 300, "message": "...", "repeat": false}` | Set a reminder that fires after a delay (in seconds). Optionally repeats. |
| `CANCEL_TIMER {"name": "name"}` | Cancel an active timer. |
| `LIST_TIMERS` | List all active timers. |

### UI Views

| View | Description |
|------|-------------|
| **Lead Dashboard** | Chat with the lead, decisions panel (accept/reject with reasons), team/comms/groups/DAG/tokens tabs, three-tier message hierarchy, catch-up banner |
| **Mission Control** | Single-screen project overview: health summary, agent fleet, token economics, proactive alerts, activity feed, DAG minimap, comm heatmap, performance scorecards. Drag-and-drop panel reorder. |
| **Agents** | Unified list with hierarchy, model selector, plan progress, agent controls, project grouping |
| **Tasks** | Per-project task tabs with DAG status, progress badges, project grouping, duplicate detection |
| **Timeline** | Swim-lane visualization — filter by role/comm-type/status, brush time selector, keyboard navigation (←→ pan, +/- zoom), live auto-scroll mode, idle hatch patterns, hover tooltips |
| **Group Chat** | Tabbed group chat with human participation, project-level tab grouping, real-time messaging |
| **Overview** | Progress tracking, decision timeline grouped by project, global search |
| **Settings** | Concurrency limits (1–50 agents), model defaults, theme (Light/Dark/System), custom role editor, draggable dashboard panel layout |

## Tech Stack

- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS 4, Zustand, ReactFlow, visx (timeline), Lucide
- **Backend**: Node.js, Express 5, ws (WebSocket)
- **Database**: SQLite (WAL mode, Drizzle ORM) with tuned pragmas (`busy_timeout`, `foreign_keys`, `synchronous=NORMAL`)
- **Security**: Auto-generated auth tokens, CORS lockdown, rate limiting, path traversal validation
- **Validation**: Zod schemas on all API routes
- **Agent Protocol**: ACP (Agent Communication Protocol) with streaming command detection
- **Events**: Typed event bus (TypedEmitter) with 27+ strongly-typed events
- **Testing**: Vitest with v8 coverage, Codecov integration
- **CI**: GitHub Actions on `main` and `team-work-*` branches — typecheck, unit tests, coverage upload

## Documentation

| Document | Description |
|----------|-------------|
| [REST API Reference](packages/docs/reference/api.md) | Full REST API reference for all endpoints |
| [Architecture Decisions](packages/docs/reference/architecture-decisions.md) | Key architecture decision records (ADRs) |
| [Agent Communication](packages/docs/guide/agent-communication.md) | ACP agent communication protocol details |
| [Coordination](packages/docs/guide/coordination.md) | File locking, delegation, and coordination primitives |
| [Database Schema](packages/docs/reference/database.md) | SQLite schema and Drizzle ORM setup |
| [UI Design](packages/docs/guide/ui-design.md) | Frontend component architecture and design tokens |

## Screenshots

<img width="3164" height="1598" alt="image" src="https://github.com/user-attachments/assets/bcf9bb15-be17-4f53-9347-d044dbc0871c" />

<img width="1411" height="782" alt="Image" src="https://github.com/user-attachments/assets/2d9762c1-a546-4494-8545-6fd3cc41cbc0" />

<img width="1404" height="796" alt="Image" src="https://github.com/user-attachments/assets/47b8b71b-ae85-485a-94fc-881c8d616369" />

<img width="1404" height="796" alt="Image" src="https://github.com/user-attachments/assets/9596336c-27f0-43e8-a82f-0cf20af7a149" />

<img width="1413" height="825" alt="Image" src="https://github.com/user-attachments/assets/83243b55-33fb-46f5-aa63-2f8a68b75118" />

<img width="1412" height="826" alt="Image" src="https://github.com/user-attachments/assets/14c5d4c1-b7fa-45a4-9027-393b46cc224f" />

<img width="1406" height="817" alt="Image" src="https://github.com/user-attachments/assets/0bc973a8-8338-4b52-a0b6-f9d0620e8209" />
