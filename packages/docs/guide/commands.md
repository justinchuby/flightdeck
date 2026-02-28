# Agent Commands

Agents communicate via structured commands embedded in their output. Commands use triple-bracket syntax with JSON payloads, detected by the `CommandDispatcher`.

## Command Format

```
[[[ COMMAND_NAME {"key": "value", ...} ]]]
```

## Available Commands

### CREATE_AGENT

Creates a new agent with a specific role. Only the **lead** can use this.

```
[[[ CREATE_AGENT {"role": "developer", "model": "claude-opus-4.6", "task": "Implement auth module", "context": "Use JWT tokens"} ]]]
```

| Field | Required | Description |
|-------|----------|-------------|
| `role` | ✅ | Role ID (developer, architect, etc.) |
| `model` | ❌ | Model override (defaults to role's default) |
| `task` | ❌ | Initial task description |
| `context` | ❌ | Additional context for the agent |

### TERMINATE_AGENT

Terminates an agent. Only the **lead** can use this, and only on agents in its own hierarchy (direct children or sub-lead children). This is an **absolute last resort** — it destroys the agent's accumulated context.

```
[[[ TERMINATE_AGENT {"id": "a1b2c3", "reason": "need slot for different role"} ]]]
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Target agent ID (short ID prefix) |
| `reason` | ❌ | Reason for termination |

### DELEGATE

Assigns a task to an existing agent. Only the **lead** can use this.

```
[[[ DELEGATE {"to": "a1b2c3", "task": "Write unit tests for auth", "context": "Focus on edge cases"} ]]]
```

| Field | Required | Description |
|-------|----------|-------------|
| `to` | ✅ | Target agent ID (short ID) |
| `task` | ✅ | Task description |
| `context` | ❌ | Additional context |

### AGENT_MESSAGE

Send a direct message to another agent.

```
[[[ AGENT_MESSAGE {"to": "a1b2c3", "content": "Can you review my approach?"} ]]]
```

### BROADCAST

Send a message to all agents in the crew.

```
[[[ BROADCAST {"content": "Switching to approach B for the API layer"} ]]]
```

### CREATE_GROUP

Create a group chat for focused discussion.

```
[[[ CREATE_GROUP {"name": "api-design", "members": ["a1b2c3", "d4e5f6"]} ]]]
```

### DECISION

Record an architectural decision.

```
[[[ DECISION {"title": "Use JWT for auth", "rationale": "Stateless, scalable", "alternatives": ["Session cookies", "OAuth only"], "impact": "high", "needsConfirmation": true} ]]]
```

Decisions with `needsConfirmation: true` appear in the dashboard for user review.

### PROGRESS

Report task progress.

```
[[[ PROGRESS {"summary": "Auth module 60% complete", "completed": ["Login endpoint", "Token refresh"], "in_progress": ["Logout"], "blocked": []} ]]]
```

### COMPLETE_TASK

Signal that the current delegation is done.

```
[[[ COMPLETE_TASK {"summary": "Auth module implemented with full test coverage"} ]]]
```

### DECLARE_TASKS

Declare a batch of tasks in the DAG (directed acyclic graph).

```
[[[ DECLARE_TASKS {"tasks": [{"id": "auth", "title": "Build auth", "depends_on": []}, {"id": "api", "title": "Build API", "depends_on": ["auth"]}]} ]]]
```

### LOCK_FILE / UNLOCK_FILE

Acquire or release a file lock to prevent concurrent edits.

```
[[[ LOCK_FILE {"filePath": "src/auth.ts", "reason": "implementing auth"} ]]]
[[[ UNLOCK_FILE {"filePath": "src/auth.ts"} ]]]
```

### ACTIVITY

Log an activity entry to the crew activity ledger.

```
[[[ ACTIVITY {"actionType": "file_edit", "summary": "Updated auth module"} ]]]
```

### QUERY_CREW

Request the current crew manifest (team roster, delegations, locks).

```
[[[ QUERY_CREW ]]]
```

The system responds with a formatted crew status message injected into the agent's context.
