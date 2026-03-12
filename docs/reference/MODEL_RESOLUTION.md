# Model Resolution & Fallback System

How Flightdeck resolves model names across providers and handles cross-provider fallback.

**Key File:** `packages/server/src/adapters/ModelResolver.ts`

## Architecture: Two-Layer Resolution

Model resolution happens in two layers:

### Layer 1: Project Allowlist (AgentManager)
`AgentManager.resolveModelForRole()` checks the project's model configuration to determine which model a role should use, based on the project allowlist and role-specific overrides.

### Layer 2: CLI Provider Mapping (ModelResolver)
`ModelResolver.resolveModel()` translates model names for the target CLI provider, handling cross-provider equivalence, tier aliases, and restricted models.

## resolveModel API

```typescript
function resolveModel(
  modelSpec: string | undefined,
  provider: ProviderId
): ModelResolution | undefined;

interface ModelResolution {
  /** The resolved model name to pass to the CLI */
  model: string;
  /** Whether the model was translated (not a passthrough) */
  translated: boolean;
  /** Original model name before resolution */
  original: string;
  /** Human-readable reason for the resolution */
  reason?: string;
}
```

### Resolution Pipeline

1. **Tier aliases** — `fast`, `standard`, `premium` map to provider-specific models
   - Example: `fast` on copilot → `claude-haiku-4.5`
   - Reason: `"tier 'fast' → claude-haiku-4.5"`

2. **Claude aliases** — Simplified names for Claude CLI compatibility
   - Example: `claude-sonnet-4.6` on claude → `sonnet`
   - Reason: `"alias for Claude CLI"`

3. **OpenCode prefix** — Adds provider prefix for opencode
   - Example: `claude-sonnet-4.6` on opencode → `anthropic:claude-sonnet-4.6`
   - Reason: `"OpenCode provider prefix"`

4. **Native provider check** — If model is natively supported, pass through
   - `translated: false`, no reason needed

5. **Cross-provider equivalence** — Map to closest equivalent on target provider
   - Example: `claude-sonnet-4.6` on codex → `gpt-5.3-codex`
   - Reason: `"claude-sonnet-4.6 → gpt-5.3-codex (copilot equivalent)"`

6. **Fallback** — If no mapping exists, fall back to standard tier
   - Reason: `"unmapped model, fell back to standard tier"`

### The `translated` Flag

- `true` — Model was transformed (tier alias, cross-provider mapping, prefix addition, or fallback)
- `false` — Model name passed through unchanged (native support)

This flag is used to detect when a fallback occurred, enabling notifications to the user/lead.

## Per-Provider Model Scoping

### CLI_NATIVE_PROVIDERS

Maps each CLI provider to the model families it natively supports:

```typescript
const CLI_NATIVE_PROVIDERS: Record<ProviderId, string[]> = {
  copilot: ['anthropic', 'openai', 'google'],  // With restrictions
  claude: ['anthropic'],
  gemini: ['google'],
  cursor: ['anthropic', 'openai', 'google'],
  codex: ['openai'],
  opencode: ['anthropic', 'openai', 'google'],
};
```

### CLI_RESTRICTED_MODELS

Restricts specific model families within a provider:

```typescript
const CLI_RESTRICTED_MODELS = {
  copilot: {
    google: new Set(['gemini-3-pro-preview']),
    // Copilot only supports gemini-3-pro-preview from Google's catalog
  },
};
```

### getModelsForProvider

```typescript
function getModelsForProvider(provider: ProviderId): string[]
```

Returns the list of model IDs natively supported by a provider:
- Filters all known models by `CLI_NATIVE_PROVIDERS[provider]`
- Excludes models blocked by `CLI_RESTRICTED_MODELS`
- Uses `detectModelProvider()` to match model prefix → family

Example returns:
- `getModelsForProvider('copilot')` → Claude models + GPT models + `gemini-3-pro-preview` only
- `getModelsForProvider('gemini')` → `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-3-pro-preview`
- `getModelsForProvider('codex')` → GPT/Codex models only

### getModelsByProvider

```typescript
function getModelsByProvider(): Record<string, string[]>
```

Returns all providers mapped to their supported models. Used by the `GET /models` endpoint.

## API Endpoint

**`GET /models`** (`packages/server/src/routes/projects.ts`)

```json
{
  "models": ["claude-opus-4.6", "claude-sonnet-4.6", ...],
  "defaults": { ... },
  "modelsByProvider": {
    "copilot": ["claude-opus-4.6", "claude-sonnet-4.6", ..., "gemini-3-pro-preview"],
    "claude": ["claude-opus-4.6", "claude-sonnet-4.6", "claude-haiku-4.5"],
    "gemini": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3-pro-preview"],
    "codex": ["gpt-5.4", "gpt-5.3-codex", ...],
    ...
  }
}
```

The `modelsByProvider` field enables the frontend ModelConfigPanel to show only relevant models per provider tab.

## Model Fallback Notification (Planned)

When `resolveModel()` returns `translated: true`, the system should:

1. **Lead notification** — Send a system message to the lead agent: `"Model claude-opus-4.6 not available on Gemini provider. Fell back to gemini-2.5-pro."`
2. **UI notification** — Show a toast to the human user with the same info
3. **Agent metadata** — Store both `requestedModel` and `resolvedModel` in agent metadata so the UI can show what was actually used

See `.flightdeck/shared/architect-4781366a/model-fallback-notifications.md` for the full design.
