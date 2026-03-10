# Hot-Reload Proposal: Preserving Agent Processes During Server Development

**Author:** Architect Agent (e7f14c5e)  
**Date:** 2026-03-07  
**Status:** Proposal

---

## The Problem

During Flightdeck development, `tsx watch src/index.ts` restarts the entire Node.js process on every code change. This kills all running Copilot CLI agent processes because they are child processes spawned via `child_process.spawn()` with stdio pipes. A single typo fix during an active crew session means:

1. **All agents terminated** — `SIGTERM` → `gracefulShutdown()` → `agentManager.shutdownAll()` → every agent's `acpConnection.terminate()` → `process.kill()` on each child
2. **All in-memory state lost** — agent messages, tool calls, plans, context window info, delegation tracking, message queues
3. **All ACP connections severed** — stdio pipes are closed when the parent process exits
4. **Context window budget wasted** — agents that resume need to rebuild their context from scratch

This is the #1 developer experience friction for anyone working on Flightdeck itself.

---

## What Exactly Gets Killed

```
tsx watch (watches for changes)
└── node src/index.ts          ← KILLED on file change
    ├── AcpConnection.process   ← copilot --acp --stdio (agent 1)  ← KILLED (child of node)
    ├── AcpConnection.process   ← copilot --acp --stdio (agent 2)  ← KILLED
    ├── AcpConnection.process   ← copilot --acp --stdio (agent 3)  ← KILLED
    └── ... (all agents)
```

The kill chain:
1. `tsx watch` detects file change → sends SIGTERM to node process
2. `index.ts` `gracefulShutdown()` calls `agentManager.shutdownAll()`
3. Each `Agent.terminate()` calls `acpConnection.terminate()` → `this.process.kill()`
4. Even without explicit kill, OS SIGHUP propagates to child processes when parent dies

**Critical constraint:** ACP uses stdio pipes (`stdin`/`stdout`) for communication. These pipe file descriptors are intrinsically tied to the parent-child process relationship. You cannot "hand off" a pipe to a different process.

---

## Options Analyzed

### Option 1: Agent Process Daemon (Process Separation)

**Concept:** Split into two processes — a long-lived **Agent Host** daemon that spawns and manages Copilot CLI processes, and a restartable **API Server** that connects to the daemon via local IPC.

