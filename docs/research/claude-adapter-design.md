# ClaudeAdapter Design: Direct SDK Integration

**Author:** Architect (5699527d)  
**Status:** Draft → Reviewed (C2, A1 fixes applied)  
**Depends on:** R9 (AgentAdapter interface), Daemon design proposal  
**Aligned with:** [Multi-Backend Adapter Architecture](multi-backend-adapter-architecture.md) (e7f14c5e)  

---

## Executive Summary

The Claude Agent SDK provides **first-class session resume** — the #1 feature Copilot CLI lacks. A direct `ClaudeAdapter` using the SDK (not ACP) gives Flightdeck full session lifecycle control: create, resume, fork, and list sessions. Sessions persist automatically to `~/.claude/projects/` as JSONL files and survive process restarts.

**Recommendation:** Build a direct `ClaudeAdapter` (Option B) for full session control. Keep `AcpAdapter` for Copilot CLI. The two approaches coexist cleanly — same `AgentAdapter` interface, different backends.

---

## 1. Claude Agent SDK Session Capabilities

### 1.1 Session Lifecycle

The SDK provides four session operations:

| Operation | V1 API | V2 API (Preview) | What It Does |
|-----------|--------|-------------------|--------------|
| **Create** | `query({ prompt })` | `createSession()` + `send()` | New session, new conversation |
| **Continue** | `query({ continue: true })` | — | Resume most recent session in CWD (no ID needed) |
| **Resume** | `query({ resume: sessionId })` | `resumeSession(sessionId)` | Resume specific session by ID |
| **Fork** | `query({ resume: id, forkSession: true })` | — (V2 not yet) | Branch from existing session, new ID |

### 1.2 Session Persistence

Sessions are stored at:
```
~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
```
Where `<encoded-cwd>` replaces non-alphanumeric chars with `-` (e.g., `/Users/me/proj` → `-Users-me-proj`).

**What's persisted:**
- Full conversation history (prompts, responses, tool calls, tool results)
- Session metadata (ID, CWD, title, git branch, timestamps)
- Each session is an independent JSONL file

**What's NOT persisted:**
- Filesystem changes (use file checkpointing for that)
- In-memory state (tool state, permission decisions)

### 1.3 Context Window Management

- **Automatic compaction**: When context approaches limit, SDK summarizes older history
- **Compaction events**: `SystemMessage` with `compact_boundary` subtype
- **Persistent rules**: Instructions in CLAUDE.md survive compaction; early prompt instructions may not
- **Subagent isolation**: Each subagent gets fresh context; only final result returns to parent

### 1.4 Resume Across Hosts

Session files are local. To resume on a different machine:
- Move the JSONL file to the same path
- OR capture results as application state and inject into fresh session (more robust)

### 1.5 Session Listing

```typescript
import { listSessions } from '@anthropic-ai/claude-agent-sdk';

const sessions = await listSessions({ dir: '/path/to/project', limit: 20 });
// Returns: { sessionId, summary, lastModified, fileSize, customTitle, firstPrompt, gitBranch, cwd }[]
```

---

## 2. claude-agent-acp Session Handling

The ACP adapter at `/Users/justinc/Documents/GitHub/claude-agent-acp` **fully implements** all session operations:

### 2.1 ACP Session Methods

| ACP Method | Implementation (acp-agent.ts) | Maps To |
|------------|-------------------------------|---------|
| `newSession()` | Lines 372-390 | `query()` with new UUID |
| `resumeSession()` | Lines 411-427 | `query({ resume: sessionId })` |
| `loadSession()` | Lines 429-453 | Resume + replay history as notifications |
| `forkSession()` | Lines 392-409 | `query({ resume: id, forkSession: true })` |
| `listSessions()` | Lines 455-471 | `listSessions()` SDK function |

### 2.2 Key Distinction: Resume vs Load

- **Resume**: Reuses sessionId, SDK reconnects to conversation. Agent has full prior context but client doesn't see old messages.
- **Load**: Resume + replays all prior messages as ACP notifications to the client. Client rebuilds its UI state from the history.

### 2.3 Session State Mapping

```typescript
// acp-agent.ts line 109-120
type Session = {
  query: Query;                    // Active SDK query iterator
  input: Pushable<SDKUserMessage>; // Message queue for streaming input
  cancelled: boolean;
  permissionMode: PermissionMode;
  settingsManager: SettingsManager;
  accumulatedUsage: AccumulatedUsage;
  configOptions: SessionConfigOption[];
  promptRunning: boolean;
  pendingMessages: Map<string, { resolve, order }>;
  nextPendingOrder: number;
};
```

### 2.4 Event Translation (SDK → ACP)

