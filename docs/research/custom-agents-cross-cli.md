# Custom Agents & System Prompts: Cross-CLI Research

> **Author**: Architect (e7f14c5e)  
> **Date**: 2026-03-07  
> **Context**: Flightdeck currently writes Copilot-specific `.agent.md` files. We need a universal approach for multi-CLI support.

---

## Executive Summary

Every CLI has a different mechanism for custom agents/system prompts, but they all reduce to the same primitive: **deliver a text prompt + tool permissions to the agent runtime**. The delivery mechanisms differ (files, env vars, JSON config, CLI flags), but the content is always markdown or plain text.

**Key insight**: Flightdeck already delivers the system prompt in the **initial message** to every agent (belt-and-suspenders with the `.agent.md` file). This means the `.agent.md` file is an *optimization* for Copilot's context compression survival — not the primary delivery path. For non-Copilot CLIs, the initial message IS the delivery path. File-based approaches per CLI are additive for CLIs that support them.

**Recommendation**: Keep Flightdeck's `RoleRegistry` as the single source of truth. Add a `RoleFileWriter` abstraction that translates roles into CLI-specific file formats at spawn time. The initial-prompt path already works universally — no changes needed there.

---

## Current Flightdeck Architecture

### Role System

**RoleRegistry.ts** (753 lines) defines 14 built-in roles:

| Role | Lines | Prompt Length | Key Focus |
|------|-------|--------------|-----------|
| architect | 8-30 | ~1200 chars | System design, 10x thinking |
| code-reviewer | 31-64 | ~1500 chars | Correctness, patterns, coverage |
| critical-reviewer | 65-96 | ~1400 chars | Security, performance, structure |
| readability-reviewer | 97-124 | ~1200 chars | Naming, organization, docs |
| developer | 125-151 | ~1100 chars | Code + tests, ownership |
| product-manager | 152-173 | ~900 chars | User needs, quality bar |
| tech-writer | 174-193 | ~800 chars | Docs, examples, DX |
| designer | 194-215 | ~900 chars | UX/UI, interaction patterns |
| generalist | 216-248 | ~1400 chars | Cross-disciplinary |
| agent | 249-258 | ~300 chars | Neutral general-purpose |
| radical-thinker | 259-288 | ~1300 chars | First-principles challenger |
| secretary | 289-330 | ~1800 chars | Progress tracking, checklists |
| qa-tester | 331-356 | ~1100 chars | End-to-end verification |
| lead | 357-586 | ~10000 chars | Supervision, delegation, DAG |

Each role has: `id`, `name`, `description`, `systemPrompt`, `color`, `icon`, `builtIn`, optional `model`.

Custom roles are stored in SQLite and loaded at startup.

All non-lead roles get `SELF_REPORT_INSTRUCTION` appended (~56 lines of Flightdeck command syntax).

### How System Prompts Reach the Agent (Current — Copilot Only)

Two delivery paths (belt-and-suspenders):

**Path 1: File-based (Copilot-specific)**
```
RoleRegistry → agentFiles.ts → ~/.copilot/agents/flightdeck-<role>.agent.md
AgentAcpBridge → --agent=flightdeck-<role> CLI flag
Copilot CLI loads the .agent.md file → persistent instructions survive context compression
```

**Path 2: Initial message (universal)**
```
Agent.start() → builds initialPrompt = systemPrompt + contextManifest + taskAssignment
AgentAcpBridge → conn.prompt(initialPrompt) as first message
Works with ANY ACP CLI — the prompt is just the first user message
```

### File Format (agentFiles.ts, 76 lines)

```yaml
---
name: flightdeck-developer
description: "Flightdeck Developer: Writes and modifies code..."
tools:
  - read
  - edit
  - search
  - shell
---

# Developer — Flightdeck Agent

[systemPrompt content here]
```

Written to: `~/.copilot/agents/flightdeck-<role-id>.agent.md`  
Referenced via: `--agent=flightdeck-<role-id>` CLI flag  
Triggered by: `AgentManager` at startup, `POST /api/roles` on create/update

