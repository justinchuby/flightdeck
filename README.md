# AI Crew — Multi-Agent Copilot CLI Orchestrator

> [!WARNING]
> This is purely AI generated code. Use the project with this understanding in mind.

A web UI that orchestrates multiple Copilot CLI agents with specialized roles to collaborate on software engineering tasks. A **Project Lead** agent coordinates the team, delegates work, and facilitates debate — while you stay in the loop.

## Features

- **🎯 Project Lead** — Breaks down tasks, assembles a team, delegates work, and synthesizes results
- **👥 Specialized Roles** — 12 purpose-built agents with model diversity:
  | Role | Focus | Default Model |
  |------|-------|---------------|
  | 💻 Developer | Code + tests | Claude Opus 4.6 |
  | 🏗️ Architect | System design | GPT-5.3 Codex |
  | 📖 Code Reviewer | Readability, patterns | Gemini 3 Pro |
  | 🛡️ Critical Reviewer | Security, performance | Gemini 3 Pro |
  | 🎯 Product Manager | User needs, UX | GPT-5.2 Codex |
  | 📝 Technical Writer | Docs, API design | GPT-5.2 |
  | 🎨 Designer | UI/UX, accessibility | Claude Opus 4.6 |
  | 🔧 Generalist | Cross-disciplinary | Claude Opus 4.6 |
  | 🚀 Radical Thinker | Challenge assumptions | Gemini 3 Pro |
  | 📋 Secretary | Plan tracking | GPT-4.1 |
  | 🧪 QA Tester | Test strategy, quality | Claude Sonnet 4.6 |
- **💬 Inter-Agent Communication** — Direct messages, @mentions, broadcasts, and group chats between agents
- **📊 Task DAG** — Declarative task scheduling with dependencies; PROGRESS auto-reads DAG state
- **✅ Decision Log** — Track architectural decisions with accept/reject and reason comments
- **🔒 File Locking & COMMIT** — Prevents conflicts when multiple agents edit files; scoped COMMIT stages only locked files
- **📡 Real-Time Dashboard** — Live activity feed, team status, user-message highlighting via WebSocket
- **🙋 Human-in-the-Loop** — Message any agent or the lead; queue or interrupt with dedicated buttons
- **⏸️ Agent Controls** — Interrupt, stop, restart agents; change models on the fly
- **🔄 Session Resume** — Resume from a previous Copilot session ID
- **💾 Persistent Projects** — Projects survive lead sessions; resume with full context briefing
- **🔐 Security** — Auto-generated auth tokens, CORS lockdown, rate limiting, path validation
- **🔍 Global Search** — Search across messages, tasks, decisions, and activity
- **💬 Group Chat** — QUERY_GROUPS, role-based CREATE_GROUP, auto-creation for parallel work, auto-archive, unread badges
- **📡 Context Re-injection** — Automatic crew context recovery after context window compaction
- **📈 Timeline Visualization** — Swim-lane timeline with filtering, brush time selector, keyboard navigation, and live mode
- **📦 Project Grouping** — Group and filter projects in the Tasks view

## Getting Started

```bash
npm install
npx ai-crew
```

This builds the project, starts the server, and opens the web UI. Options: `--port=4000`, `--no-browser`.

For development with hot reload:

```bash
npm run dev
```

- **Server**: http://localhost:3001
- **Web UI**: http://localhost:5173 (dev) or http://localhost:3001 (production)

### Creating a Project

1. Open the web UI — the **Lead** page is the default view
2. Click **Create Project**, provide a name, task, and optionally a working directory
3. The lead analyzes the task, creates agents, and starts delegating

## Architecture

```
React UI ←→ WebSocket ←→ Node.js Server ←→ ACP ←→ Copilot CLI ×N
                              │
                         AgentManager (TypedEmitter)
                        ┌─────┴──────┐
                   MessageBus    ActivityLedger (batched writes)
                   DecisionLog   FileLockRegistry
                   Scheduler     ContextRefresher
                   ProjectRegistry  ChatGroupRegistry
```

### Key Components

| Component | Responsibility |
|-----------|---------------|
| **AgentManager** | Spawns agents, detects commands in output stream, routes messages, manages delegations. Cascade termination with visited-set guard. |
| **Agent** | Wraps a Copilot CLI process (ACP) with lifecycle management, message buffering, and memory bounds |
| **CommandDispatcher** | Parses triple-bracket commands from agent output, enforces ownership rules |
| **RoleRegistry** | Role definitions with system prompts, icons, colors, default models |
| **MessageBus** | Routes inter-agent messages and group chats |
| **ActivityLedger** | Batched activity logging (flushes every 250ms or 64 entries) |
| **ContextRefresher** | Re-injects crew context after agent compaction events |
| **Scheduler** | Background tasks: expired lock cleanup, activity pruning, delegation cleanup |
| **ChatGroupRegistry** | Group lifecycle — create, archive, role-based membership, auto-creation for parallel work |
| **ProjectRegistry** | Persistent project management — CRUD, session tracking, briefing generation |
| **HeartbeatMonitor** | DAG-aware stall detection — nudges idle leads with remaining work |

