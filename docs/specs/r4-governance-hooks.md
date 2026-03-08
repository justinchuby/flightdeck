# R4: Hook-Based Governance Pipeline — Implementation Spec

> **Author**: Architect agent 5699527d
> **Status**: ✅ **Implemented** (2026-03-07)
> **Inspired by**: Squad's `PreToolUseContext → HookAction` pipeline, Edict's mandatory review gates
> **Estimated effort**: 1 week (3 days core pipeline + 2 days built-in hooks + tests)

---

## 1. Current State: How Commands Flow Without Hooks

### The Pipeline Today

```
LLM Text Output
    │
    ▼
AgentAcpBridge.wireAcpEvents()        ← agent._notifyData(text)
    │
    ▼
AgentManager.onData(data)             ← dispatcher.appendToBuffer() + scanBuffer()
    │
    ▼
CommandDispatcher.scanBuffer(agent)
    │
    ├── Pattern match across all registered CommandEntry[]
    ├── Nested command check (isInsideCommandBlock)
    ├── best.handler(agent, best.text)    ← *** NO PRE-HOOK ***
    │       │
    │       ├── parseCommandPayload() validates JSON + Zod schema
    │       ├── Role-based permission check (ad-hoc, per-handler)
    │       ├── Handler logic executes
    │       └── agent.sendMessage() with ACK/error
    │
    └── detectUnknownCommands()
```

### Key Files

| File | Role | Lines |
|------|------|-------|
| `CommandDispatcher.ts` | Buffer management, pattern scan, dispatch loop | L100-167 |
| `commands/types.ts` | `CommandEntry`, `CommandHandlerContext` interfaces | Full file |
| `commands/AgentLifecycle.ts` | CREATE_AGENT, DELEGATE, TERMINATE handlers | L32-513 |
| `commands/CoordCommands.ts` | LOCK_FILE, UNLOCK_FILE, COMMIT, DECISION | Full file |
| `commands/TaskCommands.ts` | DECLARE_TASKS, COMPLETE_TASK, DAG management | Full file |
| `commands/commandSchemas.ts` | Zod schemas + `parseCommandPayload()` helper | Full file |
| `coordination/FileLockRegistry.ts` | File lock validation (existing proto-hook) | L48-150 |

### Existing Proto-Hooks (ad-hoc validation scattered across handlers)

1. **File lock conflict detection** — `FileLockRegistry.acquire()` blocks conflicting locks
2. **Zod schema validation** — `parseCommandPayload()` rejects malformed payloads
3. **Role-based permission** — `handleCreateAgent` checks `agent.role.id === 'lead'`
4. **Concurrency limit** — `AgentManager.spawn()` blocks beyond `maxConcurrent`
5. **Nested command injection** — `isInsideCommandBlock()` strips nested commands
6. **Dirty file unlock** — git diff check before releasing locks
7. **Path traversal protection** — `validatePath()` blocks `../` in file paths

**The problem**: These are scattered, inconsistent, and not composable. Adding new governance rules (shell command blocklist, rate limiting, approval gates) requires modifying multiple handler files. There's no way for users or plugins to add custom rules.

---

## 2. Hook Pipeline Design

### 2.1 Architecture Overview

```
CommandDispatcher.scanBuffer(agent)
    │
    ├── Pattern match → found command
    ├── Nested check
    │
    ▼
┌──────────────────────────────────────────┐
│  GovernancePipeline.evaluate(action)     │  ← NEW
│                                          │
│  for (hook of sortedHooks) {             │
│    if (hook.match(action))               │
│      result = hook.evaluate(action, ctx) │
│      if (result.decision === 'block')    │
│        → send block message to agent     │
│        → return (command not executed)    │
│      if (result.decision === 'modify')   │
│        → apply modifications to action   │
│  }                                       │
│                                          │
│  // All hooks passed → execute           │
└──────────────────┬───────────────────────┘
                   │
                   ▼
            best.handler(agent, action.rawText)
                   │
                   ▼
┌──────────────────────────────────────────┐
│  GovernancePipeline.afterExecute(action) │  ← NEW (post-hooks)
│                                          │
│  for (hook of postHooks) {               │
│    hook.afterExecute(action, result)     │
│    // Audit logging, metrics, etc.       │
│  }                                       │
└──────────────────────────────────────────┘
```

### 2.2 Design Principles