```
┌─────────────────────────────────────────┐
│ Agent Host Daemon (long-lived)          │
│                                         │
│  ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │ copilot   │ │ copilot   │ │  ...   │  │
│  │ (agent 1) │ │ (agent 2) │ │        │  │
│  └────┬─────┘ └────┬─────┘ └────┬───┘  │
│       │ stdio       │ stdio      │       │
│  ┌────┴─────────────┴────────────┴───┐  │
│  │    ACP Bridge Layer               │  │
│  └────────────────┬──────────────────┘  │
│                   │ Unix Domain Socket   │
└───────────────────┼─────────────────────┘
                    │
┌───────────────────┼─────────────────────┐
│ API Server (restartable)                │
│                   │                     │
│  ┌────────────────┴──────────────────┐  │
│  │ AgentManager (proxy to daemon)    │  │
│  │ Express + WebSocket               │  │
│  │ All business logic                │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**How it works:**
- The daemon listens on a Unix domain socket (e.g., `/tmp/flightdeck-agents.sock`)
- It spawns Copilot CLI processes and bridges ACP protocol messages over the socket
- The API server connects to the daemon on startup, reconnects after restart
- On restart, the server asks the daemon "what agents are running?" and rebuilds state

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Agents survive any number of server restarts | Significant refactoring (~2-3 weeks) |
| Clean architectural separation | Need IPC protocol between daemon and server |
| Daemon is tiny (~300 lines), rarely needs changes | Two processes to manage during dev |
| Mirrors proven OTP supervision tree pattern | Event streaming adds a hop (daemon → server → WS) |
| Could enable future distributed deployment | Daemon crash still kills agents |

**Complexity:** High  
**Effectiveness:** Complete — agents are fully preserved  
**Inspired by:** Symphony's OTP supervision trees, Edict's separate worker processes

---

### Option 2: Server-Side HMR (Vite SSR / Module Swapping)

**Concept:** Use Vite's SSR HMR or a library like Resetless to hot-swap individual server modules without process restart. Agent-spawning code lives in a "stable" module that's never swapped.

**How it works:**
- Run the server via `vite-node` with HMR enabled
- Mark modules containing agent process handles as non-HMR (stable singletons)
- Route handlers, business logic, coordination services can be hot-swapped
- Use `import.meta.hot.dispose()` to clean up old module instances

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Fastest feedback loop (sub-second reloads) | Express/WebSocket servers are deeply stateful — HMR is fragile |
| No architectural changes to process model | Every `setInterval`, event listener, DB connection leaks on swap |
| Single process | Module dependency chains make "what to swap" unpredictable |
| | 35+ services with cross-references = swap explosion |
| | Vite SSR HMR is designed for request handlers, not long-lived daemons |
| | Debug nightmares when old/new module versions coexist |

**Complexity:** Medium (setup), High (maintenance — constant fragility)  
**Effectiveness:** Partial — works for simple route changes, breaks for anything touching agent lifecycle, events, or stateful services  
**Verdict:** ⛔ **Not recommended.** The Flightdeck server has 35+ interconnected stateful services. Module-level HMR would be endlessly fragile.

---

### Option 3: Enhanced Auto-Resume (Reconnection After Restart)

**Concept:** Don't prevent agent death — instead, make recovery automatic and fast. On restart, automatically re-spawn all agents using `--resume` with their saved Copilot session IDs.

**How it works:**
1. Before shutdown, persist the full agent roster to SQLite (IDs, roles, tasks, session IDs, parent-child relationships, project associations, DAG task assignments)
2. On startup, detect "was this a dev restart?" (e.g., presence of a `.dev-restart` sentinel file)
3. Auto-spawn all agents from the persisted roster using `--resume <sessionId>`
4. Reconstruct delegations, message queues, and DAG state from SQLite

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Simplest implementation (~1-2 days) | Agents still die and restart (5-10s downtime per agent) |
| No architectural changes | `--resume` rebuilds context from scratch (uses token budget) |
| Already has 80% of infrastructure (session resume exists) | In-progress tool calls are interrupted (could corrupt files mid-edit) |
| Progressive — can ship immediately | Message queues lost (pending messages between agents) |
| | Not instant — 10-20 agents take 30-60s to fully resume |

**Complexity:** Low  
**Effectiveness:** Partial — agents recover but lose current turn's work. Acceptable for dev workflow where you're watching the system anyway.

---

### Option 4: Worker Thread with Main Thread Process Hosting

**Concept:** Run all business logic (Express, WebSocket, services) in a `worker_thread`. The main thread spawns and holds agent processes. When code changes, replace the worker thread; the main thread (and its child processes) stay alive.

**How it works:**
- Main thread: spawns Copilot CLI processes, holds stdio pipe handles
- Worker thread: runs Express server, AgentManager logic, WebSocket server
- Communication: `parentPort.postMessage()` / `worker.postMessage()` for ACP messages
- On file change: terminate worker thread, create new one; main thread untouched

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Single OS process | `worker_threads` can't share file descriptors (pipes) |
| Agents survive worker restart | Need structured clone-safe IPC for all ACP messages |
| Simpler than separate processes | Worker thread WebSocket requires socket handle transfer |
| | `http.Server` can't be created in worker and listen on main thread's port |
| | Main thread becomes a complex process broker |
| | Effectively the same complexity as Option 1, but with more constraints |

**Complexity:** High (same as daemon, but with thread transfer limitations)  
**Effectiveness:** Complete in theory, but `worker_threads` limitations make it harder than process separation  
**Verdict:** ⛔ **Not recommended.** Worker threads impose strict serialization constraints that make this harder than a separate process with Unix sockets.

---

### Option 5: Detached Processes + Named Pipes (FIFO)

**Concept:** Spawn agent processes with `detached: true` and communicate via named pipes (FIFOs) instead of stdio. Named pipes persist on the filesystem, so a new server can open them.

**How it works:**
1. For each agent, create two named pipes: `/tmp/flightdeck-agent-{id}-in` and `-out`
2. Spawn `copilot --acp --stdio` with stdin/stdout redirected to these FIFOs
3. Server opens the FIFO file descriptors for reading/writing
4. On restart, server reopens the same FIFOs — agent processes are still alive

**Tradeoffs:**

| Pro | Con |
|-----|-----|
| Agent processes survive independently | ACP SDK expects Node.js streams, not FIFOs — needs adapter |
| No daemon process needed | Copilot CLI expects stdio, not named pipes — needs wrapper |
| Filesystem-based "IPC" is simple | FIFO lifecycle management (cleanup on crash, stale detection) |
| | Platform-specific (FIFO semantics differ on macOS vs Linux) |
| | Need a wrapper script per agent to bridge FIFOs ↔ stdio |
| | Untested with ACP protocol (ndJSON over FIFO may have buffering issues) |

**Complexity:** Medium  
**Effectiveness:** Complete if it works, but high risk of platform/buffering issues  
**Verdict:** ⚠️ **Interesting but risky.** Worth prototyping if Option 1 feels too heavy.

---

### Option 6: Hybrid — Quick Resume + Future Daemon

**Concept:** Ship Option 3 (Enhanced Auto-Resume) now for immediate relief, then build Option 1 (Agent Daemon) as a proper solution.

**Phase 1 (1-2 days):** Enhanced Auto-Resume
- Persist agent roster to SQLite on shutdown (role, task, sessionId, projectId, parentId, dagTaskId)
- On dev-mode startup, detect the persisted roster and auto-resume all agents
- Add `--dev` flag that enables auto-resume behavior
- Show a "Resuming N agents..." banner in the UI

**Phase 2 (2-3 weeks):** Agent Host Daemon
- Extract `AcpConnection` and process lifecycle into a standalone daemon
- Daemon communicates via Unix domain socket with JSON-RPC or similar
- API server becomes a client of the daemon
- `npm run dev` starts daemon first (if not already running), then server with hot-reload

---

## Recommendation

### Ship Option 6 (Hybrid): Quick Resume Now, Daemon Later

**Why:**

1. **Option 3 alone is good enough for 90% of dev workflows.** When you change a route handler or fix a UI endpoint, auto-resume gets agents back in ~30 seconds. You're watching the system anyway — it's not silent data loss.

2. **Option 1 (Daemon) is the correct long-term architecture** but requires significant refactoring of the core AcpConnection → AgentManager communication path. It shouldn't be rushed.

3. **Options 2 and 4 are traps.** Server-side HMR for a system with 35+ stateful services and event listeners is an endless source of subtle bugs. Worker threads have the same complexity as a daemon but with more constraints.

4. **The existing infrastructure is 80% there.** Session resume already works. SQLite already persists DAG tasks, file locks, decisions, and activity logs. The gap is just: "auto-detect dev restart and re-spawn the roster."

### Phase 1 Implementation Sketch

```typescript
// In gracefulShutdown() — before terminating agents:
function persistAgentRoster() {
  const roster = agentManager.getAll()
    .filter(a => !isTerminalStatus(a.status))
    .map(a => ({
      id: a.id,
      roleId: a.role.id,
      task: a.task,
      sessionId: a.sessionId,
      parentId: a.parentId,
      projectId: a.projectId,
      dagTaskId: a.dagTaskId,
      model: a.model,
      cwd: a.cwd,
    }));
  db.setSetting('dev-restart-roster', JSON.stringify(roster));
}

