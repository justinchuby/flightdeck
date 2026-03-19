# Agent Client Protocol — Provider Capability Matrix

> Last updated: March 19, 2026. **Live probe verified** using `scripts/query-acp-capabilities.ts` against installed provider binaries (7 of 8 probed).

## Architecture: JSON-Derived Single Source of Truth

ACP capabilities are **not hand-maintained**. They are derived at build time from a single JSON file:

```
scripts/query-acp-capabilities.ts   ← probe script
        │
        ▼
packages/shared/src/data/acp-capability-results.json   ← raw probe output (source of truth)
        │
        ▼
packages/shared/src/domain/provider.ts   ← imports JSON, derives ACP_CAPABILITIES
        │
        ▼
UI components (FindingsPage, ProvidersSection)
```

**To refresh probe data:**
```bash
npx tsx scripts/query-acp-capabilities.ts
```

This writes to `packages/shared/src/data/acp-capability-results.json`. The `ACP_CAPABILITIES` constant in `provider.ts` imports this JSON and transforms it via `deriveCapabilities()`. A small `CAPABILITY_OVERRIDES` map supplies non-probe metadata (authMethod, systemPromptMethod) that cannot be determined automatically.

## Protocol Overview

The [Agent Client Protocol (ACP)](https://agentclientprotocol.com/protocol/overview) is a standardized protocol for client-agent communication. Flightdeck uses ACP as its unified adapter layer — all 8 provider backends are accessed through the same ACP interface, enabling provider-agnostic agent orchestration.

ACP defines capability negotiation during session initialization: the client advertises what it supports (filesystem access, terminal, etc.) and the server responds with agent capabilities (image support, audio, MCP servers, session resume).

## ACP SDK Type Definitions

The `@agentclientprotocol/sdk` package defines the following capability types exchanged during initialization:

### `ClientCapabilities` — What the client advertises to agents

```typescript
ClientCapabilities {
  fs?: {
    readTextFile?: boolean;   // Client can read files
    writeTextFile?: boolean;  // Client can write files
  };
  auth?: {
    terminal?: boolean;       // Client supports terminal-based auth flows
  };
  terminal?: boolean;         // Client has terminal access
  _meta?: Record<string, unknown>;
}
```

### `AgentCapabilities` — What the agent reports back

```typescript
AgentCapabilities {
  loadSession?: boolean;            // Agent supports session resume
  promptCapabilities?: PromptCapabilities;
  mcpCapabilities?: McpCapabilities;
  sessionCapabilities?: SessionCapabilities;
}
```

### `PromptCapabilities` — Supported content types in prompts

```typescript
PromptCapabilities {
  image?: boolean;           // Supports image attachments
  audio?: boolean;           // Supports audio input/output
  embeddedContext?: boolean;  // Supports inline file/resource embedding
}
```

### `McpCapabilities` — MCP server connectivity

```typescript
McpCapabilities {
  http?: boolean;  // Supports HTTP-based MCP servers
  sse?: boolean;   // Supports SSE-based MCP servers
}
```

### `SessionCapabilities` — Session lifecycle operations

```typescript
SessionCapabilities {
  resume?: {};  // Supports resuming previous sessions
  close?: {};   // Supports explicit session close
  fork?: {};    // Supports forking a session
  list?: {};    // Supports listing previous sessions
}
```

## Opportunities: Capability Utilization

### ✅ Resolved

- **Live probe data for all 7 installed providers** — no more assumptions or static guesses
- **ACP_CAPABILITIES derived from probe JSON** — single source of truth, no hand-maintained constants that drift
- **Gemini resume preset clarified** — the old `supportsResume` field was ambiguous. It has been renamed to `supportsLoadSession` (which IS true for Gemini — it advertises `loadSession`). Gemini does NOT have `sessionCapabilities.resume` (no session resume/fork), which is what the old preset incorrectly implied.

### ⚠️ Remaining Gaps

**1. Empty client capabilities.** Flightdeck sends `clientCapabilities: {}` during session initialization (`AcpAdapter.ts:330`). Agents don't know the client has filesystem and terminal access. Should be `{ fs: { readTextFile: true, writeTextFile: true }, terminal: true }`.

**2. Only `supportsImages` consumed at runtime.** From the rich `AgentCapabilities` response, only `promptCapabilities.image` is read (`AcpAdapter.ts:113`):

```typescript
get supportsImages(): boolean {
  return this.agentCapabilities?.promptCapabilities?.image ?? false;
}
```

**3. Captured but unused fields:** `loadSession`, `audio`, `embeddedContext`, `mcpCapabilities`, and `sessionCapabilities` are stored on the adapter instance but not surfaced in the UI or used in adapter logic.

## Static Presets vs Runtime Capabilities

There are two distinct sources of capability information:

1. **Static presets** (`PROVIDER_REGISTRY` in `packages/shared/src/domain/provider.ts`) — Hardcoded metadata about each provider CLI: binary name, supported models, auth method, resume support. These are compile-time constants used for provider selection and model resolution.

2. **Runtime capabilities** (`AgentCapabilities` from ACP `initialize` response) — Actual capabilities reported by the running agent process. These may differ from static presets if a provider updates its capabilities. Currently only `supportsImages` is read at runtime.

The static presets drive the UI (model selectors, provider badges, setup wizard). The runtime capabilities should ideally augment or override static presets but currently do not.

## Provider Details

### 🐙 GitHub Copilot

| Field | Value |
|-------|-------|
| **Binary** | `copilot --acp --stdio` |
| **Probe Version** | v1.0.9 |
| **Auth** | `gh auth status` (GitHub CLI login) |
| **Resume** | ✅ (loadSession + session list, no fork/resume) |
| **Images** | ✅ |
| **Audio** | ❌ |
| **MCP** | ❌ (no mcpCapabilities) |
| **Embedded Context** | ✅ |
| **Model Selection** | `--model <name>` flag |
| **Models** | Anthropic (sonnet, haiku, opus), OpenAI (gpt-4.1), Google (gemini-3-pro-preview), xAI |
| **Model Tiers** | fast: `claude-haiku-4.5`, standard: `claude-sonnet-4.6`, premium: `claude-opus-4.6` |
| **System Prompt** | First user message |
| **Agent File** | `.agent.md` |
| **Unique** | Multi-backend access, `--agent=<name>` flag, widest model selection |

### 🟠 Claude (Anthropic)

| Field | Value |
|-------|-------|
| **Binary** | `claude-agent-acp` |
| **Probe Version** | v0.21.0 |
| **Auth** | `ANTHROPIC_API_KEY` env var |
| **Resume** | ✅ (full: fork + list + resume — richest session support) |
| **Images** | ✅ |
| **Audio** | ❌ |
| **MCP** | ✅ HTTP + SSE |
| **Embedded Context** | ✅ |
| **Model Selection** | `--model <alias>` (uses short aliases: `default`, `opus`, `haiku`) |
| **Models** | Anthropic only (sonnet, haiku, opus) |
| **Model Tiers** | fast: `haiku`, standard: `default` (sonnet), premium: `opus` |
| **System Prompt** | `_meta.systemPrompt` extension (unique to Claude) |
| **Agent File** | `CLAUDE.md` |
| **Unique** | Only provider with full session fork/resume, `_meta.systemPrompt`, `promptQueueing`, model aliases |

### 💎 Google Gemini CLI

| Field | Value |
|-------|-------|
| **Binary** | `gemini --acp` |
| **Probe Version** | v0.34.0 |
| **Auth** | `GEMINI_API_KEY` env var (4 auth methods: OAuth, API key, Vertex AI, Gateway) |
| **Resume** | ⚠️ (loadSession ✅, but no sessionCapabilities — no resume/fork) |
| **Images** | ✅ |
| **Audio** | ✅ (only provider with audio support) |
| **MCP** | ✅ HTTP + SSE |
| **Embedded Context** | ✅ |
| **Model Selection** | `--model <name>` flag |
| **Models** | Google only (gemini-3.1-pro, gemini-3.1-flash, gemini-3.1-flash-lite) |
| **Model Tiers** | fast: `gemini-3.1-flash-lite`, standard: `gemini-3.1-flash`, premium: `gemini-3.1-pro` |
| **System Prompt** | First user message |
| **Agent File** | `.gemini/agents/*.md` |
| **Unique** | Google-native models, audio support, directory-based agent files |

### 🤖 Codex (OpenAI)

| Field | Value |
|-------|-------|
| **Binary** | `codex-acp` |
| **Probe Version** | v0.9.5 |
| **Auth** | `OPENAI_API_KEY` env var (3 auth methods: ChatGPT login, CODEX_API_KEY, OPENAI_API_KEY) |
| **Resume** | ❌ (session list only, no resume/fork) |
| **Images** | ✅ |
| **Audio** | ❌ |
| **MCP** | ⚠️ HTTP only (no SSE) |
| **Embedded Context** | ✅ |
| **Model Selection** | Config-style: `-c model=<name>` |
| **Models** | OpenAI only (gpt-5.x-codex, gpt-5.4) |
| **Model Tiers** | fast: `gpt-5.1-codex-mini`, standard: `gpt-5.3-codex`, premium: `gpt-5.4` |
| **System Prompt** | First user message |
| **Unique** | Config-based model selection; HTTP-only MCP |

### 🌙 Kimi CLI (Moonshot AI)

| Field | Value |
|-------|-------|
| **Binary** | `kimi acp` |
| **Probe Version** | v1.24.0 |
| **Auth** | `kimi login` (Moonshot account) |
| **Resume** | ✅ (session list + resume, loadSession) |
| **Images** | ✅ |
| **Audio** | ❌ |
| **MCP** | ⚠️ HTTP only (no SSE) |
| **Embedded Context** | ✅ |
| **Model Selection** | `--model <name>` flag |
| **Models** | Moonshot native (kimi-latest, moonshot-v1-8k) |
| **Model Tiers** | fast: `moonshot-v1-8k`, standard: `kimi-latest`, premium: `kimi-latest` |
| **System Prompt** | First user message |
| **Unique** | Moonshot AI models, terminal-based login auth |

### 🔮 Qwen Code (Alibaba)

| Field | Value |
|-------|-------|
| **Binary** | `qwen --acp --experimental-skills` |
| **Probe Version** | v0.12.6 |
| **Auth** | Qwen OAuth (free daily requests) or OPENAI_API_KEY |
| **Resume** | ✅ (session list + resume, loadSession) |
| **Images** | ✅ |
| **Audio** | ✅ (one of two providers with audio support) |
| **MCP** | ❌ |
| **Embedded Context** | ✅ |
| **Model Selection** | `--model <name>` flag |
| **Models** | Qwen (qwen-coder-plus-latest) + OpenAI backend |
| **Model Tiers** | fast/standard/premium: `qwen-coder-plus-latest` (single model currently) |
| **System Prompt** | First user message |
| **Unique** | Audio support, Qwen OAuth with free tier, dual-backend (Qwen + OpenAI) |

### ↗️ Cursor (NOT PROBED — binary not installed)

| Field | Value |
|-------|-------|
| **Binary** | `agent acp` |
| **Auth** | `CURSOR_API_KEY` env var |
| **Resume** | Unknown (static preset only) |
| **Model Selection** | Not configurable via CLI (`modelArgStrategy: 'none'`) |
| **Models** | Multi-backend: Anthropic, OpenAI, Google |
| **Model Tiers** | fast: `claude-haiku-4.5`, standard: `claude-sonnet-4.6`, premium: `claude-opus-4.6` |
| **System Prompt** | `.cursorrules` file |
| **Unique** | Multi-backend like Copilot; model selection managed by Cursor, not CLI args; `.cursorrules` for system prompt |

### 🔓 OpenCode

| Field | Value |
|-------|-------|
| **Binary** | `opencode acp` |
| **Probe Version** | v1.2.27 |
| **Auth** | Self-managed (`opencode auth login` — handles own API keys) |
| **Resume** | ✅ (full: fork + list + resume — matches Claude) |
| **Images** | ✅ |
| **Audio** | ❌ |
| **MCP** | ✅ HTTP + SSE |
| **Embedded Context** | ✅ |
| **Model Selection** | Not configurable via CLI (`modelArgStrategy: 'none'`) |
| **Models** | Multi-backend: Anthropic, OpenAI, Google, **local models** |
| **Model Tiers** | fast: `anthropic/claude-haiku-4-5`, standard: `anthropic/claude-sonnet-4-6`, premium: `anthropic/claude-opus-4-6` |
| **System Prompt** | First user message |
| **Model Name Format** | Prefixed: `anthropic/claude-sonnet-4-6`, `openai/gpt-5.2`, `google/gemini-2.5-pro` |
| **Unique** | Full session management (like Claude), supports local models, provider-prefixed model names, self-managed auth |

## Capability Matrix Summary (Probe-Verified)

| Provider | Version | Resume | Images | Audio | MCP | Embedded Ctx | Session Caps | Auth Method | Multi-Backend |
|----------|---------|--------|--------|-------|-----|--------------|--------------|-------------|---------------|
| **Copilot** | v1.0.9 | ✅ | ✅ | ❌ | ❌ | ✅ | list | GitHub CLI | ✅ (4 backends) |
| **Claude** | v0.21.0 | ✅ | ✅ | ❌ | ✅ http+sse | ✅ | fork+list+resume | API key | ❌ |
| **Gemini** | v0.34.0 | ⚠️ loadSession only | ✅ | ✅ | ✅ http+sse | ✅ | none | API key (4 methods) | ❌ |
| **Codex** | v0.9.5 | ❌ | ✅ | ❌ | ⚠️ http only | ✅ | list | API key (3 methods) | ❌ |
| **Kimi** | v1.24.0 | ✅ | ✅ | ❌ | ⚠️ http only | ✅ | list+resume | Moonshot login | ❌ |
| **Qwen Code** | v0.12.6 | ✅ | ✅ | ✅ | ❌ | ✅ | list+resume | Qwen OAuth / OPENAI_API_KEY | ✅ (2 backends) |
| **Cursor** | — | ✅* | — | — | — | — | — | API key | ✅ (3 backends) |
| **OpenCode** | v1.2.27 | ✅ | ✅ | ❌ | ✅ http+sse | ✅ | fork+list+resume | opencode auth login | ✅ (4 backends + local) |

*Cursor not probed (binary not installed). Resume status from static preset only.

## Key Findings

### 1. Empty Client Capabilities

Flightdeck sends `clientCapabilities: {}` — agents don't know the client has filesystem and terminal access. This should be `{ fs: { readTextFile: true, writeTextFile: true }, terminal: true }`.

### 2. Only `supportsImages` Consumed

Of the rich `AgentCapabilities` response, only `promptCapabilities.image` is read. `loadSession`, `audio`, `embeddedContext`, `mcpCapabilities`, and `sessionCapabilities` are captured but unused.

### 3. Session Resume Support Varies Widely

Probe-verified session capabilities across all 7 providers:
- **Full session management** (fork+list+resume): Claude, OpenCode
- **List + resume** (no fork): Kimi, Qwen Code
- **List only** (no resume/fork): Copilot, Codex
- **No session capabilities**: Gemini (probe-verified — preset was incorrectly `true`, now fixed)

### 4. MCP Server Support Varies

Probe verified: Claude, Gemini, and OpenCode support both HTTP and SSE MCP transports. Codex and Kimi support HTTP only (no SSE). Copilot and Qwen Code have no MCP capabilities. No current Flightdeck configuration leverages MCP server passthrough.

### 5. Claude Uses `_meta.systemPrompt` Extension

Claude is the only provider receiving system prompts via `_meta.systemPrompt` in the session metadata (`AcpAdapter.ts:149-150`). All others receive it as the first user message.

### 6. Model Selection Strategies Vary

Three distinct strategies exist across providers:
- **Flag** (`--model <name>`): Copilot, Claude, Gemini, Kimi, Qwen Code
- **Config** (`-c model=<name>`): Codex
- **None** (managed externally): Cursor, OpenCode

### 7. Audio Support Is Rare

Only Gemini and Qwen Code support audio content in prompts. All other providers are image-only for media.

### 8. OpenCode Matches Claude for Session Capabilities

OpenCode (v1.2.27) now supports full session management (fork+list+resume), matching Claude as the only providers with complete session lifecycle support. Both also support MCP HTTP+SSE.

## Recommendations

1. **Advertise client capabilities** — Send `{ fs: { readTextFile: true, writeTextFile: true }, terminal: true }` in `clientCapabilities` so providers can offer richer agent cooperation.

2. **Surface capabilities in UI** — Show which capabilities each agent's provider supports in the agent detail panel, giving operators visibility into what each agent can do.

3. **Leverage MCP server passthrough** — Allow project configuration to specify MCP servers that agents should connect to, enabling tool augmentation (database access, API integrations, custom tools).

4. **Handle resume gaps gracefully** — Both Gemini and Codex don't support session resume. The UI should indicate this limitation and offer context-replay as an alternative.

5. **Consume runtime capabilities** — Use the full `AgentCapabilities` response to override static presets, enabling the system to adapt to provider updates without code changes.

6. **Unify model selection** — Abstract the 3 model selection strategies behind a consistent interface so new providers can be added without adapter changes.

## Technical Reference

| File | Purpose |
|------|---------|
| `packages/shared/src/data/acp-capability-results.json` | Raw probe output — **single source of truth** for capability data |
| `packages/shared/src/domain/provider.ts` | Central `PROVIDER_REGISTRY` + derived `ACP_CAPABILITIES` from probe JSON |
| `scripts/query-acp-capabilities.ts` | Probe script — runs all providers, writes JSON |
| `packages/server/src/adapters/AcpAdapter.ts` | Core ACP adapter — session init, capability negotiation, message routing |
| `packages/server/src/adapters/types.ts` | TypeScript types for `AgentAdapter`, `ToolCallInfo`, capability interfaces |
| `packages/server/src/adapters/AdapterFactory.ts` | Factory that creates provider-specific adapter instances |
| `packages/server/src/adapters/presets.ts` | Provider presets derived from shared registry |
| `packages/server/src/adapters/ModelResolver.ts` | Model name resolution, tier mapping, and provider-specific prefixing |
| `@agentclientprotocol/sdk` | ACP SDK — Zod schemas for all capability types |