### Key Files

| File | Purpose |
|------|---------|
| `packages/server/src/agents/RoleRegistry.ts` | Role definitions, registry class |
| `packages/server/src/agents/agentFiles.ts` | Writes .agent.md files (Copilot-specific) |
| `packages/server/src/agents/AgentAcpBridge.ts` | Wires agent → ACP, passes --agent flag |
| `packages/server/src/agents/Agent.ts` | Builds initialPrompt from role.systemPrompt |
| `packages/shared/src/domain/role.ts` | Role Zod schema |

---

## CLI-by-CLI Research

### 1. GitHub Copilot CLI (Current Baseline)

| Attribute | Value |
|-----------|-------|
| **Custom agent format** | `.agent.md` files |
| **File location** | `~/.copilot/agents/` (user) or `.github/agents/` (project) |
| **Format** | YAML frontmatter + Markdown body |
| **Selection mechanism** | `--agent=<name>` CLI flag |
| **Frontmatter fields** | `name`, `description`, `model`, `tools`, `mcp-servers` |
| **Tool options** | `read`, `edit`, `search`, `shell` |
| **Model override** | Via `model` in frontmatter or `--model` flag |
| **Context survival** | Agent file persists through context compression |
| **MCP support** | Via `mcp-servers` in frontmatter |

**Key behavior**: The `.agent.md` body becomes the agent's persistent system instructions. Even if the conversation is long and the context window fills up, Copilot keeps the agent file instructions. This is why we use the belt-and-suspenders approach — the initial message might get compressed away, but the agent file persists.

**What Flightdeck does today**: Writes files to `~/.copilot/agents/`, passes `--agent=flightdeck-<role>`. This is correct.

### 2. Claude Code (claude CLI)

| Attribute | Value |
|-----------|-------|
| **Custom agent format** | `CLAUDE.md` files + `.claude/agents/*.md` |
| **File location** | Project root (`./CLAUDE.md`), subdirs, user home (`~/.claude/CLAUDE.md`) |
| **Format** | Pure Markdown (no frontmatter for CLAUDE.md), YAML frontmatter for agents |
| **Selection mechanism** | Auto-loaded from directory hierarchy (no explicit flag) |
| **Frontmatter fields** | `name`, `description`, `model`, `color` (for .claude/agents/) |
| **Tool permissions** | Configured via `--allowedTools` or SDK config |
| **Model override** | Via frontmatter `model` field or `--model` flag |
| **Context survival** | Loaded fresh each session, merged project > subdir > user |
| **Max effective length** | ~100-200 lines recommended |

**How CLAUDE.md works**: Claude Code scans upward from cwd, finding and merging CLAUDE.md files. Contents are injected into the system prompt automatically at session start. No explicit `--agent` flag — it's convention-based.

**Custom agents** (`.claude/agents/*.md`): Support YAML frontmatter with `name`, `description`, `model`. The markdown body is the agent's instructions. These are newer and less documented than CLAUDE.md.

**For Flightdeck**:
- Write a `CLAUDE.md` in the working directory with the role's system prompt, OR
- Write to `.claude/agents/flightdeck-<role>.md` with YAML frontmatter
- Pass system prompt via initial message (universal path)
- The initial-prompt path works out of the box — Claude Code doesn't need file-based delivery

**SDK Direct path**: `systemPrompt` is a direct parameter to `createAgent()` — no files needed at all.

### 3. Google Gemini CLI

| Attribute | Value |
|-----------|-------|
| **Custom agent format** | `GEMINI.md` + `GEMINI_SYSTEM_MD` env var |
| **File location** | Project root (`./GEMINI.md`), or path via env var |
| **Format** | Pure Markdown |
| **Selection mechanism** | Auto-loaded (GEMINI.md) or `GEMINI_SYSTEM_MD=<path>` |
| **Frontmatter fields** | None (pure markdown) |
| **Tool permissions** | Not configurable per-agent |
| **Model override** | `--model gemini-2.5-pro` flag |
| **Variable substitution** | `${AgentSkills}`, `${AvailableTools}`, etc. |
| **System prompt override** | `GEMINI_SYSTEM_MD=true` uses `.gemini/system.md` |

