# Cost & Token Tracking

Flightdeck tracks token usage and costs across all agents, tasks, and sessions. This data powers the dashboard displays, analytics, and budget controls.

## Overview

Every API call made by an agent records input and output token counts. These are aggregated at multiple levels:

- **Per agent** — how many tokens each agent has consumed
- **Per task** — token cost of completing each DAG task
- **Per project** — total usage across all agents in a project
- **Per session** — historical token data for past sessions

## Dashboard Displays

### Project Overview — Token Usage Section

The overview page shows a collapsible token usage summary:

- **Summary bar**: Input tokens (↓), output tokens (↑), total, and agent count
- **By Agent**: Horizontal bar chart showing each agent's share of total tokens
- **By Task**: Expandable breakdown of tokens spent on each DAG task

Token data refreshes automatically every 15 seconds via polling.

### Analysis Page

The analysis page provides deeper visualizations:

- **Cost Curve**: Cumulative token usage over time, plotted against session keyframes
- **Key Stats**: Quick metrics for the current session
- **Cumulative Flow**: Task progress (created → in progress → completed) over time
- **Cost Breakdown**: Detailed per-agent and per-model attribution

### Project Cards

Each project card in the projects list shows token usage inline, with input and output token counts visible at a glance.

## API Endpoints

All cost endpoints are under `/api/costs/`:

| Endpoint | Description |
|----------|-------------|
| `GET /costs/by-agent` | Token totals per agent. Optional `?projectId=` filter. |
| `GET /costs/by-task` | Token totals per DAG task. Optional `?leadId=` or `?projectId=` filter. |
| `GET /costs/agent/:agentId` | Detailed task-level costs for a specific agent. |
| `GET /costs/by-project` | Aggregate totals per project. |
| `GET /costs/by-session` | Per-session costs. Requires `?projectId=` parameter. |

### Analytics Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /analytics` | Overview across all sessions (totals, role contributions). |
| `GET /analytics/sessions` | List past sessions with summary data. |
| `GET /analytics/compare?sessions=id1,id2` | Side-by-side session comparison. |

## Data Sources

Token data comes from two sources, with an automatic fallback:

### Live Agent Data (Active Sessions)

When agents are running, token counts come directly from the agent objects in memory:

```
agent.inputTokens  → accumulated from ACP usage reports
agent.outputTokens → accumulated from ACP usage reports
```

This data is real-time and updates with every API call the agent makes.

### Persisted Database Data (Historical Sessions)

When a session ends, token data is persisted to the `task_cost_records` table. For inactive sessions, the UI falls back to the database:

```
GET /costs/by-agent?projectId=...  → reads from task_cost_records
```

The UI automatically detects which source to use — if live agent token counts sum to zero, it falls back to the database.

## Budget Controls

Set a spending budget in your config to prevent runaway costs:

```yaml
budget:
  limit: 50.00          # Dollar cap (null = unlimited)
  thresholds:
    warning: 0.7         # 70% — show warning in UI
    critical: 0.9        # 90% — show critical alert
    pause: 1.0           # 100% — pause all agents
```

When budget thresholds are crossed:

| Threshold | Action |
|-----------|--------|
| **Warning** (70%) | Yellow indicator in the dashboard |
| **Critical** (90%) | Red alert, notification sent |
| **Pause** (100%) | All agents are paused automatically |

Set `limit: null` to disable budget enforcement.

## Per-Agent Attribution

Every token usage record is attributed to:

1. **Agent ID** — which agent made the API call
2. **Lead ID** — which lead session the agent belongs to
3. **Task ID** — which DAG task the agent was working on (if applicable)
4. **Project ID** — which project the work is for

This enables drill-down analysis: "Project X cost $12, of which $8 was the developer agent working on task `implement-auth`."

## Token Display Format

Token counts use human-readable formatting throughout the UI:

| Value | Display |
|-------|---------|
| 1,234 | `1.2K` |
| 56,789 | `56.8K` |
| 1,234,567 | `1.2M` |

Input tokens are shown in blue (↓), output tokens in green (↑).
