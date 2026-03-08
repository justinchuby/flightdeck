# Project-Centric UI Layout

> Design doc for restructuring Flightdeck's navigation from a flat sidebar to a project-centric hub model.

## Table of Contents

1. [Problem](#problem)
2. [Design Principles](#design-principles)
3. [Page Hierarchy](#page-hierarchy)
4. [Navigation Model](#navigation-model)
5. [Top-Level Pages](#top-level-pages)
   - [Home](#home-dashboard)
   - [Team](#team-management)
   - [Settings](#settings)
6. [Project View](#project-view)
   - [Overview Tab](#1-overview)
   - [Session Tab](#2-session)
   - [Tasks Tab](#3-tasks)
   - [Agents Tab](#4-agents)
   - [Groups Tab](#5-groups)
   - [Analytics Tab](#6-analytics)
   - [Org Chart Tab](#7-org-chart)
   - [Knowledge Tab](#8-knowledge)
   - [Design Tab](#9-design)
7. [Data Requirements](#data-requirements)
8. [Routing Scheme](#routing-scheme)
9. [Store Refactoring](#store-refactoring)
10. [Relationship to Multi-Team Model](#relationship-to-multi-team-model)
11. [Migration Plan](#migration-plan)
12. [Open Questions](#open-questions)

---

## Problem

The current sidebar has **17 navigation items** (11 primary + 6 under "More") with overlapping concepts:

```
Current sidebar:
  Lead (/)               ← project-scoped
  Mission (/mission)     ← project-scoped
  Agents (/team)         ← global
  Tasks (/tasks)         ← project-scoped
  Projects (/projects)   ← global
  Knowledge (/knowledge) ← project-scoped
  Analytics (/analytics) ← global
  Settings (/settings)   ← global
  More:
    Overview (/overview)   ← project-scoped
    Dashboard (/agents)    ← global
    Timeline (/timeline)   ← project-scoped
    Canvas (/canvas)       ← project-scoped
    Groups (/groups)       ← project-scoped
    Org Chart (/org)       ← project-scoped
  Hidden:
    Agent Server (/agent-server)
    Team Health (/team/health)
    Database (/data → /knowledge?tab=data)
```

**Problems:**
1. A user thinking "I want to see my agents" has 3+ destinations (Agents, Dashboard, Team, Mission)
2. Projects is hidden under "Team" section — but it's the primary entry point
3. 9 of 17 pages are project-scoped, but there's no project context in the navigation
4. Switching projects doesn't visually change the navigation — the user must remember which project is active
5. Pages like Lead Dashboard, Overview, and Mission Control show overlapping information

**Solution:** Make the **project** the central organizing concept. Everything project-related lives inside a Project View with tabs. Only cross-project concerns (team roster, settings) live at the top level.

---

## Design Principles

1. **Project as workspace.** Clicking a project scopes the entire UI. The sidebar reflects the project context.
2. **Three levels, not seventeen.** Top-level: Home / Team / Settings. Project-level: 9 tabs. Item-level: detail panels.
3. **No duplicate concepts.** One place for agents (project's Agents tab), one place for tasks (project's Tasks tab), one place for knowledge (project's Knowledge tab).
4. **Progressive disclosure.** Empty projects show helpful onboarding. Active projects show rich data. Power-user views (Canvas, Timeline, Org Chart) are tabs, not primary navigation.
5. **Context preservation.** Switching tabs within a project preserves scroll position, filters, and selections. Switching projects resets to Overview.

---

## Page Hierarchy

```
Flightdeck
├── Home (/)
│   ├── All Projects grid/list
│   ├── Quick-start card (when no projects)
│   └── Recent activity feed
│
├── Project View (/projects/:id)
│   ├── Overview     — key updates, decisions, design files
│   ├── Session      — lead conversation, message history
│   ├── Tasks        — DAG view, task status, assignments
│   ├── Agents       — fleet for this project, status, output
│   ├── Groups       — chat groups within this project
│   ├── Analytics    — project-specific metrics
│   ├── Org Chart    — agent hierarchy
│   ├── Knowledge    — project-scoped knowledge entries
│   └── Design       — generated design files and artifacts
│
├── Team (/team)
│   ├── Roster       — all persistent agents across projects
│   ├── Health       — team-wide health dashboard
│   ├── Export/Import — portable team bundles
│   └── Agent Profiles — individual agent history/skills
│
└── Settings (/settings)
    ├── Providers    — API key configuration
    ├── Preferences  — theme, notifications, etc.
    └── Advanced     — agent server status, database browser
```

---

## Navigation Model

### Sidebar (Collapsed: 56px icons, Expanded: 220px with labels)

```
┌──────────────────────┐
│  🏠  Home            │  ← / (always visible)
│                      │
│  PROJECTS            │  ← section header
│  📁  acme-app ●      │  ← active project (green dot = agents running)
│  📁  billing-svc     │  ← recent project
│  📁  data-pipeline   │  ← recent project
│  + New Project       │  ← create action
│                      │
│  ─────────────────── │
│  👥  Team            │  ← /team
│  ⚙️  Settings        │  ← /settings
└──────────────────────┘
```

**Key behaviors:**
- **Projects section** shows the 5 most recent projects. Each is a direct link to `/projects/:id`.
- **Active project** (green dot) indicates agents are currently running.
- **Clicking a project** navigates to its Project View, last-visited tab (default: Overview).
- **"+ New Project"** opens project creation inline or as a modal.
- **If more than 5 projects**, a "View all" link opens the Home page's full project list.

### Project View Header (inside project)

When inside a project, the main content area has a **horizontal tab bar** at the top:

```
┌─────────────────────────────────────────────────────────────────┐
│  📁 acme-app  ▾                           🔴 3 agents running  │
├─────────────────────────────────────────────────────────────────┤
│  Overview │ Session │ Tasks │ Agents │ Groups │ ••• │           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                    (tab content area)                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Tab bar details:**
- First 5 tabs always visible: **Overview, Session, Tasks, Agents, Groups**
- Overflow menu (**•••**): Analytics, Org Chart, Knowledge, Design
- Tab badges: Tasks shows pending count, Groups shows unread count
- Project name in header is a dropdown to quickly switch projects
- Agent count indicator shows running agents for this project

---

## Top-Level Pages

### Home Dashboard

**Route:** `/`

**Purpose:** Project workspace switcher and cross-project overview.

**Layout:**
```
┌──────────────────────────────────────────────────────────────┐
│  Welcome back, Justin                                        │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ 3 Projects  │  │ 7 Agents    │  │ 12 Tasks    │         │
│  │ 2 active    │  │ 5 running   │  │ 8 complete  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
│  Recent Projects                            + New Project    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 📁 acme-app          ● 3 agents    Updated 5m ago   │   │
│  │    Frontend refactor session — 2 tasks remaining     │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ 📁 billing-service    ○ 0 agents    Updated 2h ago  │   │
│  │    API redesign — completed                          │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ 📁 data-pipeline     ● 2 agents    Updated 12m ago  │   │
│  │    ETL optimization — 1 task remaining               │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Recent Decisions (across all projects)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ⚠️  [acme-app] Architect wants to refactor auth...   │   │
│  │ ✅  [billing] Developer completed payment module     │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Data sources:**
- `GET /api/projects` — project list with status
- `GET /api/agents` — running agent count per project (via `appStore.agents` filtered by projectId)
- `GET /api/dag/tasks` — task counts per project
- WebSocket `lead:decision` events — cross-project decision feed

**When empty (no projects):**
```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│              Welcome to Flightdeck! 🚀                   │
│                                                          │
│   Let's set up your first AI-powered dev crew.           │
│                                                          │
│   Step 1: Configure a provider                           │
│   [ Connect Claude ] [ Connect Copilot ] [ More... ]     │
│                                                          │
│   Step 2: Create your first project                      │
│   [ Create Project → ]                                   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Team Management

**Route:** `/team`

**Purpose:** Cross-project agent management. Persistent agent identities, team health, export/import.

**Sub-routes:**
- `/team` — Team Roster (default)
- `/team/health` — Health Dashboard
- `/team/export` — Export/Import interface

**Layout:** Reuses existing `TeamPage` (TeamRoster.tsx), `TeamHealth.tsx`, and export/import UI from AS24-28. This is the one place where agents are viewed cross-project.

**What moves here from current nav:**
- Current `/team` route (TeamPage) → stays
- Current Team Health → stays at `/team/health`
- Export/Import buttons → `/team/export`

**What does NOT live here:**
- Agent fleet for a specific project → moved to Project View > Agents tab
- Agent dashboard → merged into Project View > Agents tab

### Settings

**Route:** `/settings`

**Purpose:** Global configuration.

**Sub-routes:**
- `/settings` — Provider configuration (default, most common action)
- `/settings/preferences` — Theme, notifications
- `/settings/advanced` — Agent server status, database browser

**What moves here:**
- Current `/agent-server` panel → `/settings/advanced`
- Database browser → `/settings/advanced`
- Provider setup from current Settings → promoted to default tab

---

## Project View

**Route:** `/projects/:projectId`

This is the heart of the redesign. When a user clicks a project, they enter a scoped workspace with 9 tabs.

### URL Structure

```
/projects/:projectId                → Overview (default)
/projects/:projectId/session        → Session
/projects/:projectId/tasks          → Tasks
/projects/:projectId/agents         → Agents
/projects/:projectId/groups         → Groups
/projects/:projectId/analytics      → Analytics
/projects/:projectId/org            → Org Chart
/projects/:projectId/knowledge      → Knowledge
/projects/:projectId/design         → Design
```

### 1. Overview

**What it shows:** High-level project status — recent decisions, key discussion outcomes, generated design files, activity summary.

```
┌──────────────────────────────────────────────────────────────┐
│  Project Status                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ 3 Agents │ │ 5 Tasks  │ │ 12 Msgs  │ │ 2 Files  │       │
│  │ running  │ │ 2 done   │ │ today    │ │ generated│       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                              │
│  Recent Decisions                                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ✅ Architect: Use JWT for auth (approved 5m ago)     │   │
│  │ ⏳ Developer: Refactor user model (pending review)   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Recent Activity                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 10:42 — dev-1 completed "Fix login validation"       │   │
│  │ 10:38 — architect generated docs/design/auth.md      │   │
│  │ 10:35 — dev-2 started "Add password reset endpoint"  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Generated Files                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 📄 docs/design/auth.md        — by architect, 10:38 │   │
│  │ 📄 src/auth/jwt.ts            — by dev-1, 10:30     │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Data sources:**
- `leadStore.projects[projectId].decisions` — recent decisions
- `leadStore.projects[projectId].activity` — activity feed
- `GET /api/projects/:id` — project metadata
- `GET /api/agents?projectId=X` — agent counts
- `GET /api/dag/tasks?projectId=X` — task counts
- New: `GET /api/projects/:id/files` — generated design files (needs new endpoint)

**Existing code reuse:** Combines elements from `LeadDashboard` (decisions panel), `OverviewPage` (stats cards), and `MissionControlPage` (activity feed). These three pages merge into this one tab.

### 2. Session

**What it shows:** The lead agent's conversation — the primary human↔AI interaction surface.

```
┌──────────────────────────────────────────────────────────────┐
│  Session: Frontend Refactor                    ⏸ Pause  ⬛ Stop│
│  Lead: lead-a7b3 (architect)   Started: 10:30 AM            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                                                      │   │
│  │  [Lead]: I've analyzed the codebase. Here's my plan: │   │
│  │  1. Refactor auth module                             │   │
│  │  2. Add password reset...                            │   │
│  │                                                      │   │
│  │  [You]: Focus on the auth module first.              │   │
│  │                                                      │   │
│  │  [Lead]: Understood. I'll delegate to dev-1...       │   │
│  │                                                      │   │
│  │  💬 dev-1 → lead: Completed auth refactor            │   │
│  │  📊 [Tool call: edit src/auth/jwt.ts]                │   │
│  │                                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  > Type a message to the lead...              [Send] │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Data sources:**
- `leadStore.projects[projectId].messages` — conversation history
- `leadStore.projects[projectId].comms` — inter-agent messages shown inline
- WebSocket `agent:text`, `agent:tool_call` events — streaming
- WebSocket `send('input', { agentId, text })` — user messages

**Existing code reuse:** This is the existing `LeadDashboard` center panel (message history + input box) extracted into its own tab. The right-side panels (team, comms, groups) move to their respective tabs.

### 3. Tasks

**What it shows:** Task DAG, task statuses, agent assignments.

```
┌──────────────────────────────────────────────────────────────┐
│  Tasks                               View: [ DAG ] [ List ] │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                                                      │   │
│  │  [Design Auth] ──→ [Implement Auth] ──→ [Test Auth]  │   │
│  │      ✅ done        🔵 in progress       ⬜ waiting  │   │
│  │      architect       dev-1                qa          │   │
│  │                                                      │   │
│  │  [Design API] ──→ [Implement API]                    │   │
│  │      ✅ done        🔵 in progress                   │   │
│  │      architect       dev-2                            │   │
│  │                                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Task List                                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ✅ Design Auth     architect   completed 10:32       │   │
│  │ 🔵 Implement Auth  dev-1       in progress           │   │
│  │ 🔵 Implement API   dev-2       in progress           │   │
│  │ ⬜ Test Auth       qa          blocked by: Impl Auth │   │
│  │ ⬜ Test API        qa          blocked by: Impl API  │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Data sources:**
- `leadStore.projects[projectId].dagStatus` — DAG state
- `GET /api/dag/tasks?projectId=X` — full task list with dependencies
- WebSocket `dag:updated` — real-time task state changes

**Existing code reuse:** `TaskQueuePanel` + DAG visualization from `CanvasPage`. The Canvas view becomes the "DAG" toggle within this tab.

### 4. Agents

**What it shows:** All agents working on this project, their status, output, and controls.

```
┌──────────────────────────────────────────────────────────────┐
│  Agents (3 running, 1 idle)              [+ Spawn Agent]     │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🟢 architect (lead-a7b3)                            │    │
│  │    Task: Coordinating frontend refactor             │    │
│  │    Status: running │ Tokens: 12.4k │ Cost: $0.03    │    │
│  │    [ View Output ] [ Pause ] [ Terminate ]          │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ 🟢 developer (dev-903d)                             │    │
│  │    Task: Implement auth module                      │    │
│  │    Status: running │ Tokens: 8.2k │ Cost: $0.02     │    │
│  │    [ View Output ] [ Pause ] [ Terminate ]          │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ 🟢 developer (dev-f2c1)                             │    │
│  │    Task: Implement API endpoints                    │    │
│  │    Status: running │ Tokens: 6.1k │ Cost: $0.01     │    │
│  │    [ View Output ] [ Pause ] [ Terminate ]          │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ 🔵 qa-tester (qa-8e4a)                              │    │
│  │    Task: — (waiting for dependencies)               │    │
│  │    Status: idle │ Tokens: 0 │ Cost: $0.00           │    │
│  │    [ View Output ] [ Terminate ]                    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  [ Agent Output Panel — expandable ]                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  dev-903d output:                                    │   │
│  │  > Editing src/auth/jwt.ts...                        │   │
│  │  > Running tests...                                  │   │
│  │  > ✅ All 12 tests pass                              │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Data sources:**
- `appStore.agents.filter(a => a.projectId === projectId)` — project agents
- WebSocket agent events — streaming output
- `GET /api/agent-server/agents` (filtered by project)

**Existing code reuse:** Combines `AgentDashboard` (FleetOverview) agent cards with `LeadDashboard` right-panel agent output. Spawn dialog from `SpawnDialog.tsx` reused.

### 5. Groups

**What it shows:** Chat groups for coordination within this project.

```
┌──────────────────────────────────────────────────────────────┐
│  Groups (3)                              [+ Create Group]    │
│                                                              │
│  ┌─────────┐  ┌──────────────────────────────────────────┐  │
│  │ Groups  │  │  #auth-design                             │  │
│  │         │  │                                           │  │
│  │ #auth-  │  │  architect: Let's use JWT with refresh... │  │
│  │  design │  │  dev-1: Agreed. I'll implement the...     │  │
│  │         │  │  dev-2: What about token rotation?        │  │
│  │ #api-   │  │  architect: Good point. Let's add...      │  │
│  │  review │  │                                           │  │
│  │         │  │  ┌──────────────────────────────────────┐ │  │
│  │ #standup│  │  │ Message #auth-design...        [Send]│ │  │
│  │         │  │  └──────────────────────────────────────┘ │  │
│  └─────────┘  └──────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Data sources:**
- `groupStore.groups.filter(g => g.leadId === projectId)` — project groups
- `groupStore.messages[groupName]` — group message history
- WebSocket `group:message`, `group:created` events

**Existing code reuse:** `GroupChat` component moves here unchanged. Already project-scoped via `leadId`.

### 6. Analytics

**What it shows:** Project-specific metrics — token usage, task completion, agent performance.

**Data sources:**
- `GET /api/analytics?projectId=X` — project metrics
- `GET /api/analytics/sessions?projectId=X` — session history

**Existing code reuse:** `AnalyticsPage` filtered to single project. Currently shows cross-project data; add projectId filter.

### 7. Org Chart

**What it shows:** Agent hierarchy and delegation chains for this project.

**Data sources:**
- `appStore.agents.filter(a => a.projectId === projectId)` with parent/child relationships
- `GET /api/agents?projectId=X` — agent tree

**Existing code reuse:** `OrgChart` component moves here unchanged.

### 8. Knowledge

**What it shows:** Project-scoped knowledge entries — core facts, procedures, decisions, episodic memory.

**Data sources:**
- `GET /api/knowledge?projectId=X` — knowledge entries (already project-scoped)
- `POST /api/knowledge` — add knowledge entry

**Existing code reuse:** `KnowledgePanel` moves here unchanged. Already project-scoped.

### 9. Design

**What it shows:** Generated design files and artifacts — architecture docs, diagrams, specs.

```
┌──────────────────────────────────────────────────────────────┐
│  Design Files                                                │
│                                                              │
│  docs/design/                                                │
│  ├── auth-architecture.md          architect   10:38 AM     │
│  ├── api-schema.md                 architect   10:25 AM     │
│  └── data-model.md                 architect   09:50 AM     │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Preview: auth-architecture.md                       │   │
│  │                                                      │   │
│  │  # Auth Architecture                                 │   │
│  │  ## Overview                                         │   │
│  │  JWT-based authentication with refresh tokens...     │   │
│  │                                                      │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Data sources:**
- New: `GET /api/projects/:id/artifacts` — files written by agents in design/docs directories
- Could use `agentFileHistory` table (already tracks which agents touched which files)
- Markdown preview using existing rendering infrastructure

**New API needed:** An endpoint that queries `agentFileHistory` for design-related files within this project's working directory. No new DB tables — just a query over existing data.

---

## Data Requirements

### New API Endpoints

| Method | Path | Purpose | Source |
|--------|------|---------|--------|
| GET | `/api/projects/:id/summary` | Stats (agent count, task count, recent activity) | Aggregate from existing tables |
| GET | `/api/projects/:id/artifacts` | Design files generated by agents | `agentFileHistory` filtered by project + path patterns |
| GET | `/api/projects/:id/activity` | Recent activity feed | `activityLog` filtered by projectId |

### Existing Endpoints (Already Project-Scoped)

| Endpoint | Scoping |
|----------|---------|
| `GET /api/knowledge?projectId=X` | ✅ Already scoped |
| `GET /api/dag/tasks?projectId=X` | ✅ Already scoped |
| `GET /api/groups?leadId=X` | ✅ Already scoped (leadId = projectId context) |
| `GET /api/analytics?projectId=X` | ✅ Already scoped |
| `GET /api/agents` | Needs: filter param `?projectId=X` |

### Existing Endpoints (Need Project Filter)

| Endpoint | Change |
|----------|--------|
| `GET /api/agents` | Add optional `?projectId=X` query param |
| `GET /api/decisions` | Add optional `?projectId=X` query param |
| WebSocket `subscribe-project` | Already exists — sends `{ type: 'subscribe-project', projectId }` |

### No New Tables

All data already exists in current schema. The project-centric UI is a **view reorganization**, not a data model change. Key tables already have `projectId`:
- `dagTasks.projectId`
- `activityLog.projectId`
- `fileLocks.projectId`
- `knowledge.projectId`
- `agentRoster.projectId`
- `chatGroups.projectId` (via `leadId`)
- `decisions.projectId`

---

## Routing Scheme

### URL Structure

```
/                                    → Home (project list + overview)
/projects/:projectId                 → Project View > Overview (default)
/projects/:projectId/session         → Project View > Session
/projects/:projectId/tasks           → Project View > Tasks
/projects/:projectId/agents          → Project View > Agents
/projects/:projectId/groups          → Project View > Groups
/projects/:projectId/groups/:name    → Project View > Groups > specific group
/projects/:projectId/analytics       → Project View > Analytics
/projects/:projectId/org             → Project View > Org Chart
/projects/:projectId/knowledge       → Project View > Knowledge
/projects/:projectId/design          → Project View > Design
/team                                → Team Roster
/team/health                         → Team Health
/team/export                         → Team Export/Import
/team/:agentId                       → Agent Profile
/settings                            → Settings > Providers (default)
/settings/preferences                → Settings > Preferences
/settings/advanced                   → Settings > Advanced
/shared/:token                       → Shared Replay (unchanged)
```

### React Router Structure

```tsx
<Routes>
  <Route path="/" element={<Home />} />
  
  <Route path="/projects/:projectId" element={<ProjectView />}>
    <Route index element={<ProjectOverview />} />
    <Route path="session" element={<ProjectSession />} />
    <Route path="tasks" element={<ProjectTasks />} />
    <Route path="agents" element={<ProjectAgents />} />
    <Route path="groups" element={<ProjectGroups />} />
    <Route path="groups/:groupName" element={<ProjectGroups />} />
    <Route path="analytics" element={<ProjectAnalytics />} />
    <Route path="org" element={<ProjectOrgChart />} />
    <Route path="knowledge" element={<ProjectKnowledge />} />
    <Route path="design" element={<ProjectDesign />} />
  </Route>

  <Route path="/team" element={<TeamLayout />}>
    <Route index element={<TeamRoster />} />
    <Route path="health" element={<TeamHealth />} />
    <Route path="export" element={<TeamExport />} />
    <Route path=":agentId" element={<AgentProfile />} />
  </Route>

  <Route path="/settings" element={<SettingsLayout />}>
    <Route index element={<ProvidersSettings />} />
    <Route path="preferences" element={<PreferencesSettings />} />
    <Route path="advanced" element={<AdvancedSettings />} />
  </Route>

  <Route path="/shared/:token" element={<SharedReplayViewer />} />
  
  {/* Redirects for old routes */}
  <Route path="/lead" element={<Navigate to="/" />} />
  <Route path="/agents" element={<Navigate to="/" />} />
  <Route path="/overview" element={<Navigate to="/" />} />
  <Route path="/knowledge" element={<Navigate to="/" />} />
  {/* etc. */}
</Routes>
```

### ProjectView Layout Component

```tsx
function ProjectView() {
  const { projectId } = useParams();
  
  // Subscribe to project-scoped WebSocket events
  useEffect(() => {
    sendWsMessage({ type: 'subscribe-project', projectId });
    return () => sendWsMessage({ type: 'subscribe-project', projectId: null });
  }, [projectId]);

  return (
    <div className="flex flex-col h-full">
      <ProjectHeader projectId={projectId} />
      <ProjectTabBar projectId={projectId} />
      <div className="flex-1 overflow-auto">
        <Outlet context={{ projectId }} />
      </div>
    </div>
  );
}
```

---

## Store Refactoring

### Current Problem

State is split awkwardly:
- `appStore` holds global agent list (flat, not project-scoped)
- `leadStore` holds project-specific data keyed by `selectedLeadId`
- `groupStore` holds groups keyed by leadId
- No store manages "which project am I viewing"

### Proposed Store Structure

**Keep:**
- `settingsStore` — unchanged (global preferences)
- `timerStore` — unchanged (global timers)

**Refactor:**
- `appStore` → slim down to connection state + roles only
- `leadStore` → rename to `projectStore`, key by `projectId` instead of `selectedLeadId`
- `groupStore` → fold into `projectStore` (groups are project-scoped)

**New:**
- `navigationStore` — tracks current project, last-visited tab per project

```typescript
// navigationStore.ts
interface NavigationState {
  currentProjectId: string | null;
  lastTab: Record<string, string>;  // projectId → last tab path
  recentProjects: string[];         // ordered by last access
  
  setCurrentProject: (id: string | null) => void;
  setLastTab: (projectId: string, tab: string) => void;
}
```

**Key change:** `selectedLeadId` → `currentProjectId`. The concept doesn't change, but the name clarifies intent and the store reorganization makes project-scoping explicit.

### Migration Path for Stores

1. Create `navigationStore` with `currentProjectId`
2. Rename `leadStore` → `projectStore`, change key from `selectedLeadId` to `projectId`
3. Move group state from `groupStore` into `projectStore.projects[id].groups`
4. Slim `appStore`: remove agent data that should be project-scoped
5. Update all component imports (find/replace)

---

## Relationship to Multi-Team Model

The project-centric UI maps directly to the `(projectId, teamId)` scoping from the agent server architecture:

```
Home page           → shows all projects (any teamId)
Project View        → scoped to (projectId, currentTeamId)
Team page           → shows agents across all (projectId, teamId) pairs
Settings            → global, no scoping
```

**Team switching within a project:**
- If the user has multiple teams on the same project, the Project View header shows a team switcher dropdown
- Default: `teamId = 'default'` (hidden from UI for single-team users)
- When team is switched, the `subscribe-project` WebSocket message includes `teamId`
- Agents tab, Tasks tab, Groups tab all filter to `(projectId, teamId)`
- Knowledge tab shows project-level knowledge (shared across teams)

**The agent server's `configure` message** (from the design doc) maps to: user navigates to a different project → orchestrator sends `configure` with new `(projectId, teamId)` → agent server routes events for that scope.

---

## Migration Plan

### Phase 1: Scaffolding (Non-Breaking)

**Goal:** Add the new route structure alongside the old one. Both work simultaneously.

1. Create `ProjectView` layout component with tab bar
2. Create wrapper components for each tab that delegate to existing pages:
   - `ProjectSession` → renders `LeadDashboard` center panel
   - `ProjectTasks` → renders `TaskQueuePanel`
   - `ProjectAgents` → renders `FleetOverview` filtered by projectId
   - `ProjectGroups` → renders `GroupChat`
   - `ProjectAnalytics` → renders `AnalyticsPage` with projectId
   - `ProjectOrgChart` → renders `OrgChart`
   - `ProjectKnowledge` → renders `KnowledgePanel`
3. Create `ProjectOverview` as a new composition of existing widgets
4. Create `ProjectDesign` as new (artifact browser)
5. Add `/projects/:id/*` routes — old routes still work
6. Create `navigationStore`

**Existing pages continue to work at their old URLs.** Zero user disruption.

### Phase 2: Sidebar Restructure

**Goal:** Replace the 17-item sidebar with the 3-item + projects model.

1. Rewrite `Sidebar.tsx` — Home, project list, Team, Settings
2. Add project quick-access list (5 recent projects with status dots)
3. Add "+ New Project" action
4. Old sidebar nav items become redirects to project-scoped URLs
5. Update `selectedLeadId` → `currentProjectId` in navigation

### Phase 3: Home Page

**Goal:** Replace LeadDashboard at `/` with the project-centric Home.

1. Create `Home.tsx` — project grid, cross-project stats, decision feed
2. Add first-run experience (provider setup wizard, create project CTA)
3. Empty state handling for zero projects

### Phase 4: Consolidation

**Goal:** Remove the old flat routes and merge duplicate pages.

1. Remove old route paths (`/agents`, `/overview`, `/mission-control`, `/timeline`, `/canvas`, `/org`, `/groups`, `/knowledge`, `/analytics`)
2. Add redirects from old paths → new project-scoped paths (using last active project)
3. Merge `LeadDashboard` (4181 LOC) into smaller tab components
4. Merge `OverviewPage` (1683 LOC) into `ProjectOverview`
5. Merge `MissionControlPage` into `ProjectOverview`
6. Merge `AgentDashboard` / `FleetOverview` (1284 LOC) into `ProjectAgents`
7. Delete orphaned components

### Phase 5: Polish

1. Tab state persistence (remember last tab per project)
2. Keyboard shortcuts (Cmd+1-9 for tabs, Cmd+P for project switcher)
3. Breadcrumb trail (Home > acme-app > Tasks)
4. Transition animations between projects
5. Mobile layout (tabs → bottom sheet selector)

### Estimated Component Changes

| Component | Current LOC | Action | Notes |
|-----------|-------------|--------|-------|
| Sidebar.tsx | 136 | **Rewrite** | 3 items + project list |
| App.tsx | ~200 | **Rewrite routes** | Nested route structure |
| LeadDashboard | 4,181 | **Split** into Session + Overview tabs |
| OverviewPage | 1,683 | **Merge** into ProjectOverview |
| MissionControlPage | ~800 | **Merge** into ProjectOverview |
| FleetOverview | 1,284 | **Merge** into ProjectAgents |
| TaskQueuePanel | ~600 | **Wrap** in ProjectTasks |
| GroupChat | ~500 | **Wrap** in ProjectGroups |
| CanvasPage | ~400 | **Merge** into ProjectTasks (DAG view toggle) |
| OrgChart | ~400 | **Wrap** in ProjectOrgChart |
| KnowledgePanel | ~600 | **Wrap** in ProjectKnowledge |
| AnalyticsPage | ~500 | **Wrap** in ProjectAnalytics |
| TimelinePage | ~400 | **Merge** into ProjectOverview activity feed |
| **NEW: ProjectView** | ~150 | Layout + tab bar |
| **NEW: ProjectOverview** | ~400 | Composition of existing widgets |
| **NEW: ProjectDesign** | ~300 | File browser + markdown preview |
| **NEW: Home** | ~400 | Project grid + stats + first-run |
| **NEW: navigationStore** | ~60 | Project navigation state |

---

## Open Questions

1. **Canvas as a tab or integrated into Tasks?** Canvas currently shows the DAG visually. It could be a toggle within the Tasks tab ("List view" vs "DAG view") rather than a separate tab. This would reduce the tab count from 9 to 8.

2. **Timeline treatment?** The Timeline page shows a chronological agent activity view. It could be: (a) a view mode within the Overview tab, (b) part of the Session tab, or (c) dropped in favor of the activity feed in Overview. Leaning toward (a).

3. **Mission Control?** Currently a status dashboard. Its functionality fully overlaps with Overview + Agents. Recommend merging into ProjectOverview and not giving it a separate tab.

4. **Redirect strategy for old bookmarks?** When a user visits `/agents`, should we: (a) redirect to their last active project's agents tab, (b) redirect to Home with a toast "Navigation has moved", or (c) show a "moved" interstitial? Recommend (a) for URLs with project context, (b) for global URLs.

5. **Deep linking into project tabs?** The URL scheme `/projects/:id/tasks` is already deep-linkable. Should we also support query params for specific items? e.g., `/projects/:id/tasks?task=task-123` to open a specific task. Recommend yes — free with React Router's useSearchParams.
