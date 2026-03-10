# Messaging Integration: Telegram + Slack

> Design doc for connecting Flightdeck to external messaging platforms via a receptionist agent pattern.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Integration Agent (Receptionist)](#integration-agent-receptionist)
4. [Telegram Bot](#telegram-bot)
5. [Slack App](#slack-app)
6. [Message Routing](#message-routing)
7. [Notification Preferences](#notification-preferences)
8. [Security](#security)
9. [Configuration](#configuration)
10. [API Design](#api-design)
11. [Implementation Plan](#implementation-plan)
12. [Open Questions](#open-questions)

---

## Overview

### Problem

Users want to interact with their AI crews from mobile — checking status, answering agent questions, giving feedback — without opening the Flightdeck web UI. The dashboard's "Needs Your Attention" queue (see [project-centric-ui.md](./project-centric-ui.md)) is the core data source: items that require human input should also be pushable to Telegram/Slack.

### Key Principles

1. **Integration agent as receptionist** — a dedicated agent handles all external messaging routing, not the platform adapters directly
2. **Bidirectional** — user → lead (questions, feedback, task creation) AND lead → user (decisions, questions, progress)
3. **Multi-project routing** — when user has multiple active projects, the integration routes to the correct lead
4. **Platform-agnostic core** — shared routing logic, platform-specific only at the transport edge
5. **Fail-safe** — if messaging is down, the web UI still works. If the web UI is down, messaging still works.

### Reference

OpenClaw's Telegram integration (grammY, long polling, per-chat sessions, mention gating) is the reference implementation. Key patterns borrowed:
- Bot token from config/env
- Long polling as default (simpler than webhooks for self-hosted)
- Per-chat session isolation
- DM policy (allowlist mode for security)
- Graceful degradation

---

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Flightdeck Server                       │
│                                                             │
│  ┌──────────┐    ┌─────────────────────┐    ┌───────────┐ │
│  │ Telegram  │───▶│                     │───▶│ Agent     │ │
│  │ Adapter   │◀───│  Integration Agent  │◀───│ Manager   │ │
│  └──────────┘    │  (Receptionist)      │    └───────────┘ │
│                  │                     │                    │
│  ┌──────────┐    │  • Routes messages   │    ┌───────────┐ │
│  │ Slack    │───▶│  • Formats responses │───▶│ Lead      │ │
│  │ Adapter  │◀───│  • Project selection  │◀───│ Agents    │ │
│  └──────────┘    │  • Notification queue │    └───────────┘ │
│                  └─────────────────────┘                    │
│                           │                                 │
│                  ┌────────▼────────┐                       │
│                  │ Notification    │                       │
│                  │ Manager         │                       │
│                  └─────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Role |
|-----------|------|
| **TelegramAdapter** | Platform transport: bot API, message formatting, media, buttons |
| **SlackAdapter** | Platform transport: Slack events API, Block Kit formatting, interactive messages |
| **IntegrationAgent** | Brain: routes messages to correct project/lead, formats responses, manages context |
| **NotificationManager** | Decides what gets pushed externally vs stays in UI (existing, extended) |
| **AgentManager** | Existing: sends messages to lead agents, receives agent events |

### Process Model

The integration agent runs **inside the orchestrator process** (not in the agent server). Rationale:
- It needs direct access to `AgentManager` for message routing
- It needs `NotificationManager` for preference-based filtering
- It doesn't run LLM inference — it's a deterministic router with optional LLM fallback for ambiguous messages
- No subprocess lifecycle complexity

The platform adapters (Telegram/Slack) also run in-process, maintaining persistent connections (long polling for Telegram, WebSocket for Slack).

---

## Integration Agent (Receptionist)

### Design

The integration agent is NOT a regular LLM-powered agent. It's a **deterministic message router** with an LLM fallback for disambiguation.

```typescript
interface IntegrationAgent {
  // Inbound: external message → route to correct lead
  handleInbound(message: InboundMessage): Promise<RoutingResult>;
  
  // Outbound: agent event → format for external platform
  handleOutbound(event: AgentEvent, platform: Platform): Promise<OutboundMessage | null>;
  
  // Project selection: resolve ambiguous routing
  resolveProject(userId: string, hint?: string): Promise<ProjectSelection>;
}

interface InboundMessage {
  platform: 'telegram' | 'slack';
  userId: string;           // Platform user ID
  chatId: string;           // Platform chat/channel ID
  text: string;
  replyTo?: string;         // If replying to a bot message (carries context)
  attachments?: Attachment[];
}

interface RoutingResult {
  projectId: string;
  leadAgentId: string;
  action: 'message' | 'feedback' | 'command';
  content: string;
  taskId?: string;          // If feedback on a specific task
}
```

### Routing Logic (Deterministic)

```
1. Check reply context
   └─ If user is replying to a bot message → extract projectId from message metadata
   └─ Route to that project's lead

2. Check user's active project binding
   └─ If user has exactly 1 active project → route there
   └─ If user has set a "current project" → route there

3. Check for project prefix
   └─ If message starts with "[project-name]" or "/project name" → route there

4. Ambiguous → prompt for selection
   └─ Send inline buttons: one per active project
   └─ User taps → set as current project + route message
   └─ Remember selection for 1 hour (session binding)

5. No active projects → inform user
   └─ "No active projects. Start a crew from the Flightdeck UI."
```

### Command Handling

Users can send commands from Telegram/Slack:

| Command | Action | Equivalent |
|---------|--------|------------|
| `/status` | Show all active projects + agent counts | Dashboard view |
| `/status <project>` | Show project details + task progress | Project overview |
| `/tasks` | Show Kanban summary for current project | Tasks tab |
| `/approve <id>` | Approve a pending decision | Decision approve button |
| `/reject <id>` | Reject a pending decision | Decision reject button |
| `/feedback <task> <text>` | Send feedback on a task | Kanban feedback button |
| `/project <name>` | Switch current project context | Project navigation |
| `/help` | Show available commands | — |
| `/mute` / `/unmute` | Toggle notifications | Notification preferences |
| `/mute <duration>` | Mute for N hours | Quiet hours |

Commands are parsed first; freeform text is routed as a message to the lead agent.

### Outbound Formatting

When the integration agent receives events from the system, it formats them for the target platform:

```typescript
function formatForTelegram(event: AgentEvent): TelegramMessage {
  switch (event.type) {
    case 'agent:permission_request':
      return {
        text: `❓ *${event.agentRole}* asks:\n${event.question}`,
        reply_markup: {
          inline_keyboard: [[
            { text: '💬 Reply', callback_data: `reply:${event.agentId}:${event.requestId}` }
          ]]
        },
        parse_mode: 'Markdown'
      };
    
    case 'lead:decision':
      return {
        text: `⚖️ *Decision needed* (${event.projectName}):\n${event.description}`,
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: `approve:${event.decisionId}` },
            { text: '❌ Reject', callback_data: `reject:${event.decisionId}` },
            { text: '💬 Discuss', callback_data: `discuss:${event.decisionId}` }
          ]]
        }
      };
    
    case 'dag:task_completed':
      return { text: `✅ Task completed: *${event.taskTitle}*\nby ${event.agentRole}` };
    
    case 'agent:crashed':
      return { text: `🔴 Agent *${event.agentRole}* crashed: ${event.error}` };
  }
}
```

---

## Telegram Bot

### Setup Flow

1. **Create bot via BotFather:**
   - User messages @BotFather → `/newbot` → gets bot token
   - User enters token in Flightdeck Settings → Integrations → Telegram

2. **Bot configuration:**
   ```
   /setcommands via BotFather:
   status - Show project status
   tasks - Show task board
   approve - Approve a decision
   reject - Reject a decision
   feedback - Send task feedback
   project - Switch project context
   mute - Mute notifications
   unmute - Resume notifications
   help - Show commands
   ```

3. **Connection mode: Long polling (default)**
   - Simpler than webhooks — no public URL needed
   - Works behind NAT/firewall (common for self-hosted)
   - Uses grammY or Telegraf library for Bot API
   - Webhook mode available as option for lower latency

### TelegramAdapter

```typescript
class TelegramAdapter implements MessagingAdapter {
  constructor(
    private config: TelegramConfig,
    private integrationAgent: IntegrationAgent
  ) {}

  async start(): Promise<void> {
    this.bot = new Bot(this.config.botToken);  // grammY
    
    // Command handlers
    this.bot.command('status', (ctx) => this.handleStatus(ctx));
    this.bot.command('tasks', (ctx) => this.handleTasks(ctx));
    this.bot.command('approve', (ctx) => this.handleApprove(ctx));
    // ... other commands
    
    // Freeform message handler
    this.bot.on('message:text', (ctx) => this.handleMessage(ctx));
    
    // Callback query handler (inline button presses)
    this.bot.on('callback_query:data', (ctx) => this.handleCallback(ctx));
    
    // Start long polling
    await this.bot.start();
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  // Send outbound message to a Telegram chat
  async send(chatId: string, message: OutboundMessage): Promise<void> {
    await this.bot.api.sendMessage(chatId, message.text, {
      parse_mode: 'Markdown',
      reply_markup: message.replyMarkup,
    });
  }

  private async handleMessage(ctx: Context): Promise<void> {
    // Verify user is allowed
    if (!this.isAllowed(ctx.from.id)) {
      await ctx.reply('⛔ Not authorized. Contact the Flightdeck admin.');
      return;
    }

    const result = await this.integrationAgent.handleInbound({
      platform: 'telegram',
      userId: String(ctx.from.id),
      chatId: String(ctx.chat.id),
      text: ctx.message.text,
      replyTo: ctx.message.reply_to_message?.message_id
        ? this.getMessageContext(ctx.message.reply_to_message.message_id)
        : undefined,
    });

    if (result.action === 'select_project') {
      await ctx.reply('Which project?', {
        reply_markup: {
          inline_keyboard: result.projects.map(p => [{
            text: `📁 ${p.name} (${p.activeAgents} agents)`,
            callback_data: `project:${p.id}`
          }])
        }
      });
    }
  }
}
```

### Message Threading

- **DM conversations** are the primary mode (1:1 with bot)
- **Group mode** (optional): bot added to a Telegram group, responds to mentions
  - Group messages tagged with `[project-name]` prefix
  - Bot only responds when mentioned or when pushing notifications
- **Reply threading**: bot messages carry metadata (projectId, agentId) in callback_data
  - When user replies to a bot message, context is automatically recovered

### Rate Limiting

- Telegram rate limits: 30 messages/second globally, 1 message/second per chat
- TelegramAdapter queues outbound messages with per-chat throttling
- Batch: multiple rapid events → single summary message (debounce 5s)

---

## Slack App

### Setup Flow

1. **Create Slack App:**
   - User visits api.slack.com/apps → Create New App → From Manifest
   - Flightdeck generates a manifest YAML for the user to paste
   - User installs app to workspace → gets Bot Token + Signing Secret

2. **Slack App Manifest (generated by Flightdeck):**
   ```yaml
   display_information:
     name: Flightdeck
     description: AI crew management assistant
   features:
     bot_user:
       display_name: Flightdeck
       always_online: true
     slash_commands:
       - command: /fd
         url: <webhook_url>/api/integrations/slack/command
         description: Flightdeck commands
   oauth_config:
     scopes:
       bot:
         - chat:write
         - commands
         - im:history
         - im:read
         - im:write
         - users:read
   settings:
     event_subscriptions:
       request_url: <webhook_url>/api/integrations/slack/events
       bot_events:
         - message.im
     interactivity:
       is_enabled: true
       request_url: <webhook_url>/api/integrations/slack/interact
   ```

3. **Connection mode: Events API (webhook)**
   - Slack requires a publicly reachable URL for events
   - For self-hosted: user provides their public URL or uses a tunnel
   - Socket Mode available as alternative (no public URL needed, uses WebSocket)

### SlackAdapter

```typescript
class SlackAdapter implements MessagingAdapter {
  constructor(
    private config: SlackConfig,
    private integrationAgent: IntegrationAgent
  ) {}

  async start(): Promise<void> {
    if (this.config.socketMode) {
      // Socket Mode — no public URL needed
      this.app = new App({
        token: this.config.botToken,
        appToken: this.config.appToken,
        socketMode: true,
      });
    } else {
      // Events API — requires webhook routes
      // Routes registered externally via Express
    }
  }

  // Slack uses Block Kit for rich formatting
  async send(channelId: string, message: OutboundMessage): Promise<void> {
    await this.client.chat.postMessage({
      channel: channelId,
      blocks: this.formatBlocks(message),
      text: message.text,  // Fallback for notifications
    });
  }

  private formatBlocks(message: OutboundMessage): Block[] {
    // Convert OutboundMessage to Slack Block Kit
    if (message.type === 'decision') {
      return [
        { type: 'section', text: { type: 'mrkdwn', text: `⚖️ *Decision needed*\n${message.description}` } },
        { type: 'actions', elements: [
          { type: 'button', text: { type: 'plain_text', text: '✅ Approve' }, action_id: `approve:${message.decisionId}` },
          { type: 'button', text: { type: 'plain_text', text: '❌ Reject' }, action_id: `reject:${message.decisionId}`, style: 'danger' },
        ] },
      ];
    }
    return [{ type: 'section', text: { type: 'mrkdwn', text: message.text } }];
  }
}
```

### Slack-Specific Features

- **Threads**: Agent conversations use Slack threads to keep channels clean
- **Interactive messages**: Block Kit buttons for approve/reject/discuss
- **Slash command**: `/fd status`, `/fd tasks`, `/fd approve <id>`
- **Home tab**: Shows current project status (optional, uses App Home)
- **DM and channel modes**: DM for private interaction, channel for team visibility

---

## Message Routing

### Multi-Project/Multi-Lead UX

When a user has multiple active projects, the integration needs to route correctly:

```
User sends: "How's the auth module going?"

Integration Agent:
  1. Check reply context → none
  2. Check active binding → user has 2 projects: acme-app, billing
  3. No project prefix in message
  4. Ambiguous → send project selector

Bot replies:
  "Which project are you asking about?
   [📁 acme-app (3 agents)] [📁 billing (1 agent)]"

User taps: [📁 acme-app]

Bot:
  "Switched to acme-app ✓"
  → Routes "How's the auth module going?" to acme-app's lead agent

For next 1 hour, messages auto-route to acme-app unless user switches.
```

### Session Binding

```typescript
interface UserSession {
  userId: string;
  platform: 'telegram' | 'slack';
  currentProjectId: string | null;
  boundAt: number;             // timestamp
  bindingTtl: number;          // default: 3600000 (1 hour)
  chatId: string;              // platform-specific chat ID
}
```

- Stored in-memory (Map) — not persisted to DB (ephemeral by design)
- TTL-based expiry — after 1 hour of no messages, binding clears
- User can explicitly switch with `/project <name>` command
- Reply-to-message context always takes precedence over binding

### Inbound Flow

```
External Message → Platform Adapter → Integration Agent → Router
                                                            │
                                          ┌─────────────────┼─────────────────┐
                                          │                 │                 │
                                      Command           Message          Feedback
                                          │                 │                 │
                                     Parse + Execute   Route to Lead    Route to Task
                                          │                 │                 │
                                     Send response   agentManager       agentManager
                                      to platform    .queueMessage()   .queueMessage()
                                                    (POST /agents/:id  (with task context)
                                                     /message equiv)
```

### Outbound Flow

```
Agent Event → AgentManager EventEmitter → NotificationManager
                                               │
                                          Check preferences:
                                          Should this go external?
                                               │
                                          Integration Agent
                                               │
                                     Format for platform
                                               │
                                ┌──────────────┼──────────────┐
                                │                             │
                          TelegramAdapter              SlackAdapter
                          .send(chatId, msg)           .send(channelId, msg)
```

---

## Notification Preferences

### What Gets Pushed Externally

Not all agent events should go to Telegram/Slack. The `NotificationManager` (existing, 127 LOC) already has a preference system. We extend it:

| Event Category | Default External | Configurable |
|---------------|-----------------|--------------|
| Agent questions (needs answer) | ✅ Always push | No — these block work |
| Pending decisions | ✅ Always push | No — these block work |
| Task completed | ❌ UI only | Yes |
| Agent spawned/exited | ❌ UI only | Yes |
| Agent crashed | ✅ Always push | No — critical |
| Build failed | ✅ Push | Yes |
| Review request | ✅ Push | Yes |
| Progress update | ❌ UI only | Yes |
| Blocked task | ✅ Push | Yes |

### Preference Configuration

```yaml
# In flightdeck.config.yaml:
integrations:
  notifications:
    external:
      - agent_question        # Always
      - pending_decision      # Always
      - agent_crashed         # Always
      - blocked_task          # Enabled by default
      - review_request        # Enabled by default
    quietHours:
      start: "22:00"         # No pushes between 10 PM and 8 AM
      end: "08:00"
      timezone: "America/New_York"
    batchWindow: 5000         # Batch rapid events into single message (5s)
```

### Batching

Rapid events (e.g., 5 agents spawned in 2 seconds) are batched:

```
Instead of 5 messages:
  "🟢 developer spawned (acme-app)"
  "🟢 developer spawned (acme-app)"
  "🟢 architect spawned (acme-app)"
  "🟢 qa-tester spawned (acme-app)"
  "🟢 developer spawned (acme-app)"

Send 1 message:
  "🟢 5 agents spawned on acme-app:
   • 3 developers
   • 1 architect
   • 1 qa-tester"
```

Implementation: 5-second debounce window. Events of the same type within the window are merged into a single summary message.

---

## Security

### Bot Token Storage

```
Token storage hierarchy (most secure first):
1. Environment variable: TELEGRAM_BOT_TOKEN, SLACK_BOT_TOKEN
2. Config file: flightdeck.config.yaml → integrations.telegram.botToken
3. Settings page: encrypted in DB (settings table, encrypted at rest)
```

- Tokens are **never** logged, **never** included in agent context
- `ProviderManager.maskApiKey()` (existing) used for display: `sk-...abc1`
- Config file permissions: warn if world-readable

### User Verification

**Telegram:**
- DM policy: `allowlist` mode by default (matches OpenClaw pattern)
- User must be in `integrations.telegram.allowedUsers` (numeric Telegram user IDs)
- First message from unknown user → rejected with "⛔ Not authorized"
- Optional: pairing flow — user sends `/pair <code>` where code is displayed in Flightdeck UI

**Slack:**
- Request signing: every incoming request verified via `X-Slack-Signature` + signing secret
- Bot only responds in authorized workspace (OAuth token scope)
- Optional: channel allowlist to restrict which channels the bot operates in

### Message Signing (Webhooks)

When using Slack Events API or Telegram webhooks (instead of long polling):
- Slack: HMAC-SHA256 signature verification on every request (standard Slack pattern)
- Telegram: Secret token in webhook URL + IP allowlist for Telegram API servers

### Data Flow Security

- External messages are sanitized before routing to agents (strip markdown injection, limit length)
- Agent responses are sanitized before sending to platforms (no internal IDs, no file paths)
- No agent credentials, file contents, or code snippets are sent externally unless explicitly included in the agent's response text
- Outbound messages have a max length (Telegram: 4096 chars, Slack: 3000 chars) — truncated with "... [View full response in Flightdeck]" link

---

## Configuration

### Config Schema Addition

```typescript
// Add to configSchema.ts:
const integrationSchema = z.object({
  telegram: z.object({
    enabled: z.boolean().default(false),
    botToken: z.string().optional(),       // or from TELEGRAM_BOT_TOKEN env
    mode: z.enum(['polling', 'webhook']).default('polling'),
    webhookUrl: z.string().url().optional(), // Required if mode=webhook
    allowedUsers: z.array(z.number()).default([]),  // Telegram user IDs
    dmPolicy: z.enum(['allowlist', 'open', 'disabled']).default('allowlist'),
  }).optional(),
  
  slack: z.object({
    enabled: z.boolean().default(false),
    botToken: z.string().optional(),       // or from SLACK_BOT_TOKEN env
    signingSecret: z.string().optional(),  // or from SLACK_SIGNING_SECRET env
    appToken: z.string().optional(),       // For Socket Mode
    mode: z.enum(['events-api', 'socket-mode']).default('socket-mode'),
    allowedChannels: z.array(z.string()).default([]),
  }).optional(),

  notifications: z.object({
    external: z.array(z.string()).default([
      'agent_question', 'pending_decision', 'agent_crashed',
      'blocked_task', 'review_request',
    ]),
    quietHours: z.object({
      start: z.string().optional(),    // HH:MM
      end: z.string().optional(),
      timezone: z.string().default('UTC'),
    }).optional(),
    batchWindow: z.number().min(0).max(30000).default(5000),
  }).optional(),
});
```

### YAML Example

```yaml
# flightdeck.config.yaml
integrations:
  telegram:
    enabled: true
    botToken: ${TELEGRAM_BOT_TOKEN}   # Env var reference
    mode: polling
    dmPolicy: allowlist
    allowedUsers:
      - 123456789                     # Telegram user ID

  slack:
    enabled: false
    mode: socket-mode

  notifications:
    external:
      - agent_question
      - pending_decision
      - agent_crashed
      - blocked_task
      - review_request
      - task_completed                # User added this
    quietHours:
      start: "22:00"
      end: "08:00"
      timezone: "America/New_York"
```

### Hot-Reload

Config changes are hot-reloaded via `ConfigStore`:
- Token change → restart adapter connection
- Enabled toggle → start/stop adapter
- Notification preferences → immediate effect
- Allowed users → immediate effect (no restart)

---

## API Design

### REST Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/integrations` | List all integrations and their status |
| `GET` | `/api/integrations/telegram/status` | Telegram bot connection status |
| `POST` | `/api/integrations/telegram/test` | Send a test message to verify setup |
| `POST` | `/api/integrations/telegram/webhook` | Incoming Telegram webhook (if webhook mode) |
| `GET` | `/api/integrations/slack/status` | Slack app connection status |
| `POST` | `/api/integrations/slack/events` | Incoming Slack events |
| `POST` | `/api/integrations/slack/interact` | Incoming Slack interactive payloads |
| `POST` | `/api/integrations/slack/command` | Incoming Slack slash commands |
| `GET` | `/api/integrations/slack/manifest` | Generate Slack app manifest for user |
| `PATCH` | `/api/integrations/:platform/config` | Update platform config |

### Settings UI Page

New section in Settings → Integrations:

```
┌──────────────────────────────────────────────────────────────┐
│  Settings > Integrations                                     │
│                                                              │
│  TELEGRAM                                         [Enabled ●]│
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Bot Token: [••••••••••••••abc1]          [👁 Show]   │   │
│  │ Mode: ○ Long Polling (recommended)  ○ Webhook       │   │
│  │ Status: 🟢 Connected                               │   │
│  │                                                     │   │
│  │ Allowed Users:                                      │   │
│  │ [123456789] [×]                    [+ Add User]     │   │
│  │                                                     │   │
│  │ How to find your Telegram user ID:                  │   │
│  │ 1. DM your bot                                      │   │
│  │ 2. Check server logs for from.id                    │   │
│  │                                                     │   │
│  │ [ Test Connection ] [ Disconnect ]                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  SLACK                                         [Disabled ○]  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ [ Set Up Slack → ]                                   │   │
│  │ Generate app manifest and install to your workspace  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  NOTIFICATION PREFERENCES                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Push to messaging:                                   │   │
│  │ ☑ Agent questions (always)                          │   │
│  │ ☑ Pending decisions (always)                        │   │
│  │ ☑ Agent crashes (always)                            │   │
│  │ ☑ Blocked tasks                                     │   │
│  │ ☑ Review requests                                   │   │
│  │ ☐ Task completions                                  │   │
│  │ ☐ Agent spawned/exited                              │   │
│  │ ☐ Progress updates                                  │   │
│  │                                                     │   │
│  │ Quiet hours: [22:00] to [08:00] [America/New_York ▾]│   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Foundation

1. **Integration agent core** (~200 LOC)
   - `IntegrationAgent` class with deterministic routing
   - Session binding (in-memory Map with TTL)
   - Command parsing
   - Project resolver

2. **Platform adapter interface** (~50 LOC)
   - `MessagingAdapter` interface: `start()`, `stop()`, `send()`, `onMessage()`
   - `OutboundMessage` and `InboundMessage` types

3. **Config schema** (~40 LOC)
   - Add `integrations` section to `configSchema.ts`
   - Zod validation for Telegram + Slack config

### Phase 2: Telegram

4. **TelegramAdapter** (~400 LOC)
   - grammY bot setup
   - Long polling mode
   - Command handlers (`/status`, `/tasks`, `/approve`, etc.)
   - Freeform message → IntegrationAgent routing
   - Callback query handler (inline buttons)
   - Outbound message formatting (Markdown + inline keyboards)

5. **Telegram setup UI** (~200 LOC)
   - Settings page section
   - Token input, connection test, user management

### Phase 3: Notification Pipeline

6. **Extend NotificationManager** (~100 LOC)
   - Add `external` channel to notification dispatch
   - Preference-based filtering for external push
   - Quiet hours enforcement
   - Event batching (5s debounce)

7. **Wire agent events → Integration Agent → Adapters** (~80 LOC)
   - Subscribe to AgentManager events in container.ts
   - Route through NotificationManager preferences
   - Format and dispatch via active adapters

### Phase 4: Container Integration

8. **Update container.ts** (~50 LOC)
   - Tier 2: Create IntegrationAgent, TelegramAdapter, SlackAdapter
   - Wire event pipeline: AgentManager → NotificationManager → IntegrationAgent → Adapters
   - Shutdown lifecycle: stop adapters before AgentManager

9. **REST routes** (~150 LOC)
   - `routes/integrations.ts` — status, config, test, webhook endpoints
   - Wire into `mountAllRoutes`

### Phase 5: Slack

10. **SlackAdapter** (~450 LOC)
    - @slack/bolt or @slack/web-api
    - Socket Mode (default) + Events API (webhook option)
    - Block Kit message formatting
    - Interactive message handlers
    - Slash command handler

11. **Slack setup UI** (~250 LOC)
    - Manifest generator
    - Token input, channel management

### Estimated Total

| Component | LOC | Dependencies |
|-----------|-----|-------------|
| IntegrationAgent | ~200 | AgentManager, NotificationManager |
| MessagingAdapter interface | ~50 | — |
| TelegramAdapter | ~400 | grammY |
| SlackAdapter | ~450 | @slack/bolt |
| Config schema | ~40 | Zod (existing) |
| NotificationManager extension | ~100 | Existing NotificationManager |
| Container wiring | ~50 | Existing container pattern |
| REST routes | ~150 | Express (existing) |
| Settings UI (Telegram) | ~200 | React (existing) |
| Settings UI (Slack) | ~250 | React (existing) |
| **Total** | **~1,890** | **2 new deps** |

### New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `grammy` | Telegram Bot API framework | ~150KB |
| `@slack/bolt` | Slack app framework (Events API + Socket Mode) | ~200KB |

Both are well-maintained, production-grade libraries widely used for bot development.

---

## Open Questions

1. **grammY vs Telegraf?** grammY is newer, TypeScript-first, better documented. Telegraf is more mature with larger ecosystem. Recommend grammY (matches OpenClaw's choice, better TS support).

2. **Slack Socket Mode vs Events API?** Socket Mode requires no public URL (better for self-hosted). Events API has lower latency and is more standard. Recommend Socket Mode as default (matches our self-hosted user base), Events API as opt-in.

3. **Media support?** Should agents be able to send images/files via Telegram/Slack? (Screenshots, generated diagrams, etc.) Recommend: Phase 2 addition — text-only first.

4. **Group chat mode?** Should the bot work in Telegram groups / Slack channels (not just DMs)? Adds complexity (mention detection, multi-user routing). Recommend: DM-only for v1, group support in v2.

5. **Offline message queuing?** If Telegram/Slack is down when an agent event fires, should messages queue and retry? Recommend: yes, small in-memory queue with 5-minute TTL and exponential backoff.

6. **Integration agent as LLM?** Currently designed as deterministic router. Should it use LLM for message understanding? (e.g., "check on the payment thing" → route to billing project). Recommend: deterministic first, LLM fallback as opt-in for disambiguation.

7. **Multiple Telegram bots?** One bot per project or one bot for all? Recommend: one bot, multi-project routing. Simpler setup, single point of management.

8. **Discord support?** Similar pattern to Slack. Worth designing the adapter interface to be extensible for a third platform. The `MessagingAdapter` interface already handles this.
