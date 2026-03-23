# Features Overview

Flightdeck is a multi-agent orchestration platform. This page covers everything it can do, organized by what matters to you as a user.

## Crew Orchestration

At its core, Flightdeck turns a single task into a coordinated team effort.

### Project Lead

Every session starts with a **Project Lead** agent. You describe what you want built, and the lead:
- Analyzes your task and breaks it into subtasks
- Creates a **task DAG** (directed acyclic graph) with dependencies
- Assembles a crew of specialist agents
- Delegates work, coordinates progress, and synthesizes results

### 14 Specialized Roles

Each agent has a role with a purpose-built system prompt and recommended model:

| Role | Focus |
|------|-------|
| **Project Lead** 👑 | Orchestration, delegation, crew coordination |
| **Developer** 💻 | Code implementation, tests, bug fixes |
| **Architect** 🏗️ | System design, architecture decisions. Can also delegate. |
| **Code Reviewer** 📖 | Readability, maintainability, code patterns |
| **Critical Reviewer** 🛡️ | Security, performance, edge cases |
| **Readability Reviewer** 📐 | Naming, organization, documentation quality |
| **Product Manager** 🎯 | User needs, product quality, UX review |
| **Technical Writer** 📝 | Documentation, API design, developer experience |
| **Designer** 🎨 | UI/UX, interaction design, accessibility |
| **QA Tester** 🧪 | Test strategy, quality assurance, coverage |
| **Generalist** 🔧 | Cross-disciplinary problem solving |
| **Radical Thinker** 🚀 | Challenge assumptions, propose bold alternatives |
| **Secretary** 📋 | Plan tracking, status reports, session summaries |
| **Agent** ⚙️ | Neutral general-purpose agent |

Custom roles can be created via **Settings → Roles** with your own system prompts, colors, and icons.

### Task DAG

The lead creates a dependency graph that controls execution order. Tasks flow through states: `pending` → `ready` → `running` → `done` (or `failed`, `paused`, `skipped`). The **EagerScheduler** automatically assigns ready tasks to idle agents as soon as dependencies resolve.

Three views in the dashboard:
- **Graph view** — Interactive dependency graph (ReactFlow) with status colors and critical path highlighting
- **Kanban board** — Drag-and-drop columns by status with context menus
- **Gantt chart** — Timeline view with dependencies

→ [Auto-DAG Guide](/guide/auto-dag)

### Parallel Execution

Multiple agents work simultaneously — a developer writes code while a reviewer checks it, an architect designs the system, and a secretary tracks progress. Up to 50 concurrent agents (configurable).

## Multi-Provider Support

Flightdeck is provider-agnostic. All agents communicate through the **Agent Client Protocol (ACP)**, so you can mix and match providers in the same crew.

### Supported Providers

| Provider | Binary | Auth |
|----------|--------|------|
| **GitHub Copilot** 🐙 | `copilot` | GitHub CLI (`gh auth login`) |
| **Claude Code** 🟠 | `claude-agent-acp` | `ANTHROPIC_API_KEY` |
| **Google Gemini CLI** 💎 | `gemini` | `GEMINI_API_KEY` |
| **Codex** 🤖 | `codex-acp` | `OPENAI_API_KEY` |
| **Cursor** ↗️ | `agent` | `CURSOR_API_KEY` |
| **OpenCode** 🔓 | `opencode` | (manages own keys) |
| **Kimi CLI** 🌙 | `kimi` | Kimi auth |
| **Qwen Code** 🔮 | `qwen` | Qwen auth |

### Model Resolution

Each role has a default model, but you can override per-role or per-agent. The **ModelResolver** handles cross-provider translation — request `claude-opus-4.6` from a Gemini agent and it maps to the closest equivalent. Standard/fast/premium tier aliases work across all providers.

### Provider Ranking

Set a preference order for providers. If the default is unavailable, Flightdeck falls through to the next in the ranking. Configure via `flightdeck.config.yaml` or **Settings → Providers** in the dashboard.

→ [Provider Guide](/guide/providers)

## Real-Time Dashboard

The web dashboard is your control center, updating in real-time over WebSocket.

### Home Dashboard

At-a-glance view across all projects:
- **Action Required** — Pending decisions and permission requests
- **Active Work** — What agents are doing right now, grouped by project
- **Decisions Made** — Recent decisions for awareness
- **Recent Activity** — Latest events across all projects
- **Progress** — Per-project DAG summaries

