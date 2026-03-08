# R9: ACP Adapter Abstraction Layer — Implementation Spec

**Author:** Developer agent 903df314  
**Status:** ✅ **Implemented** (2026-03-07)
**Inspired by:** Paperclip's multi-adapter plugin system, Squad's `CopilotSessionAdapter`

---

## 1. Problem Statement

`AcpConnection.ts` (397 LoC) directly imports and uses `@agentclientprotocol/sdk` v0.14.x types throughout. The ACP SDK is pre-1.0 and changing rapidly. SDK types (`ContentBlock`, `StopReason`, `ToolKind`, etc.) leak into routes, agents, and the bridge layer. When the SDK ships breaking changes, fixes ripple across 5+ files.

**Goal:** Introduce an adapter interface that isolates the server from SDK-specific types and enables future support for alternative agent backends (direct API calls, local models, non-ACP runtimes).

---

## 2. Current ACP SDK Touchpoints

### 2.1 Direct SDK Imports (3 files)

| File | Import | Usage |
|------|--------|-------|
| `packages/server/src/acp/AcpConnection.ts` | `import * as acp from '@agentclientprotocol/sdk'` | Full SDK namespace: `ClientSideConnection`, `ndJsonStream`, `PROTOCOL_VERSION`, event types |
| `packages/server/src/routes/agents.ts` | `import type { ContentBlock } from '@agentclientprotocol/sdk'` | Building prompt content blocks for agent messages |
| `packages/server/src/routes/lead.ts` | `import type { ContentBlock } from '@agentclientprotocol/sdk'` | Building prompt content blocks for lead messages |

### 2.2 SDK Method Calls (in AcpConnection.ts)

| Method | Lines | Purpose |
|--------|-------|---------|
| `acp.ndJsonStream(output, input)` | 152-154 | Create bidirectional NDJSON stream from stdio |
| `new acp.ClientSideConnection(clientFn, stream)` | 264 | Instantiate the SDK connection |
| `connection.initialize({...})` | 265-268 | Protocol handshake |
| `connection.newSession({...})` | 83-87 | Create agent session |
| `connection.prompt({sessionId, prompt})` | 304-308 | Send message to agent |
| `connection.cancel({sessionId})` | 381-385 | Cancel in-flight prompt |
| `connection.terminate()` | 390 | Graceful shutdown |

### 2.3 SDK Types Used Across Codebase

| Type | Where Used | Purpose |
|------|-----------|---------|
| `ContentBlock` | Agent.ts, routes/agents.ts, routes/lead.ts, AcpConnection.ts | Message content format |
| `StopReason` | AcpConnection.ts return types | Why agent stopped responding |
| `ToolKind`, `ToolCallStatus`, `ToolCallContent` | AcpConnection.ts events | Tool call lifecycle |
| `PlanEntryPriority`, `PlanEntryStatus` | AcpConnection.ts events | Agent planning |
| `AgentCapabilities` | AcpConnection.ts | Feature detection |
| `PermissionOption`, `RequestPermissionResponse` | AcpConnection.ts | Permission flow |

### 2.4 Event Flow

```
AcpConnection (SDK events via sessionUpdate callback)
  → emits normalized events (text, thinking, tool_call, usage, content, plan)
    → AgentAcpBridge.wireAcpEvents() listens
      → Agent properties updated + WebSocket forwarding
```

**Key insight:** `AcpConnection` already partially normalizes SDK events into simpler internal events. The adapter layer formalizes this boundary.

### 2.5 Bridge Layer (AgentAcpBridge.ts)

- `startAcp()` — Creates `AcpConnection`, wires events, spawns CLI process
- `wireAcpEvents()` — Maps AcpConnection events → Agent state updates
- Handles model selection, CLI args, session resumption
- This is the natural place to swap adapter implementations

---

## 3. Adapter Interface Design

### 3.1 Core Interface: `AgentAdapter`

