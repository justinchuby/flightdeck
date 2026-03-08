# Flightdeck Configuration System - Implementation Specification

## Overview

The configuration system in Flightdeck is composed of multiple layers:
1. **Server-level config** (`ServerConfig`) - port, host, database, concurrency limits
2. **Role system** (`RoleRegistry`) - 14 built-in roles + custom role management
3. **Model configuration** - Available models with tiers, costs, and per-role defaults
4. **Project model configuration** - Per-project model restrictions
5. **Runtime updates** - Configuration changes via PATCH endpoint with persistence

---

## 1. SERVER CONFIG

### File Location
`/packages/server/src/config.ts` (63 lines)

### ServerConfig Interface
```typescript
export interface ServerConfig {
  port: number;
  host: string;
  cliCommand: string;
  cliArgs: string[];
  maxConcurrentAgents: number;
  dbPath: string;
}
```

### Configuration Sources (Priority Order)
1. **Environment variables** (highest priority)
2. **Defaults** (hardcoded fallback)

### Environment Variables

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `PORT` | number | `3001` | HTTP server port |
| `HOST` | string | `127.0.0.1` | HTTP server bind address |
| `COPILOT_CLI_PATH` | string | `copilot` | Path to Copilot CLI command |
| `MAX_AGENTS` | number | `50` | Max concurrent agents (soft limit) |
| `DB_PATH` | string | `./flightdeck.db` | SQLite database path |
| `SERVER_SECRET` | string | (auto-generated) | JWT/API auth token |
| `AUTH` | string | (required) | Set to `'none'` to disable auth |

### Defaults Object
```typescript
const defaults: ServerConfig = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '127.0.0.1',
  cliCommand: process.env.COPILOT_CLI_PATH || 'copilot',
  cliArgs: [],
  maxConcurrentAgents: parseInt(process.env.MAX_AGENTS || '50', 10),
  dbPath: resolveDbPath(process.env.DB_PATH),
};
```

### Database Path Resolution
The system implements backward-compatibility migration:
- If `./flightdeck.db` doesn't exist but `./flightdeck.db` does → auto-renames `Flightdeck.db` to `flightdeck.db`
- Also migrates WAL/SHM sidecar files if present
- Falls back to legacy path on permission errors

### API Endpoints for Server Config

#### GET /api/config
Returns current `ServerConfig` object.

#### PATCH /api/config
Updates config at runtime. Only mutable fields:
- `maxConcurrentAgents` (number, positive)
- `host` (string, non-empty)

**Response:** Updated `ServerConfig` object

**Side effects:**
- Calls `agentManager.setMaxConcurrent()` if maxConcurrentAgents changed
- Persists `maxConcurrentAgents` to SQLite via `db.setSetting('maxConcurrentAgents', ...)`
- Survives server restart

### Runtime Config Functions

```typescript
export function getConfig(): ServerConfig {
  return config;
}

export function updateConfig(patch: Partial<ServerConfig>): ServerConfig {
  config = { ...config, ...patch };
  return config;
}
```

### Concurrency Limits

#### Hard Ceiling: MAX_CONCURRENCY_LIMIT = 200
Prevents runaway agent spawning. Enforced in AgentLifecycle.ts.

#### Soft Limit: maxConcurrentAgents (config value)
- Default: 50 agents
- Configurable at runtime via PATCH /api/config
- Enforced in: `AgentManager.spawn()`
- Persisted across restarts

---

## 2. ROLE SYSTEM

### File Location
`/packages/server/src/agents/RoleRegistry.ts` (764 lines)

### Role Interface
```typescript
export interface Role {
  id: string;                  // kebab-case identifier
  name: string;                // Display name
  description: string;         // Short description
  systemPrompt: string;        // Complete system instructions
  color: string;               // Hex color for UI
  icon: string;                // Emoji icon
  builtIn: boolean;            // true if built-in, false if custom
  model?: string;              // Default model (optional)
  receivesStatusUpdates?: boolean; // true for lead/secretary (health headers)
}
```

### Built-In Roles (14 total)

All defined as `BUILT_IN_ROLES` array:

| ID | Name | Model | Purpose |
|---|---|---|---|
| `architect` | Architect | claude-opus-4.6 | System design, exploration, mapping |
| `developer` | Developer | claude-opus-4.6 | Implementation, testing, fixes |
| `code-reviewer` | Code Reviewer | gemini-3-pro-preview | Correctness, patterns, tests |
| `critical-reviewer` | Critical Reviewer | gemini-3-pro-preview | Architecture, security, perf |
| `readability-reviewer` | Readability Reviewer | gemini-3-pro-preview | Naming, organization, docs |
| `product-manager` | Product Manager | gpt-5.3-codex | User needs, quality bar |
| `tech-writer` | Tech Writer | gpt-5.2 | Documentation, API design |
| `designer` | Designer | claude-opus-4.6 | UX/UI, interaction design |
| `generalist` | Generalist | claude-opus-4.6 | Cross-disciplinary work |
| `agent` | Agent | (none) | General-purpose, no special role |
| `radical-thinker` | Radical Thinker | gemini-3-pro-preview | Innovation, first-principles |
| `secretary` | Secretary | gpt-4.1 | Progress tracking* |
| `qa-tester` | QA Tester | claude-sonnet-4.6 | End-to-end testing |
| `lead` | Project Lead | claude-opus-4.6 | Supervision, delegation* |

*Receives status updates (receivesStatusUpdates: true)

### RoleRegistry Class

**Constructor:**
1. Loads all built-in roles
2. Appends `SELF_REPORT_INSTRUCTION` to non-lead roles
3. Loads custom roles from database
4. Custom roles also get `SELF_REPORT_INSTRUCTION` appended

**Key Methods:**
- `get(id: string): Role | undefined` — Retrieve single role
- `getAll(): Role[]` — Get all roles (built-in + custom)
- `register(role: Omit<Role, 'builtIn'>): Role` — Register custom role, persist to DB
- `remove(id: string): boolean` — Delete custom role (cannot delete built-in)
- `generateRoleList(): string` — Format all roles for lead prompt
- `getLeadPrompt(): string` — Get lead system prompt with role list injected

### SELF_REPORT_INSTRUCTION
- 900+ lines appended to all non-lead roles at instantiation
- Explains how agents report status, use commands, record skills
- **NOT appended to lead role** (lead has its own longer prompt)
- **NOT stored separately** (appended at role load time)

### Role Persistence

**Database Table: roles**
```typescript
export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').default(''),
  systemPrompt: text('system_prompt').default(''),
  color: text('color').default('#888'),
  icon: text('icon').default('🤖'),
  builtIn: integer('built_in').default(0),
  model: text('model'),
});
```

**Strategy:**
- Built-in roles: Defined in code, NOT stored in DB
- Custom roles: Persisted to `roles` table with `builtIn = 0`

### API Endpoints for Roles

#### GET /api/roles
Returns array of all roles (built-in + custom)

#### POST /api/roles
Register a custom role. Validates via `registerRoleSchema`:
```typescript
{
  id: "kebab-case-id",
  name: "Display Name",
  description: "What it does",
  systemPrompt: "Full instructions",
  color: "#888",
  icon: "🤖",
  model: "optional-model-id"
}
```
**Response:** 201 Created with full `Role` object

#### DELETE /api/roles/:id
Delete custom role (cannot delete built-in roles)
**Response:** `{ ok: true|false }`

#### POST /api/roles/test
Dry-run a custom role with a test message (validation only, no LLM call)

---

## 3. MODEL CONFIGURATION

### File Locations
- Models list: `/packages/server/src/agents/ModelSelector.ts`
- Defaults per role: `/packages/server/src/projects/ModelConfigDefaults.ts`
- Model resolution: `/packages/server/src/agents/AgentManager.ts` (lines 232-260)

### Available Models (AVAILABLE_MODELS)

```typescript
const AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    tier: 'fast',
    contextWindow: 200000,
    costPer1kTokens: 0.25,
    bestFor: ['simple-tasks', 'code-review', 'formatting', 'docs'],
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    tier: 'standard',
    contextWindow: 200000,
    costPer1kTokens: 3.0,
    bestFor: ['implementation', 'debugging', 'testing', 'analysis'],
  },
  {
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6',
    tier: 'premium',
    contextWindow: 200000,
    costPer1kTokens: 15.0,
    bestFor: ['architecture', 'complex-debugging', 'design', 'critical-review'],
  },
  {
    id: 'gemini-3-pro-preview',
    name: 'Gemini 3 Pro',
    tier: 'standard',
    contextWindow: 1000000,
    costPer1kTokens: 1.25,
    bestFor: ['large-context', 'multi-file', 'research'],
  },
  {
    id: 'gpt-5.1-codex',
    name: 'GPT-5.1 Codex',
    tier: 'standard',
    contextWindow: 200000,
    costPer1kTokens: 2.5,
    bestFor: ['code-generation', 'implementation', 'testing'],
  },
];
```

