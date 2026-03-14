# Quick Start

Get a multi-agent team running in under 2 minutes.

## Prerequisites

- Node.js 20+
- npm 10+
- At least one CLI provider installed and authenticated — [GitHub Copilot CLI](https://docs.github.com/en/copilot), [Claude Code](https://docs.anthropic.com/en/docs/agents/claude-code), Gemini CLI, Codex, Cursor, or OpenCode

## Launch

```bash
npm install -g @flightdeck-ai/flightdeck
flightdeck
```

That's it. The dashboard opens in your browser automatically.

> [!TIP] CLI Options
> `--port=4000` custom port · `--host=0.0.0.0` bind address · `--no-browser` skip auto-open · `-v` version · `-h` help

The server prints an **auth token** to the console on startup. This token is automatically injected into the web UI — no manual configuration needed.

## Create Your First Project

1. The **Lead Dashboard** opens as the default view
2. Click **Create Project**
3. Describe what you want built — for example: *"Build a REST API for a todo app with authentication, tests, and documentation"*
4. Select a model for the Project Lead (defaults to Claude Opus 4.6)
5. Click **Start** and watch

### What happens next

Within a minute or two, the lead will:

- **Analyze** your task and break it into subtasks
- **Create agents** — you'll see developers, reviewers, and other specialists appear
- **Delegate work** — each agent gets a focused subtask
- **Coordinate** — agents message each other, review code, and resolve conflicts

The dashboard updates in real time. You'll see agents writing code, debating approaches in group chats, and filing commits. You don't need to do anything — or you can jump in and message any agent at any time.

## Interacting with Agents

### Sending Messages

- **Queue** (Enter): Message is queued and delivered when the agent is ready
- **Interrupt** (Ctrl+Enter / Cmd+Enter): Message interrupts the agent's current work immediately
- **Newline** (Shift+Enter): Insert a line break without sending

### Agent Controls

| Control | Effect |
|---------|--------|
| ✋ Interrupt | Sends ACP cancel signal — aborts current work |
| ■ Stop | Terminates the agent process |
| ↻ Restart | Available for completed/failed agents |

### Changing Models

Select a different AI model from the dropdown in the agents list. The change takes effect on the next task.

## Persistent Projects

Projects persist across sessions. If a lead agent exits, the project remembers its tasks, decisions, and agent memories. Click **Resume Project** on an inactive project to start a new lead session with full context from prior work.

## Development Setup

For contributing to Flightdeck itself:

```bash
git clone https://github.com/justinchuby/flightdeck.git
cd flightdeck
npm install
npm run dev          # starts server + web UI with hot reload
```

Or start them separately:

```bash
npm run dev:server   # http://localhost:3001
npm run dev:web      # http://localhost:5173
```

## Building for Production

```bash
npm run build
flightdeck
```

Or manually:

```bash
npm run build
npm run start --workspace=packages/server
```

The web UI is built to `packages/web/dist/` and served by the Express server.
