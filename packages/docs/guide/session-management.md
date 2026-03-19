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
4. Each agent gets a unique, **immutable** agent ID and a provider-assigned session ID

Agent IDs are preserved across restart and resume — they never change for the lifetime of the agent.

### Stopping a Session

Sessions can be stopped in three ways:

- **User stop** — Click "Stop" in the UI. All agents are terminated gracefully.
- **Natural completion** — All tasks complete and the lead signals `COMPLETE_TASK` for the final task.
- **Mass failure** — If too many agents fail in a short window, the system pauses spawning and the session transitions to failed.

## Session Persistence

When a session stops, each agent's CLI session must be saved before the connection is closed. The order of operations matters — saving must happen before disconnecting.

### Terminate/Save Lifecycle

```
User clicks "Stop" (or session completes)
    │
    ▼
For each agent:
    │
    ├── 1. adapter.terminate()  ← kills the subprocess
    │
    └── 2. Update agent_roster status to 'terminated'
```

Session persistence is provider-dependent — the CLI tool decides what to save and where. Flightdeck stores the provider-returned `sessionId` in `agent_roster` so it can attempt resume later.

### Where Sessions Are Stored

| Adapter | Storage location | What's saved |
|---------|-----------------|--------------|
| **AcpAdapter** | Provider-dependent | Varies by CLI tool — Flightdeck stores the provider-returned session ID |

### Crashed Sessions

If a session crashes without proper shutdown (e.g., OOM kill, power loss, server crash):

- The CLI processes are orphaned and terminate when their parent dies
- Attempting to resume a crashed session may fail if the provider didn't persist state
- The UI shows an error message: the user should start a new session instead of resuming
- Database records (agent roster, task DAG, decisions, knowledge) are still intact — only the provider's conversation history may be lost

## Session Identity

Sessions use a **two-layer identity model**. The crew session tracks the overall session, and agent sessions track individual agent state for resume.

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

Stored in `agent_roster.session_id`. Each agent has its own session ID from its CLI provider, enabling per-agent context resume.

```
Agent agent-49cbf6e1:
  Flightdeck agent ID: "agent-49cbf6e1"
  CLI session ID:      "sess_abc123..."
```

All providers use the ACP protocol, where the **provider controls the session ID**:

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
| **AcpAdapter** | CLI provider | `loadSession(providerId)` | Best-effort (may fail silently — falls back to new session) |

### Design Decisions

- **All providers use AcpAdapter** — a single, uniform adapter for all CLI providers via the ACP stdio protocol
- **AcpAdapter works with any ACP-compatible CLI** — Copilot, Claude, Gemini, OpenCode, Cursor, Codex, or future tools
- **Callers don't need to know the resume details** — AgentManager and SessionResumeManager just pass the stored `agent_roster.session_id` and the adapter handles the rest

## Resuming a Session

Session resume is one of Flightdeck's key features — it lets you pick up where you left off after a server restart, network drop, or intentional pause.

### Resume Modes

| Mode | Behavior |
|------|----------|
| **Resume All** | Re-spawn all previously active agents with their original roles, models, and session IDs |
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
    ├── Read agent_roster.session_id (the provider session ID)
    ├── Agent ID is immutable — same ID is reused from before
    ├── Check if adapter supports resume (preset.supportsLoadSession)
    ├── Pass session_id to adapter.start(opts) via AdapterStartOptions
    ├── AcpAdapter calls loadSession(sessionId)
    ├── If resume fails → falls back to newSession(cwd) with fresh ID
    ├── Update agent_roster.session_id with new ID (if changed)
    └── Inject knowledge context (KnowledgeInjector)
    │
    ▼
6. Update crew session status to "running"
```

### How Resume Works

All providers use the AcpAdapter, which handles resume via the ACP protocol:

```
try loadSession(sessionId)
catch → fall back to newSession(cwd)
```

Resume is best-effort — the CLI provider may or may not support it. If `loadSession()` fails, the adapter silently falls back to a fresh session.

### What Gets Preserved on Resume

| Data | Preserved? | How |
|------|-----------|-----|
| Agent IDs | ✅ Yes | Immutable — same ID across restarts |
| Agent roles and models | ✅ Yes | Stored in `agent_roster` table |
| Provider conversation history | ⚠️ Best-effort | Via ACP `loadSession()` — depends on provider support |
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

### Server Restart

When the server restarts:

1. **Stale reconciliation** — `ProjectRegistry.reconcileStaleSessions()` marks agents from previous runs as terminated
2. **Dead agents marked** — Agents that were running are marked as terminated in the roster
3. **Auto-resume** — `SessionResumeManager` attempts to resume agents via ACP `loadSession()`

### Network Disconnection

If the WebSocket connection between the client and server drops:

1. The client shows a "Connection Lost" indicator in the AttentionBar
2. On reconnect, the UI refetches current state from the server to sync up