| SDK Event | ACP Notification | Handler |
|-----------|------------------|---------|
| `content_block_start: text` | `agent_message_chunk` | `streamEventToAcpNotifications()` |
| `content_block_start: thinking` | `agent_thought_chunk` | `toAcpNotifications()` |
| `content_block_start: tool_use` | `tool_call` (pending) | `toAcpNotifications()` |
| `tool_result` | `tool_call_update` (completed) | `toAcpNotifications()` |
| `result: success` | `{ stopReason: "end_turn" }` | `prompt()` return |
| `result: error_max_turns` | `{ stopReason: "max_turn_requests" }` | `prompt()` return |
| `compact_boundary` | `agent_message_chunk` (literal text) | Inline handler |

---

## 3. Current Flightdeck Session Architecture

### 3.1 What Exists Today

**Agent.ts fields:**
```typescript
public sessionId: string | null = null;      // Current ACP session ID
public resumeSessionId?: string;              // Session to resume on spawn
```

**AgentManager.spawn():**
- Accepts `resumeSessionId` parameter (line 320)
- Passes to subprocess via `--resume` CLI flag
- On crash auto-restart, preserves sessionId for continuity

**AcpAdapter limitations:**
- Only implements `newSession()` — no resume, load, fork, or list
- Session lifecycle is 1:1 with adapter instance (new adapter = new session)
- No session persistence beyond the subprocess's own state

### 3.2 Daemon Design (Proposed)

From `hot-reload-agent-preservation.md`:
- Long-lived daemon process owns agent subprocesses
- API server connects via Unix socket (`/tmp/flightdeck-agents.sock`)
- JSON-RPC IPC with event buffering during disconnect
- Agents survive server restarts

**Key insight for ClaudeAdapter:** The daemon model works better with SDK-based agents than subprocess-based agents. The SDK `query()` runs in-process — the daemon IS the agent runtime, not just a subprocess manager.

---

## 4. ClaudeAdapter Design

### 4.1 Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                 Flightdeck Server                 │
│                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ AgentManager │  │ AcpAdapter   │  │ Claude   │ │
│  │             │──│ (subprocess) │  │ Adapter  │ │
│  │             │  │ Copilot CLI  │  │ (in-proc)│ │
│  │             │  └──────────────┘  │ SDK      │ │
│  │             │────────────────────│          │ │
│  └─────────────┘                    └──────────┘ │
│                                         │         │
│                                         ▼         │
│                               ~/.claude/projects/ │
│                               (session JSONL)     │
└──────────────────────────────────────────────────┘
```

**Key difference from AcpAdapter:**
- AcpAdapter: spawns subprocess → communicates via stdio/ndjson → subprocess owns session
- ClaudeAdapter: calls SDK directly → session runs in-process → Flightdeck owns session

### 4.2 Interface Alignment

> **Aligned with** the [Multi-Backend Adapter Architecture](multi-backend-adapter-architecture.md)
> reconciled interface (e7f14c5e). Uses flat `AdapterStartOptions` with optional
> fields and `backend` discriminator for backward compatibility.

```typescript
// ── Types aligned with multi-backend-adapter-architecture.md ────────

type CliProvider = 'copilot' | 'gemini' | 'opencode' | 'cursor' | 'codex' | 'claude-acp';
type SdkProvider = 'claude-sdk';
type BackendType = 'acp' | 'sdk' | 'daemon' | 'mock';

// Flat start options — backward-compatible with existing AcpAdapter callers
interface AdapterStartOptions {
  cliCommand: string;         // Required for ACP, ignored by SDK
  baseArgs?: string[];        // Provider-specific ACP flags
  cliArgs?: string[];         // User-specified additional args
  cwd?: string;
  sessionId?: string;         // For resume (both ACP and SDK)
  backend?: BackendType;      // Default: 'acp' for backward compat
  // SDK-specific (ignored by AcpAdapter):
  model?: string;
  apiKey?: string;
  systemPrompt?: string;
  maxTurns?: number;
  allowedTools?: string[];
}

// Session info for listing (used by listSessions())
interface SessionInfo {
  sessionId: string;
  summary: string;
  lastModified: number;
  cwd?: string;
  gitBranch?: string;
}

// Adapter capabilities — queryable by consumers
interface AdapterCapabilities {
  supportsImages: boolean;
  supportsMcp: boolean;
  supportsPlans: boolean;
  supportsUsage: boolean;          // Token/cost tracking
  supportsSessionResume: boolean;  // Can resume sessions
  supportsThinking: boolean;       // Emits thinking events
  requiresProcess: boolean;        // true for subprocess, false for SDK
}

