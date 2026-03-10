# KanbanBoard + AttentionBar: Phase 1 Implementation Spec

**Canonical implementation guide for developers.**  
**Author:** Designer @8baab941  
**Date:** 2026-03-08  
**Status:** FINAL — Lead-approved, ready for implementation  
**Design rationale:** `.flightdeck/shared/designer-8baab941/kanban-ux-spec.md`  
**Acceptance criteria:** `.flightdeck/shared/product-manager-4b5c4761/kanban-scenarios.md` (AC-12.1–12.25)

---

## Scope

Phase 1 delivers the highest-impact, lowest-risk improvements to the task management UX. All items are additive (no deletions) and most are <50 LOC each.

**Components touched:**
1. **NEW: `AttentionBar.tsx`** — System-wide attention bar (app shell)
2. **MODIFY: `KanbanBoard.tsx`** — Interactive upgrade (filters, stale indicators, color fix, improved cards)
3. **MODIFY: `TaskQueuePanel.tsx`** — Scope switcher (global vs project)
4. **NEW: Backend endpoint** — `GET /api/attention-items` + task PATCH

**Owner mapping:**
- @0dde0f25: AttentionBar.tsx + App.tsx integration
- @b04c9b12: Backend APIs
- @76be0a0c: HomeDashboard integration with attention data
- KanbanBoard modifications: whoever has capacity (coordinate in ui-team group)

---

## 1. AttentionBar Component

**File:** `packages/web/src/components/AttentionBar/AttentionBar.tsx`  
**Est:** ~200 LOC  
**ACs:** AC-12.5, AC-12.6, AC-12.14  
**Priority:** P0 — Build first, transforms entire app UX

### 1.1 Placement in App Shell

Insert between the `<header>` (line 266) and `<PulseStrip>` (line 311) in `App.tsx`:

```
<header> ... </header>       ← existing (h-12)
<AttentionBar />             ← NEW
<PulseStrip />               ← existing
<main> ... </main>           ← existing
```

### 1.2 Data Model

```typescript
interface AttentionItem {
  id: string;
  type: 'failed' | 'blocked' | 'stale' | 'decision';
  severity: 'red' | 'yellow';
  title: string;
  projectId?: string;
  projectName?: string;
  taskId?: string;
  /** For failed tasks: first line of error */
  errorSummary?: string;
  /** For blocked: how long blocked */
  duration?: string;
  /** For decisions: decision ID for navigation */
  decisionId?: string;
  timestamp: string;
}

type EscalationMode = 'green' | 'yellow' | 'red';
```

### 1.3 Escalation State Logic

```typescript
function computeEscalation(items: AttentionItem[]): EscalationMode {
  if (items.length === 0) return 'green';
  if (items.some(i => i.type === 'failed') || items.length >= 3) return 'red';
  return 'yellow';
}
```

### 1.4 Visual Spec per Mode

| Mode | Height | Background | Border | Content |
|------|--------|-----------|--------|---------|
| 🟢 Green | 28px | `bg-transparent` | `border-b border-th-border/30` | "✓ All healthy — 12/20 done" (muted text, left-aligned) |
| 🟡 Yellow | 36px | `bg-amber-500/5` | `border-b border-amber-500/30` | "⚠ 1 task stale · 1 decision pending" (amber text, items clickable) |
| 🔴 Red | 44px | `bg-red-500/5` | `border-b-2 border-red-500/40` | "🔴 2 failed · 1 blocked >30m" (red text, pulse animation on border, items clickable) |

### 1.5 Interaction

- **Click any item** → Navigate to the relevant task/decision (use `react-router` `useNavigate`)
- **Click "Expand"** (right side) → Opens Command Center overlay (Phase 2a — for now, just navigate to Tasks page)
- **Collapse in Green mode**: If the user dismisses the green bar, remember in `localStorage`. Re-show when mode changes to yellow/red.

### 1.6 Transition Animations

Mode transitions should feel smooth, not jarring:

