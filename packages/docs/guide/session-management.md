# Session Management

Sessions are the unit of work in Flightdeck. A session represents one run of a project — from the moment agents are spawned to when they finish or are stopped. This guide covers the session lifecycle, identity model, resume flow, and session history.

## Session Lifecycle

```
  ┌──────────┐     start()     ┌──────────┐
  │  Created  │ ──────────────→ │  Running  │
  └──────────┘                  └────┬─────┘
                                     │
                          ┌──────────┼──────────┐
                          ▼          ▼          ▼
                    ┌──────────┐ ┌────────┐ ┌────────┐
                    │ Completed │ │ Stopped│ │ Failed │
                    └──────────┘ └───┬────┘ └────────┘
                                     │
                               resume()
                                     │
                                     ▼
                               ┌──────────┐
                               │  Running  │
                               └──────────┘
```

### States

| State | Meaning |
|-------|---------|
| **Created** | Session record exists but no agents are running yet |
| **Running** | At least one agent is active. The session is live. |
| **Completed** | All agents finished successfully. The session is done. |
| **Stopped** | The user or system stopped the session. Agents were terminated. |
| **Failed** | The session ended due to errors (mass agent failures, crashes). |

### Starting a Session

When you create a project and start a session:

1. The orchestrator creates a session record in the database
2. A Project Lead agent is spawned with the project briefing and project context
3. The lead analyzes the task and spawns sub-agents (developers, reviewers, etc.)
4. Each agent gets a unique, **immutable** agent ID and an optional SDK session ID

Agent IDs are preserved across restart and resume — they never change for the lifetime of the agent.

### Stopping a Session

Sessions can be stopped in three ways:

- **User stop** — Click "Stop" in the UI. All agents are terminated gracefully.
- **Natural completion** — All tasks complete and the lead signals `COMPLETE_TASK` for the final task.
- **Mass failure** — If too many agents fail in a short window, the `MassFailureDetector` pauses spawning and the session transitions to failed.

## Session Persistence

When a session stops, each agent's CLI session must be saved before the connection is closed. The order of operations matters — saving must happen before disconnecting.

### Terminate/Save Lifecycle

```
User clicks "Stop" (or session completes)
    │
    ▼
For each agent:
    │
    ├── 1. adapter.terminate()
    │       └── CopilotSdkAdapter: await client.stop()  ← flushes session to disk
    │           (5-second timeout to prevent hanging)
    │
    ├── 2. session.disconnect()  ← closes the JSON-RPC / subprocess connection
    │
    └── 3. Update agent_roster status to 'terminated'
```

**Order matters:**
- `stop()` tells the SDK to persist session data (conversation history, tool results, etc.)
- `disconnect()` tears down the connection
- If you disconnect before stop, the SDK never saves — resume will fail

### Where Sessions Are Stored

| Adapter | Storage location | What's saved |
|---------|-----------------|--------------|
| **CopilotSdkAdapter** | `~/.copilot/session-store.db` | Conversation history, tool calls, session metadata |
| **ClaudeSdkAdapter** | SDK-managed local storage | Conversation turns, context |
| **AcpAdapter** | Provider-dependent | Varies by CLI tool |

For the Copilot SDK, session data is keyed by the `sessionId` we provided to `createSession()`. This is why we generate our own UUID — it ensures we can always find the session later.

### Crashed Sessions

If a session crashes without proper shutdown (e.g., OOM kill, power loss, agent server crash):

- The SDK's `stop()` never runs, so session data **may not be persisted**
- Attempting to resume a crashed session will fail because the SDK has no saved state
- The UI shows an error message: the user should start a new session instead of resuming
- Database records (agent roster, task DAG, decisions, knowledge) are still intact — only the SDK conversation history is lost

### Known Limitations

- **Pre-fix sessions cannot resume** — Sessions created before the `sessionId` fix (commit `d12d5567`) passed no ID to `createSession()`, so the SDK generated a random ID that Flightdeck never stored. These sessions have mismatched IDs and cannot be resumed.
- **Duplicate event dedup** — The event ID deduplication logic (commit `aef06755`) works around Copilot SDK bug #567, where the SDK emits duplicate events on resume. Without this fix, resumed sessions would show duplicated agent messages.
- **5-second stop timeout** — If the SDK takes longer than 5 seconds to flush, the timeout fires and the session may not be fully saved. This is rare but can happen under heavy disk I/O.

