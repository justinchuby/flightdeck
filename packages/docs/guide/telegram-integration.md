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

### Configuration Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable the Telegram integration |
| `botToken` | string | `""` | Bot API token from BotFather |
| `allowedChatIds` | string[] | `[]` | Chat IDs allowed to interact (empty = deny all) |
| `rateLimitPerMinute` | number | `20` | Max messages per user per minute (1-120) |

## Bot Commands

Once configured, the bot responds to these commands:

| Command | Description |
|---------|-------------|
| `/status` | Show active projects and agent counts |
| `/projects` | List all projects |
| `/agents` | List running agents |
| `/help` | Show available commands |

You can also send free-text messages to interact with your project lead.

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

Critical events (crashes, decisions needing approval) bypass batching and are delivered immediately.

### Notification Batching

To avoid flooding your chat, related events are grouped into batches:

- **5-second debounce window** — events within 5 seconds are combined into a single message
- **Per-project batching** — events for different projects are batched separately
- **Category filtering** — subscribe to specific event types per project
- **4096-char limit** — messages are truncated to fit Telegram's limit

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

## Architecture

The Telegram integration uses a 3-layer architecture:

```
TelegramAdapter (Layer 1: Transport)
  └→ IntegrationRouter (Layer 2: Routing & Session Binding)
       └→ NotificationBatcher (Layer 3: Event Aggregation & Delivery)
```

### Layer 1: TelegramAdapter

Thin transport wrapper around the [grammY](https://grammy.dev/) bot library:

- Uses **long polling** — no webhook or public URL needed
- Lazy-imports grammY on first use (not a hard dependency)
- Handles **retry queue** — failed messages retry up to 3 times with 5-minute TTL
- **Rate limiting** per user (configurable, default 20/min)
- **Chat allowlist** enforcement with user notification on rejection
- Bot token is **never logged** — automatically sanitized from error messages

### Layer 2: IntegrationRouter

Routes messages between Telegram chats and Flightdeck projects:

- **Session binding** — maps chat IDs to project IDs (1-hour TTL)
- **Command registration** — `/status`, `/projects`, `/agents` handlers
- **Inbound message routing** — forwards user messages to the bound project's lead agent
- Platform-agnostic — designed to support Slack and Discord adapters in the future

### Layer 3: NotificationBatcher

Subscribes to AgentManager events and delivers batched notifications:

- Wires into `agent:spawned`, `agent:exit`, `agent:crashed`, `lead:decision`, `agent:completion_reported`
- **Per-project event queues** with independent flush timers
- Integrates with NotificationService for **preference-based filtering**
- Formats events into human-readable messages

## Security

- **Allowlist enforcement**: Only chat IDs listed in `allowedChatIds` can interact with the bot. Empty list = deny all (secure default).
- **Rate limiting**: Prevents abuse with per-user message rate limits.
- **Token sanitization**: Bot tokens are automatically stripped from all error messages and logs.
- **Graceful degradation**: If grammY is not installed, the integration silently disables itself.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Bot doesn't respond | Check `enabled: true` and `botToken` is set. Check `allowedChatIds` includes your chat. |
| "Not authorized" reply | Add your chat ID to `allowedChatIds` in config. |
| Missing notifications | Verify the project has an active session. Check category filters. |
| 409 Conflict errors | Transient after restart — the old polling connection clears in ~30 seconds. |
| Rate limit hit | Reduce message frequency or increase `rateLimitPerMinute` (max 120). |
