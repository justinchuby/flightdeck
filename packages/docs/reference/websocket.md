# WebSocket Events

The server broadcasts real-time events over a WebSocket connection at `ws://localhost:3001`.

## Connection

```javascript
const ws = new WebSocket('ws://localhost:3001')
ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  console.log(data.type, data.payload)
}
```

On connection, the server sends an `init` message containing all current agents, locks, and state. This gives the browser dashboard full visibility across all projects.

## Project Filtering

By default, WebSocket clients receive events from **all** projects (designed for the browser UI). Agents can subscribe to a specific project to only receive events from their project:

```javascript
// Subscribe to a specific project (agent-side filtering)
ws.send(JSON.stringify({ type: 'subscribe-project', projectId: 'project-123' }))
```

After subscribing:
- The client only receives events for agents in that project
- Unsubscribed clients (browser dashboard) continue to receive everything
- The subscription persists for the lifetime of the connection

## Event Types

All events follow the shape `{ type: string, payload: object }`.

### System

| Event | Payload | Description |
|-------|---------|-------------|
| `init` | `{ agents[], locks[], paused }` | Initial state snapshot sent on WebSocket connection |
| `system:paused` | `{ paused: boolean }` | System pause toggled on or off |
| `config:reloaded` | `{}` | Configuration file reloaded |
| `activity` | `{ entry }` | Activity log entry recorded |
| `attention:changed` | `{}` | Signal to refetch attention items (clients should debounce ~300ms) |
| `alert:new` | `{ alert }` | New alert triggered |

### Agent Lifecycle

| Event | Payload | Description |
|-------|---------|-------------|
| `agent:spawned` | `{ agent: AgentJSON }` | New agent created |
| `agent:terminated` | `string` (agent ID) | Agent stopped |
| `agent:killed` | `string` (agent ID) | Agent stopped by user |
| `agent:exit` | `{ agentId, code, error? }` | Agent process exited |
| `agent:status` | `{ agentId, status }` | Status changed — running, idle, etc. (throttled to 500ms) |
| `agent:crashed` | `{ agentId, code }` | Agent exited unexpectedly |
| `agent:auto_restarted` | `{ agentId, previousAgentId, crashCount }` | Agent auto-restarted after crash |
| `agent:restart_limit` | `{ agentId }` | Max restarts reached |
| `agent:sub_spawned` | `{ parentId, child: AgentJSON }` | Child agent spawned by a lead |
| `agent:restarted` | `{ oldId, newAgent: AgentJSON }` | Agent manually restarted |

### Agent Output

| Event | Payload | Description |
|-------|---------|-------------|
| `agent:text` | `{ agentId, text }` | Text output from agent (batched with 100ms flush) |
| `agent:content` | `{ agentId, content }` | Structured content output |
| `agent:thinking` | `{ agentId, text }` | Thinking/reasoning output |
| `agent:tool_call` | `{ agentId, toolCall: ToolCallInfo }` | Agent invoked a tool |
| `agent:plan` | `{ agentId, plan: PlanEntry[] }` | Agent plan updated |
| `agent:response_start` | `{ agentId }` | Agent started responding |
| `agent:buffer` | `{ agentId, buffer }` | Initial message buffer sent on connection |

### Session Management

| Event | Payload | Description |
|-------|---------|-------------|
| `agent:session_ready` | `{ agentId, sessionId }` | ACP session established |
| `agent:session_resume_failed` | `{ agentId, requestedSessionId, newSessionId, error }` | Session resume failed, fell back to a new session |
| `agent:context_compacted` | `{ agentId, previousUsed, currentUsed, percentDrop }` | Context window compacted |

### Communication

| Event | Payload | Description |
|-------|---------|-------------|
| `agent:message_sent` | `{ from, fromRole, to, toRole, content }` | Inter-agent message |
| `agent:permission_request` | `{ agentId, request }` | Agent requesting tool permission |
| `agent:spawn_error` | `{ agentId, message }` | Failed to create agent |
| `agent:delegate_error` | `{ agentId, message }` | Delegation failed |

### Delegation & Tasks

| Event | Payload | Description |
|-------|---------|-------------|
| `agent:delegated` | `{ parentId, childId, delegation }` | Task delegated to child agent |
| `agent:completion_reported` | `{ childId, parentId, status }` | Child agent reported task complete |
| `dag:updated` | `{ leadId }` | Task DAG state changed |

### Decisions & Approvals

| Event | Payload | Description |
|-------|---------|-------------|
| `lead:decision` | `{ id, agentId, agentRole, leadId, title, rationale, needsConfirmation, status }` | New decision recorded |
| `decision:confirmed` | `{ id, status }` | Decision approved |
| `decision:rejected` | `{ id, status }` | Decision rejected |
| `decision:dismissed` | `{ id, status }` | Decision dismissed |
| `decisions:batch` | `{ leadId, decisions[] }` | Bulk decision update |
| `intent:alert` | `{ leadId, agentId, ... }` | Intent rule alert triggered |

### Group Chat

| Event | Payload | Description |
|-------|---------|-------------|
| `group:created` | `{ group: ChatGroup, leadId }` | New group chat created |
| `group:message` | `{ message: GroupMessage, groupName, leadId }` | Message in group chat |
| `group:member_added` | `{ groupName, leadId, agentId }` | Member joined group |
| `group:member_removed` | `{ groupName, leadId, agentId }` | Member left group |
| `group:reaction` | `{ groupName, leadId, messageId, agentId, emoji }` | Reaction added to message |

### File Coordination

| Event | Payload | Description |
|-------|---------|-------------|
| `lock:acquired` | `{ filePath, agentId, agentRole, expiresAt }` | File lock acquired |
| `lock:released` | `{ filePath, agentId }` | File lock released |
| `lock:expired` | `{ filePath, agentId }` | File lock expired |

### Timers

| Event | Payload | Description |
|-------|---------|-------------|
| `timer:created` | `{ timer }` | Timer set by agent |
| `timer:fired` | `{ timer }` | Timer triggered |
| `timer:cancelled` | `{ timer }` | Timer cancelled |

### Lead Progress

| Event | Payload | Description |
|-------|---------|-------------|
| `lead:progress` | `{ agentId/leadId, ...progressData }` | Session progress update |
| `lead:stalled` | `{ leadId, nudgeCount, idleDuration }` | Lead detected as stalled |


