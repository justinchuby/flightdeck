# Flightdeck — REST API Reference

::: warning Internal — Contributors Only
These API references are for Flightdeck contributors. They are not part of the public API and may change without notice. If you're using Flightdeck to manage AI agent crews, see the [Guide](/guide/) instead.
:::

> **Base URL**: `http://localhost:3001/api`
> **Authentication**: Bearer token (auto-generated on server start, required on all routes)
> **Content-Type**: `application/json` for all request bodies
> **Rate limits**: Agent spawn — 30 req/min. Lead messages — 50 req/10s. Knowledge writes — 30 req/min.

---

## Table of Contents

[[toc]]

---

## Agent Management

### `GET /agents`

List all currently active (in-memory) agents. Optionally filter by project or session.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | query | string | no | Filter agents by project |
| `sessionId` | query | string | no | Further narrow to a specific session |

**Response**: `AgentJSON[]`

---

### `POST /agents`

Spawn a new agent with the given role and optional task. Rate-limited to 30 req/min.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `roleId` | body | string | yes | Role identifier (e.g. `developer`, `lead`) |
| `task` | body | string | no | Initial task description |
| `model` | body | string | no | Model override (e.g. `claude-sonnet-4-6`) |
| `provider` | body | string | no | Provider override |
| `sessionId` | body | string | no | Resume an existing ACP session |

**Response** `201`: `AgentJSON`
**Errors**: `400` unknown role, `429` rate limit

---

### `DELETE /agents/:id`

Terminate an agent by ID.

**Response**: `{ ok: boolean }`

---

### `POST /agents/:id/terminate`

Terminate an agent (alias for `DELETE /agents/:id`).

**Response**: `{ ok: boolean }`

---

### `POST /agents/:id/interrupt`

Interrupt the agent's current work (cancel in-flight prompt).

**Response**: `{ ok: boolean }` or `{ ok: false, error: string }`

---

### `POST /agents/:id/restart`

Restart an agent with a fresh context window (preserves role and task).

**Response** `201`: `AgentJSON`

---

### `POST /agents/:id/compact`

Compact an agent's context (restart with context handoff).

**Response** `201`: `{ compacted: true, agent: AgentJSON }`

---

### `PATCH /agents/:id`

Update agent properties (currently only `model`).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `model` | body | string | no | New model identifier |

**Response**: `AgentJSON`

---

### `GET /agents/:id/plan`

Get the agent's current task plan (from memory or persisted DB).

**Response**: `{ agentId: string, plan: object }`

---

### `GET /agents/:id/messages`

Get persisted message history for an agent. For resumed sessions, falls back to prior session messages.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `limit` | query | number | no | Max messages (default 200, max 1000) |
| `includeSystem` | query | boolean | no | Include system messages (default false) |

**Response**: `{ agentId: string, messages: Message[], fromPriorSession: boolean }`

---

### `POST /agents/:id/input`

Send raw text input to an agent's stdin.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `text` | body | string | yes | Text to write to agent |

**Response**: `{ ok: true }`

---

### `POST /agents/:id/message`

Send a message to an agent. Rate-limited to 50 req/10s.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `text` | body | string | yes | Message content |
| `mode` | body | string | no | `queue` (default) or `interrupt` |
| `attachments` | body | array | no | `[{ name, mimeType, data }]` — image attachments |

**Response**: `{ ok: true, mode: string, pending?: number, status: string }`

---

### `GET /agents/:id/queue`

Get pending message queue for an agent.

**Response**: `{ agentId: string, queue: MessageSummary[] }`

---

### `DELETE /agents/:id/queue/:index`

Remove a message from the pending queue by index.

**Response**: `{ ok: true, queue: MessageSummary[] }`

---

### `POST /agents/:id/queue/reorder`

Reorder messages in the pending queue.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `from` | body | number | yes | Source index |
| `to` | body | number | yes | Destination index |

**Response**: `{ ok: true, queue: MessageSummary[] }`

---

### `GET /agents/:id/focus`

Aggregated single-agent focus view: agent state, recent output, activities, decisions, file locks, and diff.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `activityLimit` | query | number | no | Max activity entries (default 50, max 200) |
| `outputLimit` | query | number | no | Max output chars (default 8000) |

**Response**: `{ agent, recentOutput, activities, decisions, fileLocks, diff }`

---

### `GET /agents/:id/tasks`

Get task history for an agent from the DAG.

**Response**: `DagTask[]`

---

### `GET /agents/:id/diff`

Full git diff for all files locked by this agent.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `cached` | query | string | no | Set to `false` to bypass cache |

**Response**: `DiffResult`

---

### `GET /agents/:id/diff/summary`

Lightweight diff summary (for badges — lines added/removed, file count).

**Response**: `DiffSummary`

---

## Lead Agent

### `POST /lead/start`

Start a new project with a lead agent. Rate-limited to 30 req/min.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `task` | body | string | no | Initial project task |
| `name` | body | string | no | Project name |
| `model` | body | string | no | Model override |
| `cwd` | body | string | no | Working directory |
| `sessionId` | body | string | no | Resume an existing session |
| `projectId` | body | string | no | Attach to existing project |

**Response** `201`: `AgentJSON`

---

### `GET /lead`

List all lead agents (top-level, no parent).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | query | string | no | Filter by project |

**Response**: `AgentJSON[]`

---

### `GET /lead/:id`

Get a specific lead agent's details.

**Response**: `AgentJSON`

---

### `POST /lead/:id/message`

