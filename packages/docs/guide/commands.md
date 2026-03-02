# Agent Commands

Agents communicate via structured commands embedded in their output. Commands use `⟦⟦ ⟧⟧` bracket syntax with JSON payloads, detected by the `CommandDispatcher`.

## Command Format

```
⟦⟦ COMMAND_NAME {"key": "value", ...} ⟧⟧
```

## Available Commands

### CREATE_AGENT

Creates a new agent with a specific role. The **lead** and **architect** can use this.

```
⟦⟦ CREATE_AGENT {"role": "developer", "model": "claude-opus-4.6", "task": "Implement auth module", "context": "Use JWT tokens"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `role` | ✅ | Role ID (developer, architect, etc.) |
| `model` | ❌ | Model override (defaults to role's default) |
| `task` | ❌ | Initial task description |
| `context` | ❌ | Additional context for the agent |
| `dagTaskId` | ❌ | Link to a specific DAG task |
| `depends_on` | ❌ | Array of DAG task IDs this work depends on |

### TERMINATE_AGENT

Terminates an agent. Only the **lead** can use this, and only on agents in its own hierarchy (direct children or sub-lead children). This is an **absolute last resort** — it destroys the agent's accumulated context.

```
⟦⟦ TERMINATE_AGENT {"id": "a1b2c3", "reason": "need slot for different role"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Target agent ID (short ID prefix) |
| `reason` | ❌ | Reason for termination |

### DELEGATE

Assigns a task to an existing agent. Only the **lead** can use this.

```
⟦⟦ DELEGATE {"to": "a1b2c3", "task": "Write unit tests for auth", "context": "Focus on edge cases"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `to` | ✅ | Target agent ID (short ID) |
| `task` | ✅ | Task description |
| `context` | ❌ | Additional context |
| `dagTaskId` | ❌ | Link to a specific DAG task |
| `depends_on` | ❌ | Array of DAG task IDs this work depends on |

### AGENT_MESSAGE

Send a direct message to another agent.

```
⟦⟦ AGENT_MESSAGE {"to": "a1b2c3", "content": "Can you review my approach?"} ⟧⟧
```

### BROADCAST

Send a message to all agents in the crew.

```
⟦⟦ BROADCAST {"content": "Switching to approach B for the API layer"} ⟧⟧
```

### CREATE_GROUP

Create a group chat for focused discussion.

```
⟦⟦ CREATE_GROUP {"name": "api-design", "members": ["a1b2c3", "d4e5f6"]} ⟧⟧
```

### DECISION

Record an architectural decision.

```
⟦⟦ DECISION {"title": "Use JWT for auth", "rationale": "Stateless, scalable", "alternatives": ["Session cookies", "OAuth only"], "impact": "high", "needsConfirmation": true} ⟧⟧
```

Decisions with `needsConfirmation: true` appear in the dashboard for user review.

### PROGRESS

Report task progress.

```
⟦⟦ PROGRESS {"summary": "Auth module 60% complete", "completed": ["Login endpoint", "Token refresh"], "in_progress": ["Logout"], "blocked": []} ⟧⟧
```

### COMPLETE_TASK

Mark a DAG task as done. Any agent can use this — non-lead agents relay completion to the parent lead's DAG with authorization validation.

```
⟦⟦ COMPLETE_TASK {"id": "task-id", "summary": "Auth module implemented with full test coverage", "output": "..."} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ❌ | DAG task ID (defaults to agent's assigned `dagTaskId`) |
| `summary` | ❌ | Brief summary of what was accomplished |
| `status` | ❌ | Completion status (defaults to `"done"`) |
| `output` | ❌ | Alias for `summary` — either field works |

**Security**: When using an explicit `id`, the system verifies the calling agent is assigned to that task. Agents cannot complete tasks assigned to other agents. Fields are capped at 10K characters.

### DECLARE_TASKS

Declare a batch of tasks in the DAG (directed acyclic graph).

```
⟦⟦ DECLARE_TASKS {"tasks": [{"id": "auth", "title": "Build auth", "depends_on": []}, {"id": "api", "title": "Build API", "depends_on": ["auth"]}]} ⟧⟧
```

### LOCK_FILE / UNLOCK_FILE

Acquire or release a file lock to prevent concurrent edits.

```
⟦⟦ LOCK_FILE {"filePath": "src/auth.ts", "reason": "implementing auth"} ⟧⟧
⟦⟦ UNLOCK_FILE {"filePath": "src/auth.ts"} ⟧⟧
```

### ACTIVITY

Log an activity entry to the crew activity ledger.

```
⟦⟦ ACTIVITY {"actionType": "file_edit", "summary": "Updated auth module"} ⟧⟧
```

### QUERY_CREW

Request the current crew manifest (team roster, delegations, locks).

```
⟦⟦ QUERY_CREW ⟧⟧
```

The system responds with a formatted crew status message injected into the agent's context.

### DIRECT_MESSAGE

Queue a message to another agent without interrupting their current work. Matches agents by ID prefix.

```
⟦⟦ DIRECT_MESSAGE {"to": "agent-id-prefix", "content": "Can you check the auth tests?"} ⟧⟧
```

### QUERY_PEERS

Discover other active agents available for direct messaging.

```
⟦⟦ QUERY_PEERS ⟧⟧
```

### ACQUIRE_CAPABILITY / RELEASE_CAPABILITY

Temporarily gain capabilities beyond the agent's role.

```
⟦⟦ ACQUIRE_CAPABILITY {"capability": "code-review", "reason": "found bug during development"} ⟧⟧
⟦⟦ RELEASE_CAPABILITY {"capability": "code-review"} ⟧⟧
⟦⟦ LIST_CAPABILITIES ⟧⟧
```

Available capabilities: `code-review`, `architecture`, `delegation`, `testing`, `devops`.

### SET_TIMER / CANCEL_TIMER

Set reminders that fire after a delay, with optional repeat.

```
⟦⟦ SET_TIMER {"label": "check-build", "delay": 300, "message": "Check if the build passed", "repeat": false} ⟧⟧
⟦⟦ CANCEL_TIMER {"name": "check-build"} ⟧⟧
⟦⟦ LIST_TIMERS ⟧⟧
```

### SPAWN_AGENT

Request parent to create a new agent. Non-lead agents use this to request help:

```
⟦⟦ SPAWN_AGENT {"role": "developer", "task": "Help me fix the database migration"} ⟧⟧
```

### CANCEL_DELEGATION

Cancel an active delegation to an agent. The agent is terminated and the task is freed:

```
⟦⟦ CANCEL_DELEGATION {"agentId": "agent-id-prefix"} ⟧⟧
```

### COMMIT

Commit changes from the agent's locked files. Auto-scopes to only files the agent has locked:

```
⟦⟦ COMMIT {"message": "feat: add input validation for all commands"} ⟧⟧
```

Optional `files` parameter to commit specific files instead of all locked files.

### GROUP_MESSAGE

Send a message to all members of a chat group:

```
⟦⟦ GROUP_MESSAGE {"group": "backend-team", "content": "API design is finalized"} ⟧⟧
```

### REACT

Add or remove an emoji reaction on a group chat message:

```
⟦⟦ REACT {"group": "backend-team", "messageId": "msg-id", "emoji": "👍"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `group` | ✅ | Group name |
| `messageId` | ✅ | Target message ID |
| `emoji` | ✅ | Single emoji character |

Toggle behavior: if the agent already reacted with that emoji, it is removed.

### ADD_TO_GROUP / REMOVE_FROM_GROUP

Manage group membership:

```
⟦⟦ ADD_TO_GROUP {"group": "backend-team", "members": ["agent-id"]} ⟧⟧
⟦⟦ REMOVE_FROM_GROUP {"group": "backend-team", "members": ["agent-id"]} ⟧⟧
```

### QUERY_GROUPS / LIST_GROUPS

List all groups the agent belongs to, with member info and recent messages:

```
⟦⟦ QUERY_GROUPS ⟧⟧
```

### ADD_DEPENDENCY

Add dependencies between DAG tasks. Any agent can use this:

```
⟦⟦ ADD_DEPENDENCY {"taskId": "build-frontend", "depends_on": ["design-api", "setup-db"]} ⟧⟧
```

Validates that both tasks exist and the new dependency doesn't create a cycle. See [Auto-DAG](./auto-dag.md) for details.

### FORCE_READY

Force a task to "ready" state, overriding dependency checks. Lead-only.

```
⟦⟦ FORCE_READY {"id": "task-id"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | DAG task ID to force into ready state |

### ASSIGN_TASK

Assign an existing DAG task to a specific agent. Lead-only.

```
⟦⟦ ASSIGN_TASK {"taskId": "task-id", "agentId": "agent-id-prefix"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | DAG task ID |
| `agentId` | ✅ | Target agent ID (short ID prefix) |

### REASSIGN_TASK

Reassign a running task from one agent to another. Lead-only.

```
⟦⟦ REASSIGN_TASK {"taskId": "task-id", "agentId": "new-agent-id"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | DAG task ID to reassign |
| `agentId` | ✅ | New target agent ID (short ID prefix) |

### HALT_HEARTBEAT

Stop the heartbeat monitor from nudging the lead. Useful when the lead is performing a long operation.

```
⟦⟦ HALT_HEARTBEAT ⟧⟧
```

### REQUEST_LIMIT_CHANGE

Agent requests a change to the concurrency limit. Requires user approval via the dashboard.

```
⟦⟦ REQUEST_LIMIT_CHANGE {"limit": 15, "reason": "Need more agents for parallel testing"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `limit` | ✅ | Requested new agent concurrency limit |
| `reason` | ❌ | Explanation for the change request |

### INTERRUPT

Interrupt another agent's current work by injecting a priority message.

```
⟦⟦ INTERRUPT {"to": "agent-id-prefix", "content": "Stop — requirements changed"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `to` | ✅ | Target agent ID (short ID prefix) |
| `content` | ✅ | Priority message to inject |

### LIST_TEMPLATES

List all available workflow templates. Any agent can use this.

```
⟦⟦ LIST_TEMPLATES ⟧⟧
```

### APPLY_TEMPLATE

Instantiate a workflow template into the current DAG. Lead-only.

```
⟦⟦ APPLY_TEMPLATE {"template": "feature", "overrides": {"task-ref": {"title": "Custom title", "role": "developer"}}} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `template` | ✅ | Template ID to instantiate |
| `overrides` | ❌ | Map of task refs to override fields (`title`, `role`) |

### DECOMPOSE_TASK

Decompose a task description into suggested sub-tasks using NL analysis.

```
⟦⟦ DECOMPOSE_TASK {"task": "Build a REST API with authentication and rate limiting"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `task` | ✅ | Task description to decompose |

### Task DAG Management (Lead-only)

Additional commands for managing the task DAG:

| Command | Description |
|---------|-------------|
| `TASK_STATUS` / `QUERY_TASKS` | View current DAG state and progress summary |
| `ADD_TASK {"id": "...", "role": "...", "description": "...", "depends_on": [...]}` | Add a single task to an existing DAG |
| `ADD_DEPENDENCY {"taskId": "...", "depends_on": ["..."]}` | Add dependencies between tasks |
| `CANCEL_TASK {"id": "..."}` | Cancel a task |
| `SKIP_TASK {"id": "..."}` | Skip a task and unblock dependents |
| `RETRY_TASK {"id": "..."}` | Retry a failed task |
| `PAUSE_TASK {"id": "..."}` | Pause a pending/ready task |
| `RESET_DAG` | Clear all tasks and start fresh |
