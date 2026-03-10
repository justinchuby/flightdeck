# Navigation Redesign Spec

> **Author:** Designer (@8baab941)  
> **Priority:** URGENT — user-reported UX failures  
> **Status:** Build-ready

---

## Problem Statement

Three fundamental navigation problems identified by the user:

1. **Agents link redirects to a project** instead of showing a global view of all agents/teams
2. **Projects navigation is cramped** — tiny nested text in 66px sidebar, no card overview, no drill-down flow
3. **New button misleads** — says "Start a new session" instead of creating a new project

These aren't cosmetic — they violate user expectations at the navigation level, which is the #1 usability killer.

---

## 1. Sidebar Redesign

### Current (broken)
```
66px wide icon strip:
  [Home]
  [Active Project / Projects]   ← context-dependent, confusing
  --- recent projects ---        ← 9px text, illegible
  [+ New]                        ← misleading action
  [Agents]                       ← redirects to project scope
  --- spacer ---
  [Settings]
```

### Proposed
```
66px wide icon strip:
  [Home]          → /
  [Projects]      → /projects              ← ALWAYS shows projects list
  [Agents]        → /agents                ← GLOBAL agents/teams view
  [+ New]         → opens NewProjectModal  ← creates a project
  --- spacer ---
  [Settings]      → /settings
```

