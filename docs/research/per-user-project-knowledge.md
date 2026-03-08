# Per-Project Knowledge, Training & Storage System

**Author:** Architect (5699527d)  
**Status:** Draft → Revised (single-user simplification, project metadata, storage modes)  
**Depends on:** ConfigStore (R15), CollectiveMemory, KnowledgeTransfer, Skills infrastructure  

---

## Executive Summary

Design a per-project knowledge system that makes Flightdeck teams **learn and improve over time**. Knowledge accumulates in human-readable files at `~/.flightdeck/projects/<project-id>/`. The system also introduces **project metadata** (`project.yaml`) for startup discovery and a **storage mode choice** (repo vs home directory) for agent artifacts.

**Single-user simplification:** Flightdeck is a local tool used by one person. No multi-user isolation. Training data lives directly under `~/.flightdeck/projects/<project-id>/` — no `users/` subdirectory.

**Core insight:** The biggest leverage isn't RAG or embeddings — it's **injecting the right 200 tokens into a system prompt**. A correction like "always use `Result<T>` instead of throwing in this codebase" saves more time than a 10,000-token knowledge base dump.

---

## 1. Filesystem Hierarchy

```
~/.flightdeck/
├── config.yaml                              # Global preferences (all projects)
├── projects/
│   ├── <project-id>/                        # UUID from ProjectRegistry
│   │   ├── project.yaml                     # Project metadata (title, cwd, storage mode, etc.)
│   │   │
│   │   ├── skills/                          # Project skills (markdown, like .github/skills/)
│   │   │   ├── codebase-conventions.md
│   │   │   ├── ci-pipeline-gotchas.md
│   │   │   └── testing-patterns.md
│   │   │
│   │   ├── knowledge/                       # Learned facts about the project
│   │   │   ├── architecture.yaml            # Architecture decisions & facts
│   │   │   ├── dependencies.yaml            # Dependency constraints
│   │   │   └── patterns.yaml                # Recurring patterns and idioms
│   │   │
│   │   ├── training/                        # Accumulated corrections and guidance
│   │   │   ├── corrections.yaml             # "When I said X, I meant Y"
│   │   │   ├── examples.yaml                # Good/bad examples from past sessions
│   │   │   └── workflow.yaml                # Delegation style, review expectations
│   │   │
│   │   ├── preferences.yaml                 # Coding style, review standards, communication
│   │   │
│   │   ├── shared/                          # Agent artifacts (if storage: 'home')
│   │   │   ├── architect-a1b2c3d4/
│   │   │   │   └── design-doc.md
│   │   │   └── developer-f8e7d6c5/
│   │   │       └── implementation-notes.md
│   │   │
│   │   └── agents/                          # Per-provider agent files
│   │       └── <provider>/
│   │           └── <role>.agent.md
│   │
│   └── <another-project-id>/
│       └── ...
│
└── global/
    ├── preferences.yaml                     # Defaults applied to ALL projects
    └── skills/                              # Universal skills (applied everywhere)
        └── my-coding-style.md
```

---

## 2. Project Metadata (`project.yaml`)

### 2.1 Schema

```yaml
# ~/.flightdeck/projects/<project-id>/project.yaml
id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"   # UUID, matches directory name
title: "Flightdeck"                              # Human-readable project name
description: "Multi-agent orchestration platform for Copilot CLI"
cwd: "/Users/justinc/Documents/GitHub/flightdeck"   # Working directory (absolute path)
createdAt: "2026-03-01T10:00:00Z"
lastAccessedAt: "2026-03-07T17:30:00Z"          # Updated on every session start
status: active                                    # active | archived | completed

# Storage mode for agent artifacts
storage: hybrid                                   # 'repo' | 'home' | 'hybrid'

# Default agent configuration
defaults:
  cliProvider: copilot                            # copilot | claude-sdk | gemini | etc.
  model: claude-opus-4.6                          # Default model for this project
  autopilot: false

# Tags for organization
tags:
  - typescript
  - monorepo
  - open-source

# Git metadata (auto-populated)
git:
  remote: "git@github.com:justinchuby/flightdeck.git"
  branch: "main"
  lastCommit: "bbefa0a"
```

### 2.2 Zod Schema

