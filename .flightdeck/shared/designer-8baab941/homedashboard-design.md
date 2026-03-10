# HomeDashboard Design Spec

**Component:** `packages/web/src/components/HomeDashboard/HomeDashboard.tsx` (652 LOC)  
**Author:** Designer @8baab941  
**Date:** 2026-03-08  
**Status:** FINAL — Ready for @76be0a0c to implement against

---

## 1. Current State Assessment

The HomeDashboard is **already well-built**. @76be0a0c has done solid work. The section order and information architecture are fundamentally correct:

1. ✅ **Quick Stats** (4 stat cards: projects, agents, action required, decisions)
2. ✅ **User Action Required** (permission requests + decisions needing approval)
3. ✅ **Active Work** (running agents with status)
4. ✅ **Decisions Made + Progress** (two-column layout)
5. ✅ **Projects Grid** (card per project, sorted by activity)

**Current grade: B+** — The structure is right, the data is right, the components are clean. What's missing is **visual weight hierarchy** — the dashboard treats all sections equally when they have very different urgency levels.

---

## 2. Design Vision: The Glanceable Command Center

The user should glance at this page for **3 seconds** and know:

1. **"Am I needed?"** → Action Required section (should SCREAM if yes, be invisible if no)
2. **"What's happening?"** → Active Work (how many agents, which projects)
3. **"Are we on track?"** → Progress bars (% done per project)
4. **"What decisions were made?"** → Decision feed (informational, lowest urgency)

**Key principle:** The dashboard's visual weight should be **proportional to urgency**, not to section order or content volume.

---

## 3. AttentionBar Integration

The AttentionBar (@0dde0f25 building) will sit **above** the HomeDashboard in the app shell. This changes the dashboard's responsibility.

### What the AttentionBar Handles (Remove from Dashboard)
- ❌ The "Action Required" count in the Quick Stats row is **redundant** with the AttentionBar. The bar already shows failed tasks, blocked tasks, and pending decisions.
- ❌ Connection status badge (top-right) — move to the AttentionBar or app header.

### What the Dashboard Should Still Show
- ✅ **User Action Required section** — The AttentionBar shows the COUNT; the dashboard shows the DETAILS. The bar says "2 actions needed"; the dashboard shows exactly what they are with inline actions.
- ✅ Everything else stays. The bar and dashboard are complementary, not competing.

