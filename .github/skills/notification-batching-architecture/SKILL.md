---
name: notification-batching-architecture
description: How the NotificationBatcher and IntegrationRouter work together for external messaging (Telegram, Slack, etc.). Use when adding new messaging integrations or modifying notification delivery.
---

# Notification Batching Architecture

Flightdeck batches notifications before sending them to external channels (Telegram, Slack, etc.) to avoid flooding users with individual messages. The architecture separates **routing** from **batching** from **delivery**.

## Architecture Overview

```
Agent Events (messages, decisions, errors)
    │
    ▼
IntegrationRouter          ← Routes events to the correct channel
    │
    ▼
NotificationBatcher        ← Collects events, debounces, batches
    │
    ▼
Channel Adapter            ← Delivers to Telegram, Slack, etc.
    (TelegramBot)
```

### IntegrationRouter

Deterministic message routing based on event type and user preferences:

```typescript
class IntegrationRouter {
  route(event: AgentEvent): void {
    const channels = this.getChannelsForEvent(event);
    for (const channel of channels) {
      this.batchers.get(channel)?.add(event);
    }
  }
}
```

The router does NOT send messages directly. It adds events to the appropriate batcher.

### NotificationBatcher

Collects events and flushes them as a single batch after a debounce window:

```typescript
class NotificationBatcher {
  private buffer: AgentEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly debounceMs = 5000; // 5-second window

  add(event: AgentEvent): void {
    this.buffer.push(event);
    this.resetTimer();
  }

  private resetTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private flush(): void {
    const batch = this.buffer.splice(0);
    if (batch.length > 0) {
      this.channel.sendBatch(batch);
    }
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // Remove event listeners to prevent leaks
    this.removeAllListeners();
  }
}
```

### Key Design Decisions

1. **5-second debounce** — Agents produce bursts of events (10+ messages in seconds). Batching prevents notification fatigue.
2. **Flush on stop** — When the batcher stops (server shutdown), any buffered events are flushed immediately.
3. **Event listener cleanup** — The `stop()` method MUST remove all listeners to prevent memory leaks.
4. **Per-channel batchers** — Each external channel (Telegram, Slack) gets its own batcher instance with independent timers.

## Adding a New Channel

1. Create a channel adapter (e.g., `SlackBot.ts`) that implements `sendBatch(events)`
2. Register the channel in `IntegrationRouter`
3. The router creates a `NotificationBatcher` for the new channel automatically
4. Add the channel to the Settings UI notification preferences

## Security Considerations

- **Prompt injection sanitization** — Agent display names and message content are sanitized before reaching external channels. The 4-layer sanitization prevents malicious content from being forwarded to Telegram/Slack.
- **Token masking** — API tokens, secrets, and credentials are masked in notification content before delivery.
- **Challenge-response auth** — External channels must complete a challenge-response flow to bind to a Flightdeck session. This prevents unauthorized channels from receiving notifications.

## Anti-patterns

- **Sending messages directly from event handlers** — Always route through the batcher; direct sends bypass batching and flood the channel
- **Shared batcher across channels** — Each channel has different rate limits and formatting; use separate instances
- **Forgetting to call `stop()`** — Causes event listener leaks and orphaned timers
- **Batching without a max batch size** — If the server accumulates 1000+ events before flush, the batch message will be too large. Consider a max batch size cap.

## Related Skills

- **[messaging-integration-pattern](../messaging-integration-pattern/SKILL.md)** — Covers the broader architecture for adding external messaging platforms (Telegram, Slack, Discord) including routing, event pipeline, and implementation template. This skill focuses specifically on the batching layer within that architecture.