- **Green → Yellow**: Height eases from 28→36px over 300ms (`transition-all duration-300 ease-out`). Background fades to amber tint. Text crossfades.
- **Yellow → Red**: Height eases from 36→44px over 300ms. Border thickens with a subtle pulse animation. Background shifts to red tint.
- **Any → Green**: Height eases back to 28px over 500ms (slower = calming). Background fades out. Feels like the system is "settling down."
- **Key principle**: Escalation UP is fast (300ms — alert). De-escalation DOWN is slow (500ms — reassurance).

### 1.7 Data Source

**Interim (before backend endpoint):** Derive from existing WebSocket data:
- Failed tasks: `dagStatus.summary.failed > 0`
- Blocked tasks: filter `dagStatus.tasks` where `dagStatus === 'blocked'` and duration > threshold
- Stale tasks: filter `dagStatus.tasks` where `dagStatus === 'running'` and `Date.now() - startedAt > staleThreshold`
- Pending decisions: from `useLeadStore` pending decisions count

**Final:** `GET /api/attention-items` returns all items in one call (see Section 5).

### 1.8 Accessibility

- `role="alert"` on the bar when in Red mode (screen reader announces)
- `role="status"` in Green/Yellow modes
- Each clickable item has `role="link"` and visible focus ring
- Color is NOT the only indicator — text labels always present
- Reduced motion: skip pulse animation if `prefers-reduced-motion: reduce`

---

## 2. KanbanBoard Interactive Upgrade

**File:** `packages/web/src/components/TaskQueue/KanbanBoard.tsx`  
**Current:** 335 LOC → Target: ~550 LOC  
**ACs:** AC-12.1–12.14

### 2.1 Agent Assignment on Card Face (R2)

**Change:** Show assigned agent on every card, not just on expand.

In `TaskCard`, add after the meta row (line 124):

```tsx
{/* Agent assignment — always visible */}
{task.assignedAgentId && (
  <div className="flex items-center gap-1 mt-1 text-[10px] text-th-text-muted">
    <User size={10} />
    <span>{task.role} • {task.assignedAgentId.slice(-4)}</span>
  </div>
)}
```

Remove the duplicate agent display from the expanded section (lines 136-140).

**Display format:** `Developer • 903d` (role name from `task.role` + last 4 chars of agent ID).  
Full agent ID shown in `title` attribute for hover tooltip.

### 2.2 Time-in-Status Display (R3)

**Change:** Replace "created X ago" with "Running: 12m" or "Blocked: 2h".

New helper:

```typescript
function timeInStatus(task: DagTask): string {
  const now = Date.now();
  let since: number;
  
  if (task.dagStatus === 'running' && task.startedAt) {
    since = parseTimestamp(task.startedAt);
  } else if (task.dagStatus === 'done' && task.completedAt) {
    since = parseTimestamp(task.completedAt);
  } else {
    since = parseTimestamp(task.createdAt);
  }
  
  return formatRelativeTime(new Date(since).toISOString());
}
```

Replace the timestamp display (line 127) to show status context:

```tsx
<span title={task.createdAt}>
  {task.dagStatus === 'done' ? 'Completed' : task.dagStatus}: {timeInStatus(task)}
</span>
```

### 2.3 Filter Bar (R4)

**Change:** Add filter toolbar above the columns.

New component within KanbanBoard (~80 LOC):

```tsx
interface FilterState {
  role: string | null;
  agent: string | null;
  minPriority: number | null;
  search: string;
}
```

**UI layout:**
```
┌──────────────────────────────────────────────────────────────┐
│ 🔍 [Search tasks...] │ [Role ▾] │ [Priority ▾] │ [Agent ▾] │ ✕ Clear │
│ [Active filter chips appear here]                            │
└──────────────────────────────────────────────────────────────┘
```

- **Search**: Text input, filters cards by title/description match. Debounced 200ms.
- **Role dropdown**: Populated from unique `task.role` values. Multi-select with checkboxes.
- **Priority dropdown**: P1, P2, P3 options (any with `priority ≥ selected`).
- **Agent dropdown**: Populated from unique `task.assignedAgentId` values, displayed as role + short ID.
- **Clear button**: Resets all filters. Hidden when no filters active.
- **Filter chips**: Active filters shown as removable pills below the dropdowns.

