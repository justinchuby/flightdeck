# Multi-CLI ACP Support Research

> **Author**: Architect (e7f14c5e)  
> **Date**: 2026-03-07  
> **Context**: R9 created the AgentAdapter abstraction layer. AcpAdapter currently talks to Copilot CLI only. This report evaluates 4 additional CLIs for multi-backend support.

---

## Executive Summary

All 4 CLIs (Gemini, OpenCode, Codex, Cursor) support ACP over stdio with JSON-RPC. The protocol is standardized enough that a **single AcpAdapter with per-CLI configuration** can support all of them — no separate adapter classes needed. The key differences are in spawn commands, session management capabilities, and CLI-specific quirks.

**Recommendation**: Extend AdapterStartOptions with a `provider` field and CLI-specific argument presets. The core AcpAdapter logic (JSON-RPC framing, event handling, prompt/cancel) is protocol-level and works unchanged across all CLIs.

---

## ACP Protocol Overview

All CLIs implement ACP v1 (protocol version 1), a JSON-RPC 2.0 protocol over stdio:

| Method | Direction | Description |
|--------|-----------|-------------|
| `initialize` | Client → Agent | Capability negotiation, protocol version |
| `session/new` | Client → Agent | Create a new conversation session |
| `session/load` | Client → Agent | Resume an existing session (if supported) |
| `session/prompt` | Client → Agent | Send user message, get response |
| `session/cancel` | Client → Agent | Abort in-progress prompt |
| `session/update` | Agent → Client | Streaming events (text, tool_call, plan, usage) |
| `session/request_permission` | Agent → Client | Ask permission for tool execution |

### Session Update Event Types (via `session/update`)

| Event | Description | Supported By |
|-------|-------------|-------------|
| `agent_message_chunk` | Streaming text output | All CLIs |
| `agent_thought_chunk` | Thinking/reasoning content | Copilot, Gemini, Cursor |
| `tool_call` | Tool invocation start | All CLIs |
| `tool_call_update` | Tool progress/completion | All CLIs |
| `plan` | Structured plan entries | Copilot, Cursor |
| `usage_update` | Context window/token usage | Copilot, Codex |
| `available_commands` | Slash commands update | Cursor, Codex |
| `mode_change` | Mode switch notification | Cursor |

---

## CLI Comparison

### 1. GitHub Copilot CLI (Current — Baseline)

| Attribute | Value |
|-----------|-------|
| **Spawn command** | `copilot --acp --stdio` |
| **ACP version** | 1 (native, reference implementation) |
| **Session create** | `session/new` ✅ |
| **Session resume** | `copilot --continue` (last session), `copilot --resume` (picker) — CLI flags, NOT ACP method |
| **Session load (ACP)** | ✅ Supported via `session/load` |
| **Tool calls** | Full: bash, file read/write, grep, glob, web fetch |
| **Permission model** | `session/request_permission` with allow_once/allow_always/deny options |
| **Thinking events** | ✅ `agent_thought_chunk` |
| **Plan events** | ✅ `plan` entries with priority/status |
| **Usage events** | ✅ `usage_update` (size, used, cost) |
| **Image support** | ✅ Via capability negotiation |
| **Config env vars** | `COPILOT_CLI_PATH` (binary path) |
| **Session storage** | `~/.copilot/session-state/` |
| **Agent files** | `~/.copilot/agents/*.agent.md` |

**Copilot-specific patterns in our codebase:**
- `~/.copilot/agents/` directory for agent definition files
- Session ID format: UUID-like strings
- `--acp --stdio` as hardcoded spawn args
- `mcpServers: []` passed to `newSession()` (MCP server support)
- `COPILOT_CLI_PATH` env var for binary location

### 2. Google Gemini CLI

