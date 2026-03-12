# macOS Sandboxing Design — Flightdeck Desktop

## Overview

This document covers the hardest problem in packaging Flightdeck as a desktop
app: Apple's App Sandbox. Flightdeck's core function — spawning external CLI
tools as child processes — is fundamentally at odds with sandbox restrictions.

This design solves it through a **dual-mode architecture**: direct distribution
(no sandbox) as the primary channel, and a companion bridge helper for Mac App
Store (sandboxed) distribution.

---

## The Problem

Flightdeck spawns 6 different external CLI tools and `git`:

| Binary | Invocation | Purpose |
|--------|-----------|---------|
| `copilot` | `copilot --acp --stdio` | GitHub Copilot CLI agent |
| `gemini` | `gemini --acp` | Google Gemini CLI agent |
| `codex-acp` | `codex-acp` | OpenAI Codex CLI agent |
| `claude-agent-acp` | `claude-agent-acp` | Anthropic Claude CLI agent |
| `opencode` | `opencode acp` | OpenCode CLI agent |
| `agent` | `agent acp` | Cursor CLI agent |
| `git` | `git worktree add/merge/prune` | Per-agent workspace isolation |

All are spawned via `child_process.spawn()` from `AcpAdapter.ts` and
`WorktreeManager.ts`, resolved from the user's `$PATH`.

### What the Sandbox Blocks

Apple's App Sandbox (required for Mac App Store):
- **Blocks** executing binaries from user-installed paths (`/usr/local/bin`, `~/.local/bin`, etc.)
- **Blocks** access to arbitrary filesystem locations
- **Blocks** reading the user's `$PATH` environment
- **Allows** spawning child processes that are **bundled inside the app** and inherit the sandbox
- **Allows** network connections to localhost (with entitlements)
- **Allows** access to user-selected directories (via NSOpenPanel file picker)

---

## Architecture: Dual-Mode Operation

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Mode Detection Layer                              │
│                                                                     │
│    if (process.mas)  →  Sandbox Mode (Mac App Store)                │
│    else              →  Direct Mode  (notarized DMG/Homebrew)       │
│                                                                     │
├──────────────────────────────┬──────────────────────────────────────┤
│                              │                                      │
│   DIRECT MODE                │   SANDBOX MODE                       │
│                              │                                      │
│   ┌────────────────────┐     │   ┌──────────────────────────┐       │
│   │ AcpAdapter.ts      │     │   │ AcpAdapter.ts            │       │
│   │ spawn(binary, args)│     │   │ bridgeClient.spawn(...)  │       │
│   │ from $PATH         │     │   │ via Unix socket IPC      │       │
│   └────────────────────┘     │   └──────────┬───────────────┘       │
│                              │              │                        │
│   ┌────────────────────┐     │   ┌──────────▼───────────────┐       │
│   │ WorktreeManager.ts │     │   │ flightdeck-bridge        │       │
│   │ exec('git ...')    │     │   │ (companion helper)        │       │
│   │ from $PATH         │     │   │                           │       │
│   └────────────────────┘     │   │ ┌─────────────────────┐  │       │
│                              │   │ │ spawn(binary, args)  │  │       │
│   No sandbox restrictions.   │   │ │ from user's $PATH    │  │       │
│   Everything works as-is.    │   │ └─────────────────────┘  │       │
│                              │   │                           │       │
│                              │   │ Runs OUTSIDE sandbox.     │       │
│                              │   │ Installed via Homebrew.   │       │
│                              │   └───────────────────────────┘       │
└──────────────────────────────┴──────────────────────────────────────┘
```

---

## Direct Distribution Mode (Non-Sandboxed)

### Entitlements

For notarized direct distribution, we use a **hardened runtime** (required for
notarization) but NOT the App Sandbox:

```xml
<!-- build/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- Hardened Runtime (required for notarization) -->
  <key>com.apple.security.cs.allow-jit</key>
  <true/>

  <!-- Allow loading unsigned frameworks (Electron internals) -->
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>

  <!-- Allow dyld environment variables (Electron uses DYLD_INSERT_LIBRARIES) -->
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

