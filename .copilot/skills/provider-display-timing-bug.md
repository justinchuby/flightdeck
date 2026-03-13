# Provider Display Timing Bug: Roster Written Before ACP Sets Provider

**Description:** Use when debugging agents showing wrong or missing provider in the UI, or when modifying agent spawn/roster logic.

## The Bug

When an agent spawns, the sequence is:
1. `AgentManager.spawn()` creates the Agent object
2. Initial roster DB upsert writes agent metadata (including `provider` field)
3. `startAcp()` runs — this is where the ACP bridge resolves the actual provider
4. `onSessionReady` fires after ACP connects

The problem: step 2 writes the roster **before** step 3 sets `agent.provider`. So the DB row has `provider: null` and the UI shows no provider badge.

## The Fix (Two Parts)

### Part 1: Default from ServerConfig before initial roster write

In AgentManager, before the first roster upsert:
```typescript
if (!agent.provider && this.config.provider) {
  agent.provider = this.config.provider;
}
```

### Part 2: Re-upsert in onSessionReady after ACP resolves

In the `onSessionReady` handler (fires after `startAcp` completes):
```typescript
this.roster.upsert(agent);  // Now agent.provider is set correctly
```

## Key Insight

Any time you see a timing issue where data is written to DB/UI before an async operation sets the correct value, the pattern is:
1. Set a reasonable default before the first write
2. Re-write after the async operation completes with the real value

## Related Files

- `packages/server/src/agents/AgentManager.ts` — spawn logic, onSessionReady handler
- `packages/server/src/adapters/AgentAcpBridge.ts` — line ~152 where `agent.provider` is set in `startAcp()`
- The roster DB is the source of truth for the web UI's agent cards
