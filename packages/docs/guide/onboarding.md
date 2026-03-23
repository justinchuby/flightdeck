# Onboarding

Flightdeck includes several features to help new users get productive quickly.

## First Launch

When you first open Flightdeck with no existing projects, the **Home Dashboard** shows an empty state with a prominent **Create Project** button and a brief explanation of what Flightdeck does. This guides you directly to creating your first project.

### Creating Your First Project

1. Click **Create Project** (or use the Projects panel)
2. Enter a **project name** and **task description** — describe what you want built in plain language
3. Select the **working directory** (the repo to work in)
4. Choose a **model** for the Project Lead (defaults to Claude Opus 4.6)
5. Optionally pre-select **agent roles** to include in the initial crew
6. Click **Start**

Within a minute or two, the lead will analyze your task, create a task DAG, assemble a crew, and begin delegating work. The dashboard updates in real-time — you'll see agents appear, tasks progress, and messages flow.

> **Example task:** *"Refactor the auth module to use JWT tokens, add comprehensive tests, and update the API documentation"*
>
> The lead would create a developer (implementation), a code reviewer (quality), and a tech writer (docs), set up dependencies so the reviewer waits for the developer, and coordinate the whole flow.

## Contextual Coach

Flightdeck includes a **Contextual Coach** — a system of behavior-triggered tips that appear as small toasts when you reach specific moments:

| Trigger | Tip |
|---------|-----|
| First approval action | Hints about batch approval for multiple items |
| Multiple manual approvals | Suggests adjusting the Trust Dial to reduce interruptions |
| First agent crash | Explains that recovery is automatic |
| First ⌘K use | Mentions natural language command support |

Tips appear once per trigger and are tracked in localStorage so they don't repeat.

## Key Concepts for New Users

### The Trust Dial

The single most important setting to understand. It controls how much autonomy agents have:

- **Supervised** — Agents request confirmation for significant actions. Best for learning how Flightdeck works.
- **Balanced** — Key decisions need your approval; routine work proceeds automatically. Good for most use cases.
- **Autonomous** (default) — Agents work independently. Only critical failures surface to you.

Toggle it from the **AttentionBar** at the top of the dashboard. You can set it globally or per-project.

→ [Oversight Guide](/guide/oversight)

### Dashboard Navigation

The sidebar provides access to all views. Key pages:

| Page | What it shows |
|------|--------------|
| **Home** | All projects at a glance — action items, decisions, progress |
| **Session** | Live chat with the Project Lead, crew sidebar, decision panel |
| **Overview** | Project-level status, attention items, decisions, activity |
| **Tasks** | Task DAG in graph, kanban, or gantt view |
| **Timeline** | Swim-lane visualization of agent activity over time |
| **Crew** | Agent roster with profiles, status, and controls |
| **Knowledge** | Browse and manage the project's knowledge base |
| **Analytics** | Token usage, cost trends, session comparison |

### Command Palette

Press **⌘K** (Mac) or **Ctrl+K** (Windows/Linux) to open the command palette. From there you can navigate anywhere, search for agents or tasks, and execute commands. You can also type natural language like "show running tasks" or "pause all agents."

### Sending Messages

| Input | Action |
|-------|--------|
| **Enter** | Queue message — delivered when the agent is ready |
| **Ctrl+Enter** / **Cmd+Enter** | Interrupt — breaks into the agent's current work immediately |
| **Shift+Enter** | Insert a line break without sending |

## Persistent Projects

Projects persist across sessions. If a lead agent exits (or the server restarts), the project remembers its tasks, decisions, agent memories, and file locks. Click **Resume** on an inactive project to start a new lead session with full context from prior work.

## Configuration

Flightdeck works out of the box with zero configuration. For customization:

- **Settings UI** — Toggle providers, set model defaults, configure notifications, create custom roles
- **Config file** — `flightdeck.config.yaml` for YAML-based configuration (hot-reloaded)
- **Environment variables** — `PORT`, `HOST`, `CLI_PROVIDER`, API keys

→ [Quick Start](/guide/quickstart) · [Configuration Reference](/reference/configuration)
