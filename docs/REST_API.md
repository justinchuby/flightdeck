# Flightdeck REST API Reference

For external agent integration (e.g., OpenClaw). Base URL: `http://localhost:3001/api`

All endpoints return JSON. No authentication required by default (configurable via `flightdeck.config.yaml`).

---

## Quick Start — OpenClaw Integration

```
1. Start Flightdeck:  flightdeck --no-browser
2. Create a project:  POST /api/lead/start
3. Send instructions:  POST /api/lead/{id}/message
4. Poll progress:     GET /api/lead/{id}/dag
5. Approve decisions: POST /api/decisions/{id}/confirm
```

---

## 🔍 System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/config` | Server configuration |
| GET | `/system/status` | System status (paused/running) |
| POST | `/system/pause` | Pause all agent spawning |
| POST | `/system/resume` | Resume agent spawning |
| GET | `/settings/providers/status` | Provider availability (installed, authenticated) |
| GET | `/roles` | Available agent roles |
| GET | `/models` | Available models |
| GET | `/budget` | Agent budget (current/max) |

### Health Check

```
GET /api/config
→ 200 { ... }    # server is up
→ ECONNREFUSED   # server is down
```

---

## 📁 Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects` | List all projects |
| GET | `/projects/{id}` | Project details |
| POST | `/projects` | Create project (without starting lead) |
| PATCH | `/projects/{id}` | Update project metadata |
| DELETE | `/projects/{id}` | Delete project |
| POST | `/projects/{id}/stop` | Stop a running project |
| POST | `/projects/{id}/resume` | Resume a stopped project |
| GET | `/projects/{id}/dag` | Task DAG for project |
| GET | `/projects/{id}/groups` | Chat groups in project |
| GET | `/projects/{id}/messages` | All messages in project |

### Create & Start a Project (most common)

```http
POST /api/lead/start
Content-Type: application/json

{
  "task": "Refactor the auth module to use JWT tokens",
  "workingDir": "/path/to/your/repo",
  "provider": "copilot",
  "model": "claude-opus-4.6"
}

→ 200 { "id": "lead-abc12345", "projectId": "proj-xyz..." }
```

This creates a project AND starts a lead agent in one call. The `id` in the response is the **lead agent ID** — use it for all subsequent `/lead/{id}/*` calls.

---

## 👤 Lead Agent (Project Coordinator)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/lead` | List all lead agents |
| GET | `/lead/{id}` | Lead agent details + conversation |
| POST | `/lead/{id}/message` | **Send a message to the lead** |
| GET | `/lead/{id}/decisions` | Decisions made by this lead's crew |
| GET | `/lead/{id}/dag` | Task DAG managed by this lead |
| GET | `/lead/{id}/delegations` | Active delegations |
| GET | `/lead/{id}/progress` | Progress summary |
| GET | `/lead/{id}/groups` | Chat groups |

### Send a Message to the Lead

```http
POST /api/lead/{id}/message
Content-Type: application/json

{
  "content": "Please also add input validation to all endpoints"
}

→ 200 { "queued": true }
```

This is how OpenClaw talks to the Flightdeck lead. The lead will read the message, break it down, and delegate to its crew.

---

## 🤖 Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/agents` | List all agents (filter: `?projectId=...&status=active`) |
| POST | `/agents` | Spawn a new agent |
| GET | `/agents/{id}/messages` | Agent conversation history |
| POST | `/agents/{id}/message` | Send message to a specific agent |
| POST | `/agents/{id}/interrupt` | Interrupt agent's current work |
| POST | `/agents/{id}/restart` | Restart an agent |
| POST | `/agents/{id}/terminate` | Terminate an agent |
| DELETE | `/agents/{id}` | Remove agent |
| GET | `/agents/{id}/tasks` | Tasks assigned to this agent |
| GET | `/agents/{id}/queue` | Message queue for this agent |
| GET | `/agents/{id}/focus` | What the agent is currently working on |

### List Active Agents

```http
GET /api/agents?projectId=proj-xyz&status=active

→ 200 [
  {
    "id": "agent-abc12345",
    "role": "developer",
    "model": "claude-opus-4.6",
    "status": "active",
    "currentTask": "Implementing JWT auth",
    "provider": "copilot"
  },
  ...
]
```

### Spawn an Agent

```http
POST /api/agents
Content-Type: application/json

{
  "role": "developer",
  "model": "claude-opus-4.6",
  "projectId": "proj-xyz",
  "task": "Write unit tests for auth module"
}
```

---

