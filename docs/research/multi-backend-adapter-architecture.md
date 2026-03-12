# Multi-Backend Adapter Architecture

> **⚠️ SUPERSEDED:** The system has been simplified to ACP-only. The SDK adapter approach (ClaudeSdkAdapter, CopilotSdkAdapter) described in this research was not implemented. All providers now use the AcpAdapter over stdio — there is no SDK direct backend, no daemon adapter, and no multi-backend factory. This document is retained as research history.
>
> **Author**: Architect (e7f14c5e)  
> **Date**: 2026-03-07  
> **Depends on**: R9 AgentAdapter (done), Multi-CLI Research (done)  
> **Status**: Superseded — system is ACP-only (see `.github/skills/adapter-architecture-pattern/SKILL.md` for current architecture)

---

## Problem Statement

Flightdeck currently supports only subprocess-based ACP agents (Copilot CLI). We need to support two fundamentally different backend types:

1. **ACP Subprocess** — spawn a CLI process, communicate via JSON-RPC over stdio
2. **SDK Direct** — make API calls in-process, no subprocess

These have different lifecycle models, different session management, and different relationships with the daemon. The AgentAdapter interface must support both without leaking implementation details to the 35+ services that consume it.

---

## Key Architectural Insight

**SDK-based agents are inherently hot-reload-safe.** They don't spawn child processes, so they don't die when the server restarts. This means:

- The daemon is ONLY relevant for subprocess-based (ACP) agents
- SDK agents survive server restarts naturally — just resume the API session
- This makes SDK backends strictly easier to manage than subprocess backends

The architecture should exploit this asymmetry, not hide it.

---

## Current State

### AgentAdapter Interface (types.ts)

```typescript
interface AgentAdapter extends EventEmitter {
  readonly type: string;
  readonly isConnected: boolean;
  readonly isPrompting: boolean;
  readonly promptingStartedAt: number | null;
  readonly currentSessionId: string | null;
  readonly supportsImages: boolean;

  start(opts: AdapterStartOptions): Promise<string>;
  prompt(content: PromptContent, opts?: PromptOptions): Promise<PromptResult>;
  cancel(): Promise<void>;
  terminate(): void;
  resolvePermission(approved: boolean): void;
}

interface AdapterStartOptions {
  cliCommand: string;   // ← subprocess-specific
  cliArgs?: string[];   // ← subprocess-specific
  cwd?: string;
}
```

**Problems:**
1. `AdapterStartOptions` assumes subprocess model (`cliCommand`, `cliArgs`)
2. `terminate()` implies killing a process — SDK agents just close a session
3. `'exit'` event implies process death — SDK agents don't exit
4. No concept of backend capabilities (what does this adapter support?)
5. Factory only supports `'acp' | 'mock'`

### Adapters

| Adapter | Type | Status |
|---------|------|--------|
| `AcpAdapter` | Subprocess (Copilot CLI) | ✅ Done |
| `MockAdapter` | In-memory test | ✅ Done |
| `ClaudeSdkAdapter` | SDK Direct | ❌ Not built |
| `DaemonAdapter` | Proxy via UDS | ❌ Not built (daemon Phase 2) |

---

## Proposed Architecture

### Design Principles

1. **AgentAdapter interface stays stable** — no breaking changes to the 35+ consumers
2. **Start options split by backend type** — type-safe, not a bag of optional fields
3. **Adapter capabilities are queryable** — consumers can check what's supported
4. **Daemon only wraps subprocess adapters** — SDK adapters bypass the daemon entirely
5. **Factory is the only place that knows concrete types** — everything else uses the interface

### Backend Taxonomy

```
AgentAdapter (interface)
├── AcpAdapter          — Subprocess: any ACP CLI (Copilot, Gemini, OpenCode, Cursor, Codex, claude-agent-acp)
├── ClaudeSdkAdapter    — SDK Direct: Claude Agent SDK (in-process API calls)
├── DaemonAdapter       — Proxy: routes through daemon (wraps AcpAdapter on daemon side)
└── MockAdapter         — Test: programmable responses
```

