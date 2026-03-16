# Flightdeck — REST API Reference

::: warning Internal — Contributors Only
These API references are for Flightdeck contributors. They are not part of the public API and may change without notice. If you're using Flightdeck to manage AI agent crews, see the [Guide](/guide/) instead.
:::

> **Base URL**: `http://localhost:3001/api`
> **Authentication**: Bearer token (auto-generated on server start, required on all routes except shared replay links)
> **Content-Type**: `application/json` for all request bodies
> **Timestamps**: ISO 8601 throughout (e.g. `2025-03-01T10:30:00Z`)

### Rate Limits

| Limiter | Window | Max | Applied To |
|---------|--------|-----|------------|
| `spawnLimiter` | 60 s | 30 | Agent/lead spawn |
| `messageLimiter` | 10 s | 50 | Agent/lead messages |
| `readLimiter` | 60 s | 60 | Crew read endpoints |
| `writeLimiter` | 60 s | 10 | Crew write endpoints |
| `knowledgeReadLimiter` | 60 s | 120 | Knowledge GET |
| `knowledgeSearchLimiter` | 60 s | 60 | Knowledge search |
| `knowledgeWriteLimiter` | 60 s | 30 | Knowledge POST/DELETE |
| `integrationLimiter` | 60 s | 60 | All integration routes |

---

## Agent Management

### `GET /agents`

List all live agents, optionally scoped to a project or session.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Filter by project |
| `sessionId` | query | string | no | Filter by session |

**Response**: `Agent[]`

---

### `POST /agents`

Spawn a new agent. Rate-limited (`spawnLimiter`).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `roleId` | body | string | yes | Role identifier (e.g. `"developer"`, `"architect"`) |
| `task` | body | string | no | Initial task description |
| `model` | body | string | no | Override the default model for this role |
| `provider` | body | string | no | Override the provider |
| `sessionId` | body | string | no | Associate with an existing session |

**Response** `201`: `Agent`
**Errors**: `400` unknown role · `429` rate/concurrency limit

---

### `DELETE /agents/:id`

Terminate an agent and free its concurrency slot.

**Response**: `{ "ok": true }`

---

### `POST /agents/:id/terminate`

Terminate an agent (alias for `DELETE /agents/:id`).

**Response**: `{ "ok": true }`

---

### `POST /agents/:id/interrupt`

Cancel current work (if supported by the adapter).

**Response**: `{ "ok": true }` or `{ "ok": false, "error": "..." }`

---

### `POST /agents/:id/restart`

Restart agent with context handoff — terminates and re-spawns preserving role and task.

**Response**: `Agent`

---

### `POST /agents/:id/compact`

Compact agent context (restart with handoff to reduce token usage).

**Response**: `{ "compacted": true, "agent": Agent }`

---

### `GET /agents/:id/plan`

Get the agent's current execution plan.

**Response**: `{ "agentId": string, "plan": object }`

---

### `GET /agents/:id/messages`

Get agent message history, including cross-session messages for resumed sessions.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `limit` | query | number | no | 1–1000 (default 200) |
| `includeSystem` | query | string | no | `"true"` to include system messages |

**Response**: `{ "agentId": string, "messages": Message[], "fromPriorSession": boolean }`

---

### `POST /agents/:id/input`

Send raw text input to the agent's process stdin.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `text` | body | string | yes | Raw text to send |

**Response**: `{ "ok": true }`

---

### `POST /agents/:id/message`

Send a message to an agent with optional interrupt mode. Rate-limited (`messageLimiter`).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `text` | body | string | yes | Message content |
| `mode` | body | string | no | `"queue"` (default) or `"interrupt"` |
| `attachments` | body | array | no | `[{ name, mimeType, data }]` |

**Response**: `{ "ok": true, "mode": string, "status?": string, "pending?": number }`

---

### `PATCH /agents/:id`

Update an agent's model at runtime.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `model` | body | string | no | New model identifier |

**Response**: `Agent`

---

### `GET /agents/:id/queue`

Get the agent's pending message queue.

**Response**: `{ "agentId": string, "queue": Message[] }`

---

### `DELETE /agents/:id/queue/:index`

Remove a message from the queue by index.

**Response**: `{ "ok": true, "queue": Message[] }`

---

### `POST /agents/:id/queue/reorder`

Reorder pending messages in the queue.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `from` | body | number | yes | Source index |
| `to` | body | number | yes | Destination index |

**Response**: `{ "ok": true, "queue": Message[] }`

---

### `GET /agents/:id/focus`

Aggregated single-agent view with recent output, activities, decisions, locks, and diff.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `activityLimit` | query | number | no | 1–200 (default 50) |
| `outputLimit` | query | number | no | Max characters (default 8000) |

**Response**: `{ "agent": Agent, "recentOutput": string, "activities": Activity[], "decisions": Decision[], "fileLocks": Lock[], "diff": Diff }`

---

### `GET /agents/:id/tasks`

Get task history for a specific agent.

**Response**: `DagTask[]`

---

### `GET /agents/:id/diff`

Full diff for the agent's currently locked files.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `cached` | query | boolean | no | `false` to bypass cache (default `true`) |

**Response**: `Diff`

---

### `GET /agents/:id/diff/summary`

Lightweight diff summary (for badges/indicators).

**Response**: `DiffSummary`

---

## Analytics

### `GET /analytics`

Overview analytics across all sessions, optionally scoped to a project.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Scope to project |

**Response**: `AnalyticsOverview`

---

### `GET /analytics/sessions`

List past sessions with summary data.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Filter by project |

**Response**: `{ "sessions": Session[] }`

---

### `GET /analytics/compare`

Compare multiple sessions side by side.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `sessions` | query | string | yes | Comma-separated lead IDs (minimum 2) |

