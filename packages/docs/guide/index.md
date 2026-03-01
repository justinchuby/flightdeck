# Introduction

AI Crew is a web-based orchestration framework that coordinates multiple [GitHub Copilot CLI](https://docs.github.com/en/copilot) agents. A **Project Lead** agent manages a team of specialists — developers, architects, reviewers, designers — that collaborate on software engineering tasks.

> [!WARNING]
> This is purely AI-generated code. Use the project with this understanding in mind.

## How It Works

1. You create a **project** with a task description
2. A **Project Lead** agent analyzes the task and assembles a team
3. The lead **delegates** subtasks to specialist agents
4. Agents work autonomously, **communicate** with each other, and report progress
5. You stay in the loop via the **real-time dashboard**

## Key Capabilities

- **12 specialist roles** with different AI models (Claude, GPT, Gemini)
- **MCP crew tools** — 42 structured tool calls for team coordination
- **Typed event bus** with 27 strongly-typed events for real-time updates
- **File locking** to prevent edit conflicts between agents
- **Task DAG** visualization of dependencies
- **Decision log** with async user confirmation
- **Context re-injection** after agent compaction events
- **Batched writes** for high-throughput activity logging

## Project Structure

```
ai-crew/
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
| Backend | Node.js, Express, ws, node-pty |
| Database | SQLite (WAL mode, Drizzle ORM) |
| Validation | Zod schemas on all API routes |
| Agent Protocol | ACP (Agent Client Protocol) + MCP (Model Context Protocol) |
| Events | TypedEmitter with 27 typed events |