### Interface Changes

#### 1. Canonical AdapterStartOptions (flat, backward-compatible)

> **Reconciliation note**: An earlier draft proposed a discriminated union
> (`AcpStartOptions | SdkStartOptions | DaemonStartOptions`). This was rejected
> because it breaks all 35+ existing `start()` callers — each would need a mandatory
> `backend` field added. The flat approach with optional fields enables incremental
> migration: existing ACP callers work unchanged, new SDK callers add `backend: 'sdk'`
> and SDK-specific fields. If we were starting from scratch, the union would be
> preferable for type safety. Given R9 is already consumed, pragmatism wins.
>
> This is the **canonical interface** — `multi-cli-acp-research.md` and
> `claude-adapter-design.md` reference this definition.

```typescript
// ── Types ───────────────────────────────────────────────────────────

type CliProvider = 'copilot' | 'gemini' | 'opencode' | 'cursor' | 'codex' | 'claude-acp';
type SdkProvider = 'claude-sdk';
type BackendType = 'acp' | 'sdk' | 'daemon' | 'mock';

// ── Canonical Start Options (flat, backward-compatible) ─────────────

interface AdapterStartOptions {
  // ACP fields (required for ACP, ignored by SDK):
  cliCommand: string;
  baseArgs?: string[];        // Provider-specific ACP flags (e.g., ['--experimental-acp'])
  cliArgs?: string[];         // User-specified additional args
  cwd?: string;

  // Shared fields:
  sessionId?: string;         // For resume — ACP uses session/load, SDK uses resumeSession()
  backend?: BackendType;      // Default: 'acp' for backward compat

  // SDK-specific (ignored by AcpAdapter):
  model?: string;             // e.g., 'claude-sonnet-4-20250514'
  apiKey?: string;            // Falls back to ANTHROPIC_API_KEY env var
  systemPrompt?: string;      // Agent's system prompt
  maxTurns?: number;          // Safety limit
  allowedTools?: string[];    // Tool allowlist

  // Daemon-specific (ignored by AcpAdapter and ClaudeSdkAdapter):
  socketPath?: string;        // UDS path for daemon connection
  agentId?: string;           // Agent ID on daemon side
}
```

**Why flat instead of discriminated union?** The R9 `AgentAdapter.start()` is already consumed by AgentAcpBridge, AgentManager, and tests. A discriminated union would require every caller to add `backend: 'acp'` — a mechanical but risky mass migration. Flat + optional gives us incremental adoption: existing callers pass `{ cliCommand, cliArgs, cwd }` unchanged (defaults to ACP behavior), new SDK callers add `backend: 'sdk'` and SDK fields. Runtime validation in each adapter's `start()` method catches misconfiguration.

**Precedent**: This is the same pattern Express uses for `RequestHandler` options — one flat type with context-dependent fields rather than overloads per middleware type.

#### 2. Add capabilities to the interface

```typescript
interface AgentAdapter extends EventEmitter {
  // ... existing fields ...
  readonly type: string;
  readonly backend: 'acp' | 'sdk' | 'daemon' | 'mock';  // NEW

  /** What this adapter can do — checked by consumers before using optional features */
  readonly capabilities: AdapterCapabilities;              // CHANGED: from standalone to interface member
  
  // ... existing methods ...
}

interface AdapterCapabilities {
  supportsImages: boolean;
  supportsMcp: boolean;
  supportsPlans: boolean;
  supportsUsage: boolean;          // NEW: token/cost tracking
  supportsSessionResume: boolean;  // NEW: can resume sessions
  supportsThinking: boolean;       // NEW: emits thinking events
  requiresProcess: boolean;        // NEW: true for subprocess, false for SDK
}
```

#### 3. Expand factory types

