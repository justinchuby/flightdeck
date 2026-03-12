# Agent Coordination

How agents avoid stepping on each other's work.

> [!TIP] TL;DR
> Multiple agents share one codebase safely through **file locking** (only one agent edits a file at a time), **scoped commits** (agents only commit files they've locked), and **context refresh** (agents get updated on what their teammates are doing). Think of it like a shared Google Doc where each person locks the section they're editing.

## Problem

Multiple AI agents working on the same codebase can:
- Edit the same file simultaneously, causing conflicts
- Duplicate work by tackling the same problem
- Make contradictory decisions without knowing what others decided
- Overwhelm the system by spawning too many sub-agents

## Solution: Multi-Layer Defense

Agent isolation and conflict prevention is implemented as a layered defense:

| Layer | Mechanism | Status | Description |
|-------|-----------|--------|-------------|
| **L1** | Worktree Isolation | ⚠️ In Development | Per-agent git worktrees give each agent its own branch and working directory |
| **L2** | Scoped COMMIT | ✅ Active | `COMMIT` handler executes `git add` only on locked files + post-commit verification |
| **L3** | Merge Scope Validation | ✅ Active (depends on L1) | `WorktreeManager.merge()` validates only locked files were modified before merging |
| **L4** | File Locking | ✅ Active | Pessimistic locks prevent concurrent edits to the same file |
| **L5** | Activity Ledger | ✅ Active | Shared log of all agent actions for awareness and dedup |
| **L6** | Context Refresh | ✅ Active | Push crew state to agents on significant events |

### Worktree Isolation (In Development)

> ⚠️ **Status: Implemented in backend, not yet enabled.** The `WorktreeManager` class is fully implemented and wired into the agent lifecycle (`AgentManager.spawn()` → `create()`, `terminate()` → `merge()` + `cleanup()`). However, worktree creation depends on the agent's environment having a proper git setup, which isn't guaranteed in all deployment contexts (e.g., `npm install` may need to run per-worktree). **Agents currently share the repository working directory.**

When enabled, worktree isolation provides:

- **Per-agent branches** — Each agent gets its own git branch (`agent/<agentId>`) and worktree directory
- **Independent work** — Agents can stage, commit, and modify files without affecting each other
- **Merge-back** — On agent termination, changes are merged back to the integration branch
- **Conflict detection** — Merge conflicts are detected and logged (not auto-resolved)
- **Orphan cleanup** — On server startup, stale worktrees from previous crashes are cleaned up
- **Fallback** — If worktree creation fails, the agent falls back to the shared working directory

**Implementation:** `packages/server/src/coordination/WorktreeManager.ts`

### Layer 1: File Locking

SQLite-backed mutual exclusion on file paths.

```
Agent A: ⟦⟦ LOCK_FILE {"filePath": "src/auth.ts", "reason": "implementing login"} ⟧⟧
System:  Lock acquired ✓

Agent B: ⟦⟦ LOCK_FILE {"filePath": "src/auth.ts", "reason": "fixing bug"} ⟧⟧
System:  Lock denied — held by Agent A (expires in 4m30s)

Agent A: ⟦⟦ UNLOCK_FILE {"filePath": "src/auth.ts"} ⟧⟧
System:  Lock released ✓
```

**Key behaviors:**
- **TTL**: Locks expire after 300 seconds (5 minutes) by default to prevent deadlocks
- **Glob support**: Locking `src/auth/*` blocks `src/auth/login.ts`, `src/auth/session.ts`, etc.
- **Auto-cleanup**: Expired locks are cleaned before each acquire operation
- **Agent exit**: All locks released when an agent exits (`releaseAll`)
- **Same-agent refresh**: An agent can re-acquire its own lock (refreshes TTL)
- **Expiry notifications**: When a lock's TTL expires, the server emits a `lock:expired` event. The owning agent receives a system message: _"Your file lock on X has expired."_ This ensures agents know they've lost exclusivity. `cleanExpired()` returns the full `FileLock[]` array of expired locks with file path, agent ID, and role for downstream processing.

**Schema:**
```sql
CREATE TABLE file_locks (
  file_path TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  reason TEXT DEFAULT '',
  acquired_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
```

**API:**
```
GET  /api/coordination/locks          — list all active locks
POST /api/coordination/locks          — acquire: { agentId, filePath, reason? }
DELETE /api/coordination/locks/:path  — release: ?agentId=...
```

### Layer 1b: Scoped COMMIT (with Post-Commit Verification)

The `COMMIT` command **executes** a scoped git commit server-side and verifies the result — it doesn't just suggest a command.

```
⟦⟦ COMMIT {"message": "feat: add login endpoint"} ⟧⟧
```

**How it works:**
1. Reads the agent's current file locks from `FileLockRegistry`
2. Shell-quotes each file path (handles spaces and special characters)
3. Executes `git add <locked-files> && git commit -m '<message>'` in the agent's cwd (worktree or shared)
4. **Post-commit verification (A6):** Runs `git diff --name-only HEAD~1` and compares committed files against expected locked files
5. Warns the agent if expected files are missing from the commit
6. Logs to ActivityLedger **only** on successful, verified commit — not before

**Verification example:**
```
[System] COMMIT succeeded: abc1234 feat: add login endpoint
[System] Warning: 1 expected file(s) not found in commit: src/utils.ts
```

**Safety properties:**
- Prevents `git add -A` which could stage other agents' changes
- Verification is best-effort — if `git diff` fails, the commit is not blocked
- Activity ledger only records verified commits (moved from synchronous pre-log to async post-verify)

### Layer 1c: Task Dedup Detection

When a lead delegates a task, `findSimilarActiveDelegation()` checks for overlapping work using word-overlap similarity (>50% match, words >2 chars, stop-word removal). If a similar active delegation exists, the lead receives an advisory warning — the delegation proceeds but the lead is informed of potential duplication.

### Layer 2: Activity Ledger

Append-only log of all agent actions, providing a shared "memory" of what's happened. Writes are **batched** for performance — entries are buffered in memory and flushed to SQLite every **250ms** or when the buffer reaches **64 entries**, whichever comes first. Read operations (`getRecent`, `getSummary`) flush the buffer first to guarantee read-after-write consistency. The ledger has a `stop()` method for graceful shutdown that flushes remaining entries and clears the timer.

**Action types:**
| Type | When logged |
|------|------------|
| `file_edit` | Agent modifies a file |
| `file_read` | Agent reads a file |
| `decision_made` | Agent makes a significant choice |
| `task_started` | Agent begins working on a task |
| `task_completed` | Agent finishes a task |
| `sub_agent_spawned` | Agent creates a child agent |
| `lock_acquired` | File lock taken |
| `lock_released` | File lock freed |
| `message_sent` | Inter-agent message (includes `toAgentId`, `toRole` in details) |
| `delegated` | Task delegated to another agent (includes `toAgentId`, `toRole`) |
| `agent_terminated` | Agent terminated (includes `toAgentId`, `toRole`) |
| `delegation_cancelled` | Delegation cancelled (includes `toAgentId`, `toRole`) |
| `group_message` | Group chat message sent |
| `error` | Something went wrong |

**Schema:**
```sql
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  action_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT DEFAULT '{}',  -- JSON
  timestamp TEXT DEFAULT (datetime('now'))
);
```

Bounded to 10,000 entries (auto-pruned).

**API:**
```
GET /api/coordination/activity   — ?agentId=&type=&limit=&since=
GET /api/coordination/summary    — aggregate stats
```

### Layer 3: Context Refresh

Context updates are pushed to all running agents on significant events (not on a periodic timer, to avoid wasting tokens on idle heartbeats).

The peer list is built by `buildPeerList()` in `ContextRefresher.ts`, which maps each agent to an `AgentContextInfo` object including `id`, `role`, `roleName`, `status`, `task`, `parentId`, `model`, and `lockedFiles`. The `parentId` and `model` fields are essential for the YOUR AGENTS / OTHER CREW classification in the lead's context — without them, Agent.ts cannot determine parent-child relationships.

For the **Project Lead**, the update includes a **health header** followed by the agent roster:
```
<!-- CREW_UPDATE
== PROJECT HEALTH ==
✅ 78% complete · 3 active, 2 idle, 1 done · ⚠️ 1 decision pending (3 min)
0 blocked tasks

== YOUR AGENTS ==
- abc12345 — Developer [claude-opus-4.6] — running, task: Implement login endpoint
- def67890 — Code Reviewer [gemini-3-pro-preview] — idle

== RECENT ACTIVITY ==
- [13:45:02] Developer abc12345: Acquired lock on src/auth.ts
- [13:44:58] Architect ghi11111: Decision — use JWT for session tokens
CREW_UPDATE -->
```

The health header is computed by `buildHealthHeader()` in `ContextRefresher.ts`:
- **Completion %** — `(done + skipped) / total` from the task DAG (if one exists)
- **Agent fleet** — Counts of active, idle, and completed agents
- **Pending decisions** — Count + age of oldest pending decision
- **Blocked/failed tasks** — From DAG status
- **Health icon** — 🔴 critical (blocked/failed tasks), ⚠️ warning (pending decisions or many idle agents), ✅ healthy

For **specialist agents**, the update shows peer agents with locked files:
```
<!-- CREW_UPDATE
== CURRENT CREW STATUS ==
- Agent abc12345 (Developer) — running, Task: impl-login, Locked: src/auth.ts
- Agent def67890 (Reviewer) — idle, No task

== RECENT ACTIVITY ==
- [13:44:30] QA jkl22222: Completed task write-auth-tests
CREW_UPDATE -->
```

**Triggers for refresh:**
- Agent spawned, terminated, or exited
- File lock acquired or released
- **Context compaction** — when Copilot CLI compacts an agent's context window (`agent:context_compacted` event), the `ContextRefresher` immediately re-injects the crew context (team roster, active delegations, coordination rules) into the affected agent so it doesn't lose awareness of its team after compaction
- Debounced at 2 seconds to batch rapid events

**Content deduplication:** Each update is hashed (MD5 of stable content — crew status + budget, excluding timestamps). If the hash matches the previous update for that agent, the injection is skipped. This reduces token waste by 40–60% during periods when only activity timestamps change but the actual crew state is unchanged.

## Task Assignment & Auto-Spawn

When a task is created in the queue:

1. **Find free agent**: Look for a running agent with no current task, matching the task's `assignedRole` if specified
2. **Auto-spawn**: If no free agent exists and under the concurrency limit, spawn a new agent with the appropriate role (defaults to `developer`)
3. **Assign and prompt**: Set task to `in_progress`, assign agent ID, send the task details as a formatted prompt

Auto-assignment also triggers when a new agent is spawned (after 2s initialization delay) or when an agent exits.

## Concurrency Control

- **Max concurrent agents**: Configurable at runtime via Settings UI slider (1–20) or `MAX_AGENTS` env var
- **Enforced at spawn**: `AgentManager.spawn()` throws if limit reached
- **Auto-spawn respects limit**: Task auto-assignment skips spawning if at capacity

## Crash Recovery

When an agent exits with a non-zero code:
1. Logged to ActivityLedger as `error`
2. `agent:crashed` event broadcast to UI (toast notification)
3. If `autoRestart` enabled (default: yes) and under 3 restarts for this role+task:
   - Wait 2 seconds
   - Spawn replacement agent with same role and task
   - `agent:auto_restarted` event broadcast
4. If restart limit hit: `agent:restart_limit` event (user notified, no more retries)

Crash count is tracked per `roleId:taskId` combination to avoid infinite loops.

## Cascade Termination

When a lead agent is terminated, all its child agents are also terminated recursively. The implementation uses a **visited-set guard** to prevent infinite loops if there are circular parent-child references:

```typescript
terminate(agentId: string, visited = new Set<string>()) {
  if (visited.has(agentId)) return; // prevent cycles
  visited.add(agentId);
  // terminate children recursively, passing the visited set
  for (const child of this.getChildren(agentId)) {
    this.terminate(child.id, visited);
  }
  // terminate the agent itself
}
```

On termination:
- The agent's status is set to `'terminated'` (distinct from `'exited'` which indicates normal completion)
- All file locks held by the agent are released
- The `isTerminalStatus()` helper returns true for `completed`, `failed`, and `terminated` — used in 6+ call sites for consistent status checks

## Event Pipeline

The `EventPipeline` (`packages/server/src/coordination/EventPipeline.ts`) provides reactive event processing — auto-trigger actions when specific events occur in the system.

**How it works:**
1. Handlers are registered with an event type filter
2. When `ActivityLedger.logAction()` records an event, it also emits to the pipeline
3. Matching handlers execute asynchronously

**Built-in handlers:**
- On `commit` events — auto-queue test runs (`npm test`)
- On `task_completed` events — log summary for the lead

**Safety:**
- Queue bounded to 10,000 events (drops oldest on overflow with warning)
- Error isolation — one handler's failure doesn't affect others
- Async execution — handlers don't block the main event loop

## Proactive Alert Engine

The `AlertEngine` (`packages/server/src/coordination/AlertEngine.ts`) runs on a 60-second interval and detects conditions that need attention:

| Alert Type | Threshold | Severity | Status |
|------------|-----------|----------|--------|
| `stuck_agent` | Running 10+ minutes with no activity | warning | **Disabled** — early return in `checkStuckAgents()`. Too noisy for long-running sessions. Code preserved for re-enabling. |
| `context_pressure` | Context usage >85% | warning (85–95%), critical (>95%) | Active |
| `duplicate_file_edit` | Multiple agents locking same file | warning | Active |
| `idle_agents_ready_tasks` | Idle agents while DAG has ready tasks | info | Active |
| `stale_decision` | Pending decisions >10 minutes old | warning | Active |

**Prompting timeout:** When stuck detection is re-enabled, agents with active LLM calls (`isPrompting`) are skipped — but only if the call started less than 30 minutes ago. The `promptingStartedAt` timestamp (tracked in `AcpConnection`, exposed via `Agent.ts`) prevents hung LLM calls from masking genuinely stuck agents.

**API:** `GET /api/coordination/alerts` — Returns current alert array

**WebSocket:** `alert:new` event broadcast when a new alert fires

**Storage:** Ring buffer of 100 alerts in memory (no persistence needed — alerts are ephemeral)

**Dedup:** Same alert type + agent ID won't fire repeatedly within one check interval

## Generic Scheduler

Background maintenance tasks are managed by the `Scheduler` class (`packages/server/src/utils/Scheduler.ts`). Tasks are registered with an ID, interval, and async callback. The scheduler runs each task on a `setInterval` and catches errors so one failing task doesn't affect others.

**Registered tasks:**

| Task ID | Interval | Purpose |
|---------|----------|---------|
| `expired-lock-cleanup` | 60 seconds | Runs `FileLockRegistry.cleanExpired()` to remove locks past their TTL and notify affected agents |
| `activity-log-pruning` | 1 hour | Trims the activity log to the 10,000-entry cap, deleting oldest entries |

**API:**
- `register(task: ScheduledTask)` — registers (or replaces) a task with `{ id, interval, run }`
- `unregister(id: string)` — stops and removes a task by ID
- `stop()` — clears all tasks (called during graceful server shutdown)
- `getRegistered()` — returns array of active task IDs
