---
name: project-id-guarantees
description: How project IDs are guaranteed in the flightdeck system — all spawn paths and fallback mechanisms
---

# Project ID Guarantees

Every project must have a valid UUID. The system enforces this through multiple layers.

## Spawn Paths

| Path | How projectId is assigned |
|------|--------------------------|
| `POST /lead/start` | Creates project via ProjectRegistry |
| `POST /agents` (lead role) | Auto-creates project for lead agents |
| `POST /projects/:id/resume` | Uses existing project ID |
| `POST /sessions/:id/resume` | Uses existing session's project ID |

## Safety Net

`AgentManager.spawn()` has a 4-layer fallback:

1. **Layer 1**: Explicit `projectId` from spawn options
2. **Layer 2**: `effectiveProjectId` inherited from parent chain
3. **Layer 3**: Parent assignment fallback for child agents
4. **Layer 4**: Root agent fallback — generates a new UUID for any root agent without a projectId

Child agents always inherit from their parent chain.

## Backward Compatibility

For older data that may be missing `projectId`, use fallback patterns:

```typescript
// Prefer projectId, fall back to agent id
const id = lead.projectId || lead.id;

// Return empty arrays instead of crashing
const activities = projectId ? getByProject(projectId) : [];
```

Always use graceful degradation rather than crashing when projectId is missing.