## Session Identity

Sessions use a **two-layer identity model**. Both layers are needed: the crew session tracks the overall session, and agent sessions track individual agent state for resume.

### Layer 1: Crew-Level Session ID

Stored in `project_sessions.session_id`. Groups all agents working on a project together.

```
Crew Session: "proj-auth-refactor-1709912345"
├── Lead Agent (agent-49cbf6e1)
├── Developer (agent-0dde0f25)
├── Code Reviewer (agent-d6e9213a)
└── Architect (agent-3973583e)
```

Used for session history, resume orchestration, and project grouping. Created when the user starts a new session.

### Layer 2: Agent-Level Session ID

Stored in `agent_roster.session_id`. Each agent has its own session ID from its CLI adapter, enabling per-agent context resume.

```
Agent agent-49cbf6e1:
  Flightdeck agent ID: "agent-49cbf6e1"
  CLI session ID:      "sess_abc123..."
```

**How the agent session ID is created depends on the adapter:**

### CopilotSdkAdapter (Flightdeck Controls the ID)

The Copilot SDK accepts a session ID from the caller:

```
1. Flightdeck generates: flightdeckSessionId = randomUUID()
2. Passes to SDK:        createSession({ ...config, sessionId: flightdeckSessionId })
3. SDK stores state under our ID
4. On resume:            resumeSession(flightdeckSessionId)  ← finds it because we chose the ID
```

Flightdeck controls the ID end-to-end. The same UUID is used for both creation and resume.

### ClaudeSdkAdapter (Flightdeck Controls the ID)

Similar to Copilot — Flightdeck generates the ID and passes it to the SDK:

```
1. Flightdeck generates: sessionId = randomUUID()
2. Passes to SDK:        sdk.query(prompt, { resume: sessionId })
3. On resume:            sdk.query(prompt, { resume: sessionId })  ← same ID
```

### AcpAdapter (Provider Controls the ID)

The ACP protocol does not accept a caller-provided session ID. The CLI provider creates one:

```
1. Flightdeck calls:     newSession({ cwd })  ← no session ID passed
2. Provider returns:     { sessionId: "provider-generated-id-xyz" }
3. Flightdeck stores:    agent_roster.session_id = "provider-generated-id-xyz"
4. On resume:            loadSession("provider-generated-id-xyz")  ← provider's own ID
```

The provider controls the ID. Flightdeck stores whatever the provider returns.

### Summary

| Adapter | Who generates the ID | Resume mechanism | Reliability |
|---------|---------------------|-----------------|-------------|
| **CopilotSdkAdapter** | Flightdeck (`randomUUID()`) | `resumeSession(ourId)` | Reliable |
| **ClaudeSdkAdapter** | Flightdeck (`randomUUID()`) | `query({ resume: ourId })` | Reliable |
| **AcpAdapter** | CLI provider | `loadSession(providerId)` | Best-effort (may fail silently) |

### Design Decisions

- **Copilot always uses CopilotSdkAdapter** (never ACP) — the native SDK provides reliable session resume
- **AcpAdapter is the generic fallback** — works with any ACP-compatible CLI (Gemini, OpenCode, Cursor, Codex, or future tools)
- **The adapter abstracts the ID generation difference** — callers (AgentManager, SessionResumeManager) don't need to know which flow is used. They just pass the stored `agent_roster.session_id` and the adapter handles the rest.

## Resuming a Session

Session resume is one of Flightdeck's key features — it lets you pick up where you left off after a server restart, network drop, or intentional pause.

### Resume Modes

| Mode | Behavior |
|------|----------|
| **Resume All** | Re-spawn all previously active agents with their original roles, models, and SDK session IDs |
| **Resume Specific** | Choose which agents to resume; others are marked as terminated |
| **Fresh Start** | Start a new session with the same project context but no agent history |

### Resume Flow

