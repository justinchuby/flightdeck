# Agent Communication Strategy

## Overview

AI Crew supports two communication modes with Copilot CLI: the **Agent Client Protocol (ACP)** for structured JSON-RPC messaging, and **PTY** as a fallback for raw terminal interaction. ACP is the default and recommended mode.

## ACP Mode (Default)

Each agent spawns a Copilot CLI process with `copilot --acp --stdio`. Communication uses [JSON-RPC 2.0](https://www.jsonrpc.org/specification) over NDJSON streams via the [`@agentclientprotocol/sdk`](https://www.npmjs.com/package/@agentclientprotocol/sdk).

### Connection Lifecycle

```
Client (AI Crew)              Agent (Copilot CLI)
     │                              │
     │── spawn copilot --acp ──────>│
     │                              │
     │── initialize ───────────────>│
     │<──────────── capabilities ───│
     │                              │
     │── session/new ──────────────>│
     │<──────────── sessionId ──────│
     │                              │
     │── session/prompt ───────────>│  (user or role prompt)
     │<── session/update (text) ────│  (streamed chunks)
     │<── session/update (tool) ────│  (tool call status)
     │<── session/update (plan) ────│  (agent's plan)
     │                              │
     │<── request_permission ───────│  (needs approval)
     │── permission response ──────>│
     │                              │
     │<──────── prompt result ──────│  (stopReason: end_turn)
     │                              │
     │── session/prompt ───────────>│  (next user message)
     └──────────────────────────────┘
```

### Session Updates

The ACP agent sends structured updates during processing:

| Update Type | Description | Data |
|-------------|-------------|------|
| `agent_message_chunk` | Text output from the LLM | `{ type: "text", text: "..." }` |
| `tool_call` | Agent invokes a tool | `{ toolCallId, title, kind, status }` |
| `tool_call_update` | Tool execution progress | `{ toolCallId, status, content? }` |
| `plan` | Agent reports its plan | `[{ content, priority, status }]` |

### Permission Gating

When an ACP agent wants to execute a tool (file write, terminal command, etc.), it sends a `request_permission` call. The system:

1. Forwards the request to the UI as a modal dialog
2. User can **Allow** or **Deny**
3. If no response within **60 seconds**, auto-approves (configurable)
4. The "Always allow for this agent" option persists in localStorage

### Sending User Input

In ACP mode, each user message is sent as a `session/prompt` call. This starts a new prompt turn — the agent processes the message, potentially makes tool calls, and returns a `stopReason` when complete. This is fundamentally different from PTY mode where input is raw keystrokes.

## PTY Mode (Fallback)

Spawns Copilot CLI in a pseudo-terminal via `node-pty`. Raw terminal I/O — the system writes to stdin and reads from stdout. Used when:

- ACP is not supported by the CLI version
- User explicitly sets `AGENT_MODE=pty`
- Terminal-faithful rendering is needed

### Structured Commands in PTY Mode

Since PTY mode has no structured protocol, agents communicate intent via HTML comment patterns detected by regex in `AgentManager`:

```
<!-- CREATE_AGENT {"role": "developer", "model": "claude-opus-4.6", "task": "..."} -->
<!-- DELEGATE {"to": "agent-id", "task": "...", "context": "..."} -->
<!-- LOCK_REQUEST {"filePath": "src/auth.ts", "reason": "editing auth logic"} -->
<!-- LOCK_RELEASE {"filePath": "src/auth.ts"} -->
<!-- ACTIVITY {"actionType": "decision_made", "summary": "chose JWT over sessions"} -->
<!-- AGENT_MESSAGE {"to": "agent-id", "content": "please review my changes"} -->
<!-- BROADCAST {"content": "use factory pattern for all services"} -->
<!-- DECISION {"title": "Use JWT", "rationale": "stateless, scalable"} -->
<!-- PROGRESS {"summary": "2/4 done", "completed": [...], "in_progress": [...], "blocked": [...]} -->
<!-- QUERY_CREW -->
```

**Lead-only commands:** `CREATE_AGENT` (spawn new agent with role/model), `DELEGATE` (assign task to existing agent by ID), `DECISION`, `PROGRESS`.

**All agents:** `LOCK_REQUEST`, `LOCK_RELEASE`, `ACTIVITY`, `AGENT_MESSAGE`, `BROADCAST`, `QUERY_CREW`.

These are parsed from agent output and routed to the appropriate subsystem (FileLockRegistry, ActivityLedger, AgentManager).

## Inter-Agent Messaging

The `MessageBus` provides a simple pub-sub channel for agent-to-agent communication:

```typescript
interface BusMessage {
  id: string;           // auto-generated
  from: string;         // sender agent ID
  to: string | '*';     // recipient or broadcast
  type: 'request' | 'response' | 'broadcast' | 'spawn_request';
  content: string;
  timestamp: string;    // ISO 8601
}
```

Messages are stored in a bounded history buffer (last 5,000 messages) and queryable by agent ID.

## Context Injection

Every agent receives awareness of the entire crew. This happens at two points:

### Initial Context (on spawn)

Before the role prompt, agents receive a `[CREW CONTEXT]` manifest. The format differs for leads vs specialists:

**Project Lead** sees its own agents with IDs, roles, and models:
```
[CREW CONTEXT]
You are agent abc12345 with role "Project Lead".

== YOUR ASSIGNMENT ==
- Task: Build the authentication system

== YOUR AGENTS ==
- def67890 — Developer [claude-opus-4.6] — running, task: Implement login endpoint
- ghi11111 — Code Reviewer [gemini-3-pro-preview] — idle
Use agent IDs above with DELEGATE to assign tasks, or AGENT_MESSAGE to communicate.

== COORDINATION RULES ==
...
[/CREW CONTEXT]
```

**Specialist agents** see peer agents with locked files:
```
[CREW CONTEXT]
You are agent def67890 with role "Developer".

== YOUR ASSIGNMENT ==
- Task: Implement login endpoint

== ACTIVE CREW MEMBERS ==
- Agent ghi11111 (Code Reviewer) — Status: idle, Files locked: none

== COORDINATION RULES ==
1. DO NOT modify files that another agent has locked.
2. Request locks: `<!-- LOCK_REQUEST {"filePath": "...", "reason": "..."} -->`
3. Release locks: `<!-- LOCK_RELEASE {"filePath": "..."} -->`
4. Message agents: `<!-- AGENT_MESSAGE {"to": "agent-id", "content": "..."} -->`
...
[/CREW CONTEXT]
```

### Event-Driven Refresh

The `ContextRefresher` pushes updated context (`CREW_UPDATE`) to all running agents when significant events occur (agent spawned/killed/exited, file lock acquired/released). Updates are debounced at 2 seconds to batch rapid events.

The refresh includes current peer/agent status and the 20 most recent activity log entries.

## WebSocket Event Catalog

All events are broadcast to connected UI clients in real time:

### Agent Events
| Event | Payload | Description |
|-------|---------|-------------|
| `agent:data` | `{ agentId, data }` | Raw output (PTY mode) |
| `agent:spawned` | `{ agent }` | New agent created |
| `agent:killed` | `{ agentId }` | Agent manually stopped |
| `agent:exit` | `{ agentId, code }` | Agent process exited |
| `agent:crashed` | `{ agentId, code }` | Non-zero exit detected |
| `agent:auto_restarted` | `{ agentId, previousAgentId }` | Automatic restart after crash |
| `agent:restart_limit` | `{ agentId }` | Max restarts exceeded |
| `agent:sub_spawned` | `{ parentId, child }` | Sub-agent created autonomously |
| `agent:hung` | `{ agentId, elapsedMs }` | No output for 5+ minutes |
| `agent:text` | `{ agentId, text }` | Structured text (ACP mode) |
| `agent:tool_call` | `{ agentId, toolCallId, ... }` | Tool invocation (ACP mode) |
| `agent:plan` | `{ agentId, entries[] }` | Agent plan update (ACP mode) |
| `agent:permission_request` | `{ agentId, ... }` | Tool permission needed |
| `agent:content` | `{ agentId, content }` | Rich content (image, audio, resource) |
| `agent:status` | `{ agentId, status }` | Agent status change |
| `agent:session_ready` | `{ agentId, sessionId }` | ACP session connected, session ID available |
| `agent:delegated` | `{ parentId, delegation }` | Work delegated to child agent |
| `agent:completion_reported` | `{ childId, parentId, status }` | Child agent finished work |
| `agent:message_sent` | `{ from, to, content }` | Inter-agent message |

### Lead Events
| Event | Payload | Description |
|-------|---------|-------------|
| `lead:decision` | `{ agentId, title, rationale, ... }` | Lead made a decision |
| `lead:progress` | `{ agentId, summary, completed, in_progress, blocked }` | Lead progress report |

### Task Events
| Event | Payload | Description |
|-------|---------|-------------|
| `task:updated` | `{ task }` | Task state changed |
| `task:removed` | `{ taskId }` | Task deleted |

### Coordination Events
| Event | Payload | Description |
|-------|---------|-------------|
| `lock:acquired` | `{ filePath, agentId, agentRole }` | File lock taken |
| `lock:released` | `{ filePath, agentId }` | File lock freed |
| `activity` | `{ entry }` | New activity logged |

### Client → Server Messages
| Message | Payload | Description |
|---------|---------|-------------|
| `subscribe` | `{ agentId }` | Subscribe to agent output (`*` for all) |
| `unsubscribe` | `{ agentId }` | Unsubscribe |
| `input` | `{ agentId, text }` | Send text to agent |
| `resize` | `{ agentId, cols, rows }` | Resize agent terminal |
| `permission_response` | `{ agentId, approved }` | Approve/deny tool call |