### Known Model IDs (Extended List)

In `ModelConfigDefaults.ts`:
```
claude-opus-4.6, claude-opus-4.5,
claude-sonnet-4.6, claude-sonnet-4.5, claude-sonnet-4,
claude-haiku-4.5,
gemini-3-pro-preview,
gpt-5.3-codex, gpt-5.2-codex, gpt-5.2,
gpt-5.1-codex-max, gpt-5.1-codex, gpt-5.1, gpt-5.1-codex-mini, gpt-5-mini,
gpt-4.1
```

**Note:** KNOWN_MODEL_IDS is longer than AVAILABLE_MODELS for backward compatibility.

### Default Role-to-Model Mapping

```typescript
export const DEFAULT_MODEL_CONFIG: ProjectModelConfig = {
  developer: ['claude-opus-4.6'],
  architect: ['claude-opus-4.6'],
  'code-reviewer': ['gemini-3-pro-preview', 'claude-opus-4.6'],
  'critical-reviewer': ['gemini-3-pro-preview'],
  'readability-reviewer': ['gemini-3-pro-preview'],
  'tech-writer': ['claude-sonnet-4.6', 'gpt-5.2', 'claude-opus-4.6'],
  secretary: ['gpt-4.1', 'gpt-5.2', 'gpt-5.1'],
  'qa-tester': ['claude-sonnet-4.6'],
  designer: ['claude-opus-4.6'],
  'product-manager': ['gpt-5.3-codex'],
  generalist: ['claude-opus-4.6'],
  'radical-thinker': ['gemini-3-pro-preview'],
  agent: ['claude-sonnet-4.6'],
  lead: ['claude-opus-4.6'],
};
```

**Note:** Arrays are ordered by preference. First element is default.

### Project Model Configuration

**Type:**
```typescript
export type ProjectModelConfig = Record<string, string[]>;
```

Maps role ID → array of allowed model IDs.

**Usage:**
```typescript
const { config } = projectRegistry.getModelConfig(projectId);
// Returns merged config (stored + defaults)
```

**Model Resolution in AgentManager.resolveModelForRole():**
1. If no projectId → use requestedModel as-is
2. If no project config for role → use requestedModel as-is
3. If requestedModel in allowed list → use it
4. If requestedModel NOT in list → reject, use first allowed (logs warning)
5. If no requestedModel → use first allowed (logs info)

---

## 4. SKILLS SYSTEM

### File Structure
```
.github/skills/
├── agent-collaboration-patterns/SKILL.md
├── auto-dag-task-lifecycle/SKILL.md
├── command-output-not-in-tools/SKILL.md
├── commit-new-files-pattern/SKILL.md
├── deterministic-ws-signals/SKILL.md
├── group-chat-adoption/SKILL.md
├── multi-agent-orchestration-patterns/SKILL.md
├── project-id-guarantees/SKILL.md
└── use-task-dag-for-coordination/SKILL.md
```

### SKILL.md Format

```yaml
---
name: agent-collaboration-patterns
description: Proven collaboration patterns for flightdeck-based multi-agent crews. Use when planning any crew session with 3+ agents.
---

# Agent Collaboration Patterns

[Markdown content describing the skill...]
```

**Frontmatter:**
- `name`: Skill identifier (lowercase, hyphens)
- `description`: When/how to use (agents use this to decide when to load)

### How Skills Are Loaded

1. Skills are stored in git repo under `.github/skills/`
2. Agents can BROADCAST learnings to trigger skill recording
3. Copilot system loads skills based on context relevance
4. Skills are **not persisted in database** — they're documentation
5. Skills are injected into agent context by Copilot when relevant

**No programmatic loading** found in server code — skills are handled by Copilot system.

---

## 5. VALIDATION & ROUTING

### Validation Schemas (validation/schemas.ts)

