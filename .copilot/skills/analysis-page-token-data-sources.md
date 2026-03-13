# Analysis Page Token Data Sources

**When to use**: When debugging why the analysis page shows missing or zero token data, or when adding new cost/usage visualizations.

## Two Token Data Paths

The analysis page has two independent data sources for token information. Understanding which is active and when is critical.

### Path 1: Live Agent Objects (In-Memory)
- **Source**: `AnalysisPage.tsx` reads `agent.inputTokens` / `agent.outputTokens` from the app store
- **Populated by**: WebSocket `agent:usage` events → appStore updates agent objects in memory
- **Works when**: Session is active and agents are running
- **Fails when**: Session is inactive (agents gone from memory → all zeros → "Waiting for token data...")
- **Used for**: Time-series token usage chart, total token counts

### Path 2: DB-Persisted Cost Records
- **Source**: `CostBreakdown.tsx` fetches `/costs/by-agent` and `/costs/by-task` API endpoints
- **Populated by**: `CostTracker.recordUsage()` → writes to `task_cost_records` DB table
- **Works when**: Data has been recorded to the DB (persists across sessions)
- **Fails when**: The dagTaskId gate blocks recording (see below)
- **Used for**: Per-agent and per-task cost attribution breakdown

## The dagTaskId Gate Bug

In `AgentManager.ts`, token usage recording has a gate condition:

```typescript
// packages/server/src/agents/AgentManager.ts ~line 725
if (dagTaskId && agent.parentId) {
  tracker.recordUsage(agent.id, dagTaskId, ...);
}
```

This requires BOTH:
1. `dagTaskId` — agent must have an active DAG task
2. `agent.parentId` — agent must have a parent (not be the lead)

**Problem**: The lead agent (which has no `parentId`) never records usage. And child agents only record when they have an active DAG task. This means `task_cost_records` is often empty → "No token attribution data yet."

Meanwhile, `emit('agent:usage')` at line ~730 fires unconditionally, so the time-series chart works fine.

## Fix Plan

1. **Remove the parentId requirement**: The lead's token usage should be tracked too
2. **Fall back to a synthetic task ID**: When no dagTaskId exists, use `agent.id` or a session-level bucket
3. **Add DB fallback for inactive sessions**: When live agents aren't available, fetch historical data from `/costs/by-agent` instead of reading from in-memory agent objects

## Key Files

| File | Lines | Role |
|------|-------|------|
| `packages/server/src/agents/AgentManager.ts` | ~721-731 | Token usage wiring — emit (unconditional) vs record (gated) |
| `packages/server/src/agents/CostTracker.ts` | 102-154 | `recordUsage()` — writes to task_cost_records |
| `packages/server/src/agents/CostTracker.ts` | 157-182 | `getAgentCosts()` — reads aggregated costs |
| `packages/server/src/routes/lead.ts` | 263-296 | `/costs/by-agent` and `/costs/by-task` API endpoints |
| `packages/web/src/components/AnalysisPage/AnalysisPage.tsx` | 84-86 | Token data from live agent objects |
| `packages/web/src/components/TokenEconomics/CostBreakdown.tsx` | 34-37 | Fetches DB-backed cost data |
