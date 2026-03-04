# Flightdeck — REST API Reference

> **Base URL**: `http://localhost:3001/api`  
> **Authentication**: Bearer token (auto-generated on server start, required on all routes)  
> **Content-Type**: `application/json` for all request bodies  
> **Rate limits**: Agent spawn — 30 req/min. Lead messages — 50 req/10s.

---

## Agent Management

### `GET /agents`

**Description**: Returns all currently active agents. Optionally filter by project.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Filter agents by project. Omit to return all agents (UI default). |

**Response**:
```json
[
  {
    "id": "abc12345-...",
    "role": { "id": "developer", "name": "Developer", "icon": "💻" },
    "status": "running",
    "task": "Implement authentication module",
    "model": "claude-opus-4-6",
    "inputTokens": 12400,
    "outputTokens": 3200,
    "contextWindowSize": 200000,
    "contextWindowUsed": 15600,
    "parentId": "lead-agent-id"
  }
]
```

---

### `POST /agents`

**Description**: Spawns a new agent with the given role and optional task. Rate-limited to 30 requests per minute.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `roleId` | body | string | yes | Role identifier (e.g. `"developer"`, `"architect"`) |
| `task` | body | string | no | Initial task description sent to the agent |
| `mode` | body | string | no | Execution mode (`"autopilot"` or `"interactive"`) |
| `autopilot` | body | boolean | no | If `true`, agent runs without waiting for approval prompts |
| `model` | body | string | no | Override the default model for this role |

**Response** `201 Created`:
```json
{ "id": "abc12345-...", "role": { ... }, "status": "idle", ... }
```

**Errors**: `400` unknown role · `429` concurrency limit reached

---

### `DELETE /agents/:id`

**Description**: Terminates an agent and frees its concurrency slot.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Agent UUID |

**Response**: `{ "ok": true }`

---

### `POST /agents/:id/interrupt`

**Description**: Sends a SIGINT to the agent's underlying process, cancelling its current operation.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Agent UUID |

**Response**: `{ "ok": true }` or `{ "ok": false, "error": "Cancel not supported for this agent mode" }`

---

### `POST /agents/:id/restart`

**Description**: Terminates and immediately re-spawns an agent, preserving its role and task assignment.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Agent UUID |

**Response** `201 Created`: New agent JSON

---

### `GET /agents/:id/plan`

**Description**: Returns the agent's current plan (step list). Falls back to the persisted plan in the database if the agent is no longer in memory.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Agent UUID |

**Response**: `{ "agentId": "...", "plan": [ { "step": 1, "text": "..." } ] }`

---

### `GET /agents/:id/messages`

**Description**: Returns the persisted message history for an agent.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Agent UUID |
| `limit` | query | number | no | Max messages to return (default 200, max 1000) |

**Response**: `{ "agentId": "...", "messages": [ { "sender": "agent", "content": "...", "timestamp": "..." } ] }`

---

### `POST /agents/:id/input`

**Description**: Writes raw text directly to the agent's stdin — bypasses message formatting. Use for low-level control.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Agent UUID |
| `text` | body | string | yes | Text to write to stdin |

**Response**: `{ "ok": true }`

---

### `POST /agents/:id/message`

**Description**: Sends a user message to an agent. Supports queuing (waits until agent is idle) or interrupt mode (cancels current work first).

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Agent UUID |
| `text` | body | string | yes | Message content |
| `mode` | body | string | no | `"queue"` (default) or `"interrupt"` |

**Response**:
- Queue mode: `{ "ok": true, "mode": "queue", "pending": 1, "status": "running" }`
- Interrupt mode: `{ "ok": true, "mode": "interrupt", "status": "running" }`

---

### `PATCH /agents/:id`

**Description**: Updates mutable agent properties. Currently supports changing the model at runtime.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Agent UUID |
| `model` | body | string | no | New model identifier |

**Response**: Updated agent JSON