Send a priority message to the lead agent. Rate-limited to 50 req/10s.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `text` | body | string | yes | Message content |
| `mode` | body | string | no | `interrupt` (default) or `queue` |
| `attachments` | body | array | no | Image attachments |

**Response**: `{ ok: true, mode: string }`

---

### `PATCH /lead/:id`

Update lead agent properties.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `cwd` | body | string | no | New working directory |
| `projectName` | body | string | no | New project name |

**Response**: `AgentJSON`

---

### `GET /lead/:id/decisions`

Get decisions logged by this lead's crew.

**Response**: `Decision[]`

---

### `GET /lead/:id/groups`

List chat groups for a lead agent's session.

**Response**: `ChatGroup[]`

---

### `POST /lead/:id/groups`

Create a chat group within a lead's session.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `name` | body | string | yes | Group name |
| `memberIds` | body | string[] | no | Initial member agent IDs |

**Response** `201`: `ChatGroup`

---

### `GET /lead/:id/groups/:name/messages`

Get messages from a chat group.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `limit` | query | number | no | Max messages (default 50) |

**Response**: `ChatMessage[]`

---

### `POST /lead/:id/groups/:name/messages`

Send a message to a chat group (as human user). Delivers to all agent members.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `content` | body | string | yes | Message content |

**Response** `201`: `ChatMessage`

---

### `POST /lead/:id/groups/:name/messages/:messageId/reactions`

Add a reaction to a group message.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `emoji` | body | string | yes | Emoji (max 8 chars) |

**Response**: `{ success: boolean }`

---

### `DELETE /lead/:id/groups/:name/messages/:messageId/reactions/:emoji`

Remove a reaction from a group message.

**Response**: `{ success: boolean }`

---

### `GET /lead/:id/delegations`

Get all delegations from this lead.

**Response**: `Delegation[]`

---

### `GET /lead/:id/dag`

Get the task DAG status for a lead's session.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `includeArchived` | query | boolean | no | Include archived tasks |

**Response**: `{ tasks, fileLockMap, summary }`

---

### `GET /lead/:id/progress`

Aggregated progress for a lead's crew: delegations, team agents, tokens used.

**Response**: `{ totalDelegations, active, completed, failed, completionPct, teamSize, leadTokens, teamAgents, delegations }`

---

## Costs

### `GET /costs/by-agent`

Token and cost totals grouped by agent.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | query | string | no | Filter by project |

**Response**: `AgentCost[]`

---

### `GET /costs/by-task`

Token and cost totals grouped by task.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `leadId` | query | string | no | Filter by lead |
| `projectId` | query | string | no | Filter by project |

**Response**: `TaskCost[]`

---

### `GET /costs/agent/:agentId`

Task-level cost breakdown for a specific agent.

**Response**: `TaskCost[]`

---

### `GET /costs/by-project`

Aggregate costs per project.

**Response**: `ProjectCost[]`

---

### `GET /costs/by-session`

Session-level costs for a project.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | query | string | yes | Project ID |

**Response**: `SessionCost[]`

---

## Timers

### `GET /timers`

List all agent timers with remaining time.

**Response**: `Timer[]`

---

### `POST /timers`

Create a timer for an agent.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `agentId` | body | string | yes | Agent to notify |
| `label` | body | string | yes | Timer label |
| `message` | body | string | no | Message to deliver when fired |
| `delaySeconds` | body | number | yes | Delay in seconds (1–86400) |
| `repeat` | body | boolean | no | Repeat after firing |
| `projectId` | body | string | no | Verify agent belongs to project |

**Response** `201`: `Timer`
**Errors**: `429` timer limit (max 20/agent)

---

### `DELETE /timers/:timerId`

Cancel a pending timer.

**Response**: `{ success: true }`

---

## Projects

### `GET /projects`

List all projects, enriched with agent counts, storage mode, and cost data.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `status` | query | string | no | Filter by status (e.g. `active`, `archived`) |

**Response**: `EnrichedProject[]`

---

### `GET /projects/:id`

Get project details with sessions, agent counts, and storage mode.

**Response**: `ProjectDetail`

---

### `GET /projects/:id/sessions/detail`

Enriched session history with agent composition, task summary, and retro status.

**Response**: `DetailedSession[]`

---

### `POST /projects`

Create a new project.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `name` | body | string | yes | Project name |
| `description` | body | string | no | Description |
| `cwd` | body | string | no | Working directory |

**Response** `201`: `Project`

---

### `POST /projects/import`

Import a project from an external source.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `name` | body | string | yes | Project name |
| `cwd` | body | string | no | Working directory |
| _(other fields)_ | body | varies | no | Import-specific data |

**Response** `201`: `Project`

---

### `PATCH /projects/:id`

Update project properties.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `name` | body | string | no | New name |
| `description` | body | string | no | New description |
| `cwd` | body | string | no | New working directory |
| `status` | body | string | no | New status |
| `oversightLevel` | body | string | no | `supervised`, `balanced`, or `autonomous` (null clears) |

**Response**: `Project`

---

### `DELETE /projects/:id`

Delete a project (must be `archived` status). Cascades to roster agents.

**Response**: `{ ok: true, rosterDeleted: number }`

---

### `POST /projects/:id/resume`

Resume a project session. Rate-limited to 30 req/min.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `task` | body | string | no | Override task for resumed session |
| `model` | body | string | no | Model override |
| `freshStart` | body | boolean | no | Skip session resume, start fresh |
| `resumeAll` | body | boolean | no | Re-spawn all agents from last session |
| `agents` | body | string[] | no | Specific agent IDs to respawn |
| `sessionId` | body | number | no | Resume a specific session by ID |