**How it works**: `GEMINI.md` provides project context (like CLAUDE.md). For full system prompt override, set `GEMINI_SYSTEM_MD` env var to a file path. This **completely replaces** the default system instructions — including safety rules. The `.gemini/system.md` file is the convention when `GEMINI_SYSTEM_MD=true`.

**Community extensions**: Projects like `gemini-system-agents` provide pre-built persona files (architect.md, code-generator.md, etc.) — very similar to Flightdeck's role concept.

**For Flightdeck**:
- Write `.gemini/system.md` with the role's system prompt
- Set `GEMINI_SYSTEM_MD=true` in the spawn environment
- OR: Just use the initial-prompt path (works universally)
- **Caution**: Overriding system prompt removes Gemini's safety defaults. Consider prepending safety instructions.

### 4. Cursor CLI

| Attribute | Value |
|-----------|-------|
| **Custom agent format** | `.cursor/rules/*.mdc` (modern) or `.cursorrules` (legacy) |
| **File location** | `.cursor/rules/` directory in project |
| **Format** | YAML frontmatter + Markdown body |
| **Selection mechanism** | `alwaysApply: true`, glob patterns, manual @mention, or AI-decided |
| **Frontmatter fields** | `description`, `globs`, `alwaysApply` |
| **Tool permissions** | Not per-rule (global config) |
| **Model override** | Not per-rule (global setting) |
| **Activation types** | Always, pattern-based, manual, agent-decided |

**How it works**: `.mdc` files are modular rules. Each can target specific file patterns (e.g., `src/**/*.py`) or apply globally. Multiple rules compose — unlike CLAUDE.md which is a single merged file. Rules can reference other files with `@file path/to/file`.

