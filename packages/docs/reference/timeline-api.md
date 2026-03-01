# Timeline API Reference

Component props and type definitions for the Timeline UI.

## Data Types

These types are exported from `@/components/Timeline/useTimelineData`.

### TimelineStatus

```typescript
type TimelineStatus = 'creating' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated';
```

### CommType

```typescript
type CommType = 'delegation' | 'message' | 'group_message' | 'broadcast';
```

### TimelineSegment

A contiguous period where an agent has a specific status.

```typescript
interface TimelineSegment {
  status: TimelineStatus;
  startAt: string;       // ISO 8601 timestamp
  endAt?: string;        // undefined = still in progress
  taskLabel?: string;    // Displayed on running segments when space permits
}
```

### TimelineAgent

An agent's full lifecycle in the timeline.

```typescript
interface TimelineAgent {
  id: string;            // Full agent UUID
  shortId: string;       // 8-character prefix for display
  role: string;          // e.g., 'developer', 'architect', 'lead'
  model?: string;        // AI model name (e.g., 'claude-sonnet-4')
  createdAt: string;     // ISO 8601
  endedAt?: string;      // undefined = still active
  segments: TimelineSegment[];
}
```

### TimelineComm

A communication event between agents.

```typescript
interface TimelineComm {
  type: CommType;
  fromAgentId: string;
  toAgentId?: string;    // undefined for broadcasts and group messages
  groupName?: string;    // Present on group_message events
  summary: string;       // Message content preview
  timestamp: string;     // ISO 8601
}
```

### TimelineLock

A file lock event.

```typescript
interface TimelineLock {
  agentId: string;
  filePath: string;
  acquiredAt: string;    // ISO 8601
  releasedAt?: string;   // undefined = still held
}
```

### TimelineData

The top-level data shape returned by the API and consumed by all timeline components.

```typescript
interface TimelineData {
  agents: TimelineAgent[];
  communications: TimelineComm[];
  locks: TimelineLock[];
  timeRange: { start: string; end: string };
}
```

## Hooks

### useTimelineData

Fetches timeline data for a given lead and polls every 5 seconds.

```typescript
function useTimelineData(leadId: string | null): {
  data: TimelineData | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}
```

| Return | Type | Description |
|--------|------|-------------|
| `data` | `TimelineData \| null` | Timeline data, or `null` before first load |
| `loading` | `boolean` | `true` during fetch |
| `error` | `string \| null` | Error message if fetch failed |
| `refetch` | `() => Promise<void>` | Manually trigger a re-fetch |

**Polling:** Every 5 seconds via `setInterval`. Polling starts when `leadId` is non-null and stops on unmount or when `leadId` changes.

### getLocksForAgent

Utility to filter locks by agent.

```typescript
function getLocksForAgent(locks: TimelineLock[], agentId: string): TimelineLock[]
```

## Components

### TimelinePage

Top-level page component that handles lead selection, filters, and data fetching.

```typescript
interface Props {
  api: any;   // API client instance
  ws: any;    // WebSocket client instance
}
```

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `api` | `any` | Yes | API client for REST calls |
| `ws` | `any` | WebSocket client for real-time events |

**Behavior:**
- Auto-selects the first lead agent on mount
- Shows a lead selector when multiple leads exist
- Provides filter toolbar (roles, communication types, hidden statuses)
- Passes filtered data to `TimelineContainer`

### TimelineContainer

The main visualization component. Renders the SVG timeline with agent lanes, communication links, zoom controls, and the minimap.

