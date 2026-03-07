# Flightdeck Web — Developer Guide

Quick reference for all APIs, hooks, components, and design tokens.

## API Endpoints

### Agents
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/agents` | List all agents |
| DELETE | `/agents/:id` | Terminate agent |
| POST | `/agents/:id/interrupt` | Interrupt agent |
| POST | `/agents/:id/restart` | Restart agent |
| POST | `/agents/:id/message` | Send message to agent |
| GET | `/agents/:id/messages?limit=200` | Get agent messages |
| POST | `/agents/:id/permission` | Resolve permission request |

### Sessions & Leads
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/lead` | List active leads |
| POST | `/lead/start` | Start new lead session |
| GET | `/lead/:id/progress` | Get lead progress |
| GET | `/lead/:id/dag` | Get task DAG |
| GET | `/lead/:id/decisions` | Get pending decisions |
| POST | `/lead/:id/message` | Send message to lead |
| GET | `/lead/:id/groups` | List groups |
| POST | `/lead/:id/groups` | Create group |
| DELETE | `/lead/:id` | Delete lead |

### Decisions
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/decisions/:id/approve` | Approve decision |
| POST | `/decisions/:id/reject` | Reject decision |
| POST | `/decisions/:id/respond` | Respond with text |
| POST | `/decisions/:id/feedback` | Send feedback |

### Natural Language
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/nl/commands` | List all 30 NL commands |
| POST | `/nl/preview` | Preview command before executing |
| POST | `/nl/execute` | Execute NL command |
| POST | `/nl/undo` | Undo last command |
| GET | `/nl/suggestions` | Context-aware suggestions |

### Onboarding
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/onboarding/status` | Get mastery status |
| POST | `/onboarding/progress` | Update progress |

### Predictions (Removed)

> **Note:** The Predictions API has been removed. The endpoints below are no longer active.
> See [Removed Components](#removed-components) for details.

### Workflows (Removed)

> **Note:** The Workflow Automation API has been removed. This feature was incomplete and is no longer available.

| GET | `/commits` | List commits |
| GET | `/commits/by-task/:taskId` | Commits for task |

### Conflicts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/conflicts` | Active conflicts |
| POST | `/conflicts/:id/resolve` | Resolve conflict |
| POST | `/conflicts/:id/dismiss` | Dismiss conflict |
| GET | `/conflicts/config` | Get config |
| PUT | `/conflicts/config` | Update config |

### Intent Rules
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/intents` | List all rules |
| POST | `/intents` | Create rule |
| PATCH | `/intents/:id` | Update rule |
| DELETE | `/intents/:id` | Delete rule |
| POST | `/intents/reorder` | Reorder rules by priority |
| GET | `/intents/presets` | Get available presets |
| POST | `/intents/presets/:preset` | Apply trust preset |

### Recovery
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/recovery/:eventId/approve` | Approve recovery |
| POST | `/recovery/:eventId/cancel` | Cancel recovery |
| POST | `/recovery/:eventId/briefing` | Get briefing |
| POST | `/settings/recovery` | Update settings |

### Playbooks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/playbooks` | List playbooks |
| POST | `/api/playbooks` | Create playbook |
| DELETE | `/api/playbooks/:id` | Delete playbook |
| POST | `/api/playbooks/:id/duplicate` | Duplicate |

### Community Playbooks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/playbooks/community` | Browse community |
| GET | `/playbooks/community/:id` | Get detail |
| POST | `/playbooks/community` | Publish |
| GET | `/playbooks/community/:id/reviews` | Get reviews |
| POST | `/playbooks/community/:id/reviews` | Submit review |
| POST | `/playbooks/community/:id/fork` | Fork playbook |

### Roles
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/roles` | List roles |
| POST | `/roles` | Create role |
| PUT | `/roles/:id` | Update role |
| DELETE | `/roles/:id` | Delete role |
| POST | `/roles/test` | Test role config |

### Session Replay
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/replay/:leadId/keyframes` | Get keyframes |
| POST | `/replay/:leadId/share` | Create share link |
| GET | `/api/shared/:token` | Get shared replay |

### Notifications & Handoffs
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/notifications/settings` | Update preferences |
| POST | `/handoffs/:recordId/deliver` | Deliver handoff |

### Projects & Data
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects` | List all projects |
| GET | `/projects/:id/dag` | Get project task DAG |
| GET | `/projects/:id/groups` | Get project chat groups |
| GET | `/data/stats` | Storage statistics |
| POST | `/data/cleanup` | Cleanup data by age |

### Analytics & Costs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/costs/by-agent` | Costs by agent |
| GET | `/api/costs/by-task` | Costs by task |
| GET | `/api/coordination/status` | Coordination status |
| GET | `/api/coordination/timeline` | Timeline events |

---

## React Hooks

All hooks are in `src/hooks/`. Import example: `import { useProjects } from '../hooks/useProjects';`