| Attribute | Value |
|-----------|-------|
| **Spawn command** | `gemini --experimental-acp` |
| **ACP version** | 1 (experimental) |
| **Session create** | `session/new` ✅ |
| **Session resume** | ❌ NOT supported in ACP mode — always new session. `--resume` flag is ignored when `--experimental-acp` is set |
| **Session load (ACP)** | ❌ `session/load` returns "method not found" |
| **Tool calls** | Shell execution, file read/write, web search |
| **Permission model** | `session/request_permission` ✅ (standard ACP) |
| **Thinking events** | ✅ `agent_thought_chunk` |
| **Plan events** | ❌ Not emitted |
| **Usage events** | ❌ Not emitted (no token counting exposed) |
| **Image support** | ✅ Gemini models natively support multimodal |
| **Config env vars** | `GEMINI_API_KEY` or `GOOGLE_API_KEY` (required) |
| **Model selection** | `--model gemini-2.5-pro` as CLI arg |
| **Session storage** | Internal (not accessible in ACP mode) |

**Key differences from Copilot:**
- No `--stdio` flag needed (implied by `--experimental-acp`)
- No session resume in ACP mode — context is lost on restart
- No plan events — our PlanEntry handling will be empty
- No usage_update events — BudgetEnforcer can't track Gemini token usage
- Requires API key env var (Copilot uses GitHub auth)
- `--experimental-acp` flag name suggests it may change

**Spawn args**: `['--experimental-acp', '--model', modelName]`

### 3. OpenCode CLI

| Attribute | Value |
|-----------|-------|
| **Spawn command** | `opencode acp` |
| **ACP version** | 1 |
| **Session create** | `session/new` ✅ |
| **Session resume** | Unknown/client-dependent |
| **Session load (ACP)** | Not documented |
| **Tool calls** | Shell, file operations, custom tools, formatters, linters |
| **Permission model** | `session/request_permission` ✅ (standard ACP) |
| **Thinking events** | ✅ |
| **Plan events** | ❌ Not documented |
| **Usage events** | ❌ Not documented |
| **Image support** | Depends on backing model |
| **Config env vars** | `OPENCODE_API_KEY` (provider-dependent) |
| **Model selection** | Via config file (`~/.opencode/config.yaml`) or env vars |
| **Custom tools** | ✅ OpenCode supports project-specific custom tools |

**Key differences from Copilot:**
- Subcommand `acp` instead of flags (`--acp --stdio`)
- Supports custom tools and project-specific rules
- Some slash commands (`/undo`, `/redo`) not fully supported in ACP mode
- Config-file-driven (not CLI args for model selection)
- Multi-provider: can use OpenAI, Anthropic, Google, etc. as backends

**Spawn args**: `['acp']`

### 4. Cursor CLI

