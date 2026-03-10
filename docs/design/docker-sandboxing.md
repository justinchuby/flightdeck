# Docker-Based Sandboxing for AI Agent Tool Execution

> **Status:** Design Document (NEXT VERSION) | **Author:** Architect (6a64f7dc) | **Date:** 2026-03-06
> **Rev 2:** Addressed code review feedback (cross-platform binaries, API keys, UID mapping, macOS I/O, graceful teardown)

## Problem Statement

Flightdeck agents currently execute tool calls (file read/write, bash commands, git operations) directly on the host system with the same permissions as the Flightdeck server process. An agent can:

- Read/write any file the server user can access (SSH keys, env files, other projects)
- Execute arbitrary shell commands with full system access
- Access the network without restriction
- Consume unlimited CPU/memory/disk

**The core risk:** A misbehaving or prompt-injected agent could exfiltrate sensitive data, modify files outside the project, or consume excessive resources. Today's mitigation (intent rules + worktree isolation) only addresses file conflict between agents, not host-level containment.

### Current Architecture

```
User → Flightdeck Server → AcpConnection.spawn(cliCommand, {cwd}) → CLI process on HOST
                                                                    ↓
                                                              Agent executes tools directly
                                                              (file I/O, bash, git — all on host)
```

**Key file:** `AcpConnection.ts` spawns the CLI as a child process via `spawn(cliCommand, args, {cwd})`. The CLI process inherits the server's full filesystem and network access.

---

## Architecture

### 1. Container-Per-Agent Model

Each agent gets its own Docker container with a controlled environment. The Flightdeck server manages container lifecycle.

```
Flightdeck Server
  ├── AgentManager.spawn(role, task, ...)
  │     ├── SandboxManager.createContainer(agentId, projectDir)
  │     │     ├── docker create --name flightdeck-{agentId[:8]}
  │     │     ├── mount projectDir → /workspace (rw)
  │     │     ├── pass API keys via -e flags
  │     │     └── apply resource limits
  │     └── AcpConnection.spawn("docker", ["exec", "-i", containerName, "copilot"], {cwd: "/workspace"})
  │           (copilot CLI pre-installed in container image — NOT mounted from host)
  │
  ├── Agent runs inside container
  │     ├── File tools: confined to /workspace (= project dir)
  │     ├── Bash: runs inside container (no host access)
  │     └── Network: configurable (default: allowed, option to restrict)
  │
  └── On agent exit/terminate:
        └── SandboxManager.destroyContainer(agentId)  // graceful: stop + rm
```

**Container lifecycle:**
- **Create:** When `AgentManager.spawn()` is called, before `agent.start()`
- **Reuse:** Containers persist for the agent's lifetime (including re-prompts)
- **Destroy:** When the agent terminates, exits, or the session ends
- **Cleanup:** On server shutdown, `SandboxManager.cleanupAll()` removes all containers (similar to WorktreeManager)

### 2. Volume Mounting Strategy

> ⚠ **Cross-platform note:** Host binaries (macOS Mach-O, Windows PE) cannot be mounted into Linux containers. All tools (node, npm, git, copilot CLI) must be installed INSIDE the container image. Only data volumes (project files, config) are mounted from the host.

```yaml
volumes:
  # Project directory — read-write, the only writable area
  - ${PROJECT_DIR}:/workspace:rw

  # Shared workspace (.flightdeck/) — for cross-agent communication
  # (already inside PROJECT_DIR, but called out for clarity)
  - ${PROJECT_DIR}/.flightdeck:/workspace/.flightdeck:rw

  # Git config — read-only (for author name/email in commits)
  - ${HOME}/.gitconfig:/home/flightdeck/.gitconfig:ro
```

**What is NOT mounted:**
- `~/.ssh/` — no SSH key access
- `~/.aws/`, `~/.config/gcloud/` — no cloud credentials
- `/etc/` — no system config
- Host binaries — tools are baked into the container image (see Dockerfile below)
- Other project directories — complete isolation

