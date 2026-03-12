# Deployment Guide

This guide covers deploying Flightdeck in production. For local development, see the [Quick Start](/guide/) in the README.

## Prerequisites

- **Node.js 20+** — Required for the server and build tools
- **npm 10+** — For dependency management
- **At least one CLI provider** — Install one of: [Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli), [Claude Code](https://docs.anthropic.com/en/docs/agents/claude-code), Gemini CLI, OpenCode, Cursor, or Codex

### Provider-Specific

- **@zed-industries/claude-agent-acp** — Required for the Claude provider. Install globally: `npm install -g @zed-industries/claude-agent-acp`

## Quick Start (Single Machine)

```bash
# Install globally
npm install -g @flightdeck-ai/flightdeck

# Start with defaults (port 3000, localhost only)
flightdeck

# Or with options
flightdeck --port=4000 --host=0.0.0.0 --no-browser
```

This starts the orchestration server as a single process. Agents run in-process via the AcpAdapter.

## Configuration

### Config File

Flightdeck looks for configuration in this order (later overrides earlier):

1. `~/.flightdeck/config.yaml` — User-level defaults (auto-created on first run)
2. `flightdeck.config.yaml` — Project-level overrides in your repo root
3. `FLIGHTDECK_CONFIG` env var — Explicit path to a specific config file

Create `flightdeck.config.yaml` in your project root to override defaults:

```yaml
server:
  maxConcurrentAgents: 50  # 1-200, default: 50

provider:
  id: copilot  # Active CLI provider

models:
  known:
    - claude-opus-4.6
    - gpt-5.2
    - gemini-3-pro-preview
  defaults:
    developer: [claude-opus-4.6]
    architect: [claude-opus-4.6]
    code-reviewer: [gemini-3-pro-preview]

budget:
  limit: null  # null = unlimited, or dollar amount
  thresholds:
    warning: 0.7
    critical: 0.9
    pause: 1.0

heartbeat:
  idleThresholdMs: 60000
  crewUpdateIntervalMs: 180000
```

See `flightdeck.config.example.yaml` for the full annotated config. The directory and default config file are auto-created on first run.

### Runtime Files

All runtime files are stored in `~/.flightdeck/` (or `FLIGHTDECK_STATE_DIR`):

```
~/.flightdeck/
  config.yaml                 # User-level config (auto-created)
  flightdeck.db               # SQLite database
  artifacts/                  # Agent work artifacts
    {projectId}/
      sessions/
        {leadId}/
          {role}-{shortId}/   # Per-agent artifact directory
```

All paths use `path.join()` and `os.homedir()` for cross-platform compatibility. Temporary files use `os.tmpdir()`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FLIGHTDECK_PORT` | `3000` | HTTP server port |
| `FLIGHTDECK_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` for all interfaces) |
| `FLIGHTDECK_CONFIG` | `./flightdeck.config.yaml` | Path to config file |
| `FLIGHTDECK_STATE_DIR` | `~/.flightdeck` | State directory |
| `FLIGHTDECK_DB_PATH` | `~/.flightdeck/flightdeck.db` | SQLite database path |
| `AUTH` | (auto-generated) | Auth mode: `'none'` to disable, or env var name containing token |
| `SERVER_SECRET` | (auto-generated) | Fixed auth token (overrides random generation) |
| `LOG_ALL_HTTP` | `false` | Set to `true` to log all HTTP requests including successful GETs |

### Provider API Keys

Each CLI provider may need its own API key:

| Provider | Environment Variable | Notes |
|----------|---------------------|-------|
| Copilot | — | Uses `gh auth` (GitHub CLI login) |
| Claude | `ANTHROPIC_API_KEY` | Required for Claude Code |
| Gemini | `GEMINI_API_KEY` | Required for Gemini CLI |
| Codex | `OPENAI_API_KEY` | Required for Codex CLI |
| Cursor | `CURSOR_API_KEY` | Required for Cursor |
| OpenCode | — | No API key required |

### HTTP Request Logging

Flightdeck uses structured HTTP request logging via the `httpLogger` middleware.

**Default behavior (optimized for low noise):**

| Request type | Logged? |
|-------------|---------|
| GET with 2xx/3xx response | ❌ Suppressed (polling/status checks are noisy) |
| GET with 4xx/5xx response | ✅ Always logged (errors matter) |
| POST, PUT, DELETE, PATCH | ✅ Always logged (state-changing operations) |

Each log entry includes the HTTP method, path, status code, and response time in milliseconds. Entries are logged at the appropriate level: `info` for success, `warn` for 4xx, `error` for 5xx.

**To enable full logging** (including successful GET requests):

```bash
LOG_ALL_HTTP=true npm start
```

This is useful for debugging routing issues, slow endpoints, or understanding traffic patterns. Not recommended for production — GET polling generates significant log volume.

## Building from Source

```bash
git clone https://github.com/anthropics/flightdeck.git
cd flightdeck
npm install

# Build shared types first (required by server and web)
cd packages/shared && npx tsc && cd ../..

# Build all packages
npm run build

# Start production server
npm start
```

### Development Mode

```bash
npm run dev
```

This starts the server with hot-reload (`tsx --watch`) and the Vite dev server for the web client:

- **Server:** `http://localhost:3001`
- **Web UI:** `http://localhost:5173` (proxies API to server)

## Production Considerations

### Network Access

By default, Flightdeck binds to `127.0.0.1` (localhost only). To expose it on a network:

```bash
flightdeck --host=0.0.0.0 --port=4000
```

> **Warning:** Flightdeck does not provide TLS. Use a reverse proxy (nginx, Caddy) for HTTPS in production.

### Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name flightdeck.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;  # WebSocket keepalive
    }
}
```

The `Upgrade` and `Connection` headers are required for WebSocket support.

### Authentication

Flightdeck generates a random auth token on first start. The token is printed to the console and used for all API requests.

To set a fixed token:
```bash
SERVER_SECRET=your-secret-token flightdeck
```

To disable auth (development only):
```bash
AUTH=none flightdeck
```

### Database

Flightdeck uses SQLite with WAL mode. The database file defaults to `~/.flightdeck/flightdeck.db`.

For production:
- Place the database on fast local storage (SSD). SQLite is I/O-sensitive.
- Back up the database file periodically. SQLite WAL mode is safe for file-level backup when using `PRAGMA wal_checkpoint(PASSIVE)`.
- Set `FLIGHTDECK_DB_PATH` to control the database location.
- The database and all runtime files are stored in `~/.flightdeck/` by default — not in the repo root.

### Process Management

Use a process manager to keep Flightdeck running:

**systemd:**
```ini
[Unit]
Description=Flightdeck AI Orchestrator
After=network.target