// On startup — after all services initialized:
function autoResumeIfDevRestart() {
  const rosterJson = db.getSetting('dev-restart-roster');
  if (!rosterJson) return;
  db.setSetting('dev-restart-roster', ''); // consume once

  const roster = JSON.parse(rosterJson);
  console.log(`🔄 Auto-resuming ${roster.length} agents from dev restart...`);
  
  for (const entry of roster) {
    const role = roleRegistry.get(entry.roleId);
    if (!role || !entry.sessionId) continue;
    agentManager.spawn(
      role, entry.task, entry.parentId, true,
      entry.model, entry.cwd, entry.sessionId, entry.id,
      { projectId: entry.projectId }
    );
  }
}
```

### Phase 2 Architecture Sketch

```
bin/
  flightdeck.mjs            # CLI entry (unchanged)
  flightdeck-agent-host.mjs  # New: daemon entry

packages/server/
  src/
    agent-host/
      AgentHostDaemon.ts     # Spawns agents, manages ACP connections
      AgentHostProtocol.ts   # JSON-RPC over Unix socket
      AgentHostClient.ts     # Client used by API server
    agents/
      AgentManager.ts        # Modified: delegates to AgentHostClient
      AcpConnection.ts       # Moved to agent-host/
```

The daemon exposes a simple API:
- `spawn(role, args) → agentId`
- `terminate(agentId)`
- `send(agentId, prompt)`
- `subscribe(agentId) → stream of events`
- `list() → running agents`

---

## Decision Matrix

| Criterion | Option 1 (Daemon) | Option 2 (HMR) | Option 3 (Resume) | Option 4 (Worker) | Option 5 (FIFO) | Option 6 (Hybrid) |
|-----------|:-:|:-:|:-:|:-:|:-:|:-:|
| Agent survival | ✅ Complete | ⚠️ Partial | ❌ Restart | ✅ Complete | ✅ Complete | ✅→⚠️ |
| Implementation effort | 🔴 High | 🟡 Medium | 🟢 Low | 🔴 High | 🟡 Medium | 🟢→🔴 |
| Maintenance burden | 🟢 Low | 🔴 High | 🟢 Low | 🟡 Medium | 🟡 Medium | 🟢 Low |
| Risk of subtle bugs | 🟢 Low | 🔴 High | 🟢 Low | 🟡 Medium | 🟡 Medium | 🟢 Low |
| Dev experience quality | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐→⭐⭐⭐⭐⭐ |
| Ships quickly | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ Phase 1 |
| Correct long-term | ✅ | ❌ | ❌ | ⚠️ | ⚠️ | ✅ Phase 2 |

**Winner: Option 6 (Hybrid)** — immediate relief with a path to the right architecture.

---

## Cross-Project Inspiration

- **Symphony (Elixir):** OTP supervision trees provide exactly the daemon pattern from Option 1. The Orchestrator GenServer serializes state while Task.Supervisor manages agent worker processes independently. Erlang Ports give crash isolation between processes. Our daemon would serve the same role as Task.Supervisor.

- **Edict:** Separate Orchestrator and Dispatch worker processes. The Dispatch Worker shells out to agent CLI with concurrency control. If the orchestrator crashes, Redis Streams preserve unprocessed events. Our SQLite persistence serves the same role as their Redis Streams for state recovery.

- **Key insight from both:** The systems that handle agent process management well ALL separate the "agent lifecycle" concern from the "business logic" concern. Symphony does it with OTP supervision trees, Edict with separate worker processes. Flightdeck currently conflates both in a single Node.js process.
