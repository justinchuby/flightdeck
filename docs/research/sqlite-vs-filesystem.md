# SQLite vs Filesystem Storage Analysis

> **Author**: Architect (e7f14c5e)  
> **Date**: 2026-03-07  
> **Context**: Flightdeck stores most state in SQLite. This analysis examines what should stay in the DB vs move to human-readable filesystem storage.

---

## Executive Summary

Flightdeck has **22 SQLite tables** storing everything from file locks (needs atomicity) to collective memory (should be human-readable). The current design treats SQLite as the universal store, but several categories of data would serve users better on the filesystem.

**The key distinction**: Operational state (locks, DAG, timers, decisions) needs ACID transactions and relational queries — SQLite is correct. Knowledge state (collective memory, session retros, custom roles, training data) should be human-readable, git-trackable, and editable — filesystem is correct.

**Recommendation**: Hybrid model. Keep 16 tables in SQLite for operational state. Move 4 categories to filesystem at `~/.flightdeck/projects/<project-id>/`. Add 2 new filesystem-only categories for per-user training and preferences. SQLite becomes the "working memory" (within-session), filesystem becomes the "long-term memory" (across sessions and users).

---

## Current SQLite Inventory

### All 22 Tables

| # | Table | Category | Rows/Session | Write Freq | Read Freq |
|---|-------|----------|-------------|------------|-----------|
| 1 | `conversations` | Relational | ~15-50 | Low | Medium |
| 2 | `messages` | Relational | ~100-500 | Medium | Medium |
| 3 | `roles` | Knowledge | ~15 | Rare | Startup |
| 4 | `settings` | Config | ~10-20 | Rare | Medium |
| 5 | `file_locks` | Transactional | ~5-30 | **High** | **High** |
| 6 | `activity_log` | Audit | ~500-5000 | **Very High** | Medium |
| 7 | `decisions` | Transactional | ~10-50 | High | High |
| 8 | `agent_memory` | Knowledge | ~50-200 | Medium | High |
| 9 | `chat_groups` | Relational | ~3-10 | Low | Medium |
| 10 | `chat_group_members` | Relational | ~10-40 | Low | Medium |
| 11 | `chat_group_messages` | Relational | ~50-200 | Medium | Medium |
| 12 | `dag_tasks` | Transactional | ~10-50 | **Very High** | **Very High** |
| 13 | `deferred_issues` | Transactional | ~5-20 | Medium | Medium |
| 14 | `agent_plans` | Ephemeral | ~15 | Medium | Medium |
| 15 | `projects` | Relational | ~1-5 | Rare | Medium |
| 16 | `project_sessions` | Relational | ~1-10 | Low | Medium |
| 17 | `agent_file_history` | Knowledge | ~100-500 | Medium | Low |
| 18 | `collective_memory` | Knowledge | ~20-100 | Medium | High |
| 19 | `task_cost_records` | Metrics | ~10-50 | Medium | Low |
| 20 | `session_retros` | Knowledge | ~1-3 | Rare | Low |
| 21 | `timers` | Transactional | ~5-20 | Medium | **High (5s tick)** |
| 22 | `deferred_issues` | Transactional | ~5-20 | Medium | Medium |

### Data Categories

**Transactional State** (must be atomic, concurrent-safe):
- `file_locks` — Race-condition-sensitive. Uses explicit transactions for acquire(). TTL-based expiry.
- `dag_tasks` — Complex state machine (pending→ready→running→done). Dependency resolution.
- `decisions` — Approval workflow (recorded→approved/rejected). Multi-agent contention.
- `timers` — Scheduled events with status transitions (pending→fired/cancelled).
- `deferred_issues` — Issue lifecycle (open→resolved/dismissed).

**Relational Data** (needs joins, ordered queries):
- `conversations` + `messages` — Parent-child, chronologically ordered.
- `chat_groups` + `chat_group_members` + `chat_group_messages` — Many-to-many with message ordering.
- `projects` + `project_sessions` — Project hierarchy with session tracking.
- `task_cost_records` — Aggregation queries (SUM tokens per agent, per task).

**Knowledge State** (accumulates over time, cross-session):
- `collective_memory` — Patterns, decisions, gotchas. Categories: pattern, decision, expertise, gotcha.
- `agent_memory` — Per-lead, per-agent facts (key-value pairs).
- `agent_file_history` — Which agents touched which files and how often.
- `session_retros` — Retrospective JSON blobs from completed sessions.
- `roles` (custom only) — User-defined roles with system prompts.