**State persistence:** Sync filter state to URL query params via `useSearchParams`:
```
/tasks?role=developer&priority=2&search=auth
```

**Filtering logic:** Apply in `tasksByStatus` useMemo, before status grouping:
```typescript
const filteredTasks = useMemo(() => {
  let tasks = dagStatus?.tasks ?? [];
  if (filters.role) tasks = tasks.filter(t => t.role === filters.role);
  if (filters.minPriority) tasks = tasks.filter(t => t.priority >= filters.minPriority);
  if (filters.agent) tasks = tasks.filter(t => t.assignedAgentId === filters.agent);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    tasks = tasks.filter(t => 
      (t.title?.toLowerCase().includes(q)) || 
      (t.description?.toLowerCase().includes(q))
    );
  }
  return tasks;
}, [dagStatus?.tasks, filters]);
```

Update toolbar text to reflect filtered state: "Showing 6 of 18 tasks (role: developer)".

### 2.4 Stale Task Indicator (R7)

**Change:** Add visual warning on running tasks that haven't progressed.

```typescript
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes default

function isStale(task: DagTask): boolean {
  if (task.dagStatus !== 'running' || !task.startedAt) return false;
  const elapsed = Date.now() - parseTimestamp(task.startedAt);
  return elapsed > STALE_THRESHOLD_MS;
}
```

In `TaskCard`, add a stale indicator when applicable:
```tsx
{isStale(task) && (
  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">
    ⚠ Stale
  </span>
)}
```

Also add an amber left-border accent on stale cards:
```tsx
className={`... ${isStale(task) ? 'border-l-2 border-l-amber-400' : ''}`}
```

### 2.5 Color Semantics Fix (R8)

**Change:** Update `STATUS_BG` and column definitions.

```typescript
// Done: purple → muted emerald (de-emphasize completed work)
{ status: 'done', label: 'Done', icon: <CheckCircle2 size={14} />,
  accentClass: 'text-emerald-400/70', borderClass: 'border-emerald-500/20' },

// Done background
done: 'bg-emerald-500/3',

// Skipped: add dashed border distinction  
{ status: 'skipped', label: 'Skipped', icon: <SkipForward size={14} />,
  accentClass: 'text-th-text-muted', borderClass: 'border-th-border border-dashed' },
```

### 2.6 Improved Empty State (R5)

**Change:** Replace plain div with EmptyState component.

```tsx
if (!dagStatus || dagStatus.tasks.length === 0) {
  return (
    <EmptyState
      icon="📋"
      title="No tasks yet"
      description="Tasks appear here when you give instructions in the Session tab or when the lead creates a task DAG."
      action={{ label: 'Go to Session →', onClick: () => navigate('/') }}
      compact
    />
  );
}
```

Import `EmptyState` from `../ui/EmptyState` and `useNavigate` from `react-router-dom`.

### 2.7 Conditional Auto-Collapse Done (R6 revised)

**Change:** Auto-collapse Done and Skipped when they dominate the board.

Replace the initial state (line 248):

```typescript
const [collapsedColumns, setCollapsedColumns] = useState<Set<DagTaskStatus>>(() => {
  const doneCount = dagStatus?.summary.done ?? 0;
  const activeCount = (dagStatus?.summary.running ?? 0) + 
                      (dagStatus?.summary.ready ?? 0) + 
                      (dagStatus?.summary.blocked ?? 0) + 
                      (dagStatus?.summary.failed ?? 0);
  const autoCollapse = new Set<DagTaskStatus>();
  if (doneCount > activeCount && doneCount > 0) autoCollapse.add('done');
  if ((dagStatus?.summary.skipped ?? 0) > 0) autoCollapse.add('skipped');
  return autoCollapse;
});
```

**Important:** Failed column is NEVER auto-collapsed, even if it has tasks. (AC-12.5)

### 2.8 Failed Column Never Hidden (AC-12.5)

**Change:** Exclude Failed from "Hide empty columns" filter.

Update `visibleColumns` (line 276):

