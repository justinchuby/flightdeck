# Model Selection Across CLI Providers

> **Author**: Architect (e7f14c5e)  
> **Date**: 2026-03-07  
> **Context**: Flightdeck is moving to multi-CLI support. Each CLI has different model availability. We need a unified model selection strategy.

---

## Executive Summary

**The core problem**: Flightdeck stores model names like `claude-opus-4.6` in RoleRegistry. On Copilot CLI (multi-model), this works because Copilot provides access to Claude, GPT, and Gemini models. But on Gemini CLI (single-provider), `claude-opus-4.6` is meaningless — Gemini only knows Gemini models.

**Key insight**: CLIs fall into two categories:
- **Multi-model gateways** (Copilot, Cursor): Provide access to models from multiple providers. Model names like `claude-opus-4.6` work directly.
- **Single-provider CLIs** (Claude, Gemini, Codex): Only access their own models. Cross-provider model names fail.
- **Multi-provider config** (OpenCode): Supports multiple providers but uses `provider/model` format.

**Recommendation**: **Hybrid approach — exact names with capability-tier fallback**. Keep exact model names as the primary mechanism (zero migration). Add a `ModelResolver` that maps cross-provider model names to equivalents when the target CLI doesn't support them, and support abstract tier aliases (`fast`, `standard`, `premium`) as optional shorthand.

---

## Current Flightdeck Model Handling

### Model Priority Chain

When an agent executes, models are resolved in this priority order:

1. **Agent override** (`agent.model`) — set via PATCH /api/agents/:id or spawn parameter
2. **Project config enforcement** — `resolveModelForRole()` checks allowed models list
3. **Role default** (`role.model`) — from RoleRegistry
4. **Undefined** — no `--model` flag sent to CLI; CLI uses its own default

### Current Role Model Assignments

| Role | Model | Tier |
|------|-------|------|
| architect | `claude-opus-4.6` | Premium |
| developer | `claude-opus-4.6` | Premium |
| designer | `claude-opus-4.6` | Premium |
| generalist | `claude-opus-4.6` | Premium |
| code-reviewer | `gemini-3-pro-preview` | Standard |
| critical-reviewer | `gemini-3-pro-preview` | Standard |
| readability-reviewer | `gemini-3-pro-preview` | Standard |
| radical-thinker | `gemini-3-pro-preview` | Standard |
| product-manager | `gpt-5.3-codex` | Standard |
| tech-writer | `gpt-5.2` | Standard |
| qa-tester | `claude-sonnet-4.6` | Standard |
| secretary | `gpt-4.1` | Fast |
| agent | *undefined* | CLI default |
| lead | *undefined* | CLI default |

**Observation**: The current assignments already use 3 providers (Anthropic, Google, OpenAI) and 3 implicit tiers (premium/opus, standard/pro-sonnet, fast/mini). This ONLY works because Copilot CLI is a multi-model gateway that provides all these models.

### Code Path

```
RoleRegistry.ts → role.model = 'claude-opus-4.6'
                      ↓
Agent.ts → agent.model || agent.role.model
                      ↓
AgentAcpBridge.ts → cliArgs.push('--model', model)  [line 52]
                      ↓
AcpAdapter.ts → spawn(cliCommand, [...cliArgs])  [line 133, passthrough]
                      ↓
CLI process receives --model flag
```

No validation, no translation. The model string is passed verbatim to whatever CLI is spawned.

### Key Files

| File | Lines | What It Does |
|------|-------|-------------|
| `RoleRegistry.ts` | 7-587 | 14 roles with model assignments |
| `Agent.ts` | 86, 658 | `model` field, toJSON fallback to role.model |
| `AgentManager.ts` | 240-268 | `resolveModelForRole()` — project config enforcement |
| `AgentAcpBridge.ts` | 52 | `--model` flag construction |
| `AcpAdapter.ts` | 133 | Pure passthrough |
| `config.ts` | N/A | No server-level default model |
| `shared/domain/role.ts` | 13 | `model: z.string().optional()` |

---

## CLI Model Availability

### 1. GitHub Copilot CLI (Multi-Model Gateway)

