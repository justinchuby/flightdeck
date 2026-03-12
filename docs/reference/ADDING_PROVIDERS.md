# Adding a New CLI Provider

This guide explains how to add a new CLI provider to Flightdeck.

## Prerequisites

Your CLI tool must:
- Support the **ACP (Agent Client Protocol)** via stdio transport
- Accept text prompts and produce text responses
- Be installable as a binary on PATH

## Step 1: Add to the Provider Registry

Edit `packages/shared/src/domain/provider.ts` and add ONE entry to `PROVIDER_REGISTRY`:

```typescript
export const PROVIDER_REGISTRY: Record<ProviderId, ProviderDefinition> = {
  // ... existing providers ...

  myProvider: {
    // Identity
    id: 'myProvider',
    name: 'My Provider',
    icon: '🔮',

    // CLI Configuration
    binary: 'my-provider-cli',      // Binary name on PATH
    args: ['--acp'],                 // Args for ACP stdio mode
    transport: 'stdio',
    requiredEnvVars: ['MY_API_KEY'], // Env vars users must set ([] if none)
    supportsResume: true,            // Does the CLI support session/load RPC?
    modelFlag: '--model',            // CLI flag for model selection (omit if N/A)
    defaultModel: 'my-model-v2',     // Default model when none specified
    agentFileFormat: '.my-provider/agents/*.md',  // Agent file format hint
    modelArgStrategy: 'flag',        // 'flag' | 'config' | 'none'

    // Model Resolution
    nativeModelProviders: ['my-backend'],     // Which model backends this CLI accesses
    tierModels: {
      fast: 'my-model-mini',
      standard: 'my-model-v2',
      premium: 'my-model-pro',
    },

    // Auth
    authCommand: 'my-provider-cli auth status',  // Shell command to verify auth (omit to skip)
    authLabel: 'Authenticated via My Provider',

    // UI
    color: {
      bg: 'bg-rose-500/15',
      text: 'text-rose-400',
      border: 'border-l-rose-500',
      tab: 'text-rose-400 border-rose-400',
    },
    docsUrl: 'https://my-provider.dev/docs',
    setupLinks: [{ label: 'Installation', url: 'https://my-provider.dev/install' }],
    isPreview: true,
  },
};
```

Also add the new ID to the `ProviderId` type union at the top of the file:

```typescript
export type ProviderId = 'copilot' | 'gemini' | 'opencode' | 'cursor' | 'codex' | 'claude' | 'myProvider';
```

## Step 2: Implement a RoleFileWriter (Optional)

If your CLI reads agent instructions from a file (recommended), create a writer class
in `packages/server/src/adapters/RoleFileWriter.ts`:

```typescript
class MyProviderRoleFileWriter implements RoleFileWriter {
  async writeRoleFiles(roles: RoleDefinition[], targetDir: string): Promise<void> {
    // Write files in your CLI's expected format
    // e.g., .my-provider/agents/flightdeck-developer.md
  }

  async cleanRoleFiles(targetDir: string): Promise<void> {
    // Remove files with the FLIGHTDECK_MARKER
  }
}
```

Add it to `WRITER_FACTORIES`:

```typescript
const WRITER_FACTORIES: Record<string, () => RoleFileWriter> = {
  // ... existing writers ...
  myProvider: () => new MyProviderRoleFileWriter(),
};
```

## Step 3: Add Cross-Provider Model Equivalences (Optional)

If your provider's models have equivalents from other providers, add mappings
to the `EQUIVALENCES` table in `packages/server/src/adapters/ModelResolver.ts`:

```typescript
const EQUIVALENCES = {
  // Existing entries...
  'my-model-pro': { anthropic: 'claude-opus-4.6', openai: 'gpt-5.2-codex' },
};
```

## Step 4: Build and Test

```bash
# Build the shared package first (types must be available)
cd packages/shared && npx tsc --build

# Build and test server
cd packages/server && npx tsc --noEmit && npx vitest run

# Build web
cd packages/web && npx tsc --noEmit
```

## What's Automatic

Everything below is derived from your registry entry — **no manual updates needed**:

| Consumer | What It Gets |
|----------|-------------|
| `presets.ts` | CLI preset (binary, args, env, flags) |
| `ModelResolver.ts` | Native providers, tier models, aliases, prefixes |
| `configSchema.ts` | Valid provider ID for config validation |
| `ProviderManager.ts` | Auth command, version detection |
| `AdapterFactory.ts` | Model arg strategy (flag vs config) |
| `providerColors.ts` | Tailwind color classes |
| `SetupWizard.tsx` | Icon, docs URL, preview badge |
| `ProvidersSection.tsx` | Auth label, setup links, env vars, resume support |
| `ModelConfigPanel.tsx` | Tab label and color |
| `ProviderBadge.tsx` | Branded badge colors |

## Architecture

```
packages/shared/src/domain/provider.ts    ← SINGLE SOURCE OF TRUTH
    ↓ import '@flightdeck/shared'
    ├── packages/server/src/adapters/presets.ts         (derives PROVIDER_PRESETS)
    ├── packages/server/src/adapters/ModelResolver.ts   (derives tier maps, aliases)
    ├── packages/server/src/config/configSchema.ts      (derives VALID_PROVIDERS)
    ├── packages/server/src/providers/ProviderManager.ts (derives AUTH_COMMANDS)
    ├── packages/web/src/utils/providerColors.ts        (derives color map)
    ├── packages/web/src/components/SetupWizard.tsx      (derives icons, docs)
    ├── packages/web/src/components/Settings/ProvidersSection.tsx (derives all metadata)
    └── packages/web/src/components/LeadDashboard/ModelConfigPanel.tsx (derives tab labels)
```

## Optional Registry Fields

These fields are only needed for providers with special behavior:

| Field | When to Use | Example |
|-------|-------------|---------|
| `modelAliases` | CLI uses short names for models | Claude: `'claude-opus-4.6' → 'opus'` |
| `modelPrefixes` | CLI requires backend prefix on model names | OpenCode: `anthropic/claude-opus-4-6` |
| `configModelPrefix` | Model passed via config flag, not `--model` | Codex: `['-c', 'model=']` |
| `restrictedModels` | CLI supports a backend but only specific models | Copilot: only `gemini-3-pro-preview` from Google |
| `supportsAgentFlag` | CLI supports `--agent=<name>` for agent selection | Copilot only |
| `authCommand` | Custom auth verification command | Copilot: `gh auth status` |