```typescript
const visibleColumns = useMemo(() => {
  if (!hideEmpty) return COLUMNS;
  return COLUMNS.filter(col => 
    col.status === 'failed' || // Never hide Failed column
    (tasksByStatus.get(col.status)?.length ?? 0) > 0
  );
}, [hideEmpty, tasksByStatus]);
```

### 2.9 Column Header Tooltips (AC-12.11)

**Change:** Add title attributes to column headers.

```typescript
const COLUMN_TOOLTIPS: Record<DagTaskStatus, string> = {
  pending: 'Task created, waiting for dependencies to complete',
  ready: 'All dependencies met, waiting for agent pickup',
  running: 'Agent is actively working on this task',
  blocked: 'Cannot proceed — check dependency chain',
  done: 'Task completed successfully',
  failed: 'Task encountered an error — may need retry',
  paused: 'Task paused by operator',
  skipped: 'Task was skipped (no longer needed)',
};
```

Add `title={COLUMN_TOOLTIPS[column.status]}` to the column header button.

### 2.10 Persistent View State (AC-12.3, AC-12.4)

**Change:** Persist collapse and hide-empty state in `localStorage`.

```typescript
const storageKey = `kanban-state-${dagStatus?.tasks[0]?.projectId ?? 'global'}`;

// Load from localStorage on mount
const [hideEmpty, setHideEmpty] = useState(() => {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved).hideEmpty ?? false : false;
  } catch { return false; }
});

// Save on change
useEffect(() => {
  localStorage.setItem(storageKey, JSON.stringify({ hideEmpty, collapsed: [...collapsedColumns] }));
}, [hideEmpty, collapsedColumns, storageKey]);
```

---

## 3. Scope Switcher (Global vs Project)

**File:** `packages/web/src/components/TaskQueue/TaskQueuePanel.tsx`  
**ACs:** Lead requirement (global/project dual scope)

### 3.1 Scope Dropdown

Add to the DagPanel toolbar (after the view switcher, line 164):

```tsx
<select
  value={scope}
  onChange={(e) => setScope(e.target.value)}
  className="text-xs bg-th-bg border border-th-border rounded px-2 py-1 text-th-text"
>
  <option value="global">🌐 All Projects</option>
  {projects.map(p => (
    <option key={p.id} value={p.id}>📁 {p.name}</option>
  ))}
</select>
```

### 3.2 Global Task Query

When `scope === 'global'`, fetch from the new global endpoint:
```typescript
const dagStatus = scope === 'global'
  ? await apiFetch<DagStatus>('/api/tasks?scope=global')
  : leadDagStatus; // existing per-lead DAG status
```

### 3.3 Project Attribution on Cards (Global View Only)

When in global view, add project name to card face:

```tsx
{isGlobalView && task.projectId && (
  <div className="text-[10px] text-th-text-muted mb-0.5 truncate">
    📁 {projectNameMap.get(task.projectId) ?? task.projectId}
  </div>
)}
```

---

## 4. KanbanBoard Test Updates

**File:** `packages/web/src/components/TaskQueue/__tests__/KanbanBoard.test.tsx`

Add tests for each new feature:

1. **Filter bar**: Render with mixed roles → apply role filter → verify correct cards shown
2. **Stale indicator**: Render task with `startedAt` > 15 min ago → verify "⚠ Stale" badge
3. **Agent on card face**: Render task with `assignedAgentId` → verify role + short ID visible without expand
4. **Time-in-status**: Render running task with `startedAt` → verify "Running: Xm" text
5. **Failed column never hidden**: Enable "Hide empty columns" → verify Failed column still present
6. **Auto-collapse Done**: Render board where done > active → verify Done column is collapsed
7. **Empty state**: Render with no tasks → verify EmptyState component with CTA button
8. **Color fix**: Verify Done column uses emerald, not purple accent classes
9. **Column tooltips**: Verify `title` attribute on column headers

---

## 5. Backend Requirements

### 5.1 Attention Items Endpoint

```
GET /api/attention-items
```

