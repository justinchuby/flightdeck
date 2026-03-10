---
name: messaging-integration-pattern
description: How to add external messaging platform integrations (Telegram, Slack, Discord) to Flightdeck — architecture, routing, event pipeline, and implementation template
---

# Messaging Integration Pattern

Flightdeck connects to external messaging platforms (Telegram, Slack, Discord) through a three-layer architecture: **Platform Adapter** → **Integration Agent** → **Notification Bridge**. This skill documents the pattern so new platform integrations follow a consistent structure.

## Architecture

```
                    ┌──────────────┐
                    │ AgentManager │  (35+ event types)
                    └──────┬───────┘
                           │ agent:crashed, lead:decision,
                           │ agent:permission_request, dag:updated, ...
                    ┌──────▼───────────┐
                    │ NotificationBridge│  (preference filter + 5s batch)
                    └──────┬───────────┘
                           │ filtered + batched events
                    ┌──────▼───────────┐
                    │ IntegrationAgent │  (deterministic router)
                    │  • format for platform
                    │  • route inbound to correct project/lead
                    │  • command parsing
                    │  • session binding (user → project, 1hr TTL)
                    └──────┬───────────┘
              ┌────────────┼────────────┐
              │            │            │
     ┌────────▼──┐  ┌──────▼───┐  ┌────▼─────┐
     │ Telegram  │  │  Slack   │  │ Discord  │
     │ Adapter   │  │  Adapter │  │ Adapter  │
     └───────────┘  └──────────┘  └──────────┘
      (grammY)     (@slack/bolt)   (discord.js)
```

**Key principle:** The IntegrationAgent is platform-agnostic. Platform adapters are thin transport layers. Adding a new platform means writing ONE adapter class — no changes to routing, batching, or event logic.

## Key Files

```
packages/server/src/integrations/
├── types.ts                # InboundMessage, OutboundMessage, MessagingAdapter interface
├── IntegrationAgent.ts     # Deterministic router (NOT an LLM agent)
├── NotificationBridge.ts   # AgentManager events → filtered → batched → dispatched
├── TelegramAdapter.ts      # Telegram transport (grammY, long polling)
├── SlackAdapter.ts         # Slack transport (@slack/bolt, Socket Mode)
├── index.ts                # Barrel exports

packages/server/src/routes/
└── integrations.ts         # REST endpoints: status, test, config, webhooks

packages/server/src/config/
└── configSchema.ts         # integrations.telegram, integrations.slack, etc.
```

## Core Interfaces

### MessagingAdapter (what every platform implements)

```typescript
interface MessagingAdapter {
  readonly platform: string;           // 'telegram', 'slack', 'discord'
  readonly isConnected: boolean;

  start(): Promise<void>;             // Connect to platform API
  stop(): Promise<void>;              // Graceful disconnect
  send(chatId: string, message: OutboundMessage): Promise<void>;
}
```

### InboundMessage (user → Flightdeck)

```typescript
interface InboundMessage {
  platform: 'telegram' | 'slack' | 'discord';
  userId: string;          // Platform-specific user ID
  chatId: string;          // Platform-specific chat/channel ID
  text: string;
  replyTo?: string;        // If replying to a bot message (carries project context)
  attachments?: Attachment[];
}
```

### OutboundMessage (Flightdeck → user)

```typescript
interface OutboundMessage {
  text: string;                        // Markdown-formatted content
  category: AgentEventCategory;        // For platform-specific formatting
  projectId?: string;                  // For context metadata
  replyMarkup?: InlineKeyboard;        // Platform-agnostic button spec
}
```

## Pattern: Deterministic Routing (IntegrationAgent)

The IntegrationAgent is a **state machine**, NOT an LLM. It routes inbound messages to the correct project lead using this priority chain:

```
1. Reply context    → message is a reply to a bot message → extract projectId from metadata
2. Explicit command → /project <name>, /status <name>    → resolve by name
3. Active binding   → user bound to a project (1hr TTL)  → use binding
4. Single project   → user has exactly 1 active project  → auto-route
5. Multiple projects→ ambiguous                          → send project selector buttons
6. No projects      → inform user ("Start a crew from Flightdeck UI")
```

Session bindings are **in-memory only** (Map with TTL). Not persisted to DB. If server restarts, user re-selects project on next message.

## Pattern: Notification Bridge (Event Pipeline)

The NotificationBridge sits between AgentManager events and the IntegrationAgent. It handles:

### 1. Preference filtering

Not all events go external. Categories and their defaults:

| Category | Default External | User-Configurable |
|----------|-----------------|-------------------|
| `agent_question` | ✅ Always | No — blocks agent work |
| `pending_decision` | ✅ Always | No — blocks agent work |
| `agent_crashed` | ✅ Always | No — critical |
| `blocked_task` | ✅ Default on | Yes |
| `review_request` | ✅ Default on | Yes |
| `task_completed` | ❌ UI only | Yes |
| `agent_spawned` | ❌ UI only | Yes |
| `progress_update` | ❌ UI only | Yes |

### 2. Event batching (5-second debounce)

Rapid events are merged into summary messages:

```
// Instead of 5 separate messages:
"🟢 developer spawned" × 3 + "🟢 architect spawned" + "🟢 qa-tester spawned"

// Send 1 batched message:
"🟢 5 agents spawned on acme-app: 3 developers, 1 architect, 1 qa-tester"
```

### 3. Quiet hours enforcement

Configurable quiet hours (e.g., 22:00–08:00). During quiet hours, only `agent_crashed` events are pushed. Everything else queues until quiet hours end.

