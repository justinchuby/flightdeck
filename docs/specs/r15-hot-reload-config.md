# R15: Hot-Reloadable Configuration — Implementation Spec

**Status:** ✅ **Implemented** (2026-03-07)  
**Inspired by:** Symphony's `WorkflowStore` (mtime+size+phash2 change detection), Squad's charter hot-reload  
**Goal:** Configuration changes take effect without server restart, preserving all active agent state.

---

## 1. Current Configuration Approach

### 1.1 Server Config (`packages/server/src/config.ts`)

A module-level singleton with 6 fields, initialized from env vars with hardcoded defaults:

```ts
interface ServerConfig {
  port: number;          // PORT env, default 3001
  host: string;          // HOST env, default '127.0.0.1'
  cliCommand: string;    // COPILOT_CLI_PATH env, default 'copilot'
  cliArgs: string[];     // hardcoded []
  maxConcurrentAgents: number;  // MAX_AGENTS env, default 50
  dbPath: string;        // DB_PATH env, default './flightdeck.db'
}
```

**Update mechanism:** `updateConfig(patch)` does a shallow merge in memory. Only `maxConcurrentAgents` is persisted to SQLite (`settings` table) via `PATCH /api/config`. All other values require env var change + server restart.

### 1.2 Role Definitions (`packages/server/src/agents/RoleRegistry.ts`)

14 built-in roles hardcoded in `BUILT_IN_ROLES` array (~700 lines of system prompts). Custom roles stored in `roles` table (SQLite). Roles loaded once at startup via `loadFromDatabase()`.

**Pain point:** Changing a built-in role's system prompt, model default, or behavior requires code change + server restart.

### 1.3 Model Configuration (`packages/server/src/projects/ModelConfigDefaults.ts`)

- `KNOWN_MODEL_IDS`: 16 model IDs, hardcoded const array
- `DEFAULT_MODEL_CONFIG`: Maps role → allowed model arrays, hardcoded
- Per-project overrides stored in `projects.modelConfig` (JSON column in SQLite)

**Pain point:** Adding a new model to the system requires code change + restart.

### 1.4 Skills (`.github/skills/*/SKILL.md`)

YAML frontmatter + markdown body. Read from filesystem by Copilot context injection. Not managed by the server — already "hot-reloadable" in the sense that skills are read on each agent spawn.

### 1.5 Scattered Hardcoded Values

| Value | Location | Current mechanism |
|-------|----------|------------------|
| `CHECK_INTERVAL_MS` (5s timer tick) | `TimerRegistry.ts` | const |
| `MAX_CONCURRENCY_LIMIT` (200) | `config.ts` | const |
| `CLEANUP_TTL_MS` (7 days) | `TimerRegistry.ts` | const |
| Heartbeat intervals (60s idle, 180s CREW_UPDATE) | `HeartbeatMonitor.ts` | constructor params |
| Budget thresholds | `BudgetEnforcer.ts` | API-configurable, SQLite-persisted |

---

## 2. Hot-Reload Design

### 2.1 Architecture Overview

```
flightdeck.config.yaml (filesystem)
        │
        ▼
  ConfigWatcher (fs.watch + poll fallback)
        │
        ▼
  ConfigLoader (parse, validate, diff)
        │
        ▼
  ConfigStore (in-memory, typed, event-emitting)
        │
   ┌────┼────┬────────┐
   ▼    ▼    ▼        ▼
 AgentMgr  RoleReg  ModelCfg  HeartbeatMon
 (listens for relevant config changes)
```

### 2.2 ConfigWatcher — File Change Detection

**Follows Symphony's triple-check pattern:** Compare `{mtime, size, contentHash}` to detect changes reliably.

**New file:** `packages/server/src/config/ConfigWatcher.ts`