```typescript
import { z } from 'zod';

export const ProjectMetadataSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().default(''),
  cwd: z.string(),                               // Absolute path to working directory
  createdAt: z.string().datetime(),
  lastAccessedAt: z.string().datetime(),
  status: z.enum(['active', 'archived', 'completed']).default('active'),
  storage: z.enum(['repo', 'home', 'hybrid']).default('hybrid'),
  defaults: z.object({
    cliProvider: z.string().default('copilot'),
    model: z.string().optional(),
    autopilot: z.boolean().default(false),
  }).default({}),
  tags: z.array(z.string()).default([]),
  git: z.object({
    remote: z.string().optional(),
    branch: z.string().optional(),
    lastCommit: z.string().optional(),
  }).default({}),
});

export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>;
```

### 2.3 Startup Discovery

On startup, Flightdeck scans `~/.flightdeck/projects/*/project.yaml`:

```typescript
// packages/server/src/projects/ProjectDiscovery.ts

export class ProjectDiscovery {
  private projectRoot: string;  // ~/.flightdeck/projects/

  constructor() {
    this.projectRoot = path.join(homedir(), '.flightdeck', 'projects');
  }

  /**
   * Scan filesystem for all projects. Returns metadata for each.
   * Called once at startup; results merged with SQLite project table.
   */
  async discoverAll(): Promise<DiscoveredProject[]> {
    const results: DiscoveredProject[] = [];

    if (!existsSync(this.projectRoot)) return results;

    const entries = readdirSync(this.projectRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const yamlPath = path.join(this.projectRoot, entry.name, 'project.yaml');
      if (!existsSync(yamlPath)) continue;

      try {
        const raw = readFileSync(yamlPath, 'utf-8');
        const parsed = yaml.parse(raw);
        const metadata = ProjectMetadataSchema.parse(parsed);

        // Validate working directory still exists
        const cwdExists = existsSync(metadata.cwd);

        results.push({
          metadata,
          cwdExists,
          cwdAccessible: cwdExists ? isAccessible(metadata.cwd) : false,
          yamlPath,
        });
      } catch (err) {
        // Malformed project.yaml — skip with warning
        logger.warn({ module: 'discovery', msg: `Invalid project.yaml in ${entry.name}`, error: err });
      }
    }

    return results;
  }

  /**
   * Sync discovered projects with SQLite.
   * - Projects in filesystem but not DB → insert into DB
   * - Projects in DB but not filesystem → mark as orphaned (don't delete)
   * - Both exist → update DB from filesystem (filesystem is source of truth)
   */
  async syncWithRegistry(
    registry: ProjectRegistry,
    discovered: DiscoveredProject[]
  ): Promise<SyncResult> {
    const dbProjects = registry.list();
    const dbIds = new Set(dbProjects.map(p => p.id));
    const fsIds = new Set(discovered.map(d => d.metadata.id));

    let added = 0, updated = 0, orphaned = 0;

    // Filesystem → DB (add or update)
    for (const d of discovered) {
      if (!dbIds.has(d.metadata.id)) {
        registry.create(d.metadata.title, d.metadata.description, d.metadata.cwd);
        added++;
      } else {
        registry.update(d.metadata.id, {
          name: d.metadata.title,
          cwd: d.metadata.cwd,
          status: d.metadata.status,
        });
        updated++;
      }
    }

    // DB-only projects → mark orphaned (cwd check)
    for (const dbProject of dbProjects) {
      if (!fsIds.has(dbProject.id) && dbProject.cwd && !existsSync(dbProject.cwd)) {
        orphaned++;
      }
    }

    return { added, updated, orphaned };
  }
}

interface DiscoveredProject {
  metadata: ProjectMetadata;
  cwdExists: boolean;
  cwdAccessible: boolean;
  yamlPath: string;
}
```

### 2.4 Working Directory Validation

