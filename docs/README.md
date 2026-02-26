# Architecture & Design Decisions

This directory contains design documentation for AI Crew. These docs are the source of truth for architectural decisions and are updated as the system evolves.

| Document | Description |
|----------|-------------|
| [agent-communication.md](./agent-communication.md) | How agents communicate — ACP protocol, structured commands, content types, WebSocket events |
| [coordination.md](./coordination.md) | How agents avoid conflicts — file locking, activity ledger, context refresh |
| [design-decisions.md](./design-decisions.md) | Key architectural choices and their rationale |

## Quick Reference

### Agent Roles (9 built-in + custom)

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
<!-- DELEGATE {"to": "role", "task": "...", "model": "..."} -->
<!-- AGENT_MESSAGE {"to": "agent-id", "content": "..."} -->
<!-- BROADCAST {"content": "..."} -->
<!-- DECISION {"title": "...", "rationale": "...", "alternatives": [...]} -->
<!-- PROGRESS {"summary": "...", "completed": [...], "in_progress": [...], "blocked": [...]} -->
<!-- QUERY_CREW -->
```