**Configuration**:
- `settings` — Key-value store used by ShareLinkService, BudgetEnforcer, HandoffService, RecoveryService.

**Metrics/Audit**:
- `activity_log` — High-volume event audit trail. Buffered writes (250ms / 64 entries).
- `task_cost_records` — Token usage per agent per task.

**Ephemeral**:
- `agent_plans` — Current operational plan, rebuilt each session.

---

## Current Filesystem Usage

Flightdeck already stores some state on the filesystem:

| Location | Content | Owner |
|----------|---------|-------|
| `~/.copilot/agents/flightdeck-*.agent.md` | Role definitions for Copilot CLI | `agentFiles.ts` |
| `<cwd>/.flightdeck/shared/` | Inter-agent artifacts, research docs | Agents write directly |
| `<cwd>/.flightdeck/exports/` | Session exports (summary.md, dag.json, etc.) | Export service |
| `<cwd>/.flightdeck/shared/<agent-short-id>/` | Per-agent workspace within shared | Agents |
| `flightdeck.db` + `.db-wal` + `.db-shm` | SQLite database + WAL files | Database class |

---

## What Should Move to Filesystem

### 1. Collective Memory → `~/.flightdeck/projects/<pid>/knowledge/`

**Current**: `collective_memory` table with `category`, `key`, `value`, `source`, `projectId`, `useCount`.

**Why move**: This IS the training data. Patterns learned, decisions recorded, gotchas discovered. Users want to:
- Read what their AI team has learned
- Edit/correct entries
- Share knowledge across team members (git)
- Import knowledge from other projects
- Delete bad entries without SQL

**Proposed format**:
```
~/.flightdeck/projects/<project-id>/knowledge/
├── patterns/
│   ├── async-error-handling.md      # One file per pattern
│   └── drizzle-migration-order.md
├── decisions/
│   ├── chose-pino-over-winston.md
│   └── flat-options-not-union.md
├── expertise/
│   ├── agent-a1b2-typescript-strict.md
│   └── agent-c3d4-react-testing.md
└── gotchas/
    ├── sqlite-wal-checkpoint-blocks.md
    └── acp-session-load-gemini.md
```

Each file:
```yaml
---
source: agent-a1b2c3d4
created: 2026-03-07T15:30:00Z
lastUsed: 2026-03-07T17:00:00Z
useCount: 5
tags: [sqlite, performance]
---

# SQLite WAL Checkpoint Blocks Reads

When running `walCheckpoint('TRUNCATE')`, all readers are blocked until the
checkpoint completes. Use `walCheckpoint('PASSIVE')` for non-blocking behavior,
accepting that the WAL file won't be truncated.

Discovered during R7 SQLite improvements implementation.
```

**Migration**: Read from DB at startup, write to filesystem. DB becomes a cache for fast queries (read from filesystem on startup, query from memory during session).

### 2. Session Retros → `~/.flightdeck/projects/<pid>/retros/`

**Current**: `session_retros` table with `leadId`, `data` (JSON blob), `createdAt`.

**Why move**: Retros are the team's learning journal. Users want to:
- Review past session outcomes
- Share retros with colleagues
- Track improvement over time
- Edit retros with corrections

**Proposed format**:
```
~/.flightdeck/projects/<project-id>/retros/
├── 2026-03-07-daemon-design.md
├── 2026-03-06-r5-logging.md
└── 2026-03-05-initial-setup.md
```

Each file is a rendered markdown retro (not raw JSON).

### 3. Custom Roles → `~/.flightdeck/roles/` or `<cwd>/.flightdeck/roles/`

**Current**: `roles` table stores custom roles (builtIn=0) with system prompts in a text column.

**Why move**: Custom roles ARE system prompts — human-authored content that users want to:
- Edit in their preferred editor
- Version control
- Share with team
- Iterate on prompt engineering

**Proposed format**:
```
~/.flightdeck/roles/
├── security-expert.md     # User-global custom role
└── ml-engineer.md

<cwd>/.flightdeck/roles/
├── domain-expert.md       # Project-specific custom role
└── legacy-translator.md
```

Each file uses the same format as Copilot's `.agent.md`:
```yaml
---
name: security-expert
description: "Security-focused code reviewer specializing in OWASP Top 10"
color: "#ff4444"
icon: "🔒"
model: claude-opus-4.6
---

# Security Expert

You are a security-focused code reviewer. Your primary responsibility is...
```