### Agent Commands

Agents communicate via structured commands detected in their output:

```
[[[ CREATE_AGENT {"role": "developer", "model": "...", "task": "..."} ]]]
[[[ DELEGATE {"to": "agent-id", "task": "...", "context": "..."} ]]]
[[[ TERMINATE_AGENT {"id": "agent-id", "reason": "..."} ]]]
[[[ AGENT_MESSAGE {"to": "agent-id", "content": "..."} ]]]
[[[ CREATE_GROUP {"name": "...", "members": ["id1"], "roles": ["developer"]} ]]]
[[[ GROUP_MESSAGE {"group": "...", "content": "..."} ]]]
[[[ QUERY_GROUPS ]]]
[[[ BROADCAST {"content": "..."} ]]]
[[[ DECISION {"title": "...", "rationale": "...", "alternatives": [...]} ]]]
[[[ DECLARE_TASKS {"tasks": [{"id": "...", "title": "...", "depends_on": [...]}]} ]]]
[[[ PROGRESS {"summary": "..."} ]]]
[[[ COMPLETE_TASK {"summary": "..."} ]]]
[[[ QUERY_TASKS ]]]
[[[ CANCEL_DELEGATION {"delegationId": "...", "reason": "..."} ]]]
[[[ LOCK_FILE {"filePath": "...", "reason": "..."} ]]]
[[[ COMMIT {"message": "..."} ]]]
[[[ QUERY_CREW ]]]
```

### UI Views

| View | Description |
|------|-------------|
| **Lead Dashboard** | Chat with the lead, decisions panel with accept/reject + reasons, team/comms/groups/DAG/activity tabs, user-message highlighting |
| **Agents** | Unified list with hierarchy, model selector, plan progress, agent controls |
| **Tasks** | Per-project task tabs with DAG status, progress badges, project grouping, and persistent archive |
| **Timeline** | Swim-lane visualization of agent activity — filtering by role/comm-type/status, brush time selector, keyboard navigation, live auto-scroll mode |
| **Group Chat** | Tabbed group chat interface with human participation, unread badges, and real-time messaging |
| **Overview** | Progress tracking, decision management, and global search |
| **Settings** | Concurrency limits, model defaults, custom roles |

## Tech Stack

- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS 4, Zustand, ReactFlow, Lucide
- **Backend**: Node.js, Express 5, ws
- **Database**: SQLite (WAL mode, Drizzle ORM) with optimized pragmas (`busy_timeout`, `foreign_keys`, `synchronous=NORMAL`)
- **Security**: Auto-generated auth tokens, CORS lockdown, rate limiting, path traversal validation
- **Validation**: Zod schemas on all API routes
- **Agent Protocol**: ACP (Agent Communication Protocol) with streaming command detection
- **Events**: Typed event bus (TypedEmitter) with 27+ strongly-typed events
- **Testing**: Vitest with v8 coverage, Codecov integration (1000+ tests)

## Screenshots

<img width="3164" height="1598" alt="image" src="https://github.com/user-attachments/assets/bcf9bb15-be17-4f53-9347-d044dbc0871c" />

<img width="1411" height="782" alt="Image" src="https://github.com/user-attachments/assets/2d9762c1-a546-4494-8545-6fd3cc41cbc0" />

<img width="1404" height="796" alt="Image" src="https://github.com/user-attachments/assets/47b8b71b-ae85-485a-94fc-881c8d616369" />

<img width="1404" height="796" alt="Image" src="https://github.com/user-attachments/assets/9596336c-27f0-43e8-a82f-0cf20af7a149" />

<img width="1413" height="825" alt="Image" src="https://github.com/user-attachments/assets/83243b55-33fb-46f5-aa63-2f8a68b75118" />

<img width="1412" height="826" alt="Image" src="https://github.com/user-attachments/assets/14c5d4c1-b7fa-45a4-9027-393b46cc224f" />

<img width="1406" height="817" alt="Image" src="https://github.com/user-attachments/assets/0bc973a8-8338-4b52-a0b6-f9d0620e8209" />
