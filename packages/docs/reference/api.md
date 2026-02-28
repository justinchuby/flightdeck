# REST API

All endpoints are prefixed with `/api`. Request and response bodies are JSON. All mutation endpoints are validated with [Zod](https://zod.dev/) schemas.

## Authentication

The server auto-generates an auth token at startup (printed to console). All API requests require the token:

```http
Authorization: Bearer <token>
```

Set `AUTH=none` environment variable to disable authentication (not recommended).

The web UI receives the token automatically via injection — no manual configuration needed.

## Rate Limits

Spawn and message endpoints are rate-limited:

| Endpoint | Limit |
|----------|-------|
| `POST /api/agents`, `POST /api/lead/start` | 30 requests/minute |
| `POST /api/lead/:id/message` | 50 requests/10 seconds |

Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are included in responses.

## Agents

### List Agents
```http
GET /api/agents
```
Returns an array of all agent objects.

### Spawn Agent
```http
POST /api/agents
Content-Type: application/json

{
  "role": "developer",
  "model": "claude-opus-4.6",
  "workingDirectory": "/path/to/project",
  "parentId": "lead-id",
  "task": "Implement feature X"
}
```

### Stop Agent
```http
DELETE /api/agents/:id
```

### Interrupt Agent
```http
POST /api/agents/:id/interrupt
```
Sends an ACP cancel signal to abort the agent's current work.

### Restart Agent
```http
POST /api/agents/:id/restart
```

### Get Agent Plan
```http
GET /api/agents/:id/plan
```
Returns the agent's plan entries (in-memory first, DB fallback).

### Send Input
```http
POST /api/agents/:id/input
Content-Type: application/json

{ "text": "Your message here" }
```

### Send Message
```http
POST /api/agents/:id/message
Content-Type: application/json

{ "content": "Message content", "fromRole": "user" }
```

### Update Agent Config
```http
PATCH /api/agents/:id
Content-Type: application/json

{ "model": "gpt-5.2" }
```

### Grant Permission
```http
POST /api/agents/:id/permission
Content-Type: application/json

{ "allow": true }
```

## Lead / Projects

### Create Project
```http
POST /api/lead/start
Content-Type: application/json

{
  "projectName": "My Project",
  "task": "Build a REST API",
  "model": "claude-opus-4.6",
  "workingDirectory": "/path/to/project",
  "projectId": "existing-project-id"
}
```

Optionally pass `projectId` to associate with an existing persistent project.

### List Active Leads
```http
GET /api/lead
```

### Get Lead
```http
GET /api/lead/:id
```

### Send Message to Lead
```http
POST /api/lead/:id/message
Content-Type: application/json

{ "text": "Please also add tests", "mode": "interrupt" }
```

Mode can be `"interrupt"` (default) or `"queue"`.

### Update Lead Config
```http
PATCH /api/lead/:id
Content-Type: application/json

{ "model": "claude-opus-4.6" }
```

### Get Decisions
```http
GET /api/lead/:id/decisions
```

### Get Groups
```http
GET /api/lead/:id/groups
```

### Get Group Messages
```http
GET /api/lead/:id/groups/:name/messages
```

### Send Group Message (Human)
```http
POST /api/lead/:id/groups/:name/messages
Content-Type: application/json

{ "content": "What about using GraphQL instead?" }
```

Automatically adds the human as a group member.

### Get Delegations
```http
GET /api/lead/:id/delegations
```

### Get DAG Tasks
```http
GET /api/lead/:id/tasks
```

## Persistent Projects

### List All Projects
```http
GET /api/projects
```

### Create Project
```http
POST /api/projects
Content-Type: application/json

{ "name": "My Project", "description": "A REST API service" }
```

### Get Project
```http
GET /api/projects/:id
```

### Update Project
```http
PATCH /api/projects/:id
Content-Type: application/json

{ "name": "Renamed Project" }
```

### Get Project Briefing
```http
GET /api/projects/:id/briefing
```
Returns an aggregated briefing of the project's history — tasks, decisions, and agent memories from all prior sessions.

### Resume Project
```http
POST /api/projects/:id/resume
Content-Type: application/json

{ "task": "Continue implementing the API", "model": "claude-opus-4.6" }
```
Starts a new lead session with the project briefing injected as context.

## Search

### Global Search
```http
GET /api/search?q=authentication&limit=50
```

Searches across messages, group chat messages, tasks, decisions, and activity log. Query must be 2–200 characters.

## Roles

### List Roles
```http
GET /api/roles
```

### Register Custom Role
```http
POST /api/roles
Content-Type: application/json

{
  "id": "data-engineer",
  "name": "Data Engineer",
  "icon": "📊",
  "color": "#4CAF50",
  "systemPrompt": "You are a data engineering specialist...",
  "defaultModel": "claude-opus-4.6"
}
```

### Remove Custom Role
```http
DELETE /api/roles/:id
```

## Configuration

### Get Config
```http
GET /api/config
```

### Update Config
```http
PATCH /api/config
Content-Type: application/json

{ "maxConcurrent": 10, "autoRestart": true }
```

## Coordination

### Get Status
```http
GET /api/coordination/status
```

### List File Locks
```http
GET /api/coordination/locks
```

### Acquire Lock
```http
POST /api/coordination/locks
Content-Type: application/json

{ "filePath": "src/auth.ts", "agentId": "a1b2c3" }
```

File paths are validated against directory traversal attacks.

### Release Lock
```http
DELETE /api/coordination/locks/:filePath
```

### Get Activity Log
```http
GET /api/coordination/activity?limit=50&agentId=a1b2c3
```

### Get Coordination Summary
```http
GET /api/coordination/summary
```
