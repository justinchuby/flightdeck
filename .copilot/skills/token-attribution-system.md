# Token Attribution System: CostTracker and task_cost_records

**When to use:** When working on token usage tracking, cost attribution, or the CostBreakdown UI panel. Also useful when debugging why token data is missing.

## Architecture Overview

Token usage flows through this pipeline:

1. **Provider adapter** reports token counts after each API call
2. **AgentManager** receives `token_usage` events and records them
3. **CostTracker** persists records to the `task_cost_records` SQLite table
4. **Frontend** reads via `/costs/by-agent` and `/costs/by-task` API endpoints

## Key Files

| Component | File | Purpose |
|-----------|------|---------|
| Cost tracker | `packages/server/src/agents/CostTracker.ts` | DB persistence layer for cost records |
| Recording gate | `packages/server/src/agents/AgentManager.ts` ~line 725 | Where token events get recorded |
| By-agent API | `packages/server/src/routes/lead.ts` ~line 263 | `GET /costs/by-agent?projectId=X` |
| By-task API | `packages/server/src/routes/lead.ts` | `GET /costs/by-task?projectId=X` |
| Frontend panel | `packages/web/src/components/TokenEconomics/CostBreakdown.tsx` | Attribution UI |

## The dagTaskId Gate Issue

In `AgentManager.ts`, token recording was gated by:

```typescript
if (dagTaskId && agent.parentId) {
  // record cost...
}
```

This meant:
- **No DAG task assigned** → no cost recorded (even though tokens were used)
- **Lead agents** (no parentId) → never recorded
- **Result:** `task_cost_records` table stays empty, CostBreakdown shows "No token attribution data yet"

The fix: use fallback values when dagTaskId or parentId is missing, so all token usage gets recorded.

## Database Schema

```sql
-- task_cost_records table
CREATE TABLE task_cost_records (
  id TEXT PRIMARY KEY,
  agentId TEXT NOT NULL,
  dagTaskId TEXT,        -- may be '_unattributed' as fallback
  projectId TEXT,
  inputTokens INTEGER,
  outputTokens INTEGER,
  costUsd REAL,
  model TEXT,
  createdAt TEXT
);
```

## CostTracker API

```typescript
// Get per-agent totals (aggregated from task_cost_records)
tracker.getAgentCosts(projectId?: string): AgentCostSummary[]
// Returns: { agentId, agentRole?, totalInputTokens, totalOutputTokens, totalCostUsd, taskCount }

// Get per-task totals
tracker.getTaskCosts(projectId?: string): TaskCostSummary[]
```

## Gotchas

- Token counts on live agent objects (`agent.inputTokens`, `agent.outputTokens`) are ephemeral — they vanish when the agent process ends
- The `task_cost_records` table is the only persistent store for historical token data
- The time-series chart (`token_usage` WebSocket events) works independently of the DB records — it fires unconditionally
- `CostBreakdown` reads from DB, `CostCurve` reads from live agents (with DB fallback)
