---
name: adapter-architecture-pattern
description: How the multi-backend adapter system works — AgentAdapter interface, ACP protocol, session resume, and how to add new provider adapters
---

# Multi-Backend Adapter Architecture

Flightdeck supports multiple AI CLI providers (Copilot, Claude, Gemini, Cursor, Codex, OpenCode) through a unified adapter system. All providers use the ACP (Agent Communication Protocol) over stdio. Understanding this architecture is essential when adding new providers, debugging adapter issues, or modifying the agent spawn pipeline.

## Architecture Overview

```
AdapterFactory.createAdapterForProvider(config)
    │
    ├── provider='mock'    → MockAdapter (testing)
    └── all providers      → AcpAdapter (subprocess via ACP stdio)
```

Two adapter backends implement the same `AgentAdapter` interface:

| Backend | Transport | Process Model | Session Resume | Providers |
|---------|-----------|--------------|----------------|-----------|
| **AcpAdapter** | ACP protocol over stdio/ndjson | Subprocess (spawned CLI) | `loadSession()` — best-effort, falls back to `newSession()` | Copilot, Claude, Gemini, OpenCode, Cursor, Codex |
| **MockAdapter** | In-memory | In-process | N/A | Testing only |

## Key Files

```
packages/server/src/adapters/
├── types.ts              # AgentAdapter interface (THE contract)
├── AdapterFactory.ts     # Factory: resolveBackend() + createAdapterForProvider()
├── AcpAdapter.ts         # Subprocess adapter — the single production adapter
├── MockAdapter.ts        # Test adapter
├── presets.ts            # Provider presets (binary, args, env, supportsResume)
├── ModelResolver.ts      # Cross-provider model resolution + tier aliases
├── RoleFileWriter.ts     # Per-provider agent file writers
├── index.ts              # Barrel exports
└── __tests__/            # Test suites
```

## The AgentAdapter Interface

Every adapter must implement this interface (defined in `types.ts`):

```typescript
interface AgentAdapter extends EventEmitter {
  readonly type: string;                        // 'acp' or 'mock'
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

## Pattern: Session Resume

Session resume is handled uniformly via the ACP protocol:

```typescript
// AcpAdapter — best-effort via ACP protocol
try {
  const result = await connection.loadSession({ sessionId });
} catch {
  // Falls back to newSession() — resume silently fails
  const result = await connection.newSession({ cwd });
}
```

Whether resume succeeds depends on the CLI provider's support. Some providers persist full conversation history, others don't. The adapter always falls back gracefully to a fresh session.

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

AcpAdapter translates the CLI's permission model to a common flow:

1. CLI requests permission → adapter emits `'permission_request'` event
2. AgentManager receives event → forwards to UI via WebSocket
3. User approves/rejects → `adapter.resolvePermission(approved)` called
4. Adapter resolves the pending promise → CLI continues/aborts

In autopilot mode, permissions are auto-approved without user interaction.

## How to Add a New Provider

Adding a new ACP-compatible provider requires ~30 lines of configuration:

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

No adapter code changes are needed — the `AcpAdapter` handles all providers via presets.

## Anti-patterns

- **Modifying AcpAdapter for provider-specific logic** — use presets instead
- **Skipping the prompt queue** — concurrent prompts WILL happen (agent messages arrive while prompting)
- **Synchronous permission handling** — always async with timeout
- **Hardcoding provider detection** — use `resolveBackend()` + presets, not if/else chains