// AgentAdapter gains backend + capabilities fields
interface AgentAdapter extends EventEmitter {
  readonly type: string;
  readonly backend: BackendType;               // NEW
  readonly capabilities: AdapterCapabilities;  // NEW (was standalone)
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

// Factory expanded for all backend types
interface AdapterFactoryOptions {
  type: BackendType;
  provider?: CliProvider | SdkProvider;
  autopilot?: boolean;
  model?: string;
}
```

**Why flat options instead of discriminated union?** (per multi-backend doc)
The discriminated union (`AcpStartOptions | SdkStartOptions`) is more type-safe but breaks
backward compatibility — every existing `start()` call site needs updating. Flat with optional
fields enables incremental migration: add `backend: 'sdk'` to new callers, existing ACP callers
work unchanged.

### 4.3 ClaudeAdapter Implementation

```typescript
import { query, listSessions, type Query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import type {
  AgentAdapter, AdapterStartOptions, PromptContent,
  PromptOptions, PromptResult, UsageInfo, ToolCallInfo,
  ToolUpdateInfo, PlanEntry, PermissionRequest,
  AdapterCapabilities, BackendType
} from './types.js';

export class ClaudeAdapter extends EventEmitter implements AgentAdapter {
  readonly type = 'claude-sdk';
  readonly backend: BackendType = 'sdk';
  readonly capabilities: AdapterCapabilities = {
    supportsImages: true,
    supportsMcp: true,
    supportsPlans: false,
    supportsUsage: true,
    supportsSessionResume: true,
    supportsThinking: true,
    requiresProcess: false,
  };
  
  // Two-layer session ID: Flightdeck ID is returned immediately from start(),
  // SDK session ID is captured asynchronously and mapped via sdkSessionId.
  private flightdeckSessionId: string | null = null;
  private sdkSessionId: string | null = null;

  private _isConnected = false;
  private _isPrompting = false;
  private _promptingStartedAt: number | null = null;
  private activeQuery: Query | null = null;
  private abortController: AbortController | null = null;
  private cwd: string = process.cwd();
  private model: string;
  private autopilot: boolean;
  private pendingPermission: {
    resolve: (result: { allow: boolean }) => void;
  } | null = null;

  constructor(opts: { model?: string; autopilot?: boolean }) {
    super();
    this.model = opts.model ?? 'claude-sonnet-4-6';
    this.autopilot = opts.autopilot ?? false;
  }

  // ── Getters ──────────────────────────────────────────────
  get isConnected() { return this._isConnected; }
  get isPrompting() { return this._isPrompting; }
  get promptingStartedAt() { return this._promptingStartedAt; }
  get currentSessionId() { return this.flightdeckSessionId; }
  get supportsImages() { return true; }

  // ── Start / Resume ───────────────────────────────────────
  //
  // FIX C2: start() returns a stable Flightdeck-generated UUID immediately.
  // AgentManager can use this for session-to-agent mapping right away.
  // The real SDK session ID is captured asynchronously during the first
  // prompt() call and stored in sdkSessionId. The mapping between
  // flightdeckSessionId and sdkSessionId is persisted in the
  // agent_sessions table.
  //
  async start(opts: AdapterStartOptions): Promise<string> {
    this.cwd = opts.cwd ?? process.cwd();
    this.abortController = new AbortController();
    
    if (opts.sessionId) {
      // Resume: reuse the Flightdeck session ID and map to SDK session
      const sessions = await listSessions({ dir: this.cwd });
      const found = sessions.find(s => s.sessionId === opts.sessionId);
      if (!found) {
        throw new Error(`Session ${opts.sessionId} not found in ${this.cwd}`);
      }
      this.flightdeckSessionId = opts.sessionId;
      this.sdkSessionId = opts.sessionId;  // For resume, IDs are the same
    } else {
      // New session: generate a Flightdeck UUID now.
      // SDK session ID is captured in prompt() and mapped later.
      this.flightdeckSessionId = randomUUID();
      this.sdkSessionId = null;  // Will be set on first prompt()
    }

    this._isConnected = true;
    this.emit('connected', this.flightdeckSessionId);
    return this.flightdeckSessionId;
  }

  // ── Prompt ───────────────────────────────────────────────
  async prompt(content: PromptContent, opts?: PromptOptions): Promise<PromptResult> {
    if (!this._isConnected) throw new Error('Adapter not started');
    
    this._isPrompting = true;
    this._promptingStartedAt = Date.now();
    this.emit('prompting', true);
    this.emit('response_start');

    const promptText = typeof content === 'string'
      ? content
      : content.map(b => b.text ?? '').join('\n');

    const sdkOptions: Options = {
      cwd: this.cwd,
      model: this.model,
      abortController: this.abortController!,
      tools: { type: 'preset', preset: 'claude_code' },
      settingSources: ['project'],
      permissionMode: this.autopilot ? 'acceptEdits' : 'default',
      canUseTool: this.autopilot ? undefined : this.handlePermission.bind(this),
      // Resume the SDK session if we have one
      ...(this.sdkSessionId ? { resume: this.sdkSessionId } : {}),
      // Hooks for lifecycle events
      hooks: {
        SessionStart: [{ hooks: [this.onSessionStart.bind(this)] }],
        SessionEnd: [{ hooks: [this.onSessionEnd.bind(this)] }],
        PreToolUse: [{ hooks: [this.onPreToolUse.bind(this)] }],
        PostToolUse: [{ hooks: [this.onPostToolUse.bind(this)] }],
      },
    };

    try {
      this.activeQuery = query(promptText, sdkOptions);
      let lastUsage: UsageInfo | undefined;
      let stopReason: string = 'end_turn';

      for await (const message of this.activeQuery) {
        this.processMessage(message);
        
        // Capture SDK session ID from init message and persist mapping
        if (message.type === 'system' && message.subtype === 'init') {
          this.sdkSessionId = message.session_id;
          // Emit session_mapped so AgentManager can persist the mapping:
          //   flightdeckSessionId → sdkSessionId
          this.emit('session_mapped', {
            flightdeckSessionId: this.flightdeckSessionId,
            sdkSessionId: this.sdkSessionId,
          });
        }

        // Capture result
        if (message.type === 'result') {
          stopReason = message.subtype;
          if (message.usage) {
            lastUsage = {
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
            };
          }
          this.sdkSessionId = message.session_id;
        }
      }

      this.activeQuery = null;
      this._isPrompting = false;
      this._promptingStartedAt = null;
      
      const result: PromptResult = {
        stopReason: this.translateStopReason(stopReason),
        usage: lastUsage,
      };

      if (lastUsage) this.emit('usage', lastUsage);
      this.emit('prompt_complete', result.stopReason);
      this.emit('prompting', false);
      
      return result;
    } catch (err) {
      this._isPrompting = false;
      this._promptingStartedAt = null;
      this.emit('prompting', false);
      throw err;
    }
  }

  // ── Event Processing ─────────────────────────────────────
  private processMessage(message: SDKMessage): void {
    switch (message.type) {
      case 'assistant': {
        const content = message.message.content;
        for (const block of content) {
          if (block.type === 'text') {
            this.emit('text', block.text);
          } else if (block.type === 'thinking') {
            this.emit('thinking', block.thinking);
          } else if (block.type === 'tool_use') {
            const info: ToolCallInfo = {
              toolCallId: block.id,
              title: block.name,
              kind: block.name,
              status: 'running',
              content: JSON.stringify(block.input),
            };
            this.emit('tool_call', info);
          }
        }
        break;
      }
      case 'user': {
        // Tool results
        const content = message.message.content;
        for (const block of content) {
          if (block.type === 'tool_result') {
            const update: ToolUpdateInfo = {
              toolCallId: block.tool_use_id,
              status: block.is_error ? 'error' : 'completed',
              content: typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content),
            };
            this.emit('tool_call_update', update);
          }
        }
        break;
      }
      case 'system': {
        if (message.subtype === 'compact_boundary') {
          this.emit('text', '\n[Context compacted — older history summarized]\n');
        }
        break;
      }
    }
  }

  // ── Permission Handling ──────────────────────────────────
  private async handlePermission(
    input: { tool_name: string; tool_input: Record<string, unknown> },
    toolUseId: string | undefined,
    context: { signal: AbortSignal }
  ): Promise<{ result: 'allow' | 'deny'; reason?: string }> {
    return new Promise((resolve) => {
      this.pendingPermission = {
        resolve: ({ allow }) => {
          resolve({
            result: allow ? 'allow' : 'deny',
            reason: allow ? undefined : 'User denied',
          });
        },
      };

      this.emit('permission_request', {
        id: toolUseId ?? `perm-${Date.now()}`,
        toolName: input.tool_name,
        arguments: input.tool_input,
        timestamp: new Date().toISOString(),
      } satisfies PermissionRequest);

      // Auto-cancel after 60s
      setTimeout(() => {
        if (this.pendingPermission) {
          this.pendingPermission = null;
          resolve({ result: 'deny', reason: 'Permission timeout' });
        }
      }, 60_000);
    });
  }

  resolvePermission(approved: boolean): void {
    if (this.pendingPermission) {
      const { resolve } = this.pendingPermission;
      this.pendingPermission = null;
      resolve({ allow: approved });
    }
  }

  // ── Lifecycle ────────────────────────────────────────────
  async cancel(): Promise<void> {
    if (this.activeQuery) {
      this.activeQuery.interrupt();
    }
  }

  terminate(): void {
    this.abortController?.abort();
    this.activeQuery?.close();
    this.activeQuery = null;
    this._isConnected = false;
    this._isPrompting = false;
    this._promptingStartedAt = null;
    this.emit('exit', 0);
  }

  // ── Session Management (NEW) ─────────────────────────────
  async listSessions(): Promise<SessionInfo[]> {
    const sessions = await listSessions({ dir: this.cwd });
    return sessions.map(s => ({
      sessionId: s.sessionId,
      summary: s.summary,
      lastModified: s.lastModified,
      cwd: s.cwd,
      gitBranch: s.gitBranch,
    }));
  }

  // ── Hooks ────────────────────────────────────────────────
  private onSessionStart() { return {}; }
  private onSessionEnd() { return {}; }
  private onPreToolUse(input: any) {
    this.emit('tool_call', {
      toolCallId: input.tool_use_id ?? 'unknown',
      title: input.tool_name,
      kind: input.tool_name,
      status: 'pending',
    });
    return {};
  }
  private onPostToolUse(input: any) {
    this.emit('tool_call_update', {
      toolCallId: input.tool_use_id ?? 'unknown',
      status: input.error ? 'error' : 'completed',
    });
    return {};
  }

  // ── Helpers ──────────────────────────────────────────────
  private translateStopReason(subtype: string): StopReason {
    switch (subtype) {
      case 'success': return 'end_turn';
      case 'error_max_turns': return 'max_tokens';
      case 'error_max_budget_usd': return 'max_tokens';
      default: return 'error';
    }
  }
}
```

### 4.4 SQLite Session Persistence

The SDK handles its own session persistence at `~/.claude/projects/`. For Flightdeck, we need additional metadata in our database to link sessions to agents.

**Two-layer session ID design (C2 fix):**
- `flightdeck_session_id`: Generated by `start()` immediately via `randomUUID()`. Returned to AgentManager for instant mapping.
- `sdk_session_id`: Captured asynchronously from the SDK's `SystemMessage` init event during the first `prompt()` call. May be the same as `flightdeck_session_id` for resumed sessions.
- The `session_mapped` event (emitted during first prompt) tells AgentManager to persist the mapping.

```sql
-- New table: agent_sessions (links Flightdeck agents to SDK sessions)
CREATE TABLE agent_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,                       -- Flightdeck agent UUID
  flightdeck_session_id TEXT NOT NULL UNIQUE,   -- Returned by start(), used by AgentManager
  sdk_session_id TEXT,                          -- From SDK init, NULL until first prompt()
  adapter_type TEXT NOT NULL DEFAULT 'claude',  -- 'claude' | 'acp'
  cwd TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active',        -- active | paused | terminated
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0.0,
  metadata TEXT                                 -- JSON: { gitBranch, summary, ... }
);

