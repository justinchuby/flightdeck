# Detailed WebSocket Event Reference

## Complete Event Catalog with Line Numbers & Payloads

### BROADCAST EVENTS (Server → Client)

#### Agent Lifecycle Events

| # | Event Type | File | Line | Triggered By | Payload Structure |
|---|---|---|---|---|---|
| 1 | `agent:spawned` | WebSocketServer.ts | 133 | AgentManager 'agent:spawned' | `{ type, agent: AgentInfo }` |
| 2 | `agent:terminated` | WebSocketServer.ts | 138 | AgentManager 'agent:terminated' | `{ type, agentId: string }` |
| 3 | `agent:exit` | WebSocketServer.ts | 143 | AgentManager 'agent:exit' | `{ type, agentId: string, code: number, error?: string }` |
| 4 | `agent:crashed` | WebSocketServer.ts | 166 | AgentManager 'agent:crashed' | `{ type, agentId: string, ...restData }` |
| 5 | `agent:auto_restarted` | WebSocketServer.ts | 171 | AgentManager 'agent:auto_restarted' | `{ type, agentId: string, ...restData }` |
| 6 | `agent:restart_limit` | WebSocketServer.ts | 176 | AgentManager 'agent:restart_limit' | `{ type, agentId: string, ...restData }` |

#### Agent Output/Streaming Events

| # | Event Type | File | Line | Triggered By | Payload Structure | Special Handling |
|---|---|---|---|---|---|---|
| 7 | `agent:status` | WebSocketServer.ts | 150 | AgentManager 'agent:status' | `{ type: 'agent:status', agentId, status, ...data }` | ⏱️ Throttled 500ms (latest value only) |
| 8 | `agent:text` | WebSocketServer.ts | 201 | AgentManager 'agent:text' | `{ type: 'agent:text', agentId, text: string }` | 📦 Batched 100ms (merged) |
| 9 | `agent:content` | WebSocketServer.ts | 217 | AgentManager 'agent:content' | `{ type, agentId, content: {text?, contentType?, mimeType?, data?, uri?} }` | Rich media support |
| 10 | `agent:thinking` | WebSocketServer.ts | 222 | AgentManager 'agent:thinking' | `{ type, agentId, text: string }` | Appends to existing thinking block |
| 11 | `agent:tool_call` | WebSocketServer.ts | 186 | AgentManager 'agent:tool_call' | `{ type, agentId, toolCall: {...}, ...data }` | Tool invocation tracking |
| 12 | `agent:response_start` | WebSocketServer.ts | 192 | AgentManager 'agent:response_start' | `{ type, agentId, ...data }` | Signals new LLM turn |
| 13 | `agent:plan` | WebSocketServer.ts | 227 | AgentManager 'agent:plan' | `{ type, agentId, plan: [{content, priority, status}] }` | Task planning |

#### Agent Hierarchy & Sessions

| # | Event Type | File | Line | Triggered By | Payload Structure |
|---|---|---|---|---|---|
| 14 | `agent:sub_spawned` | WebSocketServer.ts | 181 | AgentManager 'agent:sub_spawned' | `{ type, parentId: string, child: AgentInfo }` |
| 15 | `agent:session_ready` | WebSocketServer.ts | 262 | AgentManager 'agent:session_ready' | `{ type, agentId, sessionId: string, ...data }` |
| 16 | `agent:permission_request` | WebSocketServer.ts | 232 | AgentManager 'agent:permission_request' | `{ type, agentId, request: {id, toolName, arguments, timestamp}, ...data }` |

#### Agent Communication

| # | Event Type | File | Line | Triggered By | Payload Structure |
|---|---|---|---|---|---|
| 17 | `agent:message_sent` | WebSocketServer.ts | 257 | AgentManager 'agent:message_sent' | `{ type, from: string, to: string, fromRole?: string, content: string, ...data }` |
| 18 | `agent:context_compacted` | WebSocketServer.ts | 267 | AgentManager 'agent:context_compacted' | `{ type, agentId, ...data }` |

#### Delegation & Completion

| # | Event Type | File | Line | Triggered By | Payload Structure |
|---|---|---|---|---|---|
| 19 | `agent:delegated` | WebSocketServer.ts | 247 | AgentManager 'agent:delegated' | `{ type, agentId, ...data }` |
| 20 | `agent:completion_reported` | WebSocketServer.ts | 252 | AgentManager 'agent:completion_reported' | `{ type, agentId, ...data }` |

#### File Lock Events

| # | Event Type | File | Line | Triggered By | Payload Structure |
|---|---|---|---|---|---|
| 21 | `lock:acquired` | WebSocketServer.ts | 284 | FileLockRegistry 'lock:acquired' | `{ type, agentId, ...data }` |
| 22 | `lock:released` | WebSocketServer.ts | 289 | FileLockRegistry 'lock:released' | `{ type, agentId, ...data }` |
| 23 | `lock:expired` | WebSocketServer.ts | 294 | FileLockRegistry 'lock:expired' | `{ type, agentId, ...data }` |

#### DAG & Activity Events

