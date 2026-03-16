# Agent Commands

Agents communicate via structured commands embedded in their output. Commands use `⟦⟦ ⟧⟧` bracket syntax with JSON payloads, detected by the `CommandDispatcher`.

## Command Format

```
⟦⟦ COMMAND_NAME {"key": "value", ...} ⟧⟧
```

Commands without parameters can omit the JSON payload:

```
⟦⟦ COMMAND_NAME ⟧⟧
```

## Quick Reference

| Command | Category | Description |
|---------|----------|-------------|
| [`AGENT_MESSAGE`](#agent_message) | Communication | Send a message to an agent by ID or role |
| [`BROADCAST`](#broadcast) | Communication | Send a message to all agents in the crew |
| [`INTERRUPT`](#interrupt) | Communication | Interrupt an agent with an urgent message |
| [`DIRECT_MESSAGE`](#direct_message) | Communication | Queue a non-interrupting message for an agent |
| [`TELEGRAM_REPLY`](#telegram_reply) | Communication | Reply to a Telegram message |
| [`TELEGRAM_SEND`](#telegram_send) | Communication | Send a message to the bound Telegram chat |
| [`CREATE_GROUP`](#create_group) | Groups | Create a chat group |
| [`GROUP_MESSAGE`](#group_message) | Groups | Send a message to a group |
| [`ADD_TO_GROUP`](#add_to_group) | Groups | Add members to a group |
| [`REMOVE_FROM_GROUP`](#remove_from_group) | Groups | Remove members from a group |
| [`QUERY_GROUPS`](#query_groups) | Groups | List all groups you belong to |
| [`REACT`](#react) | Groups | Add or remove an emoji reaction on a group message |
| [`CREATE_AGENT`](#create_agent) | Agent Lifecycle | Spawn a new agent with a role and task |
| [`DELEGATE`](#delegate) | Agent Lifecycle | Delegate a task to an existing agent |
| [`TERMINATE_AGENT`](#terminate_agent) | Agent Lifecycle | Stop an agent (last resort) |
| [`CANCEL_DELEGATION`](#cancel_delegation) | Agent Lifecycle | Cancel an active delegation |
| [`SPAWN_AGENT`](#spawn_agent) | Agent Lifecycle | Request the lead to create an agent (non-lead only) |
| [`DECLARE_TASKS`](#declare_tasks) | Task DAG | Declare a batch of tasks with dependencies |
| [`ADD_TASK`](#add_task) | Task DAG | Add a single task to the DAG |
| [`COMPLETE_TASK`](#complete_task) | Task DAG | Mark a task as done |
| [`TASK_STATUS`](#task_status) | Task DAG | View the task DAG status and progress |
| [`ASSIGN_TASK`](#assign_task) | Task DAG | Assign a task to a specific agent |
| [`REASSIGN_TASK`](#reassign_task) | Task DAG | Reassign a running task to a different agent |
| [`ADD_DEPENDENCY`](#add_dependency) | Task DAG | Add a dependency between tasks |
| [`FORCE_READY`](#force_ready) | Task DAG | Force a task to ready status |
| [`PAUSE_TASK`](#pause_task) | Task DAG | Pause a pending or ready task |
| [`RESUME_TASK`](#resume_task) | Task DAG | Resume a paused task |
| [`RETRY_TASK`](#retry_task) | Task DAG | Retry a failed task |
| [`REOPEN_TASK`](#reopen_task) | Task DAG | Reopen a completed task |
| [`SKIP_TASK`](#skip_task) | Task DAG | Skip a task and unblock dependents |
| [`CANCEL_TASK`](#cancel_task) | Task DAG | Cancel a task |
| [`RESET_DAG`](#reset_dag) | Task DAG | Clear all tasks and start fresh |
| [`LOCK_FILE`](#lock_file) | Coordination | Acquire a file lock |
| [`UNLOCK_FILE`](#unlock_file) | Coordination | Release a file lock |
| [`COMMIT`](#commit) | Coordination | Commit locked files to git |
| [`ACTIVITY`](#activity) | Coordination | Log an activity entry |
| [`DECISION`](#decision) | Coordination | Record an architectural decision |
| [`PROGRESS`](#progress) | Coordination | Report progress on current work |
| [`QUERY_CREW`](#query_crew) | System | Get current crew status |
| [`QUERY_PEERS`](#query_peers) | System | List peer agents for direct messaging |
| [`HALT_HEARTBEAT`](#halt_heartbeat) | System | Stop heartbeat reminders |
| [`RESUME_HEARTBEAT`](#resume_heartbeat) | System | Resume heartbeat reminders |
| [`REQUEST_LIMIT_CHANGE`](#request_limit_change) | System | Request a change to concurrency limits |
| [`QUERY_PROVIDERS`](#query_providers) | System | Get available providers, models, and ranking |
| [`SET_TIMER`](#set_timer) | Timers | Set a reminder timer |
| [`CANCEL_TIMER`](#cancel_timer) | Timers | Cancel a timer |
| [`LIST_TIMERS`](#list_timers) | Timers | List active timers |
| [`ACQUIRE_CAPABILITY`](#acquire_capability) | Capabilities | Acquire a capability beyond your role |
| [`RELEASE_CAPABILITY`](#release_capability) | Capabilities | Release an acquired capability |
| [`LIST_CAPABILITIES`](#list_capabilities) | Capabilities | List available and acquired capabilities |
| [`LIST_TEMPLATES`](#list_templates) | Templates | List all available workflow templates |
| [`APPLY_TEMPLATE`](#apply_template) | Templates | Instantiate a workflow template into the DAG |
| [`DECOMPOSE_TASK`](#decompose_task) | Templates | Decompose a task description into sub-tasks |

---

## Communication

### AGENT_MESSAGE

Send a direct message to another agent. Resolves targets by agent ID, ID prefix, role ID, or role name.

```
⟦⟦ AGENT_MESSAGE {"to": "a1b2c3", "content": "Can you review my approach?"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `to` | ✅ | Target agent ID, ID prefix, or role name |
| `content` | ✅ | Message content |

### BROADCAST

Send a message to all agents in the crew.

```
⟦⟦ BROADCAST {"content": "Switching to approach B for the API layer"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `content` | ✅ | Broadcast message content |

### INTERRUPT

Interrupt another agent's current work by injecting a priority message. The message is delivered immediately, unlike `DIRECT_MESSAGE` which queues.

```
⟦⟦ INTERRUPT {"to": "agent-id-prefix", "content": "Stop — requirements changed"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `to` | ✅ | Target agent ID, ID prefix, or role name |
| `content` | ✅ | Urgent message content |

### DIRECT_MESSAGE

Queue a message to another agent without interrupting their current work. The message is delivered when the agent's current turn completes. Matches agents by ID prefix.

```
⟦⟦ DIRECT_MESSAGE {"to": "agent-id-prefix", "content": "Can you check the auth tests?"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `to` | ✅ | Target agent ID or ID prefix |
| `content` | ✅ | Message content |

### TELEGRAM_REPLY

Reply to a specific inbound Telegram message. Requires a Telegram integration to be configured.

```
⟦⟦ TELEGRAM_REPLY {"messageId": "12345", "content": "response text"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `messageId` | ✅ | Telegram message ID to reply to |
| `content` | ✅ | Reply text |

> **Note:** Telegram messages have a 30-minute TTL. Replies to expired messages will fail.

### TELEGRAM_SEND

Send a message to the Telegram chat bound to the current project. Requires a Telegram integration to be configured.

```
⟦⟦ TELEGRAM_SEND {"content": "Build complete, all tests pass"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `content` | ✅ | Message text to send |

---

## Groups

### CREATE_GROUP

Create a chat group for focused discussion. Requires at least one of `members` or `roles`.

```
⟦⟦ CREATE_GROUP {"name": "api-design", "members": ["a1b2c3", "d4e5f6"]} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Group name |
| `members` | ❌* | Array of agent IDs to include |
| `roles` | ❌* | Array of role names to include |

\* At least one of `members` or `roles` must be provided.

### GROUP_MESSAGE

Send a message to all members of a chat group.

```
⟦⟦ GROUP_MESSAGE {"group": "backend-team", "content": "API design is finalized"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `group` | ✅ | Group name |
| `content` | ✅ | Message content |

### ADD_TO_GROUP

Add members to an existing group.

```
⟦⟦ ADD_TO_GROUP {"group": "backend-team", "members": ["agent-id"]} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `group` | ✅ | Group name |
| `members` | ✅ | Array of agent IDs to add |

### REMOVE_FROM_GROUP

Remove members from a group.

```
⟦⟦ REMOVE_FROM_GROUP {"group": "backend-team", "members": ["agent-id"]} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `group` | ✅ | Group name |
| `members` | ✅ | Array of agent IDs to remove |

### QUERY_GROUPS

List all groups the agent belongs to, with member info and recent messages. `LIST_GROUPS` is an alias for this command.

```
⟦⟦ QUERY_GROUPS ⟧⟧
```

No parameters.

### REACT

Add or remove an emoji reaction on a group chat message. Toggle behavior: if the agent already reacted with that emoji, it is removed.

```
⟦⟦ REACT {"group": "backend-team", "emoji": "👍"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `group` | ✅ | Group name |
| `emoji` | ✅ | Single emoji character |
| `messageId` | ❌ | Target message ID (defaults to most recent) |

---

## Agent Lifecycle

### CREATE_AGENT

Spawn a new agent with a specific role. Only the **lead** (or agents with the `delegation` capability) can use this.

```
⟦⟦ CREATE_AGENT {"role": "developer", "task": "Implement auth module", "model": "claude-sonnet-4.6"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `role` | ✅ | Role ID (developer, architect, etc.) |
| `task` | ❌ | Initial task description |
| `model` | ❌ | Model override (defaults to role's default) |
| `provider` | ❌ | Provider override (e.g. `copilot`, `claude`, `gemini`, `codex`) |
| `context` | ❌ | Additional context for the agent |
| `dagTaskId` | ❌ | Link to a specific DAG task |
| `dependsOn` | ❌ | Array of DAG task IDs this work depends on |
| `name` | ❌ | Custom agent name |
| `sessionId` | ❌ | Session ID to resume |

### DELEGATE

Assign a task to an existing agent. Only the **lead** can use this. Automatically creates a delegation record and notifies the target agent.

```
⟦⟦ DELEGATE {"to": "a1b2c3", "task": "Write unit tests for auth", "context": "Focus on edge cases"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `to` | ✅ | Target agent ID or ID prefix |
| `task` | ✅ | Task description |
| `context` | ❌ | Additional context |
| `dagTaskId` | ❌ | Link to a specific DAG task |
| `dependsOn` | ❌ | Array of DAG task IDs this work depends on |

### TERMINATE_AGENT

Terminate an agent. Only the **lead** can use this, and only on agents in its own hierarchy. This is an **absolute last resort** — it destroys the agent's accumulated context.

```
⟦⟦ TERMINATE_AGENT {"agentId": "a1b2c3", "reason": "need slot for different role"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `agentId` | ✅ | Target agent ID or ID prefix |
| `reason` | ❌ | Reason for termination |

### CANCEL_DELEGATION

Cancel an active delegation. Provide either `agentId` or `delegationId`.

```
⟦⟦ CANCEL_DELEGATION {"agentId": "agent-id-prefix"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `agentId` | ❌* | Agent ID to cancel delegation for |
| `delegationId` | ❌* | Delegation ID to cancel |

\* At least one of `agentId` or `delegationId` must be provided.

### SPAWN_AGENT

Requests the lead to create a new agent. This command is **rejected** for all agents — only the lead can create agents via `CREATE_AGENT`. Non-lead agents should use `AGENT_MESSAGE` to ask the lead for help.

```
⟦⟦ SPAWN_AGENT {"role": "developer", "task": "Help me fix the database migration"} ⟧⟧
```

---

## Task DAG

Commands for managing the directed acyclic graph (DAG) of tasks. See [Auto-DAG](./auto-dag.md) for details on the task lifecycle.

### DECLARE_TASKS

Declare a batch of tasks with dependencies. **Lead-only.** This is the primary way to set up a project work plan.

```
⟦⟦ DECLARE_TASKS {"tasks": [{"taskId": "auth", "role": "developer", "description": "Build auth module", "dependsOn": []}, {"taskId": "api", "role": "developer", "description": "Build API layer", "dependsOn": ["auth"]}]} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `tasks` | ✅ | Array of task definitions (see below) |

Each task in the array:

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | Unique task ID (max 100 chars) |
| `role` | ✅ | Role to assign (developer, architect, etc.) |
| `description` | ❌ | Task description |
| `dependsOn` | ❌ | Array of task IDs this depends on |
| `files` | ❌ | Files to lock for this task |
| `status` | ❌ | Initial status |
| `priority` | ❌ | Priority level (number) |

### ADD_TASK

Add a single task to an existing DAG. **Lead-only.**

```
⟦⟦ ADD_TASK {"taskId": "new-task", "role": "developer", "description": "Implement caching", "dependsOn": ["auth"]} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | Unique task ID |
| `role` | ✅ | Role to assign |
| `description` | ❌ | Task description |
| `dependsOn` | ❌ | Array of task IDs this depends on |
| `files` | ❌ | Files to lock for this task |
| `status` | ❌ | Initial status |
| `priority` | ❌ | Priority level (number) |

### COMPLETE_TASK

Mark a DAG task as done. Any agent can use this — non-lead agents relay completion to the parent lead's DAG with authorization validation.

```
⟦⟦ COMPLETE_TASK {"taskId": "task-id", "summary": "Auth module implemented with full test coverage"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ❌ | DAG task ID (auto-detected from agent's assignment if omitted) |
| `summary` | ❌ | Brief summary of what was accomplished |
| `status` | ❌ | Completion status (defaults to `"done"`) |
| `output` | ❌ | Alias for `summary` — either field works |

**Security:** When using an explicit `taskId`, the system verifies the calling agent is assigned to that task. Agents cannot complete tasks assigned to other agents. Fields are capped at 10K characters.

### TASK_STATUS

View the current DAG state and progress summary. Any agent can use this (non-leads see their parent's DAG). `QUERY_TASKS` is an alias for this command.

```
⟦⟦ TASK_STATUS ⟧⟧
```

No parameters.

### ASSIGN_TASK

Assign an existing ready DAG task to a specific agent and start it. **Lead-only.** Creates a delegation record and notifies the target agent.

```
⟦⟦ ASSIGN_TASK {"taskId": "task-id", "agentId": "agent-id-prefix"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | DAG task ID to assign |
| `agentId` | ✅ | Target agent ID or short ID prefix |

### REASSIGN_TASK

Reassign a running task from one agent to another. **Lead-only.** Notifies the old agent to stop, releases their file locks, and delegates to the new agent.

```
⟦⟦ REASSIGN_TASK {"taskId": "task-id", "agentId": "new-agent-id"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | DAG task ID to reassign |
| `agentId` | ✅ | New target agent ID or short ID prefix |

### ADD_DEPENDENCY

Add dependencies between DAG tasks. Any agent can use this (non-leads can only add dependencies to tasks assigned to them). Validates that tasks exist and the dependency doesn't create a cycle.

```
⟦⟦ ADD_DEPENDENCY {"taskId": "build-frontend", "dependsOn": ["design-api", "setup-db"]} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | Task ID to add dependency to |
| `dependsOn` | ✅ | Array of task IDs this depends on (max 20) |

### FORCE_READY

Force a task to "ready" state, overriding dependency checks. **Lead-only.** The task must be in `pending` or `blocked` state.

```
⟦⟦ FORCE_READY {"taskId": "task-id"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | DAG task ID to force into ready state |

### PAUSE_TASK

Pause a pending or ready task. **Lead-only.**

```
⟦⟦ PAUSE_TASK {"taskId": "task-id"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | DAG task ID to pause |

### RESUME_TASK

Resume a paused task. **Lead-only.** Returns the task to its appropriate state (pending or ready) based on dependency status.

```
⟦⟦ RESUME_TASK {"taskId": "task-id"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | DAG task ID to resume |

### RETRY_TASK

Retry a failed task by resetting it to ready. **Lead-only.** Unblocks dependents.

```
⟦⟦ RETRY_TASK {"taskId": "task-id"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | DAG task ID to retry (must be in `failed` state) |

### REOPEN_TASK

Reopen a completed task. **Lead-only.** Warns if dependent tasks have already started or completed.

```
⟦⟦ REOPEN_TASK {"taskId": "task-id"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | DAG task ID to reopen (must be in `done` state) |

### SKIP_TASK

Skip a task and unblock its dependents. **Lead-only.** If the task was running, the assigned agent is notified to stop and its file locks are released.

```
⟦⟦ SKIP_TASK {"taskId": "task-id"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | DAG task ID to skip |

### CANCEL_TASK

Cancel a task. **Lead-only.**

```
⟦⟦ CANCEL_TASK {"taskId": "task-id"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `taskId` | ✅ | DAG task ID to cancel |

### RESET_DAG

Clear all tasks and start fresh. **Lead-only.** Archives all tasks and cancels active delegations.

```
⟦⟦ RESET_DAG ⟧⟧
```

No parameters.

---

## Coordination

### LOCK_FILE

Acquire a file lock to prevent concurrent edits. Locks have a 5-minute default TTL.

```
⟦⟦ LOCK_FILE {"filePath": "src/auth.ts", "reason": "implementing auth"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `filePath` | ✅ | Path to the file to lock |
| `reason` | ❌ | Why you need this lock |

### UNLOCK_FILE

Release a file lock. Warns if the file has uncommitted changes and blocks release until committed.

```
⟦⟦ UNLOCK_FILE {"filePath": "src/auth.ts"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `filePath` | ✅ | Path to the file to unlock |

### COMMIT

Commit changes to git. Auto-scopes to files the agent has locked. Can also specify files explicitly.

```
⟦⟦ COMMIT {"message": "feat: add input validation for all commands"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `message` | ❌ | Commit message (auto-generated if omitted) |
| `files` | ❌ | Specific files to commit (merged with locked files) |

### ACTIVITY

Log an activity entry to the crew activity ledger.

```
⟦⟦ ACTIVITY {"actionType": "file_edit", "summary": "Updated auth module"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `actionType` | ❌ | Activity type (e.g. `file_edit`, `milestone`) |
| `summary` | ❌ | Activity summary |
| `details` | ❌ | Additional details (object) |

### DECISION

Record an architectural decision. Decisions with `needsConfirmation: true` appear in the dashboard for user review.

```
⟦⟦ DECISION {"title": "Use JWT for auth", "rationale": "Stateless, scalable", "needsConfirmation": true} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `title` | ✅ | Decision title |
| `rationale` | ❌ | Reasoning behind the decision |
| `needsConfirmation` | ❌ | Whether human confirmation is needed (boolean) |

### PROGRESS

Report progress on current work. If a task DAG exists, DAG status is automatically appended.

```
⟦⟦ PROGRESS {"summary": "Auth module 60% complete", "percent": 60} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `summary` | ❌ | Progress description |
| `percent` | ❌ | Completion percentage (0–100) |
| `status` | ❌ | Status label |

---

## System

### QUERY_CREW

Request the current crew manifest — team roster, agent statuses, file locks, and memory. The response is scoped to the requesting agent's project.

```
⟦⟦ QUERY_CREW ⟧⟧
```

No parameters.

### QUERY_PEERS

Discover other active agents under the same lead, available for direct messaging.

```
⟦⟦ QUERY_PEERS ⟧⟧
```

No parameters.

### HALT_HEARTBEAT

Stop the heartbeat monitor from sending idle nudges to the lead. Useful when performing a long operation. Use `RESUME_HEARTBEAT` to re-enable.

```
⟦⟦ HALT_HEARTBEAT ⟧⟧
```

No parameters.

### RESUME_HEARTBEAT

Resume heartbeat idle nudges after they were stopped with `HALT_HEARTBEAT`.

```
⟦⟦ RESUME_HEARTBEAT ⟧⟧
```

No parameters.

### REQUEST_LIMIT_CHANGE

Request a change to the agent concurrency limit. **Lead-only.** Requires user approval via the dashboard.

```
⟦⟦ REQUEST_LIMIT_CHANGE {"limit": 15, "reason": "Need more agents for parallel testing"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `limit` | ✅ | Requested new concurrency limit (1–100) |
| `reason` | ❌ | Explanation for the change request |

### QUERY_PROVIDERS

Get available providers, models, and ranking. **Lead-only.** Shows provider status (enabled, installed), default models, resume support, and project model configuration.

```
⟦⟦ QUERY_PROVIDERS ⟧⟧
```

No parameters.

---

## Timers

### SET_TIMER

Set a reminder that fires after a delay. Supports human-readable durations like `"5m"`, `"2h"`, `"1d"`. Max 20 timers per agent.

```
⟦⟦ SET_TIMER {"label": "check-build", "delay": 300, "message": "Check if the build passed", "repeat": false} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `label` | ✅ | Timer label/name |
| `delay` | ✅ | Delay in seconds or duration string (e.g. `"5m"`, `"2h"`). Min 5s, max 24h |
| `message` | ✅ | Message to deliver when the timer fires |
| `repeat` | ❌ | Whether to repeat the timer (boolean, default `false`) |

### CANCEL_TIMER

Cancel an active timer. Provide either `timerId` or `label`.

```
⟦⟦ CANCEL_TIMER {"label": "check-build"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `timerId` | ❌* | Timer ID |
| `label` | ❌* | Timer label |

\* At least one of `timerId` or `label` must be provided.

### LIST_TIMERS

List all active timers. Leads and secretaries see all timers; other agents see only their own.

```
⟦⟦ LIST_TIMERS ⟧⟧
```

No parameters.

---

## Capabilities

### ACQUIRE_CAPABILITY

Temporarily gain a capability beyond the agent's core role. Available capabilities: `code-review`, `architecture`, `delegation`, `testing`, `devops`.

```
⟦⟦ ACQUIRE_CAPABILITY {"capability": "code-review", "reason": "found bug during development"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `capability` | ✅ | Capability name to acquire |
| `reason` | ❌ | Why you need this capability |

### RELEASE_CAPABILITY

Release an acquired capability. In practice, capabilities are retained for the session and cleared on termination.

```
⟦⟦ RELEASE_CAPABILITY {"capability": "code-review"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `capability` | ✅ | Capability name to release |

### LIST_CAPABILITIES

List all available capabilities and which ones the agent currently has.

```
⟦⟦ LIST_CAPABILITIES ⟧⟧
```

No parameters.

---

## Templates

### LIST_TEMPLATES

List all available workflow templates. Any agent can use this.

```
⟦⟦ LIST_TEMPLATES ⟧⟧
```

No parameters.

### APPLY_TEMPLATE

Instantiate a workflow template into the current DAG. **Lead-only.** Creates all tasks defined in the template with their dependency relationships.

```
⟦⟦ APPLY_TEMPLATE {"template": "feature", "overrides": {"task-ref": {"title": "Custom title", "role": "developer"}}} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `template` | ✅ | Template ID to instantiate |
| `overrides` | ❌ | Map of task refs to override fields (`title`, `role`) |

### DECOMPOSE_TASK

Decompose a task description into suggested sub-tasks using NL analysis. Useful for planning before creating a DAG.

```
⟦⟦ DECOMPOSE_TASK {"task": "Build a REST API with authentication and rate limiting"} ⟧⟧
```

| Field | Required | Description |
|-------|----------|-------------|
| `task` | ✅ | Task description to decompose |