**Response** `201`: `AgentJSON` (with `respawning` count)
**Errors**: `409` already active

---

### `POST /projects/:id/stop`

Terminate all running agents for a project.

**Response**: `{ ok: true, terminated: number, total: number }`

---

### `GET /projects/:id/briefing`

Get the project context briefing (for lead onboarding).

**Response**: `Briefing`

---

### `GET /projects/:id/dag`

Historical task DAG for a project (from database).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `includeArchived` | query | boolean | no | Include archived tasks |

**Response**: `{ tasks, fileLockMap, summary }`

---

### `PATCH /projects/:id/tasks/:taskId/status`

Transition a task's DAG status (for Kanban board drag-and-drop).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `status` | body | string | yes | Target status: `pending`, `ready`, `running`, `done`, `failed`, `blocked`, `paused`, `skipped` |

**Response**: `{ ok: true, task: DagTask }`

---

### `PATCH /projects/:id/tasks/:taskId/priority`

Update a task's priority (for reordering within Kanban columns).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `priority` | body | number | yes | New priority value |

**Response**: `{ ok: true, task: DagTask }`

---

### `POST /projects/:id/tasks`

Create a new task from the Kanban board.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `role` | body | string | yes | Agent role for the task |
| `title` | body | string | no | Task title (title or description required) |
| `description` | body | string | no | Task description |
| `priority` | body | number | no | Priority (default 0) |
| `dependsOn` | body | string[] | no | Dependency task IDs |
| `files` | body | string[] | no | Related files |

**Response** `201`: `{ ok, taskId, tasks }`

---

### `GET /projects/:id/groups`

Historical chat groups for a project (from database).

**Response**: `ChatGroup[]`

---

### `GET /projects/:id/groups/:name/messages`

Historical group messages for a project.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `limit` | query | number | no | Max messages (default 200, max 1000) |

**Response**: `ChatMessage[]`

---

### `GET /projects/:id/messages`

Conversation messages across all agents in a project.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `limit` | query | number | no | Max messages (default 200, max 1000) |

**Response**: `{ messages, leadId }`

---

### `GET /projects/:id/files`

Directory listing for the project's working directory.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `path` | query | string | no | Relative subdirectory (default: root) |

**Response**: `{ path, items: [{ name, path, type, ext }] }`

---

### `GET /projects/:id/file-contents`

Read a file from the project directory (text only, max 512 KB).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `path` | query | string | yes | Relative file path |

**Response**: `{ path, content, size, ext }`

---

### `GET /projects/:id/artifacts`

List markdown artifacts from agent working directories, grouped by agent and session.

**Response**: `{ groups: ArtifactGroup[], artifactBasePath: string }`

---

### `GET /projects/:id/artifact-contents`

Read a file from organized artifact storage.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `path` | query | string | yes | Relative path within artifacts |

**Response**: `{ path, content, size, ext }`

---

### `GET /projects/:id/session-artifact`

Read a file from an agent's Copilot CLI session directory (allowlisted paths only).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `agentId` | query | string | yes | Agent ID |
| `path` | query | string | yes | File path (e.g. `plan.md`, `files/report.md`) |

**Response**: `{ path, content, size, ext }`

---

### Model Config

#### `GET /models`

List all known models, defaults, and models grouped by provider.

**Response**: `{ models, defaults, modelsByProvider, activeProvider }`

---

#### `GET /projects/:id/model-config`

Get per-project model configuration.

**Response**: `ModelConfig`

---

#### `PUT /projects/:id/model-config`

Set per-project model configuration.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `config` | body | object | yes | Model config (role → model mapping) |

**Response**: `ModelConfig`

---

### Knowledge (Project-Scoped)

#### `GET /projects/:id/knowledge`

List knowledge entries for a project.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `category` | query | string | no | Filter: `core`, `episodic`, `procedural`, `semantic` |

**Response**: `KnowledgeEntry[]`

---

#### `GET /projects/:id/knowledge/search`

Full-text or hybrid search across project knowledge.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `q` | query | string | yes | Search query (max 500 chars) |
| `category` | query | string | no | Category filter |
| `limit` | query | number | no | Max results (default 20, max 100) |

**Response**: `KnowledgeEntry[]` or `SearchResult[]` (hybrid)

---

#### `GET /projects/:id/knowledge/stats`

Category statistics for project knowledge.

**Response**: `CategoryStats`

---

#### `GET /projects/:id/knowledge/training`

Training summary (corrections and feedback) for a project.

**Response**: `TrainingSummary`

---

#### `POST /projects/:id/knowledge`

Create or update a knowledge entry. Rate-limited to 30 req/min.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `category` | body | string | yes | `episodic`, `procedural`, or `semantic` (not `core`) |
| `key` | body | string | yes | Unique key |
| `content` | body | string | yes | Entry content |
| `metadata` | body | object | no | Optional metadata (`description`, `tags`, `label`, `notes`) |

**Response** `201`: `KnowledgeEntry`

---

#### `DELETE /projects/:id/knowledge/:category/:key`

Delete a knowledge entry.

**Response**: `{ ok: true }`

---

## Tasks

### `GET /tasks`