---

### `GET /agents/:id/queue`

**Description**: Returns summaries (first 100 chars) of each pending queued message for an agent.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Agent UUID |

**Response**: `{ "agentId": "...", "queue": ["[USER MESSAGE] ...", "..."] }`

---

### `DELETE /agents/:id/queue/:index`

**Description**: Removes a queued message by its zero-based index. The message is discarded and will never be delivered.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Agent UUID |
| `index` | path | number | yes | Zero-based index in the pending queue |

**Response**: `{ "ok": true, "queue": ["...remaining messages..."] }`

---

### `POST /agents/:id/queue/reorder`

**Description**: Moves a queued message from one position to another, changing the delivery order.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Agent UUID |
| `from` | body | number | yes | Source index (zero-based) |
| `to` | body | number | yes | Destination index (zero-based) |

**Response**: `{ "ok": true, "queue": ["...reordered messages..."] }`

---

### `POST /agents/:id/permission`

**Description**: Resolves a pending permission prompt for an agent (e.g. file write approval).

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Agent UUID |
| `approved` | body | boolean | yes | `true` to approve, `false` to deny |

**Response**: `{ "ok": true }`

---

## Agent Roles

### `GET /roles`

**Description**: Returns all registered agent roles (built-in + custom).

**Parameters**: None

**Response**:
```json
[
  { "id": "developer", "name": "Developer", "icon": "💻", "color": "#3b82f6", "model": "claude-opus-4-6", "systemPrompt": "..." }
]
```

---

### `POST /roles`

**Description**: Registers a new custom role.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | body | string | yes | Unique role identifier (slug) |
| `name` | body | string | yes | Display name |
| `systemPrompt` | body | string | yes | Role-specific system prompt |
| `icon` | body | string | no | Emoji icon |
| `color` | body | string | no | Hex color for UI |
| `model` | body | string | no | Default model override |

**Response** `201 Created`: Role object

---

### `DELETE /roles/:id`

**Description**: Removes a custom role. Built-in roles cannot be deleted.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Role identifier |

**Response**: `{ "ok": true }`

---

## Project Lead

### `POST /lead/start`

**Description**: Starts a new Project Lead agent (or resumes an existing project). Rate-limited. Sends the initial task to the lead after a short delay.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `task` | body | string | no | Initial task description |
| `name` | body | string | no | Project name |
| `model` | body | string | no | Model override for the lead |
| `cwd` | body | string | no | Working directory for the project |
| `sessionId` | body | string | no | ACP session ID to resume |
| `projectId` | body | string | no | Existing project ID to resume |

**Response** `201 Created`: Lead agent JSON  
**Errors**: `429` concurrency limit or rate limit

---

### `GET /lead`

**Description**: Returns all top-level Project Lead agents (excludes sub-leads spawned by architects).

**Parameters**: None

**Response**: Array of lead agent JSON objects

---

### `GET /lead/:id`

**Description**: Returns a single lead agent by ID.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Lead agent UUID |

**Response**: Lead agent JSON  
**Errors**: `404` if not found or not a lead role

---

### `POST /lead/:id/message`

**Description**: Sends a user message to the lead. Defaults to `"interrupt"` mode (unlike the generic agent message endpoint which defaults to `"queue"`). Rate-limited to 50 req/10s.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Lead agent UUID |
| `text` | body | string | yes | Message content |
| `mode` | body | string | no | `"interrupt"` (default) or `"queue"` |

**Response**: `{ "ok": true, "mode": "interrupt" }` or `{ "ok": true, "mode": "queue", "pending": 1 }`

---

### `PATCH /lead/:id`

**Description**: Updates lead-specific properties.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Lead agent UUID |
| `cwd` | body | string | no | Update working directory |
| `projectName` | body | string | no | Update displayed project name |

**Response**: Updated lead agent JSON

---

### `GET /lead/:id/decisions`

