# Quick Start

Get a multi-agent team running in under 2 minutes.

## Prerequisites

- Node.js 20+
- npm 10+
- At least one CLI provider installed and authenticated:

| Provider | Install | Auth |
|----------|---------|------|
| [GitHub Copilot](https://docs.github.com/en/copilot) | `npm i -g @anthropic-ai/copilot` | `gh auth login` |
| [Claude Code](https://docs.anthropic.com/en/docs/agents/claude-code) | `npm i -g @anthropic-ai/claude-code` | Set `ANTHROPIC_API_KEY` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm i -g @anthropic-ai/gemini-cli` | Set `GEMINI_API_KEY` |
| [Codex](https://github.com/openai/codex) | `npm i -g @openai/codex` | Set `OPENAI_API_KEY` |
| [Cursor](https://www.cursor.com/) | Install Cursor agent | Set `CURSOR_API_KEY` |
| [OpenCode](https://github.com/opencode-ai/opencode) | `npm i -g opencode` | (none) |

## Install & Launch

```bash
npm install -g @flightdeck-ai/flightdeck
flightdeck
```

That's it. The dashboard opens in your browser automatically at `http://localhost:3001`.

> [!TIP] CLI Options
> ```
> --port=<number>    Port to listen on (default: 3001, or PORT env)
> --host=<addr>      Host to bind to (default: 127.0.0.1, or HOST env)
> --no-browser       Don't open browser on start
> -v, --version      Show version number
> -h, --help         Show this help message
> ```

The server prints an **auth token** to the console on startup. This token is automatically injected into the web UI — no manual configuration needed.

## Configuration

Flightdeck works out of the box with zero configuration. For customization, create a `flightdeck.config.yaml` in your project root or at `~/.flightdeck/config.yaml`.

```bash
# Copy the example config to get started
cp flightdeck.config.example.yaml flightdeck.config.yaml
```

Config resolution order (highest priority first):
1. `FLIGHTDECK_CONFIG` environment variable
2. `flightdeck.config.yaml` in the current directory
3. `~/.flightdeck/config.yaml` (auto-created on first run)

Key configuration sections:

```yaml
server:
  maxConcurrentAgents: 50        # max agents running at once (1–200)

provider:
  id: copilot                    # default provider for spawning agents
  # binaryOverride: null         # override CLI binary path
  # argsOverride: null           # override CLI spawn args
  # envOverride: {}              # extra env vars for the provider

# Toggle individual providers on/off and set per-provider model preferences.
# The system auto-detects installed providers; use this to disable ones you
# don't want or to pin preferred models per provider.
providerSettings:
  copilot:
    enabled: true
  claude:
    enabled: true
    models: [claude-opus-4.6, claude-sonnet-4.6]
  gemini:
    enabled: false               # disable a provider you don't use
  # codex, cursor, opencode — all enabled by default

# Provider preference order — first available provider wins when the default
# is unavailable. Drag-to-reorder in the Settings UI.
providerRanking:
  - copilot
  - claude
  - gemini
  - codex
  - cursor
  - opencode

models:
  defaults:
    developer: [claude-opus-4.6]
    architect: [claude-opus-4.6]
    code-reviewer: [gemini-3-pro-preview, claude-opus-4.6]
    lead: [claude-opus-4.6]
    # ... see flightdeck.config.example.yaml for all 14 roles

budget:
  limit: null                    # null = unlimited, or a dollar cap
```

> [!TIP]
> You can also manage providers from **Settings → Providers** in the dashboard — toggle providers on/off, reorder the ranking, test connections, and set per-provider model preferences without editing YAML.

> [!TIP]
> The config is hot-reloaded — most changes take effect without restarting the server. See the comments in `flightdeck.config.example.yaml` for per-field details.

## Create Your First Project

1. The **Lead Dashboard** opens as the default view
2. Click **Create Project**
3. Describe what you want built — for example: *"Build a REST API for a todo app with authentication, tests, and documentation"*
4. Select a working directory and a model for the Project Lead (defaults to Claude Opus 4.6)
5. Click **Start** and watch

### What happens next

Within a minute or two, the lead will:

- **Analyze** your task and break it into a task DAG (dependency graph)
- **Spawn agents** — developers, reviewers, and other specialists appear in the crew roster
- **Delegate work** — each agent gets a focused subtask with file locks
- **Coordinate** — agents message each other, review code, and resolve conflicts

The dashboard updates in real time. You'll see agents writing code, debating approaches in group chats, and filing commits.

## Interacting with Agents

### Sending Messages

| Shortcut | Action |
|----------|--------|
| **Enter** | Queue message — delivered when the agent is ready |
| **Ctrl+Enter** / **Cmd+Enter** | Interrupt — breaks into the agent's current work immediately |
| **Shift+Enter** | Insert a line break without sending |

You can also **@mention** agents by role (e.g. `@developer`) or prefix ID to direct messages.

### Agent Controls

| Control | Effect |
|---------|--------|
| ⚡ Interrupt | Sends ACP cancel signal — the agent receives your message immediately |
| ■ Stop | Terminates the agent process |
| ↻ Restart | Available for completed/failed agents — resumes with context |

### Oversight Level (Trust Dial)

The Trust Dial controls how much autonomy agents have:

| Level | Behavior |
|-------|----------|
| **Autonomous** | Agents work independently, minimal human approval needed |
| **Supervised** | Agents request confirmation for significant actions |
| **Strict** | Every action requires explicit human approval |

Toggle the Trust Dial from the Lead Dashboard header.

### Command Palette

Press **⌘K** (Mac) or **Ctrl+K** (Windows/Linux) to open the command palette. From there you can:
- Switch between views
- Search agents, tasks, and files
- Trigger actions (stop all agents, export session, etc.)

## Persistent Projects

Projects persist across sessions. If a lead agent exits, the project remembers its tasks, decisions, agent memories, and file locks. Click **Resume Project** on an inactive project to start a new lead session with full context from prior work.

## Development Setup

For contributing to Flightdeck itself:

```bash
git clone https://github.com/justinchuby/flightdeck.git
cd flightdeck
npm install
npm run dev          # starts server + web UI with hot reload
```

Or start components separately:

```bash
npm run dev:server   # Express API + WebSocket at http://localhost:3001
npm run dev:web      # Vite dev server at http://localhost:5173
npm run docs:dev     # VitePress docs site
```

### Running Tests

```bash
npm test                          # server tests
cd packages/web && npx vitest run # frontend tests (4500+ tests)
```

## Building for Production

```bash
npm run build        # builds shared, server, and web packages
npm start            # or: flightdeck
```

The web UI is built to `packages/web/dist/` and served by the Express server. No separate web server needed.