CREATE INDEX idx_agent_sessions_agent ON agent_sessions(agent_id);
CREATE INDEX idx_agent_sessions_fd_session ON agent_sessions(flightdeck_session_id);
CREATE INDEX idx_agent_sessions_sdk_session ON agent_sessions(sdk_session_id);
CREATE INDEX idx_agent_sessions_status ON agent_sessions(status);
```

**Session mapping lifecycle:**
1. `start()` → inserts row with `flightdeck_session_id`, `sdk_session_id = NULL`
2. First `prompt()` → SDK returns init message → `session_mapped` event → UPDATE sets `sdk_session_id`
3. Future resumes use `sdk_session_id` for `query({ resume })`, `flightdeck_session_id` for agent lookups
4. For resumed sessions, `flightdeck_session_id === sdk_session_id` (no mapping needed)

**What to persist in Flightdeck DB vs what the SDK handles:**

| Data | Where | Why |
|------|-------|-----|
| Conversation history | SDK (`~/.claude/`) | SDK manages JSONL files natively |
| Session ↔ agent mapping | Flightdeck DB | Link Flightdeck IDs to SDK IDs |
| Token usage / cost | Flightdeck DB | Aggregate billing, budget enforcement |
| Permission decisions | Flightdeck DB | Audit trail |
| Session status | Flightdeck DB | Track active/paused/terminated |
| File changes | SDK (if checkpointing enabled) | Git-based file tracking |

### 4.5 Event Mapping: Complete Reference

| SDK Source | Adapter Event | Notes |
|-----------|---------------|-------|
| `SystemMessage` (init) | `'session_mapped'` ({flightdeckSessionId, sdkSessionId}) | Maps Flightdeck UUID → SDK UUID |
| `SystemMessage` (compact_boundary) | `'text'` (notification) | Context was compacted |
| `AssistantMessage` → text block | `'text'` (text) | Claude's response text |
| `AssistantMessage` → thinking block | `'thinking'` (text) | Extended thinking output |
| `AssistantMessage` → tool_use block | `'tool_call'` (ToolCallInfo) | Tool invocation started |
| `UserMessage` → tool_result block | `'tool_call_update'` (ToolUpdateInfo) | Tool execution completed |
| `ResultMessage` (success) | `'prompt_complete'` + `'usage'` | Task finished normally |
| `ResultMessage` (error_*) | `'prompt_complete'` (error reason) | Hit limit or crashed |
| `canUseTool` callback | `'permission_request'` | Need human approval |
| abort/close | `'exit'` (0) | Clean shutdown |
| SDK process error | `'exit'` (1) | Unexpected failure |

### 4.6 Permission Handling

The SDK's `canUseTool` callback provides richer information than ACP:

```typescript
// SDK provides:
{
  tool_name: 'Bash',
  tool_input: { command: 'rm -rf /' },
  signal: AbortSignal,
  suggestions: PermissionUpdate[],  // Suggested "remember" rules
  blockedPath: '/etc/passwd',
  decisionReason: 'File outside allowed directories',
  toolUseID: 'tu_abc123',
  agentID: 'subagent-security'       // If from subagent
}

