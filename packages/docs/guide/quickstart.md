# Quick Start

## Prerequisites

- Node.js 20+
- npm 10+
- [GitHub Copilot CLI](https://docs.github.com/en/copilot) installed and authenticated

## Installation

```bash
git clone https://github.com/justinchuby/flightdeck.git
cd flightdeck
npm install
```

## Running

### Production (recommended)

The `flightdeck` command builds the project and starts the server with the web UI:

```bash
npx flightdeck
```

Options:
- `--port=4000` — Custom port (default: 3001, or `PORT` env var)
- `--no-browser` — Don't auto-open the browser

The server prints an **auth token** to the console on startup. This token is automatically injected into the web UI — no manual configuration needed.

### Development

Start both the server and web UI in dev mode with hot reload:

```bash
npm run dev
```

Or start them separately:

```bash
npm run dev:server   # http://localhost:3001
npm run dev:web      # http://localhost:5173
```

## Creating Your First Project

1. Open the web UI (auto-opens, or visit `http://localhost:3001`)
2. The **Lead Dashboard** is the default view
3. Click **Create Project**
4. Provide a name, task description, and optionally a working directory
5. Select a model for the Project Lead (defaults to Claude Opus 4.6)
6. The lead will analyze the task, create agents, and start delegating

> [!TIP] What to expect
> Within a minute or two, you'll see the lead creating agents (developers, reviewers, etc.) and assigning them work. The dashboard updates in real-time — you can watch agents coding, messaging each other, and reviewing code simultaneously. You don't need to do anything — just watch. Or jump in and message any agent at any time.

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

## Building for Production

```bash
npm run build
npx flightdeck
```

Or manually:

```bash
npm run build
npm run start --workspace=packages/server
```

The web UI is built to `packages/web/dist/` and served by the Express server.