| Provider | Models | Tier |
|----------|--------|------|
| OpenAI | gpt-5.4, gpt-5.3-codex, gpt-5.2-codex, gpt-5.2, gpt-5.1-codex-max, gpt-5.1-codex, gpt-5.1, gpt-5.1-codex-mini, gpt-5-mini, gpt-4.1 | All tiers |
| Anthropic | claude-opus-4.6, claude-opus-4.5, claude-sonnet-4.6, claude-sonnet-4.5, claude-sonnet-4, claude-haiku-4.5 | All tiers |
| Google | gemini-3.1-pro, gemini-3-pro, gemini-2.5-pro, gemini-3-flash | Standard/Fast |
| xAI | grok-code-fast-1 | Fast |

**Model specification**: `--model <name>` flag or `/model` interactive command.

**Key**: Copilot is the **broadest** model gateway. All current Flightdeck role model assignments work here.

### 2. Claude Code CLI (Single Provider — Anthropic Only)

| Model | Alias | Tier |
|-------|-------|------|
| claude-opus-4.6 | `opus` | Premium |
| claude-opus-4.5 | `opus` (older) | Premium |
| claude-sonnet-4.6 | `sonnet` | Standard |
| claude-sonnet-4.5 | `sonnet` (older) | Standard |
| claude-sonnet-4 | — | Standard |
| claude-haiku-4.5 | `haiku` | Fast |

**Model specification**: `--model <alias-or-full-name>` or `/model` interactive.

**Key**: Aliases (`opus`, `sonnet`, `haiku`) always point to latest version. Only Anthropic models available. GPT and Gemini model names will **fail**.

### 3. Gemini CLI (Single Provider — Google Only)

| Model | Tier |
|-------|------|
| gemini-2.5-pro | Premium |
| gemini-2.5-flash | Standard/Fast |
| gemini-2.5-flash-lite | Fast |

**Model specification**: `--model <name>` flag or `/model` interactive.

**Key**: Only Google models. Very small model catalog. No Claude, no GPT.

### 4. Cursor CLI (Multi-Model Gateway)

| Provider | Models | Tier |
|----------|--------|------|
| Anthropic | Claude 4.6 Opus/Sonnet, 4.5, 4.0, 3.7/3.5, Haiku | All tiers |
| OpenAI | GPT-5.3 Codex, 5.2, 5.1, o3, o4-mini, 4.1, 4o | All tiers |
| Google | Gemini 3.1 Pro, 3 Flash, 2.5 Pro/Flash | Standard/Fast |
| Other | DeepSeek, Grok, Qwen | Various |

**Model specification**: Settings UI, API config, or `Auto` mode for automatic routing.

**Key**: Second broadest gateway after Copilot. Also has **Auto mode** for cost/performance optimization.

### 5. OpenAI Codex CLI (Single Provider — OpenAI Only)

| Model | Tier |
|-------|------|
| gpt-5.2-codex | Premium |
| gpt-5.1-codex-max | Premium |
| gpt-5.1-codex | Standard |
| gpt-5.1-codex-mini | Fast |
| gpt-5.2 | Standard |
| gpt-5.1 | Standard |

**Model specification**: `--model <name>` or `-m <name>`, or `~/.codex/config.toml`.

**Key**: Only OpenAI models. Codex-specific models optimized for coding.

### 6. OpenCode CLI (Multi-Provider Config)

| Provider | Models | Format |
|----------|--------|--------|
| OpenAI | gpt-5.2, gpt-5.1-codex, etc. | `openai/gpt-5.2` |
| Anthropic | claude-opus-4.5, claude-sonnet-4.5, etc. | `anthropic/claude-opus-4-5` |
| Google | gemini-3-pro, gemini-3-flash, etc. | `google/gemini-3-pro` |
| Local | llama3, deepseek-coder, etc. | `ollama/llama3` |

**Model specification**: `opencode.json` config file with `provider/model` format.

**Key**: Most flexible — 75+ providers. Uses explicit `provider/model` naming convention. Model names don't match other CLIs exactly (e.g., `claude-opus-4-5` vs `claude-opus-4.5`).

---

## Comparison: Model Specification Mechanisms