**Response**: `Comparison`

---

## Browse

### `GET /browse`

List directories for folder picker. Security-restricted to `$HOME` and `process.cwd()` only — blocks `/etc`, `/proc`, `/sys`, and prevents path traversal.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `path` | query | string | no | Directory to list (default: cwd) |

**Response**: `{ "current": string, "parent?": string, "folders": [{ "name": string, "path": string }] }`

---

## Communication Flows

### `GET /comms/:leadId/flows`

Build communication flow graph for a crew.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `since` | query | string | no | ISO timestamp |
| `types` | query | string | no | Comma-separated: `message`, `broadcast`, `group_message`, `delegation` |

**Response**: `{ "nodes": FlowNode[], "edges": FlowEdge[], "timeline": FlowTimelineEntry[] }`

---

### `GET /comms/:leadId/stats`

Communication statistics for a crew.

**Response**: `{ "totalMessages": number, "byType": Record<string, number>, "mostActive?": { "agentId": string, "sent": number, "received": number } }`

---

## Configuration

### `GET /config`

Get current server configuration.

**Response**: `ServerConfig`

---

### `GET /config/yaml`

Get oversight section from YAML config (no secrets exposed).

**Response**: `{ "oversight": OversightConfig }`

---

### `PATCH /config`

Update server configuration.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `maxConcurrentAgents` | body | number | no | Max concurrent agents |
| `host` | body | string | no | Server host |
| `oversightLevel` | body | string | no | `"supervised"`, `"balanced"`, or `"autonomous"` |
| `customInstructions` | body | string | no | Custom instructions for all agents |

**Response**: `ServerConfig`

---

### `POST /system/pause`

Pause all agents.

**Response**: `{ "paused": true }`

---

### `POST /system/resume`

Resume all agents.

**Response**: `{ "paused": false }`

---

### `GET /system/status`

Get system pause status.

**Response**: `{ "paused": boolean }`

---

## Budget

### `GET /budget`

Get budget status, optionally scoped to a project.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Scope to project |

**Response**: `BudgetStatus`

---

### `POST /budget`

Set budget limit and thresholds.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `limit` | body | number | no | Budget limit (0 or positive) |
| `thresholds` | body | object | no | Warning/pause thresholds |
| `projectId` | body | string | no | Scope to project |

**Response**: `{ "updated": true, ...BudgetStatus }`

---

### `POST /budget/check`

Check budget and auto-pause if exceeded.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | body | string | no | Scope to project |

**Response**: `{ "level": "ok" | "warning" | "pause", ...BudgetStatus }`

---

## Coordination

### `GET /coordination/status`

Coordination status overview (agents, locks, recent activity).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Scope to project |

**Response**: `{ "agents": Agent[], "locks": FileLock[], "recentActivity": Activity[] }`

---

### `GET /coordination/locks`

List all file locks.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Filter by project |

**Response**: `FileLock[]`

---

### `POST /coordination/locks`

Acquire a file lock. Returns `409` if already held by another agent.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `agentId` | body | string | yes | Agent requesting the lock |
| `filePath` | body | string | yes | File path to lock |
| `reason` | body | string | yes | Why the lock is needed |

**Response**: `{ "ok": true }` or `409 { "ok": false, "holder": string }`

---

### `DELETE /coordination/locks/:filePath`

Release a file lock.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `agentId` | query/body | string | no | Agent releasing (for verification) |

**Response**: `{ "ok": boolean }`

---

### `GET /coordination/activity`

Query the activity log.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `agentId` | query | string | no | Filter by agent |
| `type` | query | string | no | Filter by activity type |
| `limit` | query | number | no | 1–1000 (default 50) |
| `since` | query | string | no | ISO timestamp |
| `projectId` | query | string | no | Filter by project |

**Response**: `Activity[]`

---

### `GET /coordination/summary`

Activity summary, optionally scoped to a project.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Scope to project |

**Response**: Activity summary object

---

### `GET /coordination/timeline`

Full timeline data for session replay. Cached for 5 seconds.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | query | string | no | Scope to a specific lead |
| `since` | query | string | no | ISO timestamp |

**Response**: `{ "agents": ..., "communications": ..., "locks": ..., "timeRange": ..., "project": ... }`

---

### `GET /coordination/timeline/stream`

Real-time timeline updates via **Server-Sent Events** (SSE).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | query | string | yes | Lead agent ID |

**SSE Events**: `init`, `reconnect`, `activity`, `comm:update`, `lock` (with `type`: `acquired`/`released`/`expired`)

Supports reconnect via `Last-Event-ID` header.

---

### `GET /coordination/alerts`

Get proactive alerts from the coordination layer.

**Response**: `Alert[]`

---

### `GET /coordination/eager-schedule`

Get eager scheduler pre-assignments.

**Response**: `PreAssignment[]`

---

### `GET /coordination/capabilities`

Query agent capabilities.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | query | string | yes | Lead agent ID |
| `file` | query | string | no | Filter by file |
| `technology` | query | string | no | Filter by technology |
| `keyword` | query | string | no | Filter by keyword |
| `domain` | query | string | no | Filter by domain |
| `availableOnly` | query | string | no | Only available agents |

**Response**: `Capability[]`

---

### `GET /coordination/match-agent`

Match the best agent for a task.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | query | string | yes | Lead agent ID |
| `task` | query | string | no | Task description |
| `role` | query | string | no | Required role |
| `file` | query | string | no | File being worked on |
| `tech` | query | string | no | Technology required |
| `keyword` | query | string | no | Keyword filter |
| `preferIdle` | query | string | no | Prefer idle agents |

**Response**: `MatchedAgent[]`

---

### `GET /coordination/retros/:leadId`

Get session retrospectives.

**Response**: `Retro[]`

