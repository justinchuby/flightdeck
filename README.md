# AI Crew — Multi-Agent Copilot CLI Orchestrator

> [!WARNING]
> This is purely AI generated code. Use the project with this understanding in mind.

A web UI that orchestrates multiple Copilot CLI agents with specialized roles to collaborate on software engineering tasks. A **Project Lead** agent coordinates the team, delegates work, and facilitates debate — while you stay in the loop.

## Features

- **🎯 Project Lead** — An AI coordinator that breaks down tasks, delegates to specialists, synthesizes results, and reports progress
- **👥 Specialized Roles** — Purpose-built agents with natural creative tension:
  | Role | Focus | Default Model |
  |------|-------|---------------|
  | 💻 Developer | Code + tests, full ownership | Claude Opus 4.6 |
  | 🏗️ Architect | System design, challenges problem framing | Claude Opus 4.6 |
  | 📖 Code Reviewer | Readability, maintainability, patterns | Gemini 3 Pro |
  | 🛡️ Critical Reviewer | Security, performance, edge cases | Claude Sonnet 4.6 |
  | 🎯 Product Manager | User needs, product quality, UX | GPT-5.2 Codex |
  | 📝 Technical Writer | Docs, API design review | GPT-5.2 |
  | 🎨 Designer | UI/UX, interaction design, accessibility | Claude Opus 4.6 |
  | 🔧 Generalist | Cross-disciplinary problem solving (mechanical eng, 3D, etc.) | Claude Opus 4.6 |
  | 🚀 Radical Thinker | Challenge assumptions, propose unconventional approaches | GPT-5.3 Codex |
- **🔄 Agent Reuse** — Idle agents are automatically reused instead of spawning new ones
- **💬 Inter-Agent Communication** — Agents message each other, debate approaches, and challenge ideas collaboratively
- **🧠 Model Diversity** — Each role uses a different AI model by default; the lead can override per task
- **📡 Real-Time Dashboard** — Live activity feed, agent comms panel, team status, decision log, and progress tracking
- **🙋 Human-in-the-Loop** — Send messages to the Project Lead or any agent at any time
- **📚 Skills & Learnings** — Agents record discoveries in `.github/skills/` using SKILL.md format
- **🔒 File Locking** — Coordination to prevent conflicts when multiple agents edit files
- **⏸️ Agent Controls** — Interrupt (cancel current work) and stop agents from the UI
- **📊 Progress Tracking** — Detailed progress popup with team roster, timeline, delegation details, and lead progress reports
- **🧭 Chat Navigation** — Jump between user prompts in the chat with floating nav buttons
- **📨 Agent Reports** — Incoming agent messages displayed in a dedicated section, not interleaved with lead output
- **📋 Rich Content** — Markdown tables, images, audio, and resource rendering in chat

## Getting Started

```bash
npm install
npm run dev
```

- Server: `http://localhost:3001`
- Web UI: `http://localhost:5173`

### Creating a Project

1. Open the web UI and navigate to the **Lead** tab
2. Click **Create Project**, give it a name and initial task
3. Optionally select a model and working directory for the Project Lead
4. The lead will analyze the task, assemble a team, and start delegating

### Agent Controls

All running/idle agents have two control buttons:
- **✋ Interrupt** — Sends an ACP cancel signal to abort the agent's current work immediately
- **■ Stop** — Kills the agent process entirely
- **↻ Restart** — Available for completed/failed agents

These controls appear in both the Fleet Overview and the Agent Management views.

## Architecture

```
React UI ←→ WebSocket ←→ Node.js Server ←→ ACP/PTY ←→ Copilot CLI ×N
                              │
                         AgentManager
                        ┌─────┴─────┐
                   MessageBus    ActivityLedger
                   DecisionLog   FileLockRegistry
```

### Key Components

- **AgentManager** — Spawns/reuses agents, buffers ACP text for command detection, routes messages, manages delegations
- **Agent** — Wraps a Copilot CLI process (ACP or PTY mode) with lifecycle management (creating → running → idle → completed)
- **RoleRegistry** — Defines specialist roles with system prompts, icons, colors, and default models
- **MessageBus** — Routes inter-agent messages with short ID resolution
- **ActivityLedger** — Tracks all agent actions for the real-time activity feed

### Inter-Agent Communication

Agents communicate via HTML comment commands detected in their output stream:

```
<!-- DELEGATE {"to": "developer", "task": "...", "model": "claude-opus-4.6"} -->
<!-- AGENT_MESSAGE {"to": "agent-id", "content": "..."} -->
<!-- BROADCAST {"content": "..."} -->
<!-- DECISION {"title": "...", "rationale": "...", "alternatives": [...], "impact": "..."} -->
<!-- PROGRESS {"summary": "...", "completed": [...], "in_progress": [...], "blocked": [...]} -->
<!-- QUERY_CREW -->
```

### UI Views

| View | Description |
|------|-------------|
| **Lead Dashboard** | Chat with the Project Lead, progress bar, agent reports, decisions, comms, activity feed, team status |
| **Fleet Overview** | All agents at a glance with status, tool calls, plan steps, and clickable live activity feed |
| **Agent Management** | Per-agent cards with terminal access, interrupt/stop/restart controls |
| **Task Queue** | Create, assign, and track tasks with status lifecycle |
| **Settings** | Concurrency limits, model defaults, custom roles |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents |
| `POST` | `/api/agents` | Spawn a new agent |
| `DELETE` | `/api/agents/:id` | Kill (stop) an agent |
| `POST` | `/api/agents/:id/interrupt` | Cancel agent's current work (ACP cancel) |
| `POST` | `/api/agents/:id/restart` | Restart a completed/failed agent |
| `POST` | `/api/agents/:id/input` | Send text input to an agent |
| `POST` | `/api/lead/start` | Create a new project with a Project Lead |
| `POST` | `/api/lead/:id/message` | Send a user message to a lead |
| `GET` | `/api/lead/:id/progress` | Get delegation progress stats |
| `GET` | `/api/lead/:id/decisions` | Get lead's decision log |

## Tech Stack

- **Frontend**: React, Vite, TypeScript, Tailwind CSS, Zustand, Lucide Icons
- **Backend**: Node.js, Express, ws, node-pty
- **Agent Protocol**: ACP (Agent Communication Protocol) with text buffering for streaming command detection
- **Database**: SQLite with WAL mode

## Screenshots

<img width="3164" height="1598" alt="image" src="https://github.com/user-attachments/assets/bcf9bb15-be17-4f53-9347-d044dbc0871c" />