```typescript
// Graceful handling of moved/deleted repos
function validateProject(project: DiscoveredProject): ProjectHealth {
  if (!project.cwdExists) {
    return {
      status: 'missing',
      message: `Working directory not found: ${project.metadata.cwd}`,
      action: 'Show in UI with warning icon. Offer "relocate" or "archive".',
    };
  }
  if (!project.cwdAccessible) {
    return {
      status: 'inaccessible',
      message: `Cannot access: ${project.metadata.cwd}`,
      action: 'Show with lock icon. Check permissions.',
    };
  }
  // Verify git repo still exists
  const gitDir = path.join(project.metadata.cwd, '.git');
  if (!existsSync(gitDir)) {
    return {
      status: 'not-repo',
      message: `Not a git repository: ${project.metadata.cwd}`,
      action: 'Show with warning. Still usable but git features disabled.',
    };
  }
  return { status: 'healthy', message: 'OK', action: null };
}
```

### 2.5 API Endpoints for Project Discovery

```
GET  /api/projects/discovered    # Returns all discovered projects with health status
POST /api/projects/relocate      # Update cwd for a project { id, newCwd }
POST /api/projects/archive       # Archive a project with missing cwd
POST /api/projects               # Create new project (now also creates project.yaml)
```

### 2.6 Relationship to SQLite

**project.yaml is the source of truth for metadata.** SQLite is the source of truth for runtime state (sessions, tasks, agents).

| Data | Source of Truth | Why |
|------|----------------|-----|
| Title, description, tags, defaults | `project.yaml` (filesystem) | Human-editable, portable |
| Working directory path | `project.yaml` (filesystem) | Survives DB reset |
| Storage mode | `project.yaml` (filesystem) | Per-project config |
| Sessions, tasks, delegations | SQLite (`projectSessions`, `dagTasks`) | Runtime state, relational |
| Agent memory, decisions | SQLite (`agentMemory`, `decisions`) | Session-scoped, queryable |
| Model config per role | `project.yaml` (overrides) → SQLite (fallback) | Migrate from `modelConfig` column |

---

## 3. Storage Modes

### 3.1 The Three Modes

```
┌─────────────────────────────────────────────────────────────────┐
│                        Storage Modes                             │
│                                                                  │
│  REPO MODE (storage: 'repo')                                    │
│  Everything in <git-root>/.flightdeck/                          │
│  ✓ Committable, shareable with team                             │
│  ✓ Visible in project directory                                 │
│  ✗ Pollutes repo if not gitignored                              │
│  NOTE: Always at git repo root, not process cwd                 │
│                                                                  │
│  HOME MODE (storage: 'home')                                    │
│  Everything in ~/.flightdeck/projects/<id>/                     │
│  ✓ Private, doesn't touch the repo                              │
│  ✓ Survives repo clones/moves                                   │
│  ✗ Not shareable with team                                      │
│                                                                  │
│  HYBRID MODE (storage: 'hybrid')  ← DEFAULT                    │
│  Team knowledge → <git-root>/.flightdeck/                       │
│  Personal training → ~/.flightdeck/projects/<id>/               │
│  ✓ Best of both worlds                                          │
│  ✓ Current .flightdeck/shared/ usage maps cleanly               │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 What Goes Where (Hybrid Mode)

| Data Type | Location | Rationale |
|-----------|----------|-----------|
| **Agent artifacts** (shared/) | `<git-root>/.flightdeck/shared/` | Team-visible, version-controllable |
| **Project skills** | `<git-root>/.flightdeck/skills/` | Shared knowledge, committable |
| **Exports** | `<git-root>/.flightdeck/exports/` | Session exports |
| **Training** (corrections) | `~/.flightdeck/projects/<id>/training/` | Personal, not for team |
| **Preferences** | `~/.flightdeck/projects/<id>/preferences.yaml` | Personal style choices |
| **Architecture knowledge** | `~/.flightdeck/projects/<id>/knowledge/` | Auto-learned, could drift |
| **Project metadata** | `~/.flightdeck/projects/<id>/project.yaml` | Always in home dir |

### 3.3 Storage Resolution Logic

```typescript
// packages/server/src/knowledge/StorageResolver.ts

