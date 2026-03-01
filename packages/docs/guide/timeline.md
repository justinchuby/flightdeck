# Timeline UI

The Timeline UI visualizes your AI crew's activity over time. It shows agent lifecycles, status changes, inter-agent communications, and file locks on an interactive swim-lane chart.

> [!TIP]
> The Timeline is accessible from the dashboard sidebar. It updates in real-time via SSE (Server-Sent Events), with automatic HTTP polling fallback.

## What You See

The timeline displays four types of information:

| Element | What it shows |
|---------|--------------|
| **Agent lanes** | Horizontal bars colored by status (running, idle, failed, etc.) |
| **Communication links** | S-curve lines between agents showing messages, delegations, broadcasts, and group chats |
| **File locks** | 🔒 icons on agent lanes indicating when files are locked |
| **Minimap** | A compressed overview at the top with a draggable brush for time range selection |

### v1 Components

| Component | Purpose |
|-----------|---------|
| **StatusBar** | Crew health at a glance — status buckets, overall health (green/yellow/red), connection indicator, narrative sentence |
| **ErrorBanner** | Expandable sticky notification when errors exist below the viewport fold |
| **EmptyState** | Welcoming screen when no agents are active yet |
| **KeyboardShortcutHelp** | Keyboard shortcut overlay toggled with `?` key |
| **AccessibilityAnnouncer** | Invisible ARIA live regions for screen reader announcements |

## Quick Start

The Timeline is rendered as a page-level component. If you're working on the dashboard, it's already wired up:

```tsx
import { TimelinePage } from '@/components/Timeline';

// TimelinePage handles lead selection, filters, and data fetching internally
<TimelinePage api={api} ws={ws} />
```

For direct access to the core visualization (e.g., embedding in a custom layout):

```tsx
import { TimelineContainer, useTimelineData, StatusBar } from '@/components/Timeline';

function MyTimeline({ leadId }: { leadId: string }) {
  const { data, loading, error, connectionHealth } = useTimelineData(leadId);

  if (loading || !data) return <div>Loading...</div>;

  return (
    <>
      <StatusBar data={data} connectionHealth={connectionHealth} />
      <TimelineContainer
        data={data}
        liveMode={true}
        onLiveModeChange={(live) => console.log('Live mode:', live)}
      />
    </>
  );
}
```

## Components

The Timeline is composed of several components:

```
TimelinePage
├── Lead selector (when multiple leads exist)
├── Filter toolbar (roles, communication types, status toggles)
├── StatusBar (crew health, connection, errors, narrative sentence)
├── ErrorBanner (sticky expandable error list)
├── AccessibilityAnnouncer (invisible live regions)
├── EmptyState (shown when no agents/project)
└── TimelineContainer
    ├── Zoom controls + Live mode toggle + Sort direction toggle
    ├── BrushTimeSelector (minimap)
    ├── Agent labels (fixed left column, color-coded borders)
    ├── "You left off here" marker (from useSinceLastVisit)
    ├── KeyboardShortcutHelp overlay (toggled with ?)
    └── SVG timeline area
        ├── Time axis (@visx/axis)
        ├── Agent lanes (status segments + lock indicators, error auto-expand)
        └── CommunicationLinks (SVG overlay)
```

See the [Component API Reference](/reference/timeline-api) for props and configuration details.

## Filters

Click the **Filter** button in the toolbar to reveal filter controls:

- **Roles** — Toggle visibility per role (Lead, Architect, Developer, etc.)
- **Communication** — Toggle link types (Delegation, Message, Group, Broadcast)
- **Hide agents** — Hide agents by terminal status (completed, terminated)

Active filter count is shown on the Filter button. Click **Reset all** to clear filters.

> [!IMPORTANT]
> The StatusBar (v1) always shows **unfiltered** crew health. Filters only affect the timeline visualization, not the status counts.

## Zoom & Navigation

| Action | Input |
|--------|-------|
| Zoom in | `Ctrl/Cmd + Scroll wheel`, `+` key, or zoom toolbar button |
| Zoom out | `Ctrl/Cmd + Scroll wheel`, `-` key, or zoom toolbar button |
| Pan left/right | `←` / `→` arrow keys |
| Fit to view | **Fit** button or `Home` key |
| Jump to recent | `End` key (shows last 20% of timeline) |
| Sort direction | Toggle button in toolbar (↑ oldest-first / ↓ newest-first) |
| Focus filter bar | `f` key (dispatches `timeline:focus-filter` custom event) |
| Keyboard help | `?` key — opens/closes shortcut overlay |

Zoom anchors to the cursor position when using scroll wheel, and to the center when using keyboard shortcuts.

### Live Mode

When **Live** is enabled (green indicator), the timeline auto-scrolls to show the latest activity as new data arrives. Zooming or panning disables Live mode to preserve your view.

### Minimap Brush

The minimap at the top shows a compressed overview of all agent activity. Drag the brush handles to select a time range, or drag the brush body to pan. The minimap and zoom controls stay in sync.

### Agent Colors

Each agent lane has a 3px color-coded left border, deterministically assigned from an 8-color WCAG AA palette based on agent ID hash. Import `getAgentColor(agentId)` from `getAgentColor.ts` if you need the same color elsewhere.

### Error Auto-Expand

Agents with `failed` segments are automatically expanded so errors are visible immediately. If a user manually collapses an error lane, it stays collapsed (user intent is respected).

## Data Model

Timeline data is delivered via SSE (`/api/coordination/timeline/stream?leadId={leadId}`) with HTTP polling fallback every 5 seconds.

```typescript
interface TimelineData {
  agents: TimelineAgent[];          // Agent lifecycles and status segments
  communications: TimelineComm[];   // Inter-agent messages and delegations
  locks: TimelineLock[];            // File lock events
  timeRange: { start: string; end: string };
  sessionId?: string;
  ledgerVersion?: number;           // Increments on prune/reorder — use for cache invalidation
}
```

See the [API Reference](/reference/timeline-api) for the complete type definitions.

## Further Reading

- [Component API Reference](/reference/timeline-api) — Props tables for all components
- [Accessibility Guide](/guide/timeline-accessibility) — Keyboard navigation, screen reader support
- [Architecture Overview](/guide/timeline-architecture) — Data flow, component hierarchy, migration roadmap
