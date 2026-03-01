# Chat UI Architecture

How the Chat Panel renders agent conversations, handles streaming tokens, and stays responsive with large chat histories.

## Architecture Overview

The Chat UI is two components:

```
ChatPanel (220 lines)
├── Header (agent role, icon, expand/collapse)
├── AcpOutput (538 lines)
│   ├── Plan section (collapsible checklist)
│   ├── Tool calls section (status badges)
│   ├── Timeline (messages + activity, sorted by timestamp)
│   └── Queued messages (sent but not yet processed)
└── Input area (textarea + mention autocomplete + broadcast toggle)
```

**ChatPanel** (`ChatPanel.tsx`) owns the header, input textarea, and @mention autocomplete. It sends user input via WebSocket and records user messages in the Zustand store.

**AcpOutput** (`AcpOutput.tsx`) renders the message history. It merges two data sources — agent messages (from `appStore`) and activity events (from `leadStore`) — into a single sorted timeline array.

**Files:** Both live in `packages/web/src/components/ChatPanel/`.

## Rendering Strategy

### No Virtualization (Deliberately)

AcpOutput renders all timeline items as DOM nodes via `timeline.map()`. There is no windowing library (@tanstack/virtual, react-window, etc.).

**Why this works at current scale:**
- Typical agent conversations are <500 messages per session
- Variable-height messages (code blocks, tables, images) are handled naturally by CSS `whitespace-pre-wrap`
- The DOM can handle thousands of lightweight `<div>` elements without jank

**Trade-off:** This approach trades memory for simplicity. Virtualization would reduce DOM nodes but adds complexity for variable-height items, scroll anchoring, and streaming text that grows mid-render.

### Timeline Merge

Messages and activity events are merged into a single sorted array:

```typescript
type TimelineItem =
  | { kind: 'message'; msg: Message; index: number }
  | { kind: 'activity'; evt: ActivityEvent };

// Merged and sorted by timestamp
timeline.sort((a, b) => timestampOf(a) - timestampOf(b));
```

This runs on every render — `O(n log n)` per update. At current scale (<500 items) this is imperceptible. For very large histories, this would be the first candidate for memoization.

### Message Types

AcpOutput renders five message variants:

| Sender | Visual | Description |
|--------|--------|-------------|
| `user` | Right-aligned blue bubble | User input messages |
| `agent` | Left-aligned flowing text | Agent responses with inline markdown |
| `thinking` | Italic, muted | Agent reasoning/thinking tokens |
| `system` | Centered, muted | System messages (separators, notifications) |
| `activity` | Inline, tiny timestamp | Activity events (tool calls, delegations, completions) |

Agent text is parsed for inline markdown (`**bold**`, `*italic*`, `` `code` ``), tables, and `[[[ command ]]]` blocks (rendered as collapsible sections).

## Streaming Implementation

This is the single most important performance decision in the Chat UI.

### Token Concatenation Pattern

When the AI model streams tokens, the WebSocket handler in `useWebSocket.ts` appends each token to the **last message's text string** rather than creating a new message per token:

```typescript
// useWebSocket.ts — agent:text handler (simplified)
case 'agent:text': {
  const msgs = [...existing.messages];
  const last = msgs[msgs.length - 1];

  if (last && last.sender === 'agent') {
    // Append to existing message — one object per agent turn
    msgs[msgs.length - 1] = { ...last, text: last.text + rawText };
  } else {
    // First token of a new turn — create new message
    msgs.push({ type: 'text', text: rawText, sender: 'agent', timestamp: Date.now() });
  }

  updateAgent(msg.agentId, { messages: msgs });
}
```

**Why this matters:** A typical agent response is 50–200 tokens. Without concatenation, each token would create a new message object and a new DOM node — resulting in hundreds of React re-renders and DOM mutations per response. With concatenation, there's one message object per agent turn that grows in place.

The `agent:thinking` handler follows the same pattern — appending to the last thinking message rather than creating new ones.

### Unclosed Command Handling

The handler detects unclosed `[[[ ... ]]]` command blocks and always appends to keep multi-token commands intact, even across message boundaries.

## State Management

### Zustand Store (`appStore`)

