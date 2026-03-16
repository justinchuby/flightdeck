# Telegram Integration Setup Guide

Connect your Flightdeck server to Telegram so you can receive notifications, check agent status, and send messages to your AI crew — all from your phone.

## Overview

Flightdeck's Telegram integration is a **bidirectional bridge** between Telegram chats and your Flightdeck projects. It uses a 3-layer architecture:

| Layer | Component | Role |
|-------|-----------|------|
| Transport | **TelegramAdapter** | Connects to Telegram via long polling (no public URL needed) |
| Routing | **IntegrationRouter** | Maps chats to projects, handles auth and bot commands |
| Delivery | **NotificationBatcher** | Batches agent events into 5-second windows to reduce noise |

**What you can do:**

- 📲 Receive batched notifications when agents spawn, complete tasks, crash, or need decisions
- 💬 Send messages to your project's lead agent directly from Telegram
- 📊 Check project status, agent lists, and progress with bot commands
- 🔒 Control access with chat allowlists and challenge-response authentication

---

## Prerequisites

- A running Flightdeck server
- A Telegram account
- 5 minutes of setup time

---

## Step 1: Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a **display name** (e.g., "My Flightdeck Bot")
4. Choose a **username** (must end in `bot`, e.g., `my_flightdeck_bot`)
5. BotFather will reply with your **bot token** — it looks like:
   ```
   7123456789:AAF1k2j3h4g5f6d7s8a9-AbCdEfGhIjKlMn
   ```
6. **Save this token** — you'll need it in Step 2

> ⚠️ **Keep your bot token secret.** Anyone with the token can control your bot. If compromised, use `/revoke` in BotFather to generate a new one.

### Optional: Customize your bot

While in BotFather, you can also:
- `/setdescription` — set what users see when they start the bot
- `/setabouttext` — set the bot's profile bio
- `/setuserpic` — upload a profile picture

---

## Step 2: Configure the Bot Token

You have two options. The **environment variable** approach is recommended because it keeps secrets out of config files.

### Option A: Environment variable (recommended)

```bash
export TELEGRAM_BOT_TOKEN="7123456789:AAF1k2j3h4g5f6d7s8a9-AbCdEfGhIjKlMn"
```

Or add it to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) for persistence.

### Option B: Config file

Add the token to your `flightdeck.config.yaml`:

```yaml
telegram:
  botToken: "7123456789:AAF1k2j3h4g5f6d7s8a9-AbCdEfGhIjKlMn"
```

> **Priority:** The `TELEGRAM_BOT_TOKEN` environment variable takes precedence over `telegram.botToken` in the config file. If both are set, the env var wins.

---

## Step 3: Find Your Chat ID

Telegram identifies chats by numeric IDs. You'll need your chat ID to configure the allowlist.

### For private chats (DMs with your bot)

1. Start a conversation with your bot in Telegram (search for its username and press "Start")
2. Send any message (e.g., "hello")
3. Open this URL in your browser, replacing `<TOKEN>` with your bot token:
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
4. Look for `"chat":{"id":123456789}` in the JSON response — that number is your chat ID

### For group chats

1. Add your bot to the group
2. Send a message in the group
3. Use the same `getUpdates` URL above
4. Group chat IDs are **negative numbers** (e.g., `-1001234567890`)

---

## Step 4: Configure Allowed Chats

By default, the bot **denies all chats** (empty allowlist = deny all). This is a security measure to prevent unauthorized access to your Flightdeck instance.

Add your chat ID(s) to the config:

```yaml
telegram:
  enabled: false
  allowedChatIds:
    - "123456789"        # Your personal chat ID
    - "-1001234567890"   # A group chat (optional)
```

You can also manage this from the **Settings → Telegram** panel in the Flightdeck UI.

---

## Step 5: Enable the Integration

Telegram is **disabled by default** and requires manual enablement each time the server starts. This is intentional — it prevents accidental bot connections.

### Via the Flightdeck UI (recommended)

1. Open Flightdeck in your browser
2. Go to **Settings** → **Telegram** tab
3. Enter your bot token (or confirm the env var is detected)
4. Add your allowed chat IDs
5. Toggle **Enable** to on
6. Click **Test Connection** to verify