Global task query with flexible scoping and filtering.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `scope` | query | string | no | `global` (default), `project`, or `lead` |
| `projectId` | query | string | conditional | Required when scope=project |
| `leadId` | query | string | conditional | Required when scope=lead |
| `status` | query | string | no | Comma-separated status filter (e.g. `running,failed`) |
| `role` | query | string | no | Filter by role |
| `assignedAgentId` | query | string | no | Filter by assigned agent |
| `includeArchived` | query | boolean | no | Include archived tasks |
| `limit` | query | number | no | Max results (default 200, max 1000) |
| `offset` | query | number | no | Pagination offset |

**Response**: `{ tasks, total, limit, offset, hasMore, scope }`

---

### `PATCH /tasks/:leadId/:taskId/unarchive`

Restore an archived task.

**Response**: `DagTask`

---

### `GET /attention`

Aggregated attention items: failed tasks, blocked tasks, pending decisions.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `scope` | query | string | no | `global` (default) or `project` |
| `projectId` | query | string | no | Filter by project |

**Response**: `{ scope, escalation, summary: { failedCount, blockedCount, decisionCount, totalCount }, items }`

---

## Coordination

### `GET /coordination/status`

Overview: agents, file locks, and recent activity.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | query | string | no | Scope to project |

**Response**: `{ agents, locks, recentActivity }`

---

### `GET /coordination/locks`

List all active file locks.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | query | string | no | Filter by project |

**Response**: `FileLock[]`

---

### `POST /coordination/locks`

Acquire a file lock for an agent.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `agentId` | body | string | yes | Agent requesting the lock |
| `filePath` | body | string | yes | File path to lock |
| `reason` | body | string | no | Reason for lock |

**Response** `201`: `{ ok: true }`
**Errors**: `409` already locked by another agent

---

### `DELETE /coordination/locks/:filePath`

Release a file lock.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `agentId` | query/body | string | yes | Agent releasing the lock |

**Response**: `{ ok: boolean }`

---

### `GET /coordination/activity`

Query the activity ledger.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `agentId` | query | string | no | Filter by agent |
| `type` | query | string | no | Filter by action type |
| `limit` | query | number | no | Max entries (default 50, max 1000) |
| `since` | query | string | no | ISO timestamp — return entries after this time |
| `projectId` | query | string | no | Scope to project |

**Response**: `ActivityEntry[]`

---

### `GET /coordination/summary`

Activity summary statistics.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | query | string | no | Scope to project |

**Response**: `ActivitySummary`

---

### `GET /coordination/timeline`

Timeline data for the session visualization (agents, communications, locks).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `leadId` | query | string | no | Scope to a lead's crew |
| `since` | query | string | no | ISO timestamp — incremental since |

**Response**: `{ agents, communications, locks, timeRange, project, ledgerVersion, dropCount }`

---

### `GET /coordination/timeline/stream` (SSE)

Server-Sent Events stream for real-time timeline updates.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `leadId` | query | string | yes | Lead agent to track |
| `lastEventId` | query | string | no | Resume from event ID |

**Events**: `init`, `activity`, `lock`, `comm:update`, `reconnect`

---

### `GET /coordination/alerts`

Active alert conditions.

**Response**: `Alert[]`

---

### `GET /coordination/eager-schedule`

Current eager scheduler state.

**Response**: `EagerSchedule`

---

### `GET /coordination/capabilities`

Agent capabilities registry.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `agentId` | query | string | no | Filter by agent |

**Response**: `Capability[]`

---

### `GET /coordination/match-agent`

Find the best agent for a task.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `task` | query | string | no | Task description |
| `role` | query | string | no | Required role |

**Response**: `AgentMatch`

---

### `GET /coordination/file-impact`

File dependency impact analysis.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `filePath` | query | string | no | File to analyze |

**Response**: `FileImpact`

---

### `GET /coordination/retries`

Retry manager state (pending retries, history).

**Response**: `RetryState`

---

### `GET /coordination/crash-reports`

Agent crash forensics reports.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `agentId` | query | string | no | Filter by agent |

**Response**: `CrashReport[]`

---

### `GET /coordination/templates`

List all task templates.

**Response**: `TaskTemplate[]`

---

### `POST /coordination/decompose`

Decompose a task description into sub-tasks.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `description` | body | string | yes | Task to decompose |

**Response**: `{ subtasks: TaskTemplate[] }`

---

### `GET /coordination/scorecards`

Performance scorecards for agents.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `leadId` | query | string | no | Scope to a lead's crew |

**Response**: `Scorecard[]`

---

### `GET /coordination/scorecards/:agentId`

Performance scorecard for a specific agent.

**Response**: `Scorecard`

---

### `GET /coordination/leaderboard`

Agent leaderboard rankings.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `leadId` | query | string | no | Scope to a lead's crew |

**Response**: `Leaderboard`

---

### `GET /coordination/coverage`

Test coverage history and trends.

**Response**: `{ history, latest, trend }`

---

### `GET /coordination/complexity`

Code complexity alerts and high-complexity files.

**Response**: `{ alerts, files, highComplexity }`

---

### `GET /coordination/dependencies`

Project dependency scan (workspace packages, counts).

**Response**: `{ workspaces, counts }`

---

### `GET /coordination/model-selector`

Available models and role overrides.

**Response**: `{ models, overrides }`

---

### `GET /coordination/token-budgets`

Token budget allocations and utilization.

**Response**: `{ budgets, totalBudget, totalUsed, utilization }`

---

### `GET /coordination/parallel-analysis`

Analyze task DAG for parallelization opportunities.

**Response**: `ParallelAnalysis`

---

### `GET /coordination/project-templates`