| CLI | Flag | Config File | Env Var | Interactive | Default |
|-----|------|-------------|---------|-------------|---------|
| Copilot | `--model <name>` | `.agent.md` frontmatter | — | `/model` | GPT-4.1 |
| Claude | `--model <alias>` | `.claude/settings.json` | — | `/model` | Sonnet |
| Gemini | `--model <name>` | — | — | `/model` | gemini-2.5-pro |
| Cursor | Settings UI | `.cursor/rules/` | — | Model picker | Auto |
| Codex | `--model <name>` | `~/.codex/config.toml` | — | — | codex-mini |
| OpenCode | — | `opencode.json` | — | `/models` | Per-agent config |

**Universal mechanism**: `--model` flag via CLI args. Works for Copilot, Claude, Gemini, Codex. Cursor and OpenCode need config-file approach.

---

## The Cross-Provider Problem

### Scenario: architect with model `claude-opus-4.6`

| Target CLI | What Happens | Result |
|-----------|-------------|--------|
| Copilot | `--model claude-opus-4.6` sent | ✅ Works — Copilot proxies to Anthropic |
| Claude | `--model claude-opus-4.6` sent | ✅ Works — native model |
| Cursor | Model set in config | ✅ Works — Cursor proxies to Anthropic |
| Gemini | `--model claude-opus-4.6` sent | ❌ **FAILS** — Gemini doesn't know Claude models |
| Codex | `--model claude-opus-4.6` sent | ❌ **FAILS** — Codex only has OpenAI models |
| OpenCode | Needs `anthropic/claude-opus-4-5` | ❌ **FAILS** — wrong format, wrong name |

**Impact**: 3 of 6 CLIs break with the current model assignments. This is the core problem.

---

## Design Options

### Option A: Abstract Capability Tiers

Map models to abstract tiers; resolve to provider-specific models at spawn time.

```typescript
type ModelTier = 'fast' | 'standard' | 'premium';

const TIER_DEFAULTS: Record<CliProvider, Record<ModelTier, string>> = {
  copilot:   { fast: 'claude-haiku-4.5', standard: 'claude-sonnet-4.6', premium: 'claude-opus-4.6' },
  'claude-acp': { fast: 'haiku', standard: 'sonnet', premium: 'opus' },
  gemini:    { fast: 'gemini-2.5-flash-lite', standard: 'gemini-2.5-flash', premium: 'gemini-2.5-pro' },
  cursor:    { fast: 'claude-haiku-4.5', standard: 'claude-sonnet-4.6', premium: 'claude-opus-4.6' },
  codex:     { fast: 'gpt-5.1-codex-mini', standard: 'gpt-5.1-codex', premium: 'gpt-5.2-codex' },
  opencode:  { fast: 'anthropic/claude-haiku-4-5', standard: 'anthropic/claude-sonnet-4-5', premium: 'anthropic/claude-opus-4-5' },
};

// Role definition:
{ id: 'architect', model: 'premium' }  // Resolves per-provider
```

**Pros**: Simple, always works, zero provider awareness needed in role definitions.  
**Cons**: Loses fine-grained control. "Premium" on Gemini (gemini-2.5-pro) is very different from "premium" on Claude (opus-4.6). Users who want a specific model can't express it.

### Option B: Provider-Qualified Names

Use explicit `provider:model` format everywhere.

```typescript
// Role definition:
{ id: 'architect', model: 'anthropic:claude-opus-4.6' }

// Resolution:
// On Copilot → --model claude-opus-4.6  (Copilot proxies anthropic)
// On Claude → --model opus  (native, translate to alias)
// On Gemini → ERROR: anthropic models not available on Gemini CLI
```

**Pros**: Explicit, unambiguous.  
**Cons**: Doesn't solve the cross-provider problem — it just makes it explicit. Still fails when the provider isn't available on the CLI. Breaks all existing role definitions (migration needed).

### Option C: Exact Names with Cross-Provider Fallback Map (Recommended)

Keep exact model names. Add a resolver that maps to equivalents when the target CLI can't handle the model.

