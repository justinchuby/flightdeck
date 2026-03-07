---
name: deterministic-ws-signals
description: When to use deterministic server-side WebSocket signals instead of client-side heuristics for UI state transitions
---

# Deterministic WebSocket Signals

When the client needs to know about server-side state transitions (e.g., new sampling turn, new message bubble), always use a deterministic server-emitted WebSocket event rather than client-side heuristics (time gaps, content analysis).

## Why

The server knows exactly when state changes occur. Client-side heuristics — time-based gap detection, content-based analysis — are fragile and produce inconsistent behavior across different network conditions and workloads.

## Pattern

Emit a lightweight event (e.g., `agent:response_start`) synchronously **before** the async operation begins. WebSocket in-order delivery guarantees the event arrives before any data from the new state.

```typescript
// Server-side: emit signal before starting new turn
ws.emit('agent:response_start', { agentId, turnId });
await agent.processNextTurn(); // data follows the signal
```

## Anti-patterns

- **Time-based gap detection**: "If no message for 500ms, assume new turn" — breaks under load
- **Content-based heuristics**: "If message starts with X, it's a new bubble" — brittle and inconsistent
- **Client-side polling**: Adds latency and complexity vs. a push signal