**Description**: Returns all decisions logged by agents under this lead.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Lead agent UUID |

**Response**: Array of decision objects enriched with agent role names

---

### `GET /lead/:id/delegations`

**Description**: Returns all active and completed delegations issued by this lead.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Lead agent UUID |

**Response**: Array of delegation objects with `{ id, agentId, task, status, createdAt }`

---

### `GET /lead/:id/dag`

**Description**: Returns the current Task DAG status for a lead's project.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Lead agent UUID |

**Response**: DAG status object with tasks, dependencies, and completion state

---

### `GET /lead/:id/progress`

**Description**: Returns a summary of project progress including delegation counts, completion percentage, team size, and token usage.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Lead agent UUID |

**Response**:
```json
{
  "totalDelegations": 12,
  "active": 3,
  "completed": 8,
  "failed": 1,
  "completionPct": 67,
  "teamSize": 5,
  "leadTokens": { "input": 45000, "output": 12000 },
  "teamAgents": [ { "id": "...", "role": {}, "status": "running", "inputTokens": 8000, ... } ],
  "delegations": [ ... ]
}
```

---

## Communication — Groups

### `GET /lead/:id/groups`

**Description**: Returns all chat groups associated with a lead's session.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Lead agent UUID |

**Response**: Array of group objects with `{ name, members, createdAt, archived }`

---

### `POST /lead/:id/groups`

**Description**: Creates a new chat group. The `"human"` participant is always added automatically.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Lead agent UUID |
| `name` | body | string | yes | Group name (unique per lead) |
| `memberIds` | body | string[] | no | Agent UUIDs to include |

**Response** `201 Created`: Group object  
**Errors**: `400` name required or name already exists

---

### `GET /lead/:id/groups/:name/messages`

**Description**: Returns recent messages from a group chat.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Lead agent UUID |
| `name` | path | string | yes | Group name |
| `limit` | query | number | no | Max messages (default 50) |

**Response**: Array of `{ id, groupName, fromAgentId, fromRole, content, timestamp }`

---

### `POST /lead/:id/groups/:name/messages`

**Description**: Sends a message from the human user into a group chat. The message is delivered to all agent members.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Lead agent UUID |
| `name` | path | string | yes | Group name |
| `content` | body | string | yes | Message text |

**Response** `201 Created`: Message object  
**Errors**: `404` group not found

---

## Decisions

### `GET /decisions`

**Description**: Returns decisions from the log, optionally filtered by project or confirmation status.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `needs_confirmation` | query | boolean | no | If `"true"`, returns only pending decisions |
| `projectId` | query | string | no | Filter decisions by project. Omit to return all. |

**Response**: Array of decision objects

---

### `POST /decisions/:id/confirm`

**Description**: Approves a decision and optionally executes any associated system action (e.g. changing agent concurrency limit). Notifies the lead agent.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Decision ID |
| `reason` | body | string | no | Optional user comment sent to the lead |

**Response**: Updated decision object

---

### `POST /decisions/:id/reject`

**Description**: Rejects a decision and notifies the lead agent to revise its approach.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Decision ID |
| `reason` | body | string | no | Optional rejection reason sent to the lead |

**Response**: Updated decision object

---

### `POST /decisions/:id/respond`

**Description**: Approves a decision and sends a custom message to the originating agent.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Decision ID |
| `message` | body | string | yes | Feedback message delivered to the agent |

**Response**: Updated decision object

---

### `POST /decisions/:id/feedback`

**Description**: Sends feedback on a decision without changing its status. Useful for non-confirmation decisions where the user wants to comment without accepting or rejecting.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Decision ID |
| `message` | body | string | yes | Feedback text delivered to the lead |

**Response**: `{ "ok": true, "decision": { ... } }`

---

## Coordination

### `GET /coordination/status`

**Description**: Returns a combined snapshot: all agents, all active file locks, and recent activity. Optionally scoped to a project.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Filter to a specific project. Omit to return all. |

