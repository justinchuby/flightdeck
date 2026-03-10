# Claude Agent SDK Comparison — Research Report

**Author:** Architect Agent (5699527d)
**Date:** 2026-03-07

---

## Executive Summary

**Recommendation: Option A — Use `claude-agent-acp` as a drop-in CLI binary via Flightdeck's existing AcpAdapter. Zero new code needed.**

The two things being compared aren't alternatives — they're layers of the same stack:
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) = the engine (no ACP)
- **claude-agent-acp** (`@zed-industries/claude-agent-acp`) = the ACP wrapper around that engine

Flightdeck already speaks ACP. The `claude-agent-acp` binary speaks ACP. Connect them and Claude agents work immediately.

---

## 1. What Each Thing Is

### Official Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

Anthropic's official TypeScript SDK for building autonomous agents powered by Claude.

| Aspect | Detail |
|--------|--------|
| **Package** | `@anthropic-ai/claude-agent-sdk` v0.2.68 |
| **Publisher** | Anthropic |
| **Core API** | `query({ prompt, options })` → async generator of messages |
| **Transport** | In-process (no protocol) — it spawns a Claude Code subprocess internally |
| **Tools** | Built-in: Read, Write, Edit, Bash, Glob, Grep, Task, WebSearch, etc. |
| **Protocol** | MCP (Model Context Protocol) for external tools. **No ACP support.** |
| **Sessions** | Session persistence in `~/.claude/sessions/`, resume/fork/list |
| **Auth** | ANTHROPIC_API_KEY env var, or Bedrock/Vertex/Azure gateways |
| **Streaming** | Yes — message types: system, assistant, result, stream_event, tool_progress |
| **Permissions** | `permissionMode`: default, acceptEdits, dontAsk, plan, bypassPermissions |

### claude-agent-acp (`@zed-industries/claude-agent-acp`)

Zed Industries' ACP adapter that wraps the Claude Agent SDK. Originally built for the Zed editor.

| Aspect | Detail |
|--------|--------|
| **Package** | `@zed-industries/claude-agent-acp` v0.20.2 |
| **Publisher** | Zed Industries |
| **Core** | ACP protocol server using `@agentclientprotocol/sdk` v0.14.1 |
| **Engine** | Uses `@anthropic-ai/claude-agent-sdk` v0.2.68 internally |
| **Transport** | stdio (ndjson) — exact same protocol Flightdeck's AcpAdapter speaks |
| **ACP Compliance** | Full: initialize, newSession, resumeSession, forkSession, listSessions, loadSession, prompt, cancel, authenticate, setSessionMode/Model/Config, readTextFile, writeTextFile |
| **Source** | 3,223 lines (source) + 3,785 lines (tests) across 6 source files |
| **Maturity** | v0.20.2, active development (385+ PRs), Apache-2.0 license |
| **CLI Binary** | `claude-agent-acp` — can be spawned as subprocess |

### Key Insight

**These are not alternatives.** claude-agent-acp uses the Claude Agent SDK internally. The relationship is:

```
Flightdeck AcpAdapter ──stdio/ndjson──► claude-agent-acp ──in-process──► Claude Agent SDK ──API──► Claude
```

This is architecturally identical to how Copilot works today:

```
Flightdeck AcpAdapter ──stdio/ndjson──► copilot-agent     ──in-process──► Copilot CLI       ──API──► GitHub
```

---

## 2. Flightdeck's Adapter Interface

From `packages/server/src/adapters/types.ts` (created by R9):

```typescript
interface AgentAdapter extends EventEmitter {
  readonly type: string;           // 'acp', 'mock', or 'claude'
  readonly isConnected: boolean;
  readonly isPrompting: boolean;
  readonly currentSessionId: string | null;
  readonly supportsImages: boolean;

  start(opts: AdapterStartOptions): Promise<string>;   // → sessionId
  prompt(content: PromptContent, opts?): Promise<PromptResult>;
  cancel(): Promise<void>;
  terminate(): void;
  resolvePermission(approved: boolean): void;
}
```

Events: `text`, `thinking`, `tool_call`, `tool_call_update`, `plan`, `usage`, `usage_update`, `exit`, `prompting`, `prompt_complete`, `response_start`, `permission_request`, `idle`, `connected`.

The existing `AcpAdapter` spawns a CLI binary, talks ACP over stdio, and translates ACP events into these adapter events.

---

## 3. Three Integration Options

### Option A: Use claude-agent-acp as CLI binary (RECOMMENDED)

**Approach:** Configure Flightdeck to spawn `claude-agent-acp` instead of `copilot-agent`. The existing `AcpAdapter` handles everything.

**Changes required:**
- `config.cliCommand = 'npx @zed-industries/claude-agent-acp'` (or `claude-agent-acp` if installed globally)
- `config.cliArgs = ['--agent=developer']` (or equivalent role flag)
- Set `ANTHROPIC_API_KEY` in environment

**New code:** Zero lines. The existing AcpAdapter already speaks ACP.