```xml
<!-- build/entitlements.mac.inherit.plist -->
<!-- Applied to child processes (helper apps, frameworks) -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

### Capabilities in Direct Mode

| Capability | Status | Notes |
|-----------|--------|-------|
| Spawn CLI tools from PATH | ✅ Works | No sandbox = no restrictions |
| Access ~/.flightdeck/ | ✅ Works | Full filesystem access |
| Access user repos | ✅ Works | Full filesystem access |
| Create git worktrees | ✅ Works | git from PATH |
| SQLite in ~/.flightdeck/ | ✅ Works | Standard path |
| localhost network | ✅ Works | No restrictions |
| Auto-updates | ✅ Works | electron-updater |

**No code changes needed.** The existing server code works as-is.

---

## Mac App Store Mode (Sandboxed)

### Entitlements

```xml
<!-- build/entitlements.mas.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- App Sandbox (mandatory for MAS) -->
  <key>com.apple.security.app-sandbox</key>
  <true/>

  <!-- Network: localhost HTTP + WebSocket -->
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.network.server</key>
  <true/>

  <!-- File access: user-selected directories (project repos) -->
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>

  <!-- Persist access to selected dirs across app restarts -->
  <key>com.apple.security.files.bookmarks.app-scope</key>
  <true/>

  <!-- Allow JIT for Electron's V8 -->
  <key>com.apple.security.cs.allow-jit</key>
  <true/>

  <!-- Allow unsigned executable memory (Electron internals) -->
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>

  <!-- Disable library validation (Electron framework loading) -->
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

```xml
<!-- build/entitlements.mas.inherit.plist -->
<!-- For helper apps, renderer process, GPU process -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key>
  <true/>
  <key>com.apple.security.inherit</key>
  <true/>
</dict>
</plist>
```

---

## Companion CLI Bridge Helper

### What It Is

A lightweight, non-sandboxed daemon that runs outside the App Sandbox and spawns
CLI tools on behalf of the sandboxed Flightdeck app. Communication happens over
a Unix domain socket in the user's home directory.

### Architecture

```
┌───────────────────────────────────────┐
│  Flightdeck.app (SANDBOXED)          │
│                                       │
│  AcpAdapter.ts                        │
│  ├─ if (process.mas)                  │
│  │    bridgeClient.spawn('copilot',   │
│  │      ['--acp', '--stdio'],         │
│  │      { env: {...} })               │
│  │    ↓                               │
│  │    Unix socket connect to          │
│  │    ~/.flightdeck/bridge.sock       │
│  └─ else                              │
│       child_process.spawn(...)        │
└──────────────┬────────────────────────┘
               │ Unix Domain Socket
               │ (network.client entitlement)
               ▼
┌───────────────────────────────────────┐
│  flightdeck-bridge (NOT SANDBOXED)   │
│                                       │
│  Listens on ~/.flightdeck/bridge.sock │
│                                       │
│  On spawn request:                    │
│  ├─ Resolve binary from $PATH         │
│  ├─ child_process.spawn(binary, args) │
│  ├─ Pipe stdin/stdout back over sock  │
│  └─ Report exit code                  │
│                                       │
│  Installed via: brew install           │
│    flightdeck-ai/flightdeck/          │
│    flightdeck-bridge                  │
└───────────────────────────────────────┘
```

### Bridge Protocol

JSON-RPC over Unix domain socket, one connection per spawned process:

```typescript
// Request: spawn a CLI tool
interface SpawnRequest {
  jsonrpc: '2.0';
  method: 'spawn';
  id: string;
  params: {
    command: string;         // e.g. 'copilot'
    args: string[];          // e.g. ['--acp', '--stdio']
    cwd?: string;            // working directory
    env?: Record<string, string>; // additional env vars
  };
}

// Response: process started
interface SpawnResponse {
  jsonrpc: '2.0';
  id: string;
  result: {
    pid: number;
  };
}

// Notification: stdout data
interface StdoutNotification {
  jsonrpc: '2.0';
  method: 'stdout';
  params: {
    data: string;  // base64-encoded
  };
}

// Notification: process exited
interface ExitNotification {
  jsonrpc: '2.0';
  method: 'exit';
  params: {
    code: number | null;
    signal: string | null;
  };
}

// Request: send stdin data
interface StdinRequest {
  jsonrpc: '2.0';
  method: 'stdin';
  params: {
    data: string;  // base64-encoded
  };
}

// Request: kill process
interface KillRequest {
  jsonrpc: '2.0';
  method: 'kill';
  params: {
    signal?: string;  // default: 'SIGTERM'
  };
}

// Request: git operations
interface GitRequest {
  jsonrpc: '2.0';
  method: 'git';
  id: string;
  params: {
    args: string[];   // e.g. ['worktree', 'add', ...]
    cwd: string;
  };
}

interface GitResponse {
  jsonrpc: '2.0';
  id: string;
  result: {
    stdout: string;
    stderr: string;
    exitCode: number;
  };
}
```

### Bridge Server Implementation

```
packages/bridge/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # Unix socket server
│   ├── process-manager.ts    # Spawn and manage child processes
│   ├── git-handler.ts        # Git command execution
│   └── security.ts           # Validate requests, prevent abuse
├── package.json
└── tsconfig.json
```

```typescript
// packages/bridge/src/server.ts (simplified)
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { ProcessManager } from './process-manager';
import { validateRequest } from './security';

const SOCKET_PATH = path.join(os.homedir(), '.flightdeck', 'bridge.sock');

export function startBridgeServer(): void {
  // Clean up stale socket
  if (fs.existsSync(SOCKET_PATH)) {
    fs.unlinkSync(SOCKET_PATH);
  }

  // Ensure directory exists
  fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true });

  const processManager = new ProcessManager();

  const server = net.createServer((socket) => {
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();
      // Parse newline-delimited JSON-RPC messages
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          validateRequest(msg);
          handleMessage(socket, msg, processManager);
        } catch (err) {
          socket.write(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32600, message: String(err) },
          }) + '\n');
        }
      }
    });

    socket.on('close', () => {
      processManager.cleanupForSocket(socket);
    });
  });

  server.listen(SOCKET_PATH, () => {
    // Set socket permissions: owner only
    fs.chmodSync(SOCKET_PATH, 0o600);
    console.log(`Bridge listening on ${SOCKET_PATH}`);
  });
}
```

### Security Considerations

The bridge is a **privilege escalation surface**: it accepts commands from the
sandboxed app and executes them outside the sandbox. Security mitigations:

1. **Socket permissions**: `chmod 600` — only the owning user can connect
2. **Command allowlist**: Only allow known CLI tool names:
   ```typescript
   const ALLOWED_COMMANDS = new Set([
     'copilot', 'gemini', 'codex-acp', 'claude-agent-acp',
     'opencode', 'agent', 'git',
   ]);
   ```