---

### `POST /coordination/retros/:leadId`

Generate a retrospective for the session.

**Response**: `GeneratedRetro`

---

### `GET /coordination/file-impact`

Analyze file dependency impact.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `file` | query | string | yes | File path to analyze |

**Response**: `{ "directDependents": ..., "transitiveDependents": ..., "depth": number }`

---

### `GET /coordination/retries`

Get the auto-retry queue.

**Response**: `Retry[]`

---

### `GET /coordination/crash-reports`

Get crash forensics reports.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `agentId` | query | string | no | Filter by agent |

**Response**: `CrashReport[]`

---

### `GET /coordination/templates`

List task templates.

**Response**: `Template[]`

---

### `POST /coordination/decompose`

Decompose a task into subtasks.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `task` | body | string | yes | Task description to decompose |

**Response**: Decomposed task structure

---

### `GET /coordination/scorecards`

Get performance scorecards.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | query | string | yes | Lead agent ID |

**Response**: `Scorecard[]`

---

### `GET /coordination/scorecards/:agentId`

Get a single agent's scorecard.

**Response**: `Scorecard`

---

### `GET /coordination/leaderboard`

Agent leaderboard.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | query | string | yes | Lead agent ID |

**Response**: `Leaderboard[]`

---

### `GET /coordination/decisions`

ADR-style decision records.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `status` | query | string | no | Filter by status |
| `tag` | query | string | no | Filter by tag |
| `since` | query | string | no | ISO timestamp |

**Response**: `DecisionRecord[]`

---

### `GET /coordination/decisions/tags`

List all decision record tags.

**Response**: `string[]`

---

### `GET /coordination/decisions/search`

Search decision records.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `q` | query | string | yes | Search query |

**Response**: `DecisionRecord[]`

---

### `GET /coordination/decisions/:id`

Get a single decision record.

**Response**: `DecisionRecord`

---

### `GET /coordination/coverage`

Code coverage history and trends.

**Response**: `{ "history": ..., "latest": ..., "trend": ... }`

---

### `GET /coordination/complexity`

Code complexity metrics.

**Response**: `{ "alerts": ..., "files": ..., "highComplexity": ... }`

---

### `GET /coordination/dependencies`

Workspace dependency graph.

**Response**: `{ "workspaces": ..., "counts": ... }`

---

### `GET /coordination/escalations`

List escalations.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `all` | query | string | no | `"true"` to include resolved |

**Response**: `{ "escalations": ..., "rules": ... }`

---

### `PUT /coordination/escalations/:id/resolve`

Resolve an escalation.

**Response**: `{ "ok": true }`

---

### `GET /coordination/model-selector`

Model selector configuration.

**Response**: `{ "models": ..., "overrides": ... }`

---

### `GET /coordination/token-budgets`

Token budget statistics.

**Response**: `{ "budgets": ..., "totalBudget": number, "totalUsed": number, "utilization": number }`

---

### `GET /coordination/parallel-analysis`

Parallel execution analysis.

**Response**: `ParallelAnalysis`

---

### `GET /coordination/project-templates/search`

Search project templates.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `keyword` | query | string | yes | Search keyword |

**Response**: `Template[]`

---

### `GET /coordination/project-templates`

List all project templates.

**Response**: `Template[]`

---

### `GET /coordination/project-templates/:id`

Get a single project template.

**Response**: `Template`

---

### `GET /coordination/knowledge/search`

Search the knowledge transfer store.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `q` | query | string | yes | Search query |

**Response**: `Knowledge[]`

---

### `GET /coordination/knowledge/popular`

Popular knowledge entries.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `limit` | query | number | no | 1–100 (default 10) |

**Response**: `Knowledge[]`

---

### `GET /coordination/knowledge`

Query knowledge entries.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Filter by project |
| `category` | query | string | no | Filter by category |
| `tag` | query | string | no | Filter by tag |

**Response**: `Knowledge[]`

---

### `POST /coordination/knowledge`

Create a knowledge entry.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | body | string | yes | Project ID |
| `category` | body | string | yes | Knowledge category |
| `title` | body | string | yes | Entry title |
| `content` | body | string | yes | Entry content |
| `tags` | body | string[] | no | Tags |

**Response** `201`: `Knowledge`

---

## Costs

### `GET /costs/by-agent`

Token/cost breakdown per agent.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Filter by project |

**Response**: `AgentCost[]`

---

### `GET /costs/by-task`

Cost breakdown per task.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | query | string | no | Filter by lead |
| `projectId` | query | string | no | Filter by project |

**Response**: `TaskCost[]`

---

### `GET /costs/agent/:agentId`

Costs for a specific agent.

**Response**: `TaskCost[]`

---

### `GET /costs/by-project`

Costs aggregated by project.

**Response**: `ProjectCost[]`

---

### `GET /costs/by-session`

Costs for sessions within a project.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | yes | Project ID |

**Response**: `SessionCost[]`

---

## Crew Management

### `GET /crews`

List crews, optionally scoped to a project. Rate-limited (`readLimiter`).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Scope to project |

**Response**: `{ "crews": [{ "crewId": string, "agentCount": number, "roles": ... }] }`

---

### `GET /crews/summary`

Crew groups with stats, sorted by active first. Rate-limited (`readLimiter`).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Scope to project |

**Response**: `[{ "leadId": string, "projectId": string, "agentCount": number, "activeAgentCount": number, "sessionCount": number, "lastActivity": string, "agents": Agent[] }]`

---

### `GET /crews/:crewId`

Get crew details. Rate-limited (`readLimiter`).

**Response**: `{ "crewId": string, "agentCount": number, "agents": Agent[], "knowledgeCount": number, "trainingSummary?": ... }`

---

### `GET /crews/:crewId/agents`

