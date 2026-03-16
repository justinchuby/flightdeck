# Analytics

The Analytics page provides cross-session insights into your Flightdeck usage — token trends, session comparisons, role distribution, and efficiency patterns.

## Accessing Analytics

Navigate to the **Analytics** tab in the main navigation. Analytics data is available for all completed sessions, even when no agents are running.

## Features

### Session Overview Card

A summary card showing aggregate metrics for the selected time window:

- **Total sessions** in the time window
- **Total input/output tokens** consumed
- **Role contributions** — which roles handled the most tasks and used the most tokens

### Cost Trend Chart

A line chart showing cumulative token usage over time. Helps you spot:

- Usage spikes from large sessions
- Trends in token consumption across sessions
- Cost trajectory over days/weeks

### Insights Panel

Automatically generated insights based on your session data (no LLM — template-based analysis):

| Insight Type | Example |
|-------------|---------|
| **Cost** | "Token usage down 15% over recent sessions" |
| **Cost Warning** | "Sessions use 25% more tokens than earlier" |
| **Efficiency** | "47 tasks across 8 sessions — averaging 5.9 tasks per session" |
| **Role Balance** | "Developer handles 65% of tasks — consider adding more roles" |

Insights are capped at 5 per view to avoid noise.

### Session History Table

A table of all past sessions with:

- Project name and lead ID
- Status (completed, failed, stopped)
- Start/end timestamps
- Agent count and task count
- Token usage (input + output)

Click any row to expand details. Select two sessions for comparison.

### Session Comparison

Compare two sessions side by side:

1. Select two sessions by clicking the compare checkbox in the history table
2. View delta metrics:
   - **Token delta** — difference in total token usage
   - **Agent count delta** — difference in number of agents used

The comparison view helps you evaluate whether changes to your configuration (models, roles, prompts) improved efficiency.

## Time Windows

Filter all analytics by time window:

| Window | Description |
|--------|-------------|
| **7d** | Last 7 days |
| **30d** | Last 30 days (default) |
| **90d** | Last 90 days |
| **All** | All sessions ever |

The time window affects all components on the page — overview card, trend chart, insights, and session table.

## Analysis Page (Per-Project)

In addition to the cross-session Analytics page, each project has an **Analysis** tab showing real-time visualizations:

### Cumulative Flow Chart

Tracks task lifecycle over time:

- **Created** — tasks declared in the DAG
- **In Progress** — tasks being worked on
- **Completed** — finished tasks (done, skipped, or failed)

Data comes from DAG task timestamps (`createdAt`, `startedAt`, `completedAt`), falling back to replay keyframes for sessions without DAG data.

### Cost Curve

Shows cumulative token usage distributed across session keyframes:

- For active sessions: uses live agent token counts
- For historical sessions: falls back to `/costs/by-agent` database records
- Splits into input tokens (blue) and output tokens (green)

### Key Stats

Quick metrics for the current project session — agent count, task count, total tokens.

### Cost Breakdown

Detailed token attribution by agent and model. Shows which agents and models consumed the most tokens, with percentage breakdowns and progress bars.

## Data Sources

| Component | API Endpoint | Refresh |
|-----------|-------------|---------|
| Analytics Overview | `GET /analytics` | On page load |
| Session Comparison | `GET /analytics/compare?sessions=id1,id2` | On selection change |
| Analysis Page (per-project) | `GET /replay/:projectId/keyframes` + `GET /tasks` | Polling (configurable) |
| Token Usage Section | `GET /costs/by-project` + `GET /costs/by-agent` + `GET /costs/by-task` | 15s polling |

## Empty States

- **No sessions yet**: Shows a friendly message suggesting you complete a few sessions first
- **No token data**: "No token usage recorded yet" with a coins icon
- **Loading**: Animated loading indicator while data is fetched