1. **Single interception point**: All governance runs through `GovernancePipeline` in `CommandDispatcher.scanBuffer()`. No scattered checks.
2. **Composable**: Hooks are registered independently, ordered by priority, and evaluated sequentially.
3. **Fail-open by default**: If no hook blocks, the command executes. Individual hooks can be fail-closed.
4. **Synchronous pre-hooks**: Pre-execution hooks are synchronous (no async/await in the hot path). This is critical — the command dispatch loop processes buffered text and must not block on network calls.
5. **Async post-hooks**: Post-execution hooks can be async (fire-and-forget for audit/notification). They don't block the pipeline.
6. **Observable**: Every hook evaluation emits an event for audit logging.
7. **Existing validation migrated**: File lock checks, permission checks, and concurrency limits become built-in hooks, removing ad-hoc logic from handlers.

### 2.3 Why Synchronous Pre-Hooks (Not Async)

Squad's hooks are synchronous. Edict's review gates are async (the 门下省 is a separate agent call). For Flightdeck, **synchronous pre-hooks are correct** because:

- Commands are parsed from a streaming text buffer. Blocking the scan loop with `await` would stall all command processing for that agent.
- Governance decisions (allow/block/modify) should be deterministic and fast — they're policy checks, not LLM calls.
- If a governance rule needs an async operation (e.g., human approval), it should **block the command and queue it**, not await in the pipeline. See §3.4 for the approval gate pattern.

### 2.4 Hook Priority System

Hooks run in priority order (lower number = runs first):

| Priority | Category | Examples |
|----------|----------|----------|
| 0-99 | **Security** | Path traversal, injection detection |
| 100-199 | **Permission** | Role-based access, capability checks |
| 200-299 | **Validation** | Schema validation, business rules |
| 300-399 | **Rate limiting** | Per-agent command rate limits |
| 400-499 | **Policy** | File write guards, command blocklists |
| 500-599 | **Approval** | Human-in-the-loop gates |
| 900-999 | **Audit** | Post-execution logging (post-hooks only) |

---

## 3. Built-in Hooks to Implement

### 3.1 FileWriteGuardHook (Priority 400)

**Purpose**: Block agents from writing to protected file paths (glob patterns).

```typescript
// Configuration
{
  name: 'file-write-guard',
  protectedPatterns: [
    '.env*',
    '**/*.secret',
    'node_modules/**',
    '.git/**',
    'package-lock.json',
  ],
  // Per-role overrides
  allowedRoles: {
    '.env*': ['lead'],  // Only lead can touch env files
  },
}
```

**Matches**: `LOCK_FILE`, `COMMIT` commands
**Behavior**: If the target file matches a protected glob and the agent's role isn't in the allow list, block with message:
```
[Governance] File write blocked: `.env.production` matches protected pattern `.env*`. Only lead role can modify this file.
```

### 3.2 ShellCommandBlocklistHook (Priority 100)

**Purpose**: Block dangerous shell commands that agents might embed in bash tool calls. Since tool execution happens inside the Copilot CLI subprocess (outside our control), this hook operates on **COMMIT commands** that include shell operations, and as a **post-hook on agent text** to flag violations.

**Important design note**: We cannot intercept bash/tool execution directly — that happens in the Copilot CLI process. This hook targets commands we DO control and provides observability for tool calls we can't block.

```typescript
// Configuration
{
  name: 'shell-command-blocklist',
  blockedPatterns: [
    /rm\s+-rf\s+\/(?!tmp)/,       // rm -rf outside /tmp
    /git\s+push\s+--force/,        // force push
    /git\s+add\s+-A/,              // add all (picks up other agents' work)
    /curl.*\|\s*(?:bash|sh)/,      // pipe to shell
    /pkill|killall/,               // name-based process killing
  ],
}
```

