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
2. A Project Lead agent is spawned with the project briefing
3. The lead analyzes the task and spawns sub-agents (developers, reviewers, etc.)
4. Each agent gets a unique agent ID and an optional SDK session ID

### Stopping a Session

Sessions can be stopped in three ways:

- **User stop** — Click "Stop" in the UI. All agents are terminated gracefully.
- **Natural completion** — All tasks complete and the lead signals `COMPLETE_TASK` for the final task.
- **Mass failure** — If too many agents fail in a short window, the `MassFailureDetector` pauses spawning and the session transitions to failed.

## Session Identity

Sessions use a **two-level identity model**:

### Crew-Level Session

The crew-level session is a Flightdeck concept — it groups all agents working on a project together.

```
Session ID: "proj-auth-refactor-1709912345"
├── Lead Agent (agent-49cbf6e1)
├── Developer (agent-0dde0f25)
├── Code Reviewer (agent-d6e9213a)
└── Architect (agent-3973583e)
```

This ID is stored in the `sessions` table and used for session history, resume, and project grouping.

### Agent-Level Session

Each agent may also have a **CLI session ID** from its SDK adapter. This is the session ID that enables context resume with the underlying CLI tool.

```
Agent agent-49cbf6e1:
  Flightdeck ID: "agent-49cbf6e1"
  SDK Session ID: "sess_abc123..."  (from Copilot/Claude SDK)
```

The SDK session ID is stored in `agent_roster.sessionId` and passed to the adapter's `start()` method on resume.

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
SessionResumeManager.resume(projectId, options)
    │
    ├── 1. Load session record from database
    ├── 2. Load agent roster (agents from previous session)
    ├── 3. Filter agents based on resume mode
    ├── 4. For each agent to resume:
    │   ├── Check if adapter supports resume (preset.supportsResume)
    │   ├── Pass SDK sessionId to AdapterStartOptions
    │   ├── Spawn agent via AgentManager
    │   └── Inject knowledge context (KnowledgeInjector)
    └── 5. Update session status to "running"
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
