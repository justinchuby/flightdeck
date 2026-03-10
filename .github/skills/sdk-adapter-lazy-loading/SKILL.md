---
name: sdk-adapter-lazy-loading
description: How and why SDK adapters use lazy dynamic imports. Use when adding new SDK adapters, debugging import errors, or modifying the adapter factory.
---

# SDK Adapter Lazy Loading

All SDK adapters in Flightdeck use lazy dynamic `import()` instead of top-level static imports. This is a hard requirement — not a preference.

## Why Lazy Loading is Required

Flightdeck supports multiple AI CLI providers (Claude, Copilot, Gemini, etc.), but most users only install one SDK. If any adapter used a static `import`, the server would crash on startup for every user who doesn't have that SDK installed.

```
User installs Flightdeck + @anthropic-ai/claude-agent-sdk
  → Server starts ✅
  → ClaudeSdkAdapter loads ✅
  → CopilotSdkAdapter import fails ❌ → SERVER CRASHES (if static import)
```

With lazy imports, the server compiles and starts cleanly. The SDK only loads when someone actually configures that adapter.

## Pattern

### Module-Level Cache + Lazy Loader

```typescript
// ✅ CORRECT — lazy load with cache
let sdkModule: typeof import('@some/sdk') | null = null;

async function loadSdk(): Promise<typeof import('@some/sdk')> {
  if (sdkModule) return sdkModule;
  try {
    sdkModule = await import('@some/sdk');
    return sdkModule;
  } catch (error) {
    throw new Error(
      '@some/sdk is not installed. Install it with: npm install @some/sdk'
    );
  }
}

// Use in adapter start()
class MySdkAdapter implements AgentAdapter {
  async start(opts: AdapterStartOptions): Promise<string> {
    const sdk = await loadSdk();
    // Now use sdk.createClient(), sdk.query(), etc.
  }
}
```

### Package.json Configuration

SDK packages are listed as `optionalDependencies`, not `dependencies`:

```json
{
  "optionalDependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.71",
    "@github/copilot-sdk": "^0.1.32"
  }
}
```

This tells npm to install them if available but not fail the install if they're missing (e.g., due to platform incompatibility or private registry).

## Key Files

```
packages/server/src/adapters/
├── ClaudeSdkAdapter.ts   → loadClaudeSdk() at top, called in start()
├── CopilotSdkAdapter.ts  → loadCopilotSdk() at top, called in start()
├── AdapterFactory.ts     → resolveBackend() picks adapter, lazy load happens inside
```

## Adding a New SDK Adapter

1. Create `MyProviderSdkAdapter.ts` with a `loadSdk()` function at module level
2. Add the SDK to `optionalDependencies` in `packages/server/package.json`
3. Add a type declaration file if the SDK lacks TypeScript types
4. Add the adapter to `AdapterFactory.resolveBackend()` and `createAdapterForProvider()`
5. Test that the server starts without the SDK installed

## Anti-patterns

- **Static imports of SDK packages** — Breaks server startup for users without that SDK
- **Importing SDK types at runtime** — Type imports (`import type { X }`) are fine (erased at compile time), but value imports must be lazy
- **Missing error message** — Always tell the user which package to install and how
- **No module-level cache** — Without caching, every `start()` call re-imports the SDK