```typescript
// packages/server/src/adapters/types.ts

export interface AgentAdapter extends EventEmitter {
  /** Unique adapter type identifier */
  readonly type: string;

  /** Start the agent process and establish connection */
  start(opts: AdapterStartOptions): Promise<string>; // returns sessionId

  /** Send a prompt to the agent */
  prompt(content: PromptContent, opts?: PromptOptions): Promise<PromptResult>;

  /** Cancel the current in-flight prompt */
  cancel(): Promise<void>;

  /** Gracefully terminate the agent */
  terminate(): Promise<void>;

  /** Force-kill the agent process */
  kill(): void;

  /** Whether the adapter is currently connected */
  readonly isConnected: boolean;

  /** Whether a prompt is currently in-flight */
  readonly isPrompting: boolean;

  /** Agent capabilities detected during initialization */
  readonly capabilities: AdapterCapabilities | null;
}
```

### 3.2 Stable Internal Types (SDK-independent)

```typescript
// packages/server/src/adapters/types.ts

/** Content that can be sent as a prompt */
export type PromptContent = string | ContentBlock[];

export interface ContentBlock {
  type: 'text' | 'image' | 'resource' | 'audio';
  text?: string;
  data?: string;        // base64 for binary content
  uri?: string;
  mimeType?: string;
}

export interface PromptResult {
  stopReason: StopReason;
  usage?: UsageInfo;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error';

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
}

export interface AdapterStartOptions {
  cliCommand: string;
  cliArgs?: string[];
  cwd?: string;
}

export interface PromptOptions {
  priority?: boolean;
}

export interface AdapterCapabilities {
  supportsImages: boolean;
  supportsMcp: boolean;
  supportsPlans: boolean;
}
```

### 3.3 Adapter Events (stable contract)

```typescript
// Events emitted by AgentAdapter — these are the stable internal events
// that Agent/Bridge code listens to. They do NOT change when the SDK changes.

interface AdapterEvents {
  'connected': (sessionId: string) => void;
  'text': (text: string) => void;
  'thinking': (text: string) => void;
  'content': (block: ContentBlock) => void;
  'tool_call': (info: ToolCallInfo) => void;
  'tool_update': (info: ToolUpdateInfo) => void;
  'usage': (usage: UsageInfo) => void;
  'plan': (entries: PlanEntry[]) => void;
  'prompting': (active: boolean) => void;
  'prompt_complete': (reason: string) => void;
  'response_start': () => void;
  'idle': () => void;
  'exit': (code: number) => void;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  kind: 'tool' | 'bash' | 'file_edit' | 'browser' | 'mcp' | 'unknown';
  status: 'running' | 'completed' | 'errored';
  content?: string;
}

export interface ToolUpdateInfo {
  id: string;
  status: 'running' | 'completed' | 'errored';
  content?: string;
}

export interface PlanEntry {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'high' | 'medium' | 'low';
}
```

### 3.4 Permission Handler (injected callback)

```typescript
export interface PermissionRequest {
  resource: string;
  operation: string;
  reason?: string;
}

export type PermissionHandler = (req: PermissionRequest) => Promise<PermissionResponse>;

export interface PermissionResponse {
  granted: boolean;
  updatedPermissions?: Record<string, string>;
}
```

---

## 4. Adapter Implementations

### 4.1 `AcpAdapter` (default — wraps current AcpConnection)

```typescript
// packages/server/src/adapters/AcpAdapter.ts

import * as acp from '@agentclientprotocol/sdk';
import { AgentAdapter, ... } from './types.js';

export class AcpAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'acp';
  
  // All ACP SDK usage is contained HERE.
  // Translates acp.ContentBlock → internal ContentBlock
  // Translates acp.StopReason → internal StopReason
  // etc.
}
```

This is a refactored `AcpConnection.ts` that:
- Implements `AgentAdapter` interface
- Keeps all `@agentclientprotocol/sdk` imports contained within this single file
- Translates SDK types to/from stable internal types at the boundary

### 4.2 `MockAdapter` (for testing)

```typescript
// packages/server/src/adapters/MockAdapter.ts

export class MockAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'mock';
  
  // Programmable responses for testing
  prompt(content: PromptContent): Promise<PromptResult> {
    const response = this.nextResponse ?? { stopReason: 'end_turn' };
    this.emit('text', this.nextText ?? '');
    this.emit('idle');
    return Promise.resolve(response);
  }
  
  // Test helpers
  simulateText(text: string): void { this.emit('text', text); }
  simulateToolCall(info: ToolCallInfo): void { this.emit('tool_call', info); }
  simulateExit(code: number): void { this.emit('exit', code); }
}
```

