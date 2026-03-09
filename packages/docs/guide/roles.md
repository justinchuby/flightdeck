# Roles & Agents

## Built-in Roles

Flightdeck ships with 13 specialist roles. The Project Lead automatically selects roles based on the task — you don't need to configure them.

| Role | Icon | Focus | Default Model |
|------|------|-------|---------------|
| Project Lead | 🎯 | Coordination, delegation, synthesis | Claude Opus 4.6 |
| Developer | 💻 | Code implementation, tests | Claude Opus 4.6 |
| Architect | 🏗️ | System design, challenges problem framing | Claude Opus 4.6 |
| Code Reviewer | 📖 | Readability, maintainability, patterns | Gemini 3 Pro |
| Critical Reviewer | 🛡️ | Secure-by-design review, performance, edge cases | Gemini 3 Pro |
| Product Manager | 🎯 | User needs, product quality, UX | GPT-5.3 Codex |
| Technical Writer | 📝 | Documentation, API design review | GPT-5.2 |
| Designer | 🎨 | UI/UX, interaction design, accessibility | Claude Opus 4.6 |
| Generalist | 🔧 | Cross-disciplinary problem solving | Claude Opus 4.6 |
| Radical Thinker | 🚀 | Challenge assumptions, unconventional ideas | Gemini 3 Pro |
| Secretary | 📋 | Plan tracking, progress auditing | GPT-4.1 |
| QA Tester | 🧪 | Test strategy, edge cases, quality gates | Claude Sonnet 4.6 |
| Agent | ⚙️ | Neutral general-purpose agent, no role-specific instructions | CLI default |

### When to use each role

- **Developer** — The workhorse. Use for any coding task: implementing features, writing tests, fixing bugs, refactoring.
- **Architect** — Use early in a project for system design, or when a Developer is stuck on a structural decision. Architects challenge problem framing and propose alternatives.
- **Code Reviewer** — Automatically assigned after code changes. Focuses on readability and patterns — catches the "this works but is hard to maintain" issues.
- **Critical Reviewer** — The skeptic. Operates with a **secure-by-design** principle: security is a structural requirement, not an afterthought. Use for security-sensitive code, performance-critical paths, or when you need someone to find edge cases others missed.
- **Product Manager** — Use when the team needs to prioritize features or think about user experience. Good for reviewing API designs from a consumer's perspective.
- **Technical Writer** — Ensures documentation stays accurate. Also reviews API design — if something is hard to document, it's probably too complex.
- **Designer** — Use for UI/UX work, accessibility reviews, or interaction design. Thinks about the human experience.
- **QA Tester** — Runs code end-to-end, verifies behavior, catches runtime failures that code review cannot detect.
- **Generalist** — The Swiss army knife. Use for cross-cutting tasks that don't fit a single specialty: research, build systems, DevOps.
- **Radical Thinker** — Deliberately challenges conventional approaches. Useful when the team is stuck or when you want fresh perspectives.
- **Secretary** — Tracks progress, maintains checklists, provides status reports. Created automatically for projects using the task DAG.
- **Agent** — A blank-slate role with no specialized instructions. Use when you want an agent that just follows the system prompt you provide.

> **AI-Aware Estimation:** A crew of AI agents compresses timelines dramatically — weeks of work become hours. Plan in sessions (30 min – 2 hours), not sprints. A 10-agent session resolved 8 sub-issues across 6 GitHub issues in ~15 minutes. The bottleneck is coordination (lock contention, review cycles), not implementation speed.

## Model Diversity

Roles deliberately use different AI models to bring diverse perspectives:

- **Claude** (Opus 4.6): Lead, Developer, Architect, Designer, Generalist
- **GPT** (5.3 Codex, 5.2, 4.1): Product Manager, Technical Writer, Secretary
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