**Worktree integration:** If worktrees are enabled, mount the worktree path instead of the main project dir.

### 2a. Container Image (Dockerfile.sandbox)

All tools must be pre-installed in the image since host binaries are incompatible (macOS → Linux).

```dockerfile
FROM node:20-slim

# System tools agents need
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    jq \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Copilot CLI — install inside container (not mounted from host)
# Option A: npm global install
RUN npm install -g @anthropic/copilot-cli@latest

# Option B: direct binary download (preferred — faster, smaller)
# RUN curl -fsSL https://github.com/anthropics/copilot-cli/releases/latest/download/copilot-linux-x64 \
#     -o /usr/local/bin/copilot && chmod +x /usr/local/bin/copilot

# Create non-root user matching typical host UID (configurable at runtime)
ARG USER_UID=1000
ARG USER_GID=1000
RUN groupadd -g ${USER_GID} flightdeck && \
    useradd -m -u ${USER_UID} -g ${USER_GID} -s /bin/bash flightdeck

# Set up home directory for git/npm config
ENV HOME=/home/flightdeck
WORKDIR /workspace

# Default: run as non-root flightdeck user
USER flightdeck
```

**Image build:** `docker build -f Dockerfile.sandbox -t flightdeck-sandbox:latest .`

**Image variants:** Provide `Dockerfile.sandbox-python` and `Dockerfile.sandbox-full` for projects needing Python, Go, or other runtimes.

### 3. ACP Connection Modification

The key change is in how `AcpConnection` spawns the CLI process. Instead of spawning directly on the host:

```typescript
// CURRENT (AcpConnection.ts:118)
this.process = spawn(opts.cliCommand, args, {
  stdio: ['pipe', 'pipe', 'inherit'],
  cwd: opts.cwd || process.cwd(),
});

// SANDBOXED
if (this.sandbox) {
  // The CLI runs inside the container; we communicate via docker exec stdin/stdout
  this.process = spawn('docker', [
    'exec', '-i',
    this.sandbox.containerId,
    opts.cliCommand, ...args,
  ], {
    stdio: ['pipe', 'pipe', 'inherit'],
    // cwd is irrelevant on host — container's WORKDIR is /workspace
  });
} else {
  // Fallback: direct execution (no Docker)
  this.process = spawn(opts.cliCommand, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: opts.cwd || process.cwd(),
  });
}
```

**Critical insight:** We don't need to proxy individual tool calls. The entire CLI process (Copilot, Cursor, etc.) runs inside the container. All tool calls the CLI makes (file reads, bash, grep) are automatically sandboxed because the process itself is containerized. This is the simplest and most secure approach — no tool-call interception needed.

### 4. Network Isolation

Three modes, configurable per-session:

| Mode | Docker Flag | Use Case |
|------|------------|----------|
| **Full access** (default) | `--network=host` | Agents that need npm install, API calls, web scraping |
| **Limited** | `--network=bridge` + allowlist | Agents that need specific endpoints only |
| **Airgapped** | `--network=none` | Maximum security — no external access |

**Default recommendation:** Full access initially (breaking change if we restrict), with a setting to lock it down.

### 5. Resource Limits

```typescript
interface SandboxLimits {
  cpus: number;          // Default: 2 (of host cores)
  memoryMb: number;      // Default: 4096 (4GB)
  diskMb: number;        // Default: 10240 (10GB) — tmpfs for /tmp
  pidsLimit: number;     // Default: 256 — prevents fork bombs
  readOnly: boolean;     // Default: false (project dir is rw, but rootfs is ro)
}
```

Docker flags:
```
--cpus=2
--memory=4g
--pids-limit=256
--tmpfs /tmp:size=10g
--read-only  (with --tmpfs for writable areas)
```

---

## Integration with Flightdeck

### 1. SandboxManager — New Service

