# Architecture & Design Decisions

This directory contains design documentation for AI Crew. These docs are the source of truth for architectural decisions and are updated as the system evolves.

| Document | Description |
|----------|-------------|
| [agent-communication.md](./agent-communication.md) | How agents communicate — ACP protocol, structured commands, @mentions, content types, WebSocket events |
| [chat-groups-design.md](./chat-groups-design.md) | Agent chat groups — QUERY_GROUPS, role-based membership, auto-creation, auto-archive lifecycle |
| [coordination.md](./coordination.md) | How agents avoid conflicts — file locking, scoped COMMIT, activity ledger, context refresh, scheduler |
| [database-design.md](./database-design.md) | Drizzle ORM setup, SQLite pragmas, table reference, migration strategy |
| [design-decisions.md](./design-decisions.md) | Key architectural choices and their rationale |
| [ui-design.md](./ui-design.md) | UI layout — lead dashboard, timeline visualization, decision comments, agent controls |

## Quick Reference

### Agent Roles (12 built-in + custom)

| Icon | Role | Default Model |
|------|------|---------------|
| 👑 | Project Lead | Claude Opus 4.6 |
| 💻 | Developer | Claude Opus 4.6 |
| 🏗️ | Architect | GPT-5.3 Codex |
| 📖 | Code Reviewer | Gemini 3 Pro |
| 🛡️ | Critical Reviewer | Gemini 3 Pro |
| 🎯 | Product Manager | GPT-5.2 Codex |
| 📝 | Technical Writer | GPT-5.2 |
| 🎨 | Designer | Claude Opus 4.6 |
| 🔧 | Generalist | Claude Opus 4.6 |
| 🚀 | Radical Thinker | Gemini 3 Pro |
| 📋 | Secretary | GPT-4.1 |
| 🧪 | QA Tester | Claude Sonnet 4.6 |

### Agent Commands (Triple-Bracket Format)

```
[[[ CREATE_AGENT {"role": "developer", "model": "claude-opus-4.6", "task": "..."} ]]]
[[[ DELEGATE {"to": "agent-id", "task": "...", "context": "..."} ]]]
[[[ TERMINATE_AGENT {"id": "agent-id", "reason": "..."} ]]]
[[[ AGENT_MESSAGE {"to": "agent-id", "content": "..."} ]]]
[[[ BROADCAST {"content": "..."} ]]]
[[[ DECISION {"title": "...", "rationale": "...", "alternatives": [...]} ]]]
[[[ PROGRESS {"summary": "...", "completed": [...], "in_progress": [...], "blocked": [...]} ]]]
[[[ QUERY_CREW ]]]
[[[ CREATE_GROUP {"name": "team-name", "members": ["id1"], "roles": ["developer"]} ]]]
[[[ GROUP_MESSAGE {"group": "team-name", "content": "..."} ]]]
[[[ ADD_TO_GROUP {"group": "team-name", "members": ["agent-id"]} ]]]
[[[ REMOVE_FROM_GROUP {"group": "team-name", "members": ["agent-id"]} ]]]
[[[ QUERY_GROUPS ]]]
[[[ COMMIT {"message": "..."} ]]]
[[[ COMPLETE_TASK {"status": "done", "summary": "..."} ]]]
[[[ LOCK_FILE {"filePath": "...", "reason": "..."} ]]]
[[[ UNLOCK_FILE {"filePath": "..."} ]]]
```

- **CREATE_AGENT** (lead-only) — Spawns a new agent with a specific role and model. Optionally assigns a task immediately.
- **DELEGATE** (lead-only) — Assigns a task to an existing agent by ID. Use `QUERY_CREW` or creation ACK to find agent IDs.
- **TERMINATE_AGENT** (lead-only) — Terminates an agent and frees its slot. Validates agent ancestry. Logs session ID for resume.
- **AGENT_MESSAGE** — Send a direct message to another agent by ID.
- **BROADCAST** — Send a message to all active agents.
- **DECISION** — Log an architectural or design decision. Users can accept or reject with a reason comment.
- **PROGRESS** — Report progress to the user. Auto-reads DAG state when a task DAG exists.
- **QUERY_CREW** — Get the current roster of agents with IDs, roles, models, and status.
- **CREATE_GROUP** (lead-only) — Create a named chat group. Specify members by ID, by role (auto-adds matching agents), or both. Lead is auto-included. See [chat-groups-design.md](./chat-groups-design.md).
- **GROUP_MESSAGE** — Send a message to all members of a chat group. Sender must be a member.
- **ADD_TO_GROUP** (lead-only) — Add agents to an existing group. New members receive recent history.
- **REMOVE_FROM_GROUP** (lead-only) — Remove agents from a group. The lead cannot be removed.
- **QUERY_GROUPS** — List all groups the agent belongs to, with member counts and last message preview.
- **COMMIT** — Scoped git commit. Stages only files the agent has locked, preventing `git add -A` from leaking other agents' work.
- **COMPLETE_TASK** — Signal that the agent has finished its assigned task, with a status and summary.
- **LOCK_FILE** / **UNLOCK_FILE** — Acquire or release a file lock to prevent concurrent edits.