```ts
import { EventEmitter } from 'events';
import { stat, readFile } from 'fs/promises';
import { watch, type FSWatcher } from 'fs';
import { createHash } from 'crypto';

interface FileStamp {
  mtimeMs: number;
  size: number;
  contentHash: string;
}

export class ConfigWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastStamp: FileStamp | null = null;
  private readonly filePath: string;
  private readonly pollMs: number;

  constructor(filePath: string, pollMs = 2000) {
    super();
    this.filePath = filePath;
    this.pollMs = pollMs;
  }

  start(): void {
    // Primary: fs.watch for immediate notification
    try {
      this.watcher = watch(this.filePath, () => this.check());
    } catch {
      // fs.watch may fail on some platforms/network mounts
    }
    // Fallback: polling (catches cases where fs.watch misses events)
    this.pollInterval = setInterval(() => this.check(), this.pollMs);
    // Initial load
    this.check();
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = null;
  }

  private async check(): Promise<void> {
    try {
      const st = await stat(this.filePath);
      // Quick reject: if mtime and size unchanged, skip hashing
      if (this.lastStamp &&
          st.mtimeMs === this.lastStamp.mtimeMs &&
          st.size === this.lastStamp.size) {
        return;
      }
      const content = await readFile(this.filePath, 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      if (this.lastStamp && hash === this.lastStamp.contentHash) {
        // mtime changed (e.g. touch) but content identical — update stamp, no event
        this.lastStamp = { mtimeMs: st.mtimeMs, size: st.size, contentHash: hash };
        return;
      }
      this.lastStamp = { mtimeMs: st.mtimeMs, size: st.size, contentHash: hash };
      this.emit('changed', content);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // File deleted — emit warning but don't crash. Keep last-known-good.
        this.emit('warning', `Config file not found: ${this.filePath}`);
      } else {
        this.emit('error', err);
      }
    }
  }
}
```

**Design decisions:**
- Use `fs.watch` for responsiveness + poll at 2s for reliability (Symphony polls every 1s; 2s is fine for config)
- SHA-256 hash instead of phash2 — we're in Node.js, not Erlang. crypto is available.
- `mtime + size` as a fast pre-filter before hashing, same as Symphony
- File deletion does NOT crash the server — emit warning, keep last-known-good config

### 2.3 ConfigLoader — Parse, Validate, Diff

**New file:** `packages/server/src/config/ConfigLoader.ts`

```ts
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

// Schema defined in section 4 below
import { flightdeckConfigSchema, type FlightdeckConfig } from './configSchema.js';

export interface ConfigDiff {
  section: string;       // e.g. 'server', 'models', 'roles.developer'
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface LoadResult {
  config: FlightdeckConfig;
  diffs: ConfigDiff[];
  warnings: string[];
}

export function loadConfig(content: string, previous: FlightdeckConfig | null): LoadResult {
  const warnings: string[] = [];

  // Parse YAML
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err: any) {
    throw new Error(`Config parse error: ${err.message}`);
  }

  // Validate with Zod (fills defaults for missing fields)
  const result = flightdeckConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Config validation failed:\n${issues.join('\n')}`);
  }

  const config = result.data;

  // Compute diff against previous config
  const diffs = previous ? computeDiffs(previous, config) : [];

  return { config, diffs, warnings };
}

function computeDiffs(prev: FlightdeckConfig, next: FlightdeckConfig): ConfigDiff[] {
  // Deep comparison of config sections, returns list of changes
  // Implementation: walk both objects, compare leaf values
  // ...
}
```

**Key principle:** Validation failure rejects the entire reload — keep last-known-good. This follows Symphony's graceful degradation pattern.

### 2.4 ConfigStore — Central State + Event Emission

**New file:** `packages/server/src/config/ConfigStore.ts`

```ts
import { EventEmitter } from 'events';
import type { FlightdeckConfig, ConfigDiff } from './configSchema.js';
import { ConfigWatcher } from './ConfigWatcher.js';
import { loadConfig } from './ConfigLoader.js';
import { logger } from '../utils/logger.js';