### 4.3 Future: `DirectApiAdapter` (direct LLM API calls without ACP)

Not in scope for R9, but the interface supports it. A `DirectApiAdapter` would call the Anthropic/OpenAI APIs directly, handling its own tool execution loop. This enables running agents without the Copilot CLI.

---

## 5. Files to Create/Modify

### 5.1 New Files

| File | Purpose |
|------|---------|
| `packages/server/src/adapters/types.ts` | All adapter interfaces, internal event types, stable content types |
| `packages/server/src/adapters/AcpAdapter.ts` | Refactored AcpConnection implementing AgentAdapter (the only file importing `@agentclientprotocol/sdk`) |
| `packages/server/src/adapters/MockAdapter.ts` | Test adapter with programmable responses |
| `packages/server/src/adapters/index.ts` | Barrel export |
| `packages/server/src/adapters/__tests__/AcpAdapter.test.ts` | Tests for ACP type translation |
| `packages/server/src/adapters/__tests__/MockAdapter.test.ts` | Tests for mock adapter behavior |

### 5.2 Modified Files

| File | Change |
|------|--------|
| `packages/server/src/acp/AcpConnection.ts` | **Delete** — replaced by `adapters/AcpAdapter.ts` |
| `packages/server/src/agents/AgentAcpBridge.ts` | Rename to `AgentBridge.ts`. Replace `AcpConnection` with `AgentAdapter`. Remove ACP-specific logic (move to AcpAdapter). Accept adapter via factory function. |
| `packages/server/src/agents/Agent.ts` | Replace `acpConnection: AcpConnection` with `adapter: AgentAdapter`. Update `write()`, `cancel()`, `terminate()` to use adapter interface. Replace `PromptContent` import source. |
| `packages/server/src/routes/agents.ts` | Replace `import type { ContentBlock } from '@agentclientprotocol/sdk'` with `import type { ContentBlock } from '../adapters/types.js'` |
| `packages/server/src/routes/lead.ts` | Same ContentBlock import change |
| `packages/server/src/agents/AgentManager.ts` | Pass adapter factory to agent creation instead of hardcoded AcpConnection |

### 5.3 Adapter Factory

```typescript
// packages/server/src/adapters/index.ts

export type AdapterFactory = (opts: AdapterFactoryOptions) => AgentAdapter;

export interface AdapterFactoryOptions {
  type: 'acp' | 'mock';
  autopilot?: boolean;
  permissionHandler?: PermissionHandler;
}

export function createAdapter(opts: AdapterFactoryOptions): AgentAdapter {
  switch (opts.type) {
    case 'acp':
      return new AcpAdapter({ autopilot: opts.autopilot, permissionHandler: opts.permissionHandler });
    case 'mock':
      return new MockAdapter();
    default:
      throw new Error(`Unknown adapter type: ${opts.type}`);
  }
}
```

---

## 6. Migration Strategy

### Phase 1: Extract types (non-breaking)
1. Create `adapters/types.ts` with all internal types
2. Re-export ACP SDK types from types.ts temporarily (type aliases)
3. Update import paths in routes/agents.ts and routes/lead.ts
4. **No behavioral changes** — pure import path refactoring

### Phase 2: Create AcpAdapter (non-breaking)
1. Copy `AcpConnection.ts` → `adapters/AcpAdapter.ts`
2. Implement `AgentAdapter` interface on the class
3. Add type translation at boundaries (SDK types ↔ internal types)
4. AcpConnection.ts becomes a thin re-export for backwards compat
5. **No behavioral changes** — AcpAdapter wraps same SDK calls

### Phase 3: Update consumers (behavioral change)
1. Rename `AgentAcpBridge.ts` → `AgentBridge.ts`
2. Update Agent.ts to use `AgentAdapter` interface
3. Inject adapter via factory in AgentManager
4. Delete `AcpConnection.ts` re-export shim
5. **Same behavior, different wiring**

### Phase 4: Add MockAdapter + test improvements
1. Create `MockAdapter` with programmable responses
2. Update integration tests to use MockAdapter instead of complex mocks
3. Add adapter-specific unit tests

---

## 7. Testing Strategy

### 7.1 Unit Tests: AcpAdapter Type Translation