```typescript
interface TimelineContainerProps {
  data: TimelineData;
  liveMode?: boolean;
  onLiveModeChange?: (live: boolean) => void;
}
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `TimelineData` | required | The timeline data to render |
| `liveMode` | `boolean` | `undefined` | When true, auto-scrolls to show latest activity |
| `onLiveModeChange` | `(live: boolean) => void` | `undefined` | Called when live mode is toggled (e.g., user zooms, disabling live mode) |

**Internal state:**
- `expandedAgents` — Set of agent IDs with expanded lanes (56px → 160px)
- `focusedLaneIdx` — Currently focused lane for keyboard navigation
- `visibleRange` — Visible time window `{ start: Date; end: Date }`

**Agent sorting:** Agents are sorted by role hierarchy (Lead → Architect → Secretary → Developer → Code Reviewer → Critical Reviewer → Designer → QA), then by spawn time.

**Empty state:** When `data.agents` is empty, shows "No agent activity to display."

### BrushTimeSelector

Minimap component with a draggable brush for time range selection.

```typescript
interface BrushTimeSelectorProps {
  fullRange: { start: Date; end: Date };
  visibleRange: { start: Date; end: Date };
  onRangeChange: (range: { start: Date; end: Date }) => void;
  agents: TimelineAgent[];
  width: number;
}
```

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `fullRange` | `{ start: Date; end: Date }` | Yes | Full time range of the project |
| `visibleRange` | `{ start: Date; end: Date }` | Yes | Currently visible time range (controlled) |
| `onRangeChange` | `(range) => void` | Yes | Called when brush selection changes |
| `agents` | `TimelineAgent[]` | Yes | Agents for the mini-timeline background |
| `width` | `number` | Yes | Component width from parent |

**Height:** Fixed at 48px. Shows mini-colored bars for each agent's status segments as background.

**Brush behavior:** Degenerate ranges (<1 second) are rejected. The brush syncs bidirectionally with external zoom controls via `ref.updateBrush()`.

### CommunicationLinks

SVG overlay that renders communication lines between agent lanes.

```typescript
interface CommunicationLinksProps {
  communications: Communication[];
  agentPositions: Map<string, number>;  // agentId → y position
  xScale: ScaleTime<number, number>;
  laneHeight: number;
  visibleTimeRange?: [Date, Date];      // Performance culling
}
```

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `communications` | `Communication[]` | Yes | Communication events to render |
| `agentPositions` | `Map<string, number>` | Yes | Map of agent ID to lane Y position |
| `xScale` | `ScaleTime` | Yes | @visx time scale for X positioning |
| `laneHeight` | `number` | Yes | Height of each agent lane |
| `visibleTimeRange` | `[Date, Date]` | No | Only render links within this range (performance) |

**Link styles by type:**

| Type | Color | Line Style | Marker |
|------|-------|-----------|--------|
| Delegation | Blue (`rgba(88,166,255,0.6)`) | Solid, 2px | Arrow → |
| Message | Purple (`rgba(163,113,247,0.5)`) | Dashed, 1.5px | Circle ● |
| Group Message | Gold (`rgba(210,153,34,0.5)`) | Dotted, 1.5px | Diamond ◆ |
| Broadcast | Pink (`rgba(247,120,186,0.4)`) | Dotted, 1px | Star ★ |

**Missing targets:** When `toAgentId` is undefined (broadcasts, group messages) or the target agent isn't visible, a short horizontal stub with a **?** is rendered. Tooltip still shows the group name or "?" as appropriate.

**Performance:** Links are capped at 500 visible links (`MAX_VISIBLE_LINKS`). Links outside `visibleTimeRange` are skipped.

### StatusBar

Displays unfiltered crew health at a glance. Derives status counts internally from the raw `TimelineData` — always shows global status regardless of timeline filters.

```typescript
type ConnectionHealth = 'connected' | 'connecting' | 'reconnecting' | 'degraded' | 'offline';
type OverallHealth = 'green' | 'yellow' | 'red';

interface StatusBarProps {
  data: TimelineData | null;
  connectionHealth?: ConnectionHealth;   // default: 'connected'
  newEventCount?: number;                // default: 0
  onErrorClick?: () => void;
}
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `data` | `TimelineData \| null` | required | Unfiltered timeline data — StatusBar always shows full crew state |
| `connectionHealth` | `ConnectionHealth` | `'connected'` | Server connection status indicator (5 states) |
| `newEventCount` | `number` | `0` | Count of new events since last visit (from `useSinceLastVisit` hook) |
| `onErrorClick` | `() => void` | — | Called when user clicks the error count link |

**Internal derivation:** StatusBar computes status buckets, error count, overall health (green/yellow/red), and a template narrative sentence internally from `data`. No pre-computed counts needed.

**Overall health logic:**
- 🟢 **Green** — No errors, connection healthy
- 🟡 **Yellow** — Terminated agents, or connection degraded/reconnecting
- 🔴 **Red** — Failed agents, or connection offline

**Template narrative:** Displayed on medium+ screens: "Your crew has N active agents. M errors need attention." or "All systems normal."

**Accessibility:** Renders with `role="status"`, `aria-live="polite"`, `aria-atomic="true"`. Error count button uses `aria-live="assertive"`. Connection health changes announced via dedicated `aria-live` region.

### ErrorBanner

Persistent error indicator that appears when errors exist below the viewport fold. Shows an expandable list of errors with click-to-scroll.

```typescript
interface ErrorEntry {
  id: string;              // Unique identifier for scrolling to this error
  agentLabel: string;      // Agent role or name that produced the error
  message: string;         // Short error description
}

interface ErrorBannerProps {
  errors: ErrorEntry[];
  onScrollToError: (errorId: string) => void;
  onDismiss?: () => void;
}
```

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `errors` | `ErrorEntry[]` | Yes | Errors currently below the fold |
| `onScrollToError` | `(errorId: string) => void` | Yes | Called when user clicks an error to scroll to it |
| `onDismiss` | `() => void` | No | Called when banner is dismissed |