```typescript
// Equivalence map: "if you want X but your CLI only has Y provider, use Z"
const MODEL_EQUIVALENCES: Record<string, Record<string, string>> = {
  'claude-opus-4.6':      { openai: 'gpt-5.2-codex',    google: 'gemini-2.5-pro' },
  'claude-opus-4.5':      { openai: 'gpt-5.1-codex-max', google: 'gemini-2.5-pro' },
  'claude-sonnet-4.6':    { openai: 'gpt-5.1-codex',    google: 'gemini-2.5-flash' },
  'claude-sonnet-4':      { openai: 'gpt-4.1',          google: 'gemini-2.5-flash' },
  'claude-haiku-4.5':     { openai: 'gpt-5.1-codex-mini', google: 'gemini-2.5-flash-lite' },
  'gpt-5.2-codex':        { anthropic: 'claude-opus-4.6', google: 'gemini-2.5-pro' },
  'gpt-5.1-codex':        { anthropic: 'claude-sonnet-4.6', google: 'gemini-2.5-flash' },
  'gpt-4.1':              { anthropic: 'claude-sonnet-4', google: 'gemini-2.5-flash' },
  'gemini-2.5-pro':       { anthropic: 'claude-opus-4.6', openai: 'gpt-5.2-codex' },
  'gemini-2.5-flash':     { anthropic: 'claude-sonnet-4.6', openai: 'gpt-5.1-codex' },
  'gemini-3-pro-preview': { anthropic: 'claude-sonnet-4.6', openai: 'gpt-5.1-codex' },
};

// Also support tier aliases
const TIER_ALIASES: Record<string, Record<CliProvider, string>> = {
  fast:     { copilot: 'claude-haiku-4.5', 'claude-acp': 'haiku', gemini: 'gemini-2.5-flash-lite', ... },
  standard: { copilot: 'claude-sonnet-4.6', 'claude-acp': 'sonnet', gemini: 'gemini-2.5-flash', ... },
  premium:  { copilot: 'claude-opus-4.6', 'claude-acp': 'opus', gemini: 'gemini-2.5-pro', ... },
};
```

**Pros**: Zero migration — existing role definitions work unchanged. Fine-grained control preserved. Graceful degradation with logging. Tier aliases available for users who don't care about exact models.  
**Cons**: Equivalence map needs maintenance as models change. "Equivalent" is subjective (Gemini Pro != Claude Opus in capability).

---

## Recommended Design: Option C (Hybrid)

### Architecture

```
Role.model = 'claude-opus-4.6'        // or 'premium', or undefined
         ↓
   ModelResolver.resolve(model, provider)
         ↓
   ┌─────────────────────────────────────┐
   │ 1. Is it a tier alias?              │
   │    → Map to provider's tier default │
   │ 2. Is it supported on this provider?│
   │    → Pass through unchanged         │
   │ 3. Is there an equivalence mapping? │
   │    → Map to equivalent + log        │
   │ 4. Fallback:                        │
   │    → Use provider's 'standard' tier │
   │    → WARN that model was unmapped   │
   └─────────────────────────────────────┘
         ↓
   Resolved model string for CLI
```

### ModelResolver Implementation