**Response**: `{ "agents": [...], "locks": [...], "recentActivity": [...] }`

---

### `GET /coordination/locks`

**Description**: Returns all active file locks. Optionally scoped to a project.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Filter locks by project. Omit to return all. |

**Response**: Array of `{ agentId, agentRole, filePath, reason, acquiredAt, expiresAt }`

---

### `POST /coordination/locks`

**Description**: Acquires a file lock on behalf of an agent.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `agentId` | body | string | yes | Agent requesting the lock |
| `filePath` | body | string | yes | Path to lock (supports globs) |
| `reason` | body | string | no | Human-readable reason |

**Response** `201 Created`: `{ "ok": true }` or `409 Conflict`: `{ "ok": false, "holder": { ... } }`

---

### `DELETE /coordination/locks/:filePath`

**Description**: Releases a file lock.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `filePath` | path | string | yes | URL-encoded file path |
| `agentId` | query | string | yes | Agent releasing the lock |

**Response**: `{ "ok": true }`

---

### `GET /coordination/activity`

**Description**: Returns activity log entries. Can be filtered by agent, action type, or time range.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `agentId` | query | string | no | Filter by agent UUID |
| `type` | query | string | no | Filter by action type (e.g. `"delegated"`, `"status_change"`) |
| `limit` | query | number | no | Max entries (default 50) |
| `since` | query | string | no | ISO timestamp — returns entries after this time |

**Response**: Array of activity log entries

---

### `GET /coordination/summary`

**Description**: Returns an aggregated summary of all activity (counts by type, by agent, etc.).

**Parameters**: None

**Response**: Summary object from `ActivityLedger.getSummary()`

---

### `GET /coordination/timeline`

**Description**: Returns rich timeline data for the swim-lane visualization — agent status segments, communication links, file lock spans, and time range metadata.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `since` | query | string | no | ISO timestamp — only include events after this time |
| `leadId` | query | string | no | Scope results to a specific lead's team |

**Response**:
```json
{
  "agents": [
    {
      "id": "...", "shortId": "abc12345", "role": "developer", "model": "...",
      "createdAt": "...", "endedAt": null,
      "segments": [ { "status": "running", "startAt": "...", "endAt": "...", "taskLabel": "..." } ]
    }
  ],
  "communications": [
    { "type": "delegation", "fromAgentId": "...", "toAgentId": "...", "summary": "...", "timestamp": "..." }
  ],
  "locks": [
    { "agentId": "...", "filePath": "src/auth.ts", "acquiredAt": "...", "releasedAt": "..." }
  ],
  "timeRange": { "start": "...", "end": "..." },
  "project": { "projectId": "...", "projectName": "My App", "leadId": "..." }
}
```

---

### `GET /coordination/alerts`

**Description**: Returns all active proactive alerts from the AlertEngine (stuck agents, context pressure, duplicate edits, idle+ready mismatch, stale decisions).

**Parameters**: None

**Response**: Array of alert objects with `{ type, severity, agentId, message, timestamp }`

---

### `GET /coordination/eager-schedule`

**Description**: Returns the EagerScheduler's current pre-assignment queue — tasks matched to available agents before they become active.

**Parameters**: None

**Response**: Array of pre-assignment objects

---

### `GET /coordination/capabilities`

**Description**: Queries the capability registry to find agents with specific expertise (file, technology, keyword, domain).

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | query | string | yes | Scope to a lead's team |
| `file` | query | string | no | Match by file path |
| `technology` | query | string | no | Match by technology name |
| `keyword` | query | string | no | Match by keyword |
| `domain` | query | string | no | Match by domain |
| `availableOnly` | query | boolean | no | Only return agents that are idle |

**Response**: Array of capability match objects

---

### `GET /coordination/match-agent`

