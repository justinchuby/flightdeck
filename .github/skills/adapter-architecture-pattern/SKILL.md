---
name: adapter-architecture-pattern
description: How the multi-backend adapter system works — AgentAdapter interface, SDK vs ACP patterns, lazy loading, session resume, and how to add new provider adapters
---

# Multi-Backend Adapter Architecture

Flightdeck supports multiple AI CLI providers (Copilot, Claude, Gemini, Cursor, Codex, OpenCode) through a layered adapter system. Understanding this architecture is essential when adding new providers, debugging adapter issues, or modifying the agent spawn pipeline.

## Architecture Overview

```
AdapterFactory.createAdapterForProvider(config)
    │
    ├── provider='mock'    → MockAdapter (testing)
    ├── provider='claude'  → ClaudeSdkAdapter (in-process SDK)
    ├── provider='copilot' → CopilotSdkAdapter (JSON-RPC SDK)
    └── all others         → AcpAdapter (subprocess via stdio)
```

Three adapter backends implement the same `AgentAdapter` interface:

| Backend | Transport | Process Model | Session Resume | Providers |
|---------|-----------|--------------|----------------|-----------|
| **AcpAdapter** | ACP protocol over stdio/ndjson | Subprocess (spawned CLI) | `loadSession()` — best-effort, falls back to newSession | Copilot, Gemini, OpenCode, Cursor, Codex, Claude |
| **ClaudeSdkAdapter** | `@anthropic-ai/claude-agent-sdk` | In-process (SDK runs in server) | `query({ resume: sessionId })` — explicit, reliable | Claude only |
| **CopilotSdkAdapter** | `@github/copilot-sdk` JSON-RPC | SDK spawns CLI as JSON-RPC server | `client.resumeSession(id, config)` — explicit, reliable | Copilot only |

## Key Files

```
packages/server/src/adapters/
├── types.ts              # AgentAdapter interface (THE contract)
├── AdapterFactory.ts     # Factory: resolveBackend() + createAdapterForProvider()
├── AcpAdapter.ts         # Subprocess adapter (~417 LOC)
├── ClaudeSdkAdapter.ts   # Claude in-process adapter (~426 LOC)
├── CopilotSdkAdapter.ts  # Copilot JSON-RPC adapter (~450-550 LOC)
├── MockAdapter.ts        # Test adapter
├── presets.ts            # Provider presets (binary, args, env, supportsResume)
├── ModelResolver.ts      # Cross-provider model resolution + tier aliases
├── RoleFileWriter.ts     # Per-provider agent file writers
├── claude-agent-sdk.d.ts # Hand-written type stubs for Claude SDK
├── claude-sdk-types.ts   # Exported Claude SDK types
├── index.ts              # Barrel exports
└── __tests__/            # Test suites
```

## The AgentAdapter Interface

Every adapter must implement this interface (defined in `types.ts`):

```typescript
interface AgentAdapter extends EventEmitter {
  readonly type: string;                        // 'acp', 'claude-sdk', 'copilot-sdk', 'mock'
  readonly isConnected: boolean;
  readonly isPrompting: boolean;
  readonly promptingStartedAt: number | null;
  readonly currentSessionId: string | null;
  readonly supportsImages: boolean;

  start(opts: AdapterStartOptions): Promise<string>;  // Returns sessionId
  prompt(content: PromptContent, opts?: PromptOptions): Promise<PromptResult>;
  cancel(): Promise<void>;
  terminate(): void;
  resolvePermission(approved: boolean): void;
}
```

### Events emitted by all adapters

- `'connected'` (sessionId) — adapter ready
- `'text'` (string) — assistant output text
- `'thinking'` (string) — reasoning/thinking output
- `'tool_call'` (ToolCallInfo) — tool execution started
- `'tool_call_update'` (ToolUpdateInfo) — tool execution completed/failed
- `'usage'` (UsageInfo) — token usage report
- `'prompting'` (boolean) — prompt in progress
- `'prompt_complete'` (StopReason) — prompt finished
- `'response_start'` — new response beginning
- `'permission_request'` (PermissionRequest) — needs user approval
- `'idle'` — ready for next prompt
- `'exit'` (code) — adapter terminated

## Pattern: Lazy SDK Loading

**CRITICAL**: SDK imports MUST be lazy (dynamic `import()`) — never at module level. This ensures:
1. Server compiles and starts without any SDK installed
2. SDK only loads when that specific adapter is configured
3. Clear error message if SDK is missing at runtime