```typescript
// packages/server/src/agents/ModelResolver.ts

import type { CliProvider } from '../adapters/types.js';
import { logger } from '../utils/logger.js';

/** Which provider a CLI natively supports */
const CLI_PROVIDERS: Record<CliProvider, string[]> = {
  copilot:     ['anthropic', 'openai', 'google', 'xai'],  // Multi-model gateway
  'claude-acp': ['anthropic'],
  gemini:      ['google'],
  cursor:      ['anthropic', 'openai', 'google'],  // Multi-model gateway
  codex:       ['openai'],
  opencode:    ['anthropic', 'openai', 'google', 'local'],  // Multi-provider config
};

/** Which provider a model belongs to (by prefix pattern) */
function detectProvider(model: string): string {
  if (model.startsWith('claude-') || model === 'opus' || model === 'sonnet' || model === 'haiku') return 'anthropic';
  if (model.startsWith('gpt-') || model.startsWith('o3') || model.startsWith('o4')) return 'openai';
  if (model.startsWith('gemini-')) return 'google';
  if (model.startsWith('grok-')) return 'xai';
  return 'unknown';
}

/** Tier aliases → provider-specific model names */
const TIER_MAP: Record<string, Record<CliProvider, string>> = {
  fast: {
    copilot: 'claude-haiku-4.5',
    'claude-acp': 'haiku',
    gemini: 'gemini-2.5-flash-lite',
    cursor: 'claude-haiku-4.5',
    codex: 'gpt-5.1-codex-mini',
    opencode: 'anthropic/claude-haiku-4-5',
  },
  standard: {
    copilot: 'claude-sonnet-4.6',
    'claude-acp': 'sonnet',
    gemini: 'gemini-2.5-flash',
    cursor: 'claude-sonnet-4.6',
    codex: 'gpt-5.1-codex',
    opencode: 'anthropic/claude-sonnet-4-6',
  },
  premium: {
    copilot: 'claude-opus-4.6',
    'claude-acp': 'opus',
    gemini: 'gemini-2.5-pro',
    cursor: 'claude-opus-4.6',
    codex: 'gpt-5.2-codex',
    opencode: 'anthropic/claude-opus-4-6',
  },
};

/** Cross-provider equivalences: model → { provider: equivalent } */
const EQUIVALENCES: Record<string, Record<string, string>> = {
  // Anthropic → others
  'claude-opus-4.6':      { openai: 'gpt-5.2-codex',      google: 'gemini-2.5-pro' },
  'claude-opus-4.5':      { openai: 'gpt-5.1-codex-max',  google: 'gemini-2.5-pro' },
  'claude-sonnet-4.6':    { openai: 'gpt-5.1-codex',      google: 'gemini-2.5-flash' },
  'claude-sonnet-4.5':    { openai: 'gpt-5.1-codex',      google: 'gemini-2.5-flash' },
  'claude-sonnet-4':      { openai: 'gpt-4.1',            google: 'gemini-2.5-flash' },
  'claude-haiku-4.5':     { openai: 'gpt-5.1-codex-mini', google: 'gemini-2.5-flash-lite' },

  // OpenAI → others
  'gpt-5.4':              { anthropic: 'claude-opus-4.6',   google: 'gemini-2.5-pro' },
  'gpt-5.3-codex':        { anthropic: 'claude-opus-4.6',   google: 'gemini-2.5-pro' },
  'gpt-5.2-codex':        { anthropic: 'claude-opus-4.6',   google: 'gemini-2.5-pro' },
  'gpt-5.2':              { anthropic: 'claude-sonnet-4.6',  google: 'gemini-2.5-flash' },
  'gpt-5.1-codex-max':    { anthropic: 'claude-opus-4.5',   google: 'gemini-2.5-pro' },
  'gpt-5.1-codex':        { anthropic: 'claude-sonnet-4.6',  google: 'gemini-2.5-flash' },
  'gpt-5.1-codex-mini':   { anthropic: 'claude-haiku-4.5',  google: 'gemini-2.5-flash-lite' },
  'gpt-5.1':              { anthropic: 'claude-sonnet-4.6',  google: 'gemini-2.5-flash' },
  'gpt-5-mini':           { anthropic: 'claude-haiku-4.5',  google: 'gemini-2.5-flash-lite' },
  'gpt-4.1':              { anthropic: 'claude-sonnet-4',   google: 'gemini-2.5-flash' },

  // Google → others
  'gemini-3-pro-preview': { anthropic: 'claude-sonnet-4.6',  openai: 'gpt-5.1-codex' },
  'gemini-2.5-pro':       { anthropic: 'claude-opus-4.6',   openai: 'gpt-5.2-codex' },
  'gemini-2.5-flash':     { anthropic: 'claude-sonnet-4.6',  openai: 'gpt-5.1-codex' },
  'gemini-2.5-flash-lite':{ anthropic: 'claude-haiku-4.5',  openai: 'gpt-5.1-codex-mini' },
};

/** Claude CLI accepts short aliases instead of full names */
const CLAUDE_ALIASES: Record<string, string> = {
  'claude-opus-4.6': 'opus',
  'claude-opus-4.5': 'opus',
  'claude-sonnet-4.6': 'sonnet',
  'claude-sonnet-4.5': 'sonnet',
  'claude-sonnet-4': 'sonnet',
  'claude-haiku-4.5': 'haiku',
};

export interface ModelResolution {
  /** The resolved model name to pass to the CLI */
  model: string;
  /** Whether the model was translated (not a passthrough) */
  translated: boolean;
  /** Original model name before resolution */
  original: string;
  /** Human-readable reason for the resolution */
  reason?: string;
}

export function resolveModel(
  model: string | undefined,
  provider: CliProvider,
): ModelResolution | undefined {
  if (!model) return undefined;

  const original = model;

  // Step 1: Tier alias resolution
  if (model in TIER_MAP) {
    const resolved = TIER_MAP[model]?.[provider];
    if (resolved) {
      return { model: resolved, translated: true, original, reason: `tier '${model}' → ${resolved}` };
    }
  }

  // Step 2: Check if model is natively supported on this CLI
  const modelProvider = detectProvider(model);
  const cliProviders = CLI_PROVIDERS[provider] || [];

  if (cliProviders.includes(modelProvider)) {
    // Model's provider is available on this CLI
    // For Claude CLI, translate to short aliases
    if (provider === 'claude-acp' && model in CLAUDE_ALIASES) {
      return { model: CLAUDE_ALIASES[model], translated: true, original, reason: `alias for Claude CLI` };
    }
    // For OpenCode, prepend provider prefix
    if (provider === 'opencode') {
      const prefix = modelProvider === 'anthropic' ? 'anthropic' : modelProvider === 'openai' ? 'openai' : 'google';
      return { model: `${prefix}/${model}`, translated: true, original, reason: `OpenCode provider prefix` };
    }
    return { model, translated: false, original };
  }

  // Step 3: Cross-provider equivalence mapping
  const equivalences = EQUIVALENCES[model];
  if (equivalences) {
    // Find an equivalence for any provider this CLI supports
    for (const cliProv of cliProviders) {
      if (equivalences[cliProv]) {
        let resolved = equivalences[cliProv];

        // Apply Claude aliases
        if (provider === 'claude-acp' && resolved in CLAUDE_ALIASES) {
          resolved = CLAUDE_ALIASES[resolved];
        }
        // Apply OpenCode prefix
        if (provider === 'opencode') {
          resolved = `${cliProv}/${resolved}`;
        }

        logger.info({
          module: 'model',
          msg: `Model '${model}' not available on ${provider}, using equivalent '${resolved}'`,
        });

        return { model: resolved, translated: true, original, reason: `${model} → ${resolved} (${provider} equivalent)` };
      }
    }
  }

  // Step 4: Fallback to standard tier
  const fallback = TIER_MAP['standard']?.[provider];
  if (fallback) {
    logger.warn({
      module: 'model',
      msg: `Model '${model}' has no mapping for ${provider}, falling back to standard tier: ${fallback}`,
    });
    return { model: fallback, translated: true, original, reason: `unmapped model, fell back to standard tier` };
  }

  // No resolution possible — return original and let CLI handle the error
  return { model, translated: false, original };
}
```

