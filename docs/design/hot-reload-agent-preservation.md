# Hot-Reload with Agent Process Preservation

> **Status:** Design Document (PROPOSAL — Security Model Added) | **Author:** Architect (e7f14c5e) | **Security Review:** Architect (cc29bb0d) | **Date:** 2026-03-07

## Problem Statement

During Flightdeck development, the server runs via `tsx watch src/index.ts`, which restarts the entire Node.js process on every code change. Because Copilot CLI agent processes are spawned as child processes of the server (`child_process.spawn`), they are killed whenever the server restarts. A single code change during an active crew session causes:

1. **All agents terminated** — `SIGTERM` propagates through the process tree
2. **All in-memory state lost** — messages, tool calls, plans, context window info, delegation tracking
3. **All ACP connections severed** — stdio pipes are closed with the parent process
4. **Context window budget wasted** — agents that resume need to rebuild context from scratch

This is the primary developer experience friction for anyone iterating on the Flightdeck server codebase.

**Primary use case (dogfooding):** A 12-agent AI crew is actively modifying Flightdeck source code. An agent commits a change to `AgentManager.ts`. `tsx watch` detects the change and restarts the server. All 12 agents — including the one that just made the change — must continue working without interruption. In-flight tool calls complete. No work is lost. The crew is developing the very system that manages them; the daemon enables this recursive iteration loop.

### Current Process Tree

```
tsx watch (file watcher)
└── node src/index.ts              ← KILLED on file change
    ├── copilot --acp --stdio      ← agent 1 (child process — KILLED)
    ├── copilot --acp --stdio      ← agent 2 (child process — KILLED)
    ├── copilot --acp --stdio      ← agent 3 (child process — KILLED)
    └── ...
```

### Kill Chain Detail

1. `tsx watch` detects file change → sends SIGTERM to the node process
2. `index.ts` `gracefulShutdown()` calls `agentManager.shutdownAll()`
3. Each `Agent.terminate()` calls `acpConnection.terminate()` → `this.process.kill()`
4. Even without the explicit kill, OS SIGHUP propagates to children when parent exits

### Critical Constraint

ACP uses stdio pipes (`stdin`/`stdout`) for communication via the `@agentclientprotocol/sdk`. These pipe file descriptors are intrinsically tied to the parent-child process relationship — they cannot be transferred to a different process.

---

## Options Considered

### Option 1: Agent Process Daemon (Process Separation)

Split into two processes: a long-lived **Agent Host** daemon that spawns and manages Copilot CLI processes, and a restartable **API Server** that connects to the daemon via local IPC.

```
┌────────────────────────────────────────┐
│ Agent Host Daemon (long-lived)         │
│                                        │
│  ┌──────────┐ ┌──────────┐ ┌────────┐  │
│  │ copilot  │ │ copilot  │ │  ...   │  │
│  │ (agent 1)│ │ (agent 2)│ │        │  │
│  └────┬─────┘ └────┬─────┘ └────┬───┘  │
│       │ stdio      │ stdio      │      │
│  ┌────┴────────────┴────────────┴───┐  │
│  │    ACP Bridge Layer              │  │
│  └────────────────┬─────────────────┘  │
│                   │ Unix Domain Socket │
└───────────────────┼────────────────────┘
                    │
┌───────────────────┼─────────────────────┐
│ API Server (restartable via tsx watch)  │
│                   │                     │
│  ┌────────────────┴──────────────────┐  │
│  │ AgentManager (proxy to daemon)    │  │
│  │ Express + WebSocket + services    │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

**How it works:**
- The daemon listens on a Unix domain socket (e.g., `/tmp/flightdeck-agents.sock`)
- It spawns Copilot CLI processes and bridges ACP protocol messages over the socket
- The API server connects to the daemon on startup, reconnects after restart
- On restart, the server queries the daemon for the current agent roster

**Daemon API surface:**
- `spawn(role, cliArgs, cwd) → agentId`
- `terminate(agentId) → boolean`
- `prompt(agentId, content) → result`
- `resolvePermission(agentId, approved) → void`
- `subscribe(agentId) → event stream`
- `list() → running agent descriptors`

| Pro | Con |
|-----|-----|
| Agents survive any number of server restarts | Significant refactoring (~2-3 weeks) |
| Clean architectural separation of concerns | Need IPC protocol between daemon and server |
| Daemon is small (~300 lines), rarely needs changes | Two processes to manage during development |
| Mirrors proven OTP supervision tree pattern | Event streaming adds a hop (daemon → server → WS) |
| Enables future distributed deployment | Daemon crash still kills all agents |

**Inspired by:** Symphony's Elixir/OTP supervision trees (Task.Supervisor manages agent processes independently of the Orchestrator GenServer), Edict's separate worker processes.

---

### Option 2: Server-Side Hot Module Replacement

Use Vite's SSR HMR or a framework like Resetless to hot-swap individual server modules without full process restart.

| Pro | Con |
|-----|-----|
| Fastest possible feedback loop | Express/WebSocket servers are deeply stateful — HMR is fragile |
| No architectural changes to process model | Every `setInterval`, event listener, DB connection leaks on swap |
| Single process | 35+ interconnected services make "what to swap" unpredictable |
| | Debug nightmares when old/new module versions coexist |
| | Designed for request handlers, not long-lived daemon processes |

**Verdict: Not recommended.** The Flightdeck server has 35+ interconnected stateful services with event listeners, intervals, and shared mutable state. Module-level HMR would be endlessly fragile.

---

### Option 3: Enhanced Auto-Resume After Restart

Don't prevent agent death. Instead, make recovery automatic: persist the agent roster before shutdown, auto-resume all agents via `copilot --resume <sessionId>` on restart.

| Pro | Con |
|-----|-----|
| Simplest implementation (~1-2 days) | Agents still die and restart (5-15s downtime per agent) |
| No architectural changes needed | `--resume` consumes context window budget to rebuild |
| 80% of infrastructure already exists | In-progress tool calls interrupted (could corrupt files mid-edit) |
| Can ship immediately | Message queues between agents are lost |
| | 10-20 agents take 30-60s to fully resume |

---

### Option 4: Worker Thread with Main Thread Process Hosting

Run business logic in a `worker_thread`. Main thread spawns and holds agent processes. Replace the worker on code change; main thread stays alive.

| Pro | Con |
|-----|-----|
| Single OS process | `worker_threads` cannot share file descriptors (stdio pipes) |
| Agents survive worker restart | Need structured-clone-safe IPC for all ACP messages |
| | `http.Server` can't easily be transferred between threads |
| | Effectively same complexity as daemon, with more constraints |

**Verdict: Not recommended.** Worker thread limitations make this harder than process separation for no additional benefit.

---

### Option 5: Detached Processes + Named Pipes

Spawn agents with `detached: true`, communicate via filesystem FIFOs instead of stdio pipes. New server can reopen the same FIFOs.

| Pro | Con |
|-----|-----|
| No daemon process needed | ACP SDK expects Node.js streams, not FIFOs |
| Agent processes survive independently | Copilot CLI expects stdio, needs wrapper script |
| | Platform-specific FIFO behavior (macOS vs Linux) |
| | Untested with ndJSON ACP protocol buffering |

**Verdict: Interesting but risky.** Worth prototyping only if Option 1 proves too heavy.

---

## Recommended Approach: Phased Hybrid

Ship **Phase 1** (Enhanced Auto-Resume) as the foundation and fallback mechanism, then ship **Phase 2** (Agent Host Daemon) immediately after as the primary hot-reload mechanism. **Both phases are required** — Phase 1 is not "done," it's the recovery path for when the daemon is unavailable.

**Core design principle: The daemon is core infrastructure, but the server degrades gracefully without it.** The daemon is the PRIMARY mechanism for surviving server restarts during development. SDK resume (Phase 1) is the FALLBACK — used for daemon crash recovery, first-time setup before daemon is built, or edge cases where the daemon isn't running. This means:
- `npm run dev`: daemon auto-starts, agents survive restarts with zero disruption
- Daemon crash: server detects socket EOF → falls back to SDK resume → agents restored in 5-15s
- Daemon not installed (fresh clone): server works via direct ACP spawn + SDK resume (degraded but functional)

### Phase 1: Enhanced Auto-Resume (1-2 days)

Persist the full agent roster to SQLite before shutdown. On dev-mode startup, detect the persisted roster and automatically resume all agents.

#### Implementation

**On graceful shutdown** (before terminating agents):

```typescript
// index.ts — inside gracefulShutdown()
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
```

**On startup** (after all services initialized):

```typescript
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

**UI indication:** Show a "🔄 Resuming N agents..." banner in the web dashboard so the developer knows agents are reconnecting.

#### Limitations

- Agents restart (~5-15s per agent), losing their current turn's work in progress
- Context window budget is consumed to rebuild each agent's context
- Pending inter-agent messages are lost (though DAG state and file locks persist in SQLite)

### Phase 2: Agent Host Daemon (2-3 weeks)

Extract agent process management into a standalone daemon process.

#### New File Structure

```
bin/
  flightdeck.mjs                  # CLI entry (unchanged)
  flightdeck-agent-host.mjs       # New: daemon entry

packages/server/
  src/
    agent-host/
      AgentHostDaemon.ts          # Spawns agents, manages ACP connections
      AgentHostProtocol.ts        # JSON-RPC message definitions
      AgentHostClient.ts          # Client used by the API server
    agents/
      AgentManager.ts             # Modified: delegates spawn/terminate to client
      Agent.ts                    # Modified: ACP events arrive via IPC, not direct
```

#### Protocol