**Key changes:**
- **Remove recent projects list from sidebar.** The 9px truncated text is illegible in a 66px-wide sidebar. Recent projects belong on the HomeDashboard (they're already there as project cards).
- **Projects link is ALWAYS `/projects`** — no more context-switching between "show active project" and "show projects list." The active project is indicated by highlighting within the `/projects/:id` route.
- **Agents link goes to `/agents`** — a NEW global agents page (see Section 3).
- **New button opens `NewProjectModal` directly** — not a toast message.
- **Remove the active project indicator from sidebar.** Project context lives in `ProjectLayout`'s header + breadcrumbs, not the sidebar. The sidebar is for top-level navigation only.

### Component changes: `Sidebar.tsx`

```tsx
// REMOVE: useMatch('/projects/:id/*') project context detection
// REMOVE: recentProjects list rendering
// REMOVE: conditional project/projects link logic

// SIMPLIFIED sidebar items:
<NavItem to="/" icon={Home} label="Home" end />
<NavItem to="/projects" icon={FolderOpen} label="Projects" />
<NavItem to="/agents" icon={Users} label="Agents" />

<button onClick={() => setShowNewProject(true)} ...>
  <Plus size={16} />
  <span>New</span>
</button>

{showNewProject && (
  <NewProjectModal onClose={() => setShowNewProject(false)} />
)}

<div className="flex-1" /> {/* spacer */}
<NavItem to="/settings" icon={Settings} label="Settings" />
```

**Estimated change:** Sidebar goes from 138 LOC → ~60 LOC (simpler).

---

## 2. Projects Navigation: Card Grid → Detail Drill-Down

### Current (broken)
- `/projects` shows an accordion list with expandable cards
- Clicking a card expands inline details — no drill-down to the project
- Getting to a project requires knowing about sidebar recent projects or deep links
- ProjectLayout's tabs are the only way to navigate within a project, but you have to already be there

### Proposed: Two-level navigation

#### Level 1: `/projects` — Project Card Grid

**Component:** Refactor `ProjectsPanel.tsx`

```
┌─────────────────────────────────────────────────┐
│  Projects                           [+ New Project] │
│  ─────────────────────────────────────────────── │
│  [All] [Active] [Archived]     🔍 Search...     │
│                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────┐│
│  │ 📁 Alpha     │  │ 📁 Beta      │  │ 📁 Gamma││
│  │              │  │              │  │         ││
│  │ 🤖 5 agents  │  │ 🤖 3 agents  │  │ 🤖 0    ││
│  │ ✅ 12/20     │  │ ✅ 8/15      │  │ Archived││
│  │ ❌ 1 failed  │  │ All healthy  │  │         ││
│  │              │  │              │  │         ││
│  │ Updated 2h   │  │ Updated 5m   │  │ 3d ago  ││
│  └──────────────┘  └──────────────┘  └─────────┘│
│                                                   │
│  ┌──────────────┐  ┌──────────────┐              │
│  │ 📁 Delta     │  │ 📁 Epsilon   │              │
│  │ ...          │  │ ...          │              │
│  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────┘
```

**Project card contents:**
- Project name (bold, primary text)
- Status badge (Active / Archived)
- Agent count (🤖 N agents)
- Progress summary (✅ X/Y tasks done)
- Attention indicator (❌ N failed, if any — pulls from `/attention?scope=project&projectId=X`)
- Last updated (relative time)
- **Click → navigates to `/projects/:id`** (the key missing behavior)

**Card styling:**
- Grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`
- Card: `bg-surface-raised border border-th-border rounded-lg p-4 hover:border-accent/40 cursor-pointer transition-colors`
- Active projects: normal styling
- Archived: `opacity-60` with archive icon

**Filter tabs:** All / Active / Archived (existing, keep)
**Search:** Filter by project name (existing, keep)
**"+ New Project" button** in header → opens `NewProjectModal`

#### Level 2: `/projects/:id` — Project Detail with Tabs

**Component:** `ProjectLayout.tsx` (existing, refine)

This already works well. Key refinements:

1. **Back navigation:** The back button (←) already navigates to `/projects`. Keep it.
2. **Breadcrumb:** Add a subtle breadcrumb above the tabs:
   ```
   Projects › Alpha Project
   ```
   `"Projects"` is a link back to `/projects`. Project name is current context.
3. **Sidebar highlighting:** When at `/projects/:id/*`, the sidebar "Projects" item should be highlighted (active). This already works since `/projects/:id` is a child of `/projects` — but verify `NavLink` matching.

**Tab bar (existing, keep as-is):**
```
[Overview] [Session] [Tasks] [Agents] [Knowledge] [Design] | [More ▾]
```

The 6 primary + 5 overflow tabs are well-organized. No changes needed here.

---

## 3. Global Agents Page: `/agents`

### Current (broken)
- `/agents` route uses `ProjectRedirect` → redirects to `/projects/:id/agents`
- If no active project, this fails or goes to an arbitrary project
- There IS a `/team` route with `TeamRoster` component (457 LOC), but it's not linked from the sidebar

### Proposed: Standalone `/agents` page

**Route change in `App.tsx`:**
```tsx
// REMOVE:
<Route path="/agents" element={<ProjectRedirect page="agents" />} />

// REPLACE WITH:
<Route path="/agents" element={<Suspense fallback={<RouteSpinner />}><GlobalAgentsPage /></Suspense>} />
```

**Component:** `GlobalAgentsPage.tsx` — new page, reuses `TeamRoster` patterns

```
┌─────────────────────────────────────────────────┐
│  Agents & Teams                    🔍 Search... │
│  ─────────────────────────────────────────────── │
│  [All] [Active] [Idle] [Terminated]              │
│                                                   │
│  ── Team: Alpha (3 agents) ──────────────────── │
│  ┌────────────────────────────────────────────┐  │
│  │ 🎨 Designer • a8b2  │ Running │ Alpha     │  │
│  │ 💻 Developer • 7c3f │ Running │ Alpha     │  │
│  │ 📋 PM • 4b5c        │ Idle    │ Alpha     │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  ── Team: Beta (2 agents) ───────────────────── │
│  ┌────────────────────────────────────────────┐  │
│  │ 💻 Developer • 1f9a │ Running │ Beta      │  │
│  │ 🔍 Reviewer • e3d1  │ Idle    │ Beta      │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  Summary: 5 agents across 2 teams                │
│  3 running · 2 idle · 0 failed                   │
└─────────────────────────────────────────────────┘
```

**Data source:** `GET /agents/roster` (existing endpoint used by `TeamRoster`)

**Agent row contents:**
- Role icon + role name
- Agent short ID (4 chars)
- Status badge (Running / Idle / Creating / Failed / Terminated)
- Project association (which project(s) — clickable link to `/projects/:id`)
- Current task summary (truncated, if running)

**Grouping:** Group by team/project by default. Toggle to flat list view.

**Click agent row:** Expands inline detail panel (reuse `TeamRoster`'s profile view pattern: overview, history, knowledge tabs).

**Key difference from project-scoped TeamPage:**
- TeamPage (`/projects/:id/agents`) shows agents for ONE project
- GlobalAgentsPage (`/agents`) shows ALL agents across ALL projects
- GlobalAgentsPage groups by team/project for orientation
- Each agent card links back to its project

**Implementation approach:**
- Extract shared agent card/row components from `TeamRoster.tsx` into a reusable `AgentCard.tsx`
- `GlobalAgentsPage` fetches all agents (no project filter), renders grouped
- `TeamPage` continues to exist for project-scoped view
- ~250 LOC for the new page, reusing existing patterns

---

## 4. New Project Flow

### Current (broken)
- Sidebar "New" button navigates to `/projects?action=new`
- ProjectsPanel shows a toast: "Start a new session from any project to create agents"
- Actual project creation modal (`NewProjectModal`) only exists inside `LeadDashboard`

### Proposed: Direct modal from sidebar

**Trigger:** Sidebar "New" button → opens `NewProjectModal` directly (no navigation, no toast).

**Component changes:**
1. **Move `NewProjectModal` out of `LeadDashboard/`** → `packages/web/src/components/NewProjectModal/NewProjectModal.tsx`
   - It's used from Sidebar (global context) and potentially from ProjectsPanel
   - Should not be coupled to LeadDashboard

2. **Sidebar renders modal:**
   ```tsx
   const [showNewProject, setShowNewProject] = useState(false);
   
   // In render:
   <button onClick={() => setShowNewProject(true)}>
     <Plus /> New
   </button>
   
   {showNewProject && createPortal(
     <NewProjectModal onClose={() => setShowNewProject(false)} />,
     document.body,
   )}
   ```

3. **ProjectsPanel "New Project" button** also opens the same modal (import `NewProjectModal`).

4. **Remove `?action=new` toast logic** from ProjectsPanel.

**NewProjectModal form fields (existing, keep):**
- Project Name (required) — already has validation
- Initial Task (optional)
- Working Directory (FolderPicker)
- Model selection
- Pre-selected roles
- Resume Session ID (optional)

**On success:** Navigate to `/projects/:id/session` (the new project's Session tab). This is already implemented in the modal's `handleCreate`.

---

## 5. Route Changes Summary

### App.tsx route updates

```tsx
// GLOBAL ROUTES (updated)
<Route path="/" element={<HomeDashboard />} />
<Route path="/projects" element={<ProjectsPanel />} />
<Route path="/agents" element={<GlobalAgentsPage />} />     // NEW: was ProjectRedirect
<Route path="/team" element={<TeamRoster />} />              // KEEP: backward compat
<Route path="/settings" element={<SettingsPanel />} />

// PROJECT-SCOPED ROUTES (unchanged)
<Route path="/projects/:id" element={<ProjectLayout />}>
  <Route index element={<Navigate to="overview" replace />} />
  <Route path="overview" element={<OverviewPage />} />
  <Route path="session" element={<LeadDashboard />} />
  <Route path="tasks" element={<TaskQueuePanel />} />
  <Route path="agents" element={<TeamPage />} />             // project-scoped agents
  <Route path="knowledge" element={<KnowledgePanel />} />
  <Route path="design" element={<DesignPanel />} />
  <Route path="timeline" element={<TimelinePage />} />
  <Route path="groups" element={<GroupChat />} />
  <Route path="org-chart" element={<OrgChart />} />
  <Route path="analytics" element={<AnalyticsPage />} />
  <Route path="canvas" element={<CanvasPage />} />
</Route>

// BACKWARD COMPAT REDIRECTS (keep, they serve old bookmarks)
```

---

## 6. Mobile Navigation

### Current
`MobileNav.tsx` (116 LOC) shows a flat list of 10 links, all using `ProjectRedirect` pattern.

### Proposed
Mirror the sidebar redesign:

```
Hamburger menu:
  [Home]           → /
  [Projects]       → /projects
  [Agents]         → /agents
  [+ New Project]  → opens NewProjectModal
  ──────
  [Settings]       → /settings
```

When inside a project (`/projects/:id/*`), add a secondary section:

```
  ────── Current Project: Alpha ──────
  [Overview]  [Session]  [Tasks]
  [Agents]    [Knowledge]  [Design]
  [Timeline]  [Groups]  [More...]
```

This gives mobile users both global nav AND project-scoped tabs.

---

## 7. Breadcrumbs

Add a `Breadcrumb` component to `ProjectLayout` header:

```tsx
// packages/web/src/components/ui/Breadcrumb.tsx (~30 LOC)
interface BreadcrumbProps {
  items: Array<{ label: string; to?: string }>;
}

// Renders: Projects › Alpha Project › Tasks
// "Projects" links to /projects
// "Alpha Project" links to /projects/:id
// "Tasks" is current (no link)
```

**Placement:** In `ProjectLayout.tsx`, above the tab bar, replacing the simple "← Back" button with richer breadcrumbs.

**Styling:** `text-xs text-th-text-muted` with `hover:text-th-text` on links. Separator: `›` with `mx-1`.

---

## 8. Sidebar Active State Logic

The sidebar should correctly highlight items based on the current route:

| URL | Highlighted item |
|-----|-----------------|
| `/` | Home |
| `/projects` | Projects |
| `/projects/:id` | Projects |
| `/projects/:id/tasks` | Projects |
| `/projects/:id/agents` | Projects (NOT "Agents") |
| `/agents` | Agents |
| `/settings` | Settings |

**Key insight:** `/projects/:id/agents` is the project-scoped agent view (highlighted under "Projects"), while `/agents` is the global view (highlighted under "Agents"). These are different navigation items.

**Implementation:** Use `NavLink` with default matching (prefix match). `/projects` will match both `/projects` and `/projects/:id/*`. Use `end` prop only on Home (`/`).

```tsx
<NavItem to="/" icon={Home} label="Home" end />        // exact match
<NavItem to="/projects" icon={FolderOpen} label="Projects" /> // prefix match
<NavItem to="/agents" icon={Users} label="Agents" />    // prefix match
```

---

## 9. Component Structure

### New files
```
packages/web/src/
├── components/
│   ├── NewProjectModal/
│   │   └── NewProjectModal.tsx    ← moved from LeadDashboard/
│   ├── GlobalAgentsPage/
│   │   └── GlobalAgentsPage.tsx   ← new, ~250 LOC
│   └── ui/
│       └── Breadcrumb.tsx         ← new, ~30 LOC
```

### Modified files
```
├── components/
│   ├── Sidebar.tsx                ← simplified, ~60 LOC (was 138)
│   ├── ProjectsPanel/
│   │   └── ProjectsPanel.tsx      ← cards navigate on click, add New button
│   └── Layout/
│       └── MobileNav.tsx          ← mirror sidebar changes
├── layouts/
│   └── ProjectLayout.tsx          ← add breadcrumbs, keep tabs
├── App.tsx                        ← route changes (/agents → GlobalAgentsPage)
```

### Deleted/deprecated
```
├── LeadDashboard/
│   └── NewProjectModal.tsx        ← moved (not deleted, re-exported for compat)
```

---

## 10. Migration Safety

**Backward compatibility:** All old routes (`/agents`, `/tasks`, `/lead`, etc.) already have `ProjectRedirect` handlers. These continue to work for bookmarks and external links. The only change is `/agents` now goes to the global page instead of redirecting.

**No data migration needed.** This is purely navigation/UI routing.

**localStorage:** Sidebar no longer stores recent projects (that data stays in HomeDashboard). No cleanup needed — unused keys are harmless.

---

## 11. Estimated Effort

| Component | LOC | Complexity |
|-----------|-----|-----------|
| Sidebar simplification | -78 (net reduction) | Low — removing code |
| ProjectsPanel card click navigation | ~20 | Low — add `onClick={() => navigate(...)}` |
| GlobalAgentsPage | ~250 | Medium — new page, reuses TeamRoster patterns |
| NewProjectModal relocation | ~10 | Low — move file, update imports |
| Breadcrumb component | ~30 | Low |
| MobileNav update | ~30 | Low |
| App.tsx route changes | ~10 | Low |
| **Total net new** | **~270 LOC** | |
