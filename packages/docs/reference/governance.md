# Governance Pipeline

Two-phase hook pipeline that intercepts all agent commands before and after execution (`packages/server/src/governance/GovernancePipeline.ts`).

## Overview

- Pre-execution hooks run synchronously before command dispatch
- Post-execution hooks run asynchronously after command completes (fire-and-forget)
- Hooks are sorted by priority (lower number = runs first)
- Decisions: `allow` (continue), `block` (stop with reason), `modify` (alter payload)
- Fail-open design: hook errors are logged but don't crash the pipeline

## Priority Ranges

| Range | Domain | Purpose |
|-------|--------|---------|
| 0–99 | Security | Dangerous pattern blocking |
| 100–199 | Permission | Role-based access control |
| 200–299 | Validation | Command format/content checks |
| 300–399 | Rate Limiting | Spam/flood prevention |
| 400–499 | Policy | Business logic enforcement |
| 500–599 | Approval | Human approval gates |

## Built-in Hooks

### ShellCommandBlocklistHook (Priority: 100)

**File:** `packages/server/src/governance/hooks/ShellCommandBlocklistHook.ts`

Blocks dangerous shell patterns in command text. Matches all commands.

**Blocked patterns:** `rm -rf /` (outside `/tmp`), `git push --force`, `git add -A`, `curl|bash` piping, `pkill`/`killall`

**Config:**

```typescript
{
  blockedPatterns?: Array<string | RegExp>;
}
```

### PermissionHook (Priority: 100)

**File:** `packages/server/src/governance/hooks/PermissionHook.ts`

Role-based command permissions. Matches commands with defined permission rules. Supports capability system overrides (`ACQUIRE_CAPABILITY`).

**Default rules:**

| Command | Allowed Roles |
|---------|---------------|
| `CREATE_AGENT` | lead, architect |
| `DELEGATE` | lead, architect |
| `TERMINATE_AGENT` | lead only |
| `RESET_DAG` | lead only |
| `REQUEST_LIMIT_CHANGE` | lead only |
| `DECLARE_TASKS` | lead only |
| `BROADCAST` | lead, architect |

**Config:**

```typescript
{
  rules?: Record<string, {
    allowedRoles: string[];
    respectCapabilities?: boolean;
  }>;
  hasCapability?: (agentId: string, cmd: string) => boolean;
}
```

### CommitMessageValidationHook (Priority: 200)

**File:** `packages/server/src/governance/hooks/CommitMessageValidationHook.ts`

Enforces commit message quality. Matches `COMMIT` commands only.

**Validates:** min length (10), max length (500), banned patterns (`fixup!`, `WIP`, `TODO`)

**Config:**

```typescript
{
  minLength?: number;
  maxLength?: number;
  mustNotContain?: Array<string | RegExp>;
}
```

### RateLimitHook (Priority: 300)

**File:** `packages/server/src/governance/hooks/RateLimitHook.ts`

Sliding window rate limiting per agent per command. Matches commands with defined rate limits.

**Default limits:**

| Command | Per Minute | Per Hour |
|---------|-----------|----------|
| `CREATE_AGENT` | 5 | 20 |
| `DELEGATE` | 10 | 50 |
| `AGENT_MESSAGE` | 30 | — |
| `BROADCAST` | 3 | — |
| `COMMIT` | 5 | — |

**Config:**

```typescript
{
  limits?: Record<string, {
    maxPerMinute?: number;
    maxPerHour?: number;
  }>;
}
```

### FileWriteGuardHook (Priority: 400)

**File:** `packages/server/src/governance/hooks/FileWriteGuardHook.ts`

Prevents writes to protected paths. Matches `LOCK_FILE` and `COMMIT` commands.

**Protected patterns (glob):** `.env*`, `**/*.secret`, `node_modules/**`, `.git/**`, `package-lock.json`

**Config:**

```typescript
{
  protectedPatterns?: string[];
  allowedRoles?: Record<string, string[]>;
}
```

### ApprovalGateHook (Priority: 500)

**File:** `packages/server/src/governance/hooks/ApprovalGateHook.ts`

Human approval for high-impact commands. Matches commands with defined gates.

**Default gates:**

| Command | Condition |
|---------|-----------|
| `TERMINATE_AGENT` | Always require approval |
| `RESET_DAG` | Always require approval |
| `REQUEST_LIMIT_CHANGE` | Always require approval |
| `CREATE_AGENT` | When agent count > 80% of max |

**Methods:** `getPending()`, `approve(id)`, `reject(id)`

**Config:**

```typescript
{
  requireApproval?: Record<string, 'always' | 'when_limit_near'>;
  limitThreshold?: number;
  onGate?: (action: string, reason: string) => void;
}
```

## Trust Presets

Three oversight levels that map to auto-approval behavior for decision categories.

### Conservative (highest oversight)

| Category | Action |
|----------|--------|
| style | allow |
| testing | require-review |
| dependency | require-review |
| tool_access | require-review |
| architecture | require-review |
| general | require-review |

### Moderate (balanced)

| Category | Action |
|----------|--------|
| style | allow |
| testing | allow |
| dependency | alert |
| tool_access | allow |
| architecture | require-review |
| general | allow |

### Autonomous (maximum agent freedom)

| Category | Action |
|----------|--------|
| style | allow |
| testing | allow |
| dependency | alert |
| tool_access | allow |
| architecture | alert |
| general | allow |

**Intent actions:**

| Action | Behavior |
|--------|----------|
| `allow` | Auto-approve immediately (60s timer) |
| `alert` | Auto-approve but notify user |
| `require-review` | Queue for human approval |

## Decision Categories

Six categories classify agent decisions: `style`, `architecture`, `tool_access`, `dependency`, `testing`, `general`.

Each is matched by keywords in the decision text (e.g., "refactor" → `architecture`, "install" → `dependency`). The trust preset determines what happens when a decision in that category is made.

## Adding a New Hook

1. Create a class implementing `PreActionHook` or `PostActionHook`
2. Implement `match(action)` → `boolean` and `evaluate(action, context)` → `HookResult`
3. Set `name` and `priority` (use the priority ranges above)
4. Register with `pipeline.registerPreHook(hook)` or `pipeline.registerPostHook(hook)`
5. Hooks are auto-sorted by priority on registration

**Interfaces:**

```typescript
interface PreActionHook {
  name: string;
  priority: number;
  match(action: GovernanceAction): boolean;
  evaluate(action: GovernanceAction, context: HookContext): HookResult;
}

interface HookResult {
  decision: 'allow' | 'block' | 'modify';
  reason?: string;
  modifiedPayload?: Record<string, unknown>;
  modifiedText?: string;
  meta?: Record<string, unknown>;
}
```

## Integration Point

The pipeline runs inside `CommandDispatcher` (`packages/server/src/agents/CommandDispatcher.ts`). Every parsed command goes through `evaluatePre()` before dispatch. Blocked commands send the reason back to the agent. Modified commands have their text/payload updated before the handler runs. Post-hooks fire after handler completes.