### Data Fetching Hooks

| Hook | Returns | Description |
|------|---------|-------------|
| `useApi()` | `{ spawnAgent, terminateAgent, updateConfig, createRole, ... }` | Core API client |
| `useFocusAgent(agentId)` | `{ data, loading, error, refresh }` | Polls agent activity, diffs, decisions |
| `useDiffSummary(agentId)` | `{ summary, loading }` | Lightweight diff stats |
| `useProjects()` | `{ projects, loading }` | Fetch projects from REST API |
| `useHistoricalAgents(projectId)` | `Agent[]` | Derive agent data from keyframes for historical sessions |
| `useConflicts()` | `{ conflicts, activeConflicts, loading, resolve, dismiss }` | Conflict alerts |
| `useConflictConfig()` | `{ config, saveConfig }` | Detection config |
| `useSessionReplay(leadId)` | `{ keyframes, worldState, playing, currentTime, seek, setSpeed, ... }` | Session replay (default 4× speed) |
| `useProjects()` | `{ projects, loading }` | Fetch projects from REST API |
| `useHistoricalAgents(projectId)` | `Agent[]` | Derive agent data from keyframes for historical sessions |

### UI State Hooks

| Hook | Returns | Description |
|------|---------|-------------|
| `useCommandPalette()` | `{ isOpen, open, close, toggle }` | ⌘K palette state |
| `useRecentCommands()` | `{ recent, addRecent, clearRecent }` | Recent command history (localStorage) |
| `useProgressiveRoutes()` | `{ tier, visibleRoutes, hiddenRoutes }` | Progressive sidebar disclosure |
| `useDashboardLayout()` | `{ panels, allPanels, togglePanel, movePanel, reorderPanels }` | Dashboard panel config |
| `useCanvasGraph(agents)` | `{ nodes, edges }` | React Flow graph from agents |
| `useCanvasLayout()` | `[layout, setLayout]` | Persisted canvas positions |
| `useSwipeGesture(handlers)` | `{ onTouchStart, onTouchMove, onTouchEnd, offsetX, offsetY }` | Touch swipe detection |
| `useSpotlight(selector)` | `SpotlightRect \| null` | DOM element rect for tutorials |
| `useAutoScroll(ref, deps)` | void | Auto-scroll container to bottom |
| `useIdleTimer(timeout)` | `{ isIdle }` | User inactivity detection |
| `useAttachments()` | `{ attachments, addAttachment, removeAttachment }` | File attachment state |
| `useFileDrop(onDrop)` | `{ isDragOver, handleDragOver, handleDrop, ... }` | Drag-and-drop files |
| `useGlassTooltips()` | void | Global `[title]` → glass tooltip conversion |

### WebSocket

```typescript
import { useWebSocket } from '../hooks/useWebSocket';
import { sendWsMessage } from '../hooks/useWebSocket';

const ws = useWebSocket(); // Full WS client
sendWsMessage({ type: 'queue_open' }); // Send from anywhere
```

---

## Shared Components

Import: `import { EmptyState, SkeletonCard, SkeletonList, ErrorPage } from '../components/Shared';`

### EmptyState

```tsx
<EmptyState
  icon="📊"
  title="No active sessions"
  description="Sessions appear when you create a project and agents start working."
  action={{ label: "Create Project →", onClick: () => navigate('/') }}
/>
// compact variant for inline use:
<EmptyState icon="📋" title="No items" compact />
```

Props: `icon?: string`, `title: string`, `description?: string`, `action?: { label, onClick }`, `compact?: boolean`, `children?: ReactNode`

### SkeletonCard / SkeletonList

```tsx
<SkeletonCard lines={3} showHeader showAvatar />
<SkeletonList count={5} />
```

SkeletonCard props: `lines?: number`, `showHeader?: boolean`, `showAvatar?: boolean`, `className?: string`
SkeletonList props: `count?: number`, `cardProps?: SkeletonCardProps`, `className?: string`

### ErrorPage

```tsx
<ErrorPage
  title="Failed to load agents"
  message="The server is unavailable."
  detail="ECONNREFUSED localhost:3001"
  statusCode={503}
  onRetry={() => refetch()}
  onGoHome={() => navigate('/')}
/>
```

Props: `title?: string`, `message?: string`, `detail?: string`, `statusCode?: number`, `onRetry?: () => void`, `onGoHome?: () => void`

### ProjectTabs

```tsx
import { ProjectTabs } from '../components/ProjectTabs/ProjectTabs';

<ProjectTabs
  selectedProjectId={projectId}
  onSelect={(id) => setProjectId(id)}
/>
```

Shared project selector with live-agent indicator dots and deduplication. Used on Overview, Timeline, Canvas, and Mission Control.

### CumulativeFlow

```tsx
import { CumulativeFlow } from '../components/OverviewPage/TaskBurndown';

<CumulativeFlow data={flowData} />
// flowData: Array<{ time: number; created: number; inProgress: number; completed: number }>
```