List agents in a crew with live status. Rate-limited (`readLimiter`).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Filter by project |
| `status` | query | string | no | `"idle"`, `"running"`, `"terminated"`, `"failed"` |

**Response**: Enriched `Agent[]`

---

### `GET /crews/:crewId/agents/:agentId/profile`

Agent profile with live and historical data. Rate-limited (`readLimiter`).

**Response**: `{ "agentId": string, "role": string, "model": string, "status": string, "liveStatus": string, "teamId": string, "projectId": string, "lastTaskSummary": string, "createdAt": string, "updatedAt": string, "knowledgeCount": number, "live?": ... }`

---

### `GET /crews/:crewId/health`

Crew health report with status counts and uptime. Rate-limited (`readLimiter`).

**Response**: `{ "crewId": string, "totalAgents": number, "statusCounts": ..., "agents": Agent[] }`

---

### `POST /crews/:crewId/agents/:agentId/clone`

Clone an agent. Rate-limited (`writeLimiter`).

**Response**: `{ "ok": true, "clone": Agent }`

---

### `DELETE /crews/:leadId`

Delete a crew (lead + all children) from the roster. Rate-limited (`writeLimiter`).

**Response**: `{ "ok": true, "deleted": number }`

---

### `DELETE /roster/:agentId`

Remove a single agent from the roster. Rate-limited (`writeLimiter`).

**Response**: `{ "ok": true, "agentId": string }`

---

## Data Management

### `GET /data/stats`

Database statistics.

**Response**: `{ "fileSizeBytes": number, "tableCounts": Record<string, number>, "totalRecords": number, "oldestSession?": string }`

---

### `POST /data/cleanup`

Purge old data. Uses session-based cleanup with FK ordering.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `olderThanDays` | body | number | yes | Days threshold (0 = all) |
| `dryRun` | body | boolean | no | Preview without deleting |

**Response**: `{ "deleted": Record<string, number>, "totalDeleted": number, "sessionsDeleted": number, "dryRun": boolean, "cutoffDate": string }`

---

## Database Browser

### `GET /db/memory`

List all agent memories (descending by creation time).

**Response**: `AgentMemory[]`

---

### `DELETE /db/memory/:id`

Delete a memory entry.

**Response**: `{ "ok": true }`

---

### `GET /db/conversations`

List all conversations.

**Response**: `Conversation[]`

---

### `GET /db/conversations/:id/messages`

Get messages for a conversation (oldest first).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `limit` | query | number | no | 1–1000 (default 100) |

**Response**: `Message[]`

---

### `DELETE /db/conversations/:id`

Delete a conversation and all its messages.

**Response**: `{ "ok": true }`

---

### `GET /db/decisions`

List all decisions.

**Response**: `Decision[]`

---

### `DELETE /db/decisions/:id`

Delete a decision.

**Response**: `{ "ok": true }`

---

### `GET /db/activity`

List the activity log (descending by timestamp).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `limit` | query | number | no | 1–2000 (default 200) |

**Response**: `ActivityLog[]`

---

### `DELETE /db/activity/:id`

Delete an activity entry.

**Response**: `{ "ok": true }`

---

### `GET /db/stats`

Row counts across key database tables.

**Response**: `{ "memory": number, "conversations": number, "messages": number, "decisions": number, "activity": number, "dagTasks": number }`

---

## Decisions

### `GET /decisions`

List decisions, optionally filtered by status or grouped.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `needs_confirmation` | query | string | no | `"true"` for pending only |
| `grouped` | query | string | no | `"true"` to group by lead |
| `projectId` | query | string | no | Filter by project |

**Response**: `Decision[]` or grouped structure

---

### `POST /decisions/:id/confirm`

Confirm a decision and execute any pending system actions.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `reason` | body | string | no | Reason for confirmation |

**Response**: `Decision`

---

### `POST /decisions/:id/reject`

Reject a decision.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `reason` | body | string | no | Reason for rejection |

**Response**: `Decision`

---

### `POST /decisions/:id/dismiss`

Silently dismiss a decision (does not notify the lead).

**Response**: `Decision`

---

### `POST /decisions/:id/respond`

Confirm and send feedback message to the agent.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `message` | body | string | yes | Feedback message |

**Response**: `Decision`

---

### `POST /decisions/:id/feedback`

Send feedback without changing decision status.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `message` | body | string | yes | Feedback message |

**Response**: `{ "ok": true, "decision": Decision }`

---

### `POST /decisions/batch`

Batch operation on multiple decisions.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `ids` | body | string[] | yes | Decision IDs |
| `action` | body | string | yes | `"confirm"`, `"reject"`, or `"dismiss"` |
| `reason` | body | string | no | Reason |

**Response**: `{ "results": Decision[], "failed": string[] }`

---

### `POST /decisions/pause-timer`

Pause or resume decision auto-confirmation timers.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `paused` | body | boolean | yes | `true` to pause, `false` to resume |

**Response**: `{ "paused": boolean }`

---

## Export

### `GET /export/:leadId`

Export session data to files.

**Response**: `{ "success": boolean, "files": ..., "outputDir": string }`

---

## Integrations

All routes rate-limited (`integrationLimiter`).

### `GET /integrations/status`

Integration system status.

**Response**: `{ "enabled": boolean, "adapters": [{ "platform": string, "running": boolean }], "sessions": Session[], "pendingNotifications": number, "subscriptions": ... }`

---

### `POST /integrations/sessions`

Initiate challenge-response session binding.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `chatId` | body | string | yes | External chat ID |
| `platform` | body | string | yes | Platform name |
| `projectId` | body | string | yes | Project to bind |
| `boundBy` | body | string | no | Who initiated binding |