```typescript
type CliProvider = 'copilot' | 'gemini' | 'opencode' | 'cursor' | 'codex' | 'claude-acp';
type SdkProvider = 'claude-sdk';

interface AdapterFactoryOptions {
  type: 'acp' | 'sdk' | 'daemon' | 'mock';
  provider?: CliProvider | SdkProvider;
  autopilot?: boolean;
  model?: string;              // For SDK: which model to use
}
```

### Adapter Implementations

#### AcpAdapter (Updated)

Changes from current:
1. Accept `baseArgs` from provider presets instead of hardcoding `['--acp', '--stdio']`
2. Try `session/load` when `sessionId` is provided
3. Report capabilities based on provider
4. Set `backend = 'acp'` and `capabilities.requiresProcess = true`

**~30 lines of changes** to the existing 402-line file.

#### ClaudeSdkAdapter (New — ~250 lines)

```typescript
import { createAgent, query } from '@anthropic-ai/claude-agent-sdk';

class ClaudeSdkAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'claude-sdk';
  readonly backend = 'sdk' as const;
  readonly capabilities: AdapterCapabilities = {
    supportsImages: true,
    supportsMcp: true,
    supportsPlans: false,      // SDK doesn't emit plan entries
    supportsUsage: true,       // SDK reports token usage per turn
    supportsSessionResume: true, // SDK has native resumeSession()
    supportsThinking: true,    // Extended thinking support
    requiresProcess: false,    // No child process
  };

  private agent: ReturnType<typeof createAgent> | null = null;
  private session: any = null;
  private _isConnected = false;
  private _isPrompting = false;
  private _promptingStartedAt: number | null = null;
  private _sessionId: string | null = null;

  constructor(private opts: { autopilot?: boolean; model?: string }) {
    super();
  }

  get isConnected() { return this._isConnected; }
  get isPrompting() { return this._isPrompting; }
  get promptingStartedAt() { return this._promptingStartedAt; }
  get currentSessionId() { return this._sessionId; }
  get supportsImages() { return true; }

  async start(opts: AdapterStartOptions): Promise<string> {
    // SDK adapter ignores ACP-specific fields (cliCommand, baseArgs, cliArgs)
    this.agent = createAgent({
      model: opts.model || this.opts.model || 'claude-sonnet-4-20250514',
      systemPrompt: opts.systemPrompt,
      maxTurns: opts.maxTurns,
      allowedTools: opts.allowedTools,
    });

    if (opts.sessionId) {
      this.session = await this.agent.resumeSession(opts.sessionId);
    } else {
      this.session = await this.agent.createSession();
    }

    this._sessionId = this.session.id;
    this._isConnected = true;
    this.emit('connected', this._sessionId);
    return this._sessionId;
  }

  async prompt(content: PromptContent, opts?: PromptOptions): Promise<PromptResult> {
    if (!this.session) throw new Error('Session not established');
    
    this._isPrompting = true;
    this._promptingStartedAt = Date.now();
    this.emit('prompting', true);
    this.emit('response_start');

    const textContent = typeof content === 'string' 
      ? content 
      : content.map(b => b.text || '').join('\n');

    try {
      for await (const msg of this.session.query({ prompt: textContent })) {
        switch (msg.type) {
          case 'assistant':
            this.emit('text', msg.message.content);
            break;
          case 'thinking':
            this.emit('thinking', msg.content);
            break;
          case 'tool':
            this.emit('tool_call', {
              toolCallId: msg.tool.id,
              title: msg.tool.name,
              kind: msg.tool.name,
              status: 'running',
            });
            break;
          case 'tool_result':
            this.emit('tool_call_update', {
              toolCallId: msg.tool.id,
              status: 'complete',
              content: typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result),
            });
            break;
          case 'permission_request':
            if (this.opts.autopilot) {
              msg.approve();
            } else {
              this.emit('permission_request', {
                id: msg.id,
                toolName: msg.toolName,
                arguments: msg.arguments,
                timestamp: new Date().toISOString(),
              });
              // Store resolver for resolvePermission()
              this._pendingPermission = msg;
            }
            break;
          case 'usage':
            this.emit('usage', {
              inputTokens: msg.inputTokens,
              outputTokens: msg.outputTokens,
            });
            break;
        }
      }

      this._isPrompting = false;
      this._promptingStartedAt = null;
      this.emit('prompting', false);
      this.emit('prompt_complete', 'end_turn');
      this.emit('idle');

      return { stopReason: 'end_turn' };
    } catch (err) {
      this._isPrompting = false;
      this._promptingStartedAt = null;
      this.emit('prompting', false);
      this.emit('prompt_complete', 'error');
      throw err;
    }
  }

  async cancel(): Promise<void> {
    // SDK supports cancellation via AbortController
    this.session?.cancel();
  }

  terminate(): void {
    // No process to kill — just close the session
    this.session = null;
    this.agent = null;
    this._isConnected = false;
    this._isPrompting = false;
    // SDK agents emit 'exit' with code 0 (clean termination)
    this.emit('exit', 0);
  }

  resolvePermission(approved: boolean): void {
    if (this._pendingPermission) {
      if (approved) this._pendingPermission.approve();
      else this._pendingPermission.deny();
      this._pendingPermission = null;
    }
  }
}
```

