# Providers

Flightdeck uses a multi-provider architecture that lets you swap between AI coding assistants without changing your workflow. All providers communicate via the [ACP (Agent Client Protocol)](https://spec.acp.dev/) over stdio — a universal transport that eliminates the need for provider-specific SDKs.

## Supported Providers

| Provider | Icon | Binary | Required Env Vars | Status |
|----------|------|--------|-------------------|--------|
| **GitHub Copilot** | 🐙 | `copilot` | None (uses `gh auth`) | GA |
| **Google Gemini CLI** | 💎 | `gemini` | `GEMINI_API_KEY` | GA |
| **Claude Agent (ACP)** | 🟠 | `claude-agent-acp` | `ANTHROPIC_API_KEY` | GA |
| **Codex (ACP)** | 🤖 | `codex-acp` | `OPENAI_API_KEY` | GA |
| **Cursor** | ↗️ | `agent` | `CURSOR_API_KEY` | Preview |
| **OpenCode** | 🔓 | `opencode` | None (manages own keys) | Preview |

## Configuration

Set your active provider in `flightdeck.config.yaml`:

```yaml
provider:
  id: copilot    # One of: copilot, gemini, claude, codex, cursor, opencode
```

### Config File Locations

Config files are resolved in this order (later overrides earlier):

1. Built-in defaults
2. `~/.flightdeck/config.yaml` (user-level, auto-created on first run)
3. `./flightdeck.config.yaml` (repo-level overrides)
4. `FLIGHTDECK_CONFIG` env var (explicit path)
5. Environment variables (startup-only)
6. API `PATCH` (runtime changes)

Config is **hot-reloaded** — changes take effect without restarting the server.

### Switching Providers

To switch providers, update the `provider.id` field and set any required environment variables:

```yaml
# Example: Switch to Claude
provider:
  id: claude
  envOverride:
    ANTHROPIC_API_KEY: sk-ant-...

# Example: Switch to Gemini
provider:
  id: gemini
  envOverride:
    GEMINI_API_KEY: AIza...

# Example: Switch to Codex
provider:
  id: codex
  envOverride:
    OPENAI_API_KEY: sk-...
```

You can also set env vars in your shell instead of using `envOverride`:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Advanced Options

```yaml
provider:
  id: copilot
  binaryOverride: /custom/path/copilot   # Override binary path
  argsOverride: ['--acp', '--stdio']      # Override spawn arguments
  envOverride:                            # Extra environment variables
    SOME_VAR: value
```

## Model Selection

Each provider maps models to three quality tiers:

| Tier | Use Case | Example Models |
|------|----------|---------------|
| **fast** | Quick tasks, low cost | claude-haiku-4.5, gemini-2.5-flash-lite, gpt-5.1-codex-mini |
| **standard** | General development | claude-sonnet-4.6, gemini-2.5-flash, gpt-5.3-codex |
| **premium** | Complex architecture | claude-opus-4.6, gemini-2.5-pro, gpt-5.4 |

### Provider Tier Mappings

| Provider | Fast | Standard | Premium |
|----------|------|----------|---------|
| GitHub Copilot | claude-haiku-4.5 | claude-sonnet-4.6 | claude-opus-4.6 |
| Gemini CLI | gemini-2.5-flash-lite | gemini-2.5-flash | gemini-2.5-pro |
| Claude Agent | haiku | default | opus |
| Codex | gpt-5.1-codex-mini | gpt-5.3-codex | gpt-5.4 |
| Cursor | claude-haiku-4.5 | claude-sonnet-4.6 | claude-opus-4.6 |
| OpenCode | anthropic/claude-haiku-4-5 | anthropic/claude-sonnet-4-6 | anthropic/claude-opus-4-6 |

### Per-Role Model Defaults

Configure default models for each agent role:

```yaml
models:
  defaults:
    lead: [claude-opus-4.6]
    developer: [claude-opus-4.6]
    architect: [claude-opus-4.6]
    code-reviewer: [gemini-3-pro-preview, claude-opus-4.6]
    critical-reviewer: [gemini-3-pro-preview]
    readability-reviewer: [gemini-3-pro-preview]
    tech-writer: [claude-sonnet-4.6, gpt-5.2]
    secretary: [gpt-4.1, gpt-5.2]
    qa-tester: [claude-sonnet-4.6]
```

When a list is provided, Flightdeck uses the first available model based on the active provider's capabilities.

### Known Models

The `models.known` list defines which models appear in the UI model selector:

```yaml
models:
  known:
    - claude-opus-4.6
    - claude-sonnet-4.6
    - claude-haiku-4.5
    - gemini-3-pro-preview
    - gpt-5.4
    - gpt-5.3-codex
    # ... see flightdeck.config.example.yaml for full list
```

## Provider UI

The **Settings → Providers** section lets you manage providers from the dashboard:

- **Enable/disable** providers with toggle switches
- **Drag-and-drop** to set provider preference order
- **Select preferred models** per provider
- **Test authentication** with the auth test button
- **View status** — detected, authenticated, or needs setup

## Architecture

All providers use the same adapter pattern:

```
CLI Binary → ACP (stdio/JSON-RPC) → AcpAdapter → AgentManager
```

The `AcpAdapter` is the single production adapter — it handles spawning the CLI binary, managing the JSON-RPC session, and translating ACP messages to Flightdeck's internal event system.

Key components:
- **PROVIDER_REGISTRY** (`packages/shared/src/domain/provider.ts`) — Single source of truth for all provider metadata
- **AdapterFactory** — Creates adapter instances with model resolution and env setup
- **AcpAdapter** — Universal transport, implements the `AgentAdapter` interface
- **ProviderManager** (`packages/server/src/providers/ProviderManager.ts`) — Runtime provider management

### Cross-Provider Model Resolution

When an agent requests a model that's native to a different provider backend (e.g., requesting a GPT model while using Copilot), the model resolver:

1. Checks if the model is in the current provider's `nativeModelProviders`
2. Applies any `restrictedModels` constraints
3. Maps through `modelAliases` if needed (e.g., Claude's `opus` alias)
4. Falls back to the provider's `standard` tier model if no match

### Session Resume

All providers support `loadSession` (the ability to load a previous session). However, richer session capabilities vary:

- **Full session management** (fork + list + resume): Claude, OpenCode
- **Partial** (list + resume, no fork): Kimi, Qwen Code
- **List only** (can list sessions but not resume/fork): Copilot, Codex
- **loadSession only** (no sessionCapabilities): Gemini

The `supportsLoadSession` flag in `PROVIDER_REGISTRY` is `true` for all providers. The distinction between `loadSession` and `sessionCapabilities.resume` is important — see the [ACP Capabilities reference](/reference/acp-capabilities) for probe-verified details.