**configPatchSchema:**
```typescript
z.object({
  maxConcurrentAgents: z.number().int().positive().optional(),
  host: z.string().min(1).optional(),
}).refine((data) => 
  data.maxConcurrentAgents !== undefined || data.host !== undefined
);
```

**registerRoleSchema:**
```typescript
z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case'),
  name: z.string().min(1),
  description: z.string().optional().default(''),
  systemPrompt: z.string().optional().default(''),
  color: z.string().optional().default('#888'),
  icon: z.string().optional().default('🤖'),
  model: z.string().optional(),
});
```

### Route Files

**routes/config.ts:**
- `GET /api/config`
- `PATCH /api/config`
- `POST /api/system/pause`, `POST /api/system/resume`
- `GET /api/system/status`
- `GET /api/budget`, `POST /api/budget`, `POST /api/budget/check`

**routes/roles.ts:**
- `GET /api/roles`
- `POST /api/roles`
- `DELETE /api/roles/:id`
- `POST /api/roles/test`

---

## 6. DATABASE PERSISTENCE

### Schema (db/schema.ts)

**roles table:**
```typescript
export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').default(''),
  systemPrompt: text('system_prompt').default(''),
  color: text('color').default('#888'),
  icon: text('icon').default('🤖'),
  builtIn: integer('built_in').default(0),
  model: text('model'),
});
```

**settings table:**
```typescript
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
```

### Persistence Methods

- `db.setSetting(key, value)` — Persist setting
- `db.drizzle.insert(rolesTable)...` — Persist custom roles
- On config update: `db.setSetting('maxConcurrentAgents', String(value))`

---

## 7. STARTUP & INITIALIZATION

### Server Startup
1. Load `ServerConfig` from environment + defaults
2. Initialize Database with schema
3. Create RoleRegistry (loads built-in + custom roles)
4. Create AgentManager with config
5. Mount config routes
6. Mount role routes
7. Initialize model config defaults

### Per-Project Setup
1. ProjectRegistry.create() creates new project
2. Initializes with DEFAULT_MODEL_CONFIG
3. Project-specific config can be set via `setModelConfig()`
4. Agent spawning uses resolved model config for project

---

## 8. KEY TYPES (All Exported)

**config.ts:**
- `ServerConfig` interface
- `MAX_CONCURRENCY_LIMIT` constant (200)

**RoleRegistry.ts:**
- `Role` interface
- `RoleRegistry` class

**ModelSelector.ts:**
- `ModelTier` type ('fast' | 'standard' | 'premium')
- `ModelConfig` interface
- `TaskProfile` interface
- `ModelSelector` class

**ModelConfigDefaults.ts:**
- `ProjectModelConfig` type
- `KNOWN_MODEL_IDS` array
- `DEFAULT_MODEL_CONFIG` object

**validation/schemas.ts:**
- `configPatchSchema` Zod schema
- `registerRoleSchema` Zod schema

---

## 9. CONFIGURATION FLOW

```
User Request (PATCH /api/config)
    ↓
Validation (configPatchSchema)
    ↓
updateConfig() → In-memory state
    ↓
AgentManager.setMaxConcurrent() [if changed]
    ↓
db.setSetting('maxConcurrentAgents', ...) [persist]
    ↓
Response: ServerConfig
    ↓
    └─→ Survives server restart ✓
```

```
Agent Spawn Request (POST /api/agents)
    ↓
RoleRegistry.get(roleId) → Role object
    ↓
AgentManager.resolveModelForRole(roleId, requestedModel, projectId)
    ↓
    ├─ Check project model config
    ├─ Validate model in allowed list
    └─ Use default or override
    ↓
Agent created with resolved model
```

---

## 10. SUMMARY TABLE

| Component | Location | Type | Mutable | Persisted |
|-----------|----------|------|---------|-----------|
| ServerConfig | config.ts | Interface + in-memory | Yes (PATCH) | Partial (maxConcurrentAgents) |
| Role | RoleRegistry.ts | Interface | Custom only | Yes (custom roles only) |
| Available Models | ModelSelector.ts | Constant array | No | No |
| Known Model IDs | ModelConfigDefaults.ts | Constant | No | No |
| Default Role→Model | ModelConfigDefaults.ts | Constant | No | No |
| Project Model Config | ProjectRegistry.ts | Dynamic map | Yes | Yes (per project) |
| SKILL metadata | .github/skills/ | YAML frontmatter | Via git | Yes (git repo) |