// vs ACP provides:
{
  title: 'Tool action',
  description: 'Tool description',
  metadata: {},
  options: [{ optionId, kind: 'allow_once' | ... }]
}
```

The ClaudeAdapter translates the richer SDK permission request into our `PermissionRequest` interface, preserving the additional context for the UI.

### 4.7 Token Usage Tracking

```typescript
// From ResultMessage:
{
  usage: {
    input_tokens: 15234,
    output_tokens: 3421,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 12000,
  },
  cost_usd: 0.082,
  session_id: 'abc-123',
  duration_ms: 45200,
}

// Mapped to our UsageInfo + stored in agent_sessions table
```

### 4.8 Error Handling & Reconnection

**SDK-level errors:**
- `error_max_turns`: Resume with higher `maxTurns`
- `error_max_budget_usd`: Resume with higher `maxBudgetUsd`  
- `error_interrupted`: User cancelled; session preserved for resume
- AbortController abort: Clean termination

**Process-level errors:**
- The SDK runs in-process (no subprocess to crash)
- If the Node.js process crashes, sessions persist on disk
- On restart, `listSessions()` discovers prior sessions
- Resume with `query({ resume: sessionId })`

**API errors:**
- Rate limiting: SDK retries internally
- Auth failure: Emit error, adapter enters disconnected state
- Network issues: SDK handles retries

### 4.9 Daemon Integration

```
┌─────────────────────────────────────────────────────────┐
│                     Daemon Process                       │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Agent Runtime                        │   │
│  │                                                    │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │   │
│  │  │ Claude   │  │ Claude   │  │ ACP      │       │   │
│  │  │ Adapter  │  │ Adapter  │  │ Adapter  │       │   │
│  │  │ (agent1) │  │ (agent2) │  │ (copilot)│       │   │
│  │  │ SDK ────────── SDK ──────  │ subproc  │       │   │
│  │  └──────────┘  └──────────┘  └──────────┘       │   │
│  │       │              │              │              │   │
│  │       ▼              ▼              ▼              │   │
│  │  ~/.claude/    ~/.claude/     stdio/ndjson         │   │
│  └──────────────────────────────────────────────────┘   │
│                         │                                │
│                Unix Socket IPC                           │
│                         │                                │
└─────────────────────────┤────────────────────────────────┘
                          │