```typescript
// packages/server/src/coordination/SandboxManager.ts

export interface SandboxConfig {
  enabled: boolean;
  image: string;            // Default: 'flightdeck-sandbox:latest'
  network: 'host' | 'bridge' | 'none';
  limits: SandboxLimits;
  extraMounts: string[];    // User-configured additional mounts
  extraEnv: string[];       // User-configured additional env vars
  /** API keys and auth tokens passed into containers.
   *  These are REQUIRED for agents to function.
   *  Sourced from the server's environment — never stored in config. */
  passthroughEnvKeys: string[];  // Default: see REQUIRED_ENV below
}

/**
 * Environment variables passed into every sandbox container.
 *
 * REQUIRED (agents won't work without these):
 *   - ANTHROPIC_API_KEY / OPENAI_API_KEY — LLM provider auth
 *   - GITHUB_TOKEN / GH_TOKEN — GitHub API access (for gh CLI, PR creation)
 *   - COPILOT_AUTH_TOKEN — Copilot CLI authentication
 *
 * OPTIONAL (passed if present):
 *   - HTTP_PROXY / HTTPS_PROXY / NO_PROXY — corporate proxy config
 *   - NODE_EXTRA_CA_CERTS — custom CA certificates
 *   - npm_config_registry — custom npm registry
 *
 * NEVER passed (security):
 *   - AWS_* — cloud credentials (use IAM roles instead)
 *   - SSH_AUTH_SOCK — SSH agent socket
 */
const REQUIRED_ENV = [
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'GITHUB_TOKEN', 'GH_TOKEN',
  'COPILOT_AUTH_TOKEN',
];
const OPTIONAL_ENV = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'NODE_EXTRA_CA_CERTS', 'npm_config_registry',
];

export class SandboxManager {
  private containers = new Map<string, ContainerInfo>();
  private dockerAvailable: boolean;

  constructor(config: SandboxConfig) {
    this.dockerAvailable = this.checkDocker();
  }

  /** Create a container for an agent. Returns container ID. */
  async createContainer(agentId: string, projectDir: string): Promise<ContainerInfo>

  /** Gracefully stop and remove a container (SIGTERM → wait → rm). */
  async destroyContainer(agentId: string): Promise<void>

  /** Clean up all containers (server shutdown). */
  async cleanupAll(): Promise<void>

  /** Clean up orphaned containers from crashed sessions. */
  async cleanupOrphans(): Promise<void>

  /** Check if Docker daemon is running. */
  private checkDocker(): boolean
}
```

**Integration point:** `AgentManager.spawn()` calls `SandboxManager.createContainer()` before `agent.start()`. The container info is passed to `AcpConnection` via a new `sandbox` option.

### 2. ACP Tool Call Routing

**No tool call proxy needed.** Since the CLI process itself runs inside the container, all tool calls are automatically sandboxed. The ACP protocol flows over stdin/stdout of `docker exec`, which is transparent to both the server and the CLI.

```
Server ←stdin/stdout→ docker exec -i container copilot --acp --stdio
                                    ↕
                              Container filesystem
                              (only /workspace is writable)
```

### 3. Intent Rules Integration

With sandboxing, the `out_of_directory` detection from the earlier feasibility study becomes trivial:

- **Without sandboxing:** Need to parse tool call file paths and compare against project dir
- **With sandboxing:** The container's filesystem IS the project dir. Out-of-directory access is physically impossible (returns "file not found" or "permission denied")

However, we can still add monitoring for **attempted** out-of-bounds access:
- Add a new `DecisionCategory`: `'filesystem_violation'`
- In the container, mount a custom seccomp profile or use `inotifywait` to detect denied access attempts
- Or simpler: log container stderr for "permission denied" patterns and create alerts

### 4. Graceful Fallback When Docker Is Unavailable