export class StorageResolver {
  /**
   * Resolve the actual filesystem path for a given data type and project.
   * Respects the project's storage mode setting.
   */
  resolve(projectId: string, dataType: StorageDataType): string {
    const meta = this.getProjectMetadata(projectId);
    const homePath = path.join(homedir(), '.flightdeck', 'projects', projectId);
    // IMPORTANT: .flightdeck/ goes at the git repo root, NOT process cwd.
    // meta.cwd stores the repo root (resolved via `git rev-parse --show-toplevel`
    // at project creation time).
    const repoPath = path.join(meta.cwd, '.flightdeck');

    switch (meta.storage) {
      case 'repo':
        // Everything in the repo
        return path.join(repoPath, DATA_TYPE_DIRS[dataType]);

      case 'home':
        // Everything in home directory
        return path.join(homePath, DATA_TYPE_DIRS[dataType]);

      case 'hybrid':
        // Team-shareable → repo, personal → home
        if (TEAM_DATA_TYPES.includes(dataType)) {
          return path.join(repoPath, DATA_TYPE_DIRS[dataType]);
        }
        return path.join(homePath, DATA_TYPE_DIRS[dataType]);
    }
  }
}

type StorageDataType =
  | 'shared'         // Agent artifacts
  | 'skills'         // Project skills
  | 'exports'        // Session exports
  | 'training'       // Corrections, examples
  | 'preferences'    // Style/workflow preferences
  | 'knowledge'      // Architecture, patterns
  | 'agents';        // Provider-specific agent files

const DATA_TYPE_DIRS: Record<StorageDataType, string> = {
  shared: 'shared',
  skills: 'skills',
  exports: 'exports',
  training: 'training',
  preferences: '',            // preferences.yaml at root
  knowledge: 'knowledge',
  agents: 'agents',
};

const TEAM_DATA_TYPES: StorageDataType[] = ['shared', 'skills', 'exports'];
```

### 3.4 Git Repo Root Detection

**Critical:** In-repo `.flightdeck/` MUST be placed at the git repository root, not at `process.cwd()`. The current `ensureSharedWorkspace()` uses `agent.cwd || process.cwd()` which may not be the repo root if the server is started from a subdirectory.

```typescript
// packages/server/src/knowledge/repoRoot.ts

import { execSync } from 'child_process';

/**
 * Detect the git repo root for the given directory.
 * Returns the absolute path to the repo root, or the directory itself
 * if it's not a git repository.
 *
 * This is the ONLY correct place to anchor <repo>/.flightdeck/ —
 * never use process.cwd() or agent.cwd directly.
 */
export function resolveRepoRoot(cwd: string): string {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],  // Suppress stderr
    }).trim();
    return root;
  } catch {
    // Not a git repo — fall back to the directory itself
    return cwd;
  }
}
```

**Where this gets called:**
1. **Project creation** — `cwd` stored in `project.yaml` is always `resolveRepoRoot(providedCwd)`, never raw cwd
2. **`ensureSharedWorkspace()`** — must be updated to use `resolveRepoRoot(agent.cwd)` instead of `agent.cwd || process.cwd()`
3. **StorageResolver** — `meta.cwd` already stores the repo root (resolved at creation time)

**Update to `ensureSharedWorkspace()` (AgentAcpBridge.ts):**
```typescript
// BEFORE (current — may not be repo root):
const baseDir = agent.cwd || process.cwd();
const newBase = join(baseDir, '.flightdeck');

// AFTER (anchored at git root):
const rawDir = agent.cwd || process.cwd();
const baseDir = resolveRepoRoot(rawDir);
const newBase = join(baseDir, '.flightdeck');
```

### 3.5 Migration from Current .flightdeck/shared/

Current state: `.flightdeck/shared/` exists in the repo working directory (gitignored). It contains 144+ agent artifact subdirectories. This maps to **hybrid mode** naturally:

```
CURRENT                                    NEW (hybrid mode)
─────────────────────                      ─────────────────────────────

<git-root>/.flightdeck/                    <git-root>/.flightdeck/
├── shared/                                ├── shared/           ← UNCHANGED
│   ├── architect-a1b2c3d4/                │   ├── architect-a1b2c3d4/
│   └── developer-f8e7d6c5/               │   └── developer-f8e7d6c5/
└── exports/                               ├── exports/          ← UNCHANGED
                                           └── skills/           ← NEW (optional)

                                           ~/.flightdeck/projects/<id>/
                                           ├── project.yaml      ← NEW
                                           ├── preferences.yaml  ← NEW
                                           ├── training/         ← NEW
                                           │   └── corrections.yaml
                                           └── knowledge/        ← NEW
                                               └── architecture.yaml
