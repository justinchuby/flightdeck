# AI Crew — Multi-Agent Copilot CLI Orchestrator

A web UI that orchestrates multiple Copilot CLI agents with specialized roles to collaborate on software engineering tasks. A **Project Lead** agent coordinates the team, delegates work, and facilitates debate — while you stay in the loop.

## Features

- **🎯 Project Lead** — An AI coordinator that breaks down tasks, delegates to specialists, and synthesizes results
- **👥 Specialized Roles** — Purpose-built agents with natural creative tension:
  | Role | Focus | Default Model |
  |------|-------|---------------|
  | 💻 Developer | Code + tests, full ownership | Claude Opus 4.6 |
  | 🏗️ Architect | System design, challenges problem framing | Claude Opus 4.6 |
  | 📖 Code Reviewer | Readability, maintainability, patterns | Gemini 3 Pro |
  | 🛡️ Critical Reviewer | Security, performance, edge cases | Claude Sonnet 4.6 |
  | 🎯 Product Manager | User needs, product quality, UX | GPT-5.2 Codex |
  | 📝 Technical Writer | Docs, API design review | GPT-5.1 Codex |
- **🔄 Agent Reuse** — Idle agents are automatically reused instead of spawning new ones
- **💬 Inter-Agent Communication** — Agents message each other, debate approaches, and challenge ideas collaboratively
- **🧠 Model Diversity** — Each role uses a different AI model by default; the lead can override per task
- **📡 Real-Time Dashboard** — Live activity feed, agent comms panel, team status, and decision log
- **🙋 Human-in-the-Loop** — Send messages to the Project Lead or any agent at any time
- **📚 Skills & Learnings** — Agents record discoveries in `.github/skills/` for institutional knowledge
- **🔒 File Locking** — Coordination to prevent conflicts when multiple agents edit files

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
3. Optionally select a model for the Project Lead
4. The lead will analyze the task, assemble a team, and start delegating

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
<!-- DECISION {"title": "...", "rationale": "..."} -->
<!-- PROGRESS {"summary": "...", "completed": [...], "in_progress": [...]} -->
<!-- QUERY_CREW -->
```

## Tech Stack

- **Frontend**: React, Vite, TypeScript, Tailwind CSS, Zustand
- **Backend**: Node.js, Express, ws, node-pty
- **Agent Protocol**: ACP (Agent Communication Protocol) with text buffering for streaming command detection