```
User clicks "Resume" on a stopped session
    │
    ▼
1. Look up crew session ID from project_sessions
    │
    ▼
2. reactivateSession() — update status to 'active' in DB
    │
    ▼
3. Load agent roster — all agents from previous session
    │
    ▼
4. Filter agents based on resume mode (all / specific / fresh)
    │
    ▼
5. For each agent to resume (in parallel batches of 3):
    ├── Read agent_roster.session_id (the CLI session ID)
    ├── Agent ID is immutable — same ID is reused from before
    ├── Check if adapter supports resume (preset.supportsResume)
    ├── Pass session_id to adapter.start(opts) via AdapterStartOptions
    ├── Adapter calls its resume mechanism:
    │   ├── CopilotSdk: resumeSession(sessionId)
    │   ├── ClaudeSdk:  query({ resume: sessionId })
    │   └── ACP:        loadSession(sessionId)
    ├── If resume fails → adapter falls back to new session with fresh ID
    ├── Update agent_roster.session_id with new ID (if changed)
    └── Inject knowledge context (KnowledgeInjector)
    │
    ▼
6. Update crew session status to "running"
```

### How Adapters Handle Resume

Each adapter backend handles resume differently:

**AcpAdapter** (subprocess):
```
try loadSession(sessionId)
catch → fall back to newSession(cwd)
```
Best-effort — the CLI may or may not support resume.

**ClaudeSdkAdapter** (in-process):
```
sdk.query(prompt, { resume: sessionId })
```
Explicit and reliable. The SDK maintains the full conversation history.

**CopilotSdkAdapter** (JSON-RPC):
```
client.resumeSession(sessionId, { model, onPermissionRequest })
```
Explicit and reliable. The SDK re-establishes the JSON-RPC connection.

### What Gets Preserved on Resume

| Data | Preserved? | How |
|------|-----------|-----|
| Agent IDs | ✅ Yes | Immutable — same ID across restarts |
| Agent roles and models | ✅ Yes | Stored in `agent_roster` table |
| SDK conversation history | ✅ Yes | Via SDK session ID resume |
| File locks | ✅ Yes | Stored in `file_locks` table |
| Task DAG state | ✅ Yes | Stored in `dag_tasks` table |
| Decision log | ✅ Yes | Stored in `decision_log` table |
| Knowledge entries | ✅ Yes | Stored in `knowledge_entries` table |
| In-memory message buffers | ❌ No | Lost on restart; re-injected via ContextRefresher |

## Session History

The **SessionHistory** component in the UI shows past sessions for a project:

- Session start/end times
- Agent count and roles
- Session status (completed, stopped, failed)
- Duration
- Resume button (for stopped sessions)

Sessions are stored in the `sessions` table and enriched at query time with agent counts from `agent_roster`.

### Viewing History

Navigate to a project → click the session history icon (or use the Sessions tab). Each session card shows:

```
┌─────────────────────────────────────────┐
│ Session #3 — Completed                   │
│ Started: 2 hours ago · Duration: 45 min  │
│ Agents: 5 (Lead, 2 Devs, Reviewer, QA)  │
│                              [Resume]    │
└─────────────────────────────────────────┘
```

## Recovery

### Orchestrator Restart

When the orchestrator restarts:

1. **Stale reconciliation** — `ProjectRegistry.reconcileStaleSessions()` checks which agents are still alive via the agent server
2. **Live agents preserved** — If the agent server is still running (detached process), agents continue working
3. **Dead agents marked** — Agents that crashed are marked as terminated in the roster
4. **Auto-resume** — `SessionResumeManager` attempts to resume agents with SDK session IDs

### Agent Server Crash

If the agent server crashes:

1. All running CLI processes are orphaned (they terminate when their parent dies)
2. The orchestrator detects the disconnection via health monitoring (ping/pong timeout)
3. On next startup, the orchestrator forks a new agent server
4. `AgentServerRecovery` reads the roster and attempts to re-spawn agents

### Network Disconnection

If the WebSocket connection between the client and server drops:

1. The client shows a "Connection Lost" indicator in the AttentionBar
2. `AgentReconciliation` auto-runs on reconnect to sync the UI with server state
3. Missed events are replayed if the server's EventBuffer still has them