**Behavior:**
- Expands/collapses to show individual error entries
- Clicking an error scrolls to it and auto-dismisses the banner
- Auto-dismisses via IntersectionObserver when user scrolls past errors
- Reappears when new errors arrive (tracks error count changes)
- User can manually dismiss with X button

**Accessibility:** `role="alert"`, `aria-live="assertive"`. Expand toggle and dismiss button have descriptive `aria-label`. Error list uses `role="list"` with individual `aria-label` on each entry.

### EmptyState

Welcoming screen shown when no agents are active.

```typescript
interface EmptyStateProps {
  title?: string;          // default: 'No crew activity yet'
  description?: string;    // default: 'Start a project to see your AI agents...'
}
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | `'No crew activity yet'` | Override the heading |
| `description` | `string` | `'Start a project to see your AI agents collaborate in real time...'` | Override the description text |

**Accessibility:** `role="status"` with `aria-label` matching the title.

### useSinceLastVisit

Hook that tracks the last-seen event ID in localStorage. Enables "since last visit" badges and markers.

```typescript
function useSinceLastVisit(
  eventIds: string[],      // Ordered array of all event IDs (oldest first)
  sessionKey: string,      // Unique key for this session (e.g., lead agent ID)
): SinceLastVisitResult;

interface SinceLastVisitResult {
  newEventCount: number;            // Events since last visit (0 on first visit)
  lastSeenMarkerPosition: number;   // Index in eventIds, or -1 if not found
  markAsSeen: () => void;           // Persist current latest event as seen
}
```

**Behavior:**
- Reads `lastSeenEventId` from `localStorage` on mount
- If the stored ID references a pruned/missing event, treats as first visit (graceful fallback)
- Auto-persists on page unload (`beforeunload`) and visibility change (`visibilitychange`)
- Call `markAsSeen()` manually to mark all current events as seen

### AccessibilityAnnouncer

Renders invisible ARIA live regions for screen reader announcements. Place once at the top of the Timeline component tree.

```typescript
interface AccessibilityAnnouncerProps {
  announcements: AccessibilityAnnouncements;  // from useAccessibilityAnnouncements hook
}
```

Renders two hidden `<div>` elements:
- **Polite** (`aria-live="polite"`, `role="log"`) — new events, status updates (throttled)
- **Assertive** (`aria-live="assertive"`, `role="alert"`) — errors, connection changes (immediate)

## Visual Reference

### Status Colors

| Status | Fill | Border | Meaning |
|--------|------|--------|---------|
| Creating | `rgba(210,153,34,0.3)` | `#d29922` | Agent is being spawned |
| Running | `rgba(63,185,80,0.3)` | `#3fb950` | Agent is actively working |
| Idle | Hatch pattern | `#484f58` | Agent is waiting for input |
| Completed | `rgba(88,166,255,0.3)` | `#58a6ff` | Agent finished successfully |
| Failed | `rgba(248,81,73,0.3)` | `#f85149` | Agent encountered an error |
| Terminated | `rgba(240,136,62,0.3)` | `#f0883e` | Agent was stopped |

### Role Colors (Lane Border)

| Role | Color | Icon |
|------|-------|------|
| Lead | `#d29922` | 👑 |
| Architect | `#f0883e` | 🏗 |
| Developer | `#3fb950` | 👨‍💻 |
| Code Reviewer | `#a371f7` | 🔍 |
| Critical Reviewer | `#a371f7` | 🛡 |
| Designer | `#f778ba` | 🎨 |
| Secretary | `#79c0ff` | 📋 |
| QA Tester | `#79c0ff` | 🧪 |
| Tech Writer | — | 📝 |

### Layout Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `LABEL_WIDTH` | 180px | Fixed width of agent label column |
| `LANE_HEIGHT` | 56px | Collapsed lane height |
| `LANE_HEIGHT_EXPANDED` | 160px | Expanded lane height |
| `LANE_GAP` | 2px | Vertical gap between lanes |
| `AXIS_HEIGHT` | 32px | Height of the time axis |
| `BRUSH_HEIGHT` | 48px | Height of the minimap |
| `MIN_VISIBLE_MS` | 5,000ms | Minimum zoom level (5 seconds) |

## Known Issues

| Issue | Description | Status |
|-------|-------------|--------|
| Zoom at cursor | Zooming snaps to viewport center instead of cursor position | Open |
| Zoom pops back | After zooming via brush, the view range occasionally resets to full extent | Open |
| Minimap stale | BrushTimeSelector can show stale selection after rapid zoom interactions | Open |