JSON-RPC over Unix domain socket (see [Security Model](#security-model) for socket location):

```json
// Server → Daemon: spawn an agent
{"jsonrpc": "2.0", "method": "spawn", "params": {"role": "developer", "cliArgs": ["--model", "claude-opus-4.6"], "cwd": "/path/to/repo"}, "id": 1}

// Daemon → Server: agent event stream
{"jsonrpc": "2.0", "method": "event", "params": {"agentId": "abc123", "type": "text", "data": "Hello, I'm analyzing..."}}

// Server → Daemon: send prompt
{"jsonrpc": "2.0", "method": "prompt", "params": {"agentId": "abc123", "content": "Your task is..."}, "id": 2}
```

#### Dev Workflow

```bash
npm run dev
# 1. Starts agent-host daemon (if not already running)
# 2. Starts API server with tsx watch
# 3. Server connects to daemon via Unix socket
# 4. On file change: only the API server restarts
# 5. Server reconnects to daemon — agents are untouched
```

The `scripts/dev.mjs` launcher would be extended to:
1. Check if daemon is running (attempt socket connection)
2. Start daemon if needed
3. Start API server with `tsx watch`
4. On shutdown: leave daemon running (agents stay alive)

#### Migration Path

1. Extract `AcpConnection` into the daemon (it already has a clean boundary)
2. Create `AgentHostClient` that mirrors `AcpConnection`'s event interface
3. Modify `AgentAcpBridge.startAcp()` to use the client instead of direct spawn
4. All other code (AgentManager, CommandDispatcher, etc.) sees the same interface

---

## Daemon Lifecycle Modes

The daemon's behavior on server shutdown differs between production and development contexts. This addresses a critical UX expectation: Ctrl+C in production should cleanly stop everything, while code changes in dev mode should leave agents alive.

### Production Mode (default)

```
User presses Ctrl+C (or server receives SIGTERM)
    → gracefulShutdown() sends JSON-RPC: daemon.shutdown({ persist: false })
    → Daemon terminates all agents (SIGTERM → 5s → SIGKILL escalation)
    → Daemon exits
    → Server exits
    → No orphaned processes. Clean shutdown.
```

**Behavior:** Server stop → daemon stop → all agents terminate. The daemon is a companion process of the server, not an independent service. This meets the fundamental user expectation that Ctrl+C kills everything.

**Detection:** Production mode is the default. The server sends an explicit `daemon.shutdown({ persist: false })` message during graceful shutdown, instructing the daemon to terminate agents and exit.

### Dev Mode (`npm run dev` / `tsx watch`)

```
tsx watch detects file change → sends SIGTERM to server
    → gracefulShutdown() closes daemon socket (no shutdown message sent)
    → Server exits. Daemon detects socket EOF.
    → Daemon enters orphaned mode: keeps all agents alive, starts auto-shutdown timer
    → tsx watch spawns new server
    → New server connects to daemon, authenticates, subscribes to agents
    → Daemon cancels auto-shutdown timer
    → All agents continue uninterrupted. Zero disruption.
```

**Behavior:** Server stop → daemon PERSISTS → agents survive. This enables the hot-reload iteration loop where agents developing Flightdeck survive restarts caused by their own code changes.

**Detection:** Dev mode is activated when the server detects it was started by `tsx watch` (via `process.env.TSX_WATCH` or similar). In dev mode, `gracefulShutdown()` simply closes the daemon socket without sending a shutdown message. The daemon interprets a bare socket close (no `daemon.shutdown` received) as "server restarting, keep agents alive."

**Auto-shutdown safety net:** If no server reconnects within **12 hours**, the daemon terminates itself and all agents.

### Protocol: Shutdown vs Disconnect

The daemon distinguishes two server exit patterns via the JSON-RPC protocol:

| Server Action | Daemon Interpretation | Daemon Behavior |
|--------------|----------------------|-----------------|
| Sends `daemon.shutdown({ persist: false })` then closes socket | **Intentional shutdown** (production) | Terminate all agents, exit daemon |
| Sends `daemon.shutdown({ persist: true })` then closes socket | **Intentional persist** (override) | Keep agents alive, enter orphaned mode |
| Closes socket without sending `daemon.shutdown` | **Server crashed or restarting** (dev) | Keep agents alive, enter orphaned mode, start auto-shutdown timer |

```typescript
// JSON-RPC shutdown message
interface DaemonShutdownRequest {
  method: 'daemon.shutdown';
  params: {
    persist: boolean;  // true = keep agents alive, false = terminate everything
  };
}
```

**The key design insight:** The daemon's default on unexpected disconnect is to KEEP agents alive (orphaned mode). Only an explicit `persist: false` message triggers agent termination. This is the safe default — it's better to have orphaned agents that auto-shutdown after a timeout than to lose work because a server crash was misinterpreted as an intentional stop.

### Override Flags

For cases where the default mode is wrong:

| Flag | Effect | Use Case |
|------|--------|----------|
| `--daemon-persist` | Keep daemon alive on server exit, even in production mode | Long-running production deployments where agents should outlive the server |
| `--no-daemon-persist` | Stop daemon on server exit, even in dev mode | Developer wants a clean slate on every restart |

These map to the server's shutdown behavior:
- `--daemon-persist`: server always closes socket without `daemon.shutdown` (like dev mode)
- `--no-daemon-persist`: server always sends `daemon.shutdown({ persist: false })` (like production mode)

Config file equivalent in `flightdeck.config.yaml`:
```yaml
daemon:
  persistOnShutdown: auto  # 'auto' (default: dev=persist, prod=stop) | 'always' | 'never'
```

### Integration with Existing Shutdown Flow

Current `gracefulShutdown()` in `index.ts`:
```typescript
function gracefulShutdown(signal: string) {
  // 1. Close daemon socket (new — dev mode: just close, prod mode: send shutdown first)
  if (daemonClient?.isConnected) {
    if (shouldPersistDaemon()) {
      daemonClient.close();  // Silent close → daemon keeps agents
    } else {
      await daemonClient.shutdown({ persist: false });  // Explicit stop → daemon terminates agents
      daemonClient.close();
    }
  }
  // 2. Close HTTP server
  // 3. Close WebSocket server
  // 4. Exit
}

function shouldPersistDaemon(): boolean {
  if (config.daemon?.persistOnShutdown === 'always') return true;
  if (config.daemon?.persistOnShutdown === 'never') return false;
  // 'auto': persist in dev mode, stop in production
  return isDevMode();  // true when started via tsx watch
}
```

This maintains the shutdown order established in the group design review: close daemon socket FIRST, then HTTP, then WS. In dev mode, closing the socket releases the daemon for the new server immediately.

---

## Security Model

### Threat Analysis

The daemon holds live agent processes with access to the filesystem, git, and external APIs. A compromised daemon connection could:

1. **Hijack running agents** — inject arbitrary prompts into an agent with file-write permissions
2. **Spawn rogue agents** — execute arbitrary CLI commands via `copilot --acp --stdio`
3. **Exfiltrate data** — subscribe to all agent event streams (code, conversations, tool outputs)
4. **Denial of service** — terminate all running agents, killing an active crew session

This is a **local privilege boundary** problem, not a network security problem. The threat actor is a rogue process on the same machine — not a remote attacker.

### IPC Mechanism: Unix Domain Socket (Recommended)

| Mechanism | OS-Level Auth | Network Exposure | Node.js Support | Platform |
|-----------|:---:|:---:|:---:|:---:|
| **Unix domain socket** | ✅ File permissions | ❌ None | ✅ `net` module | macOS, Linux |
| TCP localhost | ❌ None | ⚠️ `127.0.0.1` | ✅ `net` module | All |
| Named pipes | ⚠️ Platform-specific | ❌ None | ⚠️ Partial | Windows-focused |

**Decision: Unix domain socket.** The kernel enforces `connect()` permission checks against the socket file's owner/mode bits. TCP localhost provides zero OS-level authentication — any process can connect to a known port. Named pipes have inconsistent cross-platform behavior and no advantage over UDS on macOS/Linux.

### Socket Location

**Current proposal (WRONG):** `/tmp/flightdeck-agents-{pid}.sock`

**Problems with `/tmp/`:**
- World-readable directory — any user can see the socket file exists (information leak)
- Symlink attacks — a malicious user creates `/tmp/flightdeck-agents-*.sock` as a symlink before daemon starts
- Stale socket cleanup races on multi-user systems

**Recommended:** `$XDG_RUNTIME_DIR/flightdeck/agent-host.sock`

```
$XDG_RUNTIME_DIR/flightdeck/     # typically /run/user/<uid>/flightdeck/
├── agent-host.sock               # mode 0600 (owner rw only)
├── agent-host.token              # mode 0600 (per-session auth token)
└── agent-host.pid                # mode 0644 (informational only — see A2 note below)
```

**A2: PID file is informational, not a security check.** PID files are unreliable for daemon liveness detection because of process ID recycling — after a daemon crash, the OS may assign the same PID to an unrelated process. Instead of checking `kill(pid, 0)` against the PID file, the launcher (`dev.mjs`) should:
1. **Attempt a socket connect** to `agent-host.sock`
2. **Send auth handshake** with the token from `agent-host.token`
3. **If connect fails or auth is rejected:** daemon is dead or stale → unlink socket, start fresh daemon
4. **If connect + auth succeeds:** daemon is alive → proceed to start API server

This connect-test approach is immune to PID recycling and also validates the auth layer end-to-end. The PID file is retained for human debugging only (e.g., `cat agent-host.pid` to find the daemon in `ps`).

### Stale Socket Cleanup

If the daemon is killed non-gracefully (`SIGKILL`, OOM killer, kernel panic, power loss), the Unix socket file is left behind as an orphan. The next daemon startup must handle this — otherwise `listen()` fails with `EADDRINUSE`.

**Detection strategy:** Attempt `connect()` on the existing socket. The kernel returns a definitive answer:

| `connect()` result | Meaning | Action |
|---|---|---|
| Success | A live daemon is already listening | Don't start a new daemon; connect to existing |
| `ECONNREFUSED` | Socket file exists but nothing is listening (stale) | `unlink()` the socket, start fresh daemon |
| `ENOENT` | No socket file | Start fresh daemon (clean startup) |
| `EACCES` | Socket exists but wrong permissions | Log error, refuse to start (security concern) |

```typescript
// In dev.mjs or AgentHostDaemon startup
import { connect } from 'net';
import { unlinkSync, existsSync } from 'fs';

async function ensureCleanSocket(socketPath: string): Promise<'fresh' | 'existing'> {
  if (!existsSync(socketPath)) return 'fresh';

  return new Promise((resolve) => {
    const probe = connect(socketPath);
    probe.on('connect', () => {
      // A live daemon is already listening — don't start a new one
      probe.destroy();
      resolve('existing');
    });
    probe.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        // Stale socket from crashed daemon — safe to clean up
        unlinkSync(socketPath);
        resolve('fresh');
      } else {
        // EACCES or other error — log and refuse to start
        throw new Error(`Cannot probe daemon socket: ${err.code} — ${err.message}`);
      }
    });
  });
}
```

**Why not just always unlink before listen()?** Because if a live daemon IS running (e.g., user ran `npm run dev` in two terminals), blindly unlinking would disconnect the first server from the daemon. The connect-probe ensures we only unlink genuinely stale sockets.

**Daemon-side cleanup on graceful shutdown:**

```typescript
// In AgentHostDaemon.ts — signal handlers
process.on('SIGTERM', async () => {
  // Graceful: stop all agents, close socket, clean up files
  await terminateAllAgents();
  server.close();
  unlinkSync(socketPath);
  unlinkSync(tokenPath);
  unlinkSync(pidPath);
  process.exit(0);
});
```

On graceful shutdown (`SIGTERM`), the daemon removes its socket/token/pid files. On non-graceful death, the stale socket is detected and cleaned by the next startup via the connect-probe above.

**Fallback chain** (for systems without `XDG_RUNTIME_DIR`):
1. `$XDG_RUNTIME_DIR/flightdeck/` — Linux with systemd (per-user tmpfs, correct permissions, auto-cleaned on logout)
2. `$TMPDIR/flightdeck-$UID/` — macOS (see security note below)
3. `~/.flightdeck/run/` — last resort (older Linux, non-standard setups)

**⚠️ macOS fallback security note (S3):** On macOS, `$TMPDIR` resolves to a per-user path like `/var/folders/xx/.../T/` which is not a tmpfs — files persist to disk and may be captured by Time Machine backups. This means the per-session token could be backed up and theoretically recovered later. Mitigations:
- The token is regenerated on every daemon startup, so backed-up tokens are always stale/useless
- The fallback directory is still created with mode `0700` and token with `0600`
- For security-sensitive deployments, set `XDG_RUNTIME_DIR` explicitly on macOS (e.g., `export XDG_RUNTIME_DIR=$(mktemp -d)` in shell profile) to use a true temporary path
- Alternatively, add `$TMPDIR/flightdeck-*` to Time Machine exclusions

The directory is created with mode `0700` (owner-only access). The socket file is created with mode `0600`. These two permission checks mean only processes running as the daemon's UID can even attempt to connect.

### Authentication: Defense in Depth (Two Layers)

#### Layer 1: Kernel-Enforced File Permissions

The socket file's `0600` mode means the kernel rejects `connect()` from any process not running as the socket's owner UID. This is the primary security boundary — it's enforced at the syscall level with zero overhead.

**TOCTOU prevention:** Setting `umask(0o177)` before `listen()` ensures the socket is created with `0600` atomically. A naive `listen()` + `chmod()` sequence leaves the socket world-accessible for a brief window between the two syscalls — a local attacker could race to connect during that gap.

```typescript
// In AgentHostDaemon.ts
import { createServer } from 'net';
import { mkdirSync, unlinkSync, existsSync } from 'fs';

const socketDir = getSocketDir();  // XDG_RUNTIME_DIR or ~/.flightdeck/run
mkdirSync(socketDir, { recursive: true, mode: 0o700 });

const socketPath = join(socketDir, 'agent-host.sock');

// Clean up stale socket from previous crash
if (existsSync(socketPath)) unlinkSync(socketPath);

const server = createServer();

// Set restrictive umask BEFORE listen() so the socket is born with 0600.
// listen() creates the socket file — umask(0o177) masks out group+other rw.
// This eliminates the TOCTOU race of listen→chmod.
const previousUmask = process.umask(0o177);
server.listen(socketPath, () => {
  process.umask(previousUmask);  // restore immediately after socket creation
});
```

#### Layer 2: Per-Session Token Handshake

Even with correct file permissions, defense in depth requires a second factor. The daemon generates a cryptographic token at startup, shared via a restricted file.

**Rationale:** File permissions can be bypassed in edge cases — Docker bind mounts inheriting host UIDs, NFS with `no_root_squash`, misconfigured container namespaces. The token ensures that even if a process can connect to the socket, it must also possess a secret that only the legitimate server should know.

```typescript
// Daemon startup — generate and persist token
import { randomBytes, timingSafeEqual } from 'crypto';
import { openSync, writeSync, closeSync, fdatasyncSync } from 'fs';

const sessionToken = randomBytes(32).toString('hex');  // 256-bit

// Write token file atomically with correct permissions from the start.
// Using open()+write() with mode avoids the TOCTOU race of writeFile()+chmod().
const tokenPath = join(socketDir, 'agent-host.token');
const fd = openSync(tokenPath, 'w', 0o600);  // created with 0600 — no chmod needed
writeSync(fd, sessionToken);
fdatasyncSync(fd);  // ensure token is flushed to disk before daemon accepts connections
closeSync(fd);

// On client connection — require auth as first message
socket.once('data', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.method !== 'auth' || !timingSafeEqual(
    Buffer.from(msg.params.token),
    Buffer.from(sessionToken),
  )) {
    socket.destroy();
    return;
  }
  // Authenticated — proceed to handle JSON-RPC
  upgradeToJsonRpc(socket);
});
```

```typescript
// Server (client) — read token and authenticate on connect
import { readFileSync } from 'fs';

const token = readFileSync(join(socketDir, 'agent-host.token'), 'utf-8').trim();
const socket = connect(socketPath);
socket.write(JSON.stringify({
  jsonrpc: '2.0', method: 'auth',
  params: { token, pid: process.pid },
  id: 0,
}) + '\n');
```

**Token lifecycle:**
- Generated fresh on each daemon startup (not reusable across sessions)
- Written via `open()` with mode `0o600` — no TOCTOU window (permissions set at file creation, not after)
- `fdatasync` ensures token is on-disk before daemon accepts connections
- `timingSafeEqual` prevents timing side-channel attacks
- Connection rejected immediately on auth failure (no retry, no error details)

### Authorization Model

Once authenticated, the server has full daemon access. No per-operation ACLs are needed because:

- **Single-user system:** The daemon serves exactly one Flightdeck server instance
- **Same trust boundary:** If you can authenticate, you're the same user who started the daemon
- **No multi-tenancy:** Each developer runs their own daemon (there's no shared daemon server)

### Threat Mitigation Summary

| Threat | Mitigation | Layer |
|--------|-----------|-------|
| Rogue local process connects to socket | Socket file mode `0600` via umask — kernel rejects `connect()` | Filesystem |
| TOCTOU race on socket creation | `umask(0o177)` set before `listen()` — socket born with `0600`, no `chmod()` gap | Filesystem |
| TOCTOU race on token file creation | `open(path, 'w', 0o600)` + `fdatasync` — permissions set at file creation via fd | Filesystem |
| Socket directory traversal / symlink attack | Directory mode `0700` in user-private path (not `/tmp/`) | Filesystem |
| Docker/NFS permission bypass | Per-session token required as first message | Application |
| Token file read by other user | Token file mode `0600` in `0700` directory | Filesystem |
| macOS token persistence (Time Machine) | Token regenerated per session (stale tokens useless); document XDG_RUNTIME_DIR override | Operational |
| Daemon impersonation (fake daemon) | Client verifies socket liveness via connect test + token auth (not PID file — see below) | Application |
| Man-in-the-middle / network sniffing | Unix socket = no network exposure, local-only by definition | Transport |
| Timing side-channel on token comparison | `crypto.timingSafeEqual()` | Application |
| Stale socket from crashed daemon | `dev.mjs` attempts connect + token auth; on failure, unlinks stale socket and starts fresh daemon | Launcher |
| PID file recycling (false liveness) | PID file is informational only; liveness checked via socket connect + auth handshake | Launcher |
| Replay attack on auth token | Token is per-session; persistent connection (not per-request auth) | Protocol |
| Daemon crash kills agents | Graceful degradation to Phase 1 auto-resume; periodic roster snapshots limit data loss to 30s | Recovery |

### What We Explicitly Don't Need

- **TLS:** Data never leaves the machine. Unix socket is not network-accessible. TLS would add complexity and latency for zero security benefit.
- **mTLS / client certificates:** Overkill for same-user local IPC. File permissions + token provides equivalent assurance.
- **Rate limiting:** Trusted client over local IPC. No abuse vector.
- **Per-agent ACLs:** Single-user system. If you authenticated, you own everything.
- **Encryption at rest for token:** The token file has the same permissions as the socket file. If an attacker can read one, they can read the other. The security boundary is the filesystem permissions, not encryption.

### Daemon Crash Recovery

**What happens to agents if the daemon dies?**

If the daemon process crashes or is killed, all child agent processes die with it (OS SIGHUP propagation — same problem the daemon was designed to solve for the server). This is an inherent limitation of the Unix process model: stdio-pipe-connected children cannot outlive their parent.

**Recovery strategy: Graceful degradation to Phase 1 auto-resume.**

```
Daemon running → Daemon crashes
                    │
                    ├── Agent processes die (SIGHUP from OS)
                    ├── Server detects socket EOF → enters "daemon-lost" state
                    ├── Server logs warning, UI shows "⚠️ Daemon connection lost"
                    │
                    ├── dev.mjs detects daemon exit → restarts daemon
                    ├── Server reconnects to new daemon via socket
                    └── Server auto-resumes agents using Phase 1 roster persistence
                        (roster was persisted to SQLite periodically, not just at shutdown)
```

**Key design decisions:**

1. **Periodic roster snapshots:** The server writes the agent roster to SQLite every 30s (not just on graceful shutdown). This limits data loss to the last 30s of agent activity on unexpected daemon death.

2. **Daemon health heartbeat:** The server sends a `ping` JSON-RPC message every 10s. If 3 consecutive pings fail (30s), the server proactively enters "daemon-lost" mode rather than waiting for socket EOF (which may not fire promptly in all failure modes).

3. **Automatic daemon restart:** `dev.mjs` monitors the daemon process. On unexpected exit, it restarts the daemon and the server reconnects automatically. The user may see a brief "Resuming agents..." phase but no manual intervention is needed.

4. **No orphan agents:** Because agents are children of the daemon process, they cannot be orphaned. This is actually simpler than the alternative (detached agents that outlive everything) — we never have to find and clean up zombie agent processes.

**What about double-fault (daemon + server both crash)?**

Same as today: SQLite has the roster, file locks, DAG state. On next `npm run dev`, everything recovers via Phase 1 auto-resume. The daemon adds zero new failure modes beyond what already exists — it only adds a new recovery path (reconnect without re-spawn) for the common case (server restart, not daemon death).

### Emergency Kill Switch

When agents go rogue (runaway file writes, infinite loops, budget burn), the user needs a reliable way to stop everything immediately. Three escalation levels:

#### Level 1: CLI Command (Recommended)

```bash
# Graceful stop — agents get SIGTERM, 5s to finish, then SIGKILL
flightdeck daemon stop

# Immediate stop — SIGKILL to daemon (kills all agents instantly)
flightdeck daemon stop --force

# Status check — see daemon PID, uptime, agent count
flightdeck daemon status
```

Implementation in `bin/flightdeck.mjs`:

```typescript
// 'flightdeck daemon stop' command
async function daemonStop(force: boolean) {
  const socketDir = getSocketDir();
  const pidPath = join(socketDir, 'agent-host.pid');
  const socketPath = join(socketDir, 'agent-host.sock');

  if (force) {
    // Level 2: read PID file and send SIGKILL directly
    const pid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    process.kill(pid, 'SIGKILL');
    // Clean up stale files since daemon can't do it after SIGKILL
    for (const f of [socketPath, join(socketDir, 'agent-host.token'), pidPath]) {
      try { unlinkSync(f); } catch {}
    }
    console.log(`🛑 Daemon (PID ${pid}) force-killed. All agents terminated.`);
    return;
  }

  // Graceful: connect to daemon and send shutdown command
  const token = readFileSync(join(socketDir, 'agent-host.token'), 'utf-8').trim();
  const socket = connect(socketPath);
  socket.write(JSON.stringify({
    jsonrpc: '2.0', method: 'auth', params: { token }, id: 0,
  }) + '\n');
  socket.write(JSON.stringify({
    jsonrpc: '2.0', method: 'shutdown', params: { timeoutMs: 5000 }, id: 1,
  }) + '\n');
  // Daemon will: SIGTERM all agents → wait 5s → SIGKILL stragglers → exit
}
```

#### Level 2: Direct Signal (Fallback)

If the CLI doesn't work (e.g., Node.js is broken), users can send signals directly:

```bash
# Read the PID
cat ~/.flightdeck/run/agent-host.pid   # or $XDG_RUNTIME_DIR/flightdeck/agent-host.pid

# Graceful stop (SIGTERM → daemon shuts down agents, cleans up)
kill <pid>

# Nuclear option (SIGKILL → daemon dies instantly, agents die via SIGHUP)
kill -9 <pid>
```

#### Level 3: Kill File Sentinel (Last Resort)

For situations where neither CLI nor signals work (e.g., the daemon is stuck in a syscall, or the user doesn't know the PID):

```bash
# Create a kill sentinel — daemon watches for this file every 2s
touch ~/.flightdeck/run/EMERGENCY_STOP

# Daemon detects the sentinel and initiates forced shutdown:
#   1. SIGKILL all agent child processes
#   2. Unlink socket/token/pid files
#   3. Unlink the sentinel file
#   4. Exit with code 99
```

The daemon polls for the sentinel file alongside its normal health checks (every 2s via the same poll loop). This is the most reliable kill mechanism because it works even when:
- The daemon's event loop is blocked
- The socket is unresponsive
- PID is unknown
- The daemon is in an uninterruptible sleep (will trigger on next poll wakeup)

#### Daemon Signal Handling

```typescript
// In AgentHostDaemon.ts
process.on('SIGTERM', async () => {
  // Graceful: give agents 5s to finish, then force-kill
  console.log('[daemon] SIGTERM received — graceful shutdown...');
  await terminateAllAgents({ timeoutMs: 5000 });
  cleanup();  // remove socket, token, pid files
  process.exit(0);
});

process.on('SIGINT', () => {
  // Immediate: kill agents now, no grace period
  console.log('[daemon] SIGINT received — immediate shutdown');
  killAllAgents();  // SIGKILL to all child processes
  cleanup();
  process.exit(0);
});

// Kill file sentinel check (runs on 2s poll interval)
function checkKillSentinel() {
  const sentinel = join(socketDir, 'EMERGENCY_STOP');
  if (existsSync(sentinel)) {
    console.log('[daemon] 🛑 EMERGENCY_STOP sentinel detected');
    killAllAgents();
    cleanup();
    try { unlinkSync(sentinel); } catch {}
    process.exit(99);
  }
}
```

#### Emergency Procedure (User Documentation)

```
🛑 EMERGENCY: Stop all agents immediately
═══════════════════════════════════════════

Option A (recommended):
  $ flightdeck daemon stop --force

Option B (if CLI unavailable):
  $ kill -9 $(cat ~/.flightdeck/run/agent-host.pid)

Option C (if PID unknown):
  $ touch ~/.flightdeck/run/EMERGENCY_STOP
  (daemon auto-detects within 2 seconds)

Option D (nuclear — kills everything):
  $ pkill -9 -f flightdeck-agent-host
```

---

### Operational Robustness

Additional failure modes identified during group design review (@e7f14c5e, @bb14c13b):

#### Per-Agent Health Monitoring

The daemon must handle individual agent process death while remaining healthy itself. When a Copilot CLI agent's stdio pipes close unexpectedly (crash, OOM, segfault):

1. Daemon emits an `exit` event to the server (with exit code and agent ID)
2. Daemon cleans up internal state for that agent (remove from roster, close pipes)
3. Daemon does **NOT** auto-restart the agent — the server's existing `RecoveryService` / `RetryManager` decides whether to retry

This mirrors `AcpAdapter`'s existing `process.on('exit', ...)` handler. The daemon's ACP bridge layer should implement the same pattern.

#### Event Buffering on Server Reconnect

When the API server restarts and reconnects to the daemon, there's a window where agent events could be lost (old socket closing, new socket opening). The daemon must buffer events **only during the disconnected window** (not permanently — when a server is connected and consuming events, the buffer stays empty).

- **Buffer size:** Last 100 events per agent, or 30 seconds' worth, whichever is smaller
- **Buffer lifecycle:** Start buffering on server disconnect, stop and drain on reconnect
- **On reconnect:** Server sends `subscribe(agentId, { lastSeenEventId })` for each known agent. Daemon replays events after that ID.
- **Fresh server restart (no prior state):** Server sends `subscribe(agentId, { fromStart: true })`. Daemon replays: (1) full agent descriptor (role, status, sessionId, task, pid), then (2) all buffered events. This is the reconnect protocol's most important message.
- **Buffer overflow:** Oldest events dropped (FIFO). Server can request full state sync via `list()` if needed

#### Orphaned Mode (Server Disconnect)

If the daemon detects server disconnect (socket EOF, heartbeat timeout), it enters **orphaned mode**:

- Agents keep running — daemon does NOT terminate them
- Events are buffered (see above)
- Daemon logs warning: `[daemon] Server disconnected — agents preserved, waiting for reconnect`
- When a new server connects and authenticates, daemon exits orphaned mode and replays buffered events

This is the key behavior that makes the daemon valuable: server crash/restart is invisible to agents.

#### Single-Client Mode

The daemon accepts **one server connection at a time**. Connection management:

- **Normal case:** First server connects and authenticates → becomes the active client
- **Second connection attempt:** Rejected after auth with informative error:
  ```json
  { "error": "Connection rejected: server PID 12345 connected 47s ago is still active. If this is stale, wait for heartbeat timeout (10s) or restart the daemon." }
  ```
- **Split-brain mitigation (tsx watch fast restart):** When `tsx watch` restarts the server, the old server may still be shutting down (up to 5s graceful timeout). To minimize this window, the server closes the daemon socket connection **FIRST** in `gracefulShutdown()`, before stopping HTTP/WS/services. This releases the daemon for the new server immediately — agent lifecycle is the daemon's responsibility, not the server's.

  **Revised shutdown order:**
  ```
  Current:  stop agents → close WS → close HTTP → exit
  With daemon: close daemon socket → close WS → close HTTP → exit
  ```

- **Eviction on stale connection:** If the daemon's heartbeat detects the old server is dead (3 missed pings / 30s), it auto-evicts the stale connection. The next server connect succeeds immediately.

Multi-client adds massive complexity for a scenario that shouldn't happen. Single-client is the 80/20 solution.

#### Token File Race on Daemon Restart

If the daemon restarts (new token generated) while the server is also restarting, the server may read the old token file before the new daemon writes the new one. Auth fails on first attempt.

**Fix:** Server retries auth with a fresh token file read after a 500ms delay if the first attempt fails. Maximum 3 retries (1.5s total). This covers the race window where the daemon is still initializing.

#### Socket Ownership Check

If a developer accidentally runs `sudo npm run dev` once, the socket/token/pid files get created as `root`. Subsequent non-sudo runs can't connect.

**Fix:** Daemon startup checks `stat(socketDir).uid === process.getuid()` and refuses to start with a clear error:
```
Error: Socket directory ~/.flightdeck/run/ is owned by uid 0 (root), but daemon
is running as uid 1000. This usually means a previous run used sudo. Fix:
  sudo rm -rf ~/.flightdeck/run/
```

#### Zombie Agent Escalation

When terminating an agent (via `terminate(agentId)`, emergency stop, or daemon shutdown), the daemon uses escalating force:

```
SIGTERM → wait 5s → SIGKILL → wait 2s → force remove from roster
```

If SIGKILL doesn't reap the process within 2s (true zombie in Z state), the daemon logs an error and forcibly removes the agent from its internal roster. Node's `child_process` calls `waitpid()` internally which should handle this, but the 2s timeout is belt-and-suspenders.

This mirrors `AcpAdapter.terminate()` (line ~370 in AcpAdapter.ts) which already sends `stdin.end()` + `process.kill()`.

#### Auto-Shutdown Timer

The daemon has one simple rule: **12 hours with no server connection → daemon terminates itself and all agents.** Otherwise, the daemon stays alive indefinitely — with or without agents, as long as a server connects within the window.

- **Server connected:** Timer is cancelled. Daemon never shuts down while a server is connected.
- **Server disconnects:** 12-hour countdown starts. Any server reconnection resets the timer.
- **Warning at 11 hours:** Daemon logs: `"Daemon will auto-terminate in 1 hour if no server reconnects"`
- **At 12 hours:** Daemon terminates all agents and exits.

The countdown is written to a status file so `flightdeck daemon status` can display: `Auto-shutdown in 11h 42m (no server connected, 3 agents running)`.

The daemon also watches for its parent process (`dev.mjs`) — if the parent exits, the 12-hour countdown starts.

#### Mass-Failure Detection

*Inspired by Gastown's mass-death detection pattern.*

When multiple agents crash in a short window, it usually signals a systemic issue (bad API key, rate limit, model outage, misconfigured environment) rather than individual agent bugs. The daemon detects this pattern and pauses spawning to prevent a crash loop that burns budget and produces no useful work.

**Detection algorithm:**

```typescript
interface MassFailureDetector {
  readonly threshold: number;   // Default: 3 agents
  readonly windowMs: number;    // Default: 60_000 (60 seconds)
  readonly cooldownMs: number;  // Default: 120_000 (2 minutes)

  // Sliding window of recent exits
  private recentExits: Array<{
    agentId: string;
    exitCode: number | null;
    signal: string | null;
    error: string | null;      // Last stderr line or crash reason
    timestamp: number;
  }>;

  private paused: boolean;
  private pausedAt: number | null;
}
```

**Trigger logic:** On every agent exit event, the daemon:
1. Records the exit in `recentExits` (capped at 50 entries, oldest dropped)
2. Counts exits within the trailing `windowMs`
3. If count ≥ `threshold` → enter **paused state**

**Paused state behavior:**
- New `spawn()` calls are rejected with error: `"Spawning paused: mass failure detected (3 agents exited in 47s). Auto-resumes in 1m 13s or use daemon.resumeSpawning()"`
- Existing agents continue running (the issue may not affect all agents)
- Daemon emits WebSocket event to server:

```json
{
  "jsonrpc": "2.0",
  "method": "daemon.massFailure",
  "params": {
    "exitCount": 3,
    "windowSeconds": 47,
    "recentExits": [
      { "agentId": "agent-1", "exitCode": 1, "error": "Error: 401 Unauthorized" },
      { "agentId": "agent-2", "exitCode": 1, "error": "Error: 401 Unauthorized" },
      { "agentId": "agent-3", "exitCode": 1, "error": "Error: 401 Unauthorized" }
    ],
    "pausedUntil": "2026-03-07T17:52:00Z",
    "likelyCause": "auth_failure"   // Heuristic from exit patterns
  }
}
```

**Cause heuristics:** The daemon inspects recent exit patterns to suggest a likely cause:

| Pattern | `likelyCause` | UI Message |
|---------|---------------|------------|
| All exits have "401" or "Unauthorized" in error | `auth_failure` | "API key may be invalid or expired" |
| All exits have "429" or "rate limit" in error | `rate_limit` | "API rate limit hit — waiting for cooldown" |
| All exits have "503" or "unavailable" in error | `model_unavailable` | "Model provider may be down" |
| Mixed exit codes / no clear pattern | `unknown` | "Multiple agents crashed — check logs" |
| All exits are signal 9 (OOM) | `resource_exhaustion` | "Agents running out of memory" |

**Server-side UI response:**

The server receives `daemon.massFailure` and shows a dismissible alert banner:

```
⚠️ Multiple agents crashed — possible systemic issue
   3 agents exited in 47s. Likely cause: API key may be invalid or expired.
   Spawning paused. Auto-resumes in 1m 13s.
   [View Details]  [Resume Spawning Now]  [Stop All Agents]
```

**[View Details]** expands to show the exit table (agent ID, exit code, error message, timestamp).

**[Resume Spawning Now]** calls `daemon.resumeSpawning()` — clears the pause immediately.

**[Stop All Agents]** calls `daemon.terminateAll()` — for when the user wants to fix the root cause first.

**Auto-resume:** After `cooldownMs` elapses, the daemon automatically clears the paused state and allows spawning again. If agents immediately crash again, the detector re-triggers (preventing infinite crash loops — each cycle adds a 2-minute gap).

**Configuration:**

```yaml
# flightdeck.config.yaml
daemon:
  massFailure:
    threshold: 3          # Minimum exits to trigger (default: 3)
    windowSeconds: 60     # Sliding window size (default: 60)
    cooldownSeconds: 120  # Pause duration before auto-resume (default: 120)
```

Thresholds are also settable via daemon JSON-RPC: `daemon.configure({ massFailure: { threshold: 5 } })`.

**Implementation note:** This is ~50-80 lines in the daemon core. The sliding window is a simple array filter on timestamps. The cause heuristic is a series of regex checks on the last stderr line. The WebSocket event uses the existing event channel — no new protocol needed.

#### Reconnect State Strategy

On server reconnect, the server needs to rebuild in-memory state (delegations, DAG task assignments, completion tracking, message queues). Two options were considered:

**Option A (chosen): Server reconstructs from SQLite.** Delegations, DAG tasks, file locks, and agent metadata are already persisted. The server's existing "resume project" flow rebuilds this state. The daemon only provides: agent IDs, session IDs, PIDs, and event streams. All business logic state lives in the server + SQLite.

**Option B (rejected): Daemon persists server snapshots.** Server sends `snapshot(state)` every 30s, daemon stores it, server calls `getSnapshot()` on reconnect. Rejected because it couples the daemon to server internals and makes the daemon a second source of truth.

**Principle: The daemon stays dumb, the server stays smart.** The daemon understands processes, pipes, and events. It does not understand delegations, DAG tasks, or business logic.

#### Protocol Hardening

**JSON-RPC message size limit:** Max 10MB per message. A malicious or buggy client sending a multi-GB payload would cause OOM. The daemon enforces this on the socket read buffer and disconnects violators.

**Daemon structured logging:** The daemon uses the same pino logger from R5, enabling correlation of daemon events with server events via `agentId`. At minimum, the daemon logs: connection events, auth attempts (success/fail), spawn/terminate calls, disconnections, and auto-shutdown timer state.

### Graceful Shutdown and State Persistence

When the daemon shuts down (12h timeout, production `daemon.shutdown({ persist: false })`, or emergency stop), it must preserve all agent state so agents can be resumed later via SDK resume. No work should be lost.

#### What SQLite Already Persists (No Additional Work Needed)

A gap analysis of the current schema (`packages/server/src/db/schema.ts`, 25 tables) shows that most business state is already in SQLite:

| State | SQLite Table | Status |
|-------|-------------|--------|
| Projects | `projects` | ✅ Full CRUD |
| Project sessions (with sessionId) | `projectSessions` | ✅ Includes `claimSessionForResume()` |
| DAG tasks | `dagTasks` | ✅ Full lifecycle |
| File locks | `fileLocks` | ✅ Per-agent tracking |
| Agent plans | `agentPlans` | ✅ JSON, upserted on change |
| Conversations / messages | `conversations`, `messages` | ✅ Committed messages |
| Agent memory (key-value) | `agentMemory` | ✅ Cross-agent state sharing |
| Decisions | `decisions` | ✅ Architecture decisions log |
| Timers | `timers` | ✅ Scheduled reminders |
| Cost records | `taskCostRecords` | ✅ Token usage tracking |
| Groups | `groups`, `groupMembers` | ✅ Agent collaboration groups |

**These require zero additional persistence work.** The server reconstructs all of this from SQLite on restart.

#### What's NOT in SQLite (Critical Gaps)

| State | Current Location | Impact of Loss |
|-------|-----------------|----------------|
| **Agent instances** (id, role, model, task, sessionId, parentId, cwd) | `AgentManager.agents` Map (in-memory) | 🔴 All running agents lost — cannot resume |
| **Delegations** (parent→child task assignments) | `CommandDispatcher.delegations` Map (in-memory) | 🔴 Mid-delegation workflows broken, children orphaned |
| **Reported completions** | `CommandDispatcher.reportedCompletions` Set | 🟡 Duplicate completion reports possible |
| **Queued messages** (pending delivery to agents) | `Agent.pendingMessages` array | 🟡 Queued inter-agent messages lost |
| **Tool call history** | `Agent.toolCalls` array | 🟡 No audit trail for recent tool invocations |
| **Message buffers** (partially received text) | `AgentManager.messageBuffers` Map | 🟢 Low impact — partial text discarded |

**The two critical gaps are agent instances and delegations.** Both must be persisted for graceful resume.

#### Persistence Strategy: SQLite + Minimal Filesystem

**Principle: Persist to SQLite wherever possible. Use the filesystem only for daemon-specific state that the server doesn't own.**

The server should add two new SQLite tables to close the critical gaps:

```sql
-- New table: active agent roster (persisted on every spawn/terminate)
CREATE TABLE agentRoster (
  id TEXT PRIMARY KEY,           -- agent ID
  projectId TEXT NOT NULL,
  role TEXT NOT NULL,
  model TEXT,
  task TEXT,
  status TEXT NOT NULL,
  sessionId TEXT,                -- SDK session ID for resume
  parentId TEXT,                 -- parent agent ID (for delegation tree)
  cwd TEXT,
  cliCommand TEXT NOT NULL,      -- which CLI binary to use
  cliArgs TEXT,                  -- JSON array of additional CLI args
  spawnedAt TEXT NOT NULL,
  FOREIGN KEY (projectId) REFERENCES projects(id)
);

-- New table: active delegations (persisted on every delegate/complete)
CREATE TABLE activeDelegations (
  id TEXT PRIMARY KEY,
  parentAgentId TEXT NOT NULL,
  childAgentId TEXT NOT NULL,
  leadId TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | completed | failed
  createdAt TEXT NOT NULL,
  completedAt TEXT,
  FOREIGN KEY (parentAgentId) REFERENCES agentRoster(id),
  FOREIGN KEY (childAgentId) REFERENCES agentRoster(id)
);
```

These tables are written on every agent spawn/terminate and delegation create/complete — NOT as a batch on shutdown. This ensures state is always current, even on hard crashes (SIGKILL, OOM) where graceful shutdown doesn't run.

#### Daemon Filesystem State (Minimal)

The daemon owns a small amount of state that doesn't belong in the server's SQLite:

```
~/.flightdeck/run/
  daemon.sock                    # Unix domain socket (or named pipe on Windows)
  daemon.pid                     # PID file (informational)
  daemon.token                   # Per-session auth token
  daemon-manifest.json           # Shutdown manifest (written on graceful exit)
```

The `daemon-manifest.json` is written ONLY during graceful shutdown and contains the daemon's view of what was running:

```json
{
  "version": "1.0.0",
  "shutdownAt": "2026-03-07T17:00:00.000Z",
  "shutdownReason": "12h-timeout",
  "agents": [
    {
      "id": "cc29bb0d",
      "sessionId": "sess-abc123",
      "pid": 48291,
      "role": "architect",
      "status": "running",
      "lastEventId": "evt-789"
    }
  ]
}
```

This manifest is a **hint file** for faster resume — the authoritative state is always SQLite. If the manifest is missing (hard crash), the server reconstructs entirely from SQLite. If the manifest exists, the server can cross-reference it with SQLite for faster reconciliation.

#### Graceful Shutdown Sequence

When the daemon receives a shutdown signal:

```
1. Stop accepting new connections
2. If server is connected: send 'daemon:shutting_down' event
3. For each agent:
   a. Persist final state to daemon-manifest.json
   b. If agent has a sessionId: state is already preserved in SDK session files
   c. Send graceful terminate (SIGTERM on Unix, stdin.end() on Windows)
   d. Wait up to 5s for clean exit
   e. If still running: force terminate (SIGKILL / TerminateProcess)
4. Write daemon-manifest.json with shutdown metadata
5. Clean up socket file and PID file (keep token file for audit)
6. Exit
```

**Key insight:** SDK session state (`~/.copilot/session-state/{sessionId}/`) is managed by the CLI process itself, not by the daemon. The daemon's job is to give each agent enough time to flush its session state to disk before termination. The 5s graceful window allows the CLI to persist conversation history, tool state, and planning artifacts.

#### Resume from Preserved State

On next startup, the server + daemon resume agents:

```
1. Server starts, connects to daemon (or starts new daemon)
2. Server reads agentRoster table from SQLite
3. Server reads daemon-manifest.json (if exists) for cross-reference
4. For each agent in roster with status != 'terminated':
   a. Server calls daemon.spawn(agentId, { resume: sessionId, role, model, cwd })
   b. Daemon spawns CLI process with --resume <sessionId>
   c. CLI loads session state from disk, resumes conversation
   d. Agent reconnects to server via ACP protocol
5. Server reads activeDelegations table, rebuilds delegation tree
6. Server reads dagTasks, fileLocks, etc. from existing tables
7. UI shows "Resuming N agents..." with per-agent progress
8. All agents back online with full context
```

**The server can also call `daemon.resumeAll()` as a convenience method** that reads the manifest and spawns all agents in parallel.

#### What Happens on Hard Crash (No Graceful Shutdown)

If the daemon is killed by SIGKILL, OOM, or power loss:
- No `daemon-manifest.json` written (that's fine — it's a hint, not authoritative)
- Agent CLI processes may or may not have flushed session state to disk
- SQLite `agentRoster` and `activeDelegations` tables have the last-known state
- On next startup: server reads SQLite, attempts `--resume` for each agent
- Agents whose SDK sessions survived: resume with full context
- Agents whose SDK sessions are corrupted: start fresh with role + task (graceful degradation)

This is the same recovery path as "daemon crash → Phase 1 fallback" but with better state reconstruction thanks to the new SQLite tables.

#### Directory Structure Summary

```
# Default: Home directory storage (all projects)
~/.flightdeck/
  projects/
    <project-id>/                       # e.g. flightdeck-a3f7/
      project.yaml                      # Project metadata anchor
      shared/                           # Shared workspace
  projects.json                         # Global index: projectId → projectDir path
  run/                                  # Daemon runtime (ephemeral)
    daemon.sock                         # IPC socket
    daemon.pid                          # PID file
    daemon.token                        # Auth token
    daemon-manifest.json                # Shutdown hint (written on graceful exit)
    EMERGENCY_STOP                      # Kill sentinel (created by user)

# Opt-in: Local storage (storage: local) — supports multiple projects per repo
<git-repo-root>/
  .flightdeck/
    projects/
      <project-id>/                     # e.g. flightdeck-a3f7/
        project.yaml                    # Project metadata anchor
        shared/                         # Shared workspace

flightdeck.db                           # SQLite (authoritative runtime state)
  → agentRoster table                   # NEW: active agent instances
  → activeDelegations table             # NEW: parent→child task assignments
  → dagTasks, fileLocks, agentPlans...  # EXISTING: business state

~/.copilot/session-state/{sessionId}/   # SDK session files (managed by CLI)
  → conversation history, tool state, planning artifacts
```

**Design principle: SQLite is the single source of truth** for runtime state. The `project.yaml` files are the anchor for project discovery and link projects to their working directories. The daemon manifest is a performance hint for faster resume.

#### Storage Location Rule

Project state lives in `~/.flightdeck/projects/<project-id>/` **by default**. This keeps project metadata out of the repo — important for multi-contributor repos where committing `.flightdeck/` would pollute the tree.

| Condition | `.flightdeck/` location | Notes |
|-----------|------------------------|-------|
| Default (always) | `~/.flightdeck/projects/<project-id>/` | Never pollutes the repo |
| User opt-in (`storage: local`) | `<git-repo-root>/.flightdeck/projects/<project-id>/` | For solo projects; supports monorepos with multiple projects |

**Opt-in to local storage:** Solo developers who want `.flightdeck/` in their project directory (discoverable, committable, colocated with code) can set `storage: local` during project creation or in `project.yaml`:

```typescript
// CLI: flightdeck init --storage local
// API: ProjectRegistry.create({ title: 'My Project', storage: 'local' })

function resolveProjectDir(cwd: string, projectId: string, storage?: 'user' | 'local'): { dir: string; type: 'user' | 'local' } {
  if (storage === 'local') {
    // User opted into local storage — .flightdeck/projects/<id>/ at git root
    try {
      const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'],
        { cwd, encoding: 'utf8' }).trim();
      return { dir: path.join(repoRoot, '.flightdeck', 'projects', projectId), type: 'local' };
    } catch {
      // Not in a git repo — fall back to user dir even though user asked for local
      return { dir: path.join(os.homedir(), '.flightdeck', 'projects', projectId), type: 'user' };
    }
  }
  // Default: user directory — never touches the project tree
  return { dir: path.join(os.homedir(), '.flightdeck', 'projects', projectId), type: 'user' };
}
```

**Why user-dir-first?** Multi-contributor repos shouldn't have one developer's Flightdeck state committed. The user directory default is safe for all workflows and OS-neutral (`os.homedir()` works on Windows, macOS, and Linux). Solo developers who want project-local convenience opt in explicitly — they understand the tradeoff. The `storage` field is persisted in `project.yaml` so the choice is remembered across restarts.

#### Project Metadata File (`project.yaml`)

Each project has a `project.yaml` inside its project directory. By default this is at `~/.flightdeck/projects/<id>/project.yaml`. If the user opted into repo storage, it's at `<git-repo-root>/.flightdeck/projects/<id>/project.yaml`. Both modes use the same `projects/<id>/` structure — the only difference is the parent. This means monorepos can host multiple Flightdeck projects.

```yaml
# Default (home): ~/.flightdeck/projects/flightdeck-a3f7/project.yaml
# Repo opt-in:    /Users/justinc/Documents/GitHub/ai-crew/.flightdeck/projects/flightdeck-a3f7/project.yaml
id: flightdeck-a3f7
name: Flightdeck
description: AI crew orchestration platform
workingDir: /Users/justinc/Documents/GitHub/ai-crew   # Where agents run (git repo root or standalone dir)
storage: user                                           # 'user' (default) or 'local' (opt-in)
status: active
createdAt: "2026-03-07T14:00:00.000Z"
updatedAt: "2026-03-07T17:30:00.000Z"
```

**Location resolution** uses the storage location rule above:
```typescript
const { dir, type } = resolveProjectDir(process.cwd(), projectId, existingProject?.storage);
const projectYaml = path.join(dir, 'project.yaml');
```

**Why a file, not just SQLite?**

1. **Project discovery without a running server.** CLI tools (`flightdeck list`, `flightdeck status`) can find the project via `~/.flightdeck/projects.json` — no server or SQLite needed. For repo-storage projects, `.flightdeck/project.yaml` in the repo also works, similar to how `.git/` identifies a git repo.

2. **Anchors project to its working directory.** The `workingDir` field is where agents run (git repo root or standalone directory). All relative paths in the project (agent cwd, worktrees, shared workspace) resolve from this. If the directory moves, the server detects the mismatch and updates the field.

3. **Human-inspectable.** A developer can `cat .flightdeck/project.yaml` to see what's configured. YAML is readable; SQLite requires tooling.

4. **Survives database reset.** If the user deletes `flightdeck.db` to start fresh, the project metadata survives in the repo. The server re-imports from `project.yaml` on next startup.

5. **Committable (local-storage opt-in).** When `storage: local`, the `project.yaml` (minus machine-specific fields like `workingDir`) can be committed to the repo, allowing team members to share project configuration. User-storage projects keep it private by default.

**Global project registry:** The server also maintains `~/.flightdeck/projects.json` — a lightweight index mapping project IDs to project root paths for cross-project discovery:

```json
{
  "flightdeck-a3f7": "/Users/justinc/Documents/GitHub/ai-crew",
  "my-other-project-c1b9": "/Users/justinc/Documents/GitHub/other-repo",
  "scratch-pad-e4f1": "~/.flightdeck/projects/scratch-pad-e4f1"
}
```

This enables `flightdeck list` to find all projects (repo-based and standalone) without scanning the filesystem.

**Lifecycle:**

| Event | Action |
|-------|--------|
| `ProjectRegistry.create()` | Create project dir (`~/.flightdeck/projects/<id>/` or `<git-root>/.flightdeck/projects/<id>/`), write `project.yaml`, register in `projects.json`, insert into SQLite |
| Server startup | Resolve project root, read `project.yaml`, reconcile with SQLite |
| Project update (name, description) | Update both `project.yaml` and SQLite |
| Project delete | Remove `.flightdeck/project.yaml`, unregister from `projects.json`, delete SQLite row |
| Database reset | On next startup, re-import from `project.yaml` |

**Reconciliation on startup:**

```typescript
function reconcileProject(projectDir: string, db: Database): void {
  const yamlPath = path.join(projectDir, 'project.yaml');
  if (!fs.existsSync(yamlPath)) return;  // No project.yaml → not a Flightdeck project

  const yaml = loadProjectYaml(yamlPath);
  const dbProject = db.drizzle.select().from(projects).where(eq(projects.id, yaml.id)).get();

  if (!dbProject) {
    // Project exists on disk but not in DB (e.g., DB was reset) → import
    db.drizzle.insert(projects).values({ ...yaml, projectDir }).run();
  } else if (yaml.updatedAt > dbProject.updatedAt) {
    // YAML is newer → update DB (e.g., user edited project.yaml manually)
    db.drizzle.update(projects).set({ name: yaml.name, projectDir, updatedAt: yaml.updatedAt })
      .where(eq(projects.id, yaml.id)).run();
  }

  // Update global registry
  updateProjectsJson(yaml.id, projectDir);
}
```

**The `project.yaml` is the minimal, portable, human-readable anchor.** SQLite holds the full runtime state (sessions, DAG, agents, locks). The YAML file holds only what's needed for discovery and configuration.

### Message Persistence & Recovery

When the server restarts (or crashes), several categories of in-flight state are lost because they live only in memory. The daemon keeps agents alive, but once the server reconnects, it must recover queued work — otherwise messages are silently dropped and delegations vanish.

#### In-Memory State Audit

| State | Location | Data Structure | Persisted? | Impact of Loss |
|-------|----------|---------------|------------|----------------|
| **Agent message queue** | `Agent.pendingMessages[]` | `PromptContent[]` (max 200) | ❌ | Messages from peers/lead never delivered — agent misses instructions |
| **Active delegations** | `CommandDispatcher.delegations` | `Map<string, Delegation>` | ❌ | Parent agent never gets completion callback; HeartbeatMonitor incorrectly reports idle |
| **Pending approvals** | `ApprovalGateHook.pendingApprovals` | `Map<string, {id, action, reason, timestamp}>` | ❌ | Blocked commands (TERMINATE_AGENT, RESET_DAG, CREATE_AGENT) stuck forever |
| **Pending system actions** | `CommandDispatcher.pendingSystemActions` | `Map<decisionId, {type, value, agentId}>` | ❌ | Config changes (e.g., raise agent limit) approved but never applied |
| **Streaming text buffers** | `CommandDispatcher.textBuffers` | `Map<agentId, string>` | ❌ | Partial command output lost — acceptable (agent retries) |
| **Reported completions** | `CommandDispatcher.reportedCompletions` | `Set<string>` | ❌ | Duplicate completion events possible — harmless (idempotent) |

**Already persisted (no action needed):**

| State | Table | Notes |
|-------|-------|-------|
| Timers | `timers` | ✅ DB-first persistence, `loadPending()` on startup — crash-safe |
| Group messages | `chatGroupMessages` | ✅ Full history persisted |
| Decision history | `decisions` | ✅ Approval records persisted (but gate queue is not) |
| Activity log | `activityLog` | ✅ Message send/receive audit trail |
| DAG tasks | `dagTasks` | ✅ Task state persisted |
| Agent memory | `agentMemory` | ✅ Cross-session key-value store |
| Conversations | `conversations`, `messages` | ✅ Full agent conversation history |

#### New SQLite Table: `messageQueue`

A single table for all recoverable queued work. Write-on-enqueue (not write-on-shutdown) for crash safety:

```sql
CREATE TABLE messageQueue (
  id TEXT PRIMARY KEY,                    -- msg-{timestamp}-{random}
  projectId TEXT NOT NULL REFERENCES projects(id),
  targetAgentId TEXT NOT NULL,            -- Who should receive this
  sourceAgentId TEXT,                     -- Who sent it (null for system messages)
  type TEXT NOT NULL,                     -- 'agent_message' | 'delegation_result' | 'broadcast' | 'system'
  priority INTEGER NOT NULL DEFAULT 0,   -- 1 = priority, 0 = normal
  payload TEXT NOT NULL,                  -- JSON: the PromptContent or message body
  status TEXT NOT NULL DEFAULT 'queued',  -- 'queued' | 'delivered' | 'expired'
  createdAt TEXT NOT NULL,
  deliveredAt TEXT,
  expiresAt TEXT                          -- Optional TTL (e.g., broadcasts expire after 5 min)
);

CREATE INDEX idx_mq_target_status ON messageQueue(targetAgentId, status);
CREATE INDEX idx_mq_project ON messageQueue(projectId);
```

**Write-on-enqueue pattern:** Every call to `agent.queueMessage()` writes to `messageQueue` first, then adds to the in-memory array. This mirrors the timer pattern (`TimerRegistry` persists to DB before caching in memory) — proven crash-safe in the codebase.

```typescript
// Agent.queueMessage() — updated flow
async queueMessage(msg: PromptContent, priority?: boolean): Promise<void> {
  // 1. Persist to SQLite FIRST (crash-safe)
  const row = { id: generateId('msg'), targetAgentId: this.id, type: 'agent_message',
                priority: priority ? 1 : 0, payload: JSON.stringify(msg), status: 'queued' };
  db.insert(messageQueue).values(row).run();

  // 2. Then add to in-memory queue (fast delivery path)
  this.enqueueMessage(msg, priority);

  // 3. If agent is idle, deliver immediately
  if (this.status === 'idle') this.drainPendingMessages();
}

// On successful delivery, mark as delivered
async deliverMessage(msgId: string): Promise<void> {
  db.update(messageQueue).set({ status: 'delivered', deliveredAt: now() })
    .where(eq(messageQueue.id, msgId)).run();
}
```

#### New SQLite Table: `activeDelegations`

Delegations are critical business state — a parent agent's `DELEGATE` command creates a child agent and tracks completion. Loss means the parent never learns the child finished.

```sql
CREATE TABLE activeDelegations (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  fromAgentId TEXT NOT NULL,              -- Parent (delegating agent)
  toAgentId TEXT NOT NULL,                -- Child (assigned agent)
  toRole TEXT NOT NULL,
  task TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'completed' | 'failed' | 'cancelled'
  result TEXT,
  createdAt TEXT NOT NULL,
  completedAt TEXT
);

CREATE INDEX idx_deleg_from ON activeDelegations(fromAgentId, status);
CREATE INDEX idx_deleg_to ON activeDelegations(toAgentId);
CREATE INDEX idx_deleg_project ON activeDelegations(projectId);
```

**Write pattern:** `CommandDispatcher` writes to `activeDelegations` on every delegation create/complete/fail — same write-on-mutation pattern. The in-memory `Map` becomes a cache, SQLite is authoritative.

#### Approval Gate Recovery

Pending approvals (`ApprovalGateHook.pendingApprovals`) are transient by nature — the action that triggered the approval is suspended in an agent's turn. On server restart:

- **If daemon is running:** The agent is still alive, waiting. When the server reconnects and the agent's next message arrives, the agent will re-issue the command that needs approval. The approval gate will create a new pending entry. **No persistence needed** — the agent retries naturally.

- **If no daemon (crash restart):** The agent is dead. On resume via SDK, the agent gets its conversation history back and will re-attempt the gated command. Same outcome — no persistence needed.

**Decision: Don't persist approval gate state.** It's self-healing through agent retry. Persisting it would require tracking the suspended coroutine state, which is complex and unnecessary.

#### Pending System Actions Recovery

`pendingSystemActions` (e.g., approved config changes not yet applied) are a genuine gap — the user approved a change, but the server crashed before applying it.

**Fix:** Write the approved action to the existing `decisions` table with a `status: 'approved_pending_apply'` state. On startup, the server scans for `approved_pending_apply` decisions and applies them.

```typescript
// On approval:
db.update(decisions).set({ status: 'approved_pending_apply' })
  .where(eq(decisions.id, decisionId)).run();

// On startup recovery:
const pending = db.select().from(decisions)
  .where(eq(decisions.status, 'approved_pending_apply')).all();
for (const decision of pending) {
  applySystemAction(decision);  // e.g., raise agent limit
  db.update(decisions).set({ status: 'approved' })
    .where(eq(decisions.id, decision.id)).run();
}
```

#### Recovery Flow on Server Startup

When the server starts (or reconnects to the daemon after restart):

```
Server startup sequence (message recovery):
  1. Load timers             → TimerRegistry.loadPending()          [EXISTING]
  2. Load delegations        → activeDelegations table → Map        [NEW]
  3. Load message queues     → messageQueue WHERE status='queued'   [NEW]
  4. Apply pending actions   → decisions WHERE status='approved_pending_apply' [NEW]
  5. Connect to daemon       → subscribe to each agent
  6. For each agent:
     a. Daemon replays buffered events (event buffering protocol)
     b. Server rebuilds agent in-memory state from SQLite
     c. Server drains messageQueue → agent.pendingMessages[]
     d. Agent idle? → deliver first queued message immediately
```

#### Daemon Interaction

The daemon and message persistence work together but stay decoupled:

- **Daemon responsibility:** Keep agents alive, buffer agent *events* (stdout, exit) during server disconnect
- **Server responsibility:** Persist and recover *messages to agents* (queued work, delegation results)
- **No overlap:** The daemon never reads `messageQueue` — it doesn't understand business logic. The server never buffers agent events — that's the daemon's job.

```
         Messages TO agents          Events FROM agents
         ──────────────────          ───────────────────
Persist: Server → SQLite messageQueue    Daemon → in-memory event buffer
Recover: Server reads SQLite on start    Daemon replays on server reconnect
```

**Scenario: 12-agent crew, developer saves file, tsx watch restarts server:**

1. **t=0s:** Server begins shutdown. Writes nothing extra (messages already in SQLite from write-on-enqueue).
2. **t=0-3s:** Server dies. Daemon enters orphaned mode, buffers agent events.
3. **t=3-5s:** New server starts. Loads `messageQueue`, `activeDelegations`, `timers` from SQLite.
4. **t=5s:** Server connects to daemon, subscribes to all 12 agents with `lastSeenEventId`.
5. **t=5-6s:** Daemon replays buffered events. Server drains `messageQueue` for each agent.
6. **t=6s:** All agents have their queued messages. Delegations are tracked. Timers are ticking. Zero messages lost.

#### What We Explicitly Don't Persist

| State | Reason |
|-------|--------|
| Streaming text buffers (`textBuffers`) | Partial command output — agent retries the command |
| Reported completions set | Deduplication cache — duplicate completions are idempotent |
| Approval gate queue | Self-healing — agent re-issues gated command on resume |
| WebSocket subscriptions | Rebuilt on reconnect |
| In-memory agent references | Rebuilt from daemon `list()` + SQLite |

### Human-Readable Project IDs

Project IDs appear in filesystem paths, UI, API responses, logs, and agent context. UUIDs (`8e0f22ff-a4e7-4142-853b-527735bd3adb`) are unreadable in all of these contexts. Project IDs should be human-readable slugs.

#### Generation

```typescript
import { randomBytes } from 'crypto';

function generateProjectId(title: string): string {
  const slug = slugify(title);
  const suffix = randomBytes(2).toString('hex');  // 4 hex chars = 65,536 possibilities
  return `${slug}-${suffix}`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '')        // Trim leading/trailing hyphens
    .slice(0, 40);                   // Max 40 chars for the slug portion
}
```

**Examples:**
| Project Title | Generated ID |
|--------------|-------------|
| Flightdeck | `flightdeck-a3f7` |
| AI Crew Platform | `ai-crew-platform-b2e1` |
| My Test Project!! | `my-test-project-9c4d` |
| 日本語プロジェクト | `-f8a2` (non-Latin chars stripped; suffix only) |

**Constraints:**
- Max total length: 45 characters (40 slug + 1 hyphen + 4 suffix)
- Suffix: 4 hex characters (65,536 possibilities per slug). Sufficient for a local dev tool.
- Collision handling: On `UNIQUE` constraint violation in SQLite, regenerate with new random suffix. Retry up to 3 times.
- Empty slug (all special characters): Fall back to `project-{suffix}`.

#### Where Project IDs Appear

| Context | Current (UUID) | New (slug) | Impact |
|---------|---------------|------------|--------|
| Filesystem | `~/.flightdeck/projects/8e0f22ff.../` | `~/.flightdeck/projects/flightdeck-a3f7/` | ✅ Readable in terminal |
| UI display | Truncated or hidden | Shown directly | ✅ User can identify projects at a glance |
| API responses | `{ projectId: "8e0f22ff..." }` | `{ projectId: "flightdeck-a3f7" }` | ✅ Readable in curl/logs |
| Log correlation | `project=8e0f22ff...` | `project=flightdeck-a3f7` | ✅ Grep-friendly |
| SQLite `projects.id` | UUID text | Slug text | ✅ Same column type (TEXT) |
| Foreign keys | 7 tables reference `projects.id` | No schema change needed | ✅ TEXT → TEXT |

#### Migration Path

The `projects.id` column is `TEXT` (not a UUID type), so the migration is a data update, not a schema change:

```typescript
// Migration: generate slug IDs for existing projects
function migrateProjectIds(db: Database): void {
  const existing = db.drizzle.select().from(projects).all();
  for (const project of existing) {
    if (isUUID(project.id)) {
      const newId = generateProjectId(project.name);
      // Update all tables that reference this project ID
      db.drizzle.transaction((tx) => {
        tx.update(projects).set({ id: newId }).where(eq(projects.id, project.id)).run();
        tx.update(projectSessions).set({ projectId: newId }).where(eq(projectSessions.projectId, project.id)).run();
        tx.update(dagTasks).set({ projectId: newId }).where(eq(dagTasks.projectId, project.id)).run();
        tx.update(fileLocks).set({ projectId: newId }).where(eq(fileLocks.projectId, project.id)).run();
        tx.update(activityLog).set({ projectId: newId }).where(eq(activityLog.projectId, project.id)).run();
        tx.update(decisions).set({ projectId: newId }).where(eq(decisions.projectId, project.id)).run();
        tx.update(chatGroups).set({ projectId: newId }).where(eq(chatGroups.projectId, project.id)).run();
        tx.update(collectiveMemory).set({ projectId: newId }).where(eq(collectiveMemory.projectId, project.id)).run();
        // NEW tables (if they exist):
        tx.update(agentRoster).set({ projectId: newId }).where(eq(agentRoster.projectId, project.id)).run();
        tx.update(activeDelegations).set({ /* no direct projectId */ }).run();
      });
    }
  }
}

function isUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
```

**Migration is safe:** All foreign key references use the same TEXT type. The transaction ensures atomicity — either all tables update or none do. The `isUUID()` check makes the migration idempotent (skip already-migrated projects).

#### ProjectRegistry Update

```typescript
// packages/server/src/projects/ProjectRegistry.ts
create(name: string, description?: string, cwd?: string): Project {
  const id = generateProjectId(name);  // Was: randomUUID()
  const now = new Date().toISOString();
  try {
    this.db.drizzle.insert(projects).values({ id, name, description, cwd, status: 'active', createdAt: now, updatedAt: now }).run();
  } catch (err: any) {
    if (err.message?.includes('UNIQUE constraint')) {
      // Collision — regenerate (up to 3 retries)
      return this.create(name, description, cwd);
    }
    throw err;
  }
  return { id, name, description: description ?? '', cwd: cwd ?? null, status: 'active', createdAt: now, updatedAt: now };
}
```

#### UI Display

The project ID should be visible in:
- **Header bar:** Next to the project name, in a muted font: `Flightdeck (flightdeck-a3f7)`
- **Project list:** As a secondary label under the project name
- **API responses:** Always included in project objects
- **Agent context:** Agents see their `projectId` for log correlation and file path construction

### SDK Resume Analysis: Copilot, Claude, and Impact on Daemon Architecture

Both major CLI SDKs now support native session resume. This section analyzes the implications for the daemon design.

#### Copilot SDK Resume API

The GitHub Copilot SDK (`@github/copilot-sdk`) provides first-class session resume:

```typescript
// Create a resumable session (must specify sessionId)
const session = await client.createSession({
  model: "gpt-4",
  sessionId: "my-session-123",  // Required for later resume
});

// Resume later — restores conversation history, planning state, tool state from disk
const resumed = await client.resumeSession("my-session-123", {
  model: "gpt-4",  // Can change model on resume
});
```

Session state persists to `~/.copilot/session-state/{sessionId}/` on disk. Resume restores full conversation context, tool state, and planning artifacts. Available in Node.js, Python, Go, and .NET SDKs.

#### Claude SDK Resume API

The Anthropic Claude Agent SDK provides resume, continue, and fork:

```typescript
// Resume a specific session
const session = await unstable_v2_resumeSession("session-abc123");

// Fork a session (branch from existing conversation)
const forked = await unstable_v2_resumeSession("session-abc123", { forkSession: true });

// Continue latest session (implicit resume)
const continued = await query("Continue", { continue_conversation: true });
```

Claude's `fork` capability is unique — it creates a new session branching from an existing conversation, preserving history but allowing divergent exploration. This has interesting implications for agent workflows (e.g., "try approach A and approach B in parallel from the same analysis").

#### Existing Resume Plumbing in Flightdeck

**The codebase already supports `--resume`.** Key integration points:

- **AgentAcpBridge.ts (line ~53):** Conditionally adds `--resume <sessionId>` to CLI args when `agent.resumeSessionId` is set
- **AgentManager.spawn() (line ~270):** Accepts `resumeSessionId` parameter, passes to Agent constructor
- **Agent.start() (line ~152):** Detects resume mode, skips initial prompt when resuming
- **ProjectRegistry.ts:** Persists sessionIds to SQLite via `setSessionId()`, retrieves them via `getResumableSessions()`
- **Session ready callback:** Stores sessionId for lead agents in DB and for child agents in agent memory

**What's missing for full auto-resume:**
1. Persist sessionIds for ALL agents (not just leads) in SQLite
2. Auto-trigger resume on server restart (read persisted roster, spawn with `--resume`)
3. Progress UI during resume
4. Parallel resume (spawn all agents concurrently, not sequentially)

#### SDK Resume vs Daemon: Honest Comparison

| Metric | SDK Resume (Phase 1) | Daemon (Phase 2) |
|--------|---------------------|-------------------|
| Agent downtime | 1-15s (parallel resume, depends on crew size) | 0s |
| Context preservation | Full (restored from disk) | Full (never lost) |
| **In-flight turn** | **Lost** (current turn interrupted mid-execution) | **Preserved** (agent never notices restart) |
| Budget cost on restart | ~0 (resume token only) | 0 |
| Implementation complexity | Low (~100-200 lines, plumbing already exists) | High (~1000+ lines: daemon, protocol, transport, auth) |
| Cross-platform | Trivial (just CLI args) | Complex (UDS, named pipes, platform-specific signals) |
| Maintenance burden | Almost zero | Non-trivial (socket auth, reconnect protocol, event buffering, split-brain) |
| Failure modes | Simple (agent resumes or doesn't) | Complex (split-brain, orphaned agents, zombies, stale sockets) |
| Security surface | None (same process model) | Significant (UDS, token auth, TOCTOU prevention) |

#### The Key Question: What Does the Daemon Actually Protect?

With SDK resume available, the daemon's value reduces to **one thing: preserving in-flight turns**.

When a developer saves a file and `tsx watch` restarts the server:
- **Without daemon:** Agent mid-way through a 2-minute tool chain (writing 5 files, running tests, reviewing output) is interrupted. On resume, the agent has full context but must re-do the current turn's work. Cost: 1-3 minutes of wasted computation + budget.
- **With daemon:** Agent never notices the restart. The tool chain completes uninterrupted.

For an idle agent (between tasks, waiting for delegation), SDK resume is indistinguishable from daemon — both result in zero visible disruption.

**Frequency analysis:** How often does a developer save a file while an agent is mid-turn?
- 12-agent crew, average turn duration 45s, developer saves every 2 minutes
- Probability of interrupting at least one agent per save: ~67%
- Probability of interrupting the LEAD agent (highest impact): ~6%
- Expected wasted work per save: ~30s of one agent's computation

For small crews (1-3 agents), SDK resume is almost certainly sufficient. For large crews (10+), the cumulative interruption cost is significant.

#### Recommendation: Daemon-First with SDK Resume as Recovery

**The daemon is core infrastructure, not optional.** The primary use case — an AI crew developing Flightdeck itself — requires zero-disruption hot reload. A 5-15s blip on every code change means 12 agents interrupted, in-flight tool calls aborted, and ~30s of wasted computation per save. With agents saving files every 2 minutes, this is a continuous productivity drain.

SDK resume is essential but as the **fallback/recovery mechanism**, not the primary path:

1. **Phase 1 ships first as the foundation.** Resume plumbing exists in AgentAcpBridge, AgentManager, and ProjectRegistry. Remaining work: persist all agent sessionIds, auto-resume on startup, parallel resume, progress UI. Estimated: 3-4 hours. This gives immediate developer relief while Phase 2 is built.

2. **Phase 2 ships immediately after as the primary mechanism.** The daemon eliminates the blip entirely. Agents never notice server restarts. In-flight tool chains complete uninterrupted. This is the target experience for dogfooding.

3. **SDK resume becomes the daemon crash recovery path.** Daemon crashes → server falls back to Phase 1 auto-resume → agents restored with full context in 5-15s. This makes daemon crashes a brief inconvenience, not a catastrophe.

4. **Both phases are on the critical path.** Phase 1 alone is insufficient for the dogfooding workflow. Phase 2 alone has no crash recovery. Together they form a complete, resilient system.

#### What the Daemon-First Architecture Looks Like

**Primary path (daemon running — normal development):**
```
Developer saves file (or agent commits a code change)
    → tsx watch sends SIGTERM to server
    → gracefulShutdown() closes daemon socket FIRST
    → Server exits. Daemon keeps all 12 agents alive.
    → tsx watch spawns new server
    → Server connects to daemon socket, authenticates
    → Server calls daemon.list() → receives roster of 12 live agents
    → Server rebuilds in-memory state from SQLite (delegations, DAG, file locks)
    → Server subscribes to event streams for each agent
    → Daemon replays any buffered events from the disconnect window
    → UI shows brief "Reconnected" toast (green, auto-dismiss 3s)
    → Total elapsed: <2s. Zero agent disruption. In-flight work preserved.
```

**Fallback path (daemon crashed or not running):**
```
Developer saves file
    → tsx watch sends SIGTERM to server
    → gracefulShutdown() persists agent roster to SQLite:
        [{id, role, sessionId, task, status, parentId, model, cwd}, ...]
    → Server exits. All agents terminated (no daemon to keep them alive).
    → tsx watch spawns new server
    → Server attempts daemon connection → fails → falls back to direct ACP spawn
    → Server reads persisted roster from SQLite
    → For each agent: AgentManager.spawn(role, task, { resumeSessionId })
        → AgentAcpBridge adds --resume <sessionId> to CLI args
        → Agent process starts, loads session state from disk
    → UI shows "Resuming N agents..." with per-agent progress
    → Total elapsed: 5-15s for crew of 12. Full context preserved, in-flight turn lost.
```

### API Surface for Web Dashboard

The daemon is invisible to the web UI — the API server proxies all daemon operations. The UI talks to the server, never to the daemon directly.

**New endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/daemon/status` | GET | `{ running, pid, uptime, agentCount, mode: 'daemon'\|'direct', socketPath }` |
| `/api/daemon/stop` | POST | Graceful shutdown. `?force=true` for SIGKILL. |
| `/api/daemon/restart` | POST | Graceful restart (agents re-attached after new daemon starts) |

Existing endpoints work unchanged — `POST /api/agents` (spawn), `DELETE /api/agents/:id` (terminate), etc. — they proxy through the daemon when connected, fall back to direct spawn when not.

**New WebSocket events:**

| Event | Payload | When |
|-------|---------|------|
| `daemon:status` | `{ connected, mode: 'daemon'\|'direct' }` | Daemon connect/disconnect |
| `daemon:reconnecting` | `{}` | Server lost daemon, attempting reconnect |
| `daemon:fallback` | `{}` | Server fell back to direct ACP spawn |

**Key R9 alignment (@e7f14c5e):** The `AgentAdapter` interface from R9 (`packages/server/src/adapters/types.ts`) is exactly the abstraction boundary the daemon client needs. The migration path:

1. **Current:** `createAdapter()` returns `AcpAdapter` (direct spawn via child_process)
2. **With daemon:** `createAdapter()` returns `DaemonAdapter` (proxy via Unix socket JSON-RPC)
3. **Fallback:** If daemon unavailable, `createAdapter()` falls back to `AcpAdapter` silently

The adapter factory in `adapters/index.ts` already has a `type` parameter for this. `DaemonAdapter` serializes `AgentAdapter` method calls (start, prompt, terminate) to JSON-RPC and deserializes events back. Zero changes to AgentManager, AgentAcpBridge, CommandDispatcher, or any route files. The entire daemon integration is contained to: one new adapter class + factory logic + container wiring.

**This is the 10x architectural win — R9 pre-built the seam.**

### Future Considerations

Items identified during design review that are worth noting but not specced in detail:

- **Abstract Unix sockets (Linux):** Prefixed with `\0`, live in kernel memory, auto-cleanup on process exit. Avoids all filesystem race conditions. Linux-specific optimization — worth adding as an opt-in feature.
- **Mutual auth:** Daemon proves its identity to the server (not just server→daemon). Low risk since socket file permissions prevent daemon impersonation, but adds defense-in-depth.
- **Budget-based auto-kill:** Wire `BudgetEnforcer` to call daemon's `terminateAll()` when budget limit is hit (currently only logs a warning).
- **Max connections limit on daemon socket:** Not needed for single-client mode, but consider if multi-client is ever added.

---

## Cross-Platform Compatibility

The current design centers on Unix domain sockets, which don't exist on Windows. This section specifies cross-platform IPC, security, process management, and socket location strategies for all three target platforms.

### Design Principle: Platform-Native IPC with Unified Protocol

Node.js `net.createServer()` / `net.createConnection()` natively support **both** Unix domain sockets and Windows named pipes through the same API — only the path string format differs. This means the JSON-RPC protocol layer, authentication handshake, event buffering, and reconnect logic are 100% shared. Only the transport setup (path, permissions, cleanup) is platform-specific.

**No additional npm packages are needed.** The core `net` module handles everything. The `xpipe` package exists for path normalization but is unnecessary given our explicit platform detection.

### TransportAdapter Abstraction

```typescript
interface TransportAdapter {
  /** Platform-specific IPC path (socket path or pipe name) */
  getAddress(): string;
  /** Apply platform-specific security before listen() */
  secureBefore(): void;
  /** Apply platform-specific security after listen() */
  secureAfter(): Promise<void>;
  /** Check if a stale socket/pipe exists and clean up */
  cleanupStale(): Promise<'clean' | 'live-daemon' | 'error'>;
  /** Remove socket/pipe on shutdown */
  cleanup(): Promise<void>;
  /** Platform-specific process termination: graceful → forced */
  terminateProcess(pid: number): Promise<void>;
  /** Get platform-specific token file path */
  getTokenPath(): string;
  /** Get platform-specific PID file path */
  getPidPath(): string;
}
```

Three implementations: `LinuxTransport`, `DarwinTransport`, `WindowsTransport`. Selected at startup via `os.platform()`.

### Platform Matrix

| Concern | Linux | macOS | Windows |
|---------|-------|-------|---------|
| **IPC mechanism** | Unix domain socket | Unix domain socket | Named pipe |
| **Socket/pipe path** | `$XDG_RUNTIME_DIR/flightdeck/daemon.sock` | `$TMPDIR/flightdeck/daemon.sock` | `\\.\pipe\flightdeck-daemon-{username}` |
| **File permissions** | `umask(0o177)` before `listen()` | `umask(0o177)` before `listen()` | Named pipe default DACL + token auth |
| **Token file location** | `$XDG_RUNTIME_DIR/flightdeck/daemon.token` | `$TMPDIR/flightdeck/daemon.token` | `%LOCALAPPDATA%\flightdeck\daemon.token` |
| **Token file permissions** | `open(path, 'w', 0o600)` | `open(path, 'w', 0o600)` | NTFS ACL (owner-only) via `icacls` |
| **Stale detection** | `connect()` probe → ECONNREFUSED | `connect()` probe → ECONNREFUSED | `connect()` probe → ECONNREFUSED (pipe auto-cleans) |
| **Graceful terminate** | `SIGTERM` | `SIGTERM` | `stdin.end()` + protocol message |
| **Forced terminate** | `SIGKILL` (5s timeout) | `SIGKILL` (5s timeout) | `child.kill()` / `TerminateProcess` |
| **Process detach** | `setsid` (via `detached: true`) | `setsid` (via `detached: true`) | `CREATE_NEW_PROCESS_GROUP` (via `detached: true`) |
| **Emergency sentinel** | `~/.flightdeck/run/EMERGENCY_STOP` | `~/.flightdeck/run/EMERGENCY_STOP` | `%LOCALAPPDATA%\flightdeck\EMERGENCY_STOP` |
| **Auto-cleanup** | Manual `unlink()` on shutdown | Manual `unlink()` on shutdown | Automatic when last handle closes |

### Linux: Primary Target

Linux is the reference implementation. The design doc's existing sections (Unix domain socket, `$XDG_RUNTIME_DIR`, `umask`, `SIGTERM`/`SIGKILL`) apply directly.

**Socket location resolution:**
```
$XDG_RUNTIME_DIR/flightdeck/daemon.sock    (preferred, typically /run/user/$UID/)
~/.flightdeck/run/daemon.sock               (fallback if XDG_RUNTIME_DIR unset)
```

**Abstract sockets (future):** Linux supports abstract Unix sockets (prefixed with `\0`) that live in kernel memory and auto-cleanup on process exit. This eliminates all filesystem race conditions and stale socket issues. Deferred to a future optimization since it's Linux-specific.

### macOS: Close to Linux, Different Socket Location

macOS uses Unix domain sockets identically to Linux. The only difference is socket location — macOS does NOT set `$XDG_RUNTIME_DIR` by default.

**Socket location resolution:**
```
$TMPDIR/flightdeck/daemon.sock     (preferred, per-user, 0700, e.g. /var/folders/.../T/)
~/.flightdeck/run/daemon.sock      (fallback)
```

`$TMPDIR` on macOS points to a per-user temporary directory (e.g., `/var/folders/vd/53h736bj.../T/`) that is:
- Owned by the user with `0700` permissions (kernel-enforced)
- Cleared on reboot (acceptable — daemon doesn't survive reboots anyway)
- NOT in `/tmp` (which is world-writable and vulnerable to symlink attacks)

This provides equivalent security properties to Linux's `$XDG_RUNTIME_DIR`.

**macOS-specific note: TMPDIR and Time Machine.** `$TMPDIR` contents may be included in Time Machine backups. The daemon token file (256-bit secret) could be backed up. Mitigation: use `xattr -w com.apple.metadata:com_apple_backup_excludeItem com.apple.backupd` on the flightdeck directory, or place the token in a non-backed-up location. This is a low-severity concern since the token is per-session and ephemeral.

**launchd integration (future):** macOS's `launchd` could auto-start the daemon via a user-level `LaunchAgent` plist. This would start the daemon on login rather than on first `npm run dev`. Deferred — useful for production setups but unnecessary for development workflow.

### Windows: Named Pipes (Not Windows UDS)

**Decision: Use Windows named pipes, NOT Windows AF_UNIX sockets.**

Windows 10 1803+ added AF_UNIX support, but it has significant limitations:
- Only `SOCK_STREAM` supported (no `SOCK_DGRAM`, `SOCK_SEQPACKET`)
- No file descriptor passing
- No `socketpair` API
- Less mature, community reports of edge cases and reliability issues
- Not available on older Windows 10 builds

Windows named pipes are the native IPC mechanism — stable, well-tested, and natively supported by Node.js `net` module:

```typescript
// Windows named pipe path
const pipeName = `\\\\.\\pipe\\flightdeck-daemon-${os.userInfo().username}`;

// Same API as Unix domain sockets:
const server = net.createServer(handler);
server.listen(pipeName);

const client = net.createConnection(pipeName);
```

**Key behavioral differences from Unix domain sockets:**
- **Auto-cleanup:** Named pipes are automatically removed when the last handle closes. No stale pipe cleanup needed (unlike Unix sockets which leave orphaned files).
- **No filesystem path:** Named pipes live in the kernel's pipe namespace (`\\.\pipe\`), not the filesystem. No symlink attacks, no directory permission issues.
- **Discovery:** Anyone can enumerate pipe names via `\\.\pipe\` listing. Security relies on authentication (token), not obscurity.

#### Windows Security Model

Windows named pipes use ACLs (Access Control Lists) instead of Unix file permissions. **Node.js ignores the `mode` parameter on Windows** — you cannot set `0600` equivalent via core Node.js APIs.

**Security strategy for Windows (defense in depth):**

1. **Token authentication (primary):** Same per-session 256-bit token as Unix. The token file is stored in `%LOCALAPPDATA%\flightdeck\daemon.token` with restricted NTFS ACL. Token is required for all daemon operations. This is the primary security boundary on Windows.

2. **Directory DACL restriction (before pipe creation):** Mirror the Unix `umask` pattern — restrict the token directory's DACL before creating any files or pipes inside it. This prevents TOCTOU races where another process accesses files between creation and ACL application:
   ```typescript
   // Restrict directory FIRST (equivalent to umask(0o177) + mkdir(0o700) on Unix):
   import { execFileSync } from 'child_process';
   const tokenDir = path.join(process.env.LOCALAPPDATA!, 'flightdeck');
   fs.mkdirSync(tokenDir, { recursive: true });
   execFileSync('icacls', [tokenDir, '/inheritance:r', '/grant:r', `${os.userInfo().username}:(OI)(CI)F`]);
   // Now all files created inside tokenDir inherit the restricted DACL
   ```

3. **Token file ACL:** On daemon startup, restrict the token file to owner-only access:
   ```typescript
   // Use execFileSync with array args — NOT execSync with string interpolation
   // (prevents shell injection if tokenPath contains special characters):
   import { execFileSync } from 'child_process';
   execFileSync('icacls', [tokenPath, '/inheritance:r', '/grant:r', `${os.userInfo().username}:R`]);
   ```
   This is the Windows equivalent of `chmod 0600`. It removes inherited permissions and grants read-only to the current user. **Note:** `execFileSync` with array arguments bypasses the shell entirely, preventing injection via crafted file paths.

4. **Pipe name includes username:** `\\.\pipe\flightdeck-daemon-{username}` — prevents accidental cross-user collisions. Not a security boundary (pipe names are globally visible), but reduces attack surface.

5. **Named pipe ACL (optional hardening):** For full 0600 equivalence, the pipe itself needs a restricted ACL. This requires native code (`CreateNamedPipe` with custom `SECURITY_ATTRIBUTES`). Deferred to Phase 2 hardening — token auth is sufficient for development use.

**Threat comparison — Windows vs Unix:**

> **⚠️ Windows security is strictly weaker than Unix.** On Unix, the socket file's `0600` permissions prevent unauthorized users from even attempting a connection — the kernel rejects `connect()` before our code runs. On Windows, any local user can enumerate pipe names (via `\\.\pipe\` listing) and attempt a connection. **Token authentication is the sole barrier** preventing unauthorized access on Windows. This is acceptable for a development tool but should be documented clearly for users running in shared/multi-user environments.

| Threat | Unix Mitigation | Windows Mitigation |
|--------|----------------|-------------------|
| Unauthorized connection | Socket file perms (0600) + token | **Token auth only** (pipe has no ACL by default) |
| Pipe/socket discovery | Socket path not enumerable | ⚠️ Pipe names globally enumerable via `\\.\pipe\` |
| Token file theft | File perms (0600) + `fdatasync` | NTFS directory DACL + `icacls` on file |
| Eavesdropping | Socket is local-only (kernel) | Pipe is local-only (kernel) |
| Impersonation | Socket directory perms (0700) | Token `timingSafeEqual` |
| Stale socket/pipe | `connect()` probe + `unlink()` | Auto-cleanup (pipes vanish when daemon dies) |

#### Windows Process Management

Windows lacks Unix signals entirely. The zombie escalation pattern maps differently:

**Unix escalation (existing design):**
```
SIGTERM → wait 5s → SIGKILL → wait 2s → force remove from roster
```

**Windows escalation:**
```
stdin.end() + 'shutdown' message → wait 5s → child.kill() (TerminateProcess) → remove from roster
```

Key differences:
- **Graceful shutdown:** On Unix, `SIGTERM` lets the process handle cleanup. On Windows, `child.kill('SIGTERM')` is actually an immediate `TerminateProcess` with no cleanup. Instead, send a `shutdown` message over the agent's stdin pipe and close stdin. The Copilot CLI process should handle stdin close as a shutdown signal.
- **Forced shutdown:** `child.kill()` on Windows calls `TerminateProcess` — always immediate, no SIGKILL equivalent needed (it's already a hard kill).
- **No zombie processes:** Windows doesn't have the Unix zombie state (Z). `TerminateProcess` always succeeds. The 2s zombie timeout in the Unix design is unnecessary on Windows.

**Process detachment:** Node.js `spawn({ detached: true })` maps to `CREATE_NEW_PROCESS_GROUP` + `DETACHED_PROCESS` flags on Windows. Combined with `stdio: 'ignore'` and `child.unref()`, this achieves the same daemon-outlives-server behavior as Unix `setsid`.

#### Windows Emergency Kill

The emergency kill switch adapts to Windows:

| Level | Unix | Windows |
|-------|------|---------|
| CLI | `flightdeck daemon stop --force` | Same (cross-platform Node.js CLI) |
| Signal | `kill -9 <daemon-pid>` | `taskkill /PID <pid> /F` |
| Sentinel | `touch ~/.flightdeck/run/EMERGENCY_STOP` | `echo. > %LOCALAPPDATA%\flightdeck\EMERGENCY_STOP` |

The sentinel file approach works identically on Windows — `fs.watchFile()` is cross-platform.

### Implementation: Platform Detection

```typescript
import { platform } from 'os';

function createTransport(): TransportAdapter {
  switch (platform()) {
    case 'linux':
      return new LinuxTransport();
    case 'darwin':
      return new DarwinTransport();
    case 'win32':
      return new WindowsTransport();
    default:
      // Unsupported platform — fall back to TCP localhost + token
      return new TcpFallbackTransport();
  }
}
```

**TCP fallback:** For unsupported platforms (FreeBSD, etc.), fall back to `127.0.0.1` with a random high port + token auth. This provides the daemon functionality without platform-specific IPC. The token is the only security boundary (no filesystem permission enforcement). This is acceptable for development use.

### Cross-Platform Testing Strategy

| Test | Linux | macOS | Windows |
|------|-------|-------|---------|
| Socket/pipe creation | ✅ UDS | ✅ UDS | ✅ Named pipe |
| Permission enforcement | ✅ `stat()` + `umask` | ✅ `stat()` + `umask` | ✅ `icacls` verification |
| Stale cleanup | ✅ `connect()` probe + `unlink()` | ✅ `connect()` probe + `unlink()` | ✅ Auto-cleanup (verify pipe gone) |
| Process terminate (graceful) | ✅ SIGTERM | ✅ SIGTERM | ✅ stdin close + message |
| Process terminate (forced) | ✅ SIGKILL | ✅ SIGKILL | ✅ `child.kill()` |
| Daemon survives server restart | ✅ `setsid` | ✅ `setsid` | ✅ `CREATE_NEW_PROCESS_GROUP` |
| Emergency sentinel | ✅ `fs.watchFile` | ✅ `fs.watchFile` | ✅ `fs.watchFile` |
| Token auth | ✅ `timingSafeEqual` | ✅ `timingSafeEqual` | ✅ `timingSafeEqual` |

CI should run daemon integration tests on all three platforms. The `TransportAdapter` abstraction makes this straightforward — same test suite, different transport.

### What Stays the Same Across All Platforms

The cross-platform abstraction is thin — most of the daemon design is platform-independent:

- ✅ JSON-RPC protocol (100% shared)
- ✅ Authentication handshake (token generation, `timingSafeEqual`)
- ✅ Event buffering and replay (100% shared)
- ✅ Single-client enforcement (100% shared)
- ✅ Auto-shutdown timer (100% shared)
- ✅ `DaemonAdapter` implementing `AgentAdapter` interface (100% shared)
- ✅ Reconnect protocol with `lastSeenEventId` (100% shared)
- ✅ Structured pino logging (100% shared)
- ✅ All UI/UX flows (100% shared)

**Only the following are platform-specific:**
- IPC path format and location (~20 lines per platform)
- File permission enforcement (~10 lines per platform)
- Process termination escalation (~15 lines per platform)
- Stale socket cleanup (~10 lines per platform)

Total platform-specific code: ~55 lines per platform, out of an estimated ~300-line daemon. The `TransportAdapter` keeps the platform seam minimal and testable.

---

## User Experience Design

*Based on product analysis by @a6fa6770, with architectural validation by @e7f14c5e and @bb14c13b.*

### Core UX Principle: Progressive Disclosure

The daemon follows a **progressive disclosure** pattern — invisible by default, revealed incrementally as the user needs more control:

| Level | Context | What the user sees |
|-------|---------|-------------------|
| **Level 0** | Everything works | Green dot in header. Nothing else. |
| **Level 1** | Something goes wrong | Toast/banner explaining the issue and what to do |
| **Level 2** | User investigates | Mission Control → full System Health panel with controls |
| **Level 3** | Advanced ops | CLI: `flightdeck daemon status/stop/restart` |

The daemon is infrastructure. Users should NEVER have to think about it during normal operation. It should be like electricity — you only notice when it stops working.

- ❌ No dedicated `/daemon` page in the nav. That's operator-level UI, not user-level.
- ✅ A tiny status indicator in the header bar (next to the existing session dot). Green dot = healthy. That's it.
- ✅ Daemon controls live in **Mission Control** page, not a top-level route.
- ✅ Only surface daemon status prominently when something goes WRONG.

### Three Tiers of User Control

**Tier 1: Normal operation (99% of the time)**
- Users see agents running, send them tasks, watch output. Zero daemon awareness.
- The daemon auto-starts with `npm run dev`. No manual step.
- If the server restarts (code change), the UI shows a brief "Reconnecting..." state that resolves in <2s. The agent list stays populated.

**Tier 2: Something's off (occasional)**
- An agent is stuck/unresponsive. User needs per-agent controls:
  - **Kill agent** — Stop button on agent card. Inline confirmation (NOT a modal — modals are disruptive): card expands slightly to show `"Kill agent? Currently working on: [task summary]"` with [Cancel] [Kill] buttons. If the agent is mid-tool-call (writing files), show warning: `"⚠️ Agent is mid-file-write. Killing may leave partial changes. [Kill Anyway] [Wait for Turn]"`.
  - **Respawn after kill** — After killing an agent, a "Respawn" button appears on the card. Same role, same task, uses `--resume` if available.
  - **Restart agent** — Kill + re-spawn with same config. This is what users ACTUALLY want when they say "restart."
  - **View agent health** — Last heartbeat time, context window usage %, memory. These belong on the agent detail panel, not a daemon page.

**Tier 3: Emergency / everything is broken (rare)**
- The daemon is unresponsive or agents are going rogue.
- **Emergency Kill Switch in UI:** Big red button in Mission Control (System Health section): "🛑 Kill All Agents". Two-click confirmation: click → "Are you sure? This will terminate all 12 agents immediately" → confirm. Confirmation dialog auto-dismisses after **10 seconds** to prevent blocking other interactions (toast: "Emergency stop cancelled (timeout). Use Mission Control to try again.").
- **Keyboard shortcut:** `Cmd+Shift+K` for Kill All — discoverable via Command Palette (`Cmd+K`). Fast for power users, invisible for beginners.
- **CLI fallback:** `flightdeck daemon stop --force` (covered in Emergency Kill Switch section above).
- **Kill file sentinel:** `touch ~/.flightdeck/run/EMERGENCY_STOP` — documented in a help tooltip next to the emergency button.

### UI Specifications

#### Header Status Indicator

```
[Logo] [Pause/Resume] [Approvals(3)] [Cmd+K] [●] [Daemon: ●]
                                                ↑ existing  ↑ new
```

The daemon status dot appears next to the existing session indicator with **three states**:
- **Green (●)** — Daemon connected, all agents healthy (default state during development)
- **Amber (●)** — Reconnecting or degraded (agents resuming, stale heartbeat, brief disconnect)
- **Red (●)** — Daemon unavailable. Server is running in fallback mode (direct ACP spawn + SDK resume). This means agents will restart on code changes instead of surviving them.

Tooltip on hover: `"Agent Host: Running (12 agents, uptime 2h 15m)"` (green), `"Agent Host: Reconnecting..."` (amber), `"Agent Host: Unavailable (fallback mode)"` (red).

**Toast notifications on state changes:**
- **Daemon disconnected:** Amber toast (does NOT auto-dismiss — stays until resolved)
- **Reconnected:** Green toast (auto-dismiss 3s)
- **Fallback mode:** Warning toast: `"⚠️ Daemon unavailable — agents will restart on code changes. Run 'flightdeck daemon start' to fix."`

#### Mission Control — System Health Panel

```
┌─ System Health ──────────────────────────────────────┐
│ Agent Host Daemon    ● Running    Uptime: 2h 15m     │
│ Active Agents: 12    Memory: 340MB   PID: 48291      │
│                                                       │
│ [Restart Daemon]  [🛑 Emergency Stop All]             │
│                                                       │
│ Last 5 events:                                        │
│  14:52 Agent cc29bb0d spawned (Architect)             │
│  14:48 Server reconnected (code change)               │
│  14:48 Server disconnected (code change)              │
│  14:31 Agent f9a74593 terminated (completed)          │
│  14:15 Daemon started                                 │
└───────────────────────────────────────────────────────┘
```

This panel lives in Mission Control or Settings, NOT as a top-level route.

#### Agent Card — Resume State

During Phase 1 auto-resume or daemon reconnection, agent cards show progress:

```
┌─ Agent cc29bb0d ─────────────────────────────────────┐
│ 🏗️ Architect                        [🔄 Resuming...] │
│ Task: Security model for daemon...                    │
│ ████████░░░░ Rebuilding context (65%)                 │
│                              [Cancel Resume] [Kill]   │
└───────────────────────────────────────────────────────┘
```

- Progress bar shows context rebuild progress (Phase 1) or event replay progress (Phase 2)
- "Cancel Resume" lets users abandon individual agent resume and start fresh
- With SDK `--resume`, the progress bar completes in 1-2s per agent instead of 5-15s

### Error State UX Flows

Each error state defines what the user SEES and what they need to DO:

#### State: Server Restarted (code change during dev)

```
UI shows:   Brief flash → "Reconnected" toast (green, auto-dismiss 3s)
Agents:     All still running, no status change visible
User action: None needed
```

*This is the MAGIC moment. The user makes a code change and their agents just keep working. That's the whole point of the daemon.*

#### State: Daemon Disconnected

```
UI shows:   Header dot → amber. Banner: "⚠️ Agent host disconnected. 
            Agents may still be running. [Reconnect] [Restart Daemon]"
Agents:     Show last known state with "stale" indicator (dimmed, with timestamp)
User action: Click Reconnect (auto-attempted every 5s) or Restart Daemon
```

**Reconnect escalation:** Auto-reconnect attempts every 5s. After 3 failed attempts, the banner upgrades to include a [Restart Daemon] button. The attempt counter is visible: "Reconnecting (attempt 3/5)..."

**Critical (@bb14c13b):** Don't show agents as "terminated" just because we lost contact. They might still be running in the daemon. Show uncertainty honestly. The current codebase marks agents as 'terminated' when ACP connection drops (Agent.ts line ~535); with daemon mode, lost SERVER→DAEMON connection ≠ agent death.

**Backend prerequisite:** See Agent Status Model section below — lifecycle state + connection overlay.

#### State: Daemon Crashed, Agents Lost

```
UI shows:   Banner at top of page (NOT toast — too important to miss):
            "⚠️ Agent host crashed. Resuming 12 agents..." 
            with per-agent progress (N/12 resumed).
Agents:     Cards show "Resuming..." state (amber, spinner) one by one.
            Each card: spinner → green checkmark when back.
User action: Watch and wait. Offer "Cancel resume" to start fresh.
            Banner auto-dismisses when ALL agents are back.
```

With 10-20 agents, resume takes 30-60s (or 10-20s with SDK `--resume`). Users need to see progress, not a blank screen.

#### State: Agent Went Rogue (runaway writes, budget burn)

```
UI shows:   Agent card highlights RED with alert icon.
            Toast: "⚠️ Agent X triggered safety alert: [reason]"
Agent detail: Shows what triggered the alert (file writes/s, API cost rate, etc.)
User action: "Kill Agent" button. If multiple agents rogue: "Kill All" in Mission Control.
```

**Open question: Per-agent resource telemetry.** The daemon does NOT need to track per-agent resource usage itself. The server already has the data: `AcpAdapter` emits `tool_call` events (file writes, bash commands), `BudgetEnforcer` tracks cost, and `ActivityLedger` records all actions. Rogue detection logic should live in the server, not the daemon. The daemon just needs to reliably deliver the kill command. Keeping the daemon dumb is a feature (@e7f14c5e).

**UX detail:** The agent card alert should show WHY the agent was flagged: `"⚠️ High file write rate (47 writes/min)"` not just `"⚠️ Alert"`. The `reason` field from `BudgetEnforcer` / `ActivityLedger` is surfaced directly.

#### State: Daemon Auto-Shutdown

```
UI shows:   Toast: "Agent host shut down (no active session for 5 min). 
            Agents preserved in database."
Agents:     Cards removed or dimmed with "Session ended" state
User action: Next session start → daemon auto-starts again
```

#### State: Fallback Mode (daemon failed to start)

```
UI shows:   Warning toast: "⚠️ Daemon unavailable — agents will restart 
            on code changes. Run 'flightdeck daemon start' to fix."
Header dot: Red (daemon should always be running in dev mode)
User action: Check daemon logs, restart daemon. Agents continue via SDK resume in the meantime.
```

### Agent Status Model

The agent status model separates **lifecycle state** from **connection overlay**. This is a backend requirement, not just UI:

```typescript
// Lifecycle state — what the agent IS doing
type AgentLifecycleState = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated';

// Connection overlay — what we KNOW about the agent's connection
type ConnectionOverlay = 
  | { state: 'connected' }
  | { state: 'stale', lastSeen: Date, reason: 'server-reconnecting' | 'daemon-unresponsive' | 'heartbeat-missed' }
  | { state: 'unknown', reason: 'daemon-lost' };
```

An agent can be `running + stale` (we think it's running but haven't heard from the daemon in 30s). The UI renders this as: normal agent card but slightly dimmed, with a small clock icon and "30s ago" timestamp. Same visual treatment regardless of `reason`, but the **tooltip differs**: "Server reconnecting" = calm, "Daemon unresponsive" = concern.

#### Staleness Thresholds (agent-activity-aware)

An idle agent with `lastSeen: 3 minutes ago` is completely normal, while a streaming agent going silent for 10s is alarming. Staleness thresholds adapt to agent activity (@bb14c13b):

| Agent Activity | Stale After | Rationale |
|---------------|-------------|-----------|
| Running + streaming text/tool_calls | 10s silence | Active output expected continuously |
| Running + waiting for tool approval | 60s silence | Approvals can take a while (human in loop) |
| Idle (between tasks) | 120s silence | Normal for agents waiting for work |
| Any state + daemon heartbeat missed | Immediately | Daemon heartbeat is the ground truth signal |

The UI only shows the stale indicator when silence exceeds the threshold for that agent's current activity. This prevents false alarms on idle agents while catching genuine problems on active ones.

#### Stale State Escalation Ladder

When daemon connection is lost, the header dot and UI escalate over time:

| Time Since Disconnect | Header Dot | UI Treatment |
|----------------------|------------|--------------|
| 0-10s | Amber | "Reconnecting..." — normal tsx watch restart |
| 10-30s | Amber | "Still reconnecting..." — slightly more urgent |
| 30-60s | Orange pulse | "Connection delayed" — subtle pulse animation |
| 60s+ | Red | "Likely down" — action buttons: [Check Daemon] [Restart Daemon] |

The 60s threshold aligns with infrastructure reality: auto-resume < 30s, heartbeat timeout = 30s. Past 60s, something is genuinely broken. This prevents the stale state from becoming a lie of omission — users get honest uncertainty for the common case (brief reconnect) and clear escalation for the rare case (daemon crash).

### SDK `--resume` Role in Architecture

SDK resume is the **fallback and recovery mechanism**, not the primary experience:

1. **Daemon crash recovery:** Daemon dies → server detects socket EOF → falls back to SDK resume → agents restored with full context in 5-15s. Makes daemon crashes a brief inconvenience, not catastrophic.

2. **First-time setup:** Before the daemon is built (Phase 1 only), SDK resume provides the auto-resume experience. This is the foundation that Phase 2 builds on.

3. **Edge cases:** Daemon fails to start, permissions issue, unsupported platform → server falls back to direct spawn + SDK resume transparently.

4. **Security framing (@bb14c13b, @a6fa6770):** The fallback path (direct ACP spawn) is the current security model — agents are child processes of the server. The daemon ADDS process isolation as a security bonus (UDS + token + umask). Frame as: "daemon adds defense-in-depth."

#### Phase 1 Foundation Priorities

Phase 1 ships first as the foundation and recovery path. Invest in polish since it's the fallback experience (@e7f14c5e, @a6fa6770):

1. **Progress UI for resume** — per-agent status updates, not a single spinner
2. **"Cancel resume" button** — let users start fresh instead of resuming
3. **Message queue persistence** — inter-agent messages in SQLite survive the restart
4. **Parallel resume** — resume agents concurrently, not sequentially (10-20s vs 60-120s for 12 agents)

### Quality Bar — Acceptance Criteria

#### Phase 2 is the PRIMARY quality bar — the dogfooding scenario:

- [ ] A 12-agent crew is actively modifying Flightdeck source. An agent saves a file. `tsx watch` restarts the server. All 12 agents continue working without interruption. In-flight tool calls complete. No work is lost.
- [ ] `npm run dev` just works — daemon auto-starts, no separate command, no config flag needed
- [ ] Server can be restarted 10 times in a row with no agent loss or state corruption
- [ ] Daemon crash → automatic recovery via Phase 1 SDK resume → user sees brief "Resuming" then normal
- [ ] Emergency stop works via UI button, CLI, and sentinel file
- [ ] Two developers can't accidentally collide (one daemon per user, socket permissions enforce isolation)
- [ ] Server restart during an active agent prompt (mid-turn) results in no lost output — buffered events are replayed on reconnect (@e7f14c5e)
- [ ] Works on macOS and Linux, degrades gracefully on other platforms

#### Phase 1 is the FOUNDATION quality bar — the fallback path:

- [ ] User makes a code change without daemon → agents resume automatically → no manual intervention
- [ ] UI shows "Resuming N agents..." banner with per-agent progress
- [ ] All agents come back within 30s (for a 12-agent crew)
- [ ] In-flight inter-agent messages in SQLite survive the restart (DAG state, file locks)
- [ ] User can cancel the auto-resume if they want a fresh start
- [ ] Works on macOS and Linux

---

## Decision Matrix

| Criterion | Daemon (1) | HMR (2) | Resume (3) | Worker (4) | FIFO (5) | Hybrid (6) |
|-----------|:-:|:-:|:-:|:-:|:-:|:-:|
| Agent survival | ✅ Full | ⚠️ Partial | ❌ Restart | ✅ Full | ✅ Full | ⚠️→✅ |
| Implementation effort | 🔴 High | 🟡 Med | 🟢 Low | 🔴 High | 🟡 Med | 🟢→🔴 |
| Maintenance burden | 🟢 Low | 🔴 High | 🟢 Low | 🟡 Med | 🟡 Med | 🟢 Low |
| Risk of subtle bugs | 🟢 Low | 🔴 High | 🟢 Low | 🟡 Med | 🟡 Med | 🟢 Low |
| Ships quickly | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ (Phase 1) |
| Correct long-term | ✅ | ❌ | ❌ | ⚠️ | ⚠️ | ✅ (Phase 2) |

---

## Cross-Project Insights

- **Symphony (Elixir/OTP):** OTP supervision trees provide exactly the daemon pattern. `Task.Supervisor` manages agent worker processes independently of the `Orchestrator` GenServer. If the Orchestrator crashes, the supervisor restarts it while agents continue. Flightdeck's daemon would serve the same role as `Task.Supervisor`.

- **Edict:** Separate Orchestrator and Dispatch worker processes communicating via Redis Streams. If the orchestrator crashes, unacknowledged events are preserved in Redis for recovery. Flightdeck's SQLite persistence serves the same recovery role.

- **Key insight:** Every system that handles agent process management well separates the "agent lifecycle" concern from the "business logic" concern into different processes. Symphony does it with OTP, Edict with worker processes. Flightdeck currently conflates both in a single Node.js process.

---

## Architectural Assessment: Daemon vs Process Isolation

*Added in response to the question: "Is the full daemon over-engineered? Could simple process isolation achieve the same goal?"*

This is an honest assessment of what we built, what's essential, and whether a simpler architecture would suffice.

### What We Built

| Module | LOC | Tests | Purpose |
|--------|-----|-------|---------|
| DaemonProcess.ts | 1,034 | 73 | Core daemon: socket server, auth, agent management, lifecycle |
| platform.ts | 600 | 30 | Cross-platform IPC (Linux/macOS/Windows/TCP fallback) |
| DaemonAdapter.ts | 540 | 50 | AgentAdapter bridge: proxies spawn/prompt/terminate via daemon |
| ReconnectProtocol.ts | 449 | 35 | Auto-reconnect, event ID tracking, agent reconciliation |
| DaemonClient.ts | 423 | — | Server-side client: connect, auth, heartbeat, RPC dispatch |
| DaemonProtocol.ts | 266 | — | JSON-RPC 2.0 type definitions |
| MassFailureDetector.ts | 252 | 42 | Sliding window failure detection, cause heuristics |
| EventBuffer.ts | 169 | — | Buffer events during server disconnect |
| **Total** | **3,726** | **230** | |

### The Process Isolation Alternative

**Core insight:** The daemon is solving one problem — agents must survive server restarts. The simplest way to achieve this is to run agents in a separate process that doesn't restart when the server does.

```
Current (no daemon):
  tsx watch → Server → Agent subprocesses
  Server dies → ALL children die

Full daemon:
  tsx watch → Server ←→ [UDS/pipe] ←→ Daemon → Agent subprocesses
  Server dies → Daemon + agents survive

Process isolation (proposed):
  tsx watch → Orchestrator ←→ [IPC] ←→ AgentHost → Agent subprocesses
  Orchestrator dies → AgentHost + agents survive
```

**Concrete implementation:** `child_process.fork()` with a separate entry point.

```typescript
// scripts/dev.mjs — modified
const agentHost = fork('./packages/server/src/agent-host.ts', {
  detached: true,    // Survives parent exit
  stdio: 'pipe',     // IPC channel auto-created by fork()
});
agentHost.unref();   // Don't keep parent alive

// agent-host.ts — ~200 lines
// Owns: AgentManager, AcpAdapter subprocesses, agent lifecycle
// Exposes: spawn, terminate, prompt, list, subscribe via IPC messages
// Does NOT own: Express, WebSocket, DAG, UI, governance, knowledge

// Orchestrator (server) talks to AgentHost via Node IPC (process.send/on)
```

**Why this is simpler:**
- Node's built-in IPC (`fork()` + `process.send()`) replaces: UDS socket, NDJSON parsing, JSON-RPC protocol, auth handshake, platform abstraction
- `detached: true` replaces: the entire daemon lifecycle management, `dev.mjs` integration, auto-start/stop
- Parent-child IPC is OS-handled — no socket paths, no stale socket cleanup, no platform differences
- No auth needed — IPC channel is private between parent and child (kernel-enforced)

### Feature-by-Feature Analysis

| Feature | Full Daemon | Process Isolation | Verdict |
|---------|-------------|-------------------|---------|
| **Agent survival on restart** | ✅ UDS socket + orphaned mode | ✅ `detached: true` + Node IPC | **Both work.** Fork is simpler. |
| **Event buffering** | ✅ EventBuffer (169 LOC) | ✅ Same logic, smaller (IPC auto-buffers) | **Keep.** Essential for gapless replay. |
| **Reconnect + reconciliation** | ✅ ReconnectProtocol (449 LOC) | ✅ Simpler — just `fork()` reconnect | **Keep concept, simplify.** No exponential backoff needed (IPC is local). |
| **Mass failure detection** | ✅ MassFailureDetector (252 LOC) | ✅ Same — lives in AgentHost | **Keep as-is.** Independent of transport. |
| **UDS authentication** | ✅ Token + timingSafeEqual (200+ LOC) | ❌ Unnecessary — fork() IPC is private | **Drop.** Kernel-enforced isolation. |
| **Cross-platform transport** | ✅ platform.ts (600 LOC) | ❌ Unnecessary — fork() IPC is cross-platform | **Drop.** Node handles it. |
| **Named pipes (Windows)** | ✅ WindowsTransport | ❌ Unnecessary — fork() works on Windows | **Drop.** |
| **Stale socket cleanup** | ✅ Probe + clean (100+ LOC) | ❌ Unnecessary — no socket files | **Drop.** |
| **Socket dir permissions** | ✅ umask, chmod, icacls | ❌ Unnecessary — no filesystem artifacts | **Drop.** |
| **Single-client enforcement** | ✅ Reject second connection | ❌ Unnecessary — parent-child is 1:1 | **Drop.** |
| **Orphan detection + 12h timeout** | ✅ Timer + status file | ⚠️ Simpler — process.ppid check + SIGTERM | **Simplify.** Detached process checks if parent alive. |
| **NDJSON protocol** | ✅ 266 LOC types + parsing | ❌ Unnecessary — `process.send()` is structured | **Drop.** Node serializes/deserializes automatically. |
| **Daemon CLI commands** | ✅ `flightdeck daemon stop/status` | ⚠️ Simpler — `flightdeck agent-host stop/status` | **Keep concept, less plumbing.** |

### What We'd Drop (~1,800 LOC)

| Component | LOC | Why Unnecessary |
|-----------|-----|-----------------|
| platform.ts (entire file) | 600 | fork() IPC is cross-platform natively |
| DaemonProcess.ts socket/auth sections | 400 | fork() IPC replaces UDS + token auth |
| DaemonProtocol.ts | 266 | process.send() replaces JSON-RPC + NDJSON |
| DaemonClient.ts connection/auth | 200 | Built-in IPC channel replaces socket management |
| Stale socket cleanup | 100 | No socket files to clean up |
| Single-client enforcement | 80 | Parent-child is inherently 1:1 |
| Token file management | 80 | No auth needed |
| **Total dropped** | **~1,800** | **48% of daemon codebase** |

### What We'd Keep (~1,900 LOC)

| Component | LOC | Why Essential |
|-----------|-----|---------------|
| Agent lifecycle management | 400 | Core: spawn, terminate, status tracking |
| EventBuffer.ts | 169 | Gapless event replay on reconnect |
| MassFailureDetector.ts | 252 | Systemic failure detection + pause |
| ReconnectProtocol.ts (simplified) | 250 | Reconciliation logic (not transport) |
| DaemonAdapter.ts (simplified) | 350 | AgentAdapter bridge (reuse interface) |
| Agent host entry point | 200 | New: standalone process with IPC |
| Orphan self-termination | 50 | Simplified: ppid check + timeout |
| Lifecycle modes (prod/dev) | 100 | Keep: shutdown vs persist distinction |
| **Total kept** | **~1,800** | **Reused or simplified** |

### What We'd Lose

Process isolation via `fork()` has real tradeoffs:

1. **No independent daemon lifecycle.** The agent host is forked from `dev.mjs`, not independently started. You can't start it separately, can't connect from a different terminal, can't run `flightdeck daemon status` against it as a standalone service. For our dogfooding use case, this is fine — it's always started by the dev script.

2. **No TCP fallback.** The daemon design includes a TCP transport for remote debugging / cloud deployment. Fork IPC is local-only. For a local dev tool, this doesn't matter.

3. **No multi-server connection.** The daemon can theoretically accept connections from multiple server instances (we chose single-client, but the architecture supports it). Fork IPC is strictly 1:1. Again, not needed for our use case.

4. **Less defense-in-depth.** UDS + token auth means even if someone gets local access, they can't hijack agents. Fork IPC relies solely on OS process isolation. For a dev tool running on the developer's own machine, this is adequate.

### Honest Assessment: Did We Over-Engineer?

**Yes, partially.** Here's the breakdown:

| Category | Verdict | Reasoning |
|----------|---------|-----------|
| **Security model** (UDS + token + umask + icacls) | Over-engineered | Fork IPC provides kernel-enforced isolation for free. We designed enterprise-grade auth for a local dev tool. |
| **Cross-platform transport** (4 adapters) | Over-engineered | `child_process.fork()` works identically on Linux, macOS, and Windows. 600 LOC for something Node does natively. |
| **JSON-RPC + NDJSON protocol** | Over-engineered | `process.send()` handles serialization. We built a wire protocol we didn't need. |
| **Event buffering** | Correctly engineered | Essential regardless of transport. Gapless replay is the core value proposition. |
| **Mass failure detection** | Correctly engineered | Transport-independent. Valuable at any scale. |
| **Reconnect + reconciliation** | Correctly engineered (transport overkill) | The reconciliation logic is essential; the exponential backoff over UDS is overkill for local IPC. |
| **Lifecycle modes** (prod/dev) | Correctly engineered | Real user need. Ctrl+C should kill everything in prod, preserve in dev. |
| **12h orphan timeout** | Correctly engineered | Safety net against forgotten processes. |

**The ~1,800 LOC we'd drop (48%) is genuine over-engineering.** It solves problems that `fork()` eliminates at the OS level. The remaining ~1,800 LOC is real value — event buffering, failure detection, reconciliation, and lifecycle management.

### Recommendation

**Refactor to process isolation.** The migration is straightforward because the architecture is already modular:

1. **Create `agent-host.ts`** (~200 LOC) — new entry point that owns AgentManager + adapters
2. **Replace DaemonClient with IPC wrapper** (~100 LOC) — `process.send()` / `process.on('message')`
3. **Simplify DaemonAdapter** — remove socket connection logic, keep event mapping
4. **Delete:** platform.ts, DaemonProtocol.ts, socket/auth sections of DaemonProcess.ts
5. **Keep unchanged:** EventBuffer, MassFailureDetector, lifecycle modes, reconnect reconciliation logic

**Migration effort:** ~1-2 days for a developer familiar with the codebase. Most of it is deleting code and replacing the transport layer in DaemonProcess → AgentHost.

**The existing daemon code isn't wasted.** The design thinking (event buffering, reconciliation, mass failure, lifecycle modes) is all correct and reusable. We just chose a transport layer that's 10x more complex than needed. The 230 tests for MassFailureDetector, EventBuffer, and reconciliation logic all transfer directly.

### Pros and Cons Summary

| | Full Daemon (Current) | Process Isolation (Proposed) |
|---|---|---|
| **LOC** | ~3,700 | ~1,800 (estimated) |
| **Tests** | ~230 | ~150 (drop transport tests, keep logic tests) |
| **Agent survival** | ✅ | ✅ |
| **Cross-platform** | ✅ (custom per-platform) | ✅ (Node handles it) |
| **Security** | ✅✅ Enterprise-grade | ✅ OS process isolation |
| **Independent lifecycle** | ✅ Standalone daemon process | ⚠️ Forked from dev script only |
| **Remote/cloud ready** | ✅ TCP fallback | ❌ Local only |
| **Complexity** | High — 8 modules, custom protocol | Low — 3-4 modules, Node IPC |
| **Time to production** | Mostly built | ~1-2 days refactor |
| **Maintenance burden** | Higher (custom transport, auth, cleanup) | Lower (leverage Node builtins) |

**Bottom line:** For a local dev tool where the primary use case is "agents survive tsx watch restarts," `fork({ detached: true })` + Node IPC gives us 95% of the daemon's value at 50% of the complexity. The daemon design is sound engineering — it's just solving a bigger problem than we have.

---

## Implementation Timeline (AI-Assisted, 12 Agents)

The original estimates (1-2 days for Phase 1, 2-3 weeks for Phase 2) assumed a single developer working sequentially. With 12 AI agents working in parallel, the critical path compresses significantly. Timeline revised based on group consensus (@e7f14c5e, @bb14c13b).

### Phase 1: Enhanced Auto-Resume — ~3-4 hours

Three agents in parallel, all workstreams independent:

| Agent | Task | Estimated |
|-------|------|-----------|
| Developer A | Roster persistence in `gracefulShutdown()` + auto-resume on startup | ~2-3 hours |
| Developer B | UI banner ("🔄 Resuming N agents...") + WebSocket notification | ~2-3 hours |
| QA Tester | Integration test: restart server during active session, verify resume | ~3-4 hours |

**Critical path:** ~3-4 hours.

### Phase 2: Agent Host Daemon — ~2-2.5 days

The daemon itself is ~300 lines, but the reconnect protocol (event buffering, replay, state reconciliation) and operational hardening (single-client, auto-shutdown, zombie escalation) are the real work.

#### Day 1: Core Daemon + DaemonAdapter (8 agents in parallel)

| Agent | Task |
|-------|------|
| Architect | Design `AgentHostProtocol.ts` — JSON-RPC types, Zod schemas, event stream format |
| Developer A | `AgentHostDaemon.ts` — socket listener, connection lifecycle, auth handshake, stale socket cleanup |
| Developer B | Security module — token generation, file permissions, socket directory, kill sentinel |
| Developer C | `DaemonAdapter.ts` — implements `AgentAdapter` interface, proxy via socket |
| Developer D | `AgentAcpBridge.ts` refactor — swap AcpAdapter for DaemonAdapter when daemon detected |
| Developer E | `scripts/dev.mjs` update — daemon lifecycle (check, start, health, leave running on server stop) |
| Developer F | `flightdeck daemon stop/status` CLI commands + emergency kill switch |
| QA Tester | Unit tests: daemon protocol, auth, spawn/terminate, stale socket cleanup |

#### Day 2: Reconnect Protocol + Resilience (6-8 agents)

| Agent | Task |
|-------|------|
| Developer A | Event buffering — buffer during disconnect, replay on subscribe with lastSeenEventId |
| Developer B | Orphaned mode — server disconnect detection, keep agents alive, visible countdown |
| Developer C | Single-client enforcement — reject second connection, informative error, eviction on stale |
| Developer D | Auto-shutdown timer — 12h rule, visible in status file, parent process watch |
| Developer E | Zombie escalation — SIGTERM → 5s → SIGKILL → 2s → force roster removal |
| Developer F | Mass-failure detection — sliding window, cause heuristics, pause/resume spawning |
| Developer G | `AgentManager.ts` refactor — delegate to DaemonAdapter, handle daemon-not-available fallback |
| QA Tester A | Integration: start daemon → start server → spawn agents → restart server → verify agents alive |
| QA Tester B | Edge cases: daemon crash recovery, auth failure, split-brain, stale socket, emergency kill |

#### Day 2.5: Hardening + Polish (4-6 agents)

| Agent | Task |
|-------|------|
| Developer A | Protocol hardening — 10MB message limit, structured pino logging, socket ownership check |
| Developer B | Reconnect state reconciliation — server rebuilds delegations/DAG from SQLite on reconnect |
| QA Tester | End-to-end: full lifecycle including crash recovery, budget-kill, auto-shutdown |
| Tech Writer | Update README, add `docs/daemon-architecture.md`, emergency procedure docs |
| Code Reviewer | Review all daemon PRs before merge |

### Phase Comparison

| | Single Developer | 12 AI Agents | Speedup |
|---|---|---|---|
| Phase 1 | 1-2 days | ~3-4 hours | ~5x |
| Phase 2 | 2-3 weeks | ~2-2.5 days | ~5-6x |
| **Total** | **2.5-3.5 weeks** | **~2.5-3 days** | **~5-6x** |

The core daemon is straightforward (DaemonAdapter + socket protocol). The bulk of Phase 2 time is in operational resilience — reconnect buffering, split-brain mitigation, crash recovery, and edge case testing. These are inherently sequential to validate correctly.
