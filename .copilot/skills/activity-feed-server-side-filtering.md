# Activity Feed: Always Use Server-Side Type Filtering

## When to use
When fetching from the `/coordination/activity` API and you only need specific action types (e.g., `progress_update`, `task_completed`, `delegated`).

## The Problem

The activity ledger accumulates high-volume entries like `status_change` (15k+) and `message_sent` (3k+). If you fetch the top N entries without filtering, these high-volume types dominate the window and the entries you actually want never appear.

**Bad pattern:**
```typescript
// Fetches 50 most recent of ALL types — progress_update entries never appear
const data = await apiFetch('/coordination/activity?limit=50');
const progress = data.filter(a => a.actionType === 'progress_update'); // Always empty!
```

## The Fix

The backend already supports server-side type filtering via the `type` query parameter:

```typescript
// Good: server returns only progress_update entries
const data = await apiFetch('/coordination/activity?type=progress_update&limit=15');
```

### Supported query parameters:
| Param | Type | Description |
|-------|------|-------------|
| `type` | string | Filter by action type (e.g., `progress_update`, `task_completed`) |
| `limit` | number | Max entries to return |
| `agentId` | string | Filter by specific agent |
| `projectId` | string | Filter by project |
| `since` | string | ISO timestamp for recency filter |

### Backend implementation:
- Route: `packages/server/src/routes/coordination.ts` line 66
- When `type` is provided, calls `ActivityLedger.getByType()` instead of `getRecent()`

## Polling Pattern

For live-updating sections, add a polling interval:

```typescript
useEffect(() => {
  fetchData();
  const interval = setInterval(fetchData, 15_000); // 15s refresh
  return () => clearInterval(interval);
}, [fetchData]);
```

## Files
- API route: `packages/server/src/routes/coordination.ts`
- Ledger: `packages/server/src/coordination/activity/ActivityLedger.ts`
- Consumer: `packages/web/src/components/HomeDashboard/HomeDashboard.tsx`