| # | Event Type | File | Line | Triggered By | Payload Structure |
|---|---|---|---|---|---|
| 24 | `dag:updated` | WebSocketServer.ts | 272 | AgentManager 'dag:updated' | `{ type, leadId: string, ...data }` |
| 25 | `activity` | WebSocketServer.ts | 299 | ActivityLedger 'activity' | `{ type, entry: ActivityEntry }` |

#### Decision Events

| # | Event Type | File | Line | Triggered By | Payload Structure |
|---|---|---|---|---|---|
| 26 | `lead:decision` | WebSocketServer.ts | 237 | AgentManager 'lead:decision' | `{ type, id, agentId, leadId?, title?, rationale?, needsConfirmation?, category?, autoApproved?, confirmedAt?, timestamp?, ...data }` |
| 27 | `decision:confirmed` | WebSocketServer.ts | 306 | DecisionLog 'decision:confirmed' | `{ type, decision: Decision }` |
| 28 | `decision:rejected` | WebSocketServer.ts | 311 | DecisionLog 'decision:rejected' | `{ type, decision: Decision }` |
| 29 | `decision:dismissed` | WebSocketServer.ts | 316 | DecisionLog 'decision:dismissed' | `{ type, decision: Decision }` |
| 30 | `decisions:batch` | WebSocketServer.ts | 322/328/334 | DecisionLog 'decisions:batch_*' | `{ type, action: 'confirm'|'reject'|'dismiss', decisions: Decision[] }` |
| 31 | `intent:alert` | WebSocketServer.ts | 339 | DecisionLog 'intent:alert' | `{ type, decision: Decision, rule: {pattern, action, label} }` |

#### Chat Group Events

| # | Event Type | File | Line | Triggered By | Payload Structure |
|---|---|---|---|---|---|
| 32 | `group:created` | WebSocketServer.ts | 350 | ChatGroupRegistry 'group:created' | `{ type, name: string, leadId: string, memberIds?: string[], createdAt?: string, ...data }` |
| 33 | `group:message` | WebSocketServer.ts | 354 | ChatGroupRegistry 'group:message' | `{ type, leadId: string, message: {leadId, groupName, ...}, ...data }` |
| 34 | `group:member_added` | WebSocketServer.ts | 358 | ChatGroupRegistry 'group:member_added' | `{ type, leadId: string, group: string, agentId: string, ...data }` |
| 35 | `group:member_removed` | WebSocketServer.ts | 362 | ChatGroupRegistry 'group:member_removed' | `{ type, leadId: string, group: string, agentId: string, ...data }` |
| 36 | `group:reaction` | WebSocketServer.ts | 366 | ChatGroupRegistry 'group:reaction' | `{ type, leadId: string, groupName: string, messageId: string, agentId: string, emoji: string, action: 'add'|'remove' }` |

#### Lead Progress

| # | Event Type | File | Line | Triggered By | Payload Structure |
|---|---|---|---|---|---|
| 37 | `lead:progress` | WebSocketServer.ts | 242 | AgentManager 'lead:progress' | `{ type, leadId?, agentId?, totalDelegations?, active?, completed?, failed?, completionPct?, teamSize?, ...data }` |

#### Timer Events

| # | Event Type | File | Line | Triggered By | Payload Structure |
|---|---|---|---|---|---|
| 38 | `timer:created` | container.ts | N/A | TimerRegistry 'timer:created' | `{ type, timer: {id: string, agentId: string, label: string} }` |
| 39 | `timer:fired` | container.ts | N/A | TimerRegistry 'timer:fired' | `{ type, timer: {id, agentId, label, message?}, timerId? }` |
| 40 | `timer:cancelled` | container.ts | N/A | TimerRegistry 'timer:cancelled' | `{ type, timer: {id, agentId, label}, timerId? }` |

#### System & Alert Events

| # | Event Type | File | Line | Triggered By | Payload Structure |
|---|---|---|---|---|---|
| 41 | `system:paused` | WebSocketServer.ts | 277 | AgentManager 'system:paused' | `{ type, paused: boolean }` |
| 42 | `config:reloaded` | container.ts | N/A | ConfigStore 'config:reloaded' | `{ type }` |
| 43 | `alert:new` | container.ts | N/A | AlertEngine 'alert:new' | `{ type, alert: Alert }` |
| 44 | `error` | WebSocketServer.ts | 79 | Server error response | `{ type, message: string }` |

#### Connection & State Events

| # | Event Type | File | Line | Triggered By | Payload Structure |
|---|---|---|---|---|---|
| 45 | `init` | WebSocketServer.ts | 99 | Connection open | `{ type, agents: AgentInfo[], locks: FileLock[], systemPaused?: boolean }` |
| 46 | `agent:buffer` | WebSocketServer.ts | 384 | Subscribe to agent | `{ type, agentId: string, data: BufferedOutput }` |

---

### INBOUND CLIENT MESSAGES (Client → Server)