### Integration with AgentAcpBridge

```typescript
// AgentAcpBridge.ts — updated model handling

import { resolveModel } from './ModelResolver.js';

export function startAcp(agent: Agent, config: ServerConfig, initialPrompt?: string): void {
  const conn = new AcpAdapter({ autopilot: agent.autopilot });
  // ...

  const provider = config.provider || 'copilot';
  const rawModel = agent.model || agent.role.model;
  const resolution = resolveModel(rawModel, provider);

  if (resolution?.translated && resolution.reason) {
    logger.info({
      module: 'agents',
      msg: `Model resolved for ${agent.role.id}: ${resolution.reason}`,
      agentId: agent.id,
    });
    // Store resolved model on agent for UI visibility
    agent._resolvedModel = resolution.model;
  }

  const cliArgs = [
    ...config.cliArgs,
    ...providerArgs,
    ...(resolution ? ['--model', resolution.model] : []),
    ...(agent.resumeSessionId ? ['--resume', agent.resumeSessionId] : []),
  ];

  // ...
}
```

### Integration with AgentManager.resolveModelForRole

The existing `resolveModelForRole()` (project config enforcement) should run BEFORE `resolveModel()`:

```
User requests model → resolveModelForRole(roleId, model, projectId)  [project enforcement]
                          ↓
                    resolveModel(enforcedModel, provider)  [cross-provider mapping]
                          ↓
                    CLI receives resolved model
```

---

## Model Availability Matrix

### What each current role assignment maps to per CLI:

| Role | Raw Model | Copilot | Claude | Gemini | Cursor | Codex | OpenCode |
|------|-----------|---------|--------|--------|--------|-------|----------|
| architect | `claude-opus-4.6` | ✅ claude-opus-4.6 | ✅ opus | ⚡ gemini-2.5-pro | ✅ claude-opus-4.6 | ⚡ gpt-5.2-codex | ⚡ anthropic/claude-opus-4-6 |
| developer | `claude-opus-4.6` | ✅ claude-opus-4.6 | ✅ opus | ⚡ gemini-2.5-pro | ✅ claude-opus-4.6 | ⚡ gpt-5.2-codex | ⚡ anthropic/claude-opus-4-6 |
| code-reviewer | `gemini-3-pro-preview` | ✅ gemini-3-pro-preview | ⚡ sonnet | ✅ gemini-3-pro-preview | ✅ gemini-3-pro-preview | ⚡ gpt-5.1-codex | ⚡ google/gemini-3-pro-preview |
| qa-tester | `claude-sonnet-4.6` | ✅ claude-sonnet-4.6 | ✅ sonnet | ⚡ gemini-2.5-flash | ✅ claude-sonnet-4.6 | ⚡ gpt-5.1-codex | ⚡ anthropic/claude-sonnet-4-6 |
| secretary | `gpt-4.1` | ✅ gpt-4.1 | ⚡ sonnet | ⚡ gemini-2.5-flash | ✅ gpt-4.1 | ✅ gpt-4.1 | ⚡ openai/gpt-4.1 |
| product-manager | `gpt-5.3-codex` | ✅ gpt-5.3-codex | ⚡ opus | ⚡ gemini-2.5-pro | ✅ gpt-5.3-codex | ✅ gpt-5.3-codex | ⚡ openai/gpt-5.3-codex |

✅ = passthrough (native)  ⚡ = translated (equivalent)

---

## Configuration Surface

### Per-Role in flightdeck.config.yaml (R15 ConfigStore)

```yaml
roles:
  architect:
    model: premium          # Tier alias — resolves per-provider
  developer:
    model: claude-opus-4.6  # Exact — translated if needed
  code-reviewer:
    model: standard         # Tier alias
  secretary:
    model: fast             # Tier alias
  qa-tester:
    model: claude-sonnet-4.6  # Exact
```

### Per-Provider Model Defaults (Optional Override)

```yaml
providers:
  gemini:
    tierDefaults:
      fast: gemini-2.5-flash-lite
      standard: gemini-2.5-flash
      premium: gemini-2.5-pro
  codex:
    tierDefaults:
      fast: gpt-5.1-codex-mini
      standard: gpt-5.1-codex
      premium: gpt-5.2-codex
```

Users can override the built-in tier mappings if they prefer different models (e.g., they want `premium` on Codex to be `gpt-5.1-codex-max` instead of `gpt-5.2-codex`).

### API Endpoints

Existing endpoints already accept `model` as a string:

- `POST /api/agents` body: `{ model: 'premium' }` or `{ model: 'claude-opus-4.6' }`
- `PATCH /api/agents/:id` body: `{ model: 'fast' }`
- `POST /api/roles` body: `{ model: 'standard' }`

No API changes needed. Tier aliases and exact names work through the same `model` field.

### UI Surface

The agent detail panel should show:
- **Requested model**: `claude-opus-4.6` (what the role/user specified)
- **Resolved model**: `gemini-2.5-pro` (what the CLI actually received)
- **Reason**: `claude-opus-4.6 → gemini-2.5-pro (gemini equivalent)`

This is the "honest uncertainty" UX principle from the daemon design — show what actually happened.

---

## Mixed-Backend Crew Interaction

With the multi-backend architecture (ACP subprocess + SDK direct), model selection has an additional dimension:

| Backend | Model Specification | Resolution |
|---------|-------------------|------------|
| ACP subprocess (Copilot) | `--model` CLI flag | ModelResolver → CLI flag |
| ACP subprocess (Claude) | `--model` CLI flag | ModelResolver → Claude alias |
| ACP subprocess (Gemini) | `--model` CLI flag | ModelResolver → Gemini model |
| ACP subprocess (Codex) | `--model` CLI flag | ModelResolver → OpenAI model |
| SDK direct (Claude SDK) | `model` parameter to `createAgent()` | No resolution needed — exact Anthropic model name |
| SDK direct (future) | API parameter | Provider-specific |