**Response** `202`: `{ "status": "challenge_sent", "chatId": string, "expiresAt": string, "message": string }`

---

### `POST /integrations/sessions/verify`

Complete challenge verification.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `chatId` | body | string | yes | External chat ID |
| `code` | body | string | yes | Challenge code |

**Response** `201`: `Session`

---

### `GET /integrations/sessions`

List all active integration sessions.

**Response**: `Session[]`

---

### `POST /integrations/subscriptions`

Subscribe to project notifications.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `chatId` | body | string | yes | External chat ID |
| `projectId` | body | string | yes | Project ID |
| `categories` | body | string[] | no | Notification categories |

**Response** `201`: `{ "chatId": string, "projectId": string, "categories": string[] }`

---

### `DELETE /integrations/subscriptions`

Unsubscribe from notifications.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `chatId` | body | string | yes | External chat ID |
| `projectId` | body | string | yes | Project ID |

**Response** `204`: No content

---

### `GET /integrations/subscriptions`

List all subscriptions.

**Response**: `Subscription[]`

---

### `POST /integrations/test-message`

Send a test message to an external chat.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `platform` | body | string | yes | Platform name |
| `chatId` | body | string | yes | Chat ID |
| `text` | body | string | yes | Message text |

**Response**: `{ "sent": true }`

---

### `PATCH /integrations/telegram`

Update Telegram configuration in YAML.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `enabled` | body | boolean | no | Enable/disable |
| `botToken` | body | string | no | Bot token |
| `allowedChatIds` | body | array | no | Allowed chat IDs |
| `rateLimitPerMinute` | body | number | no | Rate limit |
| `notifications` | body | object | no | Notification config |

**Response**: `{ "ok": true, "updated": string[] }`

---

## Knowledge (Project-Scoped)

### `GET /projects/:id/knowledge`

List knowledge entries for a project.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `category` | query | string | no | `"core"`, `"episodic"`, `"procedural"`, `"semantic"` |

**Response**: `KnowledgeEntry[]`

Rate-limited (`knowledgeReadLimiter`).

---

### `GET /projects/:id/knowledge/search`

Full-text search on project knowledge.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `q` | query | string | yes | Search query (max 500 chars) |
| `category` | query | string | no | Category filter |
| `limit` | query | number | no | 1–100 (default 20) |

**Response**: `KnowledgeEntry[]`

Rate-limited (`knowledgeSearchLimiter`).

---

### `GET /projects/:id/knowledge/stats`

Knowledge category statistics.

**Response**: `{ "core": number, "episodic": number, "procedural": number, "semantic": number }`

Rate-limited (`knowledgeReadLimiter`).

---

### `GET /projects/:id/knowledge/training`

Training corrections and feedback summary.

**Response**: `TrainingSummary`

Rate-limited (`knowledgeReadLimiter`).

---

### `POST /projects/:id/knowledge`

Create or update a knowledge entry.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `category` | body | string | yes | Knowledge category |
| `key` | body | string | yes | Unique key within category |
| `content` | body | string | yes | Entry content |
| `metadata` | body | object | no | Additional metadata |

**Response** `201`: `KnowledgeEntry`

Rate-limited (`knowledgeWriteLimiter`).

---

### `DELETE /projects/:id/knowledge/:category/:key`

Delete a knowledge entry.

Rate-limited (`knowledgeWriteLimiter`).

**Response**: `{ "ok": true }`

---

## Lead Management

### `POST /lead/start`

Start or resume a project lead agent. Rate-limited (`spawnLimiter`).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `task` | body | string | no | Initial task |
| `name` | body | string | no | Project name |
| `model` | body | string | no | Model override |
| `cwd` | body | string | no | Working directory |
| `sessionId` | body | string | no | Session ID to resume |
| `projectId` | body | string | no | Project ID |

**Response** `201`: `Agent`

---

### `GET /lead`

List lead agents.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `projectId` | query | string | no | Scope to project |

**Response**: `Agent[]`

---

### `GET /lead/:id`

Get a specific lead agent.

**Response**: `Agent`

---

### `POST /lead/:id/message`

Send a message to a lead. Rate-limited (`messageLimiter`).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `text` | body | string | yes | Message content |
| `mode` | body | string | no | `"queue"` or `"interrupt"` (default `"interrupt"`) |
| `attachments` | body | array | no | `[{ name, mimeType, data }]` |

**Response**: `{ "ok": true, "mode": string, "pending?": number }`

---

### `PATCH /lead/:id`

Update a lead's working directory or project name.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `cwd` | body | string | no | New working directory |
| `projectName` | body | string | no | New project name |

**Response**: `Agent`

---

### `GET /lead/:id/decisions`

List decisions for a specific lead.

**Response**: `Decision[]`

---

### `GET /lead/:id/groups`

List chat groups for a lead.

**Response**: `ChatGroup[]`

---

### `POST /lead/:id/groups`

Create a chat group (auto-includes the human user).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `name` | body | string | yes | Group name |
| `memberIds` | body | string[] | no | Initial member agent IDs |

**Response** `201`: `ChatGroup`

---

### `GET /lead/:id/groups/:name/messages`

Get group messages.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `limit` | query | number | no | Max messages (default 50) |

**Response**: `Message[]`

---

### `POST /lead/:id/groups/:name/messages`

Send a message to a group chat.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `content` | body | string | yes | Message text |

**Response** `201`: `Message`

---

### `POST /lead/:id/groups/:name/messages/:messageId/reactions`

Add an emoji reaction to a group message.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `emoji` | body | string | yes | Emoji (max 8 chars) |

**Response**: `{ "success": boolean }`

---

### `DELETE /lead/:id/groups/:name/messages/:messageId/reactions/:emoji`

Remove an emoji reaction.

**Response**: `{ "success": boolean }`

