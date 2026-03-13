# Provider Config Dual-System and Bridging

**When to use**: When debugging provider selection, fallback behavior, or config persistence issues. Also when adding new provider-related settings.

## The Two Config Systems

Flightdeck has two independent config systems that both store provider settings:

### 1. ServerConfig (startup config)
- **File**: `packages/server/src/config.ts`
- Set at startup from env vars and YAML (`flightdeck.config.yaml`)
- Immutable after boot — lives in `container.config`
- Fields: `provider`, `cliCommand`, `cliArgs`, `maxConcurrentAgents`, `dbPath`
- Used by: agent spawning, CLI adapter selection

### 2. ConfigStore (runtime config)
- **File**: `packages/server/src/config/ConfigStore.ts`
- Persisted to DB via `config` table (key-value pairs)
- Mutable at runtime via `PUT /settings` API
- Fields: `activeProviderId`, `activeModelId`, `binaryOverride`, `argsOverride`, `envOverride`, `cloudProvider`
- Used by: UI settings panel, ProviderManager

## The Bridging Problem

These two systems can disagree. A user sets `provider: claude` in YAML, but ConfigStore still has `activeProviderId: copilot` from a previous session. Which wins?

### Current Bridge (container.ts)
At startup, `container.ts` bridges YAML → ConfigStore:
```typescript
// packages/server/src/container.ts — inside createContainer()
if (yamlProvider && yamlProvider !== currentStored) {
  configStore.writePartial({ activeProviderId: yamlProvider });
}
```
This runs once at boot. A hot-reload handler also exists for YAML file changes.

## Gotchas

1. **Override leak on provider switch**: When `writePartial({ activeProviderId: newProvider })` is called, it only updates the provider ID. Old overrides (`binaryOverride`, `argsOverride`, `envOverride`, `cloudProvider`) from the previous provider persist and may break the new one. The fix is to clear overrides when switching:
   ```typescript
   configStore.writePartial({
     activeProviderId: newProvider,
     binaryOverride: null,
     argsOverride: null,
     envOverride: null,
     cloudProvider: null,
   });
   ```

2. **Provider availability vs configuration**: A provider can be configured but not installed (binary missing). `ProviderManager.resolveAvailableProvider()` handles this by falling back to the first installed provider.

3. **Agent-level provider**: Each agent stores its own `provider` field in the `agent_roster` DB table. This is set at spawn time and should inherit from the parent agent during delegation (see `AgentLifecycle.ts:100-104`).

## Key Files

| File | What it does |
|------|-------------|
| `packages/server/src/config.ts` | ServerConfig defaults, YAML loading, env var resolution |
| `packages/server/src/config/ConfigStore.ts` | Runtime DB-persisted config (key-value) |
| `packages/server/src/container.ts` | Bridge: syncs YAML provider → ConfigStore at startup |
| `packages/server/src/providers/ProviderManager.ts` | Provider resolution, fallback logic, `getActiveProviderId()` |
