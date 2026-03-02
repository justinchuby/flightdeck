# Configuration

## Server Configuration

Configuration is stored in the `settings` SQLite table and can be updated via the API or Settings page.

### Settings

| Key | Default | Description |
|-----|---------|-------------|
| `maxConcurrent` | `10` | Maximum concurrent agents (includes idle agents) |
| `autoRestart` | `true` | Auto-restart crashed agents |
| `maxRestarts` | `3` | Max restart attempts per agent |
| `autoKillTimeoutMs` | `null` | Auto-terminate hung agents after this many ms |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `HOST` | `localhost` | Server host |
| `DB_PATH` | `./flightdeck.db` | SQLite database path |
| `SERVER_SECRET` | *(auto-generated)* | Auth token for API access. If not set, a random token is generated at startup and printed to the console. |
| `AUTH` | `token` | Auth mode. Set to `none` to disable authentication (not recommended). |
| `COPILOT_CLI_PATH` | `copilot` | Path to the Copilot CLI binary. Override if your Copilot CLI is installed in a non-standard location. |
| `MAX_AGENTS` | `50` | Hard maximum number of agents that can be spawned regardless of `maxConcurrent` setting. |

## Security

### Authentication

The server uses bearer token authentication. On startup, if no `SERVER_SECRET` is set, a random base64url token is auto-generated and printed to the console. The token is also injected into the served web UI via `window.__FLIGHTDECK_TOKEN__`, so users don't need to configure anything.

### CORS

CORS is locked to localhost origins only (`http://localhost:*` and `http://127.0.0.1:*`). All other origins are rejected.

### Security Headers

The server sets these headers on all responses:

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

### Rate Limiting

Expensive endpoints are rate-limited with an in-memory limiter:

| Endpoint | Window | Max Requests |
|----------|--------|-------------|
| Spawn/start endpoints | 60 seconds | 30 |
| Message endpoints | 10 seconds | 50 |

### Path Validation

File lock paths are validated against directory traversal attacks (`..`, absolute paths). Zod schemas enforce this at the API boundary.

## Tool Permissions

Agents request tool permissions (file writes, shell commands) during operation. Permission timeout behavior depends on the agent's autopilot mode:
- **Autopilot ON** (lead-spawned or user-enabled): tool calls are auto-approved immediately — no user interaction needed
- **Autopilot OFF** (manually spawned): tool calls are shown in a permission dialog; if the user doesn't respond within 60 seconds, the tool call is **auto-denied** (cancelled) for safety

## Model Configuration

Models can be configured at three levels (highest priority first):

1. **Per-agent** — Set via `PATCH /api/agents/:id` or the dashboard model selector
2. **Per-role** — Set via custom role definition
3. **Built-in default** — Defined in `RoleRegistry` source code

## CLI Options

The `flightdeck` CLI (`bin/flightdeck.mjs`) supports:

| Flag | Description |
|------|-------------|
| `--port=XXXX` | Override the server port |
| `--host=ADDR` | Bind address (default: `127.0.0.1`, or `HOST` env var) |
| `--no-browser` | Don't auto-open the browser on startup |
| `-v` / `--version` | Print version and exit |
| `-h` / `--help` | Print help and exit |