3. **Argument validation**: Reject shell metacharacters, validate argument patterns
4. **Rate limiting**: Max 50 concurrent processes (matches server's MAX_AGENTS)
5. **Working directory validation**: Only allow cwd within user's home directory
6. **No shell execution**: Use `spawn()` not `exec()` — no shell injection
7. **Process isolation**: Each spawned process inherits a clean, minimal environment

### Bridge Installation

Distributed as a Homebrew formula alongside the cask:

```ruby
# Formula/flightdeck-bridge.rb
class FlightdeckBridge < Formula
  desc "Companion helper for Flightdeck desktop app (Mac App Store)"
  homepage "https://github.com/flightdeck-ai/flightdeck"
  url "https://github.com/flightdeck-ai/flightdeck/releases/download/v0.4.0/flightdeck-bridge-0.4.0.tar.gz"
  sha256 "PLACEHOLDER"
  license "MIT"

  depends_on "node@20"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  # launchd plist for auto-start
  service do
    run [opt_bin/"flightdeck-bridge"]
    keep_alive true
    log_path var/"log/flightdeck-bridge.log"
    error_log_path var/"log/flightdeck-bridge.log"
    working_dir HOMEBREW_PREFIX
  end
end
```

User setup:

```bash
brew install flightdeck-ai/flightdeck/flightdeck-bridge
brew services start flightdeck-bridge
```

### Bridge Not Running — User Flow

When the MAS app detects the bridge is not running:

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│  ⚠️ CLI Bridge Required                                    │
│                                                            │
│  Flightdeck needs the companion helper to spawn AI agents. │
│                                                            │
│  Install via Homebrew:                                     │
│  ┌──────────────────────────────────────────────────┐      │
│  │ brew install flightdeck-ai/flightdeck/           │      │
│  │   flightdeck-bridge                              │      │
│  │ brew services start flightdeck-bridge            │ [📋] │
│  └──────────────────────────────────────────────────┘      │
│                                                            │
│  [Open Terminal]          [Copy Commands]      [Retry]     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## File System Access in Sandboxed Mode

### SQLite Database Path

| Mode | DB Location |
|------|------------|
| Direct (non-sandboxed) | `~/.flightdeck/flightdeck.db` |
| MAS (sandboxed) | `~/Library/Containers/com.flightdeck.app/Data/Library/Application Support/Flightdeck/flightdeck.db` |

Implementation:

```typescript
// packages/desktop/src/platform/paths.ts
import { app } from 'electron';
import path from 'node:path';
import os from 'node:os';

export interface PlatformPaths {
  stateDir: string;
  dbPath: string;
  configPath: string;
  logsDir: string;
  windowStatePath: string;
}

export function getPlatformPaths(): PlatformPaths {
  if (process.mas) {
    // MAS: use Electron's app.getPath which respects the sandbox container
    const userData = app.getPath('userData');
    return {
      stateDir: userData,
      dbPath: path.join(userData, 'flightdeck.db'),
      configPath: path.join(userData, 'config.yaml'),
      logsDir: path.join(userData, 'logs'),
      windowStatePath: path.join(userData, 'window-state.json'),
    };
  }

  // Direct distribution: use ~/.flightdeck/ (same as CLI)
  const stateDir = process.env.FLIGHTDECK_STATE_DIR
    ?? path.join(os.homedir(), '.flightdeck');
  return {
    stateDir,
    dbPath: path.join(stateDir, 'flightdeck.db'),
    configPath: path.join(stateDir, 'config.yaml'),
    logsDir: path.join(stateDir, 'logs'),
    windowStatePath: path.join(stateDir, 'window-state.json'),
  };
}
```

### Project Repository Access

In sandbox mode, the app cannot access arbitrary filesystem paths. Users must
explicitly select their project directory via a file picker (NSOpenPanel).

**Security-Scoped Bookmarks** persist this access across app restarts:

```typescript
// packages/desktop/src/platform/sandbox.ts
import { app, dialog } from 'electron';

// Store bookmarks for previously-opened directories
const bookmarks = new Map<string, Buffer>();

export async function requestDirectoryAccess(
  title: string = 'Select Project Repository',
): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title,
    properties: ['openDirectory', 'createDirectory'],
    // MAS: this triggers NSOpenPanel which grants sandbox access
    securityScopedBookmarks: true,
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const dirPath = result.filePaths[0];

  // Store the security-scoped bookmark for future use
  if (result.bookmarks?.[0]) {
    bookmarks.set(dirPath, Buffer.from(result.bookmarks[0], 'base64'));
    persistBookmarks(); // Save to disk
  }

  return dirPath;
}

export function restoreDirectoryAccess(dirPath: string): boolean {
  const bookmark = bookmarks.get(dirPath);
  if (!bookmark) return false;

  try {
    // Resolve the bookmark to get a security-scoped URL
    app.startAccessingSecurityScopedResource(bookmark);
    return true;
  } catch {
    bookmarks.delete(dirPath);
    return false;
  }
}

export function releaseDirectoryAccess(dirPath: string): void {
  const bookmark = bookmarks.get(dirPath);
  if (bookmark) {
    app.stopAccessingSecurityScopedResource(bookmark);
  }
}
```

### Agent Workspace Directories

In sandbox mode, the `.flightdeck/` and `.worktrees/` directories inside the
project repo are created within the user-selected (bookmarked) directory,
so they inherit the security-scoped access:

```
<user-selected-repo>/          ← NSOpenPanel grants access
├── .flightdeck/               ← Created by server, inherits access
│   └── shared/                ← Inter-agent artifacts
├── .worktrees/                ← Created by WorktreeManager
│   ├── agent-a1b2c3/         ← Git worktree per agent
│   └── agent-d4e5f6/
└── .git/                      ← Git operations via bridge
```

---

## Network Entitlements

### Localhost Communication

The Electron renderer connects to the Express server via localhost. In sandbox
mode, this requires explicit entitlements:

- `com.apple.security.network.client` — allows outbound connections (renderer → server)
- `com.apple.security.network.server` — allows listening on ports (Express server)

Both are standard entitlements that Apple approves routinely for developer tools.

### Unix Domain Socket

The bridge client connects to `~/.flightdeck/bridge.sock`. This is allowed by
the `network.client` entitlement as Unix domain sockets are treated as local
network connections.

However, the socket file itself must be in an accessible location. In sandbox
mode, `~/Library/Containers/com.flightdeck.app/Data/` is writable, but
`~/.flightdeck/` may not be accessible.

**Solution**: The bridge watches two socket paths:
```
~/.flightdeck/bridge.sock                    ← for CLI/direct mode
~/Library/Containers/com.flightdeck.app/Data/.flightdeck/bridge.sock  ← for MAS
```

Or use a symlink:
```bash
# flightdeck-bridge creates a symlink if the container dir exists
ln -sf ~/.flightdeck/bridge.sock \
  ~/Library/Containers/com.flightdeck.app/Data/.flightdeck/bridge.sock
```

---

## Server-Side Sandbox Abstraction

### Changes to AcpAdapter.ts

```typescript
// packages/server/src/adapters/AcpAdapter.ts (modified)
import { BridgeClient } from './BridgeClient';

export class AcpAdapter implements AgentAdapter {
  private bridgeClient?: BridgeClient;

  constructor(private readonly options: { isMAS?: boolean }) {
    if (options.isMAS) {
      this.bridgeClient = new BridgeClient();
    }
  }

  private async spawnAndConnect(opts: AdapterStartOptions): Promise<void> {
    if (this.bridgeClient) {
      // MAS mode: spawn via bridge
      this.process = await this.bridgeClient.spawn({
        command: opts.cliCommand,
        args: [...(opts.baseArgs || []), ...(opts.cliArgs || [])],
        cwd: opts.cwd,
        env: opts.env,
      });
    } else {
      // Direct mode: spawn normally (existing code)
      this.validateCliCommand(opts.cliCommand);
      this.process = spawn(opts.cliCommand, args, {
        stdio: ['pipe', 'pipe', 'inherit'],
        cwd: opts.cwd,
        env: opts.env ? { ...process.env, ...opts.env } : undefined,
      });
    }
    // ... rest of ACP connection setup unchanged ...
  }
}
```

### BridgeClient Implementation

```typescript
// packages/server/src/adapters/BridgeClient.ts (NEW)
import net from 'node:net';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';

interface BridgeProcess extends EventEmitter {
  stdin: { write(data: string | Buffer): void; end(): void };
  stdout: EventEmitter;
  pid: number;
  kill(signal?: string): void;
}

export class BridgeClient {
  private socketPath: string;

  constructor() {
    // Try MAS container path first, fall back to standard
    const masPath = path.join(
      os.homedir(),
      'Library/Containers/com.flightdeck.app/Data/.flightdeck/bridge.sock',
    );
    const stdPath = path.join(os.homedir(), '.flightdeck', 'bridge.sock');
    this.socketPath = fs.existsSync(masPath) ? masPath : stdPath;
  }

  async spawn(opts: {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<BridgeProcess> {
    const socket = net.createConnection(this.socketPath);

    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });

    // Send spawn request
    const id = crypto.randomUUID();
    socket.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'spawn',
      id,
      params: opts,
    }) + '\n');

    // Create a process-like interface backed by the socket
    const proc = new BridgeProcess(socket, id);
    return proc;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const socket = net.createConnection(this.socketPath);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => { socket.end(); resolve(); });
        socket.once('error', reject);
      });
      return true;
    } catch {
      return false;
    }
  }
}
```

### Changes to WorktreeManager.ts

```typescript
// In WorktreeManager.ts
import { BridgeClient } from '../adapters/BridgeClient';

// Git operations route through bridge in MAS mode
private async execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  if (this.bridgeClient) {
    return this.bridgeClient.execGit(args, cwd);
  }
  // Existing execAsync('git', args, { cwd }) code
  return execAsync('git', args, { cwd });
}
```

---

## App Store Review Considerations

### Likely Review Concerns

| Concern | Mitigation |
|---------|-----------|
| "Why does a dev tool need network.server?" | Express serves localhost-only UI. Standard pattern for Electron MAS apps. |
| "Why JIT entitlement?" | Required by Electron's V8 engine for JavaScript execution. Standard for all Electron MAS apps. |
| "What does the companion helper do?" | Documented in app description. Helper is optional but required for full agent functionality. |
| "File access scope?" | Only user-selected directories via NSOpenPanel. Security-scoped bookmarks for persistence. |

### App Store Metadata

```
Category: Developer Tools
Subcategory: Developer Tools
Age Rating: 4+ (no restricted content)
Privacy: Collects no personal data. All data stored locally.
```

### Privacy Policy Requirements

Apple requires a privacy policy URL. Content:

```
Flightdeck stores all data locally on your machine:
- SQLite database in the app's container directory
- Configuration files in the app's container directory
- Project files in user-selected directories only

Flightdeck does not:
- Collect personal information
- Send analytics or telemetry
- Transmit data to external servers
- Access contacts, photos, location, or health data

AI agent communication is handled by third-party CLI tools
(GitHub Copilot, Google Gemini, etc.) under their own privacy policies.
```

---

## Testing the Sandbox

### Local Testing

```bash
# Build MAS version locally
cd packages/desktop
npx electron-builder --mac --target mas-dev

# The mas-dev target creates a sandbox-enabled app without
# requiring a real provisioning profile. It uses a development
# signing identity.
```

### Sandbox Violation Detection

Enable sandbox violation logging during development:

```bash
# In Terminal, before launching the app:
export CFLOG_FORCE_STDERR=1
log stream --predicate 'subsystem == "com.apple.sandbox"' --level debug
```

This shows real-time sandbox violations, helping identify code paths that need
the bridge.

### Checklist Before MAS Submission

- [ ] App launches and renders without sandbox violations
- [ ] Bridge helper is NOT required for basic UI browsing
- [ ] Without bridge: app shows clear "install bridge" instructions
- [ ] With bridge: all 6 provider adapters can spawn agents
- [ ] Git operations work through bridge
- [ ] SQLite operations work in container directory
- [ ] Security-scoped bookmarks persist across app restart
- [ ] File picker grants access to selected project directory
- [ ] Auto-update is disabled in MAS build (`process.mas` check)
- [ ] All entitlements are minimal and justified
- [ ] Privacy policy URL is accessible
- [ ] App metadata and screenshots are ready