---

### `GET /lead/:id/delegations`

Get active delegations for a lead.

**Response**: `Delegation[]`

---

### `GET /lead/:id/dag`

Get the task DAG for a lead.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `includeArchived` | query | string | no | `"true"` to include archived tasks |

**Response**: `{ "id": string, "status": string, "nodes": ..., "edges": ... }`

---

### `GET /lead/:id/progress`

Progress overview for a lead.

**Response**: `{ "totalDelegations": number, "active": number, "completed": number, "failed": number, "completionPct": number, "teamSize": number, "leadTokens?": number, "teamAgents": Agent[], "delegations": Delegation[] }`

---

## Timers

### `GET /timers`

List all active/pending timers.

**Response**: `Timer[]`

---

### `POST /timers`

Create a timer.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `agentId` | body | string | yes | Agent owning the timer |
| `label` | body | string | yes | Timer label |
| `message` | body | string | no | Message to deliver on fire |
| `delaySeconds` | body | number | yes | 1–86400 |
| `repeat` | body | boolean | no | Whether the timer repeats |
| `projectId` | body | string | no | Project scope |

**Response** `201`: `Timer`

---

### `DELETE /timers/:timerId`

Cancel a timer.

**Response**: `{ "success": true }`

---

## Models

### `GET /models`

List all known models and default configuration.

**Response**: `{ "models": string[], "defaults": ModelConfig, "modelsByProvider": Record<string, string[]>, "activeProvider": string }`

---

## Natural Language Commands

### `GET /nl/commands`

List all registered command patterns.

**Response**: `{ "commands": CommandPattern[] }`

---

### `POST /nl/preview`

Preview what a command would do without executing.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `command` | body | string | yes | Natural language command |
| `leadId` | body | string | yes | Target lead agent |

**Response**: `Plan` or `404`

---

### `POST /nl/execute`

Match, plan, and execute a natural language command.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `command` | body | string | yes | Natural language command |
| `leadId` | body | string | yes | Target lead agent |

**Response**: `Result` or `404`

---

### `POST /nl/undo`

Undo a previously executed command.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `commandId` | body | string | yes | Command ID to undo |

**Response**: `Result`

---

### `GET /nl/suggestions`

Context-aware action suggestions.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | query | string | yes | Lead agent ID |

**Response**: `{ "suggestions": string[] }`

---

## Notifications

### `GET /notifications`

List notifications.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `unreadOnly` | query | string | no | Filter to unread only |
| `category` | query | string | no | Filter by category |
| `limit` | query | number | no | Max results |

**Response**: `{ "notifications": Notification[], "unreadCount": number }`

---

### `PUT /notifications/read-all`

Mark all notifications as read.

**Response**: `{ "ok": true }`

---

### `PUT /notifications/:id/read`

Mark a single notification as read.

**Response**: `{ "ok": true }`

---

### `GET /notifications/preferences`

Get notification preferences.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `userId` | query | string | no | User ID (default `"default"`) |

**Response**: `NotificationPreferences`

---

### `PUT /notifications/preferences`

Set notification preferences.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `userId` | body | string | no | User ID |
| ...prefs | body | object | yes | Preference fields |

**Response**: Updated `NotificationPreferences`

---

## Onboarding

### `GET /onboarding/status`

Get onboarding state.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `userId` | query | string | no | User ID (default `"default"`) |

**Response**: `{ "tourComplete": boolean, "completedSteps": string[], "tier": string, "sessionCount": number, "coachDismissed": string[] }`

---

### `POST /onboarding/progress`

Update onboarding progress.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `userId` | body | string | no | User ID |
| `tourComplete` | body | boolean | no | Mark tour as complete |
| `completedStep` | body | string | no | Step to mark complete |
| `tier` | body | string | no | New tier |
| `incrementSession` | body | boolean | no | Increment session count |
| `coachDismissed` | body | string | no | Coach tip to dismiss |

**Response**: Updated state object

---

## Predictions

### `GET /predictions`

List active predictions.

**Response**: `{ "predictions": Prediction[] }`

---

### `GET /predictions/history`

List resolved predictions.

**Response**: `{ "predictions": Prediction[] }`

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

**Response**: `{ "ok": true }`

---

### `POST /predictions/:id/resolve`

Resolve a prediction with an outcome.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `outcome` | body | string | yes | `"correct"`, `"avoided"`, or `"wrong"` |

**Response**: `{ "ok": true }`

---

### `POST /predictions/generate`

Manually trigger prediction generation.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `agents` | body | array | yes | Agent data for analysis |
| `budget` | body | object | no | Budget constraints |

**Response**: `{ "predictions": Prediction[], "count": number }`

---

## Projects

### `GET /projects`

List all projects enriched with active agent counts and costs.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `status` | query | string | no | Filter by status |

**Response**: `Project[]`

---

### `POST /projects`

Create a new project.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `name` | body | string | yes | Project name |
| `description` | body | string | no | Description |
| `cwd` | body | string | no | Working directory |

**Response** `201`: `Project`

---

### `POST /projects/import`

Import a project from an existing `.flightdeck/` directory.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `cwd` | body | string | yes | Path to project directory |
| `name` | body | string | no | Override project name |

**Response** `201`: `{ ...Project, "imported": { "hasScreenshots": boolean, "artifactSessionCount": number } }`

**Errors**: `400` no `.flightdeck/` dir · `409` project already registered

---

### `GET /projects/:id`

Get project details with sessions, active lead, and agent counts.

**Response**: `Project`

---

### `PATCH /projects/:id`

Update project metadata.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `name` | body | string | no | New name |
| `description` | body | string | no | New description |
| `cwd` | body | string | no | New working directory |
| `status` | body | string | no | New status |
| `oversightLevel` | body | string | no | `"supervised"`, `"balanced"`, `"autonomous"` |