export class ConfigStore extends EventEmitter {
  private config: FlightdeckConfig;
  private watcher: ConfigWatcher;
  private lastGoodContent: string;

  constructor(initialConfig: FlightdeckConfig, filePath: string) {
    super();
    this.config = initialConfig;
    this.watcher = new ConfigWatcher(filePath);
    this.lastGoodContent = '';
  }

  get current(): Readonly<FlightdeckConfig> {
    return this.config;
  }

  start(): void {
    this.watcher.on('changed', (content: string) => this.handleChange(content));
    this.watcher.on('warning', (msg: string) => logger.warn('config', msg));
    this.watcher.on('error', (err: Error) => logger.error('config', `Watcher error: ${err.message}`));
    this.watcher.start();
  }

  stop(): void {
    this.watcher.stop();
  }

  private handleChange(content: string): void {
    try {
      const { config, diffs, warnings } = loadConfig(content, this.config);
      if (diffs.length === 0) return; // parsed but nothing changed

      const previous = this.config;
      this.config = config;
      this.lastGoodContent = content;

      for (const w of warnings) logger.warn('config', w);
      logger.info('config', `Config reloaded: ${diffs.length} change(s)`);
      for (const d of diffs) {
        logger.info('config', `  ${d.section}.${d.field}: ${JSON.stringify(d.oldValue)} → ${JSON.stringify(d.newValue)}`);
      }

      // Emit typed events for consumers
      this.emit('config:reloaded', { config, diffs, previous });

      // Emit section-specific events for targeted listeners
      const sections = new Set(diffs.map(d => d.section));
      for (const section of sections) {
        this.emit(`config:${section}:changed`, {
          config: config[section as keyof FlightdeckConfig],
          diffs: diffs.filter(d => d.section === section),
        });
      }
    } catch (err: any) {
      logger.error('config', `Config reload failed — keeping previous config: ${err.message}`);
      this.emit('config:reload_failed', { error: err.message, content });
    }
  }
}
```

**Event contract:**
- `config:reloaded` — any change, provides full config + diffs + previous
- `config:server:changed` — server section changed
- `config:models:changed` — model config changed
- `config:roles:changed` — role overrides changed
- `config:heartbeat:changed` — heartbeat timing changed
- `config:reload_failed` — validation failed, previous config retained

### 2.5 Consumer Integration

Each service subscribes only to its relevant events:

```ts
// In index.ts, after creating configStore:
configStore.on('config:server:changed', ({ config }) => {
  agentManager.setMaxConcurrent(config.maxConcurrentAgents);
});

configStore.on('config:models:changed', ({ config }) => {
  projectRegistry.clearModelConfigCache();
  // Model changes take effect on next agent spawn — no need to restart running agents
});

configStore.on('config:heartbeat:changed', ({ config }) => {
  heartbeatMonitor.updateIntervals(config.idleThresholdMs, config.crewUpdateIntervalMs);
});

configStore.on('config:roles:changed', ({ diffs }) => {
  for (const d of diffs) {
    // Only update roles that changed
    roleRegistry.updateRoleOverride(d.field, d.newValue);
  }
});
```

---

## 3. Hot-Reloadable vs Restart-Required

### Hot-Reloadable (take effect immediately or on next agent spawn)

| Config | Effect timing | Rationale |
|--------|--------------|-----------|
| `maxConcurrentAgents` | Immediate | Already works via API; just wire to file |
| Model defaults per role | Next agent spawn | No running agent affected |
| Model allowed lists | Next agent spawn | Running agents keep their model |
| Role system prompt overrides | Next agent spawn | Can't change a running agent's prompt |
| Heartbeat intervals | Immediate | Timer can be reset |
| Timer cleanup TTL | Next cleanup cycle | No urgency |
| Budget thresholds | Immediate | BudgetEnforcer already supports updates |

### Restart-Required

| Config | Rationale |
|--------|-----------|
| `port` | Requires rebinding the socket |
| `host` | Requires rebinding the socket |
| `dbPath` | Requires reconnecting database |
| `cliCommand` / `cliArgs` | Safety — changing the CLI binary mid-session is risky |

### Read-on-Access (no caching, always fresh)

| Config | Rationale |
|--------|-----------|
| Skills (`.github/skills/`) | Already read per-agent-spawn by Copilot context injection |

---

## 4. Config File Format and Schema

### 4.1 File: `flightdeck.config.yaml`

Location: project root (next to `package.json`), or path specified by `FLIGHTDECK_CONFIG` env var.

```yaml
# flightdeck.config.yaml
# Hot-reloaded without restart. Changes take effect on next agent spawn or immediately where noted.

