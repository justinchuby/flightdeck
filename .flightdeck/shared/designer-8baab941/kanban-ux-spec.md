# KanbanBoard UX Design Specification

**Component:** `packages/web/src/components/TaskQueue/KanbanBoard.tsx`  
**Author:** Designer @8baab941  
**Date:** 2026-03-08  
**Status:** Draft — Open for PM review and debate

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Persona-Driven Analysis](#2-persona-driven-analysis)
3. [User Scenario Walkthroughs](#3-user-scenario-walkthroughs)
4. [Interaction Design Spec](#4-interaction-design-spec)
5. [Information Hierarchy](#5-information-hierarchy)
6. [Edge Cases](#6-edge-cases)
7. [Specific Recommendations](#7-specific-recommendations)
8. [Current State Assessment](#8-current-state-assessment)
9. [Global vs Project-Specific Views](#9-global-vs-project-specific-views)
10. [Creative Alternatives: Command Center Model](#10-creative-alternatives-command-center-model)
11. [Many-to-Many Team ↔ Project Implications](#11-many-to-many-team--project-implications)

---

## 1. Executive Summary

The KanbanBoard is one of five task visualization modes (list, kanban, graph, gantt, resource) in Flightdeck's TaskQueuePanel. It displays DAG tasks as cards across status columns. The current implementation is **solid as a read-only status display** — clean column layout, expandable cards, priority sorting, and column collapse. However, it lacks interactivity (no drag-and-drop, no filtering, no search) and has several UX gaps that limit its usefulness as a primary project management view.

### Key Design Thesis

The KanbanBoard should be Flightdeck's **primary operational dashboard** for human operators managing AI agent crews. Unlike a developer's personal Kanban (Trello, Linear), this board serves a fundamentally different purpose: **monitoring and steering autonomous work**, not manually moving tasks. The design must optimize for:

1. **Situational awareness** — What's happening right now across all agents?
2. **Exception handling** — What needs my attention? What's stuck/failed?
3. **Dependency clarity** — What's blocking what? What's the critical path?
4. **Steering** — Reprioritize, reassign, unblock — without micromanaging

---

## 2. Persona-Driven Analysis

### Primary Persona: The Project Lead Operator

**Who:** A technical user (developer, engineering manager, or technical PM) who uses Flightdeck to manage a crew of AI agents working on a software project.

**Goals:**
- Monitor 5-20 concurrent agent tasks without constant context switching
- Quickly spot blocked, failed, or stalled tasks and intervene
- Understand the overall health and progress of the project at a glance
- Reprioritize work as requirements change or blockers emerge
- Know which agents are idle (waste) vs. overloaded (bottleneck)

**Frustrations (current board):**
- **No scanning shortcuts**: Must read each card individually; no way to filter by role, agent, or priority
- **No urgency signals**: Failed/blocked tasks don't visually "scream" for attention — they're just in a different column
- **No interaction**: Can't drag tasks, can't quick-assign, can't change priority from the board
- **Agent visibility is buried**: Must expand each card to see which agent is assigned — critical info hidden behind a click
- **8 columns is overwhelming**: Pending/Ready/Paused/Skipped are rarely actionable; they dilute the signal from Running/Blocked/Failed
- **No time-based awareness**: "3m ago" vs "2h ago" — stale running tasks aren't flagged
- **Dependency chains invisible at board level**: Only visible per-card when expanded

**Mental Model:**
The operator thinks in terms of **attention priority**: "What needs me right now?" → "What's working fine?" → "What's coming up next?" The board should map to this hierarchy, not just mirror database status values.

### Secondary Persona: The Observer / Stakeholder

**Who:** A team member, manager, or stakeholder who checks the board to understand project progress.

**Goals:**
- See overall progress (% done) at a glance
- Understand which work streams are active
- Identify bottlenecks without technical knowledge

**Frustrations:**
- No progress summary integrated with the board view
- 8 status columns are confusing for non-operators
- No way to see the board in a simplified "overview" mode

### Tertiary Persona: The Agent Crew (AI Consumers)

**Who:** AI agents that read task status to understand their own work context.

**Goals:**
- Understand which tasks are assigned to them
- See dependency status (are my predecessors done?)
- Know their priority relative to other work

**Note:** Agents don't directly use the Kanban UI, but the data model and API that powers it also serves agent context injection. Design decisions here affect agent ergonomics.

---

## 3. User Scenario Walkthroughs

### Scenario 1: Morning Check-In — "What happened overnight?"

**Context:** Operator opens Flightdeck after agents have been working autonomously for hours.

**Current experience:**
1. Open Tasks page → Kanban view
2. Scan 8 columns left to right
3. Count tasks in Failed/Blocked columns
4. Expand each running task to see if it's stale
5. No indication of _when_ tasks changed status

**Ideal experience:**
1. Open Tasks page → Kanban view
2. **Attention banner** at top: "2 tasks failed, 1 blocked for >30min"
3. Failed column is visually prominent (red accent pulse)
4. Each card shows **time in current status** (not just "created at")
5. Running tasks that haven't progressed in >15min get a ⚠ stale indicator
6. Can click the attention banner to filter to just problem tasks

**Design recommendation:** Add an **attention summary strip** above the columns that aggregates exceptions. Use progressive disclosure — the strip is the entry point, clicking it filters the board.

### Scenario 2: Reprioritizing Work — "This task needs to happen first"

**Context:** Stakeholder pings the operator: "The auth module is more urgent now."

**Current experience:**
1. Find the task by scanning columns manually
2. Cannot change priority from the board
3. Must use CLI or API to update priority
4. Come back to board, hope it re-sorted

**Ideal experience:**
1. **Cmd+K / search** to find "auth module" task quickly
2. Click the priority badge → inline dropdown → select P3 (Critical)
3. Card re-sorts to top of column with a brief animation
4. Undo toast: "Priority changed to P3 — Undo"

**Design recommendation:** Priority should be **editable inline** via the priority badge. Search/filter is essential for boards with >10 tasks.

### Scenario 3: Moving a Task Between Statuses — "Unblock this manually"

**Context:** A task is stuck in "blocked" because a dependency was completed via a different path.

**Current experience:**
1. Find blocked task, expand it
2. See the dependency that's supposedly blocking it
3. Cannot change the task status from the UI
4. Must use CLI: `COMPLETE_TASK` or manually update DAG

**Ideal experience:**
1. Find blocked task
2. **Drag it from Blocked → Ready** column
3. Confirmation dialog: "Move 'Auth module' from Blocked to Ready? This overrides dependency checks."
4. Task moves with animation, undo toast appears

**Design recommendation:** Drag-and-drop is the right interaction model for status changes, but with **guardrails** — some transitions need confirmation (e.g., moving blocked → ready overrides dependency checks). The board should distinguish between "suggested" moves (the system would do this anyway) and "override" moves (human is overriding automation).

### Scenario 4: Filtering by Role or Agent — "What are the developers working on?"

**Context:** Operator wants to focus on just developer tasks because that's where the bottleneck is.

**Current experience:**
1. No filtering available
2. Must visually scan all cards, reading role badges
3. Role badge is small (10px) and easy to miss

**Ideal experience:**
1. Click **filter icon** in toolbar → dropdown with: Role, Agent, Priority, Has Files
2. Select "Developer" → board instantly filters to only developer tasks
3. Column counts update to reflect filtered view
4. Filter pill appears in toolbar: "Role: Developer ✕"
5. Can combine filters: "Role: Developer" + "Priority: ≥ P2"

**Design recommendation:** Add a **filter bar** with chip-based active filters. Use the existing agent role data already on each task. Filter state should be preserved across view switches (kanban ↔ graph ↔ list).

### Scenario 5: Monitoring Progress — "Are we on track?"

**Context:** Operator checks in mid-session to gauge overall progress.

**Current experience:**
1. Look at the toolbar: "12 tasks across 6 columns" — low-information
2. Count tasks in Done column manually
3. No sense of velocity or remaining work

**Ideal experience:**
1. **Progress bar** in the toolbar: "8/12 tasks complete (67%)"
2. Column headers show not just count but **weighted** count (P3 tasks count more)
3. "Done" column is visually de-emphasized (completed work shouldn't dominate the view)
4. "Running" column has subtle animation (pulse borders) indicating active work

**Design recommendation:** Replace the text summary with a **mini progress bar** and fractional indicator. De-emphasize completed/skipped columns by default — they're historical, not operational.

### Scenario 6: Handling a Failure — "A task failed, now what?"

**Context:** An agent reports task failure.

**Current experience:**
1. Task appears in Failed column (red)
2. No error information visible on the card
3. Must go to agent logs to understand what happened
4. No retry action from the board

**Ideal experience:**
1. Failed card shows **truncated error summary** (first line of error)
2. Click card → expanded view shows full error + link to agent logs
3. **"Retry" button** on failed cards → re-queues the task
4. **"Reassign" option** → pick a different agent/role

**Design recommendation:** Failed tasks need the most actionable UI. Show error context inline, provide retry/reassign actions. This is the highest-value interaction on the board.

### Scenario 7: Dependency Chain Investigation — "Why is this task still pending?"

**Context:** A task has been pending for a long time, and the operator wants to understand what's blocking the dependency chain.

**Current experience:**
1. Expand the task card → see its dependencies
2. Each dependency shows a name and status indicator (✓/●/○)
3. Must manually find each dependency card to see _its_ dependencies
4. No transitive dependency view

**Ideal experience:**
1. Expand task → dependencies shown with status
2. Click any dependency → **jump to that card** (auto-scrolls to its column, highlights it)
3. Or: hover a dependency → **tooltip showing the chain**: "Waiting on: Task A (running) → Task B (done) → This task"
4. Cards with unmet dependencies show a **chain icon with count**: "🔗 2 deps remaining"

**Design recommendation:** Make dependency navigation **cross-card interactive**. At minimum, clicking a dependency should scroll to and highlight that card. Ideally, show a mini dependency chain inline.

---

## 4. Interaction Design Spec

### 4.1 Drag-and-Drop

**Should the Kanban support drag-and-drop?** Yes — with caveats.

This is a DAG-managed board. Tasks move between statuses based on dependency resolution and agent completion, not manual human movement. However, humans need override capability. Drag-and-drop is the correct metaphor because it's **direct manipulation** (Fitts's law: minimize distance between intention and action).

#### Drag Initiation
- **Trigger:** mousedown + 5px threshold (prevents accidental drags on click-to-expand)
- **Visual:** Card lifts with a subtle drop shadow (elevation change), original position shows a ghost placeholder (dashed border, 30% opacity)
- **Cursor:** `grabbing` cursor during drag
- **Accessibility:** Keyboard alternative: Select card → Arrow keys to move → Enter to drop

#### During Drag
- **Card follows cursor** with slight offset (don't obscure where user is looking)
- **Valid drop targets** (columns) highlight with a colored border and slight scale-up
- **Invalid drop targets** show no highlighting
- **Cross-column scrolling**: If board is scrolled horizontally, dragging near edges auto-scrolls

#### Valid Transitions
Not all status transitions make sense. Define a transition matrix:

| From ↓ / To → | pending | ready | running | blocked | done | failed | paused | skipped |
|---|---|---|---|---|---|---|---|---|
| **pending** | — | ✅ auto | ✅ warn | ❌ | ❌ | ❌ | ✅ | ✅ |
| **ready** | ✅ | — | ✅ auto | ❌ | ❌ | ❌ | ✅ | ✅ |
| **running** | ❌ | ❌ | — | ❌ | ✅ confirm | ❌ | ✅ | ❌ |
| **blocked** | ❌ | ✅ confirm | ✅ confirm | — | ❌ | ❌ | ❌ | ✅ |
| **done** | ❌ | ✅ confirm | ❌ | ❌ | — | ❌ | ❌ | ❌ |
| **failed** | ❌ | ✅ (retry) | ✅ (retry) | ❌ | ❌ | — | ❌ | ✅ |
| **paused** | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | — | ✅ |
| **skipped** | ❌ | ✅ confirm | ❌ | ❌ | ❌ | ❌ | ❌ | — |

- **auto**: Allowed, no confirmation needed
- **confirm**: Allowed with confirmation dialog ("This overrides dependency checks")
- **warn**: Allowed with a warning toast
- **retry**: Triggers re-queue of the task

#### On Drop
- **Valid drop**: Card animates into position in the target column. Toast: "Task moved to [status]" with Undo button (5s timeout).
- **Invalid drop**: Card snaps back to original position with a subtle shake animation.
- **Confirmation needed**: Drop triggers a modal: "Move [task] from [status] to [status]? [reason]. [Cancel] [Confirm]"

#### Undo Support
- **All status changes** get a 5-second undo toast
- Undo reverts to previous status
- If the user closes the toast or the timeout expires, the change is committed
- Undo stack is 1 deep (last action only)

#### Keyboard Accessibility
- `Tab` to navigate between cards
- `Space/Enter` to "pick up" a card
- `Arrow keys` to move between columns
- `Space/Enter` to "drop" in current column
- `Escape` to cancel drag

### 4.2 Click Interactions

- **Single click on card**: Toggle expand/collapse (current behavior — keep)
- **Single click on priority badge**: Open inline priority picker (new)
- **Single click on agent badge**: Navigate to agent view (new)
- **Single click on dependency name**: Scroll to and highlight that card (new)
- **Double click on card**: Open full task detail panel/modal (new)
- **Right-click on card**: Context menu: Retry, Reassign, Change Priority, Skip, View Logs (new)

### 4.3 Hover Interactions

- **Card hover**: Subtle border color shift (current behavior — keep)
- **Dependency hover**: Show tooltip with chain status
- **Column header hover**: Show column action menu affordance
- **Priority badge hover**: Show tooltip "Click to change priority"

---

## 5. Information Hierarchy

### 5.1 Task Card — Information Tiers

Design principle: **Progressive disclosure**. Show the minimum info needed for scanning, reveal details on interaction.

#### Tier 1: Always Visible (Scanning)
These should be readable at a glance from any card on the board:

1. **Task title** — Primary text, semibold, 12-13px. Truncate at 60 chars with tooltip for full text.
2. **Priority badge** — Color-coded pill: P1 blue, P2 orange, P3 red. Position: top-right corner.
3. **Role badge** — Small chip showing the agent role (developer, architect, etc). Position: bottom-left.
4. **Status indicator** — The column itself encodes status, but add a subtle **left-border accent** matching the status color for scannability when cards overflow.
5. **Assigned agent** — ⬆ PROMOTE FROM TIER 2. Show agent ID (truncated) or "Unassigned" directly on the card. This is critical operational info.
6. **Time in status** — Show how long the task has been in its current status, not just when it was created. "Running: 12m" is more useful than "Created: 2h ago".

#### Tier 2: Visible on Hover or Expand
Additional context revealed by expanding the card:

1. **Dependencies** — List with status indicators (current behavior, keep)
2. **Files** — Associated file list (current behavior, keep)
3. **Full description** — If different from title (current behavior, keep)
4. **Error summary** — For failed tasks, show the first line of the error
5. **Timestamps** — Created, started, completed timestamps

#### Tier 3: On Detail Panel (Double-Click)
Full detail view in a side panel or modal:

1. Full description text
2. Complete dependency chain (transitive)
3. All file locks held
4. Agent activity log for this task
5. Retry/reassign/skip actions

### 5.2 Color Coding

Current colors are reasonable but need refinement. The principle: **Colors should encode urgency, not just status**.

| Status | Current Color | Recommended | Rationale |
|---|---|---|---|
| pending | Gray (muted) | **Gray (muted)** ✓ | Not actionable, de-emphasize |
| ready | Green | **Green** ✓ | Ready = good, go signal |
| running | Blue | **Blue with pulse** | Active work, needs animation |
| blocked | Orange | **Amber/Orange** ✓ | Warning, may need attention |
| done | Purple | **Emerald with reduced opacity** | Completed = de-emphasize. Purple is too prominent for "finished" work. |
| failed | Red | **Red with stronger accent** | Needs immediate attention. Should be the most visually prominent. |
| paused | Yellow | **Yellow** ✓ | Caution, human paused this |
| skipped | Gray (very muted) | **Gray, dashed border** | Explicitly skipped, clearly different from pending |

**Key change:** Done tasks should NOT have a vivid color. Purple is attention-grabbing. Use muted emerald (matching DagResourceView's "done" style) with reduced opacity. The board should draw the eye to **problems** (failed, blocked) and **active work** (running), not completed work.

### 5.3 Column Order

Current: `pending → ready → running → blocked → done → failed → paused → skipped`

**Recommended change: Group by operational meaning, not lifecycle:**

Option A (Recommended) — **Attention-first layout:**
```
ACTIVE ZONE          | ATTENTION ZONE      | QUEUE ZONE         | DONE ZONE
running | ready      | failed | blocked    | pending | paused   | done | skipped
```

Option B — **Flow-based layout (simpler):**
```
pending → ready → running → blocked → failed → paused → done → skipped
```

**Rationale for Option A:** Operators look at the board to answer "What's active?" and "What needs me?" — put those columns first. Done/skipped are reference columns that should be at the far right (or collapsed by default).

**Compromise:** Keep current order but auto-collapse Done and Skipped columns by default when they contain tasks. Users who want to see them can expand.

### 5.4 Column Grouping (Alternative Approach)

Instead of 8 flat columns, consider a **3-lane layout** with swimlanes:

```
┌─────────────────┬────────────────────────┬──────────────────────┐
│  📥 QUEUE       │  ⚡ ACTIVE              │  ✅ COMPLETE          │
│                 │                        │                      │
│  pending (3)    │  running (4)           │  done (8)            │
│  ready (2)      │  blocked (1)           │  skipped (1)         │
│  paused (1)     │  failed (1)            │                      │
└─────────────────┴────────────────────────┴──────────────────────┘
```

Within each lane, tasks are grouped by sub-status with visual separators. This reduces cognitive load from 8 columns to 3 zones.

**Recommendation:** Offer this as a "Compact view" toggle alongside the full 8-column view. Some users prefer granularity, others prefer simplicity.

---

## 6. Edge Cases

### 6.1 Empty Board
**Current:** Shows "No tasks to display" centered in a 256px-high div.
**Improvement:**
- Use the existing `EmptyState` component with icon and CTA
- Message: "No tasks yet" + "Tasks appear here when the project lead declares a task DAG"
- Consider showing a ghost/skeleton of what columns would look like (educational empty state)

### 6.2 Board with 50+ Tasks
**Current:** maxHeight 480px per column with overflow scroll.
**Problems at scale:**
- Columns with 20+ tasks become unscrollable walls of text
- Priority sorting helps but doesn't prevent overwhelm
- No virtualization — rendering 50+ cards is expensive

**Recommendations:**
1. **Virtual scrolling** within columns — only render visible cards (use react-virtual or similar)
2. **Card compaction**: When a column has >8 tasks, auto-switch to a compact card format (title + priority only, one line per card)
3. **Column count limit**: Show top 10 tasks in each column, with a "Show 12 more" button at the bottom
4. **Filters become essential**: At 50+ tasks, the board is unusable without filtering. Make the filter bar persistent, not optional.

### 6.3 Long Task Names
**Current:** Truncated at 80 characters with `…`.
**Problems:**
- 80 characters is too generous — causes cards to be tall and inconsistent heights
- No tooltip on truncated text
**Recommendations:**
- Truncate at **50 characters** for the title line
- Add `title` attribute for native browser tooltip on hover
- For expanded cards, show full text with wrapping
- Enforce consistent card height in compact mode

### 6.4 Mobile / Small Screens (< 768px)
**Current:** Horizontal scroll with min-width 220px per column. 8 columns × 220px = 1760px minimum. Unusable on mobile.
**Recommendations:**
1. **Single-column stacked view on mobile**: Stack columns vertically, each collapsed by default, tap to expand
2. **Swipe navigation**: Swipe left/right to navigate between columns
3. **Priority mobile column order**: Running → Failed → Blocked → Ready → Pending → Done → Paused → Skipped
4. **Bottom sheet for card details**: Tap card → full-width bottom sheet instead of inline expansion
5. **Touch-friendly targets**: Cards need minimum 44px touch height (currently ~48px, acceptable)
6. **No drag-and-drop on touch**: Use long-press menu instead for status changes

**Breakpoint strategy:**
- `≥1200px`: Full 8-column layout
- `768px-1199px`: Scrollable with columns min-width reduced to 180px
- `<768px`: Stacked single-column with swipe

### 6.5 All Tasks in One Column
When all tasks share the same status (e.g., all pending at start), the board is spatially wasteful — 7 empty columns and 1 busy column.
**Recommendation:** "Hide empty columns" should default to ON when >80% of tasks share one status. Add an intelligent default that adapts to the data.

### 6.6 Rapidly Changing Board (Live Updates)
Tasks change status in real-time via WebSocket. If the board is re-rendering on every change, cards will shift position while the user is reading.
**Recommendations:**
1. **Batch updates**: Accumulate status changes and apply every 2 seconds (not on every WebSocket event)
2. **Animation**: Cards should animate when changing columns (slide out of old, slide into new)
3. **Highlight new arrivals**: Cards that just entered a column get a brief highlight (1.5s glow)
4. **Don't reorder during interaction**: If the user is hovering/expanding a card, defer re-sorts until they stop interacting

### 6.7 No Dependencies in DAG
When tasks have no `dependsOn` relationships, the dependency features are useless noise.
**Current:** Already handled — expand chevron only shows when there are details.
**Recommendation:** Also hide the "Blocked" column when no tasks have dependencies (it can never be populated).

---

## 7. Specific Recommendations

### R1: Add Attention Summary Strip ⭐ High Priority
**What:** A horizontal strip above the columns showing exception counts.
**Why:** Operator's #1 question is "what needs me?" — this answers it in <1 second.
**Spec:**
```
┌──────────────────────────────────────────────────────────────────┐
│ 🔴 2 failed  ·  🟠 1 blocked (>30m)  ·  ⚠️ 1 stale  ·  12/20 done │
│ [Click any to filter]                                           │
└──────────────────────────────────────────────────────────────────┘
```
**Implementation:** Pure presentational component, ~60 LOC. Reads from existing `dagStatus.summary`.

### R2: Promote Agent Assignment to Tier 1 ⭐ High Priority
**What:** Show assigned agent ID on the card face (not just on expand).
**Why:** "Who's working on this?" is the second question operators ask after "what's the status?"
**Spec:** Small avatar/initial circle + truncated agent ID below the role badge.
**Implementation:** ~10 LOC change in TaskCard, no new data needed.

### R3: Add Time-in-Status Display ⭐ High Priority
**What:** Show how long each task has been in its current status.
**Why:** "Running: 2h" is dramatically more useful than "Created: 3h ago" for spotting stale tasks.
**Spec:** Replace `createdAt` relative time with status-entered-at time. Use `startedAt` for running, `completedAt` for done, `createdAt` for pending.
**Implementation:** ~15 LOC helper function + card update. May need a `statusChangedAt` field if not derivable.

### R4: Add Filter Bar ⭐ High Priority
**What:** Toolbar with filter chips for Role, Priority, Agent, and text search.
**Why:** Boards with >10 tasks are unmanageable without filtering.
**Spec:**
```
┌──────────────────────────────────────────────────────────────────┐
│ 🔍 Search tasks...  │ Role ▾ │ Priority ▾ │ Agent ▾ │ ✕ Clear │
│ [Active filters appear as removable chips]                       │
└──────────────────────────────────────────────────────────────────┘
```
**Implementation:** ~100 LOC new component. Filter state in KanbanBoard, applied via `useMemo`.

### R5: Redesign Empty State 🟡 Medium Priority
**What:** Use `EmptyState` component with contextual message and ghost columns.
**Why:** Current empty state is minimal and unhelpful for first-time users.
**Implementation:** ~20 LOC, swap the div for `<EmptyState icon="📋" title="No tasks yet" description="..." />`.

### R6: Add Column Auto-Collapse for Done/Skipped 🟡 Medium Priority
**What:** Auto-collapse Done and Skipped columns by default.
**Why:** Completed work shouldn't dominate the viewport. Operators care about active/problematic work.
**Spec:** `collapsedColumns` initial state: `new Set(['done', 'skipped'])` when those columns have tasks.
**Implementation:** ~5 LOC change in state initialization.

### R7: Add Stale Task Indicator 🟡 Medium Priority
**What:** Visual warning on running tasks that haven't progressed in >15 minutes.
**Why:** Stale tasks often indicate hung agents — critical to spot quickly.
**Spec:** Yellow warning border + "⚠ Stale: 47m" badge on tasks where `now - startedAt > STALE_THRESHOLD`.
**Implementation:** ~20 LOC. Compare `startedAt` to `Date.now()` in TaskCard render.

### R8: Improve Color Semantics 🟡 Medium Priority
**What:** Change "done" from purple to muted emerald/green; strengthen "failed" red.
**Why:** Purple draws attention to completed work. The eye should go to problems first (failed=red, blocked=amber).
**Spec:** See color table in Section 5.2.
**Implementation:** ~10 LOC color constant changes.

### R9: Add Drag-and-Drop 🟢 Lower Priority (Phase 2)
**What:** Full drag-and-drop for task status changes.
**Why:** Direct manipulation is the most intuitive way to change status, but requires API support.
**Dependencies:** Needs a PATCH API endpoint for task status changes; transition validation logic.
**Spec:** See Section 4.1 for full interaction design.
**Implementation:** ~200 LOC using `@dnd-kit/core` (already in React ecosystem). Significant effort.

### R10: Add Card Context Menu 🟢 Lower Priority (Phase 2)
**What:** Right-click menu with Retry, Reassign, Change Priority, Skip, View Logs.
**Why:** Power users expect right-click actions; reduces clicks for common operations.
**Implementation:** ~80 LOC. Reuse Radix UI or similar headless menu component.

### R11: Compact View Mode 🟢 Lower Priority
**What:** 3-lane layout (Queue | Active | Complete) as an alternative to 8 columns.
**Why:** Reduces cognitive load for overview-oriented users.
**Spec:** See Section 5.4.
**Implementation:** ~150 LOC new layout mode.

### R12: Mobile-Responsive Stacked Layout 🟢 Lower Priority
**What:** Single-column stacked view with swipe navigation for screens <768px.
**Why:** Current 8-column layout is completely broken on mobile.
**Spec:** See Section 6.4.
**Implementation:** ~120 LOC responsive wrapper + CSS.

### R13: Virtual Scrolling for Large Boards 🟢 Lower Priority
**What:** Virtualize card rendering within columns.
**Why:** 50+ card boards will have performance issues.
**Dependencies:** `react-virtual` or `@tanstack/react-virtual`
**Implementation:** ~40 LOC wrapper per column.

---

## 8. Current State Assessment

### What Works Well ✅
1. **Clean column layout** — The flex-based horizontal layout is solid and well-coded
2. **Expandable cards** — Progressive disclosure pattern is correct
3. **Priority sorting** — High-priority tasks rising to the top is essential
4. **Column collapse** — Good space-saving mechanism
5. **Hide empty columns** — Smart toggle for reducing noise
6. **Consistent theming** — Uses `th-*` tokens correctly, dark/light mode works
7. **Good test coverage** — 263 lines of tests covering core scenarios
8. **Dependency rendering** — Cross-referencing tasks for dependency labels is well-implemented

### What Needs Work ❌
1. **No interactivity** — Read-only; can't change priority, status, or assignment
2. **No filtering or search** — Unusable at scale
3. **Agent assignment buried** — Critical info hidden behind expand
4. **No urgency signals** — All tasks look equally important
5. **Time display is wrong** — Shows creation time, not time-in-status
6. **Done column too prominent** — Purple color draws eye to finished work
7. **No mobile support** — 1760px minimum width, completely broken on mobile
8. **No live update animation** — Cards jump positions without transition
9. **No error context on failed tasks** — Must leave the board to understand failures
10. **No keyboard navigation** — Cards aren't focusable, no keyboard shortcuts

### Implementation Priority Roadmap

**Phase 1 — Quick Wins (< 1 sprint):** R1, R2, R3, R5, R6, R7, R8
- Attention strip, agent visibility, time-in-status, empty state, auto-collapse, stale indicator, colors
- All are < 30 LOC changes, no new dependencies, no API changes

**Phase 2 — Core Interactivity (1 sprint):** R4, R9, R10
- Filter bar, drag-and-drop, context menu
- Requires API support for status mutation

**Phase 3 — Polish (1 sprint):** R11, R12, R13
- Compact view, mobile layout, virtual scrolling
- Quality-of-life improvements for scale and responsiveness

---

## Open Questions for PM Review

1. **Should drag-and-drop be available to all users, or gated behind an "admin" role?** Status changes have operational consequences — should we add permission checks?
2. **What's the right stale threshold?** 15 minutes was chosen arbitrarily. Should it be configurable per project?
3. **Should filters persist across page navigations?** URL query params vs. in-memory state?
4. **Is the 3-lane compact view worth building?** Or does "hide empty columns" + auto-collapse solve the same problem more simply?
5. **Error context for failed tasks** — What data is available? Do we have a `failureReason` field, or must we link to agent logs?

---

*This spec is a living document. Feedback welcome from @49cbf6e1 (Lead), PM, and developers.*

---

## 9. Global vs Project-Specific Views

### The Requirement
The Kanban must support two scopes:
- **Global view**: All tasks across all projects — the "air traffic control" perspective
- **Project-specific view**: Tasks for one project — the "cockpit" perspective

### 9.1 Scope Switcher Design

The scope switcher should be **prominent but not intrusive** — top-left of the Kanban, before the column grid.

```
┌───────────────────────────────────────────────────────────────────────┐
│  🌐 All Projects ▾  │  🔍 Search...  │  Role ▾ │  Priority ▾ │       │
│  ─────────────────── │                                                │
│  ┌─ Dropdown ──────┐ │                                                │
│  │ 🌐 All Projects │ │                                                │
│  │ ─────────────── │ │                                                │
│  │ 📁 Auth Service │ │                                                │
│  │ 📁 API Gateway  │ │                                                │
│  │ 📁 Frontend v2  │ │                                                │
│  └─────────────────┘ │                                                │
└───────────────────────────────────────────────────────────────────────┘
```

**Interaction:** Click the scope selector → dropdown listing "All Projects" + each active project. Selecting a project filters the board to only that project's tasks. The selected scope should be reflected in the URL (`/tasks?scope=all` vs `/tasks?scope=proj-123`) so it's shareable and bookmarkable.

### 9.2 Global View Differences

When in global view, each task card needs **project attribution** — which project does this task belong to?

**Card modification for global view:**
```
┌────────────────────────────────────┐
│  📁 Auth Service          P2 🟠   │  ← Project name (global view only)
│  Implement JWT validation          │
│  🧑‍💻 developer  ·  Agent abc1  ·  5m │
└────────────────────────────────────┘
```

- Project name appears as a subtle top line on the card, color-coded per project
- Project color is auto-assigned (pick from a palette of 8 distinguishable colors)
- In project-specific view, the project line is hidden (redundant)

**Column behavior in global view:**
- Tasks from different projects intermix within columns, sorted by priority then project
- A **"Group by project"** toggle could stack sub-sections within each column:
  ```
  ┌─ Running ─────────────────┐
  │  📁 Auth Service (3)      │
  │  ├── Task A               │
  │  ├── Task B               │
  │  └── Task C               │
  │                           │
  │  📁 API Gateway (1)       │
  │  └── Task D               │
  └───────────────────────────┘
  ```

### 9.3 Cross-Project Attention Summary

The attention strip (R1) in global view aggregates across projects:
```
┌──────────────────────────────────────────────────────────────────────┐
│ 🔴 Auth: 2 failed  ·  🟠 Gateway: 1 blocked  ·  8/20 total done   │
└──────────────────────────────────────────────────────────────────────┘
```

This gives the "air traffic control" view — immediately see which projects have problems.

### 9.4 Navigation Integration

The scope selector should integrate with the existing navigation:
- Clicking a project in the sidebar → switches to project-specific Kanban
- The Tasks page in the sidebar defaults to global view
- Deep links from the HomeDashboard (e.g., "2 tasks need attention in Auth Service") → project-specific Kanban, pre-filtered

---

## 10. Creative Alternatives: Command Center Model

> *"Be creative about how to reach that goal. The sections are just recommendations."*

The lead's directive opens the door to rethink the Kanban as something more than a status board. Here are three unconventional models worth exploring.

### 10.1 The Unified Command Center (Recommended Exploration)

**Concept:** Instead of separate Dashboard + Kanban pages, merge them into a single **Command Center** that provides both situational awareness AND task management in one view.

```
┌─────────────────────────────────────────────────────────────────────┐
│  COMMAND CENTER                                     🌐 All Projects │
├──────────────┬──────────────────────────────────────────────────────┤
│              │                                                      │
│  ⚡ NEEDS    │  KANBAN COLUMNS                                      │
│  ATTENTION   │  ┌──────┬──────┬──────┬──────┐                      │
│              │  │ Run  │ Ready│ Block│ Fail │                      │
│  🔴 2 failed │  │      │      │      │      │                      │
│  🟠 1 blocked│  │ ···  │ ···  │ ···  │ ···  │                      │
│  ⚠️ 1 stale  │  │      │      │      │      │                      │
│              │  └──────┴──────┴──────┴──────┘                      │
│  ────────────│                                                      │
│              │  ── Done (8) ── Pending (3) ──  [collapsed]         │
│  📋 DECISIONS│                                                      │
│              │                                                      │
│  ✋ Approval │                                                      │
│     needed   │                                                      │
│  ✅ JWT auth │                                                      │
│     approved │                                                      │
│              │                                                      │
│  ────────────│                                                      │
│              │                                                      │
│  📊 PROGRESS │                                                      │
│  ████████░░  │                                                      │
│  67% done    │                                                      │
│  3 agents    │                                                      │
│  active      │                                                      │
│              │                                                      │
└──────────────┴──────────────────────────────────────────────────────┘
```

**Layout:** Left sidebar (240px) is the **mission brief** — attention items, decisions, progress. Right area (flex) is the **Kanban board**. This is one page, not two.

**Why this works:**
- Eliminates the "check dashboard → switch to tasks → switch back" loop
- The left panel answers "what needs me?" while the right panel answers "what's the full picture?"
- Decisions and attention items are **always visible** alongside the task board
- The left panel collapses on smaller screens, giving the Kanban full width

**Key design principles:**
- Left panel shows **actionable** items only (decisions needing approval, failed tasks, stale warnings)
- Items disappear from the left panel when resolved → zero-inbox feeling
- Clicking an item in the left panel highlights the corresponding card in the Kanban

### 10.2 The Pulse Feed (Alternative)

**Concept:** Replace the static Kanban with a **real-time activity feed** that surfaces events in chronological order, with the ability to "zoom out" to the board view.

```
┌──────────────────────────────────────────────────────────────────┐
│  PULSE FEED                              [Board View] [Feed View] │
│                                                                    │
│  ● 2m ago — Auth Service                                          │
│    🔴 "Implement JWT validation" FAILED                           │
│    Error: Token signing key not found in env                      │
│    [Retry] [View Logs] [Reassign]                                 │
│                                                                    │
│  ● 5m ago — API Gateway                                           │
│    ✅ "Rate limiter middleware" completed by Developer @abc1       │
│    Unlocked: "Load testing suite" → now READY                     │
│                                                                    │
│  ● 8m ago — Auth Service                                          │
│    ✋ DECISION NEEDED: "Use RS256 or HS256 for JWT signing?"      │
│    Architect recommends RS256. [Approve RS256] [Override]         │
│                                                                    │
│  ● 12m ago — Frontend v2                                          │
│    🔵 "KanbanBoard component" is now RUNNING (Developer @def2)   │
│                                                                    │
│  ● 15m ago — Global                                               │
│    📋 New task DAG declared for "Frontend v2" (12 tasks)          │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

**Why this could work:**
- Mirrors how operators actually consume information — "what just happened?"
- Each event is actionable inline — no navigating to a different page
- Natural fit for real-time WebSocket updates
- Decisions surface naturally in the flow instead of a separate panel

**Why it might not work:**
- Loses spatial stability — no fixed position for a task, hard to find a specific one
- At high event velocity (20+ agents), the feed becomes unreadable
- Doesn't give the "at a glance" overview that a board provides

**Verdict:** Best as a **complement** to the Kanban, not a replacement. Could be the content of the left panel in the Command Center model (10.1).

### 10.3 The Heat Map Matrix (Alternative)

**Concept:** A dense, spatial overview where rows = agents, columns = time blocks, and cells are color-coded by status.

```
┌────────────────────────────────────────────────────────────────┐
│  AGENT ACTIVITY MATRIX              Last 2 hours → now        │
│                                                                │
│                 -2h  -1.5h  -1h  -30m  -15m  NOW             │
│  Developer 1   🟢    🔵    🔵    🔵    🔵    🔵              │
│  Developer 2   🟢    🟢    🔵    🔵    🔴    🔴  ← STUCK    │
│  Architect     ⚪    ⚪    🔵    🔵    🟢    ⚪  ← IDLE      │
│  Code Reviewer ⚪    🔵    🟢    ⚪    ⚪    ⚪              │
│  QA Tester     ⚪    ⚪    ⚪    ⚪    🔵    🔵              │
│                                                                │
│  Legend: 🔵 Running  🟢 Completed  🔴 Failed  ⚪ Idle        │
└────────────────────────────────────────────────────────────────┘
```

**Why this could work:** Instant visibility of agent utilization and stuck agents. Great for the "are my agents productive?" question.

**Verdict:** Already partially exists as `AgentHeatmap` in the OverviewPage. Could be incorporated as a mini-widget in the Command Center left panel. Not a Kanban replacement.

### 10.4 Recommendation

**Go with the Command Center model (10.1)** as the primary layout, with the Kanban board as the main content area. The left panel replaces the need for a separate dashboard page for task-related monitoring. The HomeDashboard can focus on the higher-level stuff (project health, system status, onboarding) while the Command Center is the operational workspace.

This approach:
- ✅ Satisfies "glance and understand everything" requirement
- ✅ Surfaces decisions and attention items without a separate page
- ✅ Keeps the Kanban as the primary task visualization
- ✅ Supports global + project scope switching
- ✅ Creative but not radical — still learnable for users familiar with project management tools

---

## 11. Many-to-Many Team ↔ Project Implications

### The Challenge
Teams and Projects have a many-to-many relationship:
- A Team can work across multiple Projects
- A Project can have agents from multiple Teams

This affects the Kanban in several ways:

### 11.1 Task Card Attribution
Each task has a `role` and `assignedAgentId`, but the **team** is not directly on the task. The agent belongs to a team (or multiple teams). 

**Design decision:** Don't show team on the task card. Show **role** and **agent** — these are more operationally relevant. Team filtering is a secondary concern.

### 11.2 Global View Filtering
In global view, users might want to filter by:
- **Project** — "show me Auth Service tasks" (use scope selector)
- **Team** — "show me what Team Alpha is doing across all projects" (add team filter chip)
- **Agent** — "show me what Developer @abc1 is doing" (already in R4 filter bar)

**Team filter** is the new addition needed. It should resolve to the set of agents in that team, then filter tasks by `assignedAgentId ∈ team.agents`.

### 11.3 Cross-Team Visibility
When agents from different teams work on the same project, the board should make this visible without being noisy.

**Recommendation:** In the card's agent section, show a subtle team badge only when the project has agents from 2+ teams:
```
🧑‍💻 developer · Agent abc1 · Team Alpha
```

This only appears when disambiguation is needed — if all agents are from the same team, the team badge is redundant and hidden.

### 11.4 Open Question
Should the Kanban support a **"Team view"** mode (all tasks assigned to agents in a specific team, across projects)? This would be useful for team leads managing a pool of agents, but adds complexity. Recommend deferring to Phase 3 unless PM identifies strong user need.

---

*Updated 2026-03-08 with sections 9-11 based on Lead requirements for global/project views and creative alternatives.*

---

## 12. Converged Design Decisions (Designer + PM Agreement)

After reviewing the PM's scenarios doc (`.flightdeck/shared/product-manager-4b5c4761/kanban-scenarios.md`) and debating in the kanban-ux group, the following decisions are **agreed** between Designer and PM.

### Decision Log

| # | Topic | Decision | Rationale |
|---|-------|----------|-----------|
| D1 | Column order | **Lifecycle order** (pending→ready→running→blocked→done→failed→paused→skipped) | PM's Casey onboarding scenario wins — lifecycle is a universal mental model. Attention strip already handles the "what needs me?" scanning. |
| D2 | Auto-collapse Done | **Conditional**: collapse only when `done > (running + ready + blocked + failed)` | Preserves the "reward signal" for Alex/River personas during active sprints, but de-clutters when the board is mostly complete (Jordan's need). |
| D3 | Failed column | **Never hide with "Hide empty columns"** | PM's AC-12.5 is correct — failures must always be visible. Collapsed is OK (user choice), hidden is not. |
| D4 | DnD vs Context menu | **Context menu first (Phase 2a), within-column DnD same phase, cross-column DnD later (Phase 2b)** | Context menu covers more actions (retry, reassign, pause, logs). Within-column DnD (reorder=priority) is simple and safe. Cross-column DnD needs transition guards. |
| D5 | Swimlanes vs Filters | **Filters first, swimlanes Phase 3** | Filters are O(1) complexity. Swimlanes at 3 teams × 8 columns = 24 zones = cognitive overload. Global view's "group by project" within columns is a lighter alternative. |
| D6 | Card density | **Two modes: Standard (~80px) and Compact (~36px)** | Toggle in toolbar. Auto-engage compact when any column has >15 cards. Manual override available. |
| D7 | Done column at scale | **"Show recent 5" pattern** | Show 5 most recent Done cards + "Show N more" button. Older cards dimmed. Don't auto-archive — users need Done cards for review (PM Scenario 5). |
| D8 | Command Center | **Expandable attention strip** — click to expand into triage dashboard overlay (top 40% viewport), Kanban compressed below | Unifies Designer Section 10.1 + PM's expandable Command Center concept. NOT a separate page. Surfaces decisions + action items + progress in one place. |
| D9 | Agent display | **Role name + 4-char ID** (e.g., "Developer • 903d") | PM's AC-12.13. Full UUID on hover tooltip. Raw IDs are cryptic for onboarding (Casey scenario). |
| D10 | Filter persistence | **URL query params** | Shareable, bookmarkable, respects browser back/forward. Reset on project scope change. Format: `?role=developer&priority=2+` |
| D11 | Stale threshold | **Default 15 min, configurable per project** | PM's answer: adaptive option (2× median task duration) is ideal but Phase 3. Start with configurable static threshold. |
| D12 | Color for Done | **Muted emerald** (not purple) | Agreed: eye should go to problems (red/amber), not victories. Purple is too attention-grabbing for completed work. |
| D13 | Color accessibility | **Icons (primary) + border patterns (secondary)** | Solid=active, dashed=pending/skipped, double=failed, dotted=paused. Plus high-contrast mode support. |

### Revised Phase Roadmap

**Phase 1 — Immediate (this sprint):**
- R1: Attention summary strip ⭐
- R2: Agent assignment on card face (role + 4-char ID)
- R3: Time-in-status display
- R4: Filter bar (role, agent, priority, text search)
- R5: Better empty state with onboarding CTA
- R6 (revised): Conditional auto-collapse Done
- R7: Stale task indicator
- R8: Color semantics (done→emerald, strengthen failed red)
- NEW: Failed column never hidden by "Hide empty columns"
- NEW: Column header tooltips (status explanations)
- NEW: Persistent view state (collapse, filters, hide-empty via URL/localStorage)

**Phase 2a — Core Interactivity (next sprint):**
- R10 (promoted): Right-click context menu (Retry, Reassign, Pause, View Logs, Change Priority)
- R9a: Within-column drag-and-drop (reorder = priority change)
- NEW: Scope switcher (global vs project-specific)
- NEW: Team filter chip (for multi-team projects)
- NEW: Compact card mode toggle
- NEW: "Show recent 5" for Done column overflow
- NEW: `failureReason` display on failed cards

**Phase 2b — Advanced Interactions:**
- R9b: Cross-column drag-and-drop with transition matrix + confirmation guards
- NEW: Quick-add task from Kanban toolbar
- NEW: "Request Rework" action on Done cards
- NEW: "Retry All" batch action on Failed column header
- NEW: Cascading block detection ("3 tasks blocked by 1 root cause")

**Phase 3 — Polish & Scale:**
- R11: 3-lane compact view (Queue | Active | Complete) — useful for global view
- R12: Mobile responsive stacked layout
- R13: Virtual scrolling for 50+ tasks
- NEW: Sprint summary modal (PM Scenario 9)
- NEW: Swimlanes by team (if PM validates user need)
- NEW: Keyboard shortcuts (J/K navigation, M to move, Enter to expand)
- NEW: Command Center expandable mode (triage dashboard overlay)
- NEW: Velocity indicator in toolbar

### New Acceptance Criteria Alignment

The PM published AC-12.1 through AC-12.20. My recommendations map to them:

| PM AC | Designer Rec | Phase |
|-------|-------------|-------|
| AC-12.1 (correct columns) | Existing ✓ | — |
| AC-12.2 (card details) | R2 + completion summary | Phase 1 |
| AC-12.3 (collapse persists) | Persistent view state | Phase 1 |
| AC-12.4 (hide empty persists) | Persistent view state | Phase 1 |
| AC-12.5 (failed never hidden) | NEW: Failed column rule | Phase 1 |
| AC-12.6 (real-time updates) | Existing ✓ (needs animation) | Phase 2a |
| AC-12.7 (filter by role) | R4 filter bar | Phase 1 |
| AC-12.8 (filter by agent) | R4 filter bar | Phase 1 |
| AC-12.9 (filter by team) | Team filter chip | Phase 2a |
| AC-12.10 (keyboard nav) | Keyboard shortcuts | Phase 3 |
| AC-12.11 (column tooltips) | Column header tooltips | Phase 1 |
| AC-12.12 (empty state) | R5 onboarding empty state | Phase 1 |
| AC-12.13 (agent display) | R2 + role+short-ID format | Phase 1 |
| AC-12.14 (time-in-column) | R3 + R7 stale indicator | Phase 1 |
| AC-12.15 (priority edit) | Context menu | Phase 2a |
| AC-12.16 (dependency chain) | Cascading block detection | Phase 2b |
| AC-12.17 (responsive layout) | R12 mobile layout | Phase 3 |
| AC-12.18 (performance 50+) | R13 virtual scrolling | Phase 3 |
| AC-12.19 (team badges) | Team badge (multi-team only) | Phase 2a |
| AC-12.20 (DnD reorder) | R9a within-column DnD | Phase 2a |

### Backend Requirements for Developer (@b04c9b12)

These API changes are needed for the Kanban improvements:

1. **`failureReason` field on DagTask** — Capture last error message from agent. Store in DB. Return in task query.
2. **`PATCH /api/projects/:projectId/tasks/:taskId`** — Mutation endpoint for: status change, priority change, assignment change. Include validation against transition matrix.
3. **`GET /api/tasks?scope=global`** — Global task query across all projects. Support existing filters (role, agent, priority, status).
4. **`completionSummary` field on DagTask** — From COMPLETE_TASK command. Essential for Done card richness (PM Scenario 5).
5. **Stale threshold in project settings** — `staleThresholdMinutes` field, default 15.

---

*Converged design direction agreed 2026-03-08 between Designer @8baab941 and PM @4b5c4761. Pending Lead greenlight.*