### Lead Dashboard

The main working interface for an active session:
- **Chat panel** — Send messages to the Project Lead (queue or interrupt mode)
- **Decision panel** — Approve, reject, or dismiss pending decisions with optional comments
- **Sidebar tabs** — Seven tabs (reorderable): Crew, Comms, Groups, DAG, Models, Costs, Timers
- **Catch-up banner** — "While you were away" summary of what happened

### Timeline

Swim-lane Gantt chart showing agent activity over time:
- One lane per agent with color-coded events
- Communication links between agents
- Zoom, pan, and keyboard navigation (←→ pan, +/- zoom)
- Session replay scrubber for reviewing past sessions
- Live auto-scroll mode during active sessions

→ [Timeline Guide](/guide/timeline)

### Analytics

Session-level analytics and cost tracking:
- **Token usage trends** — Input/output tokens over time
- **Cost breakdowns** — Per-agent and per-task token attribution from provider data
- **Session comparison** — Side-by-side comparison of two sessions
- **Auto-generated insights** — Efficiency observations

### Overview Dashboard

Per-project overview with:
- Quick status bar (running/stopped, agent count, task progress, duration)
- Attention items (failed agents, blocked tasks, pending decisions)
- Decision feed and activity feed
- Session history

## Communication

Agents communicate through structured messaging channels.

### Direct Messaging

Agents message each other by ID. Messages can be:
- **Queued** — Delivered when the recipient is ready (non-blocking)
- **Interrupt** — Breaks into the agent's current work immediately (priority)

### Group Chat

Create groups by member ID or role. Groups are auto-created when 3+ agents work on the same feature and auto-archived when all members finish. The dashboard shows a dedicated **Groups** tab for following multi-agent conversations.

### Broadcasts

Send a message to every active agent at once — useful for announcing decisions or sharing context that affects the whole crew.

### @Mentions

Type `@` in the chat to autocomplete agent names. Mentioned agents receive the message.

→ [Agent Communication](/guide/agent-communication) · [Chat Groups](/guide/chat-groups)

## Coordination & Safety

These features prevent agents from stepping on each other and keep you in control.

### File Locking

Before editing a file, an agent must acquire a lock. Locks have:
- **TTL** — Expired locks are automatically cleaned up (no deadlocks from crashed agents)
- **Glob support** — Lock `src/auth/*` to claim an entire directory
- **Conflict detection** — Overlapping lock requests are rejected with clear error messages

### Scoped Commits

When an agent commits, `git add` only stages files the agent has locked. Post-commit verification confirms the right files landed. This prevents `git add -A` from leaking other agents' uncommitted work.

### Trust Dial (Oversight System)

Three levels of human oversight:

| Level | Behavior |
|-------|----------|
| **Supervised** | Agents explain reasoning before acting. Significant actions require approval. |
| **Balanced** | Key decisions need approval; routine work proceeds automatically. |
| **Autonomous** | Agents work independently. Only critical failures require intervention. |

Set globally or per-project. The **AttentionBar** at the top of the dashboard shows the current level with an escalation indicator (green/yellow/red).

→ [Oversight Guide](/guide/oversight)

### Governance Pipeline

Every agent command flows through ordered hooks before execution:

1. **Security** — Blocked patterns, path traversal checks
2. **Permission** — Role-based access control
3. **Validation** — Payload schema validation
4. **Rate Limiting** — Per-command throttling
5. **Policy** — Custom policy rules
6. **Approval** — Human approval gates (when configured)

Post-hooks handle audit logging and metrics collection.

### Decision Queue

When agents face architectural choices or need permission, they surface decisions to you:
- Review decisions in the **Approval Queue** (Shift+A shortcut)
- **Approve** with optional comment, **reject** with reason, or **dismiss**
- Auto-deny timer pauses while you're reviewing (no missed decisions)
- Decisions are categorized automatically (architecture, style, testing, etc.)

### Security

- **Prompt injection sanitization** — 4-layer defense at write boundary
- **Secret redaction** — 12 regex pattern categories (AWS, GitHub, API keys, etc.) redacted from WS broadcasts, DB writes, logs
- **CORS lockdown** and rate limiting
- **Path traversal validation** for CWD and file operations
- **Challenge-response auth** for integrations