Agent state lives in a flat Zustand store:

```typescript
// appStore.ts
interface AppStore {
  agents: AgentInfo[];
  updateAgent: (id: string, patch: Partial<AgentInfo>) => void;
  // ...
}
```

Each `AgentInfo` contains `messages`, `plan`, `toolCalls`, and agent metadata. `updateAgent` replaces the entire `agents` array on every call (immutable update).

### Selector Pattern

AcpOutput subscribes to a single agent via Zustand selector:

```typescript
const agent = useAppStore((s) => s.agents.find((a) => a.id === agentId));
```

This means AcpOutput re-renders when **any** agent is updated, not just the selected one — the selector returns a new object reference whenever the agents array changes. This is a known trade-off: simple selector vs. memoized selector.

### Activity Events

Activity events come from a separate store (`leadStore`) and are filtered per-agent at render time:

```typescript
const allProjects = useLeadStore((s) => s.projects);
for (const proj of Object.values(allProjects)) {
  for (const evt of proj.activity) {
    if (evt.agentId === agentId) agentActivity.push(evt);
  }
}
```

## Scroll Behavior

### Auto-scroll with User Override

AcpOutput auto-scrolls to the bottom when new messages arrive, **unless** the user has scrolled up to read history:

```typescript
useEffect(() => {
  const el = containerRef.current;
  if (!el) return;
  const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  if (isNearBottom) {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }
}, [messages]);
```

**150px threshold:** If the user is within 150px of the bottom, new messages trigger a smooth scroll. If they've scrolled further up, the view stays put.

**Sentinel div:** A zero-height `<div ref={messagesEndRef} />` sits at the end of the timeline. `scrollIntoView` on this element is simpler and more reliable than calculating scroll positions.

### No Scroll Anchoring

There is no CSS `overflow-anchor` or JavaScript scroll anchoring. When new content is inserted above the viewport (e.g., activity events with earlier timestamps), the scroll position may shift. At current message volumes this is rarely noticeable.

### Message Queue UX

Messages sent to a busy agent are marked as `queued` and shown in a separate section below the timeline with a dashed border. Users can reorder or remove queued messages. When the agent responds, queued messages are promoted to the main timeline.

## Performance Patterns

### What's Optimized

| Pattern | Impact | Location |
|---------|--------|----------|
| **Token concatenation** | Prevents 100s of messages per turn | `useWebSocket.ts:94-111` |
| **CSS text wrapping** | No JS layout calculation for variable heights | `whitespace-pre-wrap` on all message types |
| **Content truncation** | Tool call output capped at 500 chars | `stringifyContent()` in `AcpOutput.tsx` |
| **Collapsible commands** | `[[[ ]]]` blocks collapsed by default, render full text on demand | `CollapsibleCommandBlockSimple` |
| **Mention filtering** | `useMemo` on active agents and mention suggestions | `ChatPanel.tsx:30-43` |

### What's Not Optimized (and Why)

| Pattern | Risk | When It Matters |
|---------|------|-----------------|
| No `React.memo` on message components | Extra re-renders on parent updates | >1000 messages per agent |
| No `useMemo` on timeline sort | `O(n log n)` per render | >500 timeline items |
| `updateAgent` scope too broad | Re-renders all ChatPanels on any agent update | >10 agents with open panels |
| No virtualization | All DOM nodes rendered | >2000 messages per agent |

**Design philosophy:** The Chat UI is deliberately simple. It prioritizes code clarity and correctness over premature optimization. Every "missing" optimization has a clear scaling threshold where it would matter, and none of those thresholds are hit in typical usage (3–8 agents, <500 messages each).

### If You Need to Scale

In order of impact:

1. **Memoize the selector** — Use `useAppStore(useShallow(s => s.agents.find(...)))` or extract a dedicated `useAgent(id)` hook to prevent cross-agent re-renders
2. **Memoize the timeline sort** — Wrap in `useMemo` with `[messages, agentActivity]` deps
3. **Add `React.memo`** to message components — Prevents re-rendering unchanged messages
4. **Virtualize** — Add `@tanstack/react-virtual` for histories >2000 messages (requires solving variable-height measurement)