## 📋 Tasks (DAG)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tasks` | All tasks (filter: `?projectId=...&status=running`) |
| GET | `/projects/{id}/dag` | Full task DAG for a project |
| PATCH | `/projects/{id}/tasks/{taskId}/status` | Update task status |
| POST | `/projects/{id}/tasks` | Add a task to the DAG |
| GET | `/attention` | Tasks needing human attention |

### Get Task DAG

```http
GET /api/projects/{projectId}/dag

→ 200 {
  "tasks": [
    {
      "taskId": "implement-auth",
      "description": "Implement JWT auth",
      "status": "done",
      "assignee": "agent-abc12345",
      "dependsOn": []
    },
    {
      "taskId": "review-auth",
      "description": "Review auth implementation",
      "status": "running",
      "assignee": "agent-def67890",
      "dependsOn": ["implement-auth"]
    }
  ]
}
```

### Update Task Status

```http
PATCH /api/projects/{projectId}/tasks/{taskId}/status
Content-Type: application/json

{ "status": "done" }
```

---

## ✅ Decisions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/decisions` | All pending decisions (filter: `?projectId=...`) |
| POST | `/decisions/{id}/confirm` | Approve a decision |
| POST | `/decisions/{id}/reject` | Reject a decision |
| POST | `/decisions/{id}/dismiss` | Dismiss (no action needed) |
| POST | `/decisions/{id}/feedback` | Send feedback on a decision |
| POST | `/decisions/batch` | Batch approve/reject multiple |

### Approve a Decision

```http
POST /api/decisions/{id}/confirm
Content-Type: application/json

{ "reason": "Approved — good approach" }

→ 200 { "confirmed": true }
```

### Batch Approve

```http
POST /api/decisions/batch
Content-Type: application/json

{
  "action": "confirm",
  "ids": ["dec-001", "dec-002", "dec-003"]
}
```

---

## 📊 Coordination & Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/coordination/status` | Overview (agents, locks, activity) |
| GET | `/coordination/locks` | File locks |
| GET | `/coordination/activity` | Recent activity log (`?limit=50`) |
| GET | `/coordination/summary` | Coordination summary |
| GET | `/coordination/timeline` | Timeline events |
| GET | `/coordination/alerts` | System alerts |
| GET | `/coordination/escalations` | Items needing escalation |

---

## 💰 Costs & Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/analytics` | Analytics overview (`?projectId=...`) |
| GET | `/costs/by-agent` | Token usage per agent |
| GET | `/costs/by-task` | Token usage per task |
| GET | `/costs/by-project` | Token usage per project |
| GET | `/costs/agent/{agentId}` | Detailed costs for one agent |

---

## 👥 Crews

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/crews` | List all crews |
| GET | `/crews/summary` | Crew summaries |
| GET | `/crews/{crewId}` | Crew details |
| GET | `/crews/{crewId}/agents` | Agents in a crew |
| GET | `/crews/{crewId}/health` | Crew health metrics |

---

## 🔔 Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/notifications` | All notifications |
| PUT | `/notifications/read-all` | Mark all as read |
| PUT | `/notifications/{id}/read` | Mark one as read |

---

## Typical OpenClaw Integration Flow

```
                    OpenClaw                          Flightdeck
                    ────────                          ──────────
                        │
                        ├──POST /lead/start──────────►  Create project + lead
                        │                               Lead plans & spawns crew
                        │
     (poll loop)        ├──GET /agents?projectId=...─►  Check who's working
                        ├──GET /lead/{id}/dag────────►  Check task progress
                        ├──GET /decisions?projectId=.►  Check pending decisions
                        │
     (if decisions)     ├──POST /decisions/{id}/confirm► Approve
                        │
     (give feedback)    ├──POST /lead/{id}/message───►  "Also add caching"
                        │                               Lead re-plans, delegates
                        │
     (check done)       ├──GET /lead/{id}/dag────────►  All tasks "done"?
                        │
                        └──POST /projects/{id}/stop──►  Done!
```

### Polling Interval Recommendations

| What | Endpoint | Interval |
|------|----------|----------|
| Task progress | `GET /lead/{id}/dag` | 10–30s |
| Pending decisions | `GET /decisions?projectId=...` | 10s |
| Agent status | `GET /agents?projectId=...` | 30s |
| Activity log | `GET /coordination/activity` | 30s |

---

## WebSocket (Real-time)

For real-time updates instead of polling, connect to:

```
ws://localhost:3001
```

Events are pushed as JSON messages. This is what the web dashboard uses. For simpler integration, REST polling is sufficient.