server:
  maxConcurrentAgents: 50    # immediate
  # port, host, dbPath are read at startup only — change requires restart

heartbeat:
  idleThresholdMs: 60000     # immediate — how long before nudging idle lead
  crewUpdateIntervalMs: 180000  # immediate — CREW_UPDATE push interval
  staleTimerCleanupDays: 7   # next cleanup cycle

models:
  known:
    - claude-opus-4.6
    - claude-sonnet-4.6
    - claude-haiku-4.5
    - gemini-3-pro-preview
    - gpt-5.3-codex
    - gpt-5.2-codex
    - gpt-5.2
    - gpt-5.1-codex
    - gpt-4.1
  defaults:
    developer: [claude-opus-4.6]
    architect: [claude-opus-4.6]
    code-reviewer: [gemini-3-pro-preview, claude-opus-4.6]
    critical-reviewer: [gemini-3-pro-preview]
    readability-reviewer: [gemini-3-pro-preview]
    tech-writer: [claude-sonnet-4.6, gpt-5.2]
    secretary: [gpt-4.1, gpt-5.2]
    qa-tester: [claude-sonnet-4.6]
    designer: [claude-opus-4.6]
    product-manager: [gpt-5.3-codex]
    generalist: [claude-opus-4.6]
    radical-thinker: [gemini-3-pro-preview]
    agent: [claude-sonnet-4.6]
    lead: [claude-opus-4.6]

roles:
  # Override built-in role properties without code changes.
  # Only specified fields are overridden — omitted fields keep built-in defaults.
  developer:
    model: claude-sonnet-4.6        # override default model
    # systemPromptAppend: |         # append to built-in prompt (future)
    #   Additional instructions here
  secretary:
    model: gpt-4.1

budget:
  limit: null                       # null = unlimited, number = dollar cap
  thresholds:
    warning: 0.7
    critical: 0.9
    pause: 1.0
```

### 4.2 Zod Schema

**New file:** `packages/server/src/config/configSchema.ts`

```ts
import { z } from 'zod';

const serverSchema = z.object({
  maxConcurrentAgents: z.number().int().min(1).max(200).default(50),
}).default({});

const heartbeatSchema = z.object({
  idleThresholdMs: z.number().int().min(10000).max(600000).default(60000),
  crewUpdateIntervalMs: z.number().int().min(30000).max(600000).default(180000),
  staleTimerCleanupDays: z.number().int().min(1).max(90).default(7),
}).default({});

const modelsSchema = z.object({
  known: z.array(z.string()).min(1).default([
    'claude-opus-4.6', 'claude-sonnet-4.6', 'claude-haiku-4.5',
    'gemini-3-pro-preview', 'gpt-5.3-codex', 'gpt-5.2-codex',
    'gpt-5.2', 'gpt-5.1-codex', 'gpt-4.1',
  ]),
  defaults: z.record(z.string(), z.array(z.string()).min(1)).default({}),
}).default({});

const roleOverrideSchema = z.object({
  model: z.string().optional(),
  // Future: systemPromptAppend, systemPromptReplace, color, icon
}).passthrough();

const budgetSchema = z.object({
  limit: z.number().nullable().default(null),
  thresholds: z.object({
    warning: z.number().min(0).max(1).default(0.7),
    critical: z.number().min(0).max(1).default(0.9),
    pause: z.number().min(0).max(1).default(1.0),
  }).default({}),
}).default({});

