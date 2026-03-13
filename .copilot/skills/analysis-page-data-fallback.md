# Analysis Page: Live Data vs Persisted DB Fallback

**When to use:** When building UI that displays session metrics (tokens, costs, agent stats) and needs to work for both active and inactive/historical sessions.

## The Problem

The AnalysisPage computed token totals from live in-memory agent objects:

```typescript
const totalInput = currentAgents.reduce((s, a) => s + (a.inputTokens ?? 0), 0);
const totalOutput = currentAgents.reduce((s, a) => s + (a.outputTokens ?? 0), 0);
```

When a session is inactive, agents are gone from memory → all zeros → "Waiting for token data..."

## The Pattern: Prefer Live, Fall Back to DB

```typescript
// 1. Try live agent data first (real-time, most current)
let totalInput = currentAgents.reduce((s, a) => s + (a.inputTokens ?? 0), 0);
let totalOutput = currentAgents.reduce((s, a) => s + (a.outputTokens ?? 0), 0);

// 2. Fall back to persisted DB totals for inactive sessions
if (totalInput + totalOutput === 0) {
  try {
    const costsByAgent = await apiFetch<Array<{ totalInputTokens: number; totalOutputTokens: number }>>(
      `/costs/by-agent?projectId=${projectId}`,
    );
    if (Array.isArray(costsByAgent)) {
      totalInput = costsByAgent.reduce((s, c) => s + (c.totalInputTokens ?? 0), 0);
      totalOutput = costsByAgent.reduce((s, c) => s + (c.totalOutputTokens ?? 0), 0);
    }
  } catch { /* costs API not available */ }
}
```

## Key Files

- **Frontend:** `packages/web/src/components/AnalysisPage/AnalysisPage.tsx` — token computation at ~line 84
- **Backend API:** `GET /costs/by-agent?projectId=X` — defined in `packages/server/src/routes/lead.ts`
- **Data source:** `CostTracker.getAgentCosts()` in `packages/server/src/agents/CostTracker.ts` — queries `task_cost_records` table

## Gotchas

- The `/costs/by-agent` endpoint aggregates across ALL sessions for a project, not just the current one. This is fine for totals but could overcount if viewing a specific session.
- The `task_cost_records` table is only populated when token usage events are recorded by `AgentManager`. If the `dagTaskId` gate blocks recording, the DB will also be empty (see the token-attribution-system skill).
- Always check `Array.isArray()` on the response — the endpoint returns `[]` when CostTracker is unavailable.