**Description**: Uses the AgentMatcher to find the best-fit agent for a task description, considering role, files, technologies, and availability.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | query | string | yes | Scope to a lead's team |
| `task` | query | string | no | Task description to match |
| `role` | query | string | no | Required role filter |
| `file` | query | string | no | Relevant file path |
| `tech` | query | string | no | Relevant technology |
| `keyword` | query | string | no | Comma-separated keywords |
| `preferIdle` | query | boolean | no | Prefer idle agents |

**Response**: Array of scored agent matches

---

### `GET /coordination/file-impact`

**Description**: Returns the dependency impact analysis for a file — which other files depend on it directly and transitively.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `file` | query | string | yes | File path to analyze |

**Response**: `{ "directDependents": [...], "transitiveDependents": [...], "depth": 3 }`

---

### `GET /coordination/retries`

**Description**: Returns the current auto-retry queue managed by the RetryManager.

**Parameters**: None

**Response**: Array of retry entries with `{ agentId, attempts, nextRetryAt, reason }`

---

### `GET /coordination/crash-reports`

**Description**: Returns crash forensics reports. Optionally filtered to a single agent.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `agentId` | query | string | no | Filter reports to a specific agent |

**Response**: Array of crash report objects with stack traces, context, and timestamps

---

### `GET /coordination/escalations`

**Description**: Returns escalation records from the EscalationManager.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `all` | query | boolean | no | If `"true"`, includes resolved escalations (default: active only) |

**Response**: `{ "escalations": [...], "rules": [...] }`

---

### `PUT /coordination/escalations/:id/resolve`

**Description**: Marks an escalation as resolved.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Escalation ID |

**Response**: `{ "ok": true }`  
**Errors**: `404` escalation not found

---

## Task Management

### `GET /coordination/templates`

**Description**: Returns all registered task templates for common project patterns.

**Parameters**: None

**Response**: Array of task template objects with `{ id, name, description, tasks[] }`

---

### `POST /coordination/decompose`

**Description**: Decomposes a free-text task description into a structured list of sub-tasks using the TaskDecomposer.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `task` | body | string | yes | Natural-language task description |

**Response**: `{ "tasks": [ { "id": "...", "title": "...", "role": "developer", "dependsOn": [] } ] }`

---

## Decision Records (ADR-style)

### `GET /coordination/decisions`

**Description**: Returns architecture decision records from the DecisionRecordStore, with optional filtering.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `status` | query | string | no | Filter by status (e.g. `"accepted"`, `"proposed"`) |
| `tag` | query | string | no | Filter by tag |
| `since` | query | string | no | ISO timestamp filter |

**Response**: Array of ADR objects

---

### `GET /coordination/decisions/tags`

**Description**: Returns all unique tags used across decision records.

**Parameters**: None

**Response**: Array of tag strings

---

### `GET /coordination/decisions/search`

**Description**: Full-text search within decision record titles and content.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `q` | query | string | yes | Search query |

**Response**: Array of matching ADR objects

---

### `GET /coordination/decisions/:id`

**Description**: Returns a single architecture decision record by ID.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Decision record ID |

**Response**: ADR object  
**Errors**: `404` if not found

---

## Session & Export

### `GET /coordination/retros/:leadId`

**Description**: Returns all retrospective reports generated for a lead's sessions.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | path | string | yes | Lead agent UUID |

**Response**: Array of retro objects

---

### `POST /coordination/retros/:leadId`

**Description**: Generates a new retrospective report for the current session of a lead.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | path | string | yes | Lead agent UUID |

**Response**: Generated retro object

---

### `GET /export/:leadId`

**Description**: Exports the full session for a lead to disk (`.flightdeck/exports/`) and returns the export manifest.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | path | string | yes | Lead agent UUID |

**Response**: `{ "path": "...", "files": [...], "exportedAt": "..." }`

---

## Projects

### `GET /projects`

**Description**: Returns all persistent projects.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `status` | query | string | no | Filter by project status (e.g. `"active"`, `"archived"`) |

