# Roles & Agents

## Built-in Roles

| Role | Icon | Focus | Default Model |
|------|------|-------|---------------|
| Project Lead | 🎯 | Coordination, delegation, synthesis | Claude Opus 4.6 |
| Developer | 💻 | Code implementation, tests | Claude Opus 4.6 |
| Architect | 🏗️ | System design, challenges problem framing | GPT-5.3 Codex |
| Code Reviewer | 📖 | Readability, maintainability, patterns | Gemini 3 Pro |
| Critical Reviewer | 🛡️ | Security, performance, edge cases | Gemini 3 Pro |
| Product Manager | 🎯 | User needs, product quality, UX | GPT-5.2 Codex |
| Technical Writer | 📝 | Documentation, API design review | GPT-5.2 |
| Designer | 🎨 | UI/UX, interaction design, accessibility | Claude Opus 4.6 |
| Generalist | 🔧 | Cross-disciplinary problem solving | Claude Opus 4.6 |
| Radical Thinker | 🚀 | Challenge assumptions, unconventional ideas | Gemini 3 Pro |
| Secretary | 📋 | Plan tracking, progress auditing | GPT-4.1 |
| QA Tester | 🧪 | Test strategy, edge cases, quality gates | Claude Sonnet 4.6 |

## Model Diversity

Roles deliberately use different AI models to bring diverse perspectives:

- **Claude** (Opus 4.6): Lead, Developer, Designer, Generalist
- **GPT** (5.3 Codex, 5.2 Codex, 5.2, 4.1): Architect, Product Manager, Technical Writer, Secretary
- **Gemini** (3 Pro): Code Reviewer, Critical Reviewer, Radical Thinker
- **Claude** (Sonnet 4.6): QA Tester

The lead can override models per agent via `CREATE_AGENT`, and users can change models at runtime from the dashboard.

## Custom Roles

Register custom roles via the Settings page or the API:

```bash
curl -X POST http://localhost:3001/api/roles \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "data-engineer",
    "name": "Data Engineer",
    "icon": "📊",
    "color": "#4CAF50",
    "systemPrompt": "You are a data engineering specialist...",
    "defaultModel": "claude-opus-4.6"
  }'
```

## Agent Lifecycle

```
creating → running → idle → completed
                 ↘         ↗
                  failed
```

- **creating**: Agent process is starting up
- **running**: Actively processing a task
- **idle**: Waiting for new work
- **completed**: Task finished successfully
- **failed**: Process exited with error (may auto-restart)

## Auto-Restart & Health

- Agents that crash are automatically restarted (configurable, up to a max restart count)
- Auto-restart verifies the parent is still alive before restarting, and wraps in error handling
- Crash counts are reset on successful agent exit
- A **heartbeat monitor** detects stalled teams and nudges the lead (DAG-aware)
- The **ContextRefresher** re-injects crew context after context window compaction
- On agent termination, orphaned children are **cascade-terminated** and delegations cleaned up

## Agent Identity

Each agent gets:
- A unique **ID** (short hash)
- A `.agent.md` file in the working directory with role instructions
- Access to the **crew manifest** (team roster, active delegations, coordination rules)

Agents reference each other by short ID in commands (e.g., `"to": "a1b2c3"`).
