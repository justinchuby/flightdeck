# Analytics

The Analytics page provides cross-session insights into your Flightdeck usage — token trends, session comparisons, role distribution, and efficiency patterns.

## Accessing Analytics

Navigate to the **Analytics** tab in the main navigation. Analytics data is available for all completed sessions, even when no agents are running.

## Features

### Session Overview Card

A summary card showing aggregate metrics for the selected time window:

- **Total sessions** in the window
- **Total input/output tokens** consumed
- **Role contributions** — which roles handled the most tasks and used the most tokens

### Cost Trend Chart

A line chart (built with [Visx](https://airbnb.io/visx/)) showing token usage over time:

- X-axis: dates (sessions aggregated by `startedAt` date)
- Y-axis: total tokens per date
- Average line across all sessions
- Responsive width with formatted labels (`1.2M`, `56.8K`)
- Area fill under the trend line

Helps you spot usage spikes, trends in consumption, and cost trajectory over days/weeks.

### Insights Panel

Automatically generated insights based on your session data. These are template-based (no LLM) and capped at 5 per view:

| Type | Severity | Example |
|------|----------|---------|
| **Cost (improving)** | info | "Token usage down 15% over recent sessions" |
| **Cost (rising)** | warning | "Sessions use 25% more tokens than earlier — review model choices" |
| **Efficiency** | info | "47 tasks across 8 sessions — averaging 5.9 tasks per session" |
| **Role balance** | suggestion | "Developer handles 65% of tasks — consider distributing across roles" |

**Generation rules:**
- Cost warning triggers when recent token usage is >20% above average
- Cost improvement triggers when usage is >10% below average
- Role imbalance flags when one role handles >60% of tasks

### Session History Table

A sortable, filterable table of all past sessions:

| Column | Description |
|--------|-------------|
| Project name | Which project the session belongs to |
| Lead ID | The lead agent's ID |
| Status | completed, failed, stopped |
| Duration | Start to end time |
| Agents | Number of agents spawned |
| Tasks | Number of DAG tasks |
| Tokens | Input + output token totals |

Click any row to expand details. Select two sessions for comparison.

### Session Comparison

Compare two sessions side by side:

1. Select two sessions using the compare checkboxes
2. View delta metrics:
   - **Token delta** — difference in total token usage
   - **Agent count delta** — difference in agents used
3. Evaluate whether config changes (models, roles, prompts) improved efficiency

## Time Windows

Filter all analytics by time window:

| Window | Description |
|--------|-------------|
| **7d** | Last 7 days |
| **30d** | Last 30 days (default) |
| **90d** | Last 90 days |
| **All** | All sessions ever |

The time window affects all components — overview card, trend chart, insights, and session table. Filtering is applied client-side by `startedAt` timestamp.

## Per-Project Analysis Page

In addition to the cross-session Analytics page, each project has an **Analysis** tab with real-time visualizations:

### Cumulative Flow Chart

Tracks task lifecycle over time:

- **Created** — tasks declared in the DAG
- **In Progress** — tasks being worked on
- **Completed** — finished tasks (done, skipped, or failed)

Data comes from DAG task timestamps (`createdAt`, `startedAt`, `completedAt`), with fallback to replay keyframes for sessions without DAG data.

### Cost Curve

Shows cumulative token usage distributed across session keyframes:

- **Active sessions**: Uses live agent token counts (real-time)
- **Historical sessions**: Falls back to `/costs/by-agent` database records
- **Visualization**: Input tokens (blue area) and output tokens (green area)

### Key Stats

Quick metrics for the current session: agent count, task count, total tokens.

### Cost Breakdown

Detailed token attribution by agent and model:

- Toggle between "by agent" and "by task" views
- Shows percentage breakdowns with progress bars
- Auto-refreshes every 10 seconds

## Data Sources

| Component | API Endpoint | Refresh |
|-----------|-------------|---------|
| Analytics Overview | `GET /analytics` | On page load |
| Session List | `GET /analytics/sessions` | On page load |
| Session Comparison | `GET /analytics/compare?sessions=id1,id2` | On selection change |
| Per-Project Analysis | `GET /replay/:leadId/keyframes` + `GET /tasks` | Polling |
| Token Usage | `GET /costs/by-project` + `GET /costs/by-agent` + `GET /costs/by-task` | 15s polling |

### Metrics Tracked

**Per Session:**
- Duration (`startedAt` → `endedAt`)
- Total tokens (input + output)
- Task count (from `dag_tasks`)
- Agent count (unique agents)
- Status (running, completed, failed, stopped)

**Per Project:**
- Total sessions
- Total agents spawned
- Total token usage
- Session count

**Per Role:**
- Task count by agent role
- Token usage by role (aggregated from activity log)

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /analytics` | Overview across all sessions. Optional `?projectId=` scope. Returns totals, role contributions. |
| `GET /analytics/sessions` | List past sessions with summary data. Optional `?projectId=` filter. |
| `GET /analytics/compare?sessions=id1,id2` | Side-by-side comparison of 2+ sessions. Comma-separated lead IDs. |

### Response Shapes

**AnalyticsOverview:**
```json
{
  "totalSessions": 12,
  "totalInputTokens": 2450000,
  "totalOutputTokens": 680000,
  "sessions": [ { "leadId": "...", "projectId": "...", "agentCount": 8, "taskCount": 15, ... } ],
  "roleContributions": [
    { "role": "developer", "taskCount": 42, "tokenUsage": 1200000 },
    { "role": "architect", "taskCount": 8, "tokenUsage": 450000 }
  ]
}
```

**SessionComparison:**
```json
{
  "sessions": [ { "leadId": "a", ... }, { "leadId": "b", ... } ],
  "deltas": {
    "tokenDelta": -45000,
    "agentCountDelta": 2
  }
}
```

## Empty States

- **No sessions yet**: Friendly message suggesting you complete a few sessions first
- **No token data**: "No token usage recorded yet" with a coins icon
- **Loading**: Animated loading indicator while data is fetched
