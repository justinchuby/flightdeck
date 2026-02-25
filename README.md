# AI Crew — Multi-Agent Copilot CLI Orchestrator

A web UI that orchestrates multiple Copilot CLI agents with specialized roles (architect, code reviewer, PM, etc.) to collaborate on software engineering tasks.

## Features

- **Agent Dashboard** — Monitor live agents with real terminal output
- **Task Queue** — Assign and prioritize tasks across agents
- **Role System** — Pre-defined and custom roles with system prompts
- **Sub-Agent Spawning** — Agents autonomously create sub-agents
- **Human-in-the-Loop** — Inject input into any running agent conversation
- **Inter-Agent Communication** — Agents can @mention and collaborate

## Getting Started

```bash
npm install
npm run dev
```

- Server runs on `http://localhost:3001`
- Web UI runs on `http://localhost:5173`

## Architecture

```
React UI ←→ WebSocket ←→ Node.js Server ←→ PTY ←→ Copilot CLI ×N
```

## Tech Stack

- **Frontend**: React, Vite, TypeScript, Tailwind CSS, xterm.js
- **Backend**: Node.js, Express, ws, node-pty, better-sqlite3
- **Database**: SQLite
