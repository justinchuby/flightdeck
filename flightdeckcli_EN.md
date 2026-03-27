# Flightdeck CLI

Control your AI agent crew from the terminal.

---

## Prerequisites

- Node.js ≥ 20
- A running Flightdeck server (the CLI connects via HTTP)

---

## Installation

### Option 1: Global npm install (recommended)

```bash
npm install -g @flightdeck-ai/flightdeck
```

After installation, `flightdeckcli` is automatically added to your PATH and works from any directory:

```bash
flightdeckcli --help
```

### Option 2: From source

```bash
git clone https://github.com/justinchuby/flightdeck.git
cd flightdeck
npm install
npm run build
```

Then run from the **project root**:

```bash
npx flightdeckcli --help
```

> **Note:** `npx` must be run from the `flightdeck/` root directory since `flightdeckcli` is a workspace-internal package.

To use it from any directory, create a global link (one-time):

```bash
cd flightdeck
npm link --workspace=packages/cli
```

After that, `flightdeckcli` works anywhere.

---

## Connecting to the Server

The CLI requires a running Flightdeck server. Start one with:

```bash
flightdeck --no-browser
```

By default, the CLI connects to `http://localhost:3001`. To use a different address:

```bash
# Via command-line flag
flightdeckcli --url http://192.168.1.100:3001 health

# Via environment variable
export FLIGHTDECK_URL=http://192.168.1.100:3001
flightdeckcli health

# Via REPL (saved for future sessions)
flightdeckcli
◆ flightdeck ❯ config url http://192.168.1.100:3001
◆ flightdeck ❯ config token your-auth-token
```

Configuration is saved to `~/.flightdeckcli/session.json` and reused automatically.

---

## Two Ways to Use

### 1. One-shot commands (for scripts and automation)

```bash
flightdeckcli <global-options> <command> <subcommand> <arguments>
```

### 2. Interactive REPL (for daily use)

```bash
flightdeckcli
```

Inside the REPL, type commands directly (no `flightdeckcli` prefix needed):

```
◆ flightdeck ❯ project list
◆ flightdeck ❯ agent list
◆ flightdeck ❯ quit
```

---

## Global Options

```bash
flightdeckcli --json project list    # JSON output (for scripts / jq)
flightdeckcli --project abc123 agent list   # Scope to a specific project
flightdeckcli --url http://x:3001 health    # Override server URL
flightdeckcli --token mytoken health        # Override auth token
flightdeckcli --version                     # Show version
flightdeckcli --help                        # Show help
```

---

## Command Reference

> Every command below is shown in full copy-pasteable form.
> If using from source, replace `flightdeckcli` with `npx flightdeckcli`.

### 🔍 System Status

**Check if the server is online**
```bash
flightdeckcli health
```

**Show coordination status (agents, locks, activity)**
```bash
flightdeckcli status
```

**Show installed AI providers**
```bash
flightdeckcli providers
```

**Show available agent roles**
```bash
flightdeckcli roles
```

**Show recent activity log**
```bash
flightdeckcli activity
flightdeckcli activity --limit 50
```

**Show analytics overview (token usage, costs)**
```bash
flightdeckcli analytics
```

**Show coordination summary**
```bash
flightdeckcli summary
```

**Show file locks**
```bash
flightdeckcli locks
```

---

### 📁 Project Management

**List all projects**
```bash
flightdeckcli project list
flightdeckcli project list --status active
```

**Start a new project**
```bash
flightdeckcli project start "Implement user authentication"
flightdeckcli project start "Build REST API" --name my-api --model claude-opus-4.6
```

**Show project details**
```bash
flightdeckcli project info abc123def456
```

**Set the active project (subsequent commands auto-scope to it)**
```bash
flightdeckcli project use abc123def456
```

**Delete a project**
```bash
flightdeckcli project delete abc123def456
```

---

### 🤖 Agent Management

**List all agents**
```bash
flightdeckcli agent list
```

**Spawn a new agent**
```bash
flightdeckcli agent spawn developer
flightdeckcli agent spawn architect --model claude-opus-4.6 --task "Design the database schema"
```

**Send a message to an agent**
```bash
flightdeckcli agent message a1b2c3d4 "Please add input validation"
```

**View an agent's conversation history**
```bash
flightdeckcli agent messages a1b2c3d4
flightdeckcli agent messages a1b2c3d4 --limit 100
```

**Interrupt an agent's current work**
```bash
flightdeckcli agent interrupt a1b2c3d4
```

**Restart an agent**
```bash
flightdeckcli agent restart a1b2c3d4
```

**Terminate an agent**
```bash
flightdeckcli agent terminate a1b2c3d4
```

---

### 📋 Task DAG

**List all tasks**
```bash
flightdeckcli task list
flightdeckcli task list --status running
flightdeckcli task list --scope project
```

**Show task statistics**
```bash
flightdeckcli task stats
```

**Show tasks needing human attention**
```bash
flightdeckcli task attention
```

---

### ✅ Decision Management

**List pending decisions**
```bash
flightdeckcli decision list
flightdeckcli decision list --all
```

**Approve a decision**
```bash
flightdeckcli decision approve abc123
flightdeckcli decision approve abc123 --reason "Looks good, approved"
```

**Reject a decision**
```bash
flightdeckcli decision reject abc123 --reason "Security risk too high"
```

---

## JSON Output

Add `--json` to any command for machine-readable output:

```bash
flightdeckcli --json agent list
flightdeckcli --json task stats
flightdeckcli --json project list

# Pipe to jq
flightdeckcli --json agent list | jq '.[] | select(.status == "active")'
flightdeckcli --json task stats | jq '.done'
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FLIGHTDECK_URL` | Server address (default: `http://localhost:3001`) |
| `FLIGHTDECK_TOKEN` | Authentication token |
| `NO_COLOR` | Set to any value to disable colored output |