**Response**: Array of project objects

---

### `GET /projects/:id`

**Description**: Returns a single project with its session history and active lead ID.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Project UUID |

**Response**: `{ ...project, "sessions": [...], "activeLeadId": "..." }`

---

### `POST /projects`

**Description**: Creates a new persistent project record.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `name` | body | string | yes | Project name |
| `description` | body | string | no | Project description |
| `cwd` | body | string | no | Working directory |

**Response** `201 Created`: Project object

---

### `PATCH /projects/:id`

**Description**: Updates project metadata.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Project UUID |
| `name` | body | string | no | New name |
| `description` | body | string | no | New description |
| `cwd` | body | string | no | New working directory |
| `status` | body | string | no | New status |

**Response**: Updated project object

---

### `GET /projects/:id/briefing`

**Description**: Returns a structured context briefing for a project — task history, decisions, key milestones — for use when resuming.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Project UUID |

**Response**: `{ ...briefing, "formatted": "Plain-text briefing for the lead agent..." }`

---

### `POST /projects/:id/resume`

**Description**: Starts a new lead agent for an existing project, injecting previous session context and message history.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Project UUID |
| `task` | body | string | no | New task for this session |
| `model` | body | string | no | Model override |

**Response** `201 Created`: New lead agent JSON  
**Errors**: `409` project already has an active lead · `429` concurrency limit

---

### `DELETE /projects/:id`

**Description**: Permanently deletes a project and all its session records.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Project UUID |

**Response**: `{ "ok": true }`  
**Errors**: `404` project not found

---

## Search & Analytics

### `GET /search`

**Description**: Full-text search across all content: agent conversations, group messages, DAG tasks, decisions, and the activity log. Results are merged and sorted by timestamp descending.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `q` | query | string | yes | Search query (min 2 chars, max 200 chars) |
| `limit` | query | number | no | Max results per source (default 50, max 200) |
| `types` | query | string | no | Comma-separated source filter: `conversation`, `group`, `task`, `decision`, `activity` |
| `agentId` | query | string | no | Filter to a specific agent (SearchEngine only) |
| `leadId` | query | string | no | Filter to a lead's project (SearchEngine only) |
| `since` | query | string | no | ISO timestamp lower bound (SearchEngine only) |

**Response**:
```json
{
  "query": "authentication",
  "count": 14,
  "results": [
    { "source": "conversation", "id": 42, "agentId": "...", "agentRole": "Developer", "content": "...", "timestamp": "..." },
    { "source": "decision", "id": "d-1", "content": "Use JWT tokens", "rationale": "...", "status": "accepted", ... }
  ]
}
```

---

### `GET /coordination/scorecards`

**Description**: Returns performance scorecards for all agents in a lead's team.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | query | string | yes | Lead agent UUID |

**Response**: Array of scorecard objects with metrics (tasks completed, tokens used, error rate, etc.)

---

### `GET /coordination/scorecards/:agentId`

**Description**: Returns the performance scorecard for a single agent.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `agentId` | path | string | yes | Agent UUID |

**Response**: Scorecard object or `null`

---

### `GET /coordination/leaderboard`

**Description**: Returns agents ranked by performance score for a lead's team.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | query | string | yes | Lead agent UUID |

**Response**: Array of `{ agentId, role, score, rank, metrics: { ... } }` sorted by score descending

---

### `GET /coordination/coverage`

**Description**: Returns test coverage history and trend data.

**Parameters**: None

**Response**: `{ "history": [...], "latest": { "lines": 84.2, "branches": 71.0, ... }, "trend": { "tests": [...], "durations": [...] } }`

---

### `GET /coordination/complexity`

**Description**: Returns code complexity alerts and per-file metrics.

**Parameters**: None

**Response**: `{ "alerts": [...], "files": [...], "highComplexity": [...] }`

---

