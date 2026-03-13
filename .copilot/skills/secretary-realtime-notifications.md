# Secretary Agent: Real-Time Notifications via notifySecretary()

## When to use
When adding a new command or event that changes the task DAG and the secretary should know about it immediately (not wait for the 3-minute ContextRefresher poll).

## The Pattern

Use the `notifySecretary()` helper to send a system message to the secretary agent:

```typescript
import { notifySecretary } from './secretaryNotifier.js';

// After a DAG-changing event:
notifySecretary(ctx, leadId, `[System] Task "${taskId}" completed by ${role} (${agentId}): ${summary}`);
```

### How it works:
1. Finds the secretary agent for the given lead (`parentId === leadId && role.id === 'secretary'`)
2. Skips terminated/failed/completed secretaries
3. Calls `secretary.sendMessage()` to deliver immediately
4. No-ops silently if no secretary exists (not all sessions have one)

### Where it's used (all 4 DAG event paths):
| Event | File | Location |
|-------|------|----------|
| Task completed | `TaskCommands.ts` | After `ctx.emit('dag:updated')` in COMPLETE_TASK |
| Task assigned | `TaskCommands.ts` | After `ctx.emit('dag:updated')` in ASSIGN_TASK |
| Task reassigned | `TaskCommands.ts` | After reassignment in REASSIGN_TASK |
| Task delegated | `AgentLifecycle.ts` | After `ctx.emit('agent:delegated')` in DELEGATE and CREATE_AGENT |

### Message format conventions:
```
[System] Task "{taskId}" completed by {roleName} ({shortAgentId}): {summary}
[System] Task "{taskId}" assigned to {roleName} ({shortAgentId})
[System] Task "{taskId}" reassigned from @{oldShortId} to {roleName} ({newShortId})
[System] Task delegated to {roleName} ({shortAgentId}): {taskDescription}
```

### Finding the secretary (reusable pattern):
```typescript
const secretary = ctx.getAllAgents().find(a =>
  a.parentId === leadId &&
  a.role.id === 'secretary' &&
  a.status !== 'terminated' && a.status !== 'failed' && a.status !== 'completed'
);
```

This same pattern is used by `requestSecretaryDependencyAnalysis()` in `AgentLifecycle.ts` (line 769) for a different purpose (requesting dependency analysis for auto-DAG tasks).

## Files
- Helper: `packages/server/src/agents/commands/secretaryNotifier.ts`
- Tests: `packages/server/src/__tests__/secretaryNotifier.test.ts`
- Related: `packages/server/src/coordination/agents/ContextRefresher.ts` (3-minute polling fallback)
