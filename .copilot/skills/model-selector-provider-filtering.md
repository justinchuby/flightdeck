# Model Selector: Provider-Filtered Model Lists

**When to use:** When adding or modifying model selector dropdowns, or when working with the provider system and model availability.

## The Problem

All model dropdowns showed all 21 models across all providers (copilot, claude, gemini, etc.), but users can only use models from the active provider. Selecting a model from a different provider would silently fail.

## The Solution: useModels Hook with filteredModels

The `useModels()` hook now returns both the full model list and a filtered list:

```typescript
const {
  models,          // All 21 models (for config panels that need the full list)
  filteredModels,  // Only models from the active provider (for selectors)
  activeProvider,  // e.g. 'claude', 'copilot', 'gemini'
  modelsByProvider, // { claude: [...], copilot: [...], ... }
  modelName,       // (id: string) => display name
} = useModels();
```

### For model selector dropdowns, always use `filteredModels`:

```tsx
const { filteredModels: availableModels } = useModels();

<select>
  <option value="">Default</option>
  {availableModels.map((m) => (
    <option key={m} value={m}>{deriveModelName(m)}</option>
  ))}
</select>
```

### For config panels that need ALL models (e.g. ModelConfigPanel), use `models`:

```tsx
const { models: allModels } = useModels();
```

## Key Files

| Component | File | Purpose |
|-----------|------|---------|
| Hook | `packages/web/src/hooks/useModels.ts` | Single source of truth for model data |
| Backend | `packages/server/src/routes/projects.ts` ~line 934 | `GET /models` returns `activeProvider` |
| Provider registry | `packages/shared/src/domain/provider.ts` | PROVIDER_REGISTRY with model-to-provider mapping |
| Provider manager | `packages/server/src/providers/ProviderManager.ts` | `getActiveProviderId()` resolves active provider |

## Backend Response Shape

```json
{
  "models": ["claude-opus-4.6", "claude-sonnet-4.6", "gpt-5.1", ...],
  "defaults": { "lead": ["claude-opus-4.6"], "developer": [...] },
  "modelsByProvider": {
    "claude": ["claude-opus-4.6", "claude-sonnet-4.6", "claude-haiku-4.5"],
    "copilot": ["gpt-5.1", "gpt-5.2", ...],
    "gemini": ["gemini-3-pro-preview"]
  },
  "activeProvider": "claude"
}
```

## Filtering Logic

In the hook, `filteredModels` is computed as:

```typescript
const providerModels = cachedData?.modelsByProvider[activeProvider];
const filteredModels = providerModels
  ? models.filter((m) => providerModels.includes(m))
  : models;  // fallback: show all if provider not found
```

## Components Using Model Selectors

These use `filteredModels` (updated):
- `NewProjectModal.tsx` — new project creation
- `NewSessionDialog.tsx` — new session within a project
- `SpawnDialog.tsx` — spawning a new agent

These still use unfiltered `models` (could be updated):
- `AgentCard.tsx`, `CrewRoster.tsx`, `AgentActivityTable.tsx`, `AgentDetailPanel.tsx` — model switching on running agents

## Gotchas

- `ModelConfigPanel.tsx` fetches from `/models` directly (not via the hook) and needs ALL models — don't filter there
- The hook uses module-level caching — data is fetched once and shared across all consumers
- `_resetModelsCache()` is exported for tests to clear the singleton cache between test cases
- If `activeProvider` isn't in `modelsByProvider`, the fallback shows all models (safe degradation)