**Response:**
```json
{
  "items": [
    { "id": "task-abc", "type": "failed", "severity": "red", "title": "...", "projectId": "...", "errorSummary": "..." },
    { "id": "task-def", "type": "stale", "severity": "yellow", "title": "...", "duration": "47m" },
    { "id": "dec-ghi", "type": "decision", "severity": "yellow", "title": "...", "decisionId": "..." }
  ],
  "escalation": "red",
  "summary": { "failed": 1, "blocked": 0, "stale": 1, "decisions": 1 }
}
```

**Logic:** Query all active projects' tasks. Return failed tasks, blocked tasks (>threshold), stale running tasks (>threshold), and pending decisions. Compute escalation mode server-side.

### 5.2 Task Mutation Endpoint

```
PATCH /api/projects/:projectId/tasks/:taskId
```

**Request body:**
```json
{
  "priority": 3,
  "dagStatus": "ready",
  "assignedAgentId": "agent-xyz"
}
```

**Validation:** Check transition matrix for status changes. Return 400 for invalid transitions with reason.

### 5.3 Global Task Query

```
GET /api/tasks?scope=global&role=developer&priority=2
```

Returns `DagStatus` shape aggregated across all active projects. Supports filter query params.

### 5.4 New DagTask Fields

Add to the schema and DB:
- `failureReason: string | null` — First line of error message from agent failure
- `completionSummary: string | null` — Summary text from COMPLETE_TASK command

---

## 6. Design Token Reference

Use existing theme tokens. Do NOT introduce new CSS variables.

| Purpose | Token | Example |
|---------|-------|---------|
| Red accent (failed/error) | `text-red-400`, `bg-red-500/5`, `border-red-500/30` | Failed column, red mode bar |
| Amber accent (warning/stale) | `text-amber-400`, `bg-amber-500/5`, `border-amber-500/30` | Stale indicator, yellow mode bar |
| Emerald accent (done) | `text-emerald-400/70`, `bg-emerald-500/3` | Done column (replaces purple) |
| Muted text | `text-th-text-muted` | Secondary info, timestamps |
| Background surfaces | `bg-th-bg`, `bg-th-bg-alt`, `bg-th-bg-muted` | Card, column, toolbar |
| Borders | `border-th-border` | Default borders |

---

## 7. Implementation Order

Build in this order to minimize blocking:

1. **AttentionBar.tsx** — standalone, no dependencies on KanbanBoard changes
2. **KanbanBoard color fix** (R8) — smallest change, immediate visual improvement
3. **Agent on card face** (R2) — ~10 LOC, high impact
4. **Time-in-status** (R3) — ~15 LOC helper + card update
5. **Stale indicator** (R7) — ~20 LOC, depends on time helpers from R3
6. **Failed column never hidden** (AC-12.5) — 2 LOC
7. **Improved empty state** (R5) — ~10 LOC
8. **Column tooltips** — ~15 LOC
9. **Auto-collapse Done** (R6) — ~10 LOC
10. **Persistent view state** — ~20 LOC
11. **Filter bar** (R4) — ~80 LOC, largest Phase 1 change
12. **Scope switcher** — depends on backend global query endpoint

---

## Acceptance Criteria Mapping

| AC | Feature | Covered By |
|----|---------|-----------|
| AC-12.1 | Correct columns/cards | Existing ✓ |
| AC-12.2 | Card expand details | §2.1 (agent display improvement) |
| AC-12.3 | Collapse persists | §2.10 |
| AC-12.4 | Hide empty persists | §2.10 |
| AC-12.5 | Failed never hidden | §2.8 |
| AC-12.6 | Real-time updates | Existing ✓ (animation deferred to Phase 2) |
| AC-12.7 | Filter by role | §2.3 |
| AC-12.8 | Filter by agent | §2.3 |
| AC-12.11 | Column tooltips | §2.9 |
| AC-12.12 | Empty state | §2.6 |
| AC-12.13 | Agent display format | §2.1 |
| AC-12.14 | Time-in-column | §2.2 + §2.4 |

---

*This is the canonical implementation guide. Design questions → @8baab941 in the ui-team group. Product questions → @4b5c4761. Backend questions → @b04c9b12.*