List all project templates.

**Response**: `ProjectTemplate[]`

---

### `GET /coordination/project-templates/search`

Search project templates by keyword.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `keyword` | query | string | yes | Search keyword |

**Response**: `ProjectTemplate[]`

---

### `GET /coordination/project-templates/:id`

Get a specific project template.

**Response**: `ProjectTemplate`

---

### `GET /coordination/knowledge`

List or filter knowledge transfer entries.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | query | string | no | Filter by project |
| `category` | query | string | no | Filter by category |
| `tag` | query | string | no | Filter by tag |

**Response**: `KnowledgeTransferEntry[]`

---

### `GET /coordination/knowledge/search`

Search knowledge transfer entries.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `q` | query | string | yes | Search query |

**Response**: `KnowledgeTransferEntry[]`

---

### `GET /coordination/knowledge/popular`

Most accessed knowledge entries.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `limit` | query | number | no | Max results (default 10, max 100) |

**Response**: `KnowledgeTransferEntry[]`

---

### `POST /coordination/knowledge`

Create a knowledge transfer entry.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | body | string | yes | Project ID |
| `category` | body | string | yes | `pattern`, `pitfall`, `tool`, `architecture`, `process` |
| `title` | body | string | yes | Entry title |
| `content` | body | string | yes | Entry content |
| `tags` | body | string[] | no | Tags |

**Response** `201`: `KnowledgeTransferEntry`

---

## Decisions

### `GET /decisions`

List all decisions.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `needs_confirmation` | query | boolean | no | Only pending confirmations |
| `projectId` | query | string | no | Filter by project |
| `grouped` | query | boolean | no | Return grouped by pending status |

**Response**: `Decision[]` or grouped format

---

### `POST /decisions/:id/confirm`

Approve a decision. Executes linked system actions and notifies the lead.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `reason` | body | string | no | Approval reason |

**Response**: `Decision`

---

### `POST /decisions/:id/reject`

Reject a decision. Notifies the lead to revise.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `reason` | body | string | no | Rejection reason |

**Response**: `Decision`

---

### `POST /decisions/:id/dismiss`

Silently remove a decision from the queue (no lead notification).

**Response**: `Decision`

---

### `POST /decisions/:id/respond`

Send a response/feedback to the agent who made the decision.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `message` | body | string | yes | Feedback message |

**Response**: `Decision`

---

### `POST /decisions/:id/feedback`

