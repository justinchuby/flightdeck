# Architecture & Design Decisions

This directory contains design documentation for AI Crew. These docs are the source of truth for architectural decisions and are updated as the system evolves.

| Document | Description |
|----------|-------------|
| [agent-communication.md](./agent-communication.md) | How agents communicate — ACP protocol, structured commands, content types, WebSocket events |
| [coordination.md](./coordination.md) | How agents avoid conflicts — file locking, activity ledger, context refresh |
| [design-decisions.md](./design-decisions.md) | Key architectural choices and their rationale |

## Quick Reference

### Agent Roles (10 built-in + custom)

| Icon | Role | Default Model |
|------|------|---------------|
| 💻 | Developer | Claude Opus 4.6 |
| 🏗️ | Architect | Claude Opus 4.6 |
| 📖 | Code Reviewer | Gemini 3 Pro |
| 🛡️ | Critical Reviewer | Claude Sonnet 4.6 |
| 🎯 | Product Manager | GPT-5.2 Codex |
| 📝 | Technical Writer | GPT-5.2 |
| 🎨 | Designer | Claude Opus 4.6 |
| 🔧 | Generalist | Claude Opus 4.6 |
| 🚀 | Radical Thinker | GPT-5.3 Codex |
| 👑 | Project Lead | Claude Opus 4.6 |

### Agent Commands (HTML Comments)

```
<!-- CREATE_AGENT {"role": "developer", "model": "claude-opus-4.6", "task": "...", "context": "..."} -->
<!-- DELEGATE {"to": "agent-id", "task": "...", "context": "..."} -->
<!-- AGENT_MESSAGE {"to": "agent-id", "content": "..."} -->
<!-- BROADCAST {"content": "..."} -->
<!-- DECISION {"title": "...", "rationale": "...", "alternatives": [...]} -->
<!-- PROGRESS {"summary": "...", "completed": [...], "in_progress": [...], "blocked": [...]} -->
<!-- QUERY_CREW -->
```

- **CREATE_AGENT** (lead-only) — Spawns a new agent with a specific role and model. Optionally assigns a task immediately.
- **DELEGATE** (lead-only) — Assigns a task to an existing agent by ID. Use `QUERY_CREW` or creation ACK to find agent IDs.
- **AGENT_MESSAGE** — Send a direct message to another agent by ID.
- **BROADCAST** — Send a message to all active agents.
- **DECISION** — Log an architectural or design decision.
- **PROGRESS** — Report progress to the user.
- **QUERY_CREW** — Get the current roster of agents with IDs, roles, models, and status.
