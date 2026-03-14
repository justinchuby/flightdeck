# Introduction

Flightdeck is a web-based orchestration framework that coordinates multiple AI coding agents across providers — GitHub Copilot, Claude Code, Gemini CLI, Codex, Cursor, and OpenCode. Give it a task, and it assembles a team of specialists — developers, architects, reviewers, and more — that collaborate like a real engineering team, working in parallel and checking each other's work.

> [!WARNING]
> This is AI-generated code. Use the project with this understanding in mind.

## How It Works

1. You describe a **goal** in plain language — that's your only job
2. A **Project Lead** agent analyzes the task and assembles a team
3. The lead **delegates** subtasks to specialist agents
4. Agents work in parallel, **communicate** with each other, and report progress
5. You watch it all happen via the **real-time dashboard** — and can jump in at any time

## Key Capabilities

- **13 specialist roles** — developers, architects, reviewers, designers, and more — each with a different AI model for diverse perspectives
- **Parallel execution** — multiple agents coding, reviewing, and testing simultaneously
- **File locking** — agents claim files before editing, so no one overwrites anyone else
- **Task DAG** — a dependency graph that tracks what's done, what's next, and what's blocked
- **Built-in code review** — every change is automatically reviewed before it ships
- **Real-time dashboard** — see who's doing what, message any agent, or pause everything

## Project Structure

```
flightdeck/
├── packages/
│   ├── server/      # Node.js backend (Express, WebSocket, ACP)
│   ├── web/         # React frontend (Vite, Tailwind, Zustand)
│   └── docs/        # This documentation site (VitePress)
├── package.json     # Monorepo root (npm workspaces)
└── tsconfig.base.json
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, Zustand, ReactFlow |
| Backend | Node.js, Express, ws |
| Database | SQLite (WAL mode, Drizzle ORM) |
| Validation | Zod schemas on all API routes |
| Agent Protocol | ACP (Agent Communication Protocol) |
| Events | TypedEmitter with 27 typed events |