Stacked area chart replacing the old Task Burndown. Shows task counts over time.

### DataManagement

```tsx
import { DataManagement } from '../components/Settings/DataManagement';
```

Settings panel for storage stats and data cleanup by age (7d/30d/90d/all). Uses `/data/stats` and `/data/cleanup` endpoints.

### Removed Components

The following components have been removed:
- `SessionScoreBadge` — Subjective star ratings removed from Analytics
- `ModelEffectivenessChart` — Removed (can't fairly compare across varying task sizes)
- `RoleContributionChart` — Removed (not a meaningful metric)
- `PredictionsPanel` / `PredictionCard` — Predictions feature removed from frontend

### Utility: groupTimeline

```tsx
import { groupTimeline } from '../utils/groupTimeline';

const grouped = groupTimeline(messages);
// Batches sequential messages from the same sender into groups
```

---

## Motion System

Import: styles are global via `src/styles/motion.css`. Just add class names.

### Animation Classes

| Class | Duration | Use for |
|-------|----------|---------|
| `motion-fade-in` | 250ms | Universal entry |
| `motion-slide-in` | 250ms | Content entering from left |
| `motion-slide-in-right` | 250ms | Panels, slide-overs |
| `motion-slide-up` | 250ms | Toasts, bottom sheets |
| `motion-slide-down` | 250ms | Dropdowns, notifications |
| `motion-scale-in` | 250ms | Canvas nodes, modals |
| `motion-scale-in-spring` | 450ms | Playful/dramatic entrances |
| `motion-pulse` | 2s ∞ | Status indicators |
| `motion-pulse-border` | 2s ∞ | Attention-drawing borders |
| `motion-glow` | 2s ∞ | Active/selected state |
| `motion-fade-out` | 120ms | Exit animation |

### Transition Presets

| Class | Duration | Use for |
|-------|----------|---------|
| `transition-micro` | 120ms | Hover states, toggles |
| `transition-standard` | 250ms | Panel transitions |
| `transition-dramatic` | 450ms | Page transitions |

### Stagger Pattern

```tsx
{items.map((item, i) => (
  <div
    key={item.id}
    className="motion-stagger"
    style={{ '--stagger-index': i } as React.CSSProperties}
  >
    {/* content */}
  </div>
))}
```

### Reduced Motion

All animations respect `prefers-reduced-motion: reduce` automatically (0ms duration).

---

## Chart Theme

Import: styles are global via `src/styles/chart-theme.css`. Use CSS custom properties.

### Series Colors

`--chart-1` through `--chart-8` — indigo, cyan, amber, purple, green, rose, blue, orange

### Semantic Colors

| Variable | Use |
|----------|-----|
| `--chart-success` | Positive/completed |
| `--chart-warning` | Caution/amber |
| `--chart-danger` | Error/red |
| `--chart-info` | Informational/blue |
| `--chart-neutral` | Inactive/muted |

### Agent Status Colors

`--chart-running`, `--chart-idle`, `--chart-completed`, `--chart-failed`, `--chart-creating`, `--chart-terminated`

### Communication Edge Colors

`--chart-edge-delegation`, `--chart-edge-message`, `--chart-edge-group`, `--chart-edge-broadcast`, `--chart-edge-report`

### Structural

`--chart-grid`, `--chart-axis`, `--chart-tooltip-bg`, `--chart-tooltip-text`, `--chart-tooltip-border`

### Usage with visx

```tsx
<LinePath
  stroke={`rgb(var(--chart-1))`}
  // ...
/>
<AxisBottom
  stroke={`rgb(var(--chart-axis))`}
  tickStroke={`rgb(var(--chart-axis))`}
  tickLabelProps={{ fill: `rgb(var(--chart-neutral))` }}
/>
```

All variables use RGB triplets for opacity support: `rgba(var(--chart-1), 0.5)`.

---

## Key Patterns

### API Fetching

```typescript
import { apiFetch } from '../hooks/useApi';

// GET
const data = await apiFetch<MyType[]>('/projects');

// POST
await apiFetch('/nl/execute', {
  method: 'POST',
  body: JSON.stringify({ commandId: 'nl-pause-all' }),
});
```

**Always handle both response shapes:**
```typescript
const data = await apiFetch<unknown>('/endpoint');
const items = Array.isArray(data) ? data : data?.items ?? [];
```

### Zustand Selectors

```typescript
// ✅ Good — re-renders only when agents changes
const agents = useAppStore(s => s.agents);

// ❌ Bad — re-renders on ANY store change
const { agents, config } = useAppStore();
```

### Theme Classes

Always use `th-` prefixed classes, never raw colors:
- Background: `bg-th-bg`, `bg-th-bg-alt`
- Text: `text-th-text`, `text-th-text-muted`
- Border: `border-th-border`, `border-th-border-muted`
- Accent: `bg-accent/20 text-accent`