| Pro | Con |
|-----|-----|
| Zero code changes | Subprocess overhead (~50MB per agent) |
| Battle-tested ACP bridge (Zed uses it in production) | Depends on Zed's maintenance of the package |
| Full session resume/fork support out of the box | CLI arg mapping may differ from Copilot |
| Isolated failure domain (crash doesn't kill server) | Extra process per agent |

### Option B: Create ClaudeAdapter using Claude Agent SDK directly (in-process)

**Approach:** New `ClaudeAdapter` class that implements `AgentAdapter`, calls `query()` from `@anthropic-ai/claude-agent-sdk` in-process without subprocess.

**Changes required:**
- New file `packages/server/src/adapters/ClaudeAdapter.ts` (~300-500 lines)
- Translate SDK message types to adapter events
- Handle session management, permissions, tool callbacks
- Update adapter factory in `index.ts`

| Pro | Con |
|-----|-----|
| No subprocess overhead | Must implement all ACP-equivalent event translation (~800 lines in claude-agent-acp) |
| Direct control over SDK options | SDK crash takes down entire server |
| Can access Claude-specific features directly | Tight coupling to SDK version — breaking changes hit directly |
| Potentially lower latency | Must handle session persistence yourself |

### Option C: Fork/vendor claude-agent-acp as a library (in-process, ACP-less)

**Approach:** Import `ClaudeAcpAgent` from claude-agent-acp and call it programmatically without stdio.

**Changes required:**
- Depend on `@zed-industries/claude-agent-acp` as library (it exports `ClaudeAcpAgent`)
- Write adapter that bridges between `ClaudeAcpAgent` and Flightdeck's `AgentAdapter`

| Pro | Con |
|-----|-----|
| Reuses Zed's battle-tested translation layer | Library API is less stable than CLI binary |
| No subprocess overhead | Tied to Zed's release cadence |
| Gets all tool translations for free | ACP client/server plumbing adds complexity |

---

## 4. Detailed Comparison

### ACP Protocol Compatibility

| Feature | claude-agent-acp | Claude Agent SDK |
|---------|-----------------|------------------|
| ACP protocol version | v1 ✅ | N/A — no ACP |
| ndjson over stdio | ✅ | N/A |
| initialize/newSession | ✅ | N/A (has own session API) |
| resumeSession | ✅ | ✅ (via SDK's resume) |
| forkSession | ✅ | N/A |
| listSessions | ✅ | ✅ (via SDK's getSessionMessages) |
| prompt (streaming) | ✅ | ✅ (async generator) |
| cancel | ✅ | ✅ |
| Permission requests | ✅ (full ACP flow) | ✅ (canUseTool callback) |
| Tool call tracking | ✅ (20+ tool types mapped) | ✅ (raw tool_use blocks) |
| Image support | ✅ | ✅ |
| MCP servers | ✅ (pass-through) | ✅ (native) |

### Maturity & Maintenance

| Metric | claude-agent-acp | Claude Agent SDK |
|--------|-----------------|------------------|
| Version | 0.20.2 | 0.2.68 |
| Publisher | Zed Industries | Anthropic |
| License | Apache-2.0 | Apache-2.0 |
| Source lines | 3,223 | N/A (internal to Anthropic) |
| Test lines | 3,785 (8 suites) | N/A |
| Active development | ✅ (385+ PRs) | ✅ (Anthropic-maintained) |
| npm weekly downloads | Moderate (Zed users) | High (official SDK) |
| Breaking change risk | Medium (Zed iteration) | High (pre-1.0, 0.2.x) |

### Integration Effort with AgentAdapter

| Approach | New code | Risk | Time |
|----------|----------|------|------|
| **A: CLI binary** | 0 lines | Very low | < 1 hour |
| **B: Direct SDK** | 300-500 lines | High (must replicate event mapping) | 2-3 days |
| **C: Library import** | 100-200 lines | Medium | 1 day |

---

## 5. Recommendation

### Use Option A: claude-agent-acp as CLI binary

**Rationale:**

1. **Zero code changes.** Flightdeck's AcpAdapter already handles ACP over stdio. Changing `cliCommand` to `claude-agent-acp` is a config change, not a code change.

2. **Battle-tested.** Zed uses this in production for their editor's Claude integration. The 20+ tool type mappings, permission flows, and session management are proven.

3. **Architecture matches.** Flightdeck spawns agent backends as subprocesses (Copilot CLI today). Adding Claude as another subprocess backend follows the same pattern — no architectural changes.

4. **Failure isolation.** A Claude agent crash doesn't bring down the Flightdeck server. Same isolation model as Copilot.

5. **SDK version decoupling.** When Anthropic releases Claude Agent SDK v0.3.x with breaking changes, Zed absorbs the migration in claude-agent-acp. Flightdeck is insulated.

6. **The right problem to solve.** Building a custom ClaudeAdapter (Option B) would mean re-implementing the 800+ lines of SDK-to-ACP event translation that claude-agent-acp already does. That's not 10x thinking — it's rebuilding a wheel.

### What "Option A" Looks Like

```yaml
# flightdeck.config.yaml
backends:
  copilot:
    command: "copilot-agent"
    args: ["--agent={{role}}"]
  claude:
    command: "npx"
    args: ["@zed-industries/claude-agent-acp", "--agent={{role}}"]
    env:
      ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"
```

The only implementation work is:
1. Add backend selection to Flightdeck's config (which backend to use per role/agent)
2. Map Flightdeck role flags to Claude's format (if different)
3. Document the `ANTHROPIC_API_KEY` requirement

### When to Revisit

Move to Option B (direct SDK) only if:
- claude-agent-acp is abandoned by Zed
- Flightdeck needs Claude-specific features not exposed via ACP (e.g., custom MCP servers, advanced hooks)
- Subprocess overhead becomes a bottleneck (unlikely — even 20 agents × 50MB = 1GB, fine for dev machines)

---

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Zed abandons claude-agent-acp | Low (active, production use) | High | Fork the repo (Apache-2.0) |
| ACP protocol version mismatch | Low (both use v0.14.1) | Medium | Pin @agentclientprotocol/sdk version |
| Claude Agent SDK breaking change | Medium (pre-1.0) | Low (Zed absorbs) | Zed updates claude-agent-acp, we update dep |
| Role flag mapping differences | Certain | Low | Map in config layer |
| Missing Claude features in ACP | Medium | Low | Can extend ACP metadata fields |