**Built-in roles stay in code** (RoleRegistry.ts). Custom roles load from filesystem first, DB as fallback for migration.

### 4. Agent Memory (Selective) → `~/.flightdeck/projects/<pid>/agents/`

**Current**: `agent_memory` table with `leadId`, `agentId`, `key`, `value`.

**What moves**: Long-lived agent facts that persist across sessions (preferences, capabilities, personality traits). NOT ephemeral session state.

**What stays**: Within-session working memory (current task context, temporary facts).

**Proposed format**:
```
~/.flightdeck/projects/<project-id>/agents/
├── architect/
│   └── preferences.yaml    # "Prefers pino over winston", "Uses vitest not jest"
├── developer/
│   └── preferences.yaml
└── code-reviewer/
    └── preferences.yaml
```

---

## What Stays in SQLite

### Must Stay (Transactional/Relational)

| Table | Why SQLite | Risk if Filesystem |
|-------|-----------|-------------------|
| `file_locks` | ACID transactions prevent race conditions | Double-acquire, lost locks |
| `dag_tasks` | Complex state machine with dependency resolution | Corrupted DAG state |
| `decisions` | Multi-agent approval workflows need atomicity | Split-brain approvals |
| `timers` | Status transitions (pending→fired) must be atomic | Duplicate fires |
| `deferred_issues` | Lifecycle state tracking | Lost issues |
| `conversations` + `messages` | Ordered, relational, high-volume | Ordering bugs, data loss |
| `chat_groups` + members + messages | Many-to-many joins | Query nightmare on filesystem |
| `projects` + `project_sessions` | Relational with FK constraints | Orphaned records |
| `agent_plans` | Ephemeral, rebuilt per session | No benefit to filesystem |
| `task_cost_records` | Aggregation queries (SUM, GROUP BY) | Can't aggregate on filesystem |

### Should Stay (Performance)

| Table | Why SQLite | Notes |
|-------|-----------|-------|
| `activity_log` | Very high write volume (buffered 250ms) | Could eventually move to structured log files, but SQLite handles the volume well |
| `agent_file_history` | Needs aggregation queries for capability scoring | Could be computed from git history instead |
| `settings` | Low volume, but needs atomic read-write | Could split: operational settings in DB, user preferences in YAML |

---

## Pros/Cons Analysis

### SQLite

| Pro | Weight | Con | Weight |
|-----|--------|-----|--------|
| ACID transactions | **Critical** for locks, DAG, decisions | Not human-editable | **High** for knowledge data |
| Relational queries (JOIN, GROUP BY) | **High** for conversations, chat groups | Not git-friendly (binary) | **High** for team sharing |
| Single-file backup | Medium | Hard to inspect/debug | Medium |
| Concurrent read access (WAL) | **High** for multi-agent reads | Opaque to external tools | **High** for IDE/CLI integration |
| Fast indexed lookups | High | Can't merge across users | **High** for per-user training |
| Built-in aggregation | Medium for metrics | No partial sync | Medium |

### Filesystem

| Pro | Weight | Con | Weight |
|-----|--------|-----|--------|
| Human-readable/editable | **Critical** for training data | No ACID transactions | **Critical** for operational state |
| Git-trackable (diffable, mergeable) | **High** for team sharing | Race conditions | **High** for concurrent agents |
| Editable with any tool (vim, VS Code) | **High** for prompt engineering | No relational queries | **High** for DAG, groups |
| Shareable via git/dropbox/etc. | **High** for team workflows | Scattered files (no single backup) | Medium |
| Inspectable by IDE integrations | **High** for DX | No ordered iteration guarantee | Medium |
| Per-user without conflicts | **Critical** for training | No built-in TTL/expiry | Low |
| Portable (copy a directory) | Medium | | |

---

## Hybrid Boundary Design

### The Principle

```
                    ┌──────────────────────────┐
                    │     Flightdeck State      │
                    └──────────┬───────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                                  ▼
     ┌────────────────┐                ┌────────────────┐
     │    SQLite       │                │   Filesystem    │
     │  (flightdeck.db)│                │ (~/.flightdeck/)│
     │                 │                │                 │
     │ "Working Memory"│                │ "Long-Term      │
     │  Within-session │                │  Memory"        │
     │  operational    │                │  Cross-session  │
     │  state          │                │  knowledge      │
     └────────────────┘                └────────────────┘
     
     ✅ Locks, DAG, timers            ✅ Knowledge, roles
     ✅ Decisions, approvals           ✅ Training, preferences  
     ✅ Chat groups, messages          ✅ Retros, learnings
     ✅ Activity log, metrics          ✅ Skills, templates
     ✅ Projects, sessions             ✅ User config
```