For SDK-direct backends, model names are always provider-native (since you're calling the provider's API directly). ModelResolver only needs to run for ACP subprocess backends where the CLI might not support the requested model.

### Example Mixed Crew

```yaml
# flightdeck.config.yaml
agents:
  defaultBackend: acp
  defaultProvider: copilot

  roles:
    architect:
      backend: sdk           # Claude SDK direct
      model: claude-opus-4.6  # Exact — passed to createAgent()
    developer:
      backend: acp
      provider: copilot
      model: claude-opus-4.6  # Exact — Copilot supports it natively
    code-reviewer:
      backend: acp
      provider: gemini
      model: premium          # Tier → gemini-2.5-pro
    qa-tester:
      backend: acp
      provider: codex
      model: standard         # Tier → gpt-5.1-codex
    secretary:
      backend: acp
      provider: copilot
      model: fast             # Tier → claude-haiku-4.5
```

---

## Edge Cases

### 1. Model Not in Equivalence Map

If a user specifies an obscure model (e.g., `grok-code-fast-1`) and the CLI is Gemini, there's no equivalence entry. The resolver falls back to the `standard` tier for that provider and logs a warning.

### 2. Claude CLI Aliases vs Full Names

Claude CLI accepts both `opus` and `claude-opus-4.6`. Flightdeck stores full names. The resolver translates to aliases for Claude CLI for cleaner output, but full names would also work.

### 3. OpenCode's provider/model Format

OpenCode uses `anthropic/claude-opus-4-5` (note: hyphens, not dots). The resolver handles this format translation.

### 4. Model Deprecation

When a model is deprecated (e.g., `claude-opus-4.1`), the equivalence map should be updated. The resolver should log a deprecation warning and map to the successor. This is a maintenance task, not an architecture issue.

### 5. undefined Model (No --model Flag)

If the role has no model and the agent has no override, `resolveModel()` returns `undefined` and no `--model` flag is sent. Each CLI uses its own default (GPT-4.1 for Copilot, Sonnet for Claude, gemini-2.5-pro for Gemini, etc.). This is fine — the CLI's default is reasonable for general use.

---

## Implementation Plan

### Phase 1: ModelResolver (~150 lines)
1. Create `packages/server/src/agents/ModelResolver.ts`
2. Implement `resolveModel(model, provider)` with tier aliases + equivalences + fallback
3. Integrate into `AgentAcpBridge.startAcp()` between `resolveModelForRole()` and CLI arg construction
4. Add `_resolvedModel` field to Agent for UI visibility
5. Unit tests for all resolution paths

### Phase 2: Configuration Surface (~50 lines)
1. Add `providers.<name>.tierDefaults` to R15 ConfigStore schema
2. Allow user override of tier mappings
3. Wire config into ModelResolver

### Phase 3: UI Integration (~30 lines frontend)
1. Show resolved model in agent detail panel
2. Show translation reason if model was mapped
3. Add model tier badge (fast/standard/premium) to agent cards

---

## Design Decisions

### D1: Exact names are primary, tiers are aliases
**Why**: Power users want fine-grained control (`claude-opus-4.6` not `premium`). But casual users shouldn't need to know model names per provider. Both work through the same `model` field.

### D2: Translation is logged, not silent
**Why**: If an architect's `claude-opus-4.6` gets mapped to `gemini-2.5-pro`, the user should know. Model capability differences are real. Logging + UI visibility prevents confusion.

### D3: Fallback to standard tier, not error
**Why**: It's better to run an agent on a reasonable model than to fail spawn entirely because the model name didn't map. The warning log + UI indicator tells the user what happened.

### D4: Equivalence map is subjective — that's OK
**Why**: There's no objective "equivalent" between Claude Opus and Gemini Pro. But there's a reasonable capability-tier mapping. The map is a best-effort default that users can override via config. Perfection isn't possible; usability is.

### D5: No model validation against CLI catalogs
**Why**: Model catalogs change frequently and vary by user subscription/region. Validation would require querying each CLI's available models at runtime, which adds latency and complexity. Let the CLI reject unknown models — its error message is more accurate than our stale catalog.
