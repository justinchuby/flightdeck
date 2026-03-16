# Configuration System - Quick Reference Guide

## File Locations

| Component | File | Lines |
|-----------|------|-------|
| Server Config | `packages/server/src/config.ts` | 63 |
| Role Registry | `packages/server/src/agents/RoleRegistry.ts` | 764 |
| Model Selector | `packages/server/src/agents/ModelSelector.ts` | 159 |
| Model Defaults | `packages/server/src/projects/ModelConfigDefaults.ts` | 90 |
| Config Routes | `packages/server/src/routes/config.ts` | 80 |
| Role Routes | `packages/server/src/routes/roles.ts` | 50 |
| DB Schema | `packages/server/src/db/schema.ts` | 40+ |
| Validation | `packages/server/src/validation/schemas.ts` | 158 |
| Skills | `.github/skills/` (9 directories) | N/A |

## Environment Variables

```bash
PORT=3001                    # HTTP server port (default)
HOST=127.0.0.1             # Bind address (default)
COPILOT_CLI_PATH=copilot   # CLI command path (default)
MAX_AGENTS=50              # Max concurrent agents (default)
DB_PATH=./flightdeck.db    # Database path (default)
SERVER_SECRET=...          # JWT secret (auto-generated if missing)
AUTH=none                  # Disable auth (set to 'none')
TELEGRAM_BOT_TOKEN=...    # Telegram bot token (see docs/guides/telegram-setup.md)
```

## ServerConfig Interface

```typescript
interface ServerConfig {
  port: number;              // Default: 3001, from $PORT
  host: string;              // Default: 127.0.0.1, from $HOST
  cliCommand: string;        // Default: 'copilot', from $COPILOT_CLI_PATH
  cliArgs: string[];         // Default: []
  maxConcurrentAgents: number; // Default: 50, from $MAX_AGENTS
  dbPath: string;            // Default: ./flightdeck.db, from $DB_PATH
}
```

## 14 Built-In Roles (with Default Models)

### Analysis & Review (Gemini-based)
- **code-reviewer** (gemini-3-pro-preview) — Correctness, patterns, tests
- **critical-reviewer** (gemini-3-pro-preview) — Architecture, security, perf
- **readability-reviewer** (gemini-3-pro-preview) — Naming, org, documentation
- **radical-thinker** (gemini-3-pro-preview) — First-principles, innovation

### Implementation
- **developer** (claude-opus-4.6) — Code, tests, features, fixes
- **architect** (claude-opus-4.6) — System design, exploration, mapping

### Support Roles
- **product-manager** (gpt-5.3-codex) — User needs, quality bar
- **tech-writer** (gpt-5.2) — Documentation, examples, API design
- **designer** (claude-opus-4.6) — UX/UI, interaction design
- **qa-tester** (claude-sonnet-4.6) — End-to-end testing, verification
- **generalist** (claude-opus-4.6) — Hardware, mechanics, 3D, research

### Management
- **lead** (claude-opus-4.6) — Supervision, delegation ⭐
- **secretary** (gpt-4.1) — Progress tracking ⭐
- **agent** (none) — General-purpose, neutral

⭐ = receives status updates (receivesStatusUpdates: true)

## Available Models (5 Main + 11 Known)

### 5 Fully Configured
| Model | Tier | Context | Cost/1k | Best For |
|-------|------|---------|---------|----------|
| claude-haiku-4.5 | fast | 200k | $0.25 | Quick tasks, formatting |
| claude-sonnet-4.6 | standard | 200k | $3.00 | Implementation, debugging |
| claude-opus-4.6 | premium | 200k | $15.00 | Complex work, architecture |
| gemini-3-pro-preview | standard | 1M | $1.25 | Large context, research |
| gpt-5.1-codex | standard | 200k | $2.50 | Code generation |

### 11 Additional Known IDs
claude-opus-4.5, claude-sonnet-4.5, claude-sonnet-4, claude-haiku-4.5,
gpt-5.3-codex, gpt-5.2-codex, gpt-5.2, gpt-5.1-codex-max, gpt-5.1,
gpt-5.1-codex-mini, gpt-5-mini, gpt-4.1

## API Endpoints

### Server Config
```
GET    /api/config              # Retrieve current ServerConfig
PATCH  /api/config              # Update maxConcurrentAgents, host (persisted)
```

### Roles
```
GET    /api/roles               # List all roles (built-in + custom)
POST   /api/roles               # Register custom role (persisted)
DELETE /api/roles/:id           # Delete custom role
POST   /api/roles/test          # Dry-run custom role (no LLM call)
```

### System
```
POST   /api/system/pause        # Pause all agents
POST   /api/system/resume       # Resume agents
GET    /api/system/status       # Check if paused
```

### Budget
```
GET    /api/budget?projectId=.. # Get budget status
POST   /api/budget              # Set limit/thresholds
POST   /api/budget/check        # Check if exceeded
```