```

**Migration is additive:** Current `.flightdeck/shared/` continues to work as-is. New files are created alongside (repo) or in home dir (personal). Zero breaking changes.

The `ensureSharedWorkspace()` function in `AgentAcpBridge.ts` (lines 15-37) needs a one-line update to use `resolveRepoRoot()` (see §3.4). The new system adds `~/.flightdeck/projects/<id>/` for personal data.

### 3.6 WorktreeManager Symlink Update

The current symlink logic in `WorktreeManager.ts` (line 78) symlinks the repo's `.flightdeck` into worktrees. This works unchanged for `repo` and `hybrid` modes. For `home` mode, worktrees need a symlink to the home dir path instead:

```typescript
// Updated logic:
const storageMode = projectMetadata.storage;
const sharedDir = storageMode === 'home'
  ? path.join(homedir(), '.flightdeck', 'projects', projectId)
  : path.join(this.repoRoot, '.flightdeck');

const targetShared = path.join(worktreePath, '.flightdeck');
if (existsSync(sharedDir) && !existsSync(targetShared)) {
  symlinkSync(sharedDir, targetShared, 'junction');
}
```

---

## 4. Knowledge Injection Architecture

### 4.1 The Injection Pipeline

```
┌─────────────────────────────────────────────────────────┐
│                   System Prompt Assembly                  │
│                                                          │
│  1. Base Role Prompt        (RoleRegistry, ~2000 tokens) │
│  2. SELF_REPORT_INSTRUCTION (RoleRegistry, ~800 tokens)  │
│  3. ── KNOWLEDGE INJECTION ──────────────────────────── │
│     a. Auto-inject skills   (~500 tokens, role-filtered) │
│     b. Preferences summary  (~200 tokens, bullet points) │
│     c. Top corrections      (~300 tokens, top-5 by wt)   │
│     d. Project knowledge    (~200 tokens, relevant only)  │
│  4. Task Assignment          (AgentManager, variable)     │
│  5. Context Manifest         (peer agents list)           │
│                                                          │
│  Total budget for (3): ~1200 tokens max                  │
│  Out of ~200,000 token context window = 0.6%             │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Token Budget Strategy

**The 1% rule:** Knowledge injection should never exceed 1% of the context window.

| Source | Budget | Selection Strategy |
|--------|--------|--------------------|
| Auto-inject skills | 500 tokens | Role-filtered, `max-tokens` frontmatter |
| Preferences | 200 tokens | Summarized to bullet points |
| Top corrections | 300 tokens | Top 5 by weight, role-relevant |
| Project knowledge | 200 tokens | Architecture facts relevant to task |
| **Total** | **1200 tokens** | |

### 4.3 Integration Point

In `AgentManager.spawn()` (lines 312-315), after role resolution:

```typescript
// Existing lead role list injection:
if (role.id === 'lead') {
  const roleList = this.roleRegistry.generateRoleList();
  effectiveRole = { ...role, systemPrompt: role.systemPrompt.replace('{{ROLE_LIST}}', roleList) };
}

// NEW: Knowledge injection for all roles
const knowledgeBlock = this.knowledgeInjector.buildInjection({
  projectId: effectiveProjectId,
  role: role.id,
  task: task ?? '',
});

if (knowledgeBlock) {
  effectiveRole = {
    ...effectiveRole,
    systemPrompt: effectiveRole.systemPrompt + '\n\n' + knowledgeBlock,
  };
}
```

### 4.4 Injected Format

```
== Project Context ==

[Skills]
- Use named imports with .js extension (ESM)
- Shared types via @flightdeck/shared
- Vitest for testing, never Jest

[Preferences]
- Style: minimal comments, explicit types, no 'any'
- Reviews: focus on correctness + security, ignore style
- Communication: concise and direct

[Corrections]
- IMPORTANT (×5): This is a local dev tool. No microservices. Keep it simple.
- IMPORTANT (×3): Never use 'any'. Use 'unknown' and narrow.

[Architecture]
- Monorepo: server (Express 5) + web (React 19) + shared (Zod)
- SQLite via better-sqlite3 + Drizzle ORM, WAL mode
```

---

## 5. Knowledge Acquisition

### 5.1 Explicit (User-Authored)