**Key design decisions:**
1. `terminate()` emits `'exit', 0` — consumers don't need to know there's no process
2. The async generator loop (`for await ... of session.query()`) maps naturally to the event stream
3. Permission handling uses the SDK's callback model, exposed through the same `resolvePermission()` interface
4. Session resume is a single `resumeSession(id)` call — dramatically simpler than ACP

#### DaemonAdapter (Future — Phase 2)

```typescript
class DaemonAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'daemon-proxy';
  readonly backend = 'daemon' as const;
  readonly capabilities: AdapterCapabilities = {
    // Capabilities mirror the underlying adapter on the daemon side
    requiresProcess: true,  // Daemon owns a subprocess
    // ... rest determined at runtime from daemon's capability report
  };

  // Proxies all methods over Unix Domain Socket to daemon
  // Daemon runs AcpAdapter internally
}
```

The DaemonAdapter is ONLY used for subprocess-based agents. It proxies `start/prompt/cancel/terminate` as JSON-RPC messages over the daemon socket, and receives events back as notifications. Its capabilities are determined by querying the daemon for the underlying adapter's capabilities.

**SDK agents NEVER go through the daemon.** They're in-process API calls that survive server restarts naturally.

---

## Daemon Interaction Model

### Current assumption (subprocess only)

```
Server ──spawn──→ AcpAdapter ──stdio──→ Copilot CLI process
                  (child_process.spawn)
```

### With daemon (subprocess only)

```
Server ──JSON-RPC──→ Daemon ──stdio──→ Copilot CLI process
        (UDS)       (DaemonAdapter)    (daemon's child)
```

### SDK backends (no daemon)

```
Server ──API calls──→ Anthropic API
        (ClaudeSdkAdapter, in-process)
```

### Why SDK agents don't need the daemon

The daemon exists to solve ONE problem: child processes die when the parent restarts. SDK agents make HTTP API calls — there are no child processes. When the server restarts:

1. Server comes back up
2. Reads agent roster from SQLite (has `sessionId` for each agent)
3. For ACP agents: spawns new CLI processes with `session/load` or `--resume`
4. For SDK agents: calls `resumeSession(sessionId)` — instant reconnect, no process spawn

SDK session resume is **5-10x faster** than ACP resume because there's no process spawn, no ACP initialization handshake, and no context window rebuild. The session state lives on the API server side.

### Hybrid crew scenario

A crew can mix backend types:

```
Agent 1: Copilot CLI (ACP subprocess) → daemon-managed
Agent 2: Claude SDK (direct API)      → in-process
Agent 3: Gemini CLI (ACP subprocess)  → daemon-managed
Agent 4: Claude SDK (direct API)      → in-process
```

The server manages both transparently. `AgentManager` doesn't know or care which backend an agent uses — it only sees `AgentAdapter`. The daemon manages the subprocess agents; SDK agents are server-owned.

---

## Session Resume by Backend Type

| Backend | Resume Mechanism | Speed | Context Preservation |
|---------|-----------------|-------|---------------------|
| Copilot CLI (ACP) | `session/load` RPC or `--resume` flag | 5-15s | Partial (context rebuild) |
| Gemini CLI (ACP) | ❌ Not supported in ACP mode | N/A | None (new session always) |
| Cursor CLI (ACP) | `session/load` RPC | 5-15s | Partial |
| Codex CLI (ACP) | Client-managed transcript replay | 10-20s | Partial |
| Claude SDK (direct) | `resumeSession(id)` | <1s | Full (API-side state) |

**Claude SDK is the clear winner for session resume.** This is a major selling point for the direct SDK approach over using `claude-agent-acp` as a subprocess.

---

## Factory and Configuration

### Updated Factory

```typescript
function createAdapter(opts: AdapterFactoryOptions): AgentAdapter {
  switch (opts.type) {
    case 'acp':
      return new AcpAdapter({
        autopilot: opts.autopilot,
        provider: opts.provider as CliProvider,
      });
    case 'sdk':
      return new ClaudeSdkAdapter({
        autopilot: opts.autopilot,
        model: opts.model,
      });
    case 'daemon':
      return new DaemonAdapter({
        socketPath: opts.socketPath,
      });
    case 'mock':
      return new MockAdapter();
    default:
      throw new Error(`Unknown adapter type: ${(opts as any).type}`);
  }
}
```

### Configuration

```yaml
# flightdeck.config.yaml (R15 ConfigStore)
agents:
  defaultBackend: acp          # 'acp' | 'sdk'
  defaultProvider: copilot     # CLI provider for ACP backends
  defaultModel: claude-sonnet-4-20250514  # For SDK backends
  
  # Per-role overrides
  roles:
    architect:
      backend: sdk
      model: claude-opus-4-20250514    # Architects get Opus
    developer:
      backend: acp
      provider: copilot              # Developers use Copilot CLI
    qa-tester:
      backend: acp
      provider: gemini               # QA uses Gemini
```

This enables mixed-backend crews where the model/provider choice is per-role.

---

## Migration Plan

### Phase 1: Interface Updates (non-breaking, backward-compatible)

1. Add `backend` field to `AdapterStartOptions` as optional (default `'acp'` for backward compat)
2. Add `baseArgs` and `sessionId` to `AdapterStartOptions`
3. Add `capabilities` to `AgentAdapter` interface (AcpAdapter returns static capabilities)
4. Expand `AdapterFactoryOptions.type` to include `'sdk'`
5. Update `AcpAdapter` to use `baseArgs` from provider presets

**Zero changes needed in consumers.** Old `start({ cliCommand, cliArgs, cwd })` calls still work.

### Phase 2: ClaudeSdkAdapter Implementation

1. Create `adapters/ClaudeSdkAdapter.ts` (~250 lines)
2. Add `@anthropic-ai/claude-agent-sdk` as optional dependency
3. Update factory to handle `type: 'sdk'`
4. Add unit tests with MockAdapter-style patterns
5. Integration test: spawn a Claude SDK agent, prompt, verify events

### Phase 3: Configuration Integration

1. Add `agents` section to R15 ConfigStore schema
2. Wire per-role backend/provider selection through AgentAcpBridge
3. Update agent spawn flow to use config-driven adapter selection
4. UI: show backend type in agent detail panel

### Phase 4: DaemonAdapter (deferred to daemon implementation)

