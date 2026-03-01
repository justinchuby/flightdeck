# Timeline Architecture

How data flows from the server to the timeline visualization, the component hierarchy, and the roadmap for future improvements.

## Data Flow

```
Server (SQLite + ActivityLedger)
    │
    ├─► SSE: /api/coordination/timeline/stream?leadId={id}  (preferred)
    │       EventSource → useTimelineSSE hook
    │
    └─► Polling fallback: GET /api/coordination/timeline?leadId={id}
            fetch every 5s → useTimelinePolling hook
    │
    ▼
useTimelineData hook → { data, loading, error, connectionHealth, refetch }
    │
    ▼
TimelinePage (filters)
    │
    ▼
TimelineContainer (zoom, layout, keyboard nav)
    ├── StatusBar (crew health, connection, errors)
    ├── AccessibilityAnnouncer (screen reader live regions)
    ├── ErrorBanner (sticky error list)
    ├── BrushTimeSelector (minimap)
    ├── AgentLane × N (status segments, lock icons)
    └── CommunicationLinks (SVG overlay)
```

### Server → Client

The server's `ActivityLedger` stores all agent events in SQLite. The `/coordination/timeline` endpoint processes these events to build:

- **Agent segments** — contiguous status periods (creating → running → idle → completed)
- **Communications** — inter-agent messages, delegations, broadcasts, group chats
- **Locks** — file lock acquisitions and releases

**Transport:** `useTimelineData` tries SSE first via `useTimelineSSE`. If SSE is unavailable (server doesn't support it, or connection fails), it falls back to HTTP polling every 5 seconds via `useTimelinePolling`. The hook exposes a unified `connectionHealth` indicator regardless of transport.

> [!TIP]
> The `connectionHealth` value (`'connected'` | `'connecting'` | `'reconnecting'` | `'degraded'` | `'offline'`) is available from the hook and can be passed directly to `StatusBar`.

### Client State

Timeline state is **local React state**, not a Zustand store. Key state lives in `TimelineContainer`:

| State | Type | Purpose |
|-------|------|---------|
| `visibleRange` | `{ start: Date, end: Date }` | Current zoom/pan window |
| `expandedAgents` | `Set<string>` | Which agent lanes are expanded |
| `focusedLaneIdx` | `number` | Keyboard-focused lane index |

The `useAppStore` Zustand store provides the agent roster for lead selection, but the timeline does not read from or write to any Zustand store.

## Component Hierarchy

### TimelinePage

**Responsibility:** Page-level orchestration — lead selection, filter state, data fetching.

- Uses `useTimelineData(leadId)` for polling
- Uses `useAppStore` for the global agent list (lead selector)
- Applies filters to `TimelineData` before passing to `TimelineContainer`
- Manages filter UI (role chips, comm type chips, hidden status toggles)

### TimelineContainer

**Responsibility:** Core visualization — SVG rendering, zoom/pan, keyboard navigation.

~610 lines. This is the largest component and contains:
- Zoom logic (`zoomBy` with anchor fraction)
- Keyboard event handler (arrow keys, +/-, Home/End, Enter/Space, Tab, Escape)
- Lane layout calculation (Y positions, heights)
- Time scale (`@visx/scale` scaleTime)
- Synced scrolling between label column and SVG area
- Tooltip management for segment hover

**Key dependency:** `@visx/responsive` `ParentSize` wraps the content to provide width.

### BrushTimeSelector

**Responsibility:** Minimap with time range brush selection.

Uses `@visx/brush` for the draggable selection. Shows mini-colored bars for each agent's segments as background context.

**Bidirectional sync:** When zoom buttons change `visibleRange`, the brush position updates via `brushRef.updateBrush()`. When the user drags the brush, `onRangeChange` fires to update `visibleRange`.

### CommunicationLinks

**Responsibility:** SVG overlay rendering S-curve lines between agent lanes.

Resolves each communication to source/target Y positions, computes cubic bezier paths, and renders with type-specific styles (color, dash pattern, marker). Includes hover hit areas and tooltips.

**Performance:** Caps at 500 visible links. Supports `visibleTimeRange` prop for culling off-screen links.

### AgentLane (standalone)

**Note:** `TimelineContainer` has its own inline `AgentLane` sub-component. The standalone `AgentLane.tsx` export includes additional role icons (tech-writer, qa-tester) and a different visual style. The standalone version is not currently used by `TimelineContainer`.

## Dependencies

| Package | Usage in Timeline |
|---------|------------------|
| `@visx/responsive` | `ParentSize` container for responsive width |
| `@visx/scale` | `scaleTime` for X-axis time mapping |
| `@visx/axis` | `AxisTop` for time axis labels |
| `@visx/group` | SVG `<g>` grouping |
| `@visx/tooltip` | Segment and communication tooltips |
| `@visx/brush` | Minimap brush selection |
| `lucide-react` | Icons (Filter, RefreshCw, Wifi, AlertTriangle, etc.) |

No d3-zoom, no @tanstack/virtual are used. SSE uses native `EventSource`.

### Memory Caps

| Resource | Cap | Behavior |
|----------|-----|----------|
| Client `seenEventIds` (SSE dedup) | 10,000 | Prunes oldest half when exceeded |
| Server `EventPipeline.seenEventIds` | 20,000 (`MAX_QUEUE_SIZE * 2`) | Same prune strategy |
| Communication links rendered | 500 | Hard cap per render |
| Orphan events (server `OrphanManager`) | 500 | Oldest-first promotion to root |

## Known Bugs

These bugs are documented in the codebase exploration and are being tracked:

### Minimap Brush Sync

`initialBrushPosition` is memoized with `[]` deps — it only reflects the initial `visibleRange`, not subsequent changes. If `visibleRange` is already zoomed on mount, the brush starts at the wrong position. Additionally, the `updateBrush` call in the render body mutates refs during render, which is a React anti-pattern.

## v1 → v2 Migration Roadmap

The current architecture supports incremental improvement without a rewrite:

### ✅ Step 1: SSE Transport (Done)

`useTimelineSSE` provides real-time event delivery via Server-Sent Events. `useTimelineData` auto-selects SSE with polling fallback. Connection health is exposed for the StatusBar.

### ✅ Step 2: StatusBar + ErrorBanner + EmptyState (Done)

New v1 components added: `StatusBar` (crew health), `ErrorBanner` (sticky error list with scroll-to), `EmptyState` (welcome screen), `AccessibilityAnnouncer` (screen reader live regions), `useSinceLastVisit` (localStorage-based new-event tracking).

### Step 3: Extract Timeline Zustand Store

Move `visibleRange`, `expandedAgents`, `focusedLaneIdx`, and filter state from local React state into a dedicated Zustand store. Pattern already exists in `appStore.ts` and `settingsStore.ts`.

**Why:** Enables new components to read timeline state without prop drilling.

### Step 4: Decompose TimelineContainer

Break the 610-line monolith into focused components:
- `TimelineToolbar` — zoom controls, live mode toggle
- `TimelineSVG` — axis, lanes, communication overlay
- `AgentLabelColumn` — fixed-position agent labels

**Why:** Each component becomes independently testable and documentable.

### Step 5: Add Projections

Introduce projection functions that derive view-specific state from raw events:
- Chronological projection (Stream View)
- Agent-lane projection (Lanes View)
- Causal graph projection (Causality View)

**Why:** Enables the multi-view architecture (Narrative → Stream → Lanes → Raw) designed by the team.

> [!TIP]
> Each step is independently shippable. You can deploy after any step without breaking what works.