Files can be created/edited directly or via API:
```bash
vim ~/.flightdeck/projects/<id>/skills/conventions.md
vim ~/.flightdeck/projects/<id>/preferences.yaml
```

### 5.2 Implicit (Correction Capture)

When a user corrects an agent, the system captures it:

```yaml
# ~/.flightdeck/projects/<id>/training/corrections.yaml
corrections:
  - id: "corr-001"
    timestamp: "2026-03-07T15:30:00Z"
    agentRole: developer
    context: "Agent used 'any' type in a new interface"
    correction: "Never use 'any' in new code. Use 'unknown' and narrow."
    category: coding-style    # coding-style | architecture | workflow | communication
    weight: 3                 # 1-5; auto-incremented on repeat corrections
```

Correction dedup: if a new correction fuzzy-matches an existing one, increment weight instead of adding a duplicate. Auto-prune below weight threshold after 100 entries.

### 5.3 Semi-Automatic (Session Summary)

After a session, `SessionRetro` (existing) can extract learnings:
- Corrections made during the session → `training/corrections.yaml`
- Patterns discovered → `knowledge/patterns.yaml`
- New conventions established → prompt user to save as skill

### 5.4 CollectiveMemory Bridge

Wire the existing (but unused) `CollectiveMemory` into container.ts. On session end, sync filesystem knowledge to DB for cross-session search. On session start, recall relevant memories and feed into injection pipeline.

---

## 6. Service Architecture

### 6.1 New Services

```
packages/server/src/knowledge/
├── KnowledgeInjector.ts      # Assembles prompt injection block
├── StorageResolver.ts        # Resolves paths based on storage mode
├── ProjectDiscovery.ts       # Scans ~/.flightdeck/projects/ at startup
└── CorrectionCapture.ts      # Detects and records corrections
```

### 6.2 Container Registration (Tier 2)

```typescript
// After DB, before agents:
const projectDiscovery = new ProjectDiscovery();
const storageResolver = new StorageResolver(projectRegistry);
const knowledgeInjector = new KnowledgeInjector(collectiveMemory, storageResolver, configStore);

// Also wire CollectiveMemory (the pending fix):
const collectiveMemory = new CollectiveMemory(db);
```

### 6.3 Startup Flow

```
1. Server starts
2. ProjectDiscovery.discoverAll() scans ~/.flightdeck/projects/*/project.yaml
3. Sync with ProjectRegistry (SQLite) — filesystem is source of truth for metadata
4. Validate working directories (flag missing/moved repos)
5. KnowledgeInjector loads preferences + skills for active projects
6. API server ready — UI receives project list with health status
```

---

## 7. File Formats Reference

### 7.1 Global Preferences (`~/.flightdeck/config.yaml`)

```yaml
preferences:
  codingStyle:
    language: typescript
    errorHandling: result-types   # result-types | exceptions | either
    testFramework: vitest
    importStyle: named            # named | default | barrel
    commentStyle: minimal         # minimal | jsdoc | detailed
  reviewStyle:
    strictness: high              # low | medium | high
    focusAreas: [correctness, security, performance]
    ignoreAreas: [style]
  communicationStyle:
    verbosity: concise            # concise | balanced | detailed
  delegation:
    preferParallel: true
    maxConcurrent: 6
    reviewBeforeMerge: true
```

### 7.2 Project Preferences (`preferences.yaml`)

```yaml
# Overrides global preferences for this project
preferences:
  codingStyle:
    errorHandling: exceptions     # This project uses throw
    rules:
      - "Use Zod v4 schemas (import { z } from 'zod')"
      - "All shared types go in packages/shared/src/domain/"
      - "Use .js extensions in import paths (ESM)"
  modelPreferences:
    architect: claude-opus-4.6
    developer: claude-sonnet-4.6
```

### 7.3 Skills (Markdown with frontmatter)

```markdown
---
name: codebase-conventions
description: Coding conventions for this project
auto-inject: true
inject-roles: [developer, architect, code-reviewer]
max-tokens: 500
---

# Codebase Conventions
- Use named imports: `import { foo } from './bar.js'`
- Shared types: `import type { X } from '@flightdeck/shared'`
- Never use `any` — use `unknown` and narrow
```

