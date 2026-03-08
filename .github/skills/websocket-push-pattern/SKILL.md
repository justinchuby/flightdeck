---
name: websocket-push-pattern
description: How to use the signal+refetch WebSocket push pattern for real-time UI updates. Use when adding real-time features or replacing polling with push-based updates.
---

# WebSocket Push Pattern (Signal + Refetch)

Flightdeck uses a "signal + refetch" pattern for real-time UI updates instead of pushing full payloads over WebSocket or polling on timers. This pattern provides sub-3-second latency while keeping the data layer simple and cacheable.

## Why Signal + Refetch (not Full Payload Push)

| Approach | Latency | Complexity | Cache-friendly | Partial updates |
|----------|---------|-----------|----------------|-----------------|
| Polling (10s) | ~5s avg | Low | ✅ Yes | ❌ No |
| Full payload push | ~200ms | High (schema sync) | ❌ No | ❌ Fragile |
| **Signal + refetch** | **~400ms** | **Low** | **✅ Yes** | **✅ Yes** |

Full payload push requires the server to serialize the exact shape the client expects — any schema drift causes bugs. Signal + refetch lets the client fetch from REST (which it already knows how to do), so the server only needs to say "something changed."

## Pattern

### Server Side

Emit a lightweight WebSocket signal when data changes. The signal carries minimal metadata — just enough for the client to know *what* changed.

```typescript
// Server: emit signal when attention items change
ws.emit('attention:updated', { timestamp: Date.now() });

// NOT this — don't push the full payload
// ws.emit('attention:updated', { items: [...allItems], escalation: 'yellow' });
```

### Client Side

Listen for the signal, then refetch from the existing REST endpoint.

```typescript
function useAttentionItems() {
  const [items, setItems] = useState<AttentionItem[]>([]);

  // Initial fetch
  useEffect(() => {
    fetchAttentionItems().then(setItems);
  }, []);

  // Real-time updates via signal
  useEffect(() => {
    const handler = () => {
      fetchAttentionItems().then(setItems);
    };
    ws.on('attention:updated', handler);
    return () => ws.off('attention:updated', handler);
  }, []);

  return items;
}
```

### Debounce Rapid Signals

If the server emits signals in bursts (e.g., multiple tasks completing), debounce on the client to avoid thundering refetches:

```typescript
useEffect(() => {
  let timeout: NodeJS.Timeout;
  const handler = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      fetchAttentionItems().then(setItems);
    }, 300); // 300ms debounce
  };
  ws.on('attention:updated', handler);
  return () => {
    ws.off('attention:updated', handler);
    clearTimeout(timeout);
  };
}, []);
```

## When to Use This Pattern

- **Real-time dashboard updates** — AttentionBar, task status, agent health
- **Replacing polling** — Any `setInterval` fetch can be converted to signal + refetch
- **Multi-client consistency** — All clients refetch the same REST endpoint, so they always see consistent data

## When NOT to Use This Pattern

- **Streaming text** (agent output) — Use direct WebSocket push; refetching would lose the streaming effect
- **High-frequency updates** (>10/sec) — Debounce aggressively or use direct push
- **Binary data** — Use direct transfer, not signal + refetch

## Anti-patterns

- **Pushing full payloads** — Creates tight coupling between WS event schema and client expectations
- **Polling as fallback without cleanup** — If you add WS push, remove the polling timer
- **No debounce on burst signals** — Can cause 10+ simultaneous fetches

## Related Skills

- **[deterministic-ws-signals](../deterministic-ws-signals/SKILL.md)** — Complementary skill covering *when* to use server-side WebSocket signals (deterministic events vs. client heuristics). This skill covers *how* to implement the signal+refetch pattern on the client side.
