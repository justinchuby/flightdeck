# Telegram Integration

Flightdeck can send real-time notifications to Telegram and accept commands from a Telegram bot. This lets you monitor your AI crew from your phone without keeping the dashboard open.

## Setup

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token (looks like `123456:ABC-DEF...`)

### 2. Get Your Chat ID

1. Add your bot to a group chat, or start a DM with it
2. Send any message to the bot
3. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in your browser
4. Find `"chat":{"id": ...}` in the response — that's your chat ID

### 3. Configure Flightdeck

Add the Telegram section to your `flightdeck.config.yaml`:

```yaml
telegram:
  enabled: true
  botToken: "123456:ABC-DEF..."     # Or use TELEGRAM_BOT_TOKEN env var
  allowedChatIds: ["YOUR_CHAT_ID"]  # Security: only these chats can interact
  rateLimitPerMinute: 20            # Per-user rate limit (1-120, default: 20)
```

> [!TIP] Use Environment Variables
> For security, set the bot token via environment variable instead of the config file:
> ```bash
> export TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."
> ```

You can also configure Telegram at runtime via the dashboard (**Settings → Telegram**) or the API (`PATCH /integrations/telegram`).

### Configuration Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable the Telegram integration |
| `botToken` | string | `""` | Bot API token from BotFather |
| `allowedChatIds` | string[] | `[]` | Chat IDs allowed to interact (empty = deny all) |
| `rateLimitPerMinute` | number | `20` | Max messages per user per minute (1–120) |
| `notifications.enabledCategories` | string[] | all | Which event types to deliver |
| `notifications.quietHours` | object | `null` | `{ enabled, startHour, endHour }` — suppress during these hours |

## Session Binding

Before Telegram can interact with a project, the chat must be **bound** to a project via a challenge-response flow. This prevents unauthorized access.

### Challenge-Response Flow

1. **Initiate** — From the dashboard or API, request binding:
   ```
   POST /integrations/sessions
   { "chatId": "12345", "platform": "telegram", "projectId": "proj-abc" }
   ```
   Flightdeck generates a random 6-digit code and sends it to the Telegram chat.

2. **Verify** — The user reads the code from Telegram and submits it:
   ```
   POST /integrations/sessions/verify
   { "chatId": "12345", "code": "847291" }
   ```
   On success, a session is created (8-hour TTL, auto-refreshed on access).

3. **Active** — The chat is now bound to the project. Messages route to the project lead, and notifications flow to the chat.

### Security

- **Rate-limited**: Max 5 verification attempts per minute per chat ID
- **Expiry**: Challenge codes expire after 5 minutes
- **Wrong code**: Returns `403 Forbidden`
- **Session TTL**: 8 hours, auto-refreshed on activity

## Bot Commands

Once configured, the bot responds to these commands:

| Command | Description |
|---------|-------------|
| `/status` | Show active projects and agent counts |
| `/projects` | List all projects |
| `/agents` | List running agents |
| `/help` | Show available commands |

Free-text messages are forwarded to the bound project's lead agent as user input.

## Notifications

The bot sends notifications for key events during a session:

| Event | Category | Delivery |
|-------|----------|----------|
| Agent spawned | `agent_spawned` | Batched (5s window) |
| Agent exited | `agent_completed` | Batched |
| Agent crashed | `agent_crashed` | **Immediate** |
| Task completed | `task_completed` | Batched |
| Decision recorded | `decision_recorded` | Batched |
| Decision needs approval | `decision_needs_approval` | **Immediate** |
| System alert | `system_alert` | **Immediate** |

Critical events (crashes, decisions needing approval, system alerts) bypass batching and are delivered immediately.

### Notification Subscriptions

Subscribe a chat to specific notification categories per project:

```
POST /integrations/subscriptions
{ "chatId": "12345", "projectId": "proj-abc", "categories": ["agent_crashed", "decision_needs_approval"] }
```

Omit `categories` to subscribe to all event types. An active session must exist for the chat-project pair.

### Notification Batching

To avoid flooding your chat, related events are grouped:

- **5-second debounce window** — events within 5 seconds are combined
- **Per-project batching** — events for different projects batch separately
- **4,096-char limit** — messages truncated to fit Telegram's limit with `… (truncated)` suffix