**Response**: `Project`

---

### `DELETE /projects/:id`

Delete an archived project and cascade-remove roster agents.

**Errors**: `400` project not archived

**Response**: `{ "ok": true, "rosterDeleted": number }`

---

### `GET /projects/:id/briefing`

Get project briefing (context for new sessions).

**Response**: `{ ...Briefing, "formatted": string }`

---

### `POST /projects/:id/resume`

Resume a project session. Rate-limited (`spawnLimiter`).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `task` | body | string | no | Task for the lead |
| `model` | body | string | no | Model override |
| `freshStart` | body | boolean | no | Create new session instead of resuming |
| `resumeAll` | body | boolean | no | Respawn all agents from last session |
| `agents` | body | string[] | no | Specific agent IDs to respawn |
| `sessionId` | body | number | no | Specific session to resume |

**Response** `201`: `{ ...Agent, "respawning": number }`

**Errors**: `409` already active · `404` no session found

---

### `POST /projects/:id/stop`

Stop all running agents for a project.

**Response**: `{ "ok": true, "terminated": number, "total": number }`

---

### `GET /projects/:id/sessions/detail`

Enriched session history.

**Response**: `[{ "id": number, "leadId": string, "status": string, "task": string, "startedAt": string, "endedAt": string, "durationMs": number, "agents": Agent[], "taskSummary": ..., "hasRetro": boolean }]`

---

### `GET /projects/:id/dag`

Historical DAG tasks for a project.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `includeArchived` | query | string | no | `"true"` to include archived |

**Response**: `{ "tasks": DagTask[], "fileLockMap": ..., "summary": ... }`

---

### `PATCH /projects/:id/tasks/:taskId/status`

Transition a task's status (used by Kanban drag-drop).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `status` | body | string | yes | New status |

**Response**: Updated `DagTask`

---

### `PATCH /projects/:id/tasks/:taskId/priority`

Update a task's priority (used by Kanban reordering).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `priority` | body | number | yes | New priority (finite number) |

**Response**: `{ "ok": true, "task": DagTask }`

---

### `POST /projects/:id/tasks`

Create a new task from the Kanban board.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `title` | body | string | no | Task title (title or description required) |
| `description` | body | string | no | Task description |
| `role` | body | string | yes | Assigned role |
| `priority` | body | number | no | Priority (default 0) |
| `dependsOn` | body | string[] | no | Dependency task IDs |
| `files` | body | string[] | no | Associated files |

**Response** `201`: `{ "ok": true, "taskId": string, "tasks": DagTask[] }`

---

### `GET /projects/:id/groups`

Get historical chat groups for a project.

**Response**: `[{ "name": string, "leadId": string, "roles": string, "createdAt": string, "messageCount": number }]`

---

### `GET /projects/:id/groups/:name/messages`

Get historical messages for a specific chat group.

**Response**: `Message[]`

---

### `GET /projects/:id/messages`

Get cross-session messages for a project.

**Response**: `Message[]`

---

### `GET /projects/:id/model-config`

Get project-specific model configuration.

**Response**: `ModelConfig`

---

### `PUT /projects/:id/model-config`

Update project model configuration.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `config` | body | object | yes | Model config object (validated against known model IDs) |

**Response**: `ModelConfig`

---

### `GET /projects/:id/files`

Directory listing for the project's working directory. Security: symlink-aware, restricted to project CWD.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `path` | query | string | no | Relative subdirectory path |

**Response**: `{ "path": string, "items": [{ "name": string, "path": string, "type": "directory" | "file", "ext?": string }] }`

---

### `GET /projects/:id/file-contents`

Read file content (text only, max 512 KB). Security: symlink-aware, restricted to project CWD.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `path` | query | string | yes | Relative file path |

**Response**: `{ "path": string, "content": string, "size": number, "ext": string }`

**Errors**: `403` outside project dir · `413` file too large · `404` not found

---

### `GET /projects/:id/artifacts`

List markdown artifacts from organized storage, grouped by agent and session.

**Response**: `{ "groups": ArtifactGroup[], "artifactBasePath": string }`

---

### `GET /projects/:id/artifact-contents`

Read artifact file content from organized storage.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `path` | query | string | yes | Relative path within artifact storage |

**Response**: `{ "path": string, "content": string, "size": number, "ext": string }`

---

### `GET /projects/:id/session-artifact`

Read artifact from an agent's Copilot CLI session directory. Security: allowlisted paths only (`plan.md`, `checkpoints/`, `files/`, `research/`).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `agentId` | query | string | yes | Agent ID |
| `path` | query | string | yes | File path (must match allowlist) |

**Response**: `{ "path": string, "content": string, "size": number, "ext": string }`

---

## Replay

### `GET /replay/:leadId/state`

Reconstruct world state at a specific timestamp.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `at` | query | string | yes | ISO timestamp |

**Response**: `WorldState`

---

### `GET /replay/:leadId/events`

Get events in a time range.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `from` | query | string | yes | ISO start time |
| `to` | query | string | yes | ISO end time |
| `limit` | query | number | no | 1–500 (default 50) |
| `types` | query | string | no | Comma-separated event types |

**Response**: `{ "events": Activity[] }`

---

### `GET /replay/:leadId/keyframes`

Get keyframes for session replay scrubbing.

**Response**: `{ "keyframes": Keyframe[] }`

---

### `POST /replay/:leadId/share`

Create a public share link for session replay.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `expiresInHours` | body | number | no | Link expiry |
| `label` | body | string | no | Human-readable label |

**Response** `201`: `ShareLink`

---

### `GET /replay/:leadId/shares`

List share links for a lead.

**Response**: `ShareLink[]`

---