### SQLite Keeps (16 tables — operational state)

1. `conversations` + `messages` — Session chat history
2. `file_locks` — Atomic lock management
3. `dag_tasks` — Task state machine
4. `decisions` — Approval workflows
5. `deferred_issues` — Issue tracking
6. `timers` — Scheduled events
7. `chat_groups` + `chat_group_members` + `chat_group_messages` — Group coordination
8. `projects` + `project_sessions` — Project registry
9. `activity_log` — Audit trail
10. `task_cost_records` — Token metrics
11. `agent_plans` — Ephemeral plans
12. `agent_file_history` — File touch metrics
13. `settings` (operational only) — Share links, budgets, recovery state

### Filesystem Gets (4 categories — knowledge state)

1. **Knowledge** (`collective_memory` → files) — Patterns, decisions, gotchas
2. **Retros** (`session_retros` → files) — Session retrospectives
3. **Custom Roles** (`roles` where builtIn=0 → files) — User-authored system prompts
4. **Agent Preferences** (subset of `agent_memory` → files) — Cross-session agent facts

### Filesystem New (2 categories — per-user training)

5. **User Preferences** — Per-user coding style, tool preferences, communication style
6. **Training Notes** — Corrections, feedback, domain knowledge

---

## Per-User Training Design

### Directory Structure

```
~/.flightdeck/
├── config.yaml                       # Global user preferences
├── roles/                            # User-global custom roles
│   ├── security-expert.md
│   └── ml-engineer.md
├── projects/
│   ├── <project-id>/                 # Per-project, per-user
│   │   ├── knowledge/                # Collective memory (moved from DB)
│   │   │   ├── patterns/
│   │   │   ├── decisions/
│   │   │   ├── expertise/
│   │   │   └── gotchas/
│   │   ├── retros/                   # Session retrospectives
│   │   │   └── 2026-03-07-daemon.md
│   │   ├── training/                 # NEW: Per-user training data
│   │   │   ├── corrections.yaml     # "When I say X, I mean Y"
│   │   │   ├── style-guide.md       # Personal coding style prefs
│   │   │   ├── domain-terms.yaml    # Project-specific terminology
│   │   │   └── feedback/            # Session-specific corrections
│   │   │       └── 2026-03-07.yaml
│   │   ├── agents/                   # Per-role preferences
│   │   │   ├── architect/
│   │   │   │   └── preferences.yaml
│   │   │   └── developer/
│   │   │       └── preferences.yaml
│   │   └── roles/                    # Project-specific custom roles
│   │       └── domain-expert.md
│   └── <another-project-id>/
│       └── ...
└── shared/                           # Shared across projects (rare)
    └── global-corrections.yaml
```

### Training File Formats

**corrections.yaml** — User corrections that apply to all agents:
```yaml
# Corrections: "When I say X, I actually mean Y"
# Agents load these at session start to avoid repeating mistakes

corrections:
  - trigger: "use winston for logging"
    correction: "We use pino, not winston. See R5 spec."
    category: tooling
    
  - trigger: "add a DI framework"
    correction: "We hand-roll DI via container.ts. No framework."
    category: architecture
    
  - trigger: "write tests in jest"
    correction: "We use vitest, not jest. Same API but different runner."
    category: testing
```

**style-guide.md** — Personal coding preferences:
```markdown
# My Coding Style

## TypeScript
- Prefer `interface` over `type` for object shapes
- Use `readonly` for all properties that shouldn't change
- Explicit return types on exported functions

## Testing
- Test file next to source: `Foo.ts` → `Foo.test.ts`
- Use `describe`/`it` pattern, not `test()`
- Always test error paths, not just happy paths

## Git
- Conventional commits: `feat:`, `fix:`, `docs:`
- One logical change per commit
- Squash WIP commits before merge
```

