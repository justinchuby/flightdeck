# RFC: OpenClaw as Sidecar Channel Gateway

> **Status:** Draft — for team evaluation
> **Author:** Architect Agent 4c2f3341
> **Date:** 2026-03-16
> **Branch:** `design/openclaw-sidecar`

---

## Summary

This RFC explores running OpenClaw as a sidecar process alongside Flightdeck to provide
multi-channel messaging support (Telegram, Discord, Slack, WhatsApp, Signal, and 15+ more).
It covers architecture, auth, failure modes, message translation, deployment, and an honest
cost-benefit analysis against the alternative of building native adapters.

**The RFC recommends against the sidecar approach** in favor of native adapters for 2-3 key
channels. The design is documented here to make that decision explicit and well-reasoned,
rather than left as an unexplored possibility.

---

## Table of Contents

1. [Motivation](#1-motivation)
2. [Architecture](#2-architecture)
3. [Auth Boundary](#3-auth-boundary)
4. [Failure Modes](#4-failure-modes)
5. [Message Format Translation](#5-message-format-translation)
6. [Deployment](#6-deployment)
7. [Channel Prioritization](#7-channel-prioritization)
8. [Cost-Benefit Analysis](#8-cost-benefit-analysis)
9. [Decision](#9-decision)

---

## 1. Motivation

Flightdeck currently has one external messaging channel: Telegram (via `TelegramAdapter`).
Users have expressed interest in Discord and Slack. OpenClaw (317K GitHub stars, MIT licensed)
supports 20+ messaging channels with production-grade adapters.

**The question:** Rather than building each adapter from scratch, could we run OpenClaw as
a channel gateway process alongside Flightdeck and route messages through it?

---

## 2. Architecture

### 2.1 Process Model

```
┌─────────────────────────────┐     ┌───────────────────────────────┐
│  Flightdeck Server          │     │  OpenClaw Sidecar             │
│  (primary process)          │     │  (child process)              │
│                             │     │                               │
│  AgentManager               │     │  Gateway Server               │
│  ProjectRegistry            │     │    ├─ Telegram extension      │
│  TaskDAG                    │     │    ├─ Discord extension       │
│  GovernancePipeline         │     │    ├─ Slack extension         │
│  IntegrationRouter ◄────────┼─ws──┼──► Gateway WebSocket API     │
│    ├─ SidecarBridge (new)   │     │    ├─ WhatsApp extension     │
│    ├─ NotificationBatcher   │     │    ├─ Signal extension       │
│    └─ (native TG adapter    │     │    └─ ... 15+ more           │
│        remains as fallback) │     │                               │
│                             │     │  Agent Runtime (UNUSED)       │
│  Web UI / API               │     │  Memory System (UNUSED)       │
│                             │     │  Config Loader                │
│                             │     │  Session Store                │
└─────────────────────────────┘     └───────────────────────────────┘
```

### 2.2 Communication Protocol

OpenClaw exposes a WebSocket gateway at `ws://localhost:{port}` authenticated via
`OPENCLAW_GATEWAY_TOKEN`. The protocol is JSON-based with typed message events.

**Option A: WebSocket Gateway Protocol (OpenClaw native)**

```typescript
// Flightdeck connects as a gateway client
const ws = new WebSocket(`ws://localhost:${OPENCLAW_PORT}`, {
  headers: { Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}` }
});

// Inbound message from any channel
ws.on('message', (data) => {
  const event = JSON.parse(data);
  // event.type: 'channel.message.inbound'
  // event.channel: 'telegram' | 'discord' | 'slack' | ...
  // event.chatId, event.userId, event.text, event.metadata
});

// Outbound message to any channel
ws.send(JSON.stringify({
  type: 'channel.message.send',
  channel: 'discord',
  chatId: '123456789',
  text: 'Agent completed task #42',
  metadata: { parseMode: 'Markdown' }
}));
```

**Option B: REST API Bridge**

```typescript
// Simpler but less real-time
// POST http://localhost:{port}/api/send
// GET  http://localhost:{port}/api/channels (list active channels)
// GET  http://localhost:{port}/api/status (health check)
```

**Option C: ACP stdio (Agent Client Protocol)**

```typescript
// Both projects support ACP — could use stdio transport
// But ACP is designed for LLM interaction, not message routing
// Misuse of the protocol — NOT recommended
```

**Recommended:** Option A (WebSocket). It's the protocol OpenClaw already exposes for
its native apps (iOS, macOS, Android). Real-time, bidirectional, well-tested.

### 2.3 SidecarBridge Component

A new class implementing `MessagingAdapter`:

```typescript
// packages/server/src/integrations/SidecarBridge.ts

export class SidecarBridge extends TypedEmitter<BridgeEvents> implements MessagingAdapter {
  readonly platform: MessagingPlatform;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageHandlers: Array<(msg: InboundMessage) => void> = [];

  constructor(
    private config: {
      platform: MessagingPlatform;  // which channel this bridge represents
      gatewayUrl: string;           // ws://localhost:PORT
      gatewayToken: string;
      reconnectIntervalMs?: number; // default: 5000
    }
  ) { ... }

  async start(): Promise<void> {
    // Connect to OpenClaw gateway WebSocket
    // Subscribe to inbound messages for this.platform
    // Start heartbeat / reconnection loop
  }

  async stop(): Promise<void> {
    // Close WebSocket, cancel reconnect timer
  }

  isRunning(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    // Translate OutboundMessage → OpenClaw gateway format
    // Send via WebSocket
  }

  onMessage(handler: (message: InboundMessage) => void): void {
    this.messageHandlers.push(handler);
  }
}
```

This bridge implements the **same `MessagingAdapter` interface** that `TelegramAdapter`
uses, so `IntegrationRouter` treats it identically — no routing changes needed.

### 2.4 Process Lifecycle

```
Flightdeck startup:
  1. Start Flightdeck server normally
  2. If sidecar config is enabled:
     a. Spawn OpenClaw as child process: `npx openclaw gateway --port PORT --token TOKEN`
     b. Wait for health check: GET http://localhost:PORT/health
     c. For each configured channel, create a SidecarBridge instance
     d. Register bridges with IntegrationRouter
  3. If sidecar fails to start, log warning and continue without sidecar channels

Flightdeck shutdown:
  1. Stop all SidecarBridge instances (close WebSocket connections)
  2. Send SIGTERM to OpenClaw child process
  3. Wait up to 10s for graceful shutdown
  4. SIGKILL if still running
```

---

## 3. Auth Boundary

### 3.1 Bot Token Management

**Problem:** Each channel requires its own auth credentials (Telegram bot token, Discord
bot token, Slack app token, etc.). These must be accessible to OpenClaw, not Flightdeck.

**Design:**

```yaml
# flightdeck.config.yaml
sidecar:
  enabled: true
  openclawBinary: 'npx openclaw'  # or absolute path
  port: 4100
  gatewayToken: 'random-secret-for-ipc'  # NOT a bot token

  # Channel tokens are passed to OpenClaw's config, not Flightdeck's
  channels:
    telegram:
      enabled: true
      botToken: '${TELEGRAM_BOT_TOKEN}'  # env var reference
    discord:
      enabled: true
      botToken: '${DISCORD_BOT_TOKEN}'
    slack:
      enabled: true
      botToken: '${SLACK_BOT_TOKEN}'
      appToken: '${SLACK_APP_TOKEN}'
```

**Token flow:**
1. User sets bot tokens as environment variables
2. Flightdeck reads config, generates `openclaw.json` in a temp directory
3. Flightdeck spawns OpenClaw with `--config /tmp/flightdeck-openclaw-XXXX/openclaw.json`
4. OpenClaw loads the generated config and starts channel connections
5. Bot tokens never cross the WebSocket IPC boundary

**⚠️ Security risk: Bot tokens written to disk.** Flightdeck would generate a config file
containing plaintext bot tokens. Mitigations:
- File permissions: `0600` (owner read/write only)
- Location: OS temp directory with random suffix
- Lifecycle: delete on shutdown (but NOT on crash — tokens persist on disk after unclean exit)
- Alternative: pass tokens via environment variables to the child process instead of a config
  file (preferred, but requires OpenClaw to support all channel tokens via env vars — currently
  only `TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, and `SLACK_BOT_TOKEN` are supported via env)

This is an inherent risk of the sidecar model: secrets must cross a process boundary.
Native adapters avoid this entirely since tokens stay in Flightdeck's own process memory.

### 3.2 Gateway Authentication

The WebSocket between Flightdeck and OpenClaw uses a shared secret
(`sidecar.gatewayToken`). This is an internal IPC channel — both processes run on the
same machine. The token prevents other local processes from connecting.

### 3.3 User Authentication

User identity flows through the sidecar:

```
User sends Telegram message
  → OpenClaw receives via Telegram Bot API
  → OpenClaw extracts user ID, display name
  → OpenClaw forwards via WebSocket with identity metadata
  → SidecarBridge translates to InboundMessage
  → IntegrationRouter applies allowlist check (Flightdeck's own config)
  → If allowed, routes to project lead
```

**Important:** Flightdeck maintains its own allowlist. OpenClaw's allowlist config should
be set to open (allow all), and Flightdeck applies the real access control.

---

## 4. Failure Modes

### 4.1 Failure Mode Table

| Failure | Impact | Detection | Recovery |
|---------|--------|-----------|----------|
| OpenClaw process crashes | All sidecar channels go down. Native TG adapter unaffected if configured as fallback. | Child process exit event + WebSocket close | Auto-restart with exponential backoff (1s, 2s, 4s, 8s, max 60s). Max 10 restarts per hour. |
| WebSocket disconnects | Temporary message loss for sidecar channels | WebSocket `close` event | Auto-reconnect with backoff. Queue outbound messages during reconnect (max 100, 5-min TTL). |
| OpenClaw hangs (no crash) | Messages silently dropped | Heartbeat timeout (30s ping/pong) | Force-kill process, trigger restart |
| Channel-specific failure (e.g., Telegram 409) | Single channel down, others unaffected | OpenClaw logs error, SidecarBridge receives error event | OpenClaw handles internally (retry, backoff) |
| Config mismatch (wrong token) | Channel fails to connect | OpenClaw logs auth error on startup | User must fix config and restart |
| Port conflict | Sidecar can't start | Startup health check fails | Log error, try next port, or fail gracefully |

### 4.2 Graceful Degradation

```typescript
// If sidecar is down, fall back gracefully:
class SidecarBridge implements MessagingAdapter {
  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.isRunning()) {
      // Queue message for retry when connection restores
      this.outboundQueue.push({
        message,
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      logger.warn({
        module: 'sidecar',
        msg: `Sidecar offline — queued message for ${message.platform}`,
      });
      return;
    }
    // ... send normally
  }
}
```

### 4.3 Native Fallback for Telegram

If both the sidecar and a native `TelegramAdapter` are configured, Flightdeck should
prefer the native adapter. This ensures Telegram stays up even when the sidecar is down.
The sidecar would handle Discord, Slack, and other channels.

---

## 5. Message Format Translation

### 5.1 The Impedance Mismatch Problem

OpenClaw's channel messages are rich (media, buttons, reactions, threads, voice).
Flightdeck's `InboundMessage` / `OutboundMessage` types are text-only.

**Current Flightdeck types (text-only):**

```typescript
interface InboundMessage {
  platform: MessagingPlatform;
  chatId: string;
  userId: string;
  displayName: string;
  text: string;          // ← text only
  receivedAt: number;
  messageId?: string;
}

interface OutboundMessage {
  platform: MessagingPlatform;
  chatId: string;
  text: string;          // ← text only
  parseMode?: string;
  replyToMessageId?: string;
}
```

**OpenClaw messages can include:**
- Images, voice notes, documents, stickers
- Inline keyboards (buttons)
- Reactions (emoji)
- Thread/topic IDs
- Edited messages
- Forwarded messages
- Contact cards, locations

### 5.2 Translation Strategy

**Phase 1 (MVP):** Text-only bridge. Media and rich features are described as text.

```typescript
function translateInbound(openclawEvent: OpenClawChannelEvent): InboundMessage {
  let text = openclawEvent.text ?? '';

  // Describe media as text annotations
  if (openclawEvent.image) {
    text = `[Image: ${openclawEvent.image.caption ?? 'no caption'}]\n${text}`;
  }
  if (openclawEvent.voice) {
    text = `[Voice message: ${openclawEvent.voice.duration}s]\n${text}`;
  }
  if (openclawEvent.document) {
    text = `[Document: ${openclawEvent.document.fileName}]\n${text}`;
  }

  return {
    platform: openclawEvent.channel as MessagingPlatform,
    chatId: String(openclawEvent.chatId),
    userId: String(openclawEvent.userId),
    displayName: openclawEvent.displayName ?? 'Unknown',
    text,
    receivedAt: Date.now(),
    messageId: openclawEvent.messageId,
  };
}
```

**Phase 2 (future):** Extend `InboundMessage` / `OutboundMessage` with optional rich fields:

```typescript
interface InboundMessage {
  // ... existing fields ...
  attachments?: Array<{
    type: 'image' | 'voice' | 'document' | 'video';
    url?: string;
    mimeType?: string;
    fileName?: string;
    caption?: string;
    sizeBytes?: number;
  }>;
  threadId?: string;
  isEdited?: boolean;
}

interface OutboundMessage {
  // ... existing fields ...
  buttons?: Array<{
    text: string;
    callbackData?: string;
    url?: string;
  }>;
  reactionEmoji?: string;
}
```

### 5.3 Platform-Specific Quirks

| Platform | Quirk | SidecarBridge Handling |
|----------|-------|----------------------|
| **Telegram** | 4096 char limit | OpenClaw handles chunking internally |
| **Discord** | 2000 char limit, different markdown syntax | Bridge must re-chunk; Discord uses `**bold**` not `*bold*` |
| **Slack** | mrkdwn format (not Markdown), block kit | Bridge converts Markdown → mrkdwn |
| **WhatsApp** | No markdown, limited formatting | Bridge strips markdown |
| **Signal** | No formatting at all | Bridge sends plain text |
| **IRC** | No inline images, 512 byte line limit | Bridge truncates aggressively |

Each platform has different message format requirements. The SidecarBridge would need
per-platform format translation — or delegate this entirely to OpenClaw, which already
handles it internally.

---

## 6. Deployment

### 6.1 User Setup Flow

```bash
# 1. Install OpenClaw globally (or use npx)
npm install -g openclaw

# 2. Configure Flightdeck to use sidecar
# flightdeck.config.yaml:
sidecar:
  enabled: true
  channels:
    discord:
      enabled: true
      botToken: '${DISCORD_BOT_TOKEN}'
    slack:
      enabled: true
      botToken: '${SLACK_BOT_TOKEN}'
      appToken: '${SLACK_APP_TOKEN}'

# 3. Set environment variables
export DISCORD_BOT_TOKEN=your-discord-bot-token
export SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
export SLACK_APP_TOKEN=xapp-your-slack-app-token

# 4. Start Flightdeck (sidecar starts automatically)
flightdeck start
```

### 6.2 Docker Deployment

```dockerfile
# Dockerfile for Flightdeck + OpenClaw sidecar
FROM node:22-slim

# Install both
RUN npm install -g @flightdeck-ai/flightdeck openclaw

# Configure sidecar in entrypoint
COPY flightdeck.config.yaml /root/.flightdeck/config.yaml
COPY openclaw-sidecar.json /tmp/openclaw-sidecar.json

# Flightdeck manages OpenClaw lifecycle
CMD ["flightdeck", "start"]
```

### 6.3 System Requirements

| Requirement | Native Adapters | Sidecar |
|---|---|---|
| **Install size** | +0 MB (adapters are built-in) | +300-500 MB (OpenClaw + all deps) |
| **Memory** | +5-15 MB per adapter | +100-200 MB (full OpenClaw runtime) |
| **Processes** | 1 | 2 |
| **Node.js version** | ≥18 (Flightdeck's requirement) | ≥22.16 (OpenClaw's requirement) |
| **Config files** | 1 (flightdeck.config.yaml) | 2 (+ generated openclaw.json) |
| **Dependencies** | grammy, @slack/bolt, discord.js | All of OpenClaw's 50+ deps |

---

## 7. Channel Prioritization

### 7.1 Which Channels Matter for Flightdeck Users?

| Channel | Relevance to Flightdeck Users | Priority |
|---------|-------------------------------|----------|
| **Telegram** | ✅ Already implemented natively | N/A |
| **Slack** | HIGH — many dev teams use Slack for work communication | P1 |
| **Discord** | HIGH — popular with open-source and indie dev communities | P1 |
| **WhatsApp** | MEDIUM — personal messaging, less relevant for dev workflow | P2 |
| **MS Teams** | MEDIUM — enterprise teams, but complex setup | P2 |
| **Signal** | LOW — privacy-focused, niche for dev use | P3 |
| **Matrix** | LOW — self-hosted chat, niche but aligns with Flightdeck's self-hosted ethos | P3 |
| **IRC** | LOW — legacy, shrinking user base | P3 |
| **LINE** | LOW — popular in Asia, niche elsewhere | P3 |
| **iMessage** | LOW — macOS only, requires Xcode, fragile | P3 |
| **Google Chat** | LOW — Google Workspace users, limited bot API | P3 |
| **Feishu/Lark** | LOW — Chinese market, niche | P3 |
| **Nostr** | LOW — decentralized social, experimental | P3 |
| **Others** | VERY LOW — Tlon, Synology Chat, Nextcloud Talk, Twitch, Zalo | P4 |

### 7.2 The 95% Rule

**Telegram + Slack + Discord covers 95%+ of the realistic Flightdeck user base.**

- Telegram: ✅ Done
- Slack: Dev teams communicating about AI crew progress
- Discord: Open-source projects, indie developers, community-driven development

WhatsApp and MS Teams are "nice to have" for Phase 2. Everything else is niche.

---

## 8. Cost-Benefit Analysis

### 8.1 Option A: Native Adapters (Recommended)

**Build Slack + Discord adapters using the existing `MessagingAdapter` interface.**

| Dimension | Cost |
|---|---|
| **Development** | ~500 LOC per adapter × 2 = ~1,000 LOC + ~500 LOC tests = **~1,500 LOC total** |
| **Dependencies** | `@slack/bolt` (Slack), `discord.js` (Discord) — both well-maintained, focused libraries |
| **Install size** | +15-25 MB total |
| **Memory** | +5-15 MB per active adapter |
| **Maintenance** | Update 2 libraries (Slack SDK, discord.js). Both have stable APIs with rare breaking changes. |
| **Ops complexity** | Zero — same process, same config file, same restart |
| **Time to build** | 3-5 days for a developer agent |
| **Risk** | LOW — pattern is proven (TelegramAdapter exists), interface is stable |

**Benefits:**
- Three channels cover 95% of users
- Single process, single config, zero IPC
- Each adapter is ~500 LOC — easy to debug, test, modify
- Full control over message format, error handling, feature rollout
- No external version coupling

### 8.2 Option B: OpenClaw Sidecar

**Run OpenClaw as a child process, bridge messages via WebSocket.**

| Dimension | Cost |
|---|---|
| **Development** | SidecarBridge (~400 LOC) + process lifecycle (~300 LOC) + config generation (~200 LOC) + health checks (~150 LOC) + message translation (~400 LOC) + error handling/logging (~150 LOC) + tests (~500 LOC) = **~2,100 LOC total** |
| **Dependencies** | `openclaw` (50+ transitive deps, multiple native modules) |
| **Install size** | +300-500 MB |
| **Memory** | +100-200 MB (full OpenClaw runtime) |
| **Maintenance** | Track OpenClaw releases (date-based versioning, breaking changes every 1-2 weeks) |
| **Ops complexity** | HIGH — 2 processes, IPC health monitoring, restart coordination, config sync |
| **Time to build** | 1-2 weeks for a developer team |
| **Risk** | HIGH — external dependency on fast-moving project, IPC failure modes |

**Benefits:**
- 20+ channels "available" (but see caveats below)
- Community maintains channel adapters
- Can leverage OpenClaw's rich media handling

**Critical caveats:**
1. OpenClaw runs its **full AI runtime** — LLM inference, memory, tools, session management. Only ~20% (the channel extensions) is actually useful as a sidecar. The other 80% is dead weight consuming 100-200MB of RAM.
2. OpenClaw's channels are deeply integrated with its own **config system, session store, and agent model**. Stripping these out to use "just the channels" isn't supported — you run the whole thing or nothing.
3. The 20 channels include **niche platforms** (Tlon, Nostr, Synology Chat, Zalo) that virtually no Flightdeck user needs. The count is a vanity metric.
4. **Version coupling:** OpenClaw ships breaking changes on their cadence. A sidecar means tracking their releases for a component that's on the critical path for user communication.

### 8.3 Side-by-Side Comparison

| Criterion | Native Adapters | OpenClaw Sidecar |
|---|---|---|
| **LOC to write** | ~1,500 | ~2,100 |
| **LOC to maintain** | ~1,500 (all ours) | ~2,100 (ours) + OpenClaw (theirs, 300K+ LOC) |
| **Channels covered** | 3 (95% of users) | 20+ (99% of users) |
| **Install size** | +15-25 MB | +300-500 MB |
| **Runtime memory** | +10-30 MB | +100-200 MB |
| **Processes** | 1 | 2 |
| **Config files** | 1 | 2 |
| **Node.js requirement** | ≥18 | ≥22.16 (**breaking**: forces Flightdeck users to upgrade Node.js) |
| **Failure domains** | 0 new | 1 new (IPC) |
| **Version coupling** | None | OpenClaw releases |
| **Rich media support** | Text-only (initially) | Full (via OpenClaw) |
| **Time to build** | 3-5 days | 1-2 weeks |
| **Risk** | LOW | HIGH |

### 8.4 Break-Even Analysis

The sidecar becomes worthwhile only when:
1. Flightdeck needs **6+ channels** (the sidecar actually costs MORE LOC than native adapters for ≤5 channels)
2. Users demand **rich media** (images, voice, keyboards) across all channels
3. The team is willing to accept **external version coupling**, **IPC complexity**, and **undocumented protocol risk**
4. Users can upgrade to **Node.js ≥22.16** (OpenClaw's requirement, vs Flightdeck's ≥18)

For the current Flightdeck user base, none of these conditions are met.

---

## 9. Decision

### Recommendation: **Build Native Adapters (Option A)**

The sidecar approach trades development effort for operational complexity — and after
correcting the LOC estimate (including error handling, logging, and tests), the sidecar
actually costs **more code** (~2,100 LOC) than native adapters (~1,500 LOC), plus:
- +300-500 MB install size
- +100-200 MB runtime memory
- A new failure domain (IPC over undocumented WebSocket protocol)
- External version coupling to a fast-moving project (breaking changes every 1-2 weeks)
- Node.js ≥22.16 requirement (breaking for users on Node 18-22)
- Bot tokens written to disk (security risk on unclean shutdown)

**This is not a good trade.**

Three native adapters (Telegram ✅ + Slack + Discord) at ~500 LOC each are:
- Simpler to build, test, debug, and maintain
- Zero IPC overhead
- Zero external coupling
- 95% market coverage

### When to Revisit This Decision

Revisit the sidecar (or purpose-built gateway) approach if:
- Users request **4+ additional channels** beyond Telegram/Slack/Discord
- Rich media support becomes a **top-3 user request**
- OpenClaw extracts its channel layer into a **standalone library** (e.g., `@openclaw/channels`)

### What to Do Instead (Immediate Actions)

1. **Lift 3 algorithms from OpenClaw** (MIT licensed, zero coupling):
   - Message chunking (markdown-fence-aware) — fixes silent data loss at 4096 chars
   - Abort signal handling — fixes 30s hang + 409 Conflict on restart
   - Update deduplication — fixes double processing during restart

2. **Build Slack adapter** (~500 LOC) using `@slack/bolt` Socket Mode

3. **Build Discord adapter** (~500 LOC) using `discord.js`

Both adapters implement the existing `MessagingAdapter` interface and plug into
`IntegrationRouter` with zero architectural changes.

---

## Appendix A: OpenClaw Gateway Protocol (Reference)

OpenClaw's gateway protocol (for native apps) uses WebSocket with JSON messages:

```typescript
// Connection
ws = new WebSocket('ws://localhost:PORT');
ws.send(JSON.stringify({ type: 'auth', token: 'GATEWAY_TOKEN' }));

// Inbound event structure (from OpenClaw docs)
{
  type: 'agent-event',
  event: 'assistant-text',
  sessionKey: string,
  data: {
    text: string,
    channel: string,
    chatId: string,
    userId: string,
    metadata: Record<string, unknown>
  }
}
```

The protocol is **not formally documented as a public API**. It's designed for OpenClaw's
own native apps and may change without notice. This is a significant risk — the sidecar's
IPC layer would depend on an undocumented, unstable protocol. Any OpenClaw update could
break the bridge with no deprecation warning. Flightdeck would need integration tests
that run against each OpenClaw release to detect breakage proactively.

## Appendix B: OpenClaw npm Package Exports

```typescript
// What's actually importable from the openclaw package:
'openclaw'                          // CLI utilities (loadConfig, etc.)
'openclaw/plugin-sdk/core'          // ChannelPlugin, PluginApi types
'openclaw/plugin-sdk/telegram'      // Telegram types & helpers
'openclaw/plugin-sdk/discord'       // Discord types & helpers
'openclaw/plugin-sdk/slack'         // Slack types & helpers
'openclaw/plugin-sdk/routing'       // Route resolution
'openclaw/plugin-sdk/memory-core'   // Memory search interface
'openclaw/plugin-sdk/memory-lancedb'// LanceDB backend
'openclaw/plugin-sdk/sandbox'       // Sandbox execution
'openclaw/plugin-sdk/compat'        // Backward compat helpers
'openclaw/extension-api'            // Full extension API

// What's NOT importable (internal, relative imports only):
// createTelegramBot, createDiscordBot, etc.
// Channel implementations live in extensions/ with ../../.. imports
```

## Appendix C: Flightdeck's Existing MessagingAdapter Interface

```typescript
// packages/server/src/integrations/types.ts
interface MessagingAdapter {
  readonly platform: MessagingPlatform;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  sendMessage(message: OutboundMessage): Promise<void>;
  onMessage(handler: (message: InboundMessage) => void): void;
}

// Adding a new channel = implement this interface + register in IntegrationRouter
// No architectural changes needed. Pattern proven by TelegramAdapter (433 LOC).
```