### Via the REST API

```bash
curl -X PATCH http://localhost:3001/api/integrations/telegram \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "botToken": "7123456789:...",
    "allowedChatIds": ["123456789"]
  }'
```

---

## Step 6: Bind a Chat to a Project

Before you can send messages to a project's lead agent, you need to **bind** your Telegram chat to a specific Flightdeck project. This uses a challenge-response flow for security.

### Via the Flightdeck UI

1. Go to **Settings** → **Telegram**
2. Under **Sessions**, select a project and click **Bind Chat**
3. A 6-digit verification code appears in your Telegram chat
4. Enter the code in the Flightdeck UI
5. The chat is now bound to that project for **8 hours**

### Via the REST API

```bash
# Step 1: Initiate challenge (sends code to Telegram chat)
curl -X POST http://localhost:3001/api/integrations/sessions \
  -H "Content-Type: application/json" \
  -d '{"chatId": "123456789", "platform": "telegram", "projectId": "my-project"}'

# Step 2: Verify the code from Telegram
curl -X POST http://localhost:3001/api/integrations/sessions/verify \
  -H "Content-Type: application/json" \
  -d '{"chatId": "123456789", "code": "847293"}'
```

> Sessions expire after 8 hours. To rebind, repeat the challenge-response flow.

---

## Bot Commands

Once connected, you can use these commands in your Telegram chat:

| Command | Description |
|---------|-------------|
| `/status` | Show active projects with agent counts (running/total) |
| `/projects` | List all projects (up to 20) with their current status |
| `/agents` | List active agents with status indicators (🟢 running, 🟡 idle, ⚪ stopped) |
| `/help` | Show available commands |

### Sending Messages to Your Lead Agent

After binding a chat to a project (Step 6), simply type a message in Telegram — it will be routed to that project's lead agent. The lead can reply using the `TELEGRAM_REPLY` command, and you'll see the response in your chat.

### Long Messages

Telegram limits messages to 4,096 characters. When Flightdeck needs to send a longer message (e.g., a detailed status report or agent output), it automatically splits the content into multiple numbered parts:

```
Here's the full status report for your project...
(content continues)
 (1/3)
```
```
...remaining content...
 (2/3)
```

Splitting respects markdown boundaries — it won't break inside code blocks, and prefers to split at paragraph or line boundaries for readability.

---

## Notification Categories

Flightdeck sends notifications for various events. You can enable or disable each category in the Settings UI or via the subscription API.

| Category | Description | Default |
|----------|-------------|---------|
| `decision_needs_approval` | Agent needs your approval on a decision | **Always on** (critical) |
| `agent_crashed` | An agent encountered a fatal error | **Always on** (critical) |
| `system_alert` | System-level alerts (budget exceeded, etc.) | **Always on** (critical) |
| `decision_recorded` | Agent recorded a decision (informational) | Optional |
| `task_completed` | A task in the DAG was completed | Optional |
| `agent_spawned` | A new agent was created | Optional |
| `agent_completed` | An agent finished its work | Optional |

### Quiet Hours

You can configure quiet hours to suppress non-critical notifications during off-hours:

```yaml
# Via the Settings UI: Settings → Telegram → Quiet Hours
# Enable quiet hours, set start and end times (24-hour format)
```

During quiet hours, only **critical** notifications (`decision_needs_approval`, `agent_crashed`, `system_alert`) are delivered. Others are held until quiet hours end.

---

## Configuration Reference

Full `telegram` section for `flightdeck.config.yaml`:

```yaml
telegram:
  enabled: false              # Must be enabled each server start (security)
  botToken: ""                # Prefer TELEGRAM_BOT_TOKEN env var
  allowedChatIds: []          # Chat IDs allowed to interact; empty = deny all
  rateLimitPerMinute: 20      # Max inbound messages per user per minute (1-120)
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Whether the Telegram bot connects on enablement |
| `botToken` | string | `""` | Bot API token from BotFather (env var preferred) |
| `allowedChatIds` | string[] | `[]` | Allowlisted Telegram chat IDs; empty = deny all |
| `rateLimitPerMinute` | number | `20` | Inbound rate limit per user (range: 1–120) |

> **Hot reload:** Changes to the `telegram` section in `flightdeck.config.yaml` are picked up automatically — no server restart needed. The bot will reconnect with the updated configuration.

---

## REST API Reference

All endpoints are under `/api/integrations/`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/status` | Adapter state, active sessions, pending notifications |
| `PATCH` | `/telegram` | Update Telegram config (enable, token, allowlist, rate limit) |
| `POST` | `/sessions` | Initiate challenge-response session binding |
| `POST` | `/sessions/verify` | Complete challenge verification |
| `GET` | `/sessions` | List all active chat-to-project sessions |
| `POST` | `/subscriptions` | Subscribe a chat to project notifications |
| `DELETE` | `/subscriptions` | Unsubscribe from project notifications |
| `GET` | `/subscriptions` | List all notification subscriptions |
| `POST` | `/test-message` | Send a test message to verify connectivity |

---

## Agent Commands

Agents can interact with Telegram programmatically using these commands:

| Command | Description |
|---------|-------------|
| `TELEGRAM_REPLY {"messageId": "...", "content": "..."}` | Reply to a specific inbound message |
| `TELEGRAM_SEND {"content": "..."}` | Send a proactive message to the bound project chat |

These commands are emitted by lead agents in their text output and are parsed by the Flightdeck command system.

---

## Troubleshooting

### Bot not connecting

1. **Check the token** — Ensure `TELEGRAM_BOT_TOKEN` is set or `telegram.botToken` is correct in your config
2. **Check enabled status** — Telegram must be explicitly enabled each server start
3. **Check server logs** — Look for `module: 'telegram'` entries
4. **409 Conflict errors** — These are transient and self-resolving. They occur when two bot instances compete for the same token. Wait 30 seconds or restart.

### Messages not being delivered

1. **Check allowlist** — Your chat ID must be in `allowedChatIds`. An empty list denies all chats.
2. **Check rate limiting** — If you're sending too many messages, the bot rate-limits you (default: 20/minute)
3. **Check session binding** — Use `/status` to see if your chat is bound to a project

### Challenge code not arriving

1. **Start a conversation first** — You must send at least one message to your bot before it can message you
2. **Check allowed chat IDs** — The chat must be in the allowlist
3. **Check bot token** — An invalid token prevents all communication

### Notifications not appearing

1. **Check subscription** — Use `GET /api/integrations/subscriptions` to verify your chat is subscribed
2. **Check quiet hours** — Non-critical notifications are held during quiet hours
3. **Check notification categories** — Ensure the event category is enabled in your subscription

---

## Security Model

Flightdeck's Telegram integration uses defense-in-depth:

| Layer | Protection |
|-------|------------|
| **Allowlist** | Only pre-approved chat IDs can interact with the bot |
| **Challenge-response** | Session binding requires a verified 6-digit code |
| **Rate limiting** | Brute-force protection (5 verification attempts/min, 20 messages/min) |
| **Input sanitization** | 4-layer defense: control chars, XML tags, injection patterns, length truncation |
| **Token sanitization** | Bot token is scrubbed from all error logs |
| **Structured payloads** | User messages are sent to agents as structured JSON, preventing prompt injection |
| **Session TTL** | Chat-to-project bindings expire after 8 hours |

---

## Architecture Diagram

```
Inbound (Telegram → Flightdeck):
  Telegram → grammY (long polling) → TelegramAdapter → IntegrationRouter → AgentManager → Lead Agent

Outbound (Flightdeck → Telegram):
  AgentManager events → NotificationBatcher (5s batching) → IntegrationRouter → TelegramAdapter → Telegram API

Agent replies:
  Lead Agent → TELEGRAM_REPLY command → IntegrationRouter → TelegramAdapter → Telegram
```

---

## Related Documentation

- [Messaging Integration Design](../design/messaging-integration.md) — Full architecture and design decisions
- [Configuration Quick Reference](../reference/CONFIG_QUICK_REFERENCE.md) — All config options
- [Configuration System Spec](../reference/CONFIG_SYSTEM_SPEC.md) — How hot-reload works