┌─────────────────────────┤────────────────────────────────┐
│                API Server (restartable)                    │
│                         │                                 │
│  ┌──────────────────────┤────────────────────────────┐   │
│  │  AgentManager ───────┘                             │   │
│  │  (talks to daemon via IPC)                         │   │
│  └────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

**Why SDK-based agents are better for the daemon:**

1. **No subprocess management**: SDK runs in-process. Daemon just holds adapter instances in memory.
2. **Natural resume**: On daemon restart, `listSessions()` discovers all prior sessions. Resume any of them.
3. **No event buffering needed**: SDK sessions pause cleanly (just stop iterating). Resume picks up where it left off.
4. **Resource efficiency**: One process for all Claude agents, vs. one subprocess per agent.
5. **Subagent control**: SDK manages subagents internally; daemon doesn't need to track child processes.

**Daemon startup flow:**
```
1. Daemon starts
2. Read agent_sessions table for status='active', get sdk_session_id for each
3. For each: create ClaudeAdapter, call start({ sessionId: sdk_session_id })
4. start() returns flightdeck_session_id immediately — mapping already exists in DB
5. Agents resume with full context from prior conversation
6. API server connects to daemon, AgentManager discovers running agents via flightdeck_session_id
```

---

## 5. Comparison: ACP (Option A) vs Direct SDK (Option B)