### Layout Relationship
```
┌─────────────────────────────────────────────────┐
│  App Header (h-12)                              │
├─────────────────────────────────────────────────┤
│  AttentionBar (28-44px) — system-wide           │ ← NEW
├─────────────────────────────────────────────────┤
│  PulseStrip                                     │ ← existing
├─────────────────────────────────────────────────┤
│  HomeDashboard content (scrollable)             │
│  ┌────────────────────────────────────────────┐ │
│  │ Quick Stats                                │ │
│  │ Action Required (if any)                   │ │
│  │ Active Work                                │ │
│  │ Decisions + Progress                       │ │
│  │ Projects Grid                              │ │
│  └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

### Deduplication Rule
When the AttentionBar is in **Red mode** (3+ exceptions), the dashboard's "User Action Required" section should have a subtle link: "↑ See attention bar for summary" — guiding users UP rather than duplicating the urgency. The details (list of items with actions) remain in the dashboard.

---

## 4. Section-by-Section Design Guidance

### 4.1 Quick Stats Row — Redesign as "Pulse Strip"

**Current:** 4 equal-sized stat cards in a grid.  
**Problem:** Equal visual weight. "3 Active Projects" and "2 Action Required" are NOT equally important.

**Recommendation:** Replace the 4 cards with a **compact inline stat strip**:

```
┌──────────────────────────────────────────────────────────────────┐
│  📁 3 projects  ·  🤖 5 agents running  ·  📊 67% avg progress  │
└──────────────────────────────────────────────────────────────────┘
```

- Single horizontal row, not a 4-card grid
- Removes "Action Required" count (AttentionBar handles this)
- Removes "Decisions" count (shown in the section below)
- Adds aggregate progress % (actual useful info)
- Much less vertical space (~40px vs ~100px)
- The stat strip is informational (no click targets) — just context

**Alternative (keep cards, adjust weight):** If the card design is preferred, reduce from 4 to 3 cards: Projects, Running Agents, Avg Progress. Remove Action Required (AttentionBar) and Decisions (section below).

### 4.2 User Action Required — Already Good, Minor Tweaks

**Current implementation is solid.** The amber border, icon differentiation (Shield for permissions, Gavel for decisions), and "show 5 then +N more" pattern are all correct.

**Tweaks:**
1. **Add section collapse for zero state:** Currently the section hides entirely when `actionRequiredCount === 0`. This is correct — keep it.
2. **Animate items out on resolve:** When a user approves a decision, the item should animate out (slide up + fade, 200ms) rather than causing a layout jump. Use `AnimatePresence` from framer-motion if available, or CSS transition with `max-height: 0`.
3. **Show project color dot:** Since this is a global view, add a small colored dot next to the project name to help users quickly associate items with projects.

### 4.3 Active Work — Add Per-Project Grouping

**Current:** Flat list of agents, each showing project name inline.  
**Problem:** When 5 agents across 3 projects are running, the flat list doesn't show the project structure.

**Recommendation:** Group agents by project:

```
┌─ Active Work ───────────────────────────────────┐
│  📁 Auth Service (3 agents)                     │
│    ● Developer • 903d — Implement JWT service   │
│    ● Architect • cc29 — Review auth patterns    │
│    ● QA Tester • fa3d — Write auth tests        │
│                                                 │
│  📁 API Gateway (2 agents)                      │
│    ● Developer • 7b2a — Rate limiter middleware  │
│    ● Code Reviewer • d6e9 — Review endpoints    │
└─────────────────────────────────────────────────┘
```

- Project headers are collapsible (click to hide/show agents for that project)
- Agent count shown in header
- Agents show: role + 4-char ID + current task (truncated)
- Status dot uses the existing pulse animation for running agents

**Implementation:** Group the `activeAgents` array by `agent.projectId`, then render grouped sections. ~30 LOC change.

### 4.4 Decisions Feed — Add Status Filtering

**Current:** Shows last 10 decisions with status icons.  
**Problem:** Mixes confirmed, rejected, and pending decisions without filtering. The user's question is usually "what decisions need my review?" (already in Action Required) or "what did agents decide?" (informational).

**Tweaks:**
1. **Add tab filter:** "All" / "Auto-approved" / "Needs Review" — small tab strip above the list.
2. **Highlight the decision's impact:** The current format shows category + agent role + project + time. Add a **one-line rationale** from the decision's `reasoning` field (if available) — this is what makes decisions trustworthy.
3. **Make decisions clickable:** Click → navigate to the project session where the decision was made.

### 4.5 Progress Section — Enhance with Milestone Context

**Current:** Per-project progress bars (done/total with colored segments).  
**This is already good.** The multi-color bar (green=done, blue=running, red=failed) is informative.

**Tweaks:**
1. **Add failed task count explicitly:** The red segment is there but small. Add text: "3 failed" in red if any.
2. **Show estimated completion:** If we can compute velocity (tasks done / time), show "~20m remaining" estimate.
3. **Click to navigate to project tasks:** Already implemented with the button wrapper. Good.

### 4.6 Projects Grid — Already Good

**Current implementation is solid.** Status badges, agent counts, session counts, timestamps, and descriptions are all present. Sorted by activity (running agents first).

**One tweak:** When a project has failed tasks, show a small red indicator:
```
📁 Auth Service — 3 agents running · ⚠ 1 failed task
```

This connects the project card to the AttentionBar's data, reinforcing the urgency signal.

---

## 5. Information Hierarchy (Visual Weight)

The dashboard should apply these visual weight rules:

| Section | Visual Weight | Condition | Behavior |
|---------|--------------|-----------|----------|
| Action Required | **HIGH** (amber border, icon) | When items exist | Appears at top. Amber accent draws eye. |
| Action Required | **ZERO** | When empty | Completely hidden. Don't show "No actions" — that's the AttentionBar's job. |
| Active Work | **MEDIUM-HIGH** | Always (when agents exist) | Shows what's happening NOW. Animated pulse dots. |
| Progress | **MEDIUM** | Always (when projects have DAGs) | Status bars. Calm, informational. |
| Decisions | **LOW-MEDIUM** | Always | Informational feed. De-emphasized text. |
| Projects Grid | **LOW** | Always | Navigation cards. Reference, not monitoring. |
| Quick Stats | **LOW** | Always | Context strip. Don't draw attention. |

**Rule:** If Action Required has items, it should consume ~30% of above-the-fold viewport. If it doesn't, Active Work should be the dominant section.

---

## 6. Responsive Behavior

The current implementation uses Tailwind responsive classes well (`grid-cols-1 sm:grid-cols-4`, `lg:grid-cols-2`). 

**Additional guidance:**

| Breakpoint | Layout |
|-----------|--------|
| `≥1200px` | Full layout, Decisions + Progress side-by-side, 2-col project grid |
| `768-1199px` | Stack Decisions above Progress, 2-col project grid |
| `<768px` | Single column throughout. Action Required items should be **full-width cards**, not compressed rows. Touch targets ≥44px. |

---

## 7. Loading & Empty States

**Loading:** Current spinner is fine. Consider adding skeleton cards (3 cards placeholder) instead of a spinner for perceived performance.

**Empty state (no projects):** Current implementation is good — uses `EmptyState` component with "Welcome to Flightdeck" and CTA. Keep as-is.

**Partial empty states:**
- No active agents: Hide "Active Work" section entirely (don't show "No agents" — it's noise)
- No decisions: Hide "Decisions" section entirely
- No progress data: Hide "Progress" section entirely
- Only projects: Show just the stats strip + project grid — clean and simple for new users

---

## 8. AttentionBar Consistency

Both the AttentionBar and the HomeDashboard surface "attention items." They must be consistent:

| Data Point | AttentionBar Shows | Dashboard Shows |
|-----------|-------------------|----------------|
| Failed tasks | Count + severity color | N/A (tasks page concern) |
| Pending decisions | Count | Full list with titles + inline approve/reject |
| Permission requests | Count | Full list with details + grant/deny |
| Blocked tasks (>threshold) | Count + severity | N/A (tasks page concern) |
| Stale tasks | Count | N/A (tasks page concern) |

**Key rule:** The AttentionBar is the **global alert system**. The Dashboard is the **detail view for action items**. They share the same data source (attention-items endpoint) but show different levels of detail.

The Dashboard should NOT show task-level issues (failed, blocked, stale) — those belong on the Tasks/Kanban page. The Dashboard shows **human-actionable items**: decisions needing approval and permission requests.

---

## 9. Summary of Changes

| Change | Priority | Est. LOC | Section |
|--------|---------|---------|---------|
| Replace Quick Stats with compact stat strip | Medium | -30, +15 | §4.1 |
| Group Active Work by project | High | +30 | §4.3 |
| Add failed task indicator to project cards | Medium | +10 | §4.6 |
| Add decision rationale one-liner | Low | +5 | §4.4 |
| Remove redundant Action Required stat card | High | -5 | §4.1 |
| Remove connection status (moved to header/bar) | Low | -5 | §3 |
| Animate item removal on action | Low | +15 | §4.2 |

**Net change:** ~+35 LOC. These are refinements, not rewrites. The current implementation is fundamentally sound.

---

*Design guidance for @76be0a0c. Questions → @8baab941 in ui-team. Product questions → @4b5c4761.*
