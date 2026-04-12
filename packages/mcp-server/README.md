# @flightdeck-ai/mcp-server

MCP (Model Context Protocol) server for [Flightdeck](https://github.com/justinchuby/flightdeck) — expose multi-agent orchestration capabilities as MCP tools.

## Install

```bash
# From the monorepo
npm install
npm run build --workspace=packages/mcp-server

# Link globally for the `flightdeck-mcp` command
cd packages/mcp-server && npm link
```

Or install from npm (once published):

```bash
npm install -g @flightdeck-ai/mcp-server
```

## Usage

```bash
# Start the MCP server (stdio transport)
flightdeck-mcp

# Connect to a custom Flightdeck URL
flightdeck-mcp --url http://192.168.1.100:3001

# Or via environment variable
FLIGHTDECK_URL=http://host:3001 flightdeck-mcp
```

### MCP Client Configuration

Add to your MCP client config (e.g., Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "flightdeck": {
      "command": "flightdeck-mcp",
      "args": []
    }
  }
}
```

## Tools

The server exposes 35+ tools organized by domain:

### System
- `flightdeck_status` — System status, active agents, uptime
- `flightdeck_config` — Current configuration
- `flightdeck_pause` / `flightdeck_resume` — Pause/resume all agents

### Lead Sessions
- `flightdeck_lead_list` / `flightdeck_lead_get` — List/get lead sessions
- `flightdeck_lead_start` — Start a new orchestration session
- `flightdeck_lead_message` — Send message to a lead
- `flightdeck_lead_decisions` / `flightdeck_lead_dag` — View decisions and task DAG

### Agents
- `flightdeck_agent_list` — List all agents
- `flightdeck_agent_spawn` — Spawn a new agent with role and task
- `flightdeck_agent_message` / `flightdeck_agent_messages` — Send/read messages
- `flightdeck_agent_plan` / `flightdeck_agent_tasks` / `flightdeck_agent_focus` — View agent state
- `flightdeck_agent_terminate` / `flightdeck_agent_interrupt` / `flightdeck_agent_delete` — Agent lifecycle

### Crews
- `flightdeck_crew_list` / `flightdeck_crew_get` / `flightdeck_crew_summary` — View crews
- `flightdeck_crew_agents` / `flightdeck_crew_health` — Crew details
- `flightdeck_crew_delete` — Delete crew and terminate agents

### Tasks & Coordination
- `flightdeck_task_list` — List tasks with filters
- `flightdeck_attention` — Items needing human attention
- `flightdeck_coordination_status` / `_locks` / `_activity` / `_summary` — File coordination

### Costs & Analytics
- `flightdeck_costs_by_agent` / `_by_task` / `_by_session` — Token usage and costs
- `flightdeck_analytics` — Performance metrics
- `flightdeck_notifications` — Recent notifications

### Natural Language & Search
- `flightdeck_nl_execute` / `flightdeck_nl_preview` — Natural language commands
- `flightdeck_search` — Search across messages, tasks, decisions

### Projects
- `flightdeck_project_list` — List known projects

## Requirements

- Node.js >= 20
- A running Flightdeck instance (default: `http://127.0.0.1:3001`)

## License

MIT