| # | Type | Handler Line | Payload | Handler Method | Description |
|---|---|---|---|---|---|
| 1 | `subscribe` | 375 | `{ type, agentId: string }` | Subscribe to agent output | Subscribe to '*' for all agents |
| 2 | `unsubscribe` | 393 | `{ type, agentId: string }` | Unsubscribe from agent | Stops receiving agent messages |
| 3 | `subscribe-project` | 397 | `{ type, projectId: string\|null }` | Filter by project | Re-sends init with filtered data |
| 4 | `input` | 415 | `{ type, agentId: string, text: string }` | Send input to agent | Calls `agent.write(text)` |
| 5 | `resize` | 428 | `{ type, agentId: string, cols: number, rows: number }` | Terminal resize | Deprecated - no-op |
| 6 | `permission_response` | 432 | `{ type, agentId: string, approved: boolean }` | Respond to permission request | Resolves pending permission |
| 7 | `queue_open` | 438 | `{ type }` | Pause auto-approve | Calls `decisionLog.pauseTimers()` |
| 8 | `queue_closed` | 443 | `{ type }` | Resume auto-approve | Calls `decisionLog.resumeTimers()` |

---

## Broadcasting Architecture

### Broadcast Methods

```typescript
// Send to specific clients matching filter
private broadcast(msg: any, filter: (c: ClientConnection) => boolean): void

// Send to ALL clients
private broadcastAll(msg: any): void

// Send to project-scoped clients
private broadcastToProject(msg: any, projectId?: string): void

// Public API for external sources (AlertEngine, TimerRegistry)
public broadcastEvent(msg: any, projectId?: string): void
```

### Filtering Logic

- **Project Scoping**: `!c.subscribedProject || !projectId || c.subscribedProject === projectId`
- **Agent Subscription**: `c.subscribedAgents.has(agentId) || c.subscribedAgents.has('*')`

---

## Message Batching Implementation

### agent:text Batching (100ms)

```
1. Emit: AgentManager → 'agent:text'
2. Buffer: WebSocketServer.textBuffer[agentId] = { texts: [...], projectId }
3. Schedule: setInterval(flushTextBuffer, 100ms)
4. Flush: Merge texts array, broadcast as single message
5. Clear: Remove from buffer
```

**Code**: Lines 201-213, 486-504

### agent:status Throttling (500ms)

```
1. Emit: AgentManager → 'agent:status'
2. Buffer: WebSocketServer.statusPending[agentId] = latest message
3. Schedule: setTimeout(() => flush, 500ms)
4. Flush: Send latest buffered status
5. Clear: Remove pending timer
```

**Code**: Lines 146-162

---

## Web Handler Dispatch

Handlers are dispatched via router in `ws-handlers/index.ts`:

```typescript
const handlerMap: Record<string, MessageHandler> = {
  'init': handleInit,
  'agent:spawned': handleAgentSpawned,
  'agent:terminated': handleAgentTerminated,
  // ... etc
}

export function createMessageRouter(ctx: HandlerContext): (msg: any) => void {
  return (msg: any) => {
    const handler = handlerMap[msg.type];
    if (handler) handler(msg, ctx);
  };
}
```

**Handler locations**:
- `agentHandlers.ts` - Handles agent:* events
- `groupHandlers.ts` - Handles group:* events
- `systemHandlers.ts` - Handles system/timer/decision events

---

## Current Type Definition Gap

### In `packages/web/src/types/index.ts` (lines 140-156)

Current incomplete `WsMessage` type:
```typescript
export interface WsMessage {
  type:
    | 'agent:output'
    | 'agent:status'
    | 'agent:text'
    | 'agent:tool_call'
    | 'agent:plan'
    | 'agent:permission_request'
    | 'agent:permission_response'
    | 'agent:delegated'
    | 'agent:completion_reported'
    | 'agent:thinking'
    | 'lead:decision'
    | 'lead:progress'
    | string;
  [key: string]: any;
}
```

⚠️ **Problems**:
1. Missing 30+ event types that are actually broadcast
2. Has 'agent:output' which doesn't exist in server code
3. Has 'agent:permission_response' which is CLIENT→SERVER only
4. Too loose (`string` type union allows typos)
5. `[key: string]: any` allows invalid payload fields

---

## Recommendations

### 1. Create Shared Protocol Types

Create `packages/shared/types/ws-protocol.ts` with full event definitions, used by both server and web.

### 2. Update Web Types

Replace incomplete union with discriminated union for better type safety:

```typescript
export type WsMessage = 
  | AgentSpawnedEvent
  | AgentTerminatedEvent
  // ... full union of all 52 event types
```

### 3. Add Validation

```typescript
export const VALID_SERVER_EVENT_TYPES = new Set([
  'agent:spawned', 'agent:terminated', /* ... */
]);

export function isValidServerEvent(msg: any): msg is ServerBroadcastEvent {
  return VALID_SERVER_EVENT_TYPES.has(msg.type);
}
```

### 4. Integration Tests

Test that all events broadcast from server reach appropriate web handlers without errors.

### 5. Protocol Versioning

Add version field for future backward compatibility:
```typescript
{ version: '1', type: '...', /* payload */ }
```