1. Create `adapters/DaemonAdapter.ts`
2. JSON-RPC proxy over UDS
3. Event stream forwarding
4. Reconnect logic with event replay

---

## Interface Diff Summary

### types.ts changes

```diff
+ type CliProvider = 'copilot' | 'gemini' | 'opencode' | 'cursor' | 'codex' | 'claude-acp';
+ type SdkProvider = 'claude-sdk';
+ type BackendType = 'acp' | 'sdk' | 'daemon' | 'mock';

  interface AdapterStartOptions {
    cliCommand: string;
+   baseArgs?: string[];
    cliArgs?: string[];
    cwd?: string;
+   sessionId?: string;
+   backend?: BackendType;
+   // SDK-specific (ignored by AcpAdapter):
+   model?: string;
+   apiKey?: string;
+   systemPrompt?: string;
+   maxTurns?: number;
+   allowedTools?: string[];
  }

+   // Daemon-specific (ignored by AcpAdapter and ClaudeSdkAdapter):
+   socketPath?: string;
+   agentId?: string;
  }

  interface AgentAdapter extends EventEmitter {
    readonly type: string;
+   readonly backend: BackendType;
+   readonly capabilities: AdapterCapabilities;
    readonly isConnected: boolean;
    // ... rest unchanged
  }

  interface AdapterCapabilities {
    supportsImages: boolean;
    supportsMcp: boolean;
    supportsPlans: boolean;
+   supportsUsage: boolean;
+   supportsSessionResume: boolean;
+   supportsThinking: boolean;
+   requiresProcess: boolean;
  }

  interface AdapterFactoryOptions {
-   type: 'acp' | 'mock';
+   type: BackendType;
+   provider?: CliProvider | SdkProvider;
    autopilot?: boolean;
+   model?: string;
  }
```

> **Note**: The canonical `AdapterStartOptions` definition is in §1 ("Canonical AdapterStartOptions")
> above. This diff shows only the delta from the current `types.ts` on disk.

---

## What Does NOT Change

1. **AgentManager** — sees `AgentAdapter`, doesn't care about backend
2. **CommandDispatcher** — dispatches commands, backend-agnostic
3. **All command handlers** — CommCommands, CoordCommands, etc.
4. **WebSocket event broadcasting** — events from adapter → WS, no backend awareness
5. **AsyncLocalStorage context** — agent context injection is adapter-agnostic
6. **File locks, DAG, delegations** — all business logic, no adapter dependency
7. **BudgetEnforcer** — listens for `usage` events from any adapter
8. **Tests** — MockAdapter is unchanged, test infrastructure works

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude SDK API breaks | Medium | SDK is behind adapter boundary, only one file to update |
| Flat options type safety | Low | Runtime validation in each adapter's `start()` |
| Mixed-backend daemon complexity | Medium | SDK agents bypass daemon — simpler, not harder |
| SDK dependency size | Low | Optional dep, tree-shaked if not used |
| Event format differences (SDK vs ACP) | Medium | Normalize in adapter, consistent events to consumers |

---

## Security Considerations

### Trust Boundary Differences by Backend Type

The ACP subprocess model and the SDK direct model have fundamentally different trust boundaries. This affects where API keys live, what an attacker gains from a process compromise, and how much isolation the server has from agent code.

#### ACP Subprocess Model (Copilot, Gemini, Cursor, Codex)

```
┌─────────────────────┐     stdio pipes     ┌──────────────────────┐
│  Server Process      │ ◄──────────────────► │  CLI Child Process   │
│  (no API key)        │    JSON-RPC          │  (holds API key in   │
│                      │                      │   its own env/memory)│
└─────────────────────┘                      └──────────────────────┘
```