### 5.1 Feature Matrix

| Capability | Option A: ACP | Option B: SDK | Winner |
|-----------|---------------|---------------|--------|
| **Session create** | ✅ via AcpAdapter | ✅ via ClaudeAdapter | Tie |
| **Session resume** | ⚠️ ACP supports it, but AcpAdapter doesn't implement it | ✅ Native `query({ resume })` | **B** |
| **Session fork** | ⚠️ Same — protocol supports, adapter doesn't | ✅ Native `forkSession: true` | **B** |
| **Session list** | ⚠️ Same | ✅ `listSessions()` | **B** |
| **Session persist** | ✅ SDK-managed (through ACP binary) | ✅ SDK-managed (direct) | Tie |
| **Context compaction** | ✅ Transparent | ✅ Transparent + hook | **B** |
| **Subagents** | ⚠️ Supported but opaque | ✅ Full control via `agents` param | **B** |
| **Hooks** | ❌ Not exposed via ACP | ✅ 18 hook events | **B** |
| **Custom tools** | ❌ Can't add tools to ACP binary | ✅ MCP servers, SDK tools | **B** |
| **Permission UX** | ⚠️ Basic (option selection) | ✅ Rich (tool name, path, reason) | **B** |
| **Implementation effort** | 🟢 Low (enhance AcpAdapter) | 🟡 Medium (new adapter class) | **A** |
| **Maintenance burden** | 🟢 Low (delegate to binary) | 🟡 Medium (own the SDK integration) | **A** |
| **Works with Copilot** | ✅ Same adapter | ❌ Claude-only | **A** |
| **Daemon compatibility** | 🟡 Needs subprocess management | 🟢 In-process, natural fit | **B** |
| **Dependency** | `claude-agent-acp` binary | `@anthropic-ai/claude-agent-sdk` npm | Tie |

### 5.2 Resume Support Comparison

| Resume Scenario | Option A | Option B |
|----------------|----------|----------|
| Resume after agent crash | ⚠️ Need to add resumeSession to AcpAdapter | ✅ `query({ resume: id })` |
| Resume after server restart | ❌ ACP subprocess is gone | ✅ Session files persist, daemon resumes |
| Resume after machine reboot | ❌ Subprocess gone | ✅ Session files persist at `~/.claude/` |
| List past sessions | ⚠️ Need to add listSessions to AcpAdapter | ✅ `listSessions()` |
| Fork to try alternative | ⚠️ Need to add forkSession to AcpAdapter | ✅ `forkSession: true` |
| Resume specific subagent | ❌ Not exposed via ACP | ✅ Resume session + agent ID in prompt |

### 5.3 Maintainability

**Option A (ACP):**
- Pro: Zed maintains the ACP adapter (800+ lines of event translation)
- Pro: Same AcpAdapter works for Copilot and Claude
- Con: We depend on Zed's release cadence for SDK updates
- Con: ACP protocol is an abstraction layer that may lag SDK features