[Service]
Type=simple
User=flightdeck
WorkingDirectory=/opt/flightdeck
ExecStart=/usr/bin/node packages/server/dist/index.js
Restart=on-failure
RestartSec=5
Environment=FLIGHTDECK_PORT=3000
Environment=FLIGHTDECK_HOST=0.0.0.0
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**PM2:**
```bash
pm2 start packages/server/dist/index.js --name flightdeck \
  --env FLIGHTDECK_PORT=3000 \
  --env NODE_ENV=production
```

> **Note:** Flightdeck runs as a single process. If you restart it via systemd/PM2, running agents will be terminated. Use session resume to pick up where you left off after a restart.

### Resource Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 1 GB | 4+ GB (scales with concurrent agents) |
| Disk | 1 GB | 10+ GB (database grows with activity) |
| Network | Stable connection | Low-latency to CLI provider APIs |

Each running agent spawns a CLI subprocess that consumes its own memory (~100-500 MB depending on the provider). Plan RAM accordingly for `maxConcurrentAgents`.

### Monitoring

Flightdeck provides built-in monitoring through the web UI:

- **AttentionBar** — System-wide health at a glance (green/yellow/red)
- **Token Economics** — Per-agent token usage tracking
- **Activity Log** — Full audit trail of agent actions

For external monitoring, check the health endpoint:
```bash
curl http://localhost:3000/api/health
```

## Troubleshooting

### Agents Fail to Spawn

1. Verify the CLI binary is installed and in PATH: `which copilot` (or `claude`, `gemini`, etc.)
2. Check provider API keys are set
3. Check `maxConcurrentAgents` hasn't been reached
4. Look at server logs for adapter error messages

### WebSocket Connection Drops

If the UI shows "Connection Lost":
1. Check the server is still running
2. If behind a reverse proxy, ensure WebSocket upgrade headers are forwarded
3. Check `proxy_read_timeout` is set high enough (WebSocket connections are long-lived)

### Database Locked

SQLite "database is locked" errors usually indicate concurrent access issues:
1. Ensure only one Flightdeck instance uses the database file
2. Check WAL mode is enabled: `sqlite3 flightdeck.db "PRAGMA journal_mode;"`
3. Increase busy timeout if needed (default: 5000ms)
