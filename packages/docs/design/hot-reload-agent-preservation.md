# Hot-Reload with Agent Process Preservation

> **Status:** Design Document (PROPOSAL — Security Model Added) | **Author:** Architect (e7f14c5e) | **Security Review:** Architect (cc29bb0d) | **Date:** 2026-03-07

## Problem Statement

During Flightdeck development, the server runs via `tsx watch src/index.ts`, which restarts the entire Node.js process on every code change. Because Copilot CLI agent processes are spawned as child processes of the server (`child_process.spawn`), they are killed whenever the server restarts. A single code change during an active crew session causes:

1. **All agents terminated** — `SIGTERM` propagates through the process tree
2. **All in-memory state lost** — messages, tool calls, plans, context window info, delegation tracking
3. **All ACP connections severed** — stdio pipes are closed with the parent process
4. **Context window budget wasted** — agents that resume need to rebuild context from scratch

This is the primary developer experience friction for anyone iterating on the Flightdeck server codebase.

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

Ship **Phase 1** (Enhanced Auto-Resume) immediately for developer relief, then build **Phase 2** (Agent Host Daemon) as the correct long-term architecture.

**Core design principle: The daemon is an optimization, not a dependency.** The server MUST work without the daemon — spawning ACP processes directly (current behavior). The daemon adds zero-downtime server restarts as an enhancement, but its absence or failure must never prevent the server from functioning. This means:
- Server startup: attempt daemon connection → if unavailable, fall back to direct ACP spawn
- Daemon crash mid-session: server detects socket EOF → switches to direct spawn → Phase 1 auto-resume for existing agents
- No daemon installed: server works exactly as it does today

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

If the developer closes their terminal or the server crashes hard (SIGKILL, OOM), the daemon keeps running with potentially orphaned agents consuming resources. The daemon implements an auto-shutdown timer:

- **No server connected + no running agents:** Auto-shutdown after **5 minutes**
- **No server connected + agents still running:** Auto-shutdown after **30 minutes** (developer may be restarting their environment)
- **Server connected:** Timer is cancelled/not started

The countdown is written to a status file so `flightdeck daemon status` can display: `Auto-shutdown in 4m23s (no server connected, 3 agents running)`.

The daemon also watches for its parent process (`dev.mjs`) — if the parent exits, start the countdown immediately.

#### Reconnect State Strategy

On server reconnect, the server needs to rebuild in-memory state (delegations, DAG task assignments, completion tracking, message queues). Two options were considered:

**Option A (chosen): Server reconstructs from SQLite.** Delegations, DAG tasks, file locks, and agent metadata are already persisted. The server's existing "resume project" flow rebuilds this state. The daemon only provides: agent IDs, session IDs, PIDs, and event streams. All business logic state lives in the server + SQLite.

**Option B (rejected): Daemon persists server snapshots.** Server sends `snapshot(state)` every 30s, daemon stores it, server calls `getSnapshot()` on reconnect. Rejected because it couples the daemon to server internals and makes the daemon a second source of truth.

**Principle: The daemon stays dumb, the server stays smart.** The daemon understands processes, pipes, and events. It does not understand delegations, DAG tasks, or business logic.

#### Protocol Hardening

**JSON-RPC message size limit:** Max 10MB per message. A malicious or buggy client sending a multi-GB payload would cause OOM. The daemon enforces this on the socket read buffer and disconnects violators.

**Daemon structured logging:** The daemon uses the same pino logger from R5, enabling correlation of daemon events with server events via `agentId`. At minimum, the daemon logs: connection events, auth attempts (success/fail), spawn/terminate calls, disconnections, and auto-shutdown timer state.

### Copilot SDK `--resume` Impact

The planned Copilot SDK natively supports `--resume <sessionId>`, which changes the cost/benefit of both phases:

**Phase 1 (auto-resume) improves dramatically:** `--resume` skips context window rebuild. Resume time drops from 5-15s to ~1-2s per agent. Context budget cost drops from "rebuild everything" to "resume token only." Phase 1 becomes nearly free.

**Phase 2 (daemon) still adds value:** Even with `--resume`, agents still die and restart on server restart. The daemon provides true zero-downtime — agents never notice the server restarted. For a 10-agent crew, that's 10-20s of resume time eliminated entirely.

**Daemon crash recovery simplifies:** With `--resume`, daemon crash recovery becomes: daemon restarts → server tells new daemon to `spawn --resume <sessionId>` for each agent → agents resume natively. Data loss drops from "30s of activity" to "current in-progress turn only."

**Recommendation:** Keep daemon design as-is. Add `--resume` support as a spawn option in the daemon protocol. Both Phase 1 and daemon crash recovery become 1-line changes (add `--resume` to spawn args), not architectural changes.

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
| Developer D | Auto-shutdown timer — 5min/30min, visible in status file, parent process watch |
| Developer E | Zombie escalation — SIGTERM → 5s → SIGKILL → 2s → force roster removal |
| Developer F | `AgentManager.ts` refactor — delegate to DaemonAdapter, handle daemon-not-available fallback |
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
