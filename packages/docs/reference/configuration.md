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
| `DB_PATH` | `./ai-crew.db` | SQLite database path |
| `SERVER_SECRET` | *(auto-generated)* | Auth token for API access. If not set, a random token is generated at startup and printed to the console. |
| `AUTH` | `token` | Auth mode. Set to `none` to disable authentication (not recommended). |

## Security

### Authentication

The server uses bearer token authentication. On startup, if no `SERVER_SECRET` is set, a random base64url token is auto-generated and printed to the console. The token is also injected into the served web UI via `window.__AI_CREW_TOKEN__`, so users don't need to configure anything.

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

Agents request tool permissions (file writes, shell commands) during operation. The framework **auto-approves** all tool requests after a 60-second timeout. This is by design to enable autonomous team operation.

## Model Configuration

Models can be configured at three levels (highest priority first):

1. **Per-agent** — Set via `PATCH /api/agents/:id` or the dashboard model selector
2. **Per-role** — Set via custom role definition
3. **Built-in default** — Defined in `RoleRegistry` source code

## CLI Options

The `ai-crew` CLI (`bin/ai-crew.mjs`) supports:

| Flag | Description |
|------|-------------|
| `--port=XXXX` | Override the server port |
| `--no-browser` | Don't auto-open the browser on startup |
