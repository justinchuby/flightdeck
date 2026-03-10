# Project-Centric UI Layout

> Design doc for restructuring Flightdeck's navigation from a flat sidebar to a project-centric hub model.

## Table of Contents

1. [Problem](#problem)
2. [Design Principles](#design-principles)
3. [Page Hierarchy](#page-hierarchy)
4. [Navigation Model](#navigation-model)
5. [Top-Level Pages](#top-level-pages)
   - [Home Dashboard](#home-dashboard)
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
7. [Interactive Kanban Board](#interactive-kanban-board)
   - [Per-Project Kanban](#per-project-kanban)
   - [Accumulated Kanban](#accumulated-kanban-dashboard)
   - [Interactions](#kanban-interactions)
   - [Data Model](#kanban-data-model)
8. [Data Requirements](#data-requirements)
9. [Routing Scheme](#routing-scheme)
10. [Store Refactoring](#store-refactoring)
11. [Relationship to Multi-Team Model](#relationship-to-multi-team-model)
12. [Migration Plan](#migration-plan)
13. [Open Questions](#open-questions)

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

**Purpose:** Command center — team status, running projects, and most critically: a priority queue of items needing human attention.

**Layout — Four Sections:**

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  TEAM STATUS                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ 7 Agents │  │ 5 Active │  │ 2 Idle   │  │ Health:  │       │
│  │ total    │  │ running  │  │ waiting  │  │ 🟢 Good  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│                                                                  │
│  ─────────────────────────────────────────────────────────────── │
│                                                                  │
│  🔴 NEEDS YOUR ATTENTION (4)                              [v All]│
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ❓ [acme-app] dev-903d asks: "Should I use bcrypt or    │   │
│  │    argon2 for password hashing?"                         │   │
│  │    ┌─────────────────────────────────┐                   │   │
│  │    │ Type your answer...      [Reply]│                   │   │
│  │    └─────────────────────────────────┘                   │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ ⚖️  [acme-app] Architect decision: "Refactor auth       │   │
│  │    module to use middleware pattern"                      │   │
│  │    [ ✅ Approve ]  [ ❌ Reject ]  [ 💬 Discuss ]        │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ 👁️ [billing] qa-8e4a: Review request for PR #142        │   │
│  │    "Payment validation edge cases"                       │   │
│  │    [ Open in Project → ]                                 │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ 🚫 [data-pipeline] Task "ETL schema migration" blocked  │   │
│  │    Waiting on: "Confirm production DB credentials"       │   │
│  │    [ Unblock → ]                                         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ─────────────────────────────────────────────────────────────── │
│                                                                  │
│  RUNNING PROJECTS                                + New Project   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 📁 acme-app          ● 3 agents   2/5 tasks done  5m   │   │
│  │    ████████░░░░░░░░ 40%  Frontend refactor              │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ 📁 data-pipeline     ● 2 agents   1/3 tasks done  12m  │   │
│  │    █████░░░░░░░░░░░ 33%  ETL optimization               │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ 📁 billing-service   ○ idle       4/4 tasks done  2h   │   │
│  │    ████████████████ 100% API redesign — completed       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ─────────────────────────────────────────────────────────────── │
│                                                                  │
│  RECENT ACTIVITY                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ 10:42  [acme-app]  dev-1 completed "Fix login"          │   │
│  │ 10:38  [acme-app]  architect generated auth.md           │   │
│  │ 10:35  [billing]   qa closed PR review ✅                │   │
│  │ 10:30  [data]      dev-2 started "ETL schema migration"  │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

#### "Needs Your Attention" Priority Queue

This is THE key feature of the dashboard. When a user opens Flightdeck, they immediately see what agents need from them. Items are sorted by urgency:

**Priority ordering (highest first):**
1. **Agent questions** — agents waiting for a human answer (blocks their work)
2. **Pending decisions** — approval/rejection needed for an agent's proposed action
3. **Review requests** — code review or design review waiting for feedback
4. **Blocked tasks** — DAG tasks stuck on external dependencies (credentials, access, etc.)
5. **Stale agents** — agents idle for >10 minutes with no task (may need direction)

**Item types and actions:**

| Type | Icon | Inline Action | Source |
|------|------|---------------|--------|
| Agent question | ❓ | Inline reply text field → sends to agent | `agent:permission_request` with type=question |
| Pending decision | ⚖️ | Approve / Reject / Discuss buttons | `appStore.pendingDecisions` |
| Review request | 👁️ | Link to project context | Custom agent event |
| Blocked task | 🚫 | Unblock action (navigates to task) | `dagTasks` with `dagStatus='blocked'` |
| Stale agent | 💤 | Assign task / Terminate buttons | Agent idle timeout detection |

**Data sources:**
- `appStore.pendingDecisions` — decisions across all projects
- WebSocket `agent:permission_request` — agent questions
- `GET /api/dag/tasks?status=blocked` — blocked tasks across projects
- Agent status tracking — idle duration from `appStore.agents`

**Key behavior:**
- Items auto-remove when resolved (decision approved, question answered, task unblocked)
- Badge count shown on Home sidebar icon
- Sound/notification option for new attention items
- Items are actionable inline — the user can approve a decision or answer a question without navigating away from the dashboard

#### Team Status Section

Shows aggregate health across all agents and projects:
- **Agent count** — total, active (running), idle (waiting), by role distribution
- **Health indicator** — green/amber/red from `AgentServerHealth` state machine
- **Provider status** — which providers are connected (from `ProviderManager.getAllProviderStatuses()`)
- **Cost summary** — total tokens/cost today (from `taskCostRecords`)

#### Running Projects Section

Project cards with at-a-glance progress:
- **Progress bar** — computed from DAG task completion ratio
- **Active agent count** with green dot
- **Most recent activity** — what happened last, when
- **Click** → navigates to that project's last-visited tab

#### Recent Activity Section

Cross-project timeline of key events:
- Task completions, agent spawns/exits, decisions made, files generated
- Each entry tagged with project name
- Click any entry → navigates to that project's relevant tab

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

**When providers not configured:** `SetupWizard` (already implemented, bcf134d) shows before the dashboard.

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

**What it shows:** Task DAG, task statuses, agent assignments — with a full interactive Kanban board as the primary task management interface.

```
┌──────────────────────────────────────────────────────────────┐
│  Tasks                    View: [ Kanban ] [ DAG ] [ List ]  │
│                                                [+ Add Task]  │
│                                                              │
│  (Kanban view — default, see Interactive Kanban Board below) │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Pending │ Ready  │ In Prog │ Review │ Done           │   │
│  │─────────┼────────┼─────────┼────────┼─────────────── │   │
│  │         │        │ ┌─────┐ │        │ ┌─────┐        │   │
│  │         │        │ │Auth │ │        │ │Desig│        │   │
│  │         │        │ │dev-1│ │        │ │arch │        │   │
│  │         │ ┌─────┐│ └─────┘ │        │ └─────┘        │   │
│  │ ┌─────┐│ │Test ││ ┌─────┐ │        │ ┌─────┐        │   │
│  │ │Test ││ │API  ││ │API  │ │        │ │Desig│        │   │
│  │ │Auth ││ │ qa  ││ │dev-2│ │        │ │arch │        │   │
│  │ └─────┘│ └─────┘│ └─────┘ │        │ └─────┘        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  (DAG view — same as before)                                │
│  (List view — same as before)                               │
└──────────────────────────────────────────────────────────────┘
```

**Data sources:**
- `leadStore.projects[projectId].dagStatus` — DAG state
- `GET /api/dag/tasks?projectId=X` — full task list with dependencies
- WebSocket `dag:updated` — real-time task state changes
- `POST /api/dag/tasks` — create new task
- `PATCH /api/dag/tasks/:id` — update task (status, assignment, priority)

**Existing code reuse:** `TaskQueuePanel` + DAG visualization from `CanvasPage`. The Canvas view becomes the "DAG" toggle within this tab. Kanban is a new component (~500 LOC, see below).

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

## Interactive Kanban Board

The Kanban board is the primary way users direct and manage work. It appears in two places: per-project (Project View → Tasks tab) and accumulated (Home Dashboard).

### Per-Project Kanban

Shown as the default view in the Tasks tab within any Project View.

**Columns map to DAG task states:**

| Column | DAG Status | Description |
|--------|-----------|-------------|
| **Pending** | `pending` | Task declared but dependencies not met |
| **Ready** | `ready` | All dependencies satisfied, waiting for assignment |
| **In Progress** | `in_progress` | Agent actively working |
| **In Review** | `in_review` (new) | Work complete, awaiting review/approval |
| **Done** | `done` | Task completed and verified |

**Task Card Layout:**
```
┌─────────────────────────────────┐
│ ≡ (drag handle)     🟡 Priority │
│                                 │
│ Fix authentication module       │
│ #task-a1b2c3                    │
│                                 │
│ 👤 dev-903d (developer)         │
│ ⏱️ 23m active                   │
│                                 │
│ Dependencies: [Design Auth ✅]  │
│ Blocked by:   —                 │
│                                 │
│ 💬 2 comments   📎 1 file       │
│                                 │
│ [ 💬 Feedback ]                 │
└─────────────────────────────────┘
```

**Card information:**
- Task title and ID
- Priority indicator (color-coded: 🔴 critical, 🟡 high, 🔵 normal, ⚪ low)
- Assigned agent with role badge (uses `StatusBadge` component)
- Active time (wall clock since status changed to `in_progress`)
- Dependency links (clickable → scrolls to/highlights that card)
- Comment count and file attachment count
- Inline feedback button

### Accumulated Kanban (Dashboard)

Shown on the Home Dashboard, aggregating tasks across ALL projects:

```
┌──────────────────────────────────────────────────────────────────┐
│  ALL TASKS                    Group by: [ Project ▾ ] [ Flat ]  │
│                                                                  │
│  Pending (3)  │  Ready (2)  │  In Prog (5) │  Review (1) │ Done │
│  ─────────────┼─────────────┼──────────────┼─────────────┼───── │
│  ┌──────────┐ │ ┌──────────┐│ ┌──────────┐ │ ┌──────────┐│     │
│  │📁 acme   │ │ │📁 acme   ││ │📁 acme   │ │ │📁 billing││     │
│  │Test Auth │ │ │Test API  ││ │Impl Auth │ │ │PR #142   ││     │
│  │qa        │ │ │qa        ││ │dev-1     │ │ │qa        ││     │
│  └──────────┘ │ └──────────┘│ └──────────┘ │ └──────────┘│     │
│  ┌──────────┐ │             │ ┌──────────┐ │             │     │
│  │📁 data   │ │             │ │📁 acme   │ │             │     │
│  │Schema mig│ │             │ │Impl API  │ │             │     │
│  │blocked   │ │             │ │dev-2     │ │             │     │
│  └──────────┘ │             │ └──────────┘ │             │     │
└──────────────────────────────────────────────────────────────────┘
```

**Grouping modes:**
- **By project** (default) — cards have a project tag badge, visually grouped
- **Flat** — all tasks in a single stream, sorted by priority then time
- **By agent** — group cards by assigned agent (useful for workload balancing)

### Kanban Interactions

The Kanban is fully interactive — not just a view, but the primary way users direct work:

#### 1. Add Tasks

Click the `[+ Add Task]` button (top-right of Kanban) to create a new task directly:

```
┌───────────────────────────────────────┐
│  New Task                        [×]  │
│                                       │
│  Title: [________________________]    │
│  Description: [__________________]    │
│  Priority: [ Normal ▾ ]              │
│  Assign to: [ Auto (lead decides) ▾] │
│  Depends on: [ Select tasks... ]     │
│                                       │
│  [ Cancel ]  [ Create Task ]          │
└───────────────────────────────────────┘
```

- Creates a task via `POST /api/dag/tasks` which inserts into the DAG
- Default assignment is "Auto" — the lead agent picks the best agent
- User can explicitly assign to a specific active agent
- Dependencies selected from existing tasks (autocomplete dropdown)
- New task appears in the **Pending** or **Ready** column based on dependency state

#### 2. Reorder Priority

- **Drag cards vertically** within a column to change priority order
- Position within column = relative priority (top = highest)
- Writes `priority` field to DAG task record
- Lead agent is notified of priority changes via `lead:task_priority_changed` message
- Visual feedback: drop shadow during drag, insertion line indicator

#### 3. Send Feedback Per Task

Click the `[ 💬 Feedback ]` button on any task card:

```
┌──────────────────────────────────────────┐
│  Feedback on: Fix authentication module  │
│  Assigned to: dev-903d                   │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ Please use argon2 instead of     │    │
│  │ bcrypt for password hashing.     │    │
│  └──────────────────────────────────┘    │
│                                          │
│  Deliver to: ○ Agent  ● Lead            │
│  [ Cancel ]  [ Send Feedback ]           │
└──────────────────────────────────────────┘
```

- Feedback is delivered as a `user:task_feedback` message to the lead agent
- Lead decides whether to relay to the assigned agent or act on it themselves
- Feedback history shown in a collapsible section on the task card
- "Deliver to: Agent" option sends directly to the assigned agent (bypasses lead)

#### 4. Reassign Tasks

- **Drag a card horizontally** to a different column to override status
- **Drag to a different "agent swim-lane"** to reassign (when agent grouping is active)
- Alternatively, click the agent badge on a card → dropdown of available agents
- Reassignment triggers:
  - `PATCH /api/dag/tasks/:id` with new `assignedAgent`
  - Message to lead agent: `"User reassigned task X from agent-A to agent-B"`
  - Message to new agent: task context + instructions
  - Message to old agent: `"Task X has been reassigned"`

#### 5. Drag-and-Drop State Override

- Dragging a card from one column to another overrides the DAG status
- **Safeguards:**
  - Cannot drag to "Done" if task has failing checks (confirmation dialog)
  - Dragging from "In Progress" to "Pending" shows: "This will interrupt agent work. Continue?"
  - Dragging a task with unmet dependencies to "Ready" shows a warning but allows override
- Status override sends `PATCH /api/dag/tasks/:id` with `dagStatus` and `overriddenBy: 'user'`
- The lead agent is notified of all manual status overrides

### Kanban Data Model

**Mapping to existing `dag_tasks` table:**

| Kanban Concept | Database Field | Notes |
|---------------|---------------|-------|
| Column | `dagStatus` | Existing field, add `in_review` value |
| Card position | `priority` | New field: integer, lower = higher priority |
| Assignment | `assignedAgent` | Existing field |
| Dependencies | `dependsOn` | Existing JSON array field |
| Feedback | — | New: delivered as messages, not stored on task |
| Override flag | `overriddenBy` | New field: null or 'user' |

**New DAG status: `in_review`**

Add to existing `DagTaskStatus` enum: `'pending' | 'ready' | 'in_progress' | 'in_review' | 'done' | 'failed' | 'blocked'`

Transition rules:
- `in_progress` → `in_review`: Agent calls `COMPLETE_TASK` with `requestReview: true`
- `in_review` → `done`: User approves OR lead agent approves
- `in_review` → `in_progress`: Reviewer sends feedback requiring changes

**New fields on `dag_tasks`:**

```sql
ALTER TABLE dag_tasks ADD COLUMN priority INTEGER DEFAULT 100;
ALTER TABLE dag_tasks ADD COLUMN overridden_by TEXT;  -- null | 'user'
```

**API changes:**

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/dag/tasks` | Create task from Kanban |
| `PATCH` | `/api/dag/tasks/:id` | Update status, priority, assignment |
| `POST` | `/api/dag/tasks/:id/feedback` | Send feedback on task |
| `GET` | `/api/dag/tasks?projectId=X&view=kanban` | Tasks with priority ordering |

**WebSocket events:**

| Event | Payload | Trigger |
|-------|---------|---------|
| `dag:task_moved` | `{taskId, fromStatus, toStatus, movedBy}` | Column change |
| `dag:task_reordered` | `{taskId, newPriority, column}` | Priority reorder |
| `dag:task_reassigned` | `{taskId, fromAgent, toAgent}` | Agent change |
| `dag:task_feedback` | `{taskId, feedback, deliverTo}` | User feedback |

**Drag-and-drop implementation:**
- Use `@dnd-kit/core` (already a common React DnD library) or native HTML5 DnD
- `DndContext` wraps the Kanban board
- Each column is a `Droppable`, each card is a `Draggable`
- `onDragEnd` handler dispatches appropriate API calls
- Optimistic updates: card moves immediately, reverts on API error

### New API Endpoints

| Method | Path | Purpose | Source |
|--------|------|---------|--------|
| GET | `/api/projects/:id/summary` | Stats (agent count, task count, recent activity) | Aggregate from existing tables |
| GET | `/api/projects/:id/artifacts` | Design files generated by agents | `agentFileHistory` filtered by project + path patterns |
| GET | `/api/projects/:id/activity` | Recent activity feed | `activityLog` filtered by projectId |
| GET | `/api/dashboard/attention` | Priority queue of items needing user action | Aggregates decisions, agent questions, blocked tasks |
| GET | `/api/dashboard/team-status` | Aggregate team health/counts | `agentRoster` + `AgentServerHealth` state |
| POST | `/api/dag/tasks` | Create new task from Kanban | Insert into `dag_tasks` with DAG wiring |
| PATCH | `/api/dag/tasks/:id` | Update task status, priority, assignment | Update `dag_tasks` row |
| POST | `/api/dag/tasks/:id/feedback` | Send feedback to lead/agent about a task | Delivers as agent message |

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

### Schema Additions

The project-centric UI is primarily a **view reorganization**, not a data model change. Most data already exists.

**Existing tables with `projectId`** (no changes needed):
- `dagTasks.projectId`
- `activityLog.projectId`
- `fileLocks.projectId`
- `knowledge.projectId`
- `agentRoster.projectId`
- `chatGroups.projectId` (via `leadId`)
- `decisions.projectId`

**New columns on `dag_tasks`** (for Kanban):
```sql
ALTER TABLE dag_tasks ADD COLUMN priority INTEGER DEFAULT 100;
ALTER TABLE dag_tasks ADD COLUMN overridden_by TEXT;  -- null | 'user'
```

**New DAG status value**: Add `'in_review'` to `DagTaskStatus` enum.

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

1. Create `ProjectView` layout component with tab bar (uses unified `Tabs` component)
2. Create wrapper components for each tab that delegate to existing pages:
   - `ProjectSession` → renders `LeadDashboard` center panel
   - `ProjectTasks` → renders Kanban (default) + DAG + List toggles
   - `ProjectAgents` → renders `FleetOverview` filtered by projectId
   - `ProjectGroups` → renders `GroupChat`
   - `ProjectAnalytics` → renders `AnalyticsPage` with projectId
   - `ProjectOrgChart` → renders `OrgChart`
   - `ProjectKnowledge` → renders `KnowledgePanel`
3. Create `ProjectOverview` as a new composition of existing widgets
4. Create `ProjectDesign` as new (artifact browser)
5. Create `KanbanBoard` component (~500 LOC):
   - Drag-and-drop columns (Pending/Ready/In Progress/In Review/Done)
   - Task card component with agent badge, priority, feedback button
   - Add task modal
   - Install `@dnd-kit/core` + `@dnd-kit/sortable`
6. Create `HomeDashboard` component (~400 LOC):
   - Team Status section (agent counts, health indicator)
   - "Needs Your Attention" priority queue with inline actions
   - Running Projects cards with progress bars
   - Recent Activity timeline
7. Add `/projects/:id/*` routes — old routes still work
8. Create `navigationStore`
9. Run migration: add `priority` and `overridden_by` columns to `dag_tasks`
10. Add `in_review` to `DagTaskStatus` enum

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
| TaskQueuePanel | ~600 | **Wrap** in ProjectTasks (list view toggle) |
| GroupChat | ~500 | **Wrap** in ProjectGroups |
| CanvasPage | ~400 | **Merge** into ProjectTasks (DAG view toggle) |
| OrgChart | ~400 | **Wrap** in ProjectOrgChart |
| KnowledgePanel | ~600 | **Wrap** in ProjectKnowledge |
| AnalyticsPage | ~500 | **Wrap** in ProjectAnalytics |
| TimelinePage | ~400 | **Merge** into ProjectOverview activity feed |
| **NEW: ProjectView** | ~150 | Layout + tab bar |
| **NEW: ProjectOverview** | ~400 | Composition of existing widgets |
| **NEW: ProjectDesign** | ~300 | File browser + markdown preview |
| **NEW: HomeDashboard** | ~600 | Team status + attention queue + project cards + activity |
| **NEW: KanbanBoard** | ~500 | Drag-and-drop columns, task cards, interactions |
| **NEW: TaskCard** | ~150 | Card component with priority, agent badge, feedback |
| **NEW: AttentionQueue** | ~300 | Priority queue with inline actions |
| **NEW: navigationStore** | ~80 | Project navigation state + attention badge count |

---

## Open Questions

1. **Canvas as a tab or integrated into Tasks?** Canvas currently shows the DAG visually. It could be a toggle within the Tasks tab ("List view" vs "DAG view" vs "Kanban view") rather than a separate tab. With Kanban as default, DAG becomes a secondary toggle. Recommend: 3-way toggle in Tasks tab, drop Canvas as separate page.

2. **Timeline treatment?** The Timeline page shows a chronological agent activity view. It could be: (a) a view mode within the Overview tab, (b) part of the Session tab, or (c) dropped in favor of the activity feed in Overview. Leaning toward (a).

3. **Mission Control?** Currently a status dashboard. Its functionality fully overlaps with Overview + Agents. Recommend merging into ProjectOverview and not giving it a separate tab.

4. **Redirect strategy for old bookmarks?** When a user visits `/agents`, should we: (a) redirect to their last active project's agents tab, (b) redirect to Home with a toast "Navigation has moved", or (c) show a "moved" interstitial? Recommend (a) for URLs with project context, (b) for global URLs.

5. **Deep linking into project tabs?** The URL scheme `/projects/:id/tasks` is already deep-linkable. Should we also support query params for specific items? e.g., `/projects/:id/tasks?task=task-123` to open a specific task. Recommend yes — free with React Router's useSearchParams.

6. **Kanban DnD library?** Options: `@dnd-kit/core` (modern, accessible, tree-shakeable), `react-beautiful-dnd` (mature but archived), or native HTML5 DnD (no dependency but less polished). Recommend `@dnd-kit/core` — smaller bundle, better accessibility, active maintenance.

7. **Kanban: swim-lanes by agent?** Should the Kanban support an alternative layout where rows are agents and columns are states? This gives a workload heatmap view. Recommend: optional toggle, not default.

8. **Dashboard polling vs WebSocket?** The "Needs Your Attention" queue needs near-real-time updates. Options: (a) WebSocket push for all attention items (adds new event types), (b) 5s polling of `/api/dashboard/attention`, (c) hybrid — WebSocket for new items, REST for initial load. Recommend (c) — matches existing pattern where WebSocket pushes events and REST provides initial state.

9. **Attention item persistence?** Should dismissed attention items be persisted server-side (prevents re-showing after refresh) or client-side (localStorage)? Recommend: server-side for resolved items (they're naturally removed), client-side for user-dismissed items that aren't truly resolved.