## Model Resolution Priority (Agent Spawn)

When spawning an agent with a role:
1. **Project config override** — Is model in this role's allowed list?
   - YES → use requested model
   - NO → use first allowed model (log warning)
2. **No project config** → use requested model as-is
3. **No requested model** → use role's first allowed model

## Key Functions

### config.ts
```typescript
getConfig(): ServerConfig
updateConfig(patch: Partial<ServerConfig>): ServerConfig
```

### RoleRegistry
```typescript
roleRegistry.get(id: string): Role
roleRegistry.getAll(): Role[]
roleRegistry.register(role): Role  // Custom, persisted to DB
roleRegistry.remove(id): boolean
roleRegistry.getLeadPrompt(): string
```

### ProjectRegistry (Model Config)
```typescript
projectRegistry.getModelConfig(projectId): { 
  config: ProjectModelConfig;       // Merged (stored + defaults)
  defaults: ProjectModelConfig;     // Original defaults
}
projectRegistry.setModelConfig(projectId, config): void
```

### AgentManager
```typescript
agentManager.resolveModelForRole(roleId, requestedModel, projectId): {
  model: string | undefined;
  overridden: boolean;
  reason?: string;
}
agentManager.setMaxConcurrent(n: number): void
```

## Concurrency Limits

- **Soft limit** — `config.maxConcurrentAgents` (default 50)
  - Configurable at runtime via `PATCH /api/config`
  - Persists to SQLite
  - Enforced at agent spawn time

- **Hard ceiling** — `MAX_CONCURRENCY_LIMIT = 200`
  - Prevents runaway spawning
  - Cannot be exceeded even with system approval

## Database Persistence

**roles table:**
- Stores custom roles only (builtIn = 0)
- Built-in roles hardcoded in RoleRegistry.ts, never stored
- Includes: id, name, description, systemPrompt, color, icon, model

**settings table:**
- Key-value pairs (e.g., "maxConcurrentAgents" → "75")
- Survives server restart

## Skills System

**Location:** `.github/skills/<skill-name>/SKILL.md`

**Format:**
```yaml
---
name: my-skill
description: When/why to use this skill
---

# My Skill
[Markdown content...]
```

**Storage:** Git repository (not database)

**Loading:** Copilot context injection based on description relevance

**Purpose:** Reusable knowledge, patterns, learnings

## SELF_REPORT_INSTRUCTION

- 900+ lines appended to all **non-lead** roles at instantiation
- Explains status reporting, commands, capability system, skill recording
- **NOT appended to lead role** (lead has separate prompt)
- **NOT stored in DB** (appended at load time)

## Validation Rules

### configPatchSchema
- `maxConcurrentAgents` — positive integer, optional
- `host` — non-empty string, optional
- At least one field required

### registerRoleSchema
- `id` — kebab-case only (matches `/^[a-z0-9]+(-[a-z0-9]+)*$/`)
- `name` — non-empty string required
- `description` — optional, defaults to ""
- `systemPrompt` — optional, defaults to ""
- `color` — hex color optional, defaults to "#888"
- `icon` — emoji optional, defaults to "🤖"
- `model` — model ID optional

## Example Operations

### Get Current Config
```bash
curl http://localhost:3001/api/config
```

### Change Max Concurrent Agents (Runtime)
```bash
curl -X PATCH http://localhost:3001/api/config \
  -H "Content-Type: application/json" \
  -d '{"maxConcurrentAgents": 100}'
```

### List All Roles
```bash
curl http://localhost:3001/api/roles
```

### Register Custom Role
```bash
curl -X POST http://localhost:3001/api/roles \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-custom-role",
    "name": "My Custom Role",
    "description": "Does X, Y, Z",
    "systemPrompt": "You are...",
    "color": "#ff0000",
    "icon": "⚡",
    "model": "claude-opus-4.6"
  }'
```

### Spawn Agent with Specific Model
```bash
curl -X POST http://localhost:3001/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "roleId": "developer",
    "task": "Implement feature X",
    "model": "claude-sonnet-4.6"
  }'
```

## Database Path Migration

If `.flightdeck.db` doesn't exist but `.Flightdeck.db` does:
- Auto-renamed to `.flightdeck.db` on startup
- WAL/SHM sidecar files also migrated
- Falls back to legacy path on permission errors
- Backward compatible with existing data

## Quick Facts

- **Config is in-memory + partially persisted** (only maxConcurrentAgents → SQLite)
- **Roles are DB-persisted** (custom roles only; built-in roles in code)
- **Models are not stored** (constants in code, no DB)
- **Skills are not stored in DB** (git repository documentation)
- **Runtime updates work via PATCH** (call updateConfig, persist to settings table)
- **Restart survives** (maxConcurrentAgents restored from SQLite)