Test that SDK types are correctly translated to internal types:

```typescript
// adapters/__tests__/AcpAdapter.test.ts

describe('AcpAdapter', () => {
  it('translates SDK ContentBlock to internal ContentBlock', () => { ... });
  it('translates SDK StopReason to internal StopReason', () => { ... });
  it('normalizes SDK tool_call events to internal ToolCallInfo', () => { ... });
  it('normalizes SDK usage_update events to internal UsageInfo', () => { ... });
  it('handles unknown SDK event types gracefully', () => { ... });
});
```

### 7.2 Unit Tests: MockAdapter

```typescript
// adapters/__tests__/MockAdapter.test.ts

describe('MockAdapter', () => {
  it('implements full AgentAdapter interface', () => { ... });
  it('emits programmable text responses on prompt()', () => { ... });
  it('simulates tool calls', () => { ... });
  it('simulates exit with code', () => { ... });
  it('tracks prompt history for assertions', () => { ... });
  it('supports prompt queue behavior', () => { ... });
});
```

### 7.3 Integration Tests: Adapter Swapping

```typescript
// Verify that Agent works identically with AcpAdapter and MockAdapter
describe('Agent with different adapters', () => {
  it('sends messages through AcpAdapter', () => { ... });
  it('sends messages through MockAdapter', () => { ... });
  it('handles adapter errors uniformly', () => { ... });
});
```

### 7.4 Existing Test Migration

Replace complex AcpConnection mocks in existing tests with `MockAdapter`:
- `AgentManager.test.ts` — use MockAdapter instead of mocking AcpConnection internals
- `CompletionTracking.test.ts` — MockAdapter can simulate idle/exit cleanly
- `AutoDAG.integration.test.ts` — MockAdapter for faster, more reliable integration tests

**Key benefit:** MockAdapter tests are simpler, faster, and don't break when AcpConnection internals change.

---

## 8. Type Translation Boundary

The adapter boundary is where SDK-specific types get translated. This is the critical design decision:

```
External (SDK)                    Boundary                    Internal (stable)
─────────────────────────────────────────────────────────────────────────────
acp.ContentBlock          →    translateContent()      →    ContentBlock
acp.StopReason            →    translateStopReason()   →    StopReason
acp.ToolKind              →    translateToolKind()     →    ToolCallInfo.kind
acp.ToolCallStatus        →    translateToolStatus()   →    ToolCallInfo.status
acp.PlanEntryPriority     →    translatePlanPriority() →    PlanEntry.priority
acp.PlanEntryStatus       →    translatePlanStatus()   →    PlanEntry.status
acp.AgentCapabilities     →    translateCapabilities() →    AdapterCapabilities
```

Each translation function handles unknown/new values with sensible defaults:
```typescript
function translateStopReason(sdkReason: acp.StopReason): StopReason {
  const map: Record<string, StopReason> = {
    end_turn: 'end_turn',
    tool_use: 'tool_use',
    max_tokens: 'max_tokens',
    stop_sequence: 'stop_sequence',
  };
  return map[sdkReason] ?? 'end_turn'; // safe default for unknown SDK values
}
```

---

## 9. Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Large refactor touches core agent lifecycle | Phased migration — each phase is independently shippable and non-breaking |
| AcpConnection has 397 LoC of battle-tested logic | AcpAdapter is a copy+refactor, not a rewrite. Same logic, new interface. |
| Tests may break during migration | MockAdapter makes tests more robust, not less. Phase 4 adds coverage. |
| New abstraction adds indirection | The abstraction already half-exists (AcpConnection already normalizes events). We're formalizing it. |
| Performance overhead from type translation | Translation functions are trivial object mapping — nanosecond overhead vs. millisecond SDK calls |

---

## 10. Success Criteria

1. **Zero SDK imports outside `adapters/`** — `@agentclientprotocol/sdk` only appears in `AcpAdapter.ts`
2. **All existing tests pass** with no changes to test assertions (only mock setup changes)
3. **MockAdapter enables faster tests** — integration tests run without spawning real CLI processes
4. **SDK upgrade path is clear** — when ACP SDK v1.0 ships, only `AcpAdapter.ts` needs updating
5. **No behavioral changes** — agents work identically before and after the refactor