export const flightdeckConfigSchema = z.object({
  server: serverSchema,
  heartbeat: heartbeatSchema,
  models: modelsSchema,
  roles: z.record(z.string(), roleOverrideSchema).default({}),
  budget: budgetSchema,
});

export type FlightdeckConfig = z.infer<typeof flightdeckConfigSchema>;
```

**Design decisions:**
- YAML over JSON: human-editable, supports comments, consistent with Symphony's approach
- Zod for validation: already used throughout the codebase (`commandSchemas.ts`, `validation/schemas.ts`)
- `.default({})` at every level: missing sections are valid — you only configure what you want to change
- `.passthrough()` on role overrides: forward-compatible with future fields without schema changes
- Model list defaults baked into schema: config file can omit `models.known` and still work

---

## 5. Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `packages/server/src/config/ConfigWatcher.ts` | File change detection (fs.watch + poll) |
| `packages/server/src/config/ConfigLoader.ts` | YAML parse, Zod validate, diff computation |
| `packages/server/src/config/ConfigStore.ts` | Central config state + event emission |
| `packages/server/src/config/configSchema.ts` | Zod schema + TypeScript types |
| `packages/server/src/config/index.ts` | Barrel export |
| `packages/server/src/__tests__/ConfigWatcher.test.ts` | Watcher unit tests |
| `packages/server/src/__tests__/ConfigLoader.test.ts` | Loader/validator unit tests |
| `packages/server/src/__tests__/ConfigStore.test.ts` | Integration tests (watcher → store → events) |
| `flightdeck.config.example.yaml` | Documented example config (committed to repo) |

### Modified Files

| File | Change |
|------|--------|
| `packages/server/src/config.ts` | Extract `ServerConfig` interface. `getConfig()` delegates to ConfigStore for hot-reloadable fields, keeps env-only fields for restart-required ones. |
| `packages/server/src/index.ts` | Create and start `ConfigStore`. Wire `config:*:changed` event listeners. Pass store to services. |
| `packages/server/src/projects/ModelConfigDefaults.ts` | `KNOWN_MODEL_IDS` and `DEFAULT_MODEL_CONFIG` become initial values; ConfigStore overrides take precedence. |
| `packages/server/src/agents/RoleRegistry.ts` | Add `updateRoleOverride(roleId, overrides)` method. Role model defaults read from ConfigStore. |
| `packages/server/src/agents/HeartbeatMonitor.ts` | Add `updateIntervals()` method. Store interval values as mutable fields instead of constructor-only. |
| `packages/server/src/routes/config.ts` | `PATCH /api/config` writes back to `flightdeck.config.yaml` (round-trip: API → file → watcher → reload). |
| `package.json` | Add `yaml` dependency (already available as `yaml` npm package). |

### Migration Path

1. If `flightdeck.config.yaml` exists → load it, override defaults
2. If it doesn't exist → use current hardcoded defaults (zero-config backward compatibility)
3. Env vars still work for startup config (port, host, dbPath, cliCommand)
4. Env vars for `MAX_AGENTS` are read at startup as initial default; config file overrides take precedence at runtime

---

## 6. Testing Strategy

### 6.1 ConfigWatcher Tests (`ConfigWatcher.test.ts`)

```
✓ emits 'changed' on initial start with file content
✓ emits 'changed' when file content changes
✓ does NOT emit 'changed' when file is touched but content unchanged
✓ emits 'warning' when file is deleted (keeps last-known-good)
✓ detects changes via polling when fs.watch is unavailable
✓ stop() cleans up watcher and interval
✓ handles rapid successive writes (debounce — only emits once per check cycle)
✓ handles file permissions error gracefully
```

### 6.2 ConfigLoader Tests (`ConfigLoader.test.ts`)

```
✓ parses valid YAML config with all sections
✓ parses minimal config (empty file → all defaults)
✓ rejects invalid YAML syntax (throws with parse error)
✓ rejects invalid values (e.g. maxConcurrentAgents: -1)
✓ fills defaults for missing sections
✓ computes diffs correctly between two configs
✓ computes empty diffs when configs are identical
✓ handles unknown top-level keys (strip or warn, don't fail)
✓ validates model IDs against known list (warn on unknown)
✓ validates budget thresholds are ordered (warning < critical < pause)
```

### 6.3 ConfigStore Integration Tests (`ConfigStore.test.ts`)

```
✓ loads config on start and emits config:reloaded
✓ reloads when file changes and emits section-specific events
✓ keeps last-known-good config when reload fails (bad YAML)
✓ keeps last-known-good config when reload fails (schema validation)
✓ emits config:reload_failed with error details
✓ multiple rapid changes result in correct final config
✓ consumers receive correct diffs in events
✓ stop() prevents further events
```

### 6.4 Consumer Integration Tests

```
✓ maxConcurrentAgents change updates AgentManager limit
✓ model defaults change affects next agent spawn (not running agents)
✓ heartbeat interval change takes effect on next tick cycle
✓ role override changes reflected in next RoleRegistry.get() call
✓ budget threshold change updates BudgetEnforcer
```

### 6.5 Test Utilities

Create a `writeConfigFile(path, config)` helper (à la Symphony's write-workflow-file pattern) for tests to create temporary config files with specific overrides:

```ts
export async function writeTestConfig(dir: string, overrides: Partial<FlightdeckConfig>): Promise<string> {
  const filePath = join(dir, 'flightdeck.config.yaml');
  const content = stringify({ ...defaultConfig, ...overrides });
  await writeFile(filePath, content);
  return filePath;
}
```

### 6.6 Manual Testing Checklist

1. Start server without config file → works with defaults
2. Create config file while server running → picks up config
3. Edit `maxConcurrentAgents` → verify via `GET /api/config`
4. Edit with invalid YAML → server logs error, keeps previous config
5. Delete config file → server logs warning, keeps previous config
6. Edit model defaults → spawn new agent, verify it uses updated model
7. `PATCH /api/config` → verify change is written to file and re-read

---

## 7. Implementation Notes

### 7.1 Round-Trip: API → File → Watcher

When `PATCH /api/config` changes a value, it should write to `flightdeck.config.yaml` so the file remains the source of truth. The watcher will detect the change and reload, keeping everything consistent. This avoids having two sources of truth (file + API).

### 7.2 Config File Precedence

```
Hardcoded defaults (configSchema.ts)
  ← overridden by flightdeck.config.yaml
    ← overridden by env vars (for startup-only fields: PORT, HOST, DB_PATH)
      ← overridden by API PATCH (which writes back to yaml file)
```

### 7.3 No Live Prompt Rewriting

Role system prompt overrides in the config file affect **newly spawned agents only**. We do NOT hot-swap prompts on running agents — that would be confusing and potentially dangerous mid-task.

### 7.4 Backward Compatibility

The config file is 100% optional. Without it, the system behaves exactly as it does today. This means zero migration burden — teams adopt it when they want it.

### 7.5 DRY: Single Source of Truth for Model Lists

Today `KNOWN_MODEL_IDS` in `ModelConfigDefaults.ts` and the model list in the lead prompt (`RoleRegistry.ts` line 528) can drift. With the config file as source of truth, both should read from `ConfigStore.current.models.known`. The lead prompt template should interpolate the model list dynamically:

```ts
// In RoleRegistry.ts lead prompt generation:
const modelList = configStore.current.models.known.join(', ');
// ... inject into prompt template
```

### 7.6 Dependency: `yaml` npm package

The `yaml` package (https://www.npmjs.com/package/yaml) is the standard YAML 1.2 parser for Node.js. It supports:
- Full YAML 1.2 spec
- Preservation of comments (useful for round-trip editing)
- TypeScript types included
- Zero dependencies

Install: `npm install yaml`