**Option B (SDK):**
- Pro: Direct access to all SDK features on day one
- Pro: Version-pinned dependency we control
- Pro: Better for daemon architecture
- Con: ~400 lines of adapter code to maintain
- Con: Claude-specific (doesn't help with Copilot)

### 5.4 Recommendation

**Build both. Use them for different things.**

```
┌─────────────────────────────────────────────────────┐
│               AgentAdapter Interface                 │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐│
│  │  AcpAdapter   │  │ ClaudeAdapter │  │MockAdapter ││
│  │  (Copilot CLI)│  │ (Claude SDK)  │  │ (tests)   ││
│  │  subprocess   │  │ in-process    │  │            ││
│  │  stdio/ndjson │  │ direct API    │  │            ││
│  └──────────────┘  └──────────────┘  └────────────┘│
└─────────────────────────────────────────────────────┘
```

- **AcpAdapter**: Keep for Copilot CLI (and as a fallback for Claude via claude-agent-acp)
- **ClaudeAdapter**: Build for Claude with full session lifecycle, daemon integration, and hooks
- **MockAdapter**: Keep for tests

**Why not just enhance AcpAdapter?**
Because the fundamental architecture is different:
- AcpAdapter manages a **subprocess** → the ACP binary owns the SDK session
- ClaudeAdapter uses the SDK **in-process** → Flightdeck owns the session directly

The subprocess model can't survive server restarts without a daemon. The in-process model gives the daemon native session ownership. For the #1 pain point (session resume), the direct SDK approach is architecturally correct.

---

## 6. Implementation Plan

### Phase 1: Core Adapter (Day 1)
- [ ] `packages/server/src/adapters/ClaudeAdapter.ts` — ~400 lines
- [ ] Event mapping: SDK messages → AgentAdapter events
- [ ] Basic prompt flow: create session, stream messages, return result
- [ ] Permission handling via `canUseTool`
- [ ] Token usage tracking
- [ ] Update `AdapterFactoryOptions` to include `'claude'` type
- [ ] Update factory in `adapters/index.ts`

### Phase 2: Session Lifecycle (Day 1-2)
- [ ] Session resume: `start({ resumeSessionId })` → `query({ resume })`
- [ ] Session list: `listSessions()` method
- [ ] Session fork: `start({ forkSessionId })` → `query({ forkSession })`
- [ ] SQLite `agent_sessions` table (Drizzle schema)
- [ ] Persist session mapping on create/resume

### Phase 3: Integration (Day 2)
- [ ] Update `AgentManager.spawn()` to accept adapter type
- [ ] Config: `CLAUDE_API_KEY` env var, model selection
- [ ] Update `AgentAcpBridge` or create `AgentClaudeBridge`
- [ ] Wire into container.ts (DI registration)
- [ ] Update AdapterStartOptions in shared types

### Phase 4: Daemon Support (Day 3+)
- [ ] Daemon holds ClaudeAdapter instances in memory
- [ ] On daemon start: resume active sessions from DB
- [ ] IPC: expose session management via JSON-RPC
- [ ] API server reconnects to daemon's running adapters

### Phase 5: Tests (Throughout)
- [ ] Unit tests for ClaudeAdapter event mapping
- [ ] Integration test with MockAdapter pattern
- [ ] Session resume round-trip test
- [ ] Permission flow test

---

## 7. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| SDK V2 API is unstable | Medium | Use V1 `query()` API (stable). V2 is preview only. |
| SDK breaking changes | Medium | Pin version in package.json. Test on upgrade. |
| Context window limits | Low | SDK handles compaction automatically. Use subagents for large tasks. |
| API key management | Medium | Use existing secret handling (R12 redaction). Environment variable. |
| Cost runaway | High | Set `maxBudgetUsd` per session. Track in agent_sessions table. |
| Session file corruption | Low | SDK manages JSONL files. Worst case: start fresh session. |
| Copilot CLI parity | Low | Different tools, different UX. Don't try to make them identical. |

---

## 8. Key Takeaways

1. **Session resume is THE differentiator.** The Claude SDK gives us full session lifecycle that Copilot CLI lacks. This alone justifies a direct adapter.

2. **In-process > subprocess for the daemon.** The SDK runs as a library, not a binary. The daemon holds sessions in memory and resumes them natively. No subprocess management needed.

3. **The two adapters coexist.** AcpAdapter for Copilot CLI (subprocess model). ClaudeAdapter for Claude SDK (in-process model). Same interface, different backends.

4. **SDK handles the hard parts.** Session persistence, context compaction, tool execution, retry logic — all built in. The adapter is ~400 lines of event translation, not 2000 lines of agent loop reimplementation.

5. **Hooks unlock governance.** The SDK's 18 hook events map cleanly to our R4 GovernancePipeline. Pre/post tool hooks → governance pre/post hooks. This is a natural integration point.

---

## 9. Review Log

| Finding | Severity | Fix Applied |
|---------|----------|-------------|
| **C2**: `start()` returns `'pending'` for new sessions — breaks AgentManager session-to-agent mapping | MEDIUM | Two-layer session ID: `start()` generates a Flightdeck UUID (`randomUUID()`) returned immediately. SDK session ID captured asynchronously during first `prompt()` and mapped via `session_mapped` event. SQLite `agent_sessions` table stores both IDs. |
| **A1**: `AdapterStartOptions` conflicts with multi-backend-adapter-architecture.md | HIGH | Replaced custom interface with flat `AdapterStartOptions` from reconciled design (e7f14c5e): `backend?: BackendType`, `sessionId?: string` (not `resumeSessionId`/`forkSessionId`), added `baseArgs`, `model`, `apiKey`, `systemPrompt`, `maxTurns`, `allowedTools`. Aligned `AdapterCapabilities` fields (`supportsUsage`, `supportsSessionResume`, `supportsThinking`, `requiresProcess`). Aligned `AdapterFactoryOptions` with `BackendType` + `provider`. |
