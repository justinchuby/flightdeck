# CopilotSdkAdapter Design Brief

**Author:** Architect (3973583e)  
**Status:** Ready for implementation  
**Priority:** HIGH — User-requested design change  
**SDK Version:** `@github/copilot-sdk@0.1.32`  
**Template:** ClaudeSdkAdapter (structural mirror, adapted for Copilot SDK's richer API)

---

## 1. WHY — The Problem

The current Copilot integration uses AcpAdapter (subprocess via stdio + `@agentclientprotocol/sdk`). ACP's `loadSession()` has unreliable session resume — it tries and falls back to `newSession()`. The user wants **proper session resume** via the native `@github/copilot-sdk`, matching what ClaudeSdkAdapter provides for Claude.

**Key constraint:** ACP-based Copilot adapter STAYS as fallback. The new CopilotSdkAdapter is the preferred path when the SDK is installed.

---

## 2. SDK API SURFACE (Verified from @github/copilot-sdk@0.1.32)

### 2.1 Architecture

The Copilot SDK uses **JSON-RPC** (not ACP). It manages a `CopilotClient` that spawns a copilot CLI process as a JSON-RPC server, then creates `CopilotSession` objects for conversations. This is fundamentally different from ClaudeSdkAdapter's approach:

| Aspect | ClaudeSdkAdapter | CopilotSdkAdapter (new) |
|--------|-----------------|------------------------|
| **SDK class** | `query()` function (stateless) | `CopilotClient` → `CopilotSession` (stateful) |
| **Process model** | In-process | SDK spawns copilot CLI as JSON-RPC server |
| **Session resume** | `query({ resume: sessionId })` | `client.resumeSession(sessionId, config)` |
| **Message pattern** | `for await (const msg of query(...))` | `session.send()` + event callbacks via `session.on()` |
| **Prompt return** | Async iterator (generator) | `session.sendAndWait()` → `AssistantMessageEvent` |
| **Abort** | `query.interrupt()` / `query.close()` | `session.abort()` |
| **Lifecycle** | Stateless query function | `client.start()` → sessions → `client.stop()` |
| **Permission** | Callback during iteration | `onPermissionRequest: PermissionHandler` in config |
| **Event types** | `system`, `assistant`, `user`, `result` | 40+ typed events (session.*, assistant.*, tool.*, etc.) |
| **Session listing** | `sdk.listSessions({ dir })` | `client.listSessions(filter?)` |
| **Session deletion** | Not supported | `client.deleteSession(sessionId)` |
| **User input** | Not supported | `onUserInputRequest` handler (enables `ask_user` tool) |
| **Model change** | Not supported mid-session | `session.setModel(model)` |
| **Types** | Hand-written `.d.ts` stubs | Full `.d.ts` shipped with SDK ✅ |

### 2.2 Key SDK Exports

```typescript
// @github/copilot-sdk
export { CopilotClient } from "./client.js";
export { CopilotSession, type AssistantMessageEvent } from "./session.js";
export { defineTool, approveAll } from "./types.js";
export type {
  CopilotClientOptions, SessionConfig, ResumeSessionConfig,
  SessionEvent, SessionEventType, SessionEventHandler,
  PermissionHandler, PermissionRequest, PermissionRequestResult,
  Tool, ToolHandler, ToolInvocation,
  MessageOptions, ModelInfo, SessionMetadata, SessionListFilter,
  ConnectionState, UserInputHandler, SessionHooks,
  // ... 30+ more types
} from "./types.js";
```

### 2.3 Session Event Types (40+)

```
session.start, session.resume, session.error, session.idle, session.title_changed,
session.info, session.warning, session.model_change, session.mode_changed,
session.plan_changed, session.workspace_file_changed, session.handoff,
session.truncation, session.snapshot_rewind, session.shutdown, session.context_changed,
session.usage_info, session.compaction_start, session.compaction_complete,
session.task_complete, user.message, pending_messages.modified,
assistant.turn_start, assistant.intent, assistant.reasoning, assistant.reasoning_delta,
assistant.message, assistant.message_delta, tool.execution, tool.execution_progress,
tool.execution_complete, skill.invoked, subagent.started, subagent.completed,
subagent.failed, subagent.selected, subagent.deselected, hook.start, hook.end,
system.message, permission.requested, permission.completed, user_input.requested,
user_input.completed, elicitation.requested, elicitation.completed,
external_tool.requested, external_tool.completed, command.queued, command.completed,
exit_plan_mode.requested, exit_plan_mode.completed
```

### 2.4 Permission Model

```typescript
interface PermissionRequest {
  kind: "shell" | "write" | "mcp" | "read" | "url" | "custom-tool";
  toolCallId?: string;
  [key: string]: unknown;
}

type PermissionHandler = (request: PermissionRequest, invocation: { sessionId: string })
  => Promise<PermissionRequestResult> | PermissionRequestResult;

// Pre-built handler:
const approveAll: PermissionHandler;  // Auto-approves everything
```

### 2.5 Session Config

```typescript
interface SessionConfig {
  sessionId?: string;
  model?: string;                    // "gpt-5", "claude-sonnet-4.5", etc.
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  tools?: Tool[];                    // Custom tools exposed to the CLI
  systemMessage?: SystemMessageConfig;
  infiniteSessions?: InfiniteSessionConfig;  // Auto context compaction
  provider?: ProviderConfig;         // BYOK - custom API provider
  onPermissionRequest: PermissionHandler;    // REQUIRED
  onUserInputRequest?: UserInputHandler;
  hooks?: SessionHooks;
  workingDirectory?: string;
  configDir?: string;
  mcpServers?: MCPServerConfig[];
  customAgents?: CustomAgentConfig[];
  skillDirectories?: string[];
  disabledSkills?: string[];
}

// ResumeSessionConfig = same as SessionConfig minus a few fields
```

---

## 3. ARCHITECTURE — CopilotSdkAdapter Design

### 3.1 File Structure

```
packages/server/src/adapters/
├── CopilotSdkAdapter.ts          # NEW — ~450-550 LOC
├── __tests__/
│   └── CopilotSdkAdapter.test.ts # NEW — ~500-700 LOC
```

**NO type stubs needed** — the SDK ships its own `.d.ts` files.

### 3.2 Class Structure

```typescript
// CopilotSdkAdapter.ts

import type { AgentAdapter, AdapterStartOptions, PromptContent,
  PromptOptions, PromptResult, StopReason, ToolCallInfo,
  PermissionRequest as FlightdeckPermissionRequest } from './types.js';

// Lazy SDK loading (REQUIRED)
let CopilotClientClass: typeof import('@github/copilot-sdk').CopilotClient | null = null;
let approveAllFn: typeof import('@github/copilot-sdk').approveAll | null = null;

async function loadSdk() {
  if (CopilotClientClass) return;
  try {
    const mod = await import('@github/copilot-sdk');
    CopilotClientClass = mod.CopilotClient;
    approveAllFn = mod.approveAll;
  } catch {
    throw new Error('Copilot SDK not installed. Run: npm install @github/copilot-sdk@0.1.32');
  }
}

export class CopilotSdkAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'copilot-sdk';
  readonly supportsImages = false;

  // SDK handles — THIS IS THE KEY DIFFERENCE FROM ClaudeSdkAdapter
  // We maintain a persistent CopilotClient (manages the subprocess)
  // and a CopilotSession per conversation
  private client: InstanceType<typeof import('@github/copilot-sdk').CopilotClient> | null = null;
  private session: InstanceType<typeof import('@github/copilot-sdk').CopilotSession> | null = null;
  
  // Session IDs — CopilotSession.sessionId IS the SDK session ID
  // We don't need a two-layer system because createSession returns the sessionId synchronously
  private _sessionId: string | null = null;
  
  private _isConnected = false;
  private _isPrompting = false;
  private _promptingStartedAt: number | null = null;
  
  // Configuration
  private model: string = 'gpt-5';
  private autopilot: boolean;
  private cwd: string = process.cwd();
  private systemPrompt?: string;
  private maxTurns?: number;
  
  // Permission flow
  private pendingPermission: {
    resolve: (result: import('@github/copilot-sdk').PermissionRequestResult) => void
  } | null = null;
  private permissionTimeout: ReturnType<typeof setTimeout> | null = null;
  
  // Prompt queue (same pattern as other adapters)
  private promptQueue: PromptContent[] = [];
  private promptQueuePriorityCount = 0;
  
  // Event unsubscribe functions
  private eventUnsubscribers: Array<() => void> = [];

  constructor(opts?: { model?: string; autopilot?: boolean }) {
    super();
    if (opts?.model) this.model = opts.model;
    this.autopilot = opts?.autopilot ?? false;
  }
}
```

### 3.3 Start Method — Session Create/Resume

```typescript
async start(opts: AdapterStartOptions): Promise<string> {
  await loadSdk();
  
  this.cwd = opts.cwd ?? process.cwd();
  if (opts.model) this.model = opts.model;
  if (opts.maxTurns) this.maxTurns = opts.maxTurns;
  if (opts.systemPrompt) this.systemPrompt = opts.systemPrompt;
  
  // Create CopilotClient (manages the copilot CLI subprocess)
  this.client = new CopilotClientClass!({
    useStdio: true,        // stdio transport (no TCP)
    autoStart: true,       // auto-start CLI process
    autoRestart: true,     // auto-restart on crash
  });
  
  await this.client.start();
  
  // Build session config
  const sessionConfig = {
    model: this.model,
    onPermissionRequest: this.autopilot
      ? approveAllFn!
      : this.handlePermission.bind(this),
    workingDirectory: this.cwd,
    ...(this.systemPrompt ? {
      systemMessage: { type: 'append' as const, content: this.systemPrompt }
    } : {}),
  };
  
  if (opts.sessionId) {
    // RESUME existing session — THE KEY FEATURE
    this.session = await this.client.resumeSession(opts.sessionId, sessionConfig);
    this._sessionId = this.session.sessionId;
    logger.info({ module: 'copilot-sdk', msg: 'Resumed session', sessionId: this._sessionId });
  } else {
    // Create new session
    this.session = await this.client.createSession(sessionConfig);
    this._sessionId = this.session.sessionId;
    logger.info({ module: 'copilot-sdk', msg: 'Created session', sessionId: this._sessionId });
  }
  
  // Wire session events → adapter events
  this.wireSessionEvents();
  
  this._isConnected = true;
  this.emit('connected', this._sessionId);
  return this._sessionId;
}
```

### 3.4 Event Mapping (SDK events → AgentAdapter events)

```typescript
private wireSessionEvents(): void {
  if (!this.session) return;
  
  // Text output
  this.eventUnsubscribers.push(
    this.session.on('assistant.message', (event) => {
      this.emit('text', event.data.content);
    })
  );
  
  // Streaming text delta (if available)
  this.eventUnsubscribers.push(
    this.session.on('assistant.message_delta', (event) => {
      if (event.data.textDelta) this.emit('text', event.data.textDelta);
    })
  );
  
  // Thinking/reasoning
  this.eventUnsubscribers.push(
    this.session.on('assistant.reasoning', (event) => {
      this.emit('thinking', event.data.content);
    })
  );
  
  // Tool execution
  this.eventUnsubscribers.push(
    this.session.on('tool.execution', (event) => {
      this.emit('tool_call', {
        toolCallId: event.data.id,
        title: event.data.name,
        kind: event.data.name,
        status: 'running',
        content: JSON.stringify(event.data.input),
      } satisfies ToolCallInfo);
    })
  );
  
  this.eventUnsubscribers.push(
    this.session.on('tool.execution_complete', (event) => {
      this.emit('tool_call_update', {
        toolCallId: event.data.id,
        status: event.data.error ? 'error' : 'completed',
        content: event.data.output ?? event.data.error ?? '',
      });
    })
  );
  
  // Plan events
  this.eventUnsubscribers.push(
    this.session.on('session.plan_changed', (event) => {
      this.emit('plan', event.data.entries ?? []);
    })
  );
  
  // Usage info
  this.eventUnsubscribers.push(
    this.session.on('session.usage_info', (event) => {
      this.emit('usage', {
        inputTokens: event.data.inputTokens,
        outputTokens: event.data.outputTokens,
      });
    })
  );
  
  // Context compaction
  this.eventUnsubscribers.push(
    this.session.on('session.compaction_complete', () => {
      this.emit('text', '\n[Context compacted — older history summarized]\n');
    })
  );
  
  // Permission requests (when not in autopilot)
  this.eventUnsubscribers.push(
    this.session.on('permission.requested', (event) => {
      this.emit('permission_request', {
        id: event.data.toolCallId ?? `perm-${Date.now()}`,
        toolName: event.data.kind,
        arguments: event.data,
        timestamp: event.timestamp,
      } satisfies FlightdeckPermissionRequest);
    })
  );
  
  // Session idle = prompt complete
  this.eventUnsubscribers.push(
    this.session.on('session.idle', () => {
      if (this._isPrompting) {
        this._isPrompting = false;
        this._promptingStartedAt = null;
        this.emit('prompting', false);
        this.emit('prompt_complete', 'end_turn');
        this.drainQueue();
      } else {
        this.emit('idle');
      }
    })
  );
  
  // Session error
  this.eventUnsubscribers.push(
    this.session.on('session.error', (event) => {
      if (this._isPrompting) {
        this._isPrompting = false;
        this._promptingStartedAt = null;
        this.emit('prompting', false);
        this.emit('prompt_complete', 'error');
        this.drainQueue();
      }
    })
  );
}
```

### 3.5 Prompt Method

```typescript
async prompt(content: PromptContent, opts?: PromptOptions): Promise<PromptResult> {
  if (!this.session || !this._isConnected) throw new Error('Copilot SDK adapter not started');
  
  // Queue concurrent prompts
  if (this._isPrompting) {
    if (opts?.priority) {
      this.promptQueue.splice(this.promptQueuePriorityCount, 0, content);
      this.promptQueuePriorityCount++;
    } else {
      this.promptQueue.push(content);
    }
    return { stopReason: 'end_turn' };
  }
  
  this._isPrompting = true;
  this._promptingStartedAt = Date.now();
  this.emit('prompting', true);
  this.emit('response_start');
  
  const promptText = typeof content === 'string' ? content
    : content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  
  try {
    // sendAndWait blocks until session.idle
    const result = await this.session.sendAndWait(
      { prompt: promptText },
      this.maxTurns ? this.maxTurns * 30_000 : 600_000  // timeout
    );
    
    // Note: session.idle handler (above) already set _isPrompting=false
    // and emitted prompt_complete. But if sendAndWait returns before
    // the idle event fires, handle it here too:
    if (this._isPrompting) {
      this._isPrompting = false;
      this._promptingStartedAt = null;
      this.emit('prompting', false);
      this.emit('prompt_complete', 'end_turn');
      this.drainQueue();
    }
    
    return { stopReason: 'end_turn' };
  } catch (err) {
    this._isPrompting = false;
    this._promptingStartedAt = null;
    this.emit('prompting', false);
    this.emit('prompt_complete', 'error');
    this.drainQueue();
    throw err;
  }
}
```

### 3.6 Session Resume Flow (THE KEY FEATURE)

```
start(opts) called with sessionId
│
├── client = new CopilotClient({ useStdio: true })
├── await client.start()  ← spawns copilot CLI JSON-RPC server
│
├── session = await client.resumeSession(sessionId, {
│     model, onPermissionRequest, workingDirectory, systemMessage
│   })
│   ← SDK loads session from disk, restores full conversation context
│   ← Agent continues exactly where it left off
│
├── wireSessionEvents()  ← subscribe to session events
├── emit('connected', session.sessionId)
└── return session.sessionId
```

**Why this is better than ACP:**
- ACP `loadSession()` is a best-effort call that silently falls back to `newSession()`
- Copilot SDK `resumeSession()` is an explicit API that throws if session doesn't exist
- Sessions include full conversation history, tool state, and planning context
- `session.getMessages()` can retrieve the full conversation log at any time

---

## 4. INTEGRATION POINTS — What Changes in Existing Code

### 4.1 AdapterFactory.ts — Add `copilot-sdk` backend

```typescript
// resolveBackend() — Line ~70
export function resolveBackend(provider: string, sdkMode?: boolean): BackendType {
  if (provider === 'mock') return 'mock';
  if (provider === 'claude' && sdkMode) return 'claude-sdk';
  if (provider === 'copilot' && sdkMode) return 'copilot-sdk';  // NEW
  return 'acp';
}

// BackendType — add new variant
export type BackendType = 'acp' | 'claude-sdk' | 'copilot-sdk' | 'mock';

// createAdapterForProvider() — add copilot-sdk case (with ACP fallback)
// NOTE: Factory stays synchronous. CopilotSdkAdapter constructor doesn't need SDK.
// SDK loads lazily in start().
if (preferredBackend === 'copilot-sdk') {
  try {
    const adapter = new CopilotSdkAdapter({
      autopilot: config.autopilot,
      model: config.model,
    });
    return { adapter, backend: 'copilot-sdk', fallback: false };
  } catch (err) {
    const reason = `Copilot SDK adapter creation failed: ${(err as Error)?.message}`;
    logger.warn({ module: 'adapter-factory', msg: `SDK fallback: ${reason}` });
    const adapter = new AcpAdapter({ autopilot: config.autopilot });
    return { adapter, backend: 'acp', fallback: true, fallbackReason: reason };
  }
}
```

**Factory stays sync** — CopilotSdkAdapter constructor doesn't import SDK. SDK loads lazily in `start()`, same as ClaudeSdkAdapter.

### 4.2 index.ts (barrel) — Add exports

```typescript
export { CopilotSdkAdapter } from './CopilotSdkAdapter.js';
```

No type stubs file needed — SDK ships its own `.d.ts`.

### 4.3 package.json — Add SDK as optionalDependency

```json
{
  "optionalDependencies": {
    "@github/copilot-sdk": "0.1.32",
    "@anthropic-ai/claude-agent-sdk": "0.2.71"
  }
}
```

### 4.4 SessionResumeManager — No changes needed

Already reads `supportsResume` from preset. Copilot preset already has `supportsResume: true`. Resume flow passes `sessionId` through `AdapterStartOptions`. CopilotSdkAdapter handles it in `start()`.

---

## 5. IMPLEMENTATION ORDER

```
Step 1: Add @github/copilot-sdk@0.1.32 to optionalDependencies
Step 2: Add @anthropic-ai/claude-agent-sdk@0.2.71 to optionalDependencies
Step 3: CopilotSdkAdapter.ts — implement using the patterns in §3 above
Step 4: Update AdapterFactory.ts (resolveBackend + createAdapterForProvider)
Step 5: Update index.ts (barrel exports)
Step 6: CopilotSdkAdapter.test.ts — test suite
Step 7: Manual integration test (if Copilot CLI available)
```

**Estimated scope:** ~450-550 LOC production + ~500-700 LOC tests
**Risk:** Low — SDK API is well-typed and well-documented. Event mapping (§3.4) is the most complex part.

---

## 6. DECISION LOG

| Decision | Rationale |
|----------|-----------|
| **No two-layer session IDs** (unlike ClaudeSdkAdapter) | Copilot SDK returns `sessionId` immediately from `createSession()`. No async mapping needed. |
| **CopilotClient lifecycle = adapter lifecycle** | One CopilotClient per adapter. Client spawns the copilot CLI subprocess. Clean mapping. |
| **No hand-written type stubs** | SDK ships full `.d.ts` files (228 KB, comprehensive). No stubs needed. |
| **`sendAndWait()` for prompts** | Simpler than manual event tracking. Blocks until `session.idle`, which maps perfectly to our `prompt()` → `PromptResult` pattern. |
| Lazy `import()` in `start()`, not module-level | Matches ClaudeSdkAdapter. Server starts fine without SDK installed. |
| `optionalDependency`, not `dependency` | npm installs it if available, skips gracefully if not. |
| ACP adapter stays as fallback | Zero risk — if SDK fails, existing ACP behavior continues unchanged. |
| `type = 'copilot-sdk'` (not 'copilot') | Distinguishes from ACP-based copilot adapter in logs, metrics, and factory routing. |

---

## 7. WHAT NOT TO DO

- **Don't modify AcpAdapter.ts** — it stays unchanged as the fallback
- **Don't create copilot-sdk.d.ts** — SDK ships its own types
- **Don't eagerly import the SDK** — lazy import is mandatory
- **Don't make the factory async** — construct adapter sync, load SDK lazily in `start()`
- **Don't use a two-layer session ID** — unlike Claude SDK, Copilot SDK gives session IDs synchronously

---

## 8. FILES TO LOCK

For the implementing developer:
1. `packages/server/src/adapters/CopilotSdkAdapter.ts` (new)
2. `packages/server/src/adapters/AdapterFactory.ts` (modify)
3. `packages/server/src/adapters/index.ts` (modify)
4. `packages/server/package.json` (modify)
5. `packages/server/src/adapters/__tests__/CopilotSdkAdapter.test.ts` (new)