**domain-terms.yaml** — Project-specific vocabulary:
```yaml
# Domain terminology for this project
# Agents use these to understand project-specific language

terms:
  ACP: "Agent Client Protocol — JSON-RPC over stdio for CLI agents"
  DI: "Dependency Injection — via container.ts, not a framework"
  DAG: "Directed Acyclic Graph — task dependency tracking"
  bridge: "AgentAcpBridge — wires ACP adapter events to Agent state"
  lead: "The project lead agent that delegates to other agents"
  
abbreviations:
  R5: "Recommendation 5: Structured Logging"
  R9: "Recommendation 9: ACP Adapter Abstraction"
  WS: "WebSocket"
```

### How Training Data Flows

```
Session Start:
  1. Load ~/.flightdeck/config.yaml (global prefs)
  2. Load ~/.flightdeck/projects/<pid>/training/ (project training)
  3. Load ~/.flightdeck/projects/<pid>/knowledge/ (collective memory)
  4. Inject into agent context manifest (Agent.buildContextManifest())

During Session:
  5. Agents discover patterns → write to knowledge/patterns/
  6. User provides corrections → append to training/feedback/<date>.yaml
  7. Agent learns from corrections → updates training/corrections.yaml

Session End:
  8. Generate retro → write to retros/<date>.md
  9. Consolidate feedback → merge into corrections.yaml
```

### Sharing Model

```
Per-user, per-project (DEFAULT):
  ~/.flightdeck/projects/<pid>/training/    ← YOUR training data
  ~/.flightdeck/projects/<pid>/knowledge/   ← YOUR knowledge entries

Shared with team (OPT-IN):
  <cwd>/.flightdeck/knowledge/              ← Committed to git, shared
  <cwd>/.flightdeck/training/               ← Committed to git, shared
  <cwd>/.flightdeck/roles/                  ← Project roles, shared

Merge strategy:
  Team knowledge + personal training = merged context at session start
  Conflicts: personal overrides team (user's corrections > team defaults)
```

---

## Migration Strategy

### Phase 1: Read-Through Cache (Non-Breaking)

Add filesystem reading WITHOUT removing DB writes. Both paths active.

1. At session start, check `~/.flightdeck/projects/<pid>/knowledge/` for files
2. Load them into `CollectiveMemory` service alongside DB entries
3. Filesystem entries take priority over DB entries with same key
4. New entries still write to DB (backward compatible)

### Phase 2: Write to Filesystem

Start writing NEW knowledge entries to filesystem instead of DB.

1. `CollectiveMemory.remember()` writes a markdown file instead of DB insert
2. Existing DB entries remain readable (migration happens gradually)
3. Add `flightdeck export-knowledge` CLI command to bulk-migrate DB → files
4. Same for session retros, custom roles

### Phase 3: Training Infrastructure

Add the per-user training system.

1. Create training file templates on first `flightdeck init`
2. Load training data in `Agent.buildContextManifest()`
3. Add `/correct` command in session for real-time feedback capture
4. Auto-consolidate feedback at session end

### Phase 4: DB Cleanup

Remove migrated tables from DB (or leave as read-only fallback).

1. Mark `collective_memory` table as deprecated
2. Mark `session_retros` table as deprecated
3. Custom roles load from filesystem first, DB fallback
4. Eventually remove deprecated tables in a future migration

---

## Impact on Daemon Design

The daemon design doc (1229 lines) proposed `agentRoster` and `activeDelegations` as SQLite tables. These are NOT yet implemented — they're in-memory structures.

**Recommendation**: Keep both in SQLite when implemented. They're operational state (agent lifecycle tracking, delegation assignments) that needs atomicity and survives daemon restarts. Not knowledge data.

The daemon's event buffer during reconnect should also be in-memory (or SQLite for crash resilience), NOT filesystem — it's ephemeral operational state with sub-second access requirements.

---

## Conflict Resolution Policy

### Context

Flightdeck is single-user, local-only. There is no multi-user contention for `~/.flightdeck/`. However, conflicts can still arise from:

1. **Concurrent sessions** — Two Flightdeck server instances running simultaneously (e.g., user opens a second terminal)
2. **Manual user edits** — User edits a YAML file in VS Code while a session is active
3. **Agent writes** — Multiple agents writing to the same knowledge directory
4. **Git merge conflicts** — If files are committed to `<cwd>/.flightdeck/` and two branches modify them

### Policy by File Category

#### Knowledge Files (patterns/, decisions/, gotchas/, expertise/)

**Strategy: Additive, last-write-wins per file, no locking.**