Single events are formatted as:

```
Agent spawned: developer
developer (a1b2c3d4) joined the project.
```

Batched events appear as:

```
📋 3 updates:
• Agent spawned: developer
• Agent spawned: code-reviewer
• Task completed by a1b2c3d4
```

### Quiet Hours

Suppress non-critical notifications during specified hours:

```yaml
telegram:
  notifications:
    quietHours:
      enabled: true
      startHour: 22   # 10 PM
      endHour: 8       # 8 AM
```

Critical events (`agent_crashed`, `decision_needs_approval`) always deliver regardless of quiet hours.

## Dashboard Settings

The **Settings → Telegram** panel provides a visual interface for all configuration:

- Toggle enable/disable
- Paste bot token (masked by default)
- Manage allowlist (add/remove chat IDs)
- Set rate limit per minute
- Select notification categories (critical ones can't be disabled)
- Configure quiet hours
- Test connection button
- Real-time status indicators (enabled/running/error)

## Architecture

The integration uses a 3-layer architecture:

```
TelegramAdapter (Layer 1: Transport)
  └→ IntegrationRouter (Layer 2: Routing & Session Binding)
       └→ NotificationBatcher (Layer 3: Event Aggregation & Delivery)
```

### Layer 1: TelegramAdapter

Thin transport wrapper around the [grammY](https://grammy.dev/) bot library:

- Uses **long polling** — no webhook or public URL needed
- Lazy-imports grammY on first use (not a hard dependency)
- **Retry queue** — failed messages retry up to 3 times with 5-minute TTL
- **Rate limiting** per Telegram user ID (configurable, default 20/min)
- **Chat allowlist** enforcement with rejection message
- Bot token is **never logged** — automatically sanitized from errors

### Layer 2: IntegrationRouter

Routes messages between Telegram chats and Flightdeck projects:

- **Session binding** — maps chat IDs to project IDs with TTL
- **Challenge-response** — 6-digit code verification flow
- **Command registration** — `/status`, `/projects`, `/agents` handlers
- **Inbound routing** — forwards user messages to the bound project's lead agent
- Platform-agnostic design — supports future Slack/Discord adapters

### Layer 3: NotificationBatcher

Subscribes to `AgentManager` events and delivers batched notifications:

- Wires into `agent:spawned`, `agent:exit`, `agent:crashed`, `lead:decision`, `agent:completion_reported`
- **Per-project event queues** with independent flush timers
- Integrates with `NotificationService` for preference-based filtering
- Formats events into human-readable messages

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/integrations/status` | GET | Bot status, active sessions, pending notifications |
| `/integrations/sessions` | GET | List active sessions |
| `/integrations/sessions` | POST | Initiate challenge-response binding |
| `/integrations/sessions/verify` | POST | Complete verification |
| `/integrations/subscriptions` | GET | List subscriptions |
| `/integrations/subscriptions` | POST | Subscribe to notifications |
| `/integrations/subscriptions` | DELETE | Unsubscribe |
| `/integrations/test-message` | POST | Send test message |
| `/integrations/telegram` | PATCH | Update Telegram config |

All endpoints are rate-limited at 60 requests per minute.

## Security

- **Allowlist enforcement**: Only chat IDs in `allowedChatIds` can interact. Empty list = deny all (secure default).
- **Challenge-response binding**: Chats must verify a code before receiving data.
- **Rate limiting**: Per-user message limits prevent abuse.
- **Token sanitization**: Bot tokens are stripped from all error messages and logs.
- **Session expiry**: Bindings auto-expire after 8 hours of inactivity.
- **Graceful degradation**: If grammY is not installed, the integration silently disables.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Bot doesn't respond | Check `enabled: true` and `botToken` is set. Verify `allowedChatIds` includes your chat. |
| "Not authorized" reply | Add your chat ID to `allowedChatIds`. |
| Missing notifications | Verify the project has an active session and the chat is bound to it. Check category filters. |
| 409 Conflict errors | Transient after restart — the old polling connection clears in ~30 seconds. |
| Rate limit hit | Reduce message frequency or increase `rateLimitPerMinute` (max 120). |
| Challenge code expired | Codes are valid for 5 minutes. Re-initiate the binding flow. |
