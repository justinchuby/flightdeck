# Introduction

Flightdeck is a web-based orchestration framework that coordinates multiple AI coding agents across providers — GitHub Copilot, Claude Code, Gemini CLI, Codex, Cursor, and OpenCode. Give it a task, and it assembles a team of specialists — developers, architects, reviewers, and more — that collaborate like a real engineering team, working in parallel and checking each other's work.

> [!WARNING]
> This is AI-generated code. Use the project with this understanding in mind.

## How It Works

1. You describe a **goal** in plain language — that's your only job
2. A **Project Lead** agent analyzes the task and assembles a team
3. The lead **delegates** subtasks to specialist agents using an auto-generated task DAG
4. Agents work in parallel, **communicate** with each other, and report progress
5. You watch it all happen via the **real-time dashboard** — and can intervene at any time

## Key Capabilities

- **14 specialist roles** — developers, architects, code reviewers, designers, QA testers, product managers, and more — each configurable with different AI models for diverse perspectives
- **6 provider backends** — GitHub Copilot, Claude Code, Gemini CLI, Codex, Cursor, and OpenCode — switchable per project or per role
- **Parallel execution** — multiple agents coding, reviewing, and testing simultaneously with up to 50 concurrent agents
- **File locking** — agents claim files before editing, preventing overwrites and merge conflicts
- **Auto-DAG** — automatic dependency graph generation that tracks what's done, what's next, and what's blocked
- **Trust Dial** — three-level oversight system (autonomous, supervised, strict) that controls how much autonomy agents have
- **Built-in code review** — every change can be automatically reviewed before it ships
- **Real-time dashboard** — see who's doing what, message any agent, interrupt work, or pause everything
- **Session replay** — scrub through past sessions like a video timeline
- **Persistent projects** — projects survive across sessions with full context restoration

## Project Structure

```
flightdeck/
├── packages/
│   ├── server/      # Node.js backend (Express, WebSocket, ACP)
│   ├── web/         # React frontend (Vite, Tailwind, Zustand)
│   ├── shared/      # Shared types, Zod schemas, constants
│   └── docs/        # This documentation site (VitePress)
├── bin/             # CLI entry point (flightdeck command)
├── flightdeck.config.example.yaml  # Reference configuration
├── package.json     # Monorepo root (npm workspaces)
└── tsconfig.base.json
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, TypeScript 5.9, Tailwind CSS 4, Zustand 5, ReactFlow, visx |
| Backend | Node.js, Express 5, ws (WebSocket) |
| Database | SQLite (WAL mode, Drizzle ORM, better-sqlite3) |
| Validation | Zod 4 schemas on all API routes |
| Agent Protocol | ACP (Agent Communication Protocol) via `@agentclientprotocol/sdk` |
| Shared | `@flightdeck/shared` workspace package for types and schemas |
| Testing | Vitest 4, @testing-library/react, Playwright (E2E) |