- Each knowledge entry is its own file (e.g., `patterns/async-error-handling.md`)
- New entries create new files — no contention
- Updates to existing entries use last-write-wins — acceptable because knowledge entries are small, self-contained, and append-mostly
- Deletions are file deletes — no conflict possible
- If two sessions add different patterns simultaneously, both files are created (no collision — file names are slug-based from the key)

**Why no locking**: Knowledge writes are infrequent (a few per session), files are independent, and the cost of a lost write is low (the pattern can be re-learned). File locking adds complexity disproportionate to the risk.

#### Training Files (corrections.yaml, domain-terms.yaml)

**Strategy: Read-on-start, write-on-end, manual-edit-aware.**

```
Session Start:
  1. Read corrections.yaml into memory
  2. Snapshot file mtime

During Session:
  3. Accumulate new corrections in memory
  4. User may edit the file externally — we don't interfere

Session End:
  5. Re-read corrections.yaml from disk (pick up any manual edits)
  6. Merge in-memory corrections with disk state (additive merge)
  7. Write merged result back to disk
```

**Merge rules for YAML arrays**:
- `corrections[].trigger` is the merge key — if a correction with the same trigger exists on disk and in memory, the in-memory version wins (it's newer)
- New corrections (trigger not on disk) are appended
- Corrections on disk but not in memory are preserved (user added them manually)
- This is a **three-way merge**: original (at session start) + disk (at session end) + in-memory changes

```typescript
function mergeCorrections(
  original: Correction[],  // what we read at session start
  disk: Correction[],      // what's on disk now (may have manual edits)
  memory: Correction[],    // what we accumulated during session
): Correction[] {
  const result = new Map<string, Correction>();

  // Start with disk state (includes manual edits)
  for (const c of disk) result.set(c.trigger, c);

  // Apply in-memory changes (session corrections override)
  for (const c of memory) {
    if (!original.find(o => o.trigger === c.trigger)) {
      // New correction from this session — add it
      result.set(c.trigger, c);
    }
  }

  return Array.from(result.values());
}
```

#### Style Guide (style-guide.md)

**Strategy: Read-only during session, user-editable anytime.**

- Flightdeck reads `style-guide.md` at session start and injects into agent context
- Flightdeck NEVER writes to this file — it's 100% user-authored
- If user edits it mid-session, changes take effect on next session (not hot-reloaded)
- No conflict possible — single writer (the user)

#### Custom Roles (*.md files)

**Strategy: Read-on-start, no writes to existing files.**

- Custom role files are loaded at server startup
- Flightdeck only creates new role files (via API), never modifies existing ones without explicit user action
- If user edits a role file, changes take effect on server restart
- No conflict possible for the same reason as style-guide.md

#### Retros (retros/*.md)

**Strategy: Write-once, append-only.**

- Each session generates one retro file with a timestamped name (`2026-03-07-daemon-design.md`)
- Files are never modified after creation
- No conflict possible — unique file names per session

### Handling User Edits During Active Session

**Policy**: Flightdeck does NOT watch filesystem for changes during a session. Files are read at session start and written at session end. If the user modifies a file mid-session:

- **Knowledge files**: User's edit persists. Flightdeck's next write creates a separate file (different key).
- **Training YAML**: User's edit is picked up at session end via the three-way merge.
- **Style guide / roles**: User's edit takes effect on next session start.

**Rationale**: Filesystem watching (via `fs.watch` or chokidar) adds complexity, platform-specific bugs, and race conditions. For single-user local operation, "read on start, merge on end" is simple and reliable.

### Git Merge Conflicts

For files committed to `<cwd>/.flightdeck/` (team-shared knowledge):

**Policy**: Standard git merge. These are text files (YAML/markdown) — git's built-in merge handles them.

- **Knowledge markdown files**: Independent files, rarely conflict. If two branches add the same pattern with different content, git marks the conflict and the user resolves.
- **Training YAML files**: Array-based. Git may conflict on adjacent lines. Resolution: accept both entries (additive).
- **Roles**: Conflicts are rare (roles are created once, rarely modified). Manual resolution.

**Recommendation**: Add a `.gitattributes` hint for YAML files:

```gitattributes
# .flightdeck/.gitattributes
*.yaml merge=union    # Prefer additive merge for YAML arrays
*.yml merge=union
```

`merge=union` tells git to keep lines from both sides on conflict — appropriate for additive lists like corrections and domain terms.

---

## Schema Evolution for Metadata Files

### Versioning Strategy

Every structured file (YAML/JSON) includes a `schemaVersion` field in its frontmatter or top-level:

```yaml
# corrections.yaml
schemaVersion: 1
corrections:
  - trigger: "use winston"
    correction: "We use pino."
    category: tooling
```

```yaml
# In a markdown file with YAML frontmatter
---
schemaVersion: 1
source: agent-a1b2c3d4
created: 2026-03-07T15:30:00Z
tags: [sqlite, performance]
---

# SQLite WAL Checkpoint Blocks Reads
...
```

**Version semantics**: Integer, starts at 1, incremented on breaking changes. Additive fields don't bump the version.

### Compatibility Rules

#### Forward Compatibility (old Flightdeck reads new schema)

**Policy: Ignore unknown fields.**

Zod schemas use `.passthrough()` (not `.strict()`) so that unknown fields are preserved, not rejected:

```typescript
// packages/shared/src/domain/training.ts
import { z } from 'zod';

const CorrectionSchema = z.object({
  trigger: z.string(),
  correction: z.string(),
  category: z.string().optional(),
  // Future fields added here are ignored by old versions
}).passthrough();  // ← Preserves unknown fields on parse

const CorrectionsFileSchema = z.object({
  schemaVersion: z.number().default(1),
  corrections: z.array(CorrectionSchema).default([]),
}).passthrough();
```

When old Flightdeck writes back the file, unknown fields are preserved because `.passthrough()` keeps them in the parsed object, and the serializer writes the full object back.

**Example**: v2 adds a `confidence` field to corrections. Old Flightdeck (v1) reads the file, ignores `confidence`, and writes it back with `confidence` intact.

#### Backward Compatibility (new Flightdeck reads old schema)

**Policy: Default missing fields.**

New fields are always optional with sensible defaults:

```typescript
const CorrectionSchemaV2 = z.object({
  trigger: z.string(),
  correction: z.string(),
  category: z.string().optional(),         // v1
  confidence: z.number().default(1.0),     // v2 — defaults to 1.0 if missing
  addedBy: z.string().default('unknown'),  // v2 — defaults if missing
}).passthrough();
```

When new Flightdeck reads a v1 file without `confidence`, Zod fills in the default. The file is NOT automatically rewritten — it stays at v1 on disk until explicitly modified.

### Migration Strategy: Lazy on Read, Never Auto-Rewrite

**Policy: Migrate in memory, not on disk.**

```typescript
function readCorrectionsFile(path: string): CorrectionsFile {
  const raw = readFileSync(path, 'utf-8');
  const parsed = yaml.parse(raw);
  
  // Validate with current schema (fills defaults for missing fields)
  const result = CorrectionsFileSchema.parse(parsed);
  
  // In-memory object has all current fields (with defaults)
  // File on disk is NOT rewritten — stays in original format
  return result;
}

function writeCorrectionsFile(path: string, data: CorrectionsFile): void {
  // Writing always uses the CURRENT schema version
  data.schemaVersion = CURRENT_CORRECTIONS_VERSION;
  writeFileSync(path, yaml.stringify(data), 'utf-8');
}
```

**Why not auto-rewrite?**
1. Preserves user formatting and comments (YAML comments are lost on rewrite)
2. Avoids noisy git diffs (touching every file on upgrade)
3. Respects user ownership — these are their files, not ours
4. Files only get the new schema version when Flightdeck actually writes changes

**Explicit migration command** (for users who want clean files):
```bash
flightdeck migrate-files [--project <id>] [--dry-run]
# Reads all files, validates, rewrites with current schema version
# Shows diff of what would change with --dry-run
```

### Breaking Changes (schemaVersion Bump)

When a breaking change is needed (field renamed, structure reorganized):

1. Bump `schemaVersion` to N+1
2. Write a migrator function: `migrateV1toV2(data: V1Schema): V2Schema`
3. On read, check `schemaVersion`:
   - If current → parse directly
   - If old → run migrator chain (v1→v2→v3...) then parse
   - If newer than known → log warning, parse with `.passthrough()` (best-effort)
4. On write, always write current version

```typescript
const MIGRATORS: Record<number, (data: unknown) => unknown> = {
  1: migrateV1toV2,  // Rename 'category' → 'domain'
  2: migrateV2toV3,  // Add required 'projectId' field
};

function readWithMigration(path: string): CorrectionsFile {
  const raw = yaml.parse(readFileSync(path, 'utf-8'));
  let data = raw;
  let version = data.schemaVersion ?? 1;
  
  // Run migrator chain
  while (version < CURRENT_VERSION) {
    const migrator = MIGRATORS[version];
    if (!migrator) throw new Error(`No migrator for v${version} → v${version + 1}`);
    data = migrator(data);
    version++;
  }
  
  if (version > CURRENT_VERSION) {
    logger.warn({ module: 'config', msg: `File ${path} has schema v${version}, we only know v${CURRENT_VERSION}. Parsing best-effort.` });
  }
  
  return CorrectionsFileSchema.parse(data);
}
```

### Validation: Zod Schemas for All Structured Files

**Policy: Validate on read, warn on invalid, never crash.**

Align with R2 shared types by defining schemas in `packages/shared/src/domain/`:

```typescript
// packages/shared/src/domain/training.ts
export const CorrectionsFileSchema = z.object({ ... });
export const DomainTermsFileSchema = z.object({ ... });

// packages/shared/src/domain/knowledge.ts
export const KnowledgeEntryFrontmatterSchema = z.object({ ... });

// packages/shared/src/domain/roleFile.ts
export const CustomRoleFileSchema = z.object({ ... });
```

### Malformed File Handling

**Policy: Graceful degradation. Never crash, always warn.**

```typescript
function safeReadYaml<T>(path: string, schema: z.ZodSchema<T>, fallback: T): T {
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = yaml.parse(raw);
    return schema.parse(parsed);
  } catch (err) {
    if (err instanceof z.ZodError) {
      logger.warn({
        module: 'config',
        msg: `Malformed file ${path}: ${err.issues.map(i => i.message).join(', ')}. Using defaults.`,
      });
      return fallback;
    }
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist — not an error, just return defaults
      return fallback;
    }
    logger.error({ module: 'config', msg: `Failed to read ${path}: ${(err as Error).message}` });
    return fallback;
  }
}
```

**Degradation tiers**:

| Problem | Behavior | User Impact |
|---------|----------|-------------|
| File missing | Return defaults, no warning | None — file hasn't been created yet |
| YAML syntax error | Warn, return defaults | Training data not loaded this session |
| Schema validation error | Warn with specifics, return partial (valid fields) | Partial training data loaded |
| File permissions error | Warn, return defaults | Training data not loaded |
| Unknown schemaVersion (newer) | Warn, parse best-effort with `.passthrough()` | Likely works, some features may be missing |
| Unknown schemaVersion (much newer) | Warn + suggest upgrade | User running old Flightdeck |

**Key principle**: A corrupted or invalid training file should NEVER prevent Flightdeck from starting or running a session. The worst case is "no training data loaded" — agents still work, they just lack the extra context.

---

## Design Decisions

### D1: SQLite = operational, filesystem = knowledge
**Why**: Operational state changes rapidly, needs transactions, and is queried relationally. Knowledge state changes slowly, needs human readability, and should be portable/shareable.

### D2: Local-only, single-user — no user nesting
**Why**: Flightdeck is single-user local software. `~/.flightdeck/` IS the user's directory. No `users/<id>/` subdirectories. Sharing with team happens via git (commit `<cwd>/.flightdeck/` files).

### D3: Markdown for content, YAML for structured data
**Why**: Knowledge entries and roles are prose — markdown is natural. Corrections, domain terms, and preferences are structured — YAML is human-editable and parseable.

### D4: Read-on-start, merge-on-end — no filesystem watching
**Why**: Filesystem watching adds platform-specific complexity and race conditions. For single-user local operation, "snapshot at start, three-way-merge at end" is simple, reliable, and respects user edits made mid-session.

### D5: Gradual migration, not big-bang
**Why**: The DB works today. Moving data to filesystem should be incremental — read from both, write to new, migrate existing on demand. No data loss risk.

### D6: Knowledge files are NOT the collective_memory table dumped to disk
**Why**: The filesystem format should be designed for human consumption (readable markdown with context), not machine consumption (raw key-value). The migration is a format transformation, not a copy.

### D7: Zod schemas with .passthrough() for all structured files
**Why**: Forward compatibility (unknown fields preserved) and backward compatibility (missing fields get defaults) handled by the same mechanism. Aligns with R2 shared types pattern. Never crashes on malformed input.

### D8: Schema version in every file, lazy migration on read
**Why**: Files only get rewritten when Flightdeck actually changes them — preserves user formatting, avoids noisy diffs, respects file ownership. Explicit `flightdeck migrate-files` command available for users who want clean files.