→ [Coordination Guide](/guide/coordination)

## Knowledge & Persistence

What agents learn carries across sessions.

### Knowledge Base

Four-category knowledge system:

| Category | Purpose | Example |
|----------|---------|---------|
| **Core** 🛡️ | Project rules, identity | "Use factory pattern for services" |
| **Procedural** 🔧 | Patterns, corrections, how-to | "Always run lint before commit" |
| **Semantic** 🗄️ | Architecture, facts, relationships | "Auth module uses JWT with bcrypt" |
| **Episodic** 📜 | Session summaries, recent events | "Session 5 refactored the API layer" |

Browse, search (fuzzy search via Fuse.js), and manage entries from the **Knowledge** page in the dashboard.

### Knowledge Injection

On agent spawn, the **KnowledgeInjector** automatically injects relevant knowledge into the agent's context:
- Token-budgeted (default 1200 tokens) to avoid context overflow
- Priority: Core (always) > Procedural > Semantic > Episodic
- Sanitized against prompt injection

### Skills System

Drop Markdown files in `.github/skills/` and they're hot-reloaded into agent prompts:

```
.github/skills/
├── testing-conventions/
│   └── SKILL.md
├── api-patterns/
│   └── SKILL.md
└── error-handling/
    └── SKILL.md
```

Each skill has YAML frontmatter with `name` and `description` to control when it's loaded.

### Collective Memory

Cross-session knowledge that compounds over time. Agents can `remember()` facts and `recall()` them in future sessions. Knowledge is automatically extracted from completed sessions.

### Session Management

- **Session resume** — Resume from a previous session ID with full context recovery
- **Session replay** — Scrub through past sessions with a timeline scrubber. Keyframes capture agent state, messages, and DAG changes. Adjustable playback speed. Shareable via tokenized links.
- **Session history** — Browse past sessions with metadata (duration, tasks, token usage)
- **Persistent projects** — Projects survive across sessions. Chat history, state, and knowledge auto-load on startup.

→ [Session Management](/guide/session-management)

## Monitoring & Notifications

### AttentionBar

Persistent status bar at the top of every page with three escalation states:
- 🟢 **Green** — All clear
- 🟡 **Yellow** — Needs attention (pending decisions, context pressure)
- 🔴 **Red** — Action required (failed agents, blocked tasks)

Updates via WebSocket push (<3s latency). Sensitivity adjusts with the Trust Dial level.

### PulseStrip

Compact horizontal strip showing real-time crew health: active agents, token usage, context window pressure per agent, and pending decision count.

### Notification Channels

Configure alerts for:
- **Desktop notifications** — Browser notifications with sound/preview options
- **Telegram** — Bot integration with batched delivery and challenge-response auth
- **Slack** — Webhooks with optional thread-per-session
- **Discord** — Webhooks with optional thread-per-session

Configurable quiet hours (timezone-aware) and per-event-type preferences.

→ [Telegram Integration](/guide/telegram-integration)

## Navigation & Productivity

### Command Palette

Press **⌘K** (Mac) or **Ctrl+K** (Windows/Linux) to:
- Navigate to any page, agent, or setting
- Search across entities
- Execute natural language commands (27 NL commands across 4 categories — no LLM required)

→ [Command Palette Guide](/guide/command-palette)

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘K / Ctrl+K | Command palette |
| Shift+A | Approval queue |
| Alt+1–5 | Switch project tabs |
| Escape | Close modals/panels |

### Global Search

Search across messages, tasks, decisions, and activity from the search dialog (⌘+Shift+K).

### Historical Data

All pages load from the REST API when no live agents are present — no empty states for existing projects. You can browse any past project's timeline, tasks, decisions, and analytics even when nothing is running.

## Onboarding

### Contextual Coach

Behavior-triggered tips appear as toasts when specific conditions are met — for example, after your first approval, after repeated manual approvals (suggesting you adjust the Trust Dial), or on first agent crash. Tips appear once per trigger and are tracked in localStorage.

### Data Management

Purge old session data from **Settings → Data Management**. Preview shows exact record counts before deletion. Configurable retention period (7 days to 1 year).

→ [Settings Guide](/guide/dashboard-settings) · [Data Management](/guide/data-management)
