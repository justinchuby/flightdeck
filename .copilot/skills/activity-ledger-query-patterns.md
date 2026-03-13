# Activity Ledger Query Patterns

**When to use**: When fetching activity data for UI display, or debugging why activity-based features show empty/stale data.

## Architecture

The ActivityLedger (`packages/server/src/coordination/activity/ActivityLedger.ts`) is a buffered, DB-backed event log. All agent actions (status changes, messages, locks, progress updates, delegations) are logged here.

### Write Path
1. Any command handler calls `activityLedger.log(agentId, agentRole, actionType, summary, details, projectId)`
2. Entries are buffered in memory (up to 64 entries or 250ms)
3. `flush()` writes batch to `activity_log` SQLite table
4. A synthetic `ActivityEntry` is also emitted via EventEmitter for real-time listeners

### Read Path
- `getRecent(limit, projectId?)` — most recent N entries (any type)
- `getByType(actionType, limit, projectId?)` — most recent N of a specific type
- `getByAgent(agentId, limit, projectId?)` — most recent N from a specific agent
- `getSince(timestamp, projectId?)` — all entries after a timestamp

## Critical Pattern: Server-Side Filtering

**Never fetch generic activities and filter client-side when looking for a specific type.**

### The Bug Pattern
```typescript
// BAD — fetches 50 of ANY type, then filters client-side
const all = await apiFetch('/coordination/activity?limit=50');
const progress = all.filter(a => a.actionType === 'progress_update');
// Result: empty array if progress_update is >50 entries behind the latest
```

Activity types have vastly different frequencies:
- `status_change`: ~15,000 entries (dominates)
- `message_sent`: ~3,000
- `lock_acquired`: ~1,200
- `progress_update`: ~100 (rare — easily buried)

A `limit=50` generic query will almost never contain `progress_update` entries.

### The Fix
```typescript
// GOOD — use server-side type filter
const progress = await apiFetch('/coordination/activity?type=progress_update&limit=15');
```

The API at `GET /coordination/activity` (defined in `packages/server/src/routes/coordination.ts:66-81`) supports these query params:
- `type` — filters by actionType (calls `getByType()`)
- `agentId` — filters by agent (calls `getByAgent()`)
- `since` — returns all after timestamp (calls `getSince()`)
- `limit` — max results (default 50, max 1000)
- `projectId` — scope to a single project

## Gotcha: No Polling by Default

The HomeDashboard fetches activity data once on mount with no polling interval. For real-time updates, add either:
1. A `setInterval` polling loop (simple, 15-30s interval)
2. A WebSocket listener for the `activity` event from ActivityLedger

## Key Files

| File | Lines | Role |
|------|-------|------|
| `packages/server/src/coordination/activity/ActivityLedger.ts` | 31-58 | `log()` — buffered write |
| `packages/server/src/coordination/activity/ActivityLedger.ts` | 108-119 | `getByType()` — server-side type filter |
| `packages/server/src/routes/coordination.ts` | 66-81 | API endpoint with type/agent/since params |
| `packages/web/src/components/HomeDashboard/HomeDashboard.tsx` | 292 | Frontend fetch call |