### 7.4 Architecture Knowledge (`knowledge/architecture.yaml`)

```yaml
architecture:
  - key: "monorepo-structure"
    fact: "Three packages: server (Express 5), web (React 19), shared (Zod schemas)"
    confidence: high
    source: "session-analysis"
    lastVerified: "2026-03-07"
```

---

## 8. How This Relates to Existing Systems

| Existing System | Role in New Design |
|----------------|-------------------|
| **CollectiveMemory** | Wire into container.ts. Persistence layer for cross-session knowledge. |
| **KnowledgeTransfer** | Session-scoped. Post-session entries sync to filesystem. |
| **AgentMemory** | Unchanged — within-session per-agent facts. |
| **Skills (.github/skills/)** | Continue as team-shared. New: `~/.flightdeck/` skills are personal. |
| **RoleRegistry** | Prompt assembly. KnowledgeInjector adds knowledge block. |
| **ConfigStore** | Runtime config. File-watch pattern reused for knowledge files. |
| **SessionRetro** | Extended to extract learnings → filesystem + CollectiveMemory. |
| **ProjectRegistry** | Supplemented with filesystem discovery. DB stores runtime state, YAML stores metadata. |

---

## 9. Implementation Plan

### Phase 1: Project Metadata & Discovery
- [ ] Create `ProjectDiscovery` service (scan `~/.flightdeck/projects/`)
- [ ] Define `project.yaml` Zod schema
- [ ] Create project.yaml on project creation (alongside SQLite insert)
- [ ] Startup sync: filesystem → SQLite registry
- [ ] Working directory validation (healthy / missing / inaccessible)
- [ ] API: `GET /api/projects/discovered`, `POST /api/projects/relocate`
- [ ] Wire `CollectiveMemory` into container.ts

### Phase 2: Storage Modes
- [ ] Implement `StorageResolver` (repo / home / hybrid path resolution)
- [ ] Update `ensureSharedWorkspace()` to respect storage mode
- [ ] Update `WorktreeManager` symlink logic for home mode
- [ ] Storage mode selection at project creation (default: hybrid)
- [ ] Migration: existing `.flightdeck/shared/` → hybrid mode (zero changes needed)

### Phase 3: Knowledge Injection
- [ ] Implement `KnowledgeInjector.buildInjection()`
- [ ] Skill file loading with `auto-inject` frontmatter parsing
- [ ] Preference loading and merging (global → project)
- [ ] Correction loading (top-N by weight, role-filtered)
- [ ] Wire into `AgentManager.spawn()` prompt assembly
- [ ] Token budget enforcement (`fitToBudget()`)

### Phase 4: Training & Corrections
- [ ] Correction capture API (explicit)
- [ ] Implicit correction detection (heuristic, behind flag)
- [ ] Correction dedup and weight management
- [ ] SessionRetro extension for learning extraction

### Phase 5: API & UI
- [ ] REST API for skills, preferences, corrections, knowledge CRUD
- [ ] File watcher for hot-reload of knowledge files
- [ ] UI: project list from discovery (with health indicators)
- [ ] UI: knowledge management panel (view/edit skills, corrections)

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Knowledge bloats prompts | Medium | Hard 1200-token budget. `fitToBudget()` truncates. |
| Stale knowledge | Medium | `lastVerified` field + confidence decay. Auto-prune after 30 days. |
| Filesystem permission issues | Low | Graceful fallback if `~/.flightdeck/` unwritable. |
| project.yaml / SQLite desync | Medium | Filesystem is source of truth for metadata. Startup sync resolves. |
| Storage mode confusion | Low | Default to hybrid. Clear docs. UI explains each option. |
| Migration breaks existing .flightdeck/ | Low | Migration is additive — current structure works as hybrid mode. |

---

## 11. Design Principles

1. **Human-readable first.** YAML/Markdown files editable with any text editor. No binary formats.
2. **Additive, not intrusive.** If knowledge system fails, agents work exactly as today.
3. **Budget-constrained.** 1200 tokens max injection. Active prevention of context overflow.
4. **Filesystem is source of truth** for metadata and knowledge. SQLite for runtime state.
5. **Build on what exists.** CollectiveMemory, KnowledgeTransfer, SessionRetro, ConfigStore — reuse patterns.