| Attribute | Value |
|-----------|-------|
| **Spawn command** | `agent acp` (Cursor's `agent` binary) |
| **ACP version** | 1 |
| **Session create** | `session/new` ✅ |
| **Session resume** | ✅ Supports `session/load` |
| **Session load (ACP)** | ✅ |
| **Tool calls** | Full: bash, file operations, code editing |
| **Permission model** | `session/request_permission` ✅ |
| **Thinking events** | ✅ |
| **Plan events** | ✅ |
| **Usage events** | Partial (model-dependent) |
| **Image support** | ✅ |
| **Config env vars** | `CURSOR_API_KEY` |
| **Model selection** | Via ACP initialization or config |
| **Extensions** | Custom methods: `cursor/ask_question`, `cursor/generate_image` |

**Key differences from Copilot:**
- Binary name is `agent`, subcommand is `acp`
- Supports custom ACP extension methods (non-standard)
- Session resume works via standard `session/load`
- Requires Cursor subscription for authentication
- Extension methods would need to be gracefully ignored by our adapter

**Spawn args**: `['acp']`

### 5. OpenAI Codex CLI

| Attribute | Value |
|-----------|-------|
| **Spawn command** | `codex --acp` or via `codex-acp` adapter |
| **ACP version** | 1 (via adapter) |
| **Session create** | `session/new` ✅ |
| **Session resume** | Client-dependent (transcripts stored locally) |
| **Session load (ACP)** | Via adapter support |
| **Tool calls** | Bash, file operations, code editing |
| **Permission model** | `session/request_permission` ✅ (approval modes: on-request/untrusted/never) |
| **Thinking events** | ✅ |
| **Plan events** | ❌ Not documented |
| **Usage events** | ✅ Token usage tracking |
| **Image support** | ✅ Multimodal input |
| **Config env vars** | `OPENAI_API_KEY` or ChatGPT login |
| **Model selection** | `--model gpt-5` as CLI arg |
| **Sandbox modes** | Configurable sandbox enforcement |
| **Session storage** | `~/.codex/sessions/` |

**Key differences from Copilot:**
- `codex-acp` is a separate Rust adapter (not built into Codex CLI natively)
- Approval modes (on-request/untrusted/never) differ from Copilot's permission options
- Configurable sandbox enforcement (network, filesystem isolation)
- Non-PTY mode in ACP (no interactive terminal features)
- Multiple concurrent sessions supported (configurable limit)

**Spawn args**: `['--acp']` (native) or via `codex-acp` binary

---

## Compatibility Matrix

| Feature | Copilot | Gemini | OpenCode | Cursor | Codex |
|---------|---------|--------|----------|--------|-------|
| ACP v1 | ✅ | ✅ (experimental) | ✅ | ✅ | ✅ (adapter) |
| `session/new` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `session/load` | ✅ | ❌ | ❓ | ✅ | ❓ |
| `session/prompt` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `session/cancel` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `agent_message_chunk` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `agent_thought_chunk` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `tool_call` / `tool_call_update` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `plan` | ✅ | ❌ | ❌ | ✅ | ❌ |
| `usage_update` | ✅ | ❌ | ❌ | ⚠️ | ✅ |
| Permission request | ✅ | ✅ | ✅ | ✅ | ✅ |
| Image input | ✅ | ✅ | ⚠️ | ✅ | ✅ |
| MCP servers | ✅ | ❓ | ❓ | ❓ | ❓ |

---

## Current AcpAdapter — Copilot-Specific Assumptions

### Analysis of `packages/server/src/adapters/AcpAdapter.ts` (402 lines)

| Line(s) | Assumption | Impact | Fix |
|---------|-----------|--------|-----|
| 133 | `args = ['--acp', '--stdio', ...]` — hardcoded flags | ❌ Gemini uses `--experimental-acp`, OpenCode uses subcommand `acp`, Cursor uses `agent acp` | Move to provider-specific presets |
| 105-108 | `newSession({ cwd, mcpServers: [] })` — always new session, MCP param | ⚠️ MCP may not be supported by all CLIs. Gemini doesn't support `session/load` | Make `mcpServers` optional, add `session/load` path |
| 52-60 | `translateStopReason()` — maps ACP StopReason values | ✅ Protocol-level, same across CLIs | No change needed |
| 62-68 | `toSdkContentBlocks()` — ContentBlock translation | ✅ Protocol-level, same across CLIs | No change needed |
| 172-201 | `requestPermission` handler — `allow_once` option matching | ⚠️ Codex has different approval modes. Permission option kinds may vary | Add fallback for unknown option kinds |
| 203-272 | `sessionUpdate` handler — event type switch | ✅ Protocol-level. CLIs that don't emit certain events (plan, usage_update) simply won't trigger those cases | No change needed (graceful) |
| 277-281 | `initialize({ protocolVersion: acp.PROTOCOL_VERSION })` | ✅ All CLIs use protocol version 1 | No change needed |
| 118-128 | `validateCliCommand()` — error message references `COPILOT_CLI_PATH` | ⚠️ Misleading for non-Copilot CLIs | Generalize error message |

### Analysis of `packages/server/src/config.ts`

| Line | Assumption | Impact | Fix |
|------|-----------|--------|-----|
| 47 | `cliCommand: process.env.COPILOT_CLI_PATH \|\| 'copilot'` | ❌ Hardcoded to Copilot | Add `CLI_PROVIDER` env var, provider-specific defaults |
| 48 | `cliArgs: []` | ⚠️ No provider-specific args | Populate from provider preset |

### Analysis of `packages/server/src/agents/agentFiles.ts`

| Line | Assumption | Impact | Fix |
|------|-----------|--------|-----|
| 7 | `AGENTS_DIR = join(homedir(), '.copilot', 'agents')` | ❌ Only Copilot uses `~/.copilot/agents/` | Make per-provider or skip for non-Copilot |

### Analysis of `packages/server/src/container.ts`

| Line | Assumption | Impact | Fix |
|------|-----------|--------|-----|
| 472 | `cliCommand: 'copilot'` | ❌ Hardcoded fallback | Use config.cliCommand |

---

## Recommended Architecture Changes

### 1. Provider Configuration (Small — config only)

```typescript
// config.ts
export type CliProvider = 'copilot' | 'gemini' | 'opencode' | 'cursor' | 'codex';

export interface CliProviderConfig {
  provider: CliProvider;
  command: string;         // binary name or path
  baseArgs: string[];      // provider-specific ACP flags
  envVars?: Record<string, string>;  // required env vars
  supportsSessionLoad: boolean;
  supportsPlans: boolean;
  supportsUsage: boolean;
  agentFilesDir?: string;  // where to write agent definition files
}

const PROVIDER_PRESETS: Record<CliProvider, CliProviderConfig> = {
  copilot: {
    provider: 'copilot',
    command: 'copilot',
    baseArgs: ['--acp', '--stdio'],
    supportsSessionLoad: true,
    supportsPlans: true,
    supportsUsage: true,
    agentFilesDir: '~/.copilot/agents',
  },
  gemini: {
    provider: 'gemini',
    command: 'gemini',
    baseArgs: ['--experimental-acp'],
    envVars: { GEMINI_API_KEY: '' },
    supportsSessionLoad: false,
    supportsPlans: false,
    supportsUsage: false,
  },
  opencode: {
    provider: 'opencode',
    command: 'opencode',
    baseArgs: ['acp'],
    supportsSessionLoad: false,
    supportsPlans: false,
    supportsUsage: false,
  },
  cursor: {
    provider: 'cursor',
    command: 'agent',
    baseArgs: ['acp'],
    envVars: { CURSOR_API_KEY: '' },
    supportsSessionLoad: true,
    supportsPlans: true,
    supportsUsage: false,
  },
  codex: {
    provider: 'codex',
    command: 'codex',
    baseArgs: ['--acp'],
    envVars: { OPENAI_API_KEY: '' },
    supportsSessionLoad: false,
    supportsPlans: false,
    supportsUsage: true,
  },
};
```

### 2. AcpAdapter Changes (Small — 3 edits)

```typescript
// AcpAdapter.ts — change spawn args to use provider config
private async spawnAndConnect(opts: AdapterStartOptions): Promise<void> {
  this.validateCliCommand(opts.cliCommand);
  
  // Use provider-specific base args instead of hardcoded '--acp', '--stdio'
  const args = [...(opts.baseArgs || ['--acp', '--stdio']), ...(opts.cliArgs || [])];
  this.process = spawn(opts.cliCommand, args, { ... });
  ...
}
```

```typescript
// AdapterStartOptions — add baseArgs
export interface AdapterStartOptions {
  cliCommand: string;
  baseArgs?: string[];     // NEW: provider-specific flags
  cliArgs?: string[];
  cwd?: string;
  sessionId?: string;      // NEW: for session/load support
}
```

```typescript
// AcpAdapter.start() — support session/load
async start(opts: AdapterStartOptions): Promise<string> {
  await this.spawnAndConnect(opts);
  
  let sessionId: string;
  if (opts.sessionId) {
    // Try to resume an existing session
    try {
      const loadResult = await this.connection!.loadSession({ sessionId: opts.sessionId });
      sessionId = loadResult.sessionId;
    } catch {
      // Fallback to new session if load not supported
      const newResult = await this.connection!.newSession({
        cwd: opts.cwd || process.cwd(),
        mcpServers: [],
      });
      sessionId = newResult.sessionId;
    }
  } else {
    const sessionResult = await this.connection!.newSession({
      cwd: opts.cwd || process.cwd(),
      mcpServers: [],
    });
    sessionId = sessionResult.sessionId;
  }
  
  this.sessionId = sessionId;
  this._isConnected = true;
  this.emit('connected', sessionId);
  return sessionId;
}
```

### 3. AdapterFactory Changes (Small — type field expansion)

```typescript
// types.ts
export interface AdapterFactoryOptions {
  type: 'acp' | 'mock';
  provider?: CliProvider;   // NEW: which CLI to use
  autopilot?: boolean;
}
```

### 4. Agent Files (Copilot-specific, gate behind provider check)

```typescript
// agentFiles.ts
export function writeAgentFiles(roles: Role[], provider: CliProvider): void {
  if (provider !== 'copilot') return;  // Only Copilot uses .agent.md files
  // ... existing logic
}
```

---

## What Does NOT Need to Change

The following are protocol-level and work identically across all CLIs:

1. **`AgentAdapter` interface** — the abstraction boundary is correct
2. **Event handling** (`sessionUpdate` switch) — CLIs that don't emit certain events simply don't trigger those cases
3. **`translateStopReason()`** — protocol-level stop reasons are standardized
4. **`toSdkContentBlocks()`** — content block format is standardized
5. **`prompt()` method** — `session/prompt` is universal
6. **`cancel()` method** — `session/cancel` is universal
7. **`terminate()` method** — process kill is OS-level
8. **`resolvePermission()`** — permission flow is standardized
9. **`MockAdapter`** — test adapter is provider-agnostic
10. **All downstream code** (AgentManager, CommandDispatcher, etc.) — they use AgentAdapter interface, zero CLI awareness

---

## Implementation Plan

### Phase 1: Configuration (1-2 hours)
- Add `CliProvider` type and `PROVIDER_PRESETS` to config
- Add `CLI_PROVIDER` env var (default: `'copilot'`)
- Update `AdapterStartOptions` with `baseArgs` and `sessionId`
- Update container.ts to pass provider config

### Phase 2: AcpAdapter Updates (1-2 hours)
- Replace hardcoded `['--acp', '--stdio']` with `opts.baseArgs`
- Add `session/load` try-catch path in `start()`
- Generalize error messages (remove COPILOT_CLI_PATH reference)
- Gate agent file writing behind provider check

### Phase 3: Per-CLI Testing (2-3 hours per CLI)
- Install each CLI locally
- Spawn via Flightdeck, verify connection + prompt + events
- Document any per-CLI quirks discovered during testing
- Add integration test with MockAdapter simulating each CLI's event profile

### Phase 4: UI Support (1-2 hours)
- Add CLI provider indicator to agent status display
- Show provider in agent detail panel
- Handle missing features gracefully (e.g., "Usage data not available for Gemini")

**Total estimated effort**: 1-2 days for Phase 1-2, then per-CLI testing as needed.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Gemini `--experimental-acp` flag changes | Medium | Low | Flag is in provider preset, 1-line fix |
| CLI-specific ACP extensions break adapter | Low | Low | Unknown methods are ignored by JSON-RPC |
| Permission option kinds vary across CLIs | Medium | Medium | Add fallback logic in permission handler |
| Session/load not supported → silent failure | Medium | Low | Try-catch with fallback to new session |
| Different token usage reporting formats | Medium | Low | Normalize in adapter, emit consistent UsageInfo |
| Codex-acp adapter (Rust) has breaking changes | Medium | Medium | Monitor codex-acp releases, pin version |

---

## Conclusion

The R9 `AgentAdapter` abstraction was designed for exactly this use case. Supporting multiple CLIs requires:
- **~50 lines of config changes** (provider presets)
- **~30 lines of AcpAdapter changes** (baseArgs, session/load, error messages)
- **~5 lines of gate logic** (agent files, provider-specific features)

The core protocol handling is already universal. The AcpAdapter doesn't need to become 4 separate adapters — it's one adapter with configurable spawn parameters. This validates the R9 design decision to isolate all SDK interaction in a single file.
