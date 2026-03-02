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
| `HOST` | `127.0.0.1` | Server bind address |
| `DB_PATH` | `./flightdeck.db` | SQLite database path |
| `SERVER_SECRET` | *(auto-generated)* | Auth token for API access. If not set, a random token is generated at startup and printed to the console. |
| `AUTH` | `token` | Auth mode. Set to `none` to disable authentication (not recommended). |
| `COPILOT_CLI_PATH` | `copilot` | Path to the Copilot CLI binary. Override if your Copilot CLI is installed in a non-standard location. |
| `MAX_AGENTS` | `50` | Initial default for maximum concurrent agents at startup. Seeds the `maxConcurrent` setting in the database; not a hard upper bound (can be overridden via the Settings page or API). |

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

## Common Configurations

### Run on a custom port

```bash
flightdeck --port=4000
```

### Remote access via SSH tunneling

Flightdeck binds to `127.0.0.1` by default — all access is local. For remote access, use SSH tunneling to securely forward the port:

```bash
ssh -L 3001:localhost:3001 user@remote-host
```

Then open `http://localhost:3001` on your local machine. The connection is encrypted by SSH — no need to expose Flightdeck to the network.

### Run headless (no browser)

```bash
flightdeck --no-browser
```

### Use a fixed auth token

Set `SERVER_SECRET` so the token doesn't change across restarts — useful for scripts or API integrations:

```bash
SERVER_SECRET=my-stable-token flightdeck
```

### Increase agent concurrency

For large tasks that benefit from more parallel agents, update via the Settings page or API:

```bash
curl -X POST http://localhost:3001/api/settings \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"maxConcurrent": 20}'
```