### `DELETE /shared/:token`

Revoke a share link.

**Response**: `{ "revoked": true }`

---

### `GET /shared/:token` :badge[Public]{type="tip"}

Access a shared replay (no authentication required).

**Response**: `{ "leadId": string, "label": string, "expiresAt": string, "keyframes": Keyframe[], "state": WorldState }`

---

### `GET /shared/:token/state` :badge[Public]{type="tip"}

Get shared replay state at a specific timestamp (no authentication required).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `at` | query | string | yes | ISO timestamp |

**Response**: `WorldState`

---

## Reports

### `GET /reports/session`

Generate a session report.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `leadId` | query | string | no | Lead agent ID |
| `projectId` | query | string | no | Project ID |
| `format` | query | string | no | `"md"` or `"html"` (default `"html"`) |

**Response**: HTML or Markdown report

---

## Roles

### `GET /roles`

List all registered roles.

**Response**: `Role[]`

---

### `POST /roles`

Register a new role.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `name` | body | string | yes | Role name |
| `systemPrompt` | body | string | yes | System prompt |
| `description` | body | string | yes | Description |
| `model` | body | string | yes | Default model |

**Response** `201`: `Role`

---

### `DELETE /roles/:id`

Remove a role.

**Response**: `{ "ok": boolean }`

---

### `POST /roles/test`

Dry-run test a role configuration.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `role` | body | object | yes | Role definition |
| `message` | body | string | yes | Test message |

**Response**: `{ "response": string, "role": string, "valid": boolean }`

---

## Search

### `GET /search`

Multi-source full-text search across conversations, groups, tasks, decisions, and activity.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `q` | query | string | yes | Search query (2–200 chars) |
| `limit` | query | number | no | 1–200 (default 50) |
| `types` | query | string | no | Comma-separated source types |
| `agentId` | query | string | no | Filter by agent |
| `leadId` | query | string | no | Filter by lead |
| `since` | query | string | no | ISO timestamp |

**Response**: `{ "query": string, "count": number, "results": [{ "source": string, "id": string, "content": string, "timestamp": string, ... }] }`

---

## Settings

### `GET /settings/providers`

Get provider configurations (instant, no CLI detection).

**Response**: `ProviderConfig[]`

---

### `GET /settings/providers/status`

Async provider detection with caching (checks installed, auth, version).

**Response**: `ProviderStatus[]`

---

### `GET /settings/providers/:provider`

Single provider status with model preferences.

**Response**: `{ ...ProviderStatus, "modelPreferences": ... }`

---

### `POST /settings/providers/:provider/test`

Test provider connection and authentication.

**Response**: `{ "success": boolean, "message": string }`

---

### `PUT /settings/providers/:provider`

Update provider configuration.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `enabled` | body | boolean | no | Enable/disable |
| `modelPreferences` | body | object | no | Model preferences |

**Response**: `{ ...ProviderStatus, "modelPreferences": ... }`

---

### `PUT /settings/provider`

Set the active provider.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `id` | body | string | yes | Provider ID |

**Response**: `{ "activeProvider": string }`

---

### `GET /settings/provider-ranking`

Get provider preference order.

**Response**: `{ "ranking": string[] }`

---

### `PUT /settings/provider-ranking`

Set provider preference order.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `ranking` | body | string[] | yes | Ordered provider IDs |

**Response**: `{ "ranking": string[] }`

---

## Summary / Catch-Up

### `GET /summary/:leadId/since`

Get a session summary since a timestamp.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `t` | query | string | yes | ISO timestamp |

**Response**: `CatchUpSummary`

---

### `GET /catchup/:leadId`

Alias for summary (cleaner URL).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `since` or `t` | query | string | yes | ISO timestamp |

**Response**: `CatchUpSummary`

---

## Tasks

### `GET /tasks`

Query tasks across the system.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `scope` | query | string | no | `"global"`, `"project"`, or `"lead"` (default `"global"`) |
| `projectId` | query | string | no | Filter by project |
| `leadId` | query | string | no | Filter by lead |
| `status` | query | string | no | Comma-separated statuses |
| `role` | query | string | no | Filter by role |
| `assignedAgentId` | query | string | no | Filter by assigned agent |
| `includeArchived` | query | string | no | `"true"` to include archived |
| `limit` | query | number | no | 1–1000 (default 200) |
| `offset` | query | number | no | Pagination offset (default 0) |

**Response**: `{ "tasks": DagTask[], "total": number, "limit": number, "offset": number, "hasMore": boolean, "scope": string, "projectId?": string }`

---

### `PATCH /tasks/:leadId/:taskId/unarchive`

Restore an archived task.

**Response**: Updated `DagTask`

---

### `GET /attention`

Aggregate attention items (failed tasks, blocked tasks, pending decisions).

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `scope` | query | string | no | `"global"` or `"project"` |
| `projectId` | query | string | no | Filter by project |

**Response**: `{ "scope": string, "projectId?": string, "escalation": "green" | "yellow" | "red", "summary": string, "items": AttentionItem[] }`

---

## Webhooks

### `GET /webhooks`

List registered webhooks.

**Response**: `Webhook[]`

---

### `POST /webhooks`

Register a new webhook.

| Name | In | Type | Required | Description |
|------|----|------|----------|-------------|
| `url` | body | string | yes | Webhook URL |
| `events` | body | string[] | yes | Events to subscribe to |
| `secret` | body | string | no | Signing secret |
| `enabled` | body | boolean | no | Enable on creation |

**Response** `201`: `Webhook`

---

### `DELETE /webhooks/:id`

Delete a webhook.

**Response**: `{ "removed": boolean }`

---

### `GET /webhooks/:id/deliveries`

Get webhook delivery history.

**Response**: `Delivery[]`