**For Flightdeck**:
- Write `.cursor/rules/flightdeck-<role>.mdc` with `alwaysApply: true`
- This is project-scoped, not user-scoped (unlike Copilot's ~/.copilot/agents/)
- OR: Just use the initial-prompt path

### 5. OpenAI Codex CLI

| Attribute | Value |
|-----------|-------|
| **Custom agent format** | `AGENTS.md` files |
| **File location** | `~/.codex/AGENTS.md` (global), project root, subdirs |
| **Format** | Pure Markdown (no frontmatter) |
| **Selection mechanism** | Auto-loaded, layered from global → project → subdir |
| **Override** | `AGENTS.override.md` for temporary changes |
| **Tool permissions** | Not per-agent (global config) |
| **Model override** | Via CLI flags |
| **Layering** | Global → repo root → subdirectory (closer = higher priority) |

**How it works**: Like CLAUDE.md but named AGENTS.md. Files are concatenated from global to local, with closer-to-code files taking priority. No YAML frontmatter — pure markdown. `AGENTS.override.md` allows temporary overrides without modifying the main file.

**For Flightdeck**:
- Write `AGENTS.md` in the working directory with the role's system prompt
- OR: Just use the initial-prompt path
- Layering is simple concatenation — no agent selection mechanism

### 6. OpenCode CLI

| Attribute | Value |
|-----------|-------|
| **Custom agent format** | `opencode.json` agent definitions |
| **File location** | Project root `opencode.json` |
| **Format** | JSON (not markdown) |
| **Selection mechanism** | Named agents in config, `@agent-name` in conversation |
| **Config fields** | `description`, `model`, `prompt`, `temperature`, `top_p`, `tools`, `mode`, `permission` |
| **Tool permissions** | Per-agent: `write`, `edit`, `bash`, `webfetch` with `allow`/`ask`/`deny` |
| **Model override** | Per-agent in config |
| **Agent modes** | `primary` (user-facing), `subagent` (called by other agents), `all` |
| **Multi-agent** | Native support for specialized agent teams |

**How it works**: The ONLY CLI that uses structured config (JSON) instead of markdown files. Each agent is a named entry in `opencode.json` with full configuration including model, tools, permissions, and system prompt. Supports multi-agent orchestration natively with `primary` and `subagent` modes.

**For Flightdeck**:
- Write/update `opencode.json` with agent definitions
- Each role maps to a named agent in the config
- Most feature-rich per-agent config of any CLI
- OR: Just use the initial-prompt path via ACP

---

## Comparison Matrix

| Feature | Copilot | Claude | Gemini | Cursor | Codex | OpenCode |
|---------|---------|--------|--------|--------|-------|----------|
| **File format** | YAML+MD | MD (+ YAML for agents/) | MD | YAML+MD | MD | JSON |
| **File name** | `*.agent.md` | `CLAUDE.md` / `*.md` | `GEMINI.md` | `*.mdc` | `AGENTS.md` | `opencode.json` |
| **Location** | `~/.copilot/agents/` | Project root / `~/.claude/` | Project root / `.gemini/` | `.cursor/rules/` | Project root / `~/.codex/` | Project root |
| **Selection** | `--agent` flag | Auto-load / directory | Auto-load / env var | Glob / always / @mention | Auto-load / layered | Named in JSON / @agent |
| **YAML frontmatter** | ✅ name, desc, model, tools | ✅ (agents/ only) | ❌ | ✅ desc, globs, alwaysApply | ❌ | N/A (JSON) |
| **Per-agent model** | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Per-agent tools** | ✅ | ❌ (global config) | ❌ | ❌ | ❌ | ✅ |
| **Multi-agent** | Via flag | Not native | Not native | Via @mention | Not native | ✅ Native |
| **Context survival** | ✅ Persists through compression | Loaded per-session | Loaded per-session | Loaded per-session | Loaded per-session | Loaded per-session |
| **User-scoped** | ✅ `~/.copilot/` | ✅ `~/.claude/` | Via env var | ❌ (project only) | ✅ `~/.codex/` | ❌ (project only) |
| **System prompt override** | Agent file IS system prompt | CLAUDE.md merges into system | Full override via env | Rules append to system | Merges into system | `prompt` field in JSON |

---

## Universal Design

### Principle: Flightdeck Owns Role Definitions, Translators Handle CLI Formats

```
                          ┌─────────────────────┐
                          │   RoleRegistry       │
                          │   (source of truth)  │
                          │   14 built-in roles  │
                          │   + custom roles     │
                          └──────────┬──────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                 ▼
            ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
            │ RoleFileWriter│ │ Initial Msg  │ │ SDK Direct   │
            │ (per-CLI)    │ │ (universal)  │ │ (systemPrompt│
            │              │ │              │ │  parameter)  │
            └──────┬───────┘ └──────────────┘ └──────────────┘
                   │
     ┌─────────────┼──────────────┬──────────────┬──────────────┬──────────────┐
     ▼             ▼              ▼              ▼              ▼              ▼
  Copilot       Claude         Gemini        Cursor         Codex         OpenCode
  .agent.md     CLAUDE.md      .gemini/      .cursor/       AGENTS.md     opencode.json
                               system.md     rules/*.mdc
```

### Three Delivery Tiers

**Tier 1: Initial Message (Universal, Already Works)**
- System prompt is sent as the first `prompt()` call content
- Works with ALL CLIs via ACP — no file writing needed
- This is the **primary** delivery mechanism for non-Copilot CLIs
- Already implemented in `Agent.start()` line 159

**Tier 2: CLI-Specific Files (Optimization)**
- Writes role definitions in each CLI's native format
- Provides context compression survival (Copilot), auto-loading (Claude, Gemini, Codex), or rule composition (Cursor)
- **Additive** — improves quality but not required for functionality
- Each CLI gets a `RoleFileWriter` implementation

**Tier 3: SDK Direct (No Files, No Messages)**
- For SDK backends (Claude Agent SDK), the system prompt is a constructor parameter
- No files, no initial message — the SDK handles it
- Fastest and most reliable delivery

### Proposed Architecture

#### 1. RoleFileWriter Interface

```typescript
// packages/server/src/agents/roleFiles/types.ts

interface RoleFileWriter {
  /** Which CLI provider this writer targets */
  readonly provider: CliProvider;

  /**
   * Write role definition files for the given roles.
   * Called at server startup and when roles change.
   * 
   * @param roles - Roles to write files for
   * @param cwd - Working directory (for project-scoped files)
   */
  writeRoleFiles(roles: Role[], cwd: string): void;

  /**
   * Clean up any files from previous versions or other writers.
   */
  cleanup(): void;

  /**
   * Get CLI args needed to reference a role (e.g., --agent=flightdeck-dev).
   * Returns empty array if the CLI doesn't use flags for agent selection.
   */
  getCliArgsForRole(roleId: string): string[];

  /**
   * Get environment variables needed for this CLI's agent system.
   * Returns empty object if none needed.
   */
  getEnvForRole(roleId: string): Record<string, string>;
}
```

#### 2. Per-CLI Implementations

```typescript
// packages/server/src/agents/roleFiles/CopilotFileWriter.ts
class CopilotFileWriter implements RoleFileWriter {
  readonly provider = 'copilot';

  writeRoleFiles(roles: Role[], cwd: string): void {
    // Write to ~/.copilot/agents/flightdeck-<role>.agent.md
    // Format: YAML frontmatter (name, description, tools) + markdown body
    // CURRENT BEHAVIOR — extracted from agentFiles.ts
  }

  getCliArgsForRole(roleId: string): string[] {
    return [`--agent=flightdeck-${roleId}`];
  }

  getEnvForRole(): Record<string, string> { return {}; }
}

// packages/server/src/agents/roleFiles/ClaudeFileWriter.ts
class ClaudeFileWriter implements RoleFileWriter {
  readonly provider = 'claude-acp';

  writeRoleFiles(roles: Role[], cwd: string): void {
    // Write to <cwd>/.claude/agents/flightdeck-<role>.md
    // Format: YAML frontmatter (name, description) + markdown body
    // CLAUDE.md at project root is shared context, not per-agent
  }

  getCliArgsForRole(roleId: string): string[] {
    // Claude Code doesn't have an --agent flag
    // Agent selection happens via the .claude/agents/ directory
    return [];
  }

  getEnvForRole(): Record<string, string> { return {}; }
}

// packages/server/src/agents/roleFiles/GeminiFileWriter.ts
class GeminiFileWriter implements RoleFileWriter {
  readonly provider = 'gemini';

  writeRoleFiles(roles: Role[], cwd: string): void {
    // Write per-role files to <cwd>/.gemini/agents/flightdeck-<role>.md
    // The active role's file path is set via GEMINI_SYSTEM_MD env var at spawn
  }

  getCliArgsForRole(): string[] { return []; }

  getEnvForRole(roleId: string): Record<string, string> {
    // Point Gemini to the role-specific system prompt file
    return {
      GEMINI_SYSTEM_MD: `.gemini/agents/flightdeck-${roleId}.md`,
    };
  }
}

// packages/server/src/agents/roleFiles/CursorFileWriter.ts
class CursorFileWriter implements RoleFileWriter {
  readonly provider = 'cursor';

  writeRoleFiles(roles: Role[], cwd: string): void {
    // Write to <cwd>/.cursor/rules/flightdeck-<role>.mdc
    // Format: YAML frontmatter (description, alwaysApply: false) + markdown body
    // Only the active role's file gets alwaysApply: true at spawn time
  }

  getCliArgsForRole(): string[] { return []; }
  getEnvForRole(): Record<string, string> { return {}; }
}

// packages/server/src/agents/roleFiles/CodexFileWriter.ts
class CodexFileWriter implements RoleFileWriter {
  readonly provider = 'codex';

  writeRoleFiles(roles: Role[], cwd: string): void {
    // Write AGENTS.md to <cwd>/ with the role's system prompt
    // Codex doesn't support per-agent selection — one AGENTS.md per directory
    // For multi-agent crews, each agent needs its own cwd or we rely on initial message
  }

  getCliArgsForRole(): string[] { return []; }
  getEnvForRole(): Record<string, string> { return {}; }
}

// packages/server/src/agents/roleFiles/OpenCodeFileWriter.ts
class OpenCodeFileWriter implements RoleFileWriter {
  readonly provider = 'opencode';

  writeRoleFiles(roles: Role[], cwd: string): void {
    // Write/update opencode.json with agent definitions
    // Each role becomes a named agent entry
    // Merge with existing opencode.json if present
  }

  getCliArgsForRole(): string[] { return []; }
  getEnvForRole(): Record<string, string> { return {}; }
}
```

#### 3. Factory + Registry

```typescript
// packages/server/src/agents/roleFiles/index.ts

const FILE_WRITERS: Record<CliProvider, () => RoleFileWriter> = {
  copilot: () => new CopilotFileWriter(),
  'claude-acp': () => new ClaudeFileWriter(),
  gemini: () => new GeminiFileWriter(),
  cursor: () => new CursorFileWriter(),
  codex: () => new CodexFileWriter(),
  opencode: () => new OpenCodeFileWriter(),
};

export function createRoleFileWriter(provider: CliProvider): RoleFileWriter {
  const factory = FILE_WRITERS[provider];
  if (!factory) {
    throw new Error(`No RoleFileWriter for provider: ${provider}`);
  }
  return factory();
}
```

#### 4. Integration with AgentAcpBridge

```typescript
// AgentAcpBridge.ts — updated spawn logic

export function startAcp(agent: Agent, config: ServerConfig, initialPrompt?: string): void {
  const conn = new AcpAdapter({ autopilot: agent.autopilot });
  agent._setAcpConnection(conn);
  agent.status = 'running';
  wireAcpEvents(agent, conn);

  const provider = config.provider || 'copilot';
  const writer = createRoleFileWriter(provider);

  // Get CLI args for this provider's agent selection mechanism
  const providerArgs = writer.getCliArgsForRole(agent.role.id);

  // Get env vars for this provider
  const providerEnv = writer.getEnvForRole(agent.role.id);

  const cliArgs = [
    ...config.cliArgs,
    ...providerArgs,  // Provider-specific: --agent=... for Copilot, empty for others
    ...(agent.model || agent.role.model ? ['--model', agent.model || agent.role.model!] : []),
    ...(agent.resumeSessionId ? ['--resume', agent.resumeSessionId] : []),
  ];

  conn.start({
    cliCommand: config.cliCommand,
    cliArgs,
    cwd: agent.cwd || process.cwd(),
    env: providerEnv,  // NEW: provider-specific env vars
  }).then((sessionId) => {
    agent.sessionId = sessionId;
    agent._notifySessionReady(sessionId);
    if (initialPrompt) {
      return conn.prompt(initialPrompt);  // Universal path — works for all CLIs
    }
  }).catch((err) => { /* ... */ });
}
```

### Where Role Definitions Live

**Decision**: Keep them in `RoleRegistry.ts` (source of truth), written to CLI-specific locations at spawn time.

| CLI | File Location | Scope | Written When |
|-----|--------------|-------|-------------|
| Copilot | `~/.copilot/agents/` | User-global | Server startup + role changes |
| Claude | `<cwd>/.claude/agents/` | Per-project | Before agent spawn |
| Gemini | `<cwd>/.gemini/agents/` | Per-project | Before agent spawn |
| Cursor | `<cwd>/.cursor/rules/` | Per-project | Before agent spawn |
| Codex | `<cwd>/AGENTS.md` | Per-project | Before agent spawn |
| OpenCode | `<cwd>/opencode.json` | Per-project | Before agent spawn |
| SDK | N/A (in-memory) | N/A | At adapter creation |

**Important distinction**: Copilot files are user-scoped (in `~/`) and written once at startup. All other CLIs use project-scoped files (in `<cwd>/`) and should be written per-agent before spawn, then cleaned up after session ends.

### Handling CLI-Specific Features

#### Tool Permissions

| CLI | Per-Agent Tools? | How to Map |
|-----|-----------------|------------|
| Copilot | ✅ `tools:` in frontmatter | `['read', 'edit', 'search', 'shell']` (current) |
| Claude | ❌ Global config | Pass via `--allowedTools` or SDK config |
| Gemini | ❌ | Not configurable |
| Cursor | ❌ | Global setting |
| Codex | ❌ | Global config |
| OpenCode | ✅ `tools:` and `permission:` | Full per-agent tool + permission mapping |

Only Copilot and OpenCode support per-agent tool configuration. For others, tool permissions are global. Flightdeck should write tool permissions where supported and fall back to the initial message for guidance.

#### Model Override

| CLI | Per-Agent Model? | How to Map |
|-----|-----------------|------------|
| Copilot | ✅ `model:` in frontmatter or `--model` flag | Already implemented |
| Claude | ✅ `model:` in frontmatter or `--model` flag | Same pattern |
| Gemini | ❌ per-agent, `--model` flag only | Pass as CLI arg |
| Cursor | ❌ | Global setting |
| Codex | ❌ | Global setting |
| OpenCode | ✅ `model:` in JSON config | Write to opencode.json |

#### MCP Server Integration

| CLI | MCP Support? | How to Map |
|-----|-------------|------------|
| Copilot | ✅ `mcp-servers:` in frontmatter | Write MCP config per-agent |
| Claude | ✅ Via `.claude/settings.json` | Write settings file |
| Gemini | Unknown | Not documented |
| Cursor | ❌ | N/A |
| Codex | ❌ | N/A |
| OpenCode | ❌ | N/A |

---

## The Multi-Agent Problem

### Challenge: Shared Files

Several CLIs (Codex, Gemini) use a single file for all context (`AGENTS.md`, `GEMINI.md`). When Flightdeck runs a multi-agent crew, each agent has a different role/system prompt. Options:

1. **Per-agent cwd** (recommended): Each agent gets its own subdirectory with its own config files. E.g., `<project>/.flightdeck/agents/<agent-id>/` with a symlinked workspace.

2. **Rely on initial message**: Don't write CLI-specific files at all — just send the system prompt as the first message. This works for all CLIs but loses context compression survival.

3. **Dynamic file swapping**: Write the role file just before spawn, overwriting any previous content. Race-prone with concurrent spawns.

**Recommendation**: Use approach #1 (per-agent cwd) for CLIs that use shared files (Codex, Gemini). For CLIs that support per-agent files (Copilot, Claude, Cursor, OpenCode), write all roles to the same directory.

### Challenge: Cleanup

Project-scoped files (`.claude/agents/`, `.cursor/rules/`, `AGENTS.md`) need cleanup when the session ends to avoid polluting the repo. Options:

1. **Gitignore**: Add `.flightdeck/agents/` to `.gitignore`. Have writers put files there and symlink or point CLIs to that location.

2. **Session cleanup hook**: `AgentManager.shutdown()` calls `writer.cleanup()` for each active writer.

3. **Temporary directory**: Write files to a temp dir and point CLIs there via env vars or flags.

**Recommendation**: Combine approaches: write files to `<cwd>/.flightdeck/agents/<provider>/`, add to `.gitignore`, and symlink or set env vars to point CLIs at the right location. Clean up on session end.

---

## Implementation Plan

### Phase 1: Extract and Generalize (Minimal — ~100 lines)
1. Extract current `agentFiles.ts` into `roleFiles/CopilotFileWriter.ts`
2. Create `RoleFileWriter` interface in `roleFiles/types.ts`
3. Create `roleFiles/index.ts` with factory
4. Update `AgentAcpBridge.ts` to use `createRoleFileWriter(provider)`
5. No behavior change for Copilot — pure refactor

### Phase 2: Add Writers for Priority CLIs (~200 lines)
1. `ClaudeFileWriter` — `.claude/agents/` format
2. `GeminiFileWriter` — `.gemini/agents/` + `GEMINI_SYSTEM_MD` env
3. `CodexFileWriter` — `AGENTS.md` format

### Phase 3: Remaining CLIs + Cleanup (~150 lines)
1. `CursorFileWriter` — `.cursor/rules/*.mdc` format
2. `OpenCodeFileWriter` — `opencode.json` format
3. Session cleanup hooks in `AgentManager`
4. `.gitignore` management for `.flightdeck/agents/`

### Phase 4: Per-Agent CWD for Shared-File CLIs (~100 lines)
1. Create per-agent subdirectories for Codex/Gemini
2. Symlink workspace into subdirectories
3. Point each agent at its own cwd

---

## Design Decisions

### D1: Keep RoleRegistry as source of truth
**Why**: Roles are a Flightdeck concept, not a CLI concept. The registry provides a stable abstraction; CLI-specific files are a translation artifact. Custom roles from the UI/API flow through the same path.

### D2: Initial message is the primary delivery path
**Why**: It works with ALL CLIs without any CLI-specific code. File-based delivery is an optimization, not a requirement. This means Phase 1 of multi-CLI support is essentially free — just change the spawn command and base args.

### D3: File writers are per-provider, not per-CLI
**Why**: `claude-acp` (subprocess) and `claude-sdk` (direct) both use the same `ClaudeFileWriter` format. The file writer cares about the agent runtime's config format, which is determined by the CLI/SDK, not the transport.

### D4: Project-scoped files go in .flightdeck/agents/
**Why**: Avoids polluting the user's project config (`.claude/`, `.cursor/`, etc.). We control the directory, can gitignore it, and clean it up reliably. CLI-specific env vars or flags point at our directory.

### D5: No abstract base class — just the interface
**Why**: The implementations are small (30-80 lines each) and share almost no logic. An abstract base class would add indirection without reducing duplication.

---

## Appendix: File Format Examples

### Copilot (.agent.md)
```yaml
---
name: flightdeck-architect
description: "Flightdeck Architect: High-level system design, architecture decisions"
model: claude-opus-4.6
tools:
  - read
  - edit
  - search
  - shell
---

# Architect — Flightdeck Agent

You are a Senior Software Architect with a 10x improvements mindset...
```

### Claude (.claude/agents/flightdeck-architect.md)
```yaml
---
name: flightdeck-architect
description: "Flightdeck Architect: High-level system design, architecture decisions"
model: opus
---

# Architect — Flightdeck Agent

You are a Senior Software Architect with a 10x improvements mindset...
```

### Gemini (.gemini/agents/flightdeck-architect.md)
```markdown
# Architect — Flightdeck Agent

You are a Senior Software Architect with a 10x improvements mindset...

## Available Tools
${AvailableTools}
```

### Cursor (.cursor/rules/flightdeck-architect.mdc)
```yaml
---
description: Flightdeck Architect role — high-level system design and architecture
alwaysApply: true
---

# Architect — Flightdeck Agent

You are a Senior Software Architect with a 10x improvements mindset...
```

### Codex (AGENTS.md)
```markdown
# Flightdeck Agent: Architect

You are a Senior Software Architect with a 10x improvements mindset...

## Workflow
- Explore the codebase thoroughly before making changes
- Challenge problem framing — ask if we're solving the right problem
- Prefer clear module boundaries and explicit interfaces
```

### OpenCode (opencode.json)
```json
{
  "agent": {
    "flightdeck-architect": {
      "description": "High-level system design, architecture decisions",
      "model": "anthropic/claude-opus-4-20250514",
      "prompt": "You are a Senior Software Architect with a 10x improvements mindset...",
      "temperature": 0.2,
      "tools": { "write": true, "edit": true, "bash": true },
      "mode": "primary"
    }
  }
}
```
