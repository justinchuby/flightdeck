# Agent Coordination

How agents avoid stepping on each other's work.

## Problem

Multiple AI agents working on the same codebase can:
- Edit the same file simultaneously, causing conflicts
- Duplicate work by tackling the same problem
- Make contradictory decisions without knowing what others decided
- Overwhelm the system by spawning too many sub-agents

## Solution: Three-Layer Coordination

### Layer 1: File Locking

SQLite-backed mutual exclusion on file paths.

```
Agent A: <!-- LOCK_REQUEST {"filePath": "src/auth.ts", "reason": "implementing login"} -->
System:  Lock acquired ✓

Agent B: <!-- LOCK_REQUEST {"filePath": "src/auth.ts", "reason": "fixing bug"} -->
System:  Lock denied — held by Agent A (expires in 4m30s)

Agent A: <!-- LOCK_RELEASE {"filePath": "src/auth.ts"} -->
System:  Lock released ✓
```

**Key behaviors:**
- **TTL**: Locks expire after 300 seconds (5 minutes) by default to prevent deadlocks
- **Glob support**: Locking `src/auth/*` blocks `src/auth/login.ts`, `src/auth/session.ts`, etc.
- **Auto-cleanup**: Expired locks are cleaned before each acquire operation
- **Agent exit**: All locks released when an agent exits (`releaseAll`)
- **Same-agent refresh**: An agent can re-acquire its own lock (refreshes TTL)

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

### Layer 2: Activity Ledger

Append-only log of all agent actions, providing a shared "memory" of what's happened.

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
| `message_sent` | Inter-agent message |
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

Context updates are pushed to all running agents on significant events (not on a periodic timer, to avoid wasting tokens on idle heartbeats):

For the **Project Lead**, the update shows "YOUR AGENTS" with IDs, roles, models, and status:
```
<!-- CREW_UPDATE
== YOUR AGENTS ==
- abc12345 — Developer [claude-opus-4.6] — running, task: Implement login endpoint
- def67890 — Code Reviewer [gemini-3-pro-preview] — idle

== RECENT ACTIVITY ==
- [13:45:02] Developer abc12345: Acquired lock on src/auth.ts
- [13:44:58] Architect ghi11111: Decision — use JWT for session tokens
CREW_UPDATE -->
```

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
- Agent spawned, killed, or exited
- File lock acquired or released
- Debounced at 2 seconds to batch rapid events

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

## Hung Process Detection

The PTY watchdog monitors agent output:
- If no output for **5 minutes** (configurable), emits `agent:hung`
- Checks every 30 seconds
- Optionally auto-kills after a second timeout (disabled by default)
- UI shows toast notification