## Pattern: Command Handling

All platforms support the same command set (parsed by IntegrationAgent):

| Command | Action | Maps To |
|---------|--------|---------|
| `/status` | All projects summary | Dashboard view |
| `/status <project>` | Project details | Project overview |
| `/tasks` | Task summary for current project | Tasks tab |
| `/approve <id>` | Approve pending decision | Decision approve |
| `/reject <id>` | Reject pending decision | Decision reject |
| `/project <name>` | Switch project context | Navigation |
| `/help` | Show commands | — |
| `/mute [duration]` | Mute notifications | Notification prefs |
| `/unmute` | Resume notifications | Notification prefs |

Commands are parsed first. Unrecognized text is routed as a freeform message to the project's lead agent via `agentManager.queueMessage()`.

## How to Add a New Platform

### Step 1: Create the adapter (~300-500 LOC)

```typescript
// packages/server/src/integrations/DiscordAdapter.ts

export class DiscordAdapter implements MessagingAdapter {
  readonly platform = 'discord';
  private client: Client;  // discord.js

  constructor(
    private config: DiscordConfig,
    private integrationAgent: IntegrationAgent,
  ) {}

  async start(): Promise<void> {
    // 1. Initialize client with bot token
    // 2. Register command handlers (map to IntegrationAgent.parseCommand)
    // 3. Register message handler (route through IntegrationAgent.handleInbound)
    // 4. Register button/interaction handler (for inline approve/reject)
    // 5. Login and connect
  }

  async stop(): Promise<void> {
    // Graceful disconnect
  }

  async send(chatId: string, message: OutboundMessage): Promise<void> {
    // Format OutboundMessage → platform-specific format
    // Discord: Embeds + ActionRows with Buttons
    // Telegram: Markdown + InlineKeyboard
    // Slack: Block Kit sections + actions
  }
}
```

### Step 2: Add config schema (~20 LOC)

```typescript
// In configSchema.ts, add to integrationSchema:
discord: z.object({
  enabled: z.boolean().default(false),
  botToken: z.string().optional(),        // or from DISCORD_BOT_TOKEN env
  guildId: z.string().optional(),         // Discord server ID
  allowedChannels: z.array(z.string()).default([]),
  dmPolicy: z.enum(['allowlist', 'open', 'disabled']).default('allowlist'),
  allowedUsers: z.array(z.string()).default([]),
}).optional(),
```

### Step 3: Wire in container.ts (~15 LOC)

```typescript
// After IntegrationAgent creation (Tier 5):
let discordAdapter: DiscordAdapter | null = null;
if (integrationConfig?.discord?.enabled && integrationConfig.discord.botToken) {
  discordAdapter = new DiscordAdapter(integrationConfig.discord, integrationAgent);
  // Add to NotificationBridge's adapter list
}
if (discordAdapter) {
  discordAdapter.start().catch(err => logger.error({ ... }));
  onShutdown('discordAdapter', () => discordAdapter!.stop());
}
```

### Step 4: Add REST routes (~30 LOC)

```typescript
// In routes/integrations.ts:
router.get('/api/integrations/discord/status', ...);
router.post('/api/integrations/discord/test', ...);
router.patch('/api/integrations/discord/config', ...);
```

### Step 5: Add Settings UI section (~150 LOC)

Mirror the Telegram settings section: token input, connection status, test button, user allowlist.

### Step 6: Tests (~200-400 LOC)

Test: adapter start/stop lifecycle, message formatting, command routing, permission handling, rate limiting, allowlist enforcement.

**Total for a new platform: ~500-700 LOC production + ~200-400 LOC tests.** No changes needed to IntegrationAgent, NotificationBridge, or other adapters.

## Security Checklist

Every platform adapter MUST implement:

- [ ] **User allowlist** — reject messages from unauthorized users
- [ ] **Inbound rate limiting** — 20 messages/minute per user
- [ ] **Token storage** — env var primary, never in committed config files
- [ ] **Message sanitization** — strip markdown injection before routing to agents
- [ ] **Outbound truncation** — platform max lengths (Telegram: 4096, Slack: 3000, Discord: 2000)
- [ ] **No internal data leakage** — no agent IDs, file paths, or credentials in outbound messages
- [ ] **Webhook verification** — HMAC signing for webhook mode (if applicable)

## Container Tier Placement

Integration components go in **Tier 5** (after AgentManager, Tier 4):

```
Tier 4: AgentManager
Tier 5: IntegrationAgent(projectRegistry, agentManager)
        TelegramAdapter(config, integrationAgent)
        SlackAdapter(config, integrationAgent)
        NotificationBridge(integrationAgent, [adapters], config)
        notificationBridge.wire(agentManager)  ← subscribes to events
```

This avoids circular dependencies (IntegrationAgent needs AgentManager which is Tier 4).

## Anti-patterns

- **LLM-powered routing** — the router must be deterministic. LLM adds latency, cost, and unpredictability for a simple routing decision
- **Persisting session bindings to DB** — ephemeral is correct. Bindings are cheap to recreate. DB adds migration overhead for throwaway state
- **Platform-specific logic in IntegrationAgent** — keep it in the adapter. IntegrationAgent returns platform-agnostic OutboundMessage; adapter formats it
- **Eager platform SDK loading** — follow the adapter pattern: lazy import in `start()`
- **Skipping the batch window** — without batching, rapid events (5 agents spawning) flood the user's phone with 5 notifications in 2 seconds
- **Equal-priority notifications** — decisions and crashes ALWAYS push. Task completions are opt-in. Don't treat all events equally