**Matches**: `COMMIT` commands (inspects staged changes), monitors `agent:text` events
**Behavior**: Block COMMIT if staged files contain blocklisted patterns. Flag (warn but don't block) text containing blocklisted shell commands.

### 3.3 RateLimitHook (Priority 300)

**Purpose**: Prevent agents from spamming commands (e.g., rapid-fire AGENT_MESSAGE, excessive CREATE_AGENT).

```typescript
// Configuration
{
  name: 'rate-limit',
  limits: {
    'CREATE_AGENT': { maxPerMinute: 5, maxPerHour: 20 },
    'DELEGATE': { maxPerMinute: 10, maxPerHour: 50 },
    'AGENT_MESSAGE': { maxPerMinute: 30 },
    'BROADCAST': { maxPerMinute: 3 },
    'COMMIT': { maxPerMinute: 5 },
  },
}
```

**Matches**: All commands
**Behavior**: Track command counts per agent with a sliding window. Block when exceeded:
```
[Governance] Rate limit exceeded: CREATE_AGENT (5/min). Wait before creating more agents.
```

### 3.4 ApprovalGateHook (Priority 500)

**Purpose**: Require human approval for high-impact commands.

This is the Flightdeck equivalent of Edict's 门下省 — but instead of a mandatory AI review agent, it's an optional human approval step.

```typescript
// Configuration
{
  name: 'approval-gate',
  requireApproval: {
    'TERMINATE_AGENT': 'always',           // Always require approval
    'RESET_DAG': 'always',                 // Always require approval
    'REQUEST_LIMIT_CHANGE': 'always',      // Already implemented as DECISION
    'CREATE_AGENT': 'when_limit_near',     // When at 80% of maxConcurrent
  },
}
```

**Matches**: Configured commands
**Behavior**: When triggered, the hook:
1. **Blocks** the command immediately
2. Creates a **DECISION** entry with `needsConfirmation: true`
3. Sends the agent a message: `[Governance] This action requires approval. A decision has been created for the user.`
4. When the user approves, the command is **replayed** from a pending queue

**Implementation note**: This requires a `pendingApprovals` queue in the GovernancePipeline. The command's raw text + agent context is stored. On approval, it's re-injected into the dispatcher. On rejection, the agent is notified.

### 3.5 CommitMessageValidationHook (Priority 200)

**Purpose**: Enforce commit message conventions.

```typescript
// Configuration
{
  name: 'commit-message-validation',
  rules: {
    minLength: 10,
    maxLength: 500,
    mustNotContain: [/^fixup!/, /^WIP/i, /^TODO/i],
    // Optional: conventional commits pattern
    // conventionalCommits: true,
  },
}
```

**Matches**: `COMMIT` commands
**Behavior**: Inspect the commit message. Block if it doesn't meet requirements:
```
[Governance] Commit message too short (3 chars). Minimum: 10 characters.
```

### 3.6 PermissionHook (Priority 100) — Migration of existing logic

**Purpose**: Consolidate the scattered role-based permission checks into a single hook.

This **replaces** the ad-hoc checks currently inside `handleCreateAgent`, `handleDelegate`, etc.

```typescript
// Configuration
{
  name: 'permission',
  rules: {
    'CREATE_AGENT': { allowedRoles: ['lead', 'architect'], respectCapabilities: true },
    'DELEGATE': { allowedRoles: ['lead', 'architect'], respectCapabilities: true },
    'TERMINATE_AGENT': { allowedRoles: ['lead'] },
    'RESET_DAG': { allowedRoles: ['lead'] },
    'REQUEST_LIMIT_CHANGE': { allowedRoles: ['lead'] },
    'DECLARE_TASKS': { allowedRoles: ['lead'] },
    'BROADCAST': { allowedRoles: ['lead', 'architect'] },
  },
}
```

**Matches**: Commands with role restrictions
**Behavior**: Check `agent.role.id` against allowed roles, then check `capabilityInjector.hasCommand()` for acquired capabilities. Block if neither matches.

---

## 4. Hook Interface / Type Definitions

```typescript
// ── File: packages/server/src/governance/types.ts ──

import type { Agent } from '../agents/Agent.js';

/**
 * The action being evaluated — represents a parsed command
 * before it's dispatched to its handler.
 */
export interface GovernanceAction {
  /** Command name, e.g. 'CREATE_AGENT', 'LOCK_FILE', 'COMMIT' */
  commandName: string;
  /** The raw matched text including ⟦⟦ ... ⟧⟧ delimiters */
  rawText: string;
  /** Parsed JSON payload (if parseable), or null */
  payload: Record<string, unknown> | null;
  /** The agent that issued the command */
  agent: Readonly<{
    id: string;
    roleId: string;
    roleName: string;
    status: string;
    dagTaskId?: string;
  }>;
  /** Timestamp of the command */
  timestamp: number;
}

/**
 * Context available to hooks for making decisions.
 */
export interface HookContext {
  /** Look up any agent by ID */
  getAgent(id: string): Agent | undefined;
  /** All currently running agents */
  getAllAgents(): Agent[];
  /** Current count of running agents */
  getRunningCount(): number;
  /** Max concurrent agent limit */
  maxConcurrent: number;
  /** File lock registry for checking lock state */
  lockRegistry: Readonly<{
    getLocksForAgent(agentId: string): Array<{ filePath: string }>;
    isLocked(filePath: string): boolean;
  }>;
  /** Task DAG for checking task state */
  taskDAG: Readonly<{
    getTasks(leadId: string): Array<{ id: string; status: string }>;
  }>;
  /** Project ID for the agent, if available */
  projectId?: string;
}

/**
 * Result of a hook evaluation.
 */
export type HookDecision = 'allow' | 'block' | 'modify';

export interface HookResult {
  decision: HookDecision;
  /** Human-readable reason (shown to agent when blocked) */
  reason?: string;
  /** Modified payload (only when decision === 'modify') */
  modifiedPayload?: Record<string, unknown>;
  /** Modified raw text (only when decision === 'modify') */
  modifiedText?: string;
  /** Metadata for audit logging */
  meta?: Record<string, unknown>;
}

/**
 * Pre-execution hook — evaluated BEFORE the command handler runs.
 * Must be synchronous (no async) to avoid blocking the dispatch loop.
 */
export interface PreActionHook {
  /** Unique hook name */
  name: string;
  /** Priority (lower runs first). See §2.4 for ranges. */
  priority: number;
  /** Fast check: does this hook apply to this action? */
  match(action: GovernanceAction): boolean;
  /** Evaluate the action. Must be synchronous. */
  evaluate(action: GovernanceAction, context: HookContext): HookResult;
}

/**
 * Post-execution hook — runs AFTER the command handler completes.
 * May be async (fire-and-forget, does not block pipeline).
 */
export interface PostActionHook {
  /** Unique hook name */
  name: string;
  /** Priority (lower runs first) */
  priority: number;
  /** Fast check: does this hook apply to this action? */
  match(action: GovernanceAction): boolean;
  /** Post-execution callback. May be async. */
  afterExecute(action: GovernanceAction, context: HookContext): void | Promise<void>;
}

/**
 * Configuration for the governance pipeline.
 * Can be loaded from server config or provided programmatically.
 */
export interface GovernancePipelineConfig {
  /** Enable/disable the entire pipeline (default: true) */
  enabled: boolean;
  /** File write guard configuration */
  fileWriteGuard?: {
    protectedPatterns: string[];
    allowedRoles?: Record<string, string[]>;
  };
  /** Shell command blocklist */
  shellBlocklist?: {
    blockedPatterns: Array<string | RegExp>;
  };
  /** Rate limiting */
  rateLimits?: Record<string, { maxPerMinute?: number; maxPerHour?: number }>;
  /** Approval gates */
  approvalGates?: Record<string, 'always' | 'when_limit_near'>;
  /** Commit message validation */
  commitValidation?: {
    minLength?: number;
    maxLength?: number;
    mustNotContain?: Array<string | RegExp>;
  };
  /** Permission overrides (extend default role-based rules) */
  permissionOverrides?: Record<string, { allowedRoles: string[]; respectCapabilities?: boolean }>;
}
```

```typescript
// ── File: packages/server/src/governance/GovernancePipeline.ts ──

import type { Agent } from '../agents/Agent.js';
import type {
  GovernanceAction,
  HookContext,
  HookResult,
  PreActionHook,
  PostActionHook,
  GovernancePipelineConfig,
} from './types.js';
import { logger } from '../utils/logger.js';

export class GovernancePipeline {
  private preHooks: PreActionHook[] = [];
  private postHooks: PostActionHook[] = [];
  private enabled: boolean;

  constructor(config?: GovernancePipelineConfig) {
    this.enabled = config?.enabled ?? true;
  }

  /**
   * Register a pre-action hook. Hooks are auto-sorted by priority.
   */
  registerPreHook(hook: PreActionHook): void {
    this.preHooks.push(hook);
    this.preHooks.sort((a, b) => a.priority - b.priority);
    logger.info('governance', `Pre-hook registered: ${hook.name} (priority ${hook.priority})`);
  }

  /**
   * Register a post-action hook.
   */
  registerPostHook(hook: PostActionHook): void {
    this.postHooks.push(hook);
    this.postHooks.sort((a, b) => a.priority - b.priority);
    logger.info('governance', `Post-hook registered: ${hook.name} (priority ${hook.priority})`);
  }

  /**
   * Evaluate all pre-hooks for an action.
   * Returns the final decision. Short-circuits on first 'block'.
   * 'modify' results are accumulated and applied sequentially.
   *
   * MUST be synchronous — called from the dispatch loop.
   */
  evaluatePre(action: GovernanceAction, context: HookContext): HookResult {
    if (!this.enabled) return { decision: 'allow' };

    for (const hook of this.preHooks) {
      if (!hook.match(action)) continue;

      const result = hook.evaluate(action, context);

      logger.debug('governance', `Hook ${hook.name}: ${result.decision} for ${action.commandName}`, {
        agentId: action.agent.id.slice(0, 8),
        reason: result.reason,
      });

      if (result.decision === 'block') {
        logger.info('governance', `BLOCKED by ${hook.name}: ${action.commandName} from ${action.agent.roleId}`, {
          reason: result.reason,
        });
        return {
          decision: 'block',
          reason: `[Governance: ${hook.name}] ${result.reason || 'Action blocked by policy'}`,
          meta: { hook: hook.name, ...result.meta },
        };
      }

      if (result.decision === 'modify' && result.modifiedText) {
        action = { ...action, rawText: result.modifiedText };
        if (result.modifiedPayload) {
          action = { ...action, payload: result.modifiedPayload };
        }
      }
    }

    return { decision: 'allow' };
  }

  /**
   * Run all post-hooks (fire-and-forget).
   */
  runPost(action: GovernanceAction, context: HookContext): void {
    if (!this.enabled) return;

    for (const hook of this.postHooks) {
      if (!hook.match(action)) continue;
      try {
        const result = hook.afterExecute(action, context);
        if (result instanceof Promise) {
          result.catch((err) => {
            logger.error('governance', `Post-hook ${hook.name} error: ${(err as Error).message}`);
          });
        }
      } catch (err) {
        logger.error('governance', `Post-hook ${hook.name} error: ${(err as Error).message}`);
      }
    }
  }

  /** Get all registered hook names (for diagnostics) */
  getRegisteredHooks(): { pre: string[]; post: string[] } {
    return {
      pre: this.preHooks.map((h) => `${h.name} (${h.priority})`),
      post: this.postHooks.map((h) => `${h.name} (${h.priority})`),
    };
  }
}
```

---

## 5. Files to Create / Modify

### New Files

| File | Purpose |
|------|---------|
| `packages/server/src/governance/types.ts` | Type definitions (§4) |
| `packages/server/src/governance/GovernancePipeline.ts` | Core pipeline class (§4) |
| `packages/server/src/governance/index.ts` | Barrel export |
| `packages/server/src/governance/hooks/FileWriteGuardHook.ts` | §3.1 |
| `packages/server/src/governance/hooks/ShellCommandBlocklistHook.ts` | §3.2 |
| `packages/server/src/governance/hooks/RateLimitHook.ts` | §3.3 |
| `packages/server/src/governance/hooks/ApprovalGateHook.ts` | §3.4 |
| `packages/server/src/governance/hooks/CommitMessageValidationHook.ts` | §3.5 |
| `packages/server/src/governance/hooks/PermissionHook.ts` | §3.6 |
| `packages/server/src/governance/hooks/index.ts` | Barrel export for built-in hooks |
| `packages/server/src/governance/__tests__/GovernancePipeline.test.ts` | Pipeline unit tests |
| `packages/server/src/governance/__tests__/hooks.test.ts` | Built-in hook unit tests |

### Files to Modify

| File | Change | Complexity |
|------|--------|------------|
| **`CommandDispatcher.ts`** | Inject `GovernancePipeline.evaluatePre()` before `best.handler()` call (L130-132). Inject `GovernancePipeline.runPost()` after handler completes. Add `GovernancePipeline` as constructor dependency. | **Medium** — ~30 lines changed |
| **`commands/types.ts`** | Add `governancePipeline?: GovernancePipeline` to `CommandContext` interface | **Trivial** — 1 line |
| **`AgentManager.ts`** | Instantiate `GovernancePipeline`, register built-in hooks, pass to `CommandDispatcher` constructor | **Small** — ~20 lines |
| **`commands/AgentLifecycle.ts`** | Remove ad-hoc permission check from `handleCreateAgent` (L60-66) — replaced by PermissionHook | **Small** — delete ~10 lines |
| **`commands/CoordCommands.ts`** | Remove ad-hoc file write checks that are now handled by hooks (optional — can coexist during migration) | **Small** |
| **`config.ts`** | Add `governance` section to `ServerConfig` for hook configuration | **Small** — ~15 lines |

### Integration Point in CommandDispatcher (the key change)

```typescript
// CommandDispatcher.ts, inside scanBuffer(), replacing L129-139:

} else {
  // ── Governance pre-hook evaluation ──
  const action: GovernanceAction = {
    commandName: best.name,
    rawText: best.text,
    payload: this.tryParsePayload(best.text),
    agent: {
      id: agent.id,
      roleId: agent.role.id,
      roleName: agent.role.name,
      status: agent.status,
      dagTaskId: agent.dagTaskId,
    },
    timestamp: Date.now(),
  };

  const hookResult = this.governance.evaluatePre(action, this.buildHookContext());

  if (hookResult.decision === 'block') {
    logger.info('governance', `Command ${best.name} blocked for ${agent.role.name}`);
    agent.sendMessage(hookResult.reason || `[Governance] ${best.name} blocked by policy.`);
  } else {
    // Execute the handler (with potentially modified text from 'modify' hooks)
    const textToExecute = hookResult.decision === 'modify' && hookResult.modifiedText
      ? hookResult.modifiedText
      : best.text;
    
    logger.debug('agent', `Command: ${best.name} from ${agent.role.name} (${agent.id.slice(0, 8)})`);
    try {
      best.handler(agent, textToExecute);
    } catch (err) {
      const errMsg = (err as Error).message;
      logger.error('command', `Handler error for ${best.name}: ${errMsg}`);
      agent.sendMessage(`[System] ${best.name} failed: ${errMsg}`);
    }

    // Post-hooks (fire-and-forget)
    this.governance.runPost(action, this.buildHookContext());
  }

  buf = buf.slice(0, best.index) + buf.slice(best.end);
  found = true;
}
```

---

## 6. Testing Strategy

### 6.1 Unit Tests: GovernancePipeline

```typescript
// packages/server/src/governance/__tests__/GovernancePipeline.test.ts

describe('GovernancePipeline', () => {
  describe('evaluatePre', () => {
    it('returns allow when no hooks registered', () => { ... });
    it('returns allow when no hooks match', () => { ... });
    it('returns block when a hook blocks', () => { ... });
    it('short-circuits on first block (skips remaining hooks)', () => { ... });
    it('runs hooks in priority order', () => { ... });
    it('accumulates modify results', () => { ... });
    it('returns allow when disabled', () => { ... });
    it('includes hook name in block reason', () => { ... });
  });

  describe('runPost', () => {
    it('runs all matching post-hooks', () => { ... });
    it('continues on post-hook errors', () => { ... });
    it('handles async post-hooks', () => { ... });
  });

  describe('registration', () => {
    it('sorts pre-hooks by priority on register', () => { ... });
    it('sorts post-hooks by priority on register', () => { ... });
    it('getRegisteredHooks returns all hooks', () => { ... });
  });
});
```

### 6.2 Unit Tests: Built-in Hooks

```typescript
// packages/server/src/governance/__tests__/hooks.test.ts

describe('FileWriteGuardHook', () => {
  it('blocks LOCK_FILE on protected patterns', () => { ... });
  it('allows LOCK_FILE on non-protected files', () => { ... });
  it('respects role-based overrides', () => { ... });
  it('does not match non-file commands', () => { ... });
  it('handles glob patterns correctly', () => {
    // Test: '**/*.secret' matches 'config/db.secret'
    // Test: '.env*' matches '.env.production'
    // Test: 'src/**' does NOT match 'test/foo.ts'
  });
});

describe('RateLimitHook', () => {
  it('allows commands within rate limit', () => { ... });
  it('blocks when per-minute limit exceeded', () => { ... });
  it('blocks when per-hour limit exceeded', () => { ... });
  it('tracks per-agent independently', () => { ... });
  it('sliding window resets correctly', () => { ... });
  it('does not rate-limit commands without configured limits', () => { ... });
});

describe('PermissionHook', () => {
  it('blocks non-lead CREATE_AGENT', () => { ... });
  it('allows lead CREATE_AGENT', () => { ... });
  it('allows architect CREATE_AGENT', () => { ... });
  it('allows capability-acquired CREATE_AGENT', () => { ... });
  it('does not check permissions for unrestricted commands', () => { ... });
});

describe('CommitMessageValidationHook', () => {
  it('blocks short commit messages', () => { ... });
  it('blocks messages matching mustNotContain', () => { ... });
  it('allows valid commit messages', () => { ... });
});

describe('ShellCommandBlocklistHook', () => {
  it('flags git add -A in agent text', () => { ... });
  it('flags rm -rf / patterns', () => { ... });
  it('allows safe commands', () => { ... });
});

describe('ApprovalGateHook', () => {
  it('blocks TERMINATE_AGENT and creates decision', () => { ... });
  it('blocks RESET_DAG and creates decision', () => { ... });
  it('allows CREATE_AGENT when under limit', () => { ... });
  it('blocks CREATE_AGENT when near limit (when_limit_near)', () => { ... });
  it('replays command on approval', () => { ... });
  it('notifies agent on rejection', () => { ... });
});
```

### 6.3 Integration Tests

```typescript
describe('CommandDispatcher + GovernancePipeline integration', () => {
  it('blocks a command before handler is called', () => {
    // Register a hook that blocks CREATE_AGENT
    // Feed CREATE_AGENT text to dispatcher
    // Verify: handler NOT called, agent receives block message
  });

  it('allows a command when all hooks pass', () => {
    // Register a hook that allows everything
    // Feed DELEGATE text to dispatcher
    // Verify: handler IS called, no block message
  });

  it('modifies command text before handler', () => {
    // Register a hook that modifies payload
    // Verify: handler receives modified text
  });

  it('runs post-hooks after execution', () => {
    // Register a post-hook that records to ActivityLedger
    // Verify: ledger entry created after handler runs
  });

  it('existing commands still work with pipeline enabled', () => {
    // Regression: run through each command type
    // Verify: no breakage from pipeline insertion
  });
});
```

### 6.4 Test Priorities

| Phase | Scope | Tests | Goal |
|-------|-------|-------|------|
| **Phase 1** | GovernancePipeline core + PermissionHook | ~15 tests | Validate pipeline mechanics, migrate existing permission checks |
| **Phase 2** | FileWriteGuardHook + RateLimitHook + CommitValidation | ~20 tests | Core governance features |
| **Phase 3** | ApprovalGateHook + Integration tests | ~15 tests | Async approval flow, end-to-end validation |

---

## 7. Implementation Order

1. **Create `governance/types.ts`** — type definitions
2. **Create `governance/GovernancePipeline.ts`** — core pipeline
3. **Modify `CommandDispatcher.ts`** — inject pipeline at dispatch point
4. **Create `governance/hooks/PermissionHook.ts`** — migrate existing permission logic
5. **Remove ad-hoc permission checks** from AgentLifecycle.ts
6. **Write Phase 1 tests** — validate pipeline + permission hook
7. **Create remaining built-in hooks** (FileWriteGuard, RateLimit, CommitValidation)
8. **Write Phase 2 tests**
9. **Create ApprovalGateHook** — requires pending queue integration
10. **Write Phase 3 tests + integration tests**

---

## 8. Open Questions

1. **Configuration persistence**: Should hook configuration be in `ServerConfig` (static) or loaded from a governance config file that can be hot-reloaded? Recommendation: Start with `ServerConfig`, add hot-reload later.

2. **Per-project hooks**: Should hooks be configurable per-project (different governance for different repos)? Recommendation: Not in v1. Use the `projectId` in `HookContext` to enable this later.

3. **User-defined hooks**: Should users be able to register custom hooks via the API? Recommendation: Not in v1. The `registerPreHook`/`registerPostHook` API supports this, but exposing it requires a plugin system.

4. **Approval gate replay**: When a user approves a gated command, how is it replayed? Recommendation: Store the raw text + agent ID in a `pendingApprovals` map. On approval, call `dispatcher.replayCommand(agentId, rawText)`. On rejection, send the agent a message.

5. **Metrics**: Should hook evaluations emit metrics (e.g., blocks per hook per hour)? Recommendation: Yes, as a post-hook that logs to ActivityLedger. This is free with the post-hook system.