### `GET /coordination/dependencies`

**Description**: Returns dependency analysis across all workspace packages.

**Parameters**: None

**Response**: `{ "workspaces": { "server": { ... }, "web": { ... } }, "counts": { "production": 12, "dev": 24, "total": 36 } }`

---

## Webhooks

### `GET /webhooks`

**Description**: Returns all registered webhook configurations.

**Parameters**: None

**Response**: Array of webhook objects with `{ id, url, events, enabled, createdAt }`

---

### `POST /webhooks`

**Description**: Registers a new outbound webhook.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `url` | body | string | yes | Destination URL |
| `events` | body | string[] | yes | Event names to subscribe to (e.g. `["agent.completed", "decision.created"]`) |
| `secret` | body | string | no | HMAC signing secret |
| `enabled` | body | boolean | no | Default `true` |

**Response** `201 Created`: Webhook configuration object

---

### `DELETE /webhooks/:id`

**Description**: Unregisters a webhook.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Webhook ID |

**Response**: `{ "removed": true }`

---

### `GET /webhooks/:id/deliveries`

**Description**: Returns delivery history for a webhook (success/failure, response codes, timestamps).

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Webhook ID |

**Response**: Array of delivery records

---

## Notifications

### `GET /notifications`

**Description**: Returns in-app notifications.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `unreadOnly` | query | boolean | no | If `"true"`, only unread notifications |
| `category` | query | string | no | Filter by category (e.g. `"alert"`, `"decision"`, `"system"`) |
| `limit` | query | number | no | Max notifications to return |

**Response**: `{ "notifications": [...], "unreadCount": 3 }`

---

### `PUT /notifications/read-all`

**Description**: Marks all notifications as read.

**Parameters**: None

**Response**: `{ "ok": true }`

---

### `PUT /notifications/:id/read`

**Description**: Marks a single notification as read.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Notification ID |

**Response**: `{ "ok": true }`  
**Errors**: `404` notification not found

---

### `GET /notifications/preferences`

**Description**: Returns notification preferences for a user.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `userId` | query | string | no | User identifier (default `"default"`) |

**Response**: Preferences object or `null`

---

### `PUT /notifications/preferences`

**Description**: Updates notification preferences for a user.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `userId` | body | string | no | User identifier (default `"default"`) |
| *(other fields)* | body | object | no | Preference key-value pairs |

**Response**: Updated preferences object

---

## System

### `GET /config`

**Description**: Returns the current server configuration.

**Parameters**: None

**Response**: `{ "maxConcurrentAgents": 10, "host": "localhost", "port": 3001 }`

---

### `PATCH /config`

**Description**: Updates server configuration at runtime. Changes to `maxConcurrentAgents` are persisted to SQLite.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `maxConcurrentAgents` | body | number | no | Max simultaneous agents (1–20) |
| `host` | body | string | no | Server hostname |

**Response**: Updated config object

---

### `POST /system/pause`

**Description**: Pauses the entire system. Halts message delivery to all agents — queued messages stay in the queue. Running agents finish their current prompt but won't receive new messages. All running/idle agents are notified to hold position.

**Parameters**: None

**Response**: `{ "paused": true }`

---

### `POST /system/resume`

**Description**: Resumes the system after a pause. All idle agents drain their pending message queues. Normal message delivery resumes.

**Parameters**: None

**Response**: `{ "paused": false }`

---

### `GET /system/status`

**Description**: Returns the current system pause state.

**Parameters**: None

**Response**: `{ "paused": false }`

---

### `GET /browse`

**Description**: Lists non-hidden subdirectories of a path on the server filesystem. Powers the folder picker in the UI.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `path` | query | string | no | Directory to list (default: `process.cwd()`) |

**Response**: `{ "current": "/Users/...", "parent": "/Users", "folders": [ { "name": "src", "path": "/Users/.../src" } ] }`

---

## Database Browser