- **API key location**: In the child process environment (`GITHUB_TOKEN`, `GEMINI_API_KEY`, etc.), NOT in server memory.
- **Trust boundary**: The server and CLI are separate OS processes. The server sends prompts over stdio; the CLI authenticates with its provider independently.
- **Compromise impact**: If the server process is compromised, the attacker can send prompts through the CLI (which they could already do), but does NOT automatically gain the API key. They'd need to read `/proc/<pid>/environ` or similar OS-level access.
- **With daemon**: The trust boundary widens slightly — the daemon holds child processes, so compromising the daemon gives access to the CLIs' stdin/stdout. But API keys remain in child process memory, not daemon memory.

#### SDK Direct Model (Claude Agent SDK)

```
┌──────────────────────────────────────────┐
│  Server Process                           │
│  ┌─────────────────────────────────────┐ │
│  │  ClaudeSdkAdapter                    │ │
│  │  - API key in process memory         │ │
│  │  - Direct HTTPS to api.anthropic.com │ │
│  └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

- **API key location**: In the server process memory (`ANTHROPIC_API_KEY` loaded into the SDK client). This is a **security boundary collapse** — the API key shares address space with all other server code.
- **Trust boundary**: None between server and agent. The SDK runs in-process; the server IS the agent runtime.
- **Compromise impact**: If the server process is compromised, the attacker gains the API key directly — it's in the same process memory. They can make arbitrary API calls, exfiltrate the key, or modify agent behavior.
- **No daemon involvement**: SDK agents are in-process, so the daemon's isolation doesn't help.

#### Comparison Matrix

| Property | ACP Subprocess | SDK Direct |
|----------|---------------|------------|
| API key location | Child process env | Server process memory |
| Process isolation | ✅ Separate PID, address space | ❌ Same process |
| Compromise → API key | Requires `/proc` or ptrace | Immediate (same memory) |
| Compromise → agent control | Send prompts via stdio | Full — modify SDK calls |
| Daemon adds isolation | ✅ Moves children to daemon PID | ❌ N/A (no process) |
| Key rotation | Restart child with new env | Restart server or hot-swap in memory |

#### Mitigations for SDK Model

1. **Least-privilege API keys**: Use Anthropic API keys scoped to the minimum permissions needed. If the API supports key scoping (rate limits, model restrictions), use it.
2. **Key injection at startup only**: Read `ANTHROPIC_API_KEY` from env at adapter creation time, don't store it beyond the SDK client instance. If the SDK client is garbage-collected, the key reference should go with it.
3. **No key logging**: The R5 structured logger already has R12 redaction (`redact()` / `redactObject()`) — ensure API keys are in the redaction pattern list.
4. **Process-level isolation (future)**: If SDK agents need stronger isolation, they could run in a Worker thread with a restricted `env`. This is a future enhancement, not a Phase 1 requirement.
5. **Defense in depth**: The server already runs behind authentication (GitHub OAuth). An attacker would need to compromise the server process itself, not just the HTTP endpoint.

#### Assessment

The SDK model's security boundary collapse is a real tradeoff, not a blocker. It's the same trust model used by every server-side SDK integration (Stripe keys in Express servers, AWS credentials in Lambda, etc.). The subprocess model provides slightly better isolation by accident (CLI manages its own auth), but both models rely on the same fundamental assumption: the server process is trusted.

**Recommendation**: Document this tradeoff in operator-facing docs so self-hosted deployments can make informed choices. For managed deployments, the SDK model is acceptable with standard key management practices.

---

## Conclusion

The R9 `AgentAdapter` interface is **already 90% correct** for multi-backend support. The key changes are:

1. **~15 lines of interface additions** (capabilities, backend field, optional start options)
2. **~250 lines for ClaudeSdkAdapter** (new file)
3. **~30 lines of AcpAdapter updates** (baseArgs, session/load)
4. **~20 lines of factory updates** (new type handling)

The fundamental insight: **SDK backends are simpler than subprocess backends in every way** — no daemon needed, instant session resume, no process lifecycle management. The architecture should embrace this asymmetry. Mixed-backend crews give users the best of both worlds: Copilot CLI's ecosystem with Claude SDK's reliability and resume speed.