```typescript
// In AgentManager.spawn():
if (sandboxConfig.enabled) {
  if (this.sandboxManager.dockerAvailable) {
    const container = await this.sandboxManager.createContainer(agentId, cwd);
    agent.sandbox = container;
  } else {
    logger.warn('sandbox', 'Docker not available — running agent unsandboxed');
    this.emit('sandbox:fallback', { agentId, reason: 'docker_unavailable' });
    // Continue with direct execution — show warning in UI
  }
}
```

**User notification:** When fallback occurs, emit a WebSocket event that shows a persistent warning banner: "⚠ Sandbox unavailable — agents running with full system access."

### 5. Settings UI

Add to Settings panel (SettingsPanel.tsx):

```
┌─────────────────────────────────────────────┐
│ 🐳 Agent Sandboxing                        │
│                                             │
│ ○ Disabled (agents run on host directly)    │
│ ● Enabled  (agents run in Docker containers)│
│                                             │
│ Docker image: [node:20-slim         ] [▾]   │
│                                             │
│ Network:  ○ Full  ● Limited  ○ Airgapped    │
│                                             │
│ Resource Limits:                            │
│   CPU cores: [2    ]  Memory: [4096 MB]     │
│   Max PIDs:  [256  ]  Temp disk: [10 GB]    │
│                                             │
│ Additional mounts (read-only):              │
│   [~/.npm                              ] [+]│
│                                             │
│ Status: ✅ Docker available (v24.0.7)       │
└─────────────────────────────────────────────┘
```

---

## Security Model

### Threats Mitigated

| Threat | Mitigation | Effectiveness |
|--------|-----------|---------------|
| Read sensitive files outside project | Container only mounts project dir | ✅ Complete |
| Write/delete files outside project | Container rootfs is read-only | ✅ Complete |
| Exfiltrate data via network | Network mode: `none` or `bridge` with allowlist | ✅ Complete (when configured) |
| Fork bomb / resource exhaustion | `--pids-limit`, `--cpus`, `--memory` | ✅ Complete |
| Crypto mining / CPU abuse | `--cpus` limit | ✅ Effective |
| Access cloud credentials | Credentials not mounted | ✅ Complete |
| Access SSH keys | `.ssh/` not mounted | ✅ Complete |
| Privilege escalation on host | Container runs as non-root, no `--privileged` | ✅ Strong |

### What It Does NOT Protect Against