These endpoints expose direct database access for debugging and administration.

### `GET /db/memory`

**Description**: Returns all agent memory entries ordered by creation date descending.

**Response**: Array of `agentMemory` rows

---

### `DELETE /db/memory/:id`

**Description**: Deletes an agent memory entry by numeric ID.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | number | yes | Row ID |

**Response**: `{ "ok": true }`

---

### `GET /db/conversations`

**Description**: Returns all conversation records ordered by creation date descending.

**Response**: Array of conversation rows

---

### `GET /db/conversations/:id/messages`

**Description**: Returns messages for a specific conversation.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Conversation ID |
| `limit` | query | number | no | Max messages (default 100, max 1000) |

**Response**: Array of message rows in chronological order

---

### `DELETE /db/conversations/:id`

**Description**: Deletes a conversation and all its messages.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Conversation ID |

**Response**: `{ "ok": true }`

---

### `GET /db/decisions`

**Description**: Returns all decision records ordered by creation date descending.

**Response**: Array of decision rows

---

### `DELETE /db/decisions/:id`

**Description**: Deletes a decision record.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | string | yes | Decision ID |

**Response**: `{ "ok": true }`

---

### `GET /db/activity`

**Description**: Returns activity log entries, newest first.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `limit` | query | number | no | Max entries (default 200, max 2000) |

**Response**: Array of activity log rows

---

### `DELETE /db/activity/:id`

**Description**: Deletes a single activity log entry.

**Parameters**:
| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | path | number | yes | Row ID |

**Response**: `{ "ok": true }`

---

### `GET /db/stats`

**Description**: Returns row counts for every major database table.

**Parameters**: None

**Response**:
```json
{
  "memory": 42,
  "conversations": 7,
  "messages": 1204,
  "decisions": 23,
  "activity": 8812,
  "dagTasks": 38
}
```

---

## WebSocket

The server exposes a WebSocket endpoint at `ws://localhost:3001` for real-time push events.

### Authentication

Include the auth token as a query parameter:
```
ws://localhost:3001?token=<your-token>
```

### Event Types

| Event | Description |
|-------|-------------|
| `init` | Sent on connect with full agent list, locks, and `systemPaused` state |
| `agent:text` | Streaming text output from an agent |
| `agent:status` | Agent status change (`idle`, `running`, `completed`, `failed`) |
| `agent:spawned` | New agent created — includes full agent JSON |
| `agent:terminated` | Agent terminated |
| `agent:exit` | Agent process exited with code |
| `agent:tool_call` | Agent invoked a tool |
| `agent:content` | Rich content from agent (image, audio, resource) |
| `agent:thinking` | Agent thinking/reasoning text |
| `agent:plan` | Agent plan updated |
| `agent:permission_request` | Agent requesting tool permission |
| `agent:session_ready` | Agent ACP session established |
| `agent:context_compacted` | Agent context window compacted |
| `agent:sub_spawned` | Child agent created by parent |
| `agent:delegated` | Task delegated to agent |
| `agent:completion_reported` | Agent reported task completion |
| `agent:message_sent` | Inter-agent message delivered |
| `agent:crashed` | Agent process crashed |
| `agent:auto_restarted` | Agent automatically restarted after crash |
| `agent:restart_limit` | Agent hit max restart limit |
| `lead:decision` | New decision logged by lead |
| `lead:progress` | Lead progress update |
| `dag:updated` | Task DAG state changed |
| `group:created` | Chat group created |
| `group:message` | Message sent to a chat group |
| `group:member_added` | Agent added to a group |
| `group:member_removed` | Agent removed from a group |
| `system:paused` | System pause state changed — `{ "paused": true/false }` |
| `decision:confirmed` | Decision confirmed by user |
| `decision:rejected` | Decision rejected by user |
| `lock:acquired` | File lock acquired |
| `lock:released` | File lock released |
| `activity` | Activity ledger entry |