Send feedback on any decision (doesn't change status).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `message` | body | string | yes | Feedback message |

**Response**: `{ ok: true, decision }`

---

### `POST /decisions/batch`

Batch confirm, reject, or dismiss decisions.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `ids` | body | string[] | yes | Decision IDs |
| `action` | body | string | yes | `confirm`, `reject`, or `dismiss` |
| `reason` | body | string | no | Reason (for confirm/reject) |

**Response**: `{ results: Decision[] }`

---

### `POST /decisions/pause-timer`

Pause or resume decision auto-approval timers.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `paused` | body | boolean | yes | True to pause, false to resume |

**Response**: `{ paused: boolean }`

---

### Decision Records (ADR-style)

#### `GET /coordination/decisions`

List architectural decision records.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `status` | query | string | no | Filter by status |
| `tag` | query | string | no | Filter by tag |
| `since` | query | string | no | ISO timestamp filter |

**Response**: `DecisionRecord[]`

---

#### `GET /coordination/decisions/tags`

List all decision record tags.

**Response**: `string[]`

---

#### `GET /coordination/decisions/search`

Search decision records.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `q` | query | string | yes | Search query |

**Response**: `DecisionRecord[]`

---

#### `GET /coordination/decisions/:id`

Get a specific decision record.

**Response**: `DecisionRecord`

---

## Crew Management

### `GET /crews`

List all crews (agent groups by team).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | query | string | no | Scope to project |

**Response**: `{ crews: [{ crewId, agentCount, roles }] }`

---

### `GET /crews/summary`

Crew groups with leader info, agent counts, and activity status.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | query | string | no | Scope to project |

**Response**: `CrewSummary[]`

---

### `GET /crews/:crewId`

Crew details with knowledge and training stats.

**Response**: `{ crewId, agentCount, agents, knowledgeCount, trainingSummary }`

---

### `GET /crews/:crewId/agents`

List agents in a crew with enriched live status.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `status` | query | string | no | Filter: `idle`, `running`, `terminated`, `failed` |
| `projectId` | query | string | no | Scope to project |

**Response**: `EnrichedAgent[]`

---

### `GET /crews/:crewId/agents/:agentId/profile`

Detailed agent profile within a crew.

**Response**: `AgentProfile`

---

### `GET /crews/:crewId/health`

Crew health: status counts, uptime, per-agent details.

**Response**: `{ crewId, totalAgents, statusCounts, agents }`

---

### `POST /crews/:crewId/agents/:agentId/clone`

Clone an agent (creates a copy with the same configuration). Rate-limited to 10 req/min.

**Response** `201`: `{ ok: true, clone }`

---

### `DELETE /crews/:leadId`

Delete a crew (lead + all child agents from roster). Only terminated crews. Rate-limited to 10 req/min.

**Response**: `{ ok: true, deleted: number }`

---

### `DELETE /roster/:agentId`

Remove a single agent from the roster. Only terminated agents. Rate-limited to 10 req/min.

**Response**: `{ ok: true, agentId: string }`

---

## Session Retros

### `GET /coordination/retros/:leadId`

Get retrospectives for a session.

**Response**: `Retro[]`

---

### `POST /coordination/retros/:leadId`

Create a retrospective for a session.

**Response** `201`: `Retro`

---

## Session Replay

### `GET /replay/:leadId/state`

Reconstruct world state at a specific timestamp.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `at` | query | string | yes | ISO timestamp |

**Response**: `WorldState`

---

### `GET /replay/:leadId/events`

Query events in a time range or by limit.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `from` | query | string | conditional | Start timestamp (required with `to`) |
| `to` | query | string | conditional | End timestamp (required with `from`) |
| `limit` | query | number | conditional | Most recent N events (alternative to from/to) |
| `types` | query | string | no | Comma-separated action types |

**Response**: `{ events }`

---

### `GET /replay/:leadId/keyframes`

Get session keyframes for the replay timeline.

**Response**: `{ keyframes }`

---

## Shared Links

### `POST /replay/:leadId/share`

Create a share link for a session replay.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `expiresInHours` | body | number | no | Expiration (default: 24h) |
| `label` | body | string | no | Human label |

**Response** `201`: `ShareLink`

---

### `GET /replay/:leadId/shares`

List share links for a session.

**Response**: `ShareLink[]`

---

### `DELETE /shared/:token`

Revoke a share link.

**Response**: `{ revoked: true }`

---

### `GET /shared/:token`

Access a shared replay (no auth required). Returns keyframes and latest state.

**Response**: `{ leadId, label, expiresAt, keyframes, state }`

---

### `GET /shared/:token/state`

Get shared replay state at a specific timestamp.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `at` | query | string | yes | ISO timestamp |

**Response**: `WorldState`

---

## Communications

### `GET /comms/:leadId/flows`

Communication flow graph (nodes, edges, timeline) for a lead's crew.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `since` | query | string | no | ISO timestamp |
| `types` | query | string | no | Comma-separated: `message`, `broadcast`, `group_message`, `delegation` |

**Response**: `{ nodes, edges, timeline }`

---

### `GET /comms/:leadId/stats`

Communication statistics for a crew.

**Response**: `{ totalMessages, byType, mostActive }`

---

## Analytics

### `GET /analytics`

Analytics overview across all sessions.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | query | string | no | Scope to project |

**Response**: `AnalyticsOverview`

---

### `GET /analytics/sessions`

List past sessions with summary data.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | query | string | no | Scope to project |

**Response**: `{ sessions }`

---

### `GET /analytics/compare`

Compare sessions side by side.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `sessions` | query | string | yes | Comma-separated lead IDs (min 2) |

**Response**: `SessionComparison`

---

## Catch-up Summary

### `GET /summary/:leadId/since`

Generate a catch-up summary of what happened since a timestamp.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `t` | query | string | yes | ISO timestamp |

**Response**: `CatchUpSummary`

---

### `GET /catchup/:leadId`

Alias for the above with cleaner URL.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `since` | query | string | yes | ISO timestamp |

**Response**: `CatchUpSummary`

---

## Reports

### `GET /reports/session`

Generate a session report in HTML or Markdown.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `format` | query | string | no | `html` (default) or `md` |
| `leadId` | query | string | no | Lead to report on (default: first running lead) |
| `projectId` | query | string | no | Scope to project |

**Response**: HTML or Markdown body

---

### `GET /export/:leadId`

Export session data.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `format` | query | string | no | Export format |

**Response**: Exported session data

---

## Configuration

### `GET /config`

Get current server configuration.

**Response**: `ServerConfig`

---

### `GET /config/yaml`

Get the oversight section of flightdeck.config.yaml (never exposes secrets).

**Response**: `{ oversight }`

---

### `PATCH /config`

Update server configuration. Persists to YAML config.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `maxConcurrentAgents` | body | number | no | Max concurrent agents |
| `host` | body | string | no | Server host |
| `oversightLevel` | body | string | no | `supervised`, `balanced`, `autonomous` |
| `customInstructions` | body | string | no | Custom instructions |

**Response**: `ServerConfig`

---

## System

### `POST /system/pause`

Pause all agent processing.

**Response**: `{ paused: true }`

---

### `POST /system/resume`

Resume agent processing.

**Response**: `{ paused: false }`

---

### `GET /system/status`

Get system pause state.

**Response**: `{ paused: boolean }`

---

## Budget

### `GET /budget`

Get budget status.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | query | string | no | Scope to project |

**Response**: `BudgetStatus`

---

### `POST /budget`

Set budget configuration.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `limit` | body | number/null | no | Budget limit (0=disabled, null=unlimited) |
| `thresholds` | body | object | no | Alert thresholds |
| `projectId` | body | string | no | Scope to project |

**Response**: `{ updated: true, ...BudgetStatus }`

---

### `POST /budget/check`

Check budget against current spend. May auto-pause if over limit.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `projectId` | body/query | string | no | Scope to project |

**Response**: `{ level, ...BudgetStatus }`

---

## Roles

### `GET /roles`

List all registered agent roles.

**Response**: `Role[]`

---

### `POST /roles`

Register a new custom role.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | body | string | yes | Role identifier |
| `name` | body | string | yes | Display name |
| `systemPrompt` | body | string | no | System prompt |
| `model` | body | string | no | Default model |
| _(other fields)_ | body | varies | no | Additional role config |

**Response** `201`: `Role`

---

### `DELETE /roles/:id`

Remove a custom role.

**Response**: `{ ok: boolean }`

---

### `POST /roles/test`

Dry-run a custom role configuration (no LLM call).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `role` | body | object | yes | Role configuration |
| `message` | body | string | yes | Test message |

**Response**: `{ response, role, valid }`

---

## Search

### `GET /search`

Global search across conversations, group chats, tasks, decisions, and activity.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `q` | query | string | yes | Search query (min 2, max 200 chars) |
| `limit` | query | number | no | Max results (default 50, max 200) |

**Response**: `{ query, count, results }` — results have `source` field: `conversation`, `group`, `task`, `decision`, `activity`

---

### Advanced Search (Services)

#### `GET /search` (services)

Full-text search with type filtering.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `q` | query | string | yes | Search query |
| `types` | query | string | no | Comma-separated types |
| `agentId` | query | string | no | Filter by agent |
| `leadId` | query | string | no | Filter by lead |
| `since` | query | string | no | ISO timestamp |
| `limit` | query | number | no | Max results |

**Response**: `SearchResult[]`

---

## Notifications

### `GET /notifications`

List notifications with optional filtering.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `unreadOnly` | query | boolean | no | Only unread |
| `category` | query | string | no | Category filter |
| `limit` | query | number | no | Max notifications |

**Response**: `{ notifications, unreadCount }`

---

### `PUT /notifications/read-all`

Mark all notifications as read.

**Response**: `{ ok: true }`

---

### `PUT /notifications/:id/read`

Mark a single notification as read.

**Response**: `{ ok: true }`

---

### `GET /notifications/preferences`

Get notification preferences.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `userId` | query | string | no | User ID (default: `default`) |

**Response**: `NotificationPreferences`

---

### `PUT /notifications/preferences`

Update notification preferences.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `userId` | body | string | no | User ID (default: `default`) |
| _(prefs)_ | body | object | yes | Preference fields |

**Response**: `NotificationPreferences`

---

## Escalations

### `GET /coordination/escalations`

List escalations (active by default, or all).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `all` | query | boolean | no | Include resolved |

**Response**: `{ escalations, rules }`

---

### `PUT /coordination/escalations/:id/resolve`

Resolve an escalation.

**Response**: `{ ok: true }`

---

## Natural Language Commands

### `GET /nl/commands`

List all registered NL command patterns.

**Response**: `{ commands: CommandPattern[] }`

---

### `POST /nl/preview`

Preview what a command would do (no execution).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `command` | body | string | yes | Command text |
| `leadId` | body | string | yes | Lead agent context |

**Response**: `CommandPlan`

---

### `POST /nl/execute`

Match, plan, and execute a natural language command.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `command` | body | string | yes | Command text |
| `leadId` | body | string | yes | Lead agent context |

**Response**: `CommandResult`

---

### `POST /nl/undo`

Undo a previously executed command.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `commandId` | body | string | yes | Command ID to undo |

**Response**: `UndoResult`

---

### `GET /nl/suggestions`

Context-aware action suggestions for a session.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `leadId` | query | string | yes | Lead agent context |

**Response**: `{ suggestions }`

---

## Onboarding

### `GET /onboarding/status`

Get user onboarding progress.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `userId` | query | string | no | User ID (default: `default`) |

**Response**: `{ tourComplete, completedSteps, tier, sessionCount, coachDismissed }`

---

### `POST /onboarding/progress`

Update onboarding progress.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `userId` | body | string | no | User ID |
| `tourComplete` | body | boolean | no | Mark tour complete |
| `completedStep` | body | string | no | Step ID to mark complete |
| `tier` | body | string | no | New tier (`starter`, etc.) |
| `incrementSession` | body | boolean | no | Increment session count |
| `coachDismissed` | body | string | no | Coach hint ID to dismiss |

**Response**: `OnboardingState`

---

## Predictions

### `GET /predictions`

Get active predictions.

**Response**: `{ predictions }`

---

### `GET /predictions/history`

Get resolved predictions.

**Response**: `{ predictions }`

---

### `GET /predictions/accuracy`

Prediction accuracy statistics.

**Response**: `AccuracyStats`

---

### `GET /predictions/config`

Get prediction configuration.

**Response**: `PredictionConfig`

---

### `PUT /predictions/config`

Update prediction configuration.

**Response**: `PredictionConfig`

---

### `POST /predictions/:id/dismiss`

Dismiss a prediction.

**Response**: `{ ok: true }`

---

### `POST /predictions/:id/resolve`

Resolve a prediction with an outcome.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `outcome` | body | string | yes | `correct`, `avoided`, or `wrong` |

**Response**: `{ ok: true }`

---

### `POST /predictions/generate`

Manually trigger prediction generation.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `agents` | body | array | yes | Agent snapshots |
| `budget` | body | object | no | Budget snapshot |

**Response**: `{ predictions, count }`

---

## Integrations

### `GET /integrations/status`

Integration system status: adapters, sessions, pending notifications.

**Response**: `{ enabled, adapters, sessions, pendingNotifications, subscriptions }`

---

### `POST /integrations/sessions`

Initiate a session bind challenge (sends verification code to chat).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `chatId` | body | string | yes | External chat identifier |
| `platform` | body | string | yes | Platform (e.g. `telegram`) |
| `projectId` | body | string | yes | Project to bind to |
| `boundBy` | body | string | no | Who initiated (default: `api`) |

**Response** `202`: `{ status: 'challenge_sent', chatId, expiresAt, message }`

---

### `POST /integrations/sessions/verify`

Complete the verification challenge.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `chatId` | body | string | yes | Chat identifier |
| `code` | body | string | yes | Verification code |

**Response** `201`: `IntegrationSession`
**Errors**: `403` invalid code, `429` rate limited

---

### `GET /integrations/sessions`

List all active integration sessions.

**Response**: `IntegrationSession[]`

---

### `POST /integrations/subscriptions`

Subscribe a chat to project notifications.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `chatId` | body | string | yes | Chat identifier |
| `projectId` | body | string | yes | Project to subscribe to |
| `categories` | body | string[] | no | Notification categories |

**Response** `201`: `Subscription`

---

### `DELETE /integrations/subscriptions`

Unsubscribe a chat from project notifications.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `chatId` | body | string | yes | Chat identifier |
| `projectId` | body | string | yes | Project ID |

**Response** `204`: _(empty)_

---

### `GET /integrations/subscriptions`

List all active subscriptions.

**Response**: `Subscription[]`

---

### `POST /integrations/test-message`

Send a test message through an integration adapter.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `platform` | body | string | yes | Platform |
| `chatId` | body | string | yes | Chat identifier |
| `text` | body | string | yes | Message text |

**Response**: `{ sent: true }`

---

### `PATCH /integrations/telegram`

Update Telegram integration config in flightdeck.config.yaml.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `enabled` | body | boolean | no | Enable/disable |
| `botToken` | body | string | no | Bot token |
| `allowedChatIds` | body | array | no | Allowed chat IDs |
| `rateLimitPerMinute` | body | number | no | Rate limit |
| `notifications` | body | object | no | Notification config |

**Response**: `{ ok: true, updated: string[] }`

---

## Settings & Providers

### `GET /settings/providers`

List provider configs (instant, no CLI detection).

**Response**: `ProviderConfig[]`

---

### `GET /settings/providers/status`

Async CLI detection for all providers (cached).

**Response**: `ProviderStatus[]`

---

### `GET /settings/providers/:provider`

Single provider status with model preferences.

**Response**: `{ ...ProviderStatus, modelPreferences }`

---

### `POST /settings/providers/:provider/test`

Run a connection/auth health check for a provider.

**Response**: `{ success: boolean, message: string }`

---

### `PUT /settings/providers/:provider`

Update provider config (enabled, model preferences).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `enabled` | body | boolean | no | Enable/disable |
| `modelPreferences` | body | object | no | `{ defaultModel?, preferredModels? }` |

**Response**: `{ ...ProviderStatus, modelPreferences }`

---

### `PUT /settings/provider`

Set the active provider.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | body | string | yes | Provider ID |

**Response**: `{ activeProvider: string }`

---

### `GET /settings/provider-ranking`

Get provider preference order.

**Response**: `{ ranking: string[] }`

---

### `PUT /settings/provider-ranking`

Set provider preference order.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `ranking` | body | string[] | yes | Ordered provider IDs |

**Response**: `{ ranking: string[] }`

---

## Filesystem Browse

### `GET /browse`

Browse directories for the folder picker. Restricted to user home and server CWD.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `path` | query | string | no | Directory path (default: CWD) |

**Response**: `{ current, parent, folders: [{ name, path }] }`

---

## Webhooks

### `GET /webhooks`

List registered webhooks.

**Response**: `Webhook[]`

---

### `POST /webhooks`

Register a new webhook.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `url` | body | string | yes | Webhook URL |
| `events` | body | string[] | no | Event types to subscribe |

**Response** `201`: `Webhook`

---

### `DELETE /webhooks/:id`

Remove a webhook.

**Response**: `{ ok: true }`

---

### `GET /webhooks/:id/deliveries`

Get delivery history for a webhook.

**Response**: `Delivery[]`

---

## Data Management

### `GET /data/stats`

Database statistics: file size, table row counts, oldest session.

**Response**: `{ fileSizeBytes, tableCounts, totalRecords, oldestSession }`

---

### `POST /data/cleanup`

Purge old data. Supports dry-run mode.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `olderThanDays` | body | number | yes | Days threshold (0 = all data) |
| `dryRun` | body | boolean | no | Preview without deleting (default false) |

**Response**: `{ deleted, totalDeleted, sessionsDeleted, dryRun, cutoffDate }`

---

## Database Browser

### `GET /db/memory`

List all agent memory entries.

**Response**: `AgentMemory[]`

---

### `DELETE /db/memory/:id`

Delete a memory entry.

**Response**: `{ ok: true }`

---

### `GET /db/conversations`

List all conversations.

**Response**: `Conversation[]`

---

### `GET /db/conversations/:id/messages`

Get messages for a conversation.

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `limit` | query | number | no | Max messages (default 100, max 1000) |

**Response**: `Message[]`

---

### `DELETE /db/conversations/:id`

Delete a conversation and its messages.

**Response**: `{ ok: true }`

---

### `GET /db/decisions`

List all decisions (raw DB).

**Response**: `Decision[]`

---

### `DELETE /db/decisions/:id`

Delete a decision.

**Response**: `{ ok: true }`

---

### `GET /db/activity`

List activity log entries (raw DB).

| Param | In | Type | Required | Description |
|---|---|---|---|---|
| `limit` | query | number | no | Max entries (default 200, max 2000) |

**Response**: `ActivityLogEntry[]`

---

### `DELETE /db/activity/:id`

Delete an activity log entry.

**Response**: `{ ok: true }`

---

### `GET /db/stats`

Row counts for core tables.

**Response**: `{ memory, conversations, messages, decisions, activity, dagTasks }`
