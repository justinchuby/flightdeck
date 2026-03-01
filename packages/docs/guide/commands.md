# MCP Crew Tools

Agents communicate via **MCP (Model Context Protocol) tool calls** prefixed with `crew_`. Each agent discovers available tools automatically through the MCP server connected during session initialization — no text parsing or special syntax required.

## How It Works

When an agent is spawned, it connects to a per-agent MCP endpoint (`POST /mcp/:agentId`). The MCP server exposes 42 crew tools with validated schemas. Agents call these tools natively through the MCP protocol, and receive structured JSON results.

## Team Management

### crew_create_agent

Creates a new agent with a specific role. Only the **lead** and **architect** can use this.

```json
{ "role": "developer", "model": "claude-opus-4.6", "task": "Implement auth module", "context": "Use JWT tokens" }
```

| Field | Required | Description |
|-------|----------|-------------|
| `role` | ✅ | Role ID (developer, architect, etc.) |
| `model` | ❌ | Model override (defaults to role's default) |
| `task` | ❌ | Initial task description |
| `context` | ❌ | Additional context for the agent |
| `name` | ❌ | Name for sub-project leads |

### crew_terminate_agent

Terminates an agent. Only the **lead** can use this, and only on agents in its own hierarchy. This is an **absolute last resort** — it destroys the agent's accumulated context.

```json
{ "id": "a1b2c3", "reason": "need slot for different role" }
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Target agent ID (short ID prefix) |
| `reason` | ❌ | Reason for termination |

### crew_delegate

Assigns a task to an existing agent. Only the **lead** and **architect** can use this.

```json
{ "to": "a1b2c3", "task": "Write unit tests for auth", "context": "Focus on edge cases" }
```

| Field | Required | Description |
|-------|----------|-------------|
| `to` | ✅ | Target agent ID (short ID) |
| `task` | ✅ | Task description |
| `context` | ❌ | Additional context |

### crew_cancel_delegation

Cancel active delegations to an agent.

```json
{ "agentId": "a1b2c3" }
```

## Communication

### crew_agent_message

Send a direct message to another agent.

```json
{ "to": "a1b2c3", "content": "Can you review my approach?" }
```

### crew_broadcast

Send a message to all agents in the crew.

```json
{ "content": "Switching to approach B for the API layer" }
```

### crew_create_group

Create a group chat for focused discussion.

```json
{ "name": "api-design", "members": ["a1b2c3", "d4e5f6"] }
```

### crew_group_message / crew_add_to_group / crew_remove_from_group

Manage group chat membership and messaging.

### crew_query_groups

List all groups the agent belongs to. No parameters.

### crew_direct_message / crew_query_peers

Peer-to-peer messaging and peer discovery.

## Task & Progress

### crew_decision

Record an architectural decision.

```json
{ "title": "Use JWT for auth", "rationale": "Stateless, scalable", "needsConfirmation": true }
```

Decisions with `needsConfirmation: true` appear in the dashboard for user review.

### crew_progress

Report task progress.

```json
{ "summary": "Auth module 60% complete", "completed": ["Login endpoint", "Token refresh"], "in_progress": ["Logout"], "blocked": [] }
```

### crew_complete_task

Signal that the current delegation is done.

```json
{ "summary": "Auth module implemented with full test coverage" }
```

### crew_declare_tasks

Declare a batch of tasks in the DAG (directed acyclic graph).

```json
{ "tasks": [{"id": "auth", "title": "Build auth", "depends_on": []}, {"id": "api", "title": "Build API", "depends_on": ["auth"]}] }
```

### crew_query_tasks / crew_add_task / crew_cancel_task / crew_pause_task / crew_retry_task / crew_skip_task / crew_reset_dag

Query and manage individual tasks in the DAG.

## Coordination

### crew_lock_file / crew_unlock_file

Acquire or release a file lock to prevent concurrent edits.

```json
{ "filePath": "src/auth.ts", "reason": "implementing auth" }
```

### crew_commit

Scoped git commit — stages only files the agent has locked.

```json
{ "message": "feat: implement JWT authentication" }
```

### crew_query_crew

Request the current crew manifest (team roster, delegations, locks). No parameters.

### crew_defer_issue / crew_query_deferred / crew_resolve_deferred

Flag, query, and resolve deferred quality issues.

## Timers

### crew_set_timer / crew_cancel_timer / crew_list_timers

Set countdown reminders, cancel them, or list active timers.

## System

### crew_halt_heartbeat

Pause heartbeat stall detection. Lead only.

### crew_request_limit_change

Request a change to the agent concurrency limit.

```json
{ "limit": 30, "reason": "Need more agents for parallel work" }
```

### crew_export_session

Export the current session data for archival.

## Capabilities

### crew_acquire_capability / crew_list_capabilities / crew_release_capability

Agents can acquire additional capabilities beyond their core role (e.g., a developer acquiring "code-review" capability).

## Templates

### crew_list_templates / crew_apply_template / crew_decompose_task

List available workflow templates, apply them to create task DAGs, or decompose a task into sub-tasks.