| Gap | Explanation | Mitigation |
|-----|------------|------------|
| **Malicious code in project files** | Agent can modify project source code (that's its job). Malicious changes could be committed. | Code review, CI/CD gates, commit signing |
| **Container escape (0-day)** | Kernel vulnerabilities could allow escape. Rare but possible. | Keep Docker updated, use gVisor/Kata for high-security |
| **Network exfiltration (when network=host)** | If network isn't restricted, agent can send data anywhere | Use `bridge` or `none` mode for sensitive projects |
| **Time-of-check/time-of-use on mounted volume** | Agent modifies files between host reads | Accept as inherent to shared filesystem |
| **Side-channel attacks** | Timing, cache, etc. | Out of scope — impractical for LLM agents |

### Escape Vector Minimization

1. **No `--privileged`** — ever
2. **No capability additions** — drop all capabilities: `--cap-drop=ALL`
3. **No device access** — `--device` not used
4. **Read-only rootfs** — `--read-only` with tmpfs for `/tmp`
5. **Non-root user** — `--user $(id -u):$(id -g)` matching host UID for correct file ownership (see UID Mapping below)
6. **Seccomp profile** — use Docker's default seccomp (blocks ~44 dangerous syscalls)
7. **No new privileges** — `--security-opt=no-new-privileges`

### UID / HOME Directory Mapping

**Problem:** Running containers as a mismatched UID breaks git config, npm caches, and file ownership on bind-mounted volumes. Files created as UID 1000 inside the container may not match the host user's UID.

**Solution (two-layer approach):**

1. **Build-time:** Dockerfile creates a `flightdeck` user with default UID 1000 (configurable via build arg). `HOME=/home/flightdeck` is set so git/npm find their config.

2. **Run-time:** `SandboxManager.createContainer()` detects the host user's UID/GID and passes `--user $(id -u):$(id -g)`. If the UID doesn't match the Dockerfile's default, the container still works because:
   - `/workspace` is a bind mount (host UID owns the files)
   - `/home/flightdeck/.gitconfig` is mounted read-only from host
   - `/tmp` is tmpfs (any UID can write)

3. **Fallback for UID mismatch:** If the host UID doesn't match the container's `flightdeck` user, git may warn about "dubious ownership." Add `git config --global --add safe.directory /workspace` in the container entrypoint.

```typescript
// In SandboxManager.createContainer():
const uid = process.getuid?.() ?? 1000;
const gid = process.getgid?.() ?? 1000;
const envArgs = this.buildEnvFlags();  // -e KEY=VALUE for each passthrough key
const userFlag = `--user ${uid}:${gid}`;
```

---

## Implementation Plan

### Phase 1: SandboxManager Core (Small)
**Goal:** Create/destroy Docker containers for agents.

**Files to create:**
- `packages/server/src/coordination/SandboxManager.ts` — container lifecycle
- `packages/server/src/__tests__/SandboxManager.test.ts` — unit tests (mock Docker commands)

**Files to modify:**
- `packages/server/src/index.ts` — instantiate SandboxManager, wire to AgentManager
- `packages/server/src/agents/AgentManager.ts` — call `sandboxManager.createContainer()` in `spawn()`

**Dependencies:** None new (uses `child_process` to call `docker` CLI)

### Phase 2: AcpConnection Docker Exec (Small)
**Goal:** Route CLI spawning through `docker exec` when sandbox is active.

**Files to modify:**
- `packages/server/src/acp/AcpConnection.ts` — add `sandbox?: { containerId: string }` option, modify `spawnAndConnect()`
- `packages/server/src/agents/AgentAcpBridge.ts` — pass sandbox info to AcpConnection
- `packages/server/src/agents/Agent.ts` — add `sandbox` property

### Phase 3: Configuration & Settings UI (Medium)
**Goal:** User-configurable sandbox settings persisted in DB.

**Files to create:**
- `packages/web/src/components/Settings/SandboxSettings.tsx` — UI panel

**Files to modify:**
- `packages/server/src/routes/config.ts` — sandbox config endpoints
- `packages/web/src/components/Settings/SettingsPanel.tsx` — add SandboxSettings section

### Phase 4: Docker Image & Resource Limits (Small → Medium)
**Goal:** Custom Flightdeck Docker image with pre-installed tools. This is now a **prerequisite for Phase 2** since host binaries can't be mounted cross-platform.

**Files to create:**
- `Dockerfile.sandbox` — base image with node, npm, git, ripgrep, copilot CLI, non-root user
- `Dockerfile.sandbox-python` — variant with Python 3.x for Python-heavy projects
- `docker-compose.sandbox.yml` — optional compose file for custom builds

**Dependency change:** Phase 4 must now complete BEFORE Phase 2 (image must exist before containers can be created).

**Revised dependency chain:** Phase 1 + Phase 4 (parallel) → Phase 2 → Phase 3 → Phase 5 → Phase 6

### Phase 5: Graceful Fallback & Health Monitoring (Small)
**Goal:** Handle Docker unavailability, container health, and orphan cleanup.

**Files to modify:**
- `packages/server/src/coordination/SandboxManager.ts` — health checks, orphan cleanup
- `packages/server/src/comms/WebSocketServer.ts` — broadcast sandbox status events

### Phase 6: Network Policy & Advanced Security (Medium)
**Goal:** Configurable network isolation with allowlists.

**Files to create:**
- Network policy configuration in SandboxManager
- iptables/nftables rules for bridge-mode allowlists

**Dependency chain:** Phase 1 + Phase 4 (parallel) → Phase 2 → Phase 3 → Phase 5 → Phase 6

### Testing Strategy

1. **Unit tests** — Mock `docker` CLI calls, test container lifecycle, test fallback behavior
2. **Integration tests** — With Docker available:
   - Agent can read/write files in project dir ✓
   - Agent CANNOT read files outside project dir (e.g., `/etc/passwd`) ✓
   - Agent CANNOT write outside project dir ✓
   - Resource limits are enforced (memory OOM, PID limit) ✓
   - Container is cleaned up on agent exit ✓
   - Orphan containers are cleaned up on server restart ✓
3. **E2E test** — Full agent session with sandbox: spawn agent, execute task, verify file changes, verify no host-level side effects
4. **Fallback test** — Disable Docker, verify agents still work unsandboxed with warning

---

## Trade-offs

### Performance Impact

| Operation | Without Sandbox | With Sandbox (Linux host) | With Sandbox (macOS) | Notes |
|-----------|----------------|--------------------------|---------------------|-------|
| Agent spawn | ~2s (CLI startup) | ~4-5s (+container create) | ~4-5s | Pre-pull image to avoid download delay |
| File read/write | Direct I/O | ~5-10% slower (bind mount) | **2-5x slower** ⚠ | macOS uses VM-based Docker; see below |
| Bash commands | Direct exec | ~50-100ms per `docker exec` | ~50-100ms | Constant overhead per command |
| Network I/O | Direct | Negligible (host) to ~5% (bridge) | Same | NAT overhead only in bridge mode |

> ⚠ **macOS Docker Performance Warning**
>
> Docker Desktop on macOS runs Linux containers inside a VM (HyperKit or Apple Virtualization). Bind-mounted volume I/O goes through the VM's filesystem layer, which is **2-5x slower** than native I/O — not the 5-10% typical of Linux bind mounts.
>
> **Mitigations:**
> - **VirtioFS** (default since Docker Desktop 4.15+) — significantly faster than gRPC-FUSE, but still ~2x overhead for heavy I/O
> - **`:cached` mount flag** — `${PROJECT_DIR}:/workspace:cached` allows slight staleness for better read performance
> - **Mutagen file sync** — Docker Desktop's optional sync engine, near-native performance but adds complexity
> - **Colima with VirtioFS** — alternative Docker runtime for macOS with better I/O tuning
> - **Recommend Linux for production** — if agents do heavy file I/O, Linux hosts avoid this entirely
>
> SandboxManager should log a performance advisory when running on macOS:
> ```typescript
> if (process.platform === 'darwin') {
>   logger.warn('sandbox', 'macOS detected — Docker volume I/O will be 2-5x slower than native. Consider VirtioFS mount backend.');
> }
> ```

**Mitigation:** Pre-pull Docker image on server start. Use `docker create` (not `docker run`) so container is ready before agent needs it. Consider container pooling for rapid successive spawns.

### Complexity Cost

- **New service:** SandboxManager (~300-500 lines)
- **Modified files:** ~5 files, ~100 lines of changes
- **New dependency:** Docker must be installed on host (but graceful fallback exists)
- **Testing burden:** Integration tests need Docker available in CI
- **Operational burden:** Users need Docker installed; support for Docker Desktop licensing

### Alternatives Considered

| Alternative | Pros | Cons | Verdict |
|-------------|------|------|---------|
| **Docker containers** | Industry standard, well-understood, strong isolation | Requires Docker installation, container startup overhead | ✅ **Chosen** |
| **chroot** | Lightweight, no Docker needed | Weak isolation (no PID/network/resource limits), requires root | ❌ Insufficient |
| **macOS sandbox-exec** | Native, no dependencies | macOS-only, deprecated by Apple, limited configurability | ❌ Platform-locked |
| **eBPF/seccomp** | Kernel-level, very fast | Complex to configure, Linux-only, doesn't restrict filesystem paths well | ❌ Too complex |
| **gVisor (runsc)** | Stronger isolation than Docker (user-space kernel) | Linux-only, performance overhead, additional dependency | 🔄 Future option |
| **Firecracker microVMs** | Strongest isolation (hardware-level) | Heavy, complex, Linux-only, overkill for dev tool | ❌ Overkill |
| **Podman** | Rootless, Docker-compatible | Less widely installed than Docker | 🔄 Support alongside Docker |
| **Nix sandboxing** | Reproducible, declarative | Niche, steep learning curve | ❌ Too niche |

### Recommendation

**Start with Docker containers** (Phase 1-3). This gives us 90% of the security benefit with reasonable complexity. gVisor can be added as an optional runtime in a future version for users who need maximum isolation.

**Consider Podman support** alongside Docker — the CLI interface is nearly identical (`podman` is a drop-in replacement for `docker` in most cases). SandboxManager can detect which is available.

---

## Open Questions

1. ~~**File permission mapping**~~ → **RESOLVED:** Use `--user $(id -u):$(id -g)` at runtime + `git config --global --add safe.directory /workspace` for git compatibility. See UID Mapping section above.
2. **Git operations** — Agents need git. `.gitconfig` is mounted read-only from host. For SSH-based git remotes, users would need to mount SSH keys (opt-in, not by default). HTTPS with tokens (passed via env) works out of the box.
3. **Language-specific tools** — Base image includes node/npm/git. Python/Go variants provided as alternative Dockerfiles. Agent can install packages inside container (ephemeral — lost on container destroy).
4. **MCP servers** — Some agents connect to MCP servers running on the host. With `--network=host` (default), `localhost` works. With `bridge` mode, need `--add-host=host.docker.internal:host-gateway`.
5. **GPU access** — Future: if agents need GPU (e.g., for ML tasks), need `--gpus` flag. Out of scope for v1.
6. ~~**API keys**~~ → **RESOLVED:** Environment variable passthrough with explicit allowlist. See SandboxConfig and REQUIRED_ENV/OPTIONAL_ENV above.

---

## Appendix: Docker Command Reference

### Create container
```bash
docker create \
  --name flightdeck-${AGENT_ID:0:8} \
  --workdir /workspace \
  --user $(id -u):$(id -g) \
  --cpus=2 \
  --memory=4g \
  --pids-limit=256 \
  --read-only \
  --tmpfs /tmp:size=10g \
  --tmpfs /home/flightdeck/.cache:size=1g \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --network=host \
  -v ${PROJECT_DIR}:/workspace:rw \
  -v ${HOME}/.gitconfig:/home/flightdeck/.gitconfig:ro \
  -e HOME=/home/flightdeck \
  -e PATH=/usr/local/bin:/usr/bin:/bin \
  -e ANTHROPIC_API_KEY \
  -e OPENAI_API_KEY \
  -e GITHUB_TOKEN \
  -e GH_TOKEN \
  -e COPILOT_AUTH_TOKEN \
  flightdeck-sandbox:latest \
  sh -c 'git config --global --add safe.directory /workspace && sleep infinity'

docker start flightdeck-${AGENT_ID:0:8}
```

> **Note:** All tools (node, npm, git, copilot CLI) are pre-installed in the `flightdeck-sandbox` image — NO host binaries are mounted. This ensures cross-platform compatibility (macOS host → Linux container).

### Execute CLI inside container
```bash
docker exec -i flightdeck-${AGENT_ID:0:8} copilot --acp --stdio
```

### Destroy container
```bash
# Graceful shutdown: SIGTERM first, then force-remove after timeout
docker stop --time 10 flightdeck-${AGENT_ID:0:8}
docker rm flightdeck-${AGENT_ID:0:8}
```

### Cleanup orphans
```bash
# Graceful cleanup of orphaned containers from crashed sessions
docker ps -a --filter "name=flightdeck-" --format "{{.Names}}" | xargs -r -I{} sh -c 'docker stop --time 5 {} && docker rm {}'
```