```typescript
// ✅ CORRECT — lazy load in start() or a helper
let sdkModule: SdkType | null = null;
async function loadSdk() {
  if (sdkModule) return sdkModule;
  try {
    const mod = await import('@some/sdk');
    sdkModule = mod;
    return sdkModule;
  } catch {
    throw new Error('SDK not installed. Run: npm install @some/sdk');
  }
}

// ❌ WRONG — eager import blocks server startup
import * as sdk from '@some/sdk';  // Fails if SDK not installed
```

Both SDK packages are `optionalDependencies` in package.json — npm installs them if available, skips gracefully if not.

## Pattern: Session Resume

Session resume is the #1 reason for SDK adapters over ACP. Each adapter handles it differently:

```typescript
// AcpAdapter — best-effort via ACP protocol
try {
  const result = await connection.loadSession({ sessionId });
} catch {
  // Falls back to newSession() — resume silently fails
  const result = await connection.newSession({ cwd });
}

// ClaudeSdkAdapter — explicit via SDK query option
const query = sdk.query(prompt, { resume: sessionId, cwd, model });

// CopilotSdkAdapter — explicit via client API
const session = await client.resumeSession(sessionId, { model, onPermissionRequest });
```

The `SessionResumeManager` (in `packages/server/src/agents/`) orchestrates resume on server startup. It reads the agent roster, checks `preset.supportsResume`, and passes `sessionId` through `AdapterStartOptions`.

## Pattern: Prompt Queue

All adapters share the same concurrent prompt handling:

```typescript
async prompt(content, opts?) {
  if (this._isPrompting) {
    // Queue the prompt — only one active prompt at a time
    if (opts?.priority) {
      this.promptQueue.splice(this.promptQueuePriorityCount, 0, content);
      this.promptQueuePriorityCount++;
    } else {
      this.promptQueue.push(content);
    }
    return { stopReason: 'end_turn' };
  }
  // ... execute prompt, then drainQueue() on completion
}
```

## Pattern: Permission Handling

All adapters translate their SDK's permission model to a common flow:

1. SDK requests permission → adapter emits `'permission_request'` event
2. AgentManager receives event → forwards to UI via WebSocket
3. User approves/rejects → `adapter.resolvePermission(approved)` called
4. Adapter resolves the pending promise → SDK continues/aborts

In autopilot mode, permissions are auto-approved without user interaction.

## Pattern: ACP Fallback

The factory provides automatic fallback from SDK to ACP:

```typescript
if (preferredBackend === 'copilot-sdk') {
  try {
    const adapter = new CopilotSdkAdapter({ autopilot, model });
    return { adapter, backend: 'copilot-sdk', fallback: false };
  } catch {
    // SDK unavailable — fall back to ACP (always works)
    const adapter = new AcpAdapter({ autopilot });
    return { adapter, backend: 'acp', fallback: true, fallbackReason: '...' };
  }
}
```

The `AdapterResult.fallback` flag lets consumers know when fallback occurred.

## How to Add a New Provider

### Option A: ACP-only (simplest — ~30 LOC)

If the provider's CLI supports ACP stdio protocol:

1. Add a preset to `presets.ts`:
```typescript
myProvider: {
  id: 'myProvider',
  name: 'My Provider',
  binary: 'my-cli',
  args: ['--acp', '--stdio'],
  transport: 'stdio',
  supportsResume: false,
  modelFlag: '--model',
  defaultModel: 'my-model-v1',
}
```

2. Add the provider ID to the `ProviderId` union type
3. Optionally add a `RoleFileWriter` if the provider uses agent files
4. Add model mappings to `ModelResolver.ts` if needed

### Option B: Native SDK adapter (~400-550 LOC)

If the provider has a programmatic SDK with session resume:

1. Create `MyProviderSdkAdapter.ts` — implement `AgentAdapter` interface
2. Use lazy `import()` for the SDK
3. Add the SDK as an `optionalDependency`
4. Add a `'my-provider-sdk'` case to `resolveBackend()` and `createAdapterForProvider()`
5. Export from `index.ts`
6. Write tests (~500-700 LOC)

Use `ClaudeSdkAdapter.ts` (async iterator pattern) or `CopilotSdkAdapter.ts` (event callback pattern) as your template depending on the SDK's API style.

## Anti-patterns

- **Eager SDK imports** — breaks server startup when SDK not installed
- **Modifying AcpAdapter for provider-specific logic** — use presets instead
- **Skipping the prompt queue** — concurrent prompts WILL happen (agent messages arrive while prompting)
- **Synchronous permission handling** — always async with timeout
- **Hardcoding provider detection** — use `resolveBackend()` + presets, not if/else chains
