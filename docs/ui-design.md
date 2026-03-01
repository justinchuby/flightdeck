# UI Design

Layout patterns and interaction modes for the AI Crew frontend (React + Vite + Tailwind).

## Lead Dashboard Layout

The lead dashboard is the primary workspace when managing a team of agents. It's split into a **main chat panel** and a **right sidebar**.

### Sidebar Structure

The sidebar has two zones:

1. **Decisions panel** (always visible, pinned at top) — Shows pending decisions requiring user confirmation. Each decision card has the title, rationale, and Accept/Reject buttons with an optional reason text field. **Optimistic UI** — buttons hide immediately on click before server response for responsive feel.

2. **Tabbed panel** (bottom section) — Four tabs displayed as reorderable drag-and-drop tabs:
   - **Team** — Compact team cards showing each agent's status and latest activity
   - **Comms** — Inter-agent message bus (direct messages + group messages in unified feed)
   - **Groups** — Chat group list and group message history, with **unread badges** showing per-group unread counts
   - **DAG** — Task dependency graph visualization

   Tab order is persisted to `localStorage` so the user's preferred arrangement survives page reloads. Tabs are reordered via drag-and-drop on the tab bar.

### Chat Panel (Main Area)

The central panel serves dual purpose:

- **User ↔ Lead conversation** — Messages between the human user and the project lead agent
- **Interleaved activity** — Agent activity events (spawns, task completions, decisions, errors) appear inline in the chat flow, distinguished by styling. This replaces the old separate Activity tab — activity is now contextual within the conversation timeline.
- **User-message highlighting** — Messages from the human user are rendered with a **blue tint** (`bg-blue-600 text-white`) to visually distinguish them from agent messages (`bg-gray-800`). The "Human User" label appears in `text-blue-400`.

### Three-Tier Message Hierarchy

The Comms panel classifies messages into three priority tiers with visual treatment and filter toggles:

| Tier | Style | Triggers |
|------|-------|----------|
| **Critical** 🔴 | Red accent, animated pulse dot | Build/test/compile failures, crashes, blocked tasks, P0/URGENT, timeouts, OOM, SIGTERM, segfault, decision needed |
| **Notable** 🔵 | Blue accent | Task completed, build passes, merged, shipped, review done, progress updates, delegated, new features, fixes |
| **Routine** ⚪ | Dimmed/collapsed | Secretary messages, short notifications (<200 chars), routine status changes |

**Rules:**
- Messages addressed to the lead are automatically bumped to ≥Notable
- Content >200 characters defaults to Notable (unless matched as Critical)
- Filter toggles: **All** / **Important** (Critical + Notable) / **Critical Only**

### Catch-Up Summary Banner

A floating banner that appears when the user returns after a period of inactivity:

1. **Trigger** — 60+ seconds of no interaction (clicks, keypresses)
2. **Snapshot** — When the user is active, the system snapshots current counts (tasks, messages, decisions, reports)
3. **Comparison** — On inactivity threshold, compares current state to snapshot
4. **Shows if** — ≥5 new items accumulated OR pending decisions exist
5. **Content** — "While you were away: X tasks completed, Y decisions pending (Zm old), N new messages, M reports"
6. **Dismiss** — Auto-dismisses on scroll or user interaction; resets on project switch
7. **Accessibility** — `role="status"`, `aria-live="polite"`, keyboard dismissible (Escape/Enter)

#### Thinking/Reasoning Text

When an agent emits `agent_thought_chunk` ACP events (thinking/reasoning text), these are displayed as **collapsible reasoning blocks** in both agent chats and the main lead chat:

- **Collapsed by default** — Shows a 💡 icon with a preview of the first ~80 characters
- **Click to expand** — Reveals the full reasoning text
- **Paragraph breaks** — A `pendingNewline` flag in the store ensures proper paragraph separation after reasoning blocks, preventing content from being misidentified as user-directed
- **Empty text guard** — `CollapsibleReasoningBlock` returns `null` for empty/whitespace-only reasoning to avoid rendering empty blocks
- **Consistent across views** — Same collapsed/expandable pattern in both agent detail chats and the main lead dashboard chat

## Compact Team Cards

Each agent on the team is represented by a **single-row compact card** in the Team tab:

- **Left**: Role icon + agent name/role + model badge
- **Center**: Current task summary (truncated) or "idle" status
- **Right**: Status indicator (running/idle/exited) + latest activity shown inline

Key design choices:
- **Single row** — No expanded card view. All essential info is visible at a glance without clicking.
- **Activity merged in** — The latest activity for each agent (e.g., "Acquired lock on src/auth.ts") appears directly on the card, eliminating the need for a separate activity panel.
- **Activity tab removed** — Activity is no longer a separate tab. It's split between team cards (per-agent latest) and the chat panel (interleaved timeline).

## Agents Page

The Agents page (`/agents`) provides a system-wide view of all agents across all leads.

### List View

A single **table/list layout** (the card grid view was removed for information density):
- Each row shows: agent name, role, model selector, status, current task, plan progress
- **Model selector**: Inline `<select>` in the table row to change an agent's model without navigating away
- **Plan progress**: A compact progress indicator showing completed/total plan steps (e.g., "3/7")
- **Hierarchy**: Parent-child relationships shown with tree connectors (vertical + horizontal lines) for indented child agents under their parent

### Group by Project

Agents are grouped under their lead's project name:
- Each group is a **collapsible section** with the project name as header
- Agents without a lead appear in an "Unassigned" group
- Collapse state persists in `localStorage`

This grouping makes it easy to see which agents belong to which project when multiple leads are running simultaneously.

## Project Rename

Projects (lead agent instances) can be renamed:
- **Double-click** the project name in the sidebar to enter inline edit mode
- **Pencil icon** appears on hover as an alternative affordance
- Press Enter to save, Escape to cancel
- The rename updates the sidebar, agents page group headers, and any other references

## Chat Input Modes

The chat input area follows specific keyboard conventions optimized for the queue-based communication model:

| Input | Action |
|-------|--------|
| **Enter** | Queue the message — adds it to the agent's message queue for delivery on next turn |
| **Ctrl+Enter** | Insert a newline in the input field (for multi-line messages) |
| **Interrupt button** | Explicitly interrupt the agent's current turn (red button in the toolbar) |

Key design rationale:
- **Enter = queue** (not send immediately) because agents process messages in turns. Queuing is the normal flow.
- **Ctrl+Enter = newline** (not interrupt) because interrupts are destructive and should require deliberate action, not an accidental key combo.
- **Interrupt via button only** — Forces the user to make a conscious choice to interrupt, preventing accidental disruption of agent work.

## Communication Flow Visualization

In the org chart / team hierarchy view:
- **Message items are clickable** — clicking an inter-agent message in the Comms tab highlights the sender and receiver in the org chart
- **Expandable message items** — Messages can be expanded to show the full content, with sender role, timestamp, and delivery status
- Connection lines in the org chart animate briefly when a message flows between two agents
- **Group messages in comms feed** — Group chat messages appear alongside 1:1 messages with a distinct visual treatment (group icon + group name)

## Timeline Visualization

The Timeline view (`/timeline`) provides a swim-lane visualization of agent activity over time, built with [visx](https://airbnb.io/visx/).

### Layout

- **Swim lanes** — One horizontal lane per agent, labeled with role icon and agent name
- **Time axis** — Horizontal axis shows elapsed time from session start
- **Status segments** — Colored bars show agent status over time:
  - 🟢 Running (active, producing output)
  - 🟡 Creating (agent is being spawned)
  - ⚪ Idle (no output, shown with **hatch pattern** to distinguish from "not started")
  - 🔵 Completed
  - 🔴 Failed/Terminated
- **Communication links** — Lines drawn between swim lanes when agents message each other, with directional arrows

### Interactive Features

| Feature | Control | Description |
|---------|---------|-------------|
| **Brush time selector** | Click-drag on mini-timeline | Select a time range to zoom into. The mini-timeline at the bottom shows the full session; the main view shows the selected range. Brush area is aligned with the chart via `leftOffset` to account for the label column width. |
| **Keyboard navigation** | ←/→ arrows | Pan the view left/right through time |
| **Zoom** | +/- keys | Zoom in/out on the time axis. Uses a `liveModeRef` to prevent race conditions between zoom gestures and SSE data updates. |
| **Filtering** | Dropdown menus | Filter by agent role, communication type (direct/broadcast/group), or agent status |
| **Live mode** | Toggle button | Auto-scrolls to follow the latest activity as it happens |
| **Hover tooltips** | Mouse over segment | Shows status badge, task label, time span (start → end), and duration. Uses `@visx/tooltip` with `TooltipWithBounds` for smart positioning. |
| **Project tabs** | Tab bar | Always-visible project tab bar for switching between active projects. Each tab preserves its own state (zoom, filters, expanded lanes). |
| **Clear Timeline** | Button | Resets cached timeline data for the current project, triggering a fresh SSE reconnection. |
| **Adaptive date display** | Automatic | Shows time-only (HH:MM:SS) for sessions <24 hours, date+time (MMM DD HH:MM) for multi-day sessions. Powered by the shared `formatTimestamp()` utility. |

### State Persistence

Timeline state is managed by a Zustand store (`timelineStore.ts`) that survives React Router unmounts:

- **Per-lead state** — Each project/lead has its own cached data, expanded agents, and view settings
- **LRU eviction** — Cached data is capped at 10 entries; oldest entries are evicted by insertion order when the limit is exceeded
- **Stable selectors** — `getExpandedAgents()` returns a shared `EMPTY_SET` constant for leads with no expanded agents, avoiding unnecessary re-renders

### Design Choices

- **visx over chart libraries** — Custom swim-lane rendering required more control than standard chart libraries provide. visx gives D3-like power with React composability.
- **Idle hatch patterns** — SVG `<pattern>` with diagonal lines (45° rotation, 6×6 pixel repeat) distinguishes "agent is idle" from "no data." Without this, users couldn't tell if an agent was waiting or simply hadn't been assigned work yet.
- **Brush selector** — Long sessions can span hours. The brush selector lets users zoom into a specific time window without losing context of the full session.

## Project Grouping UI

The Tasks view groups agents and tasks by project:

- **Collapsible project sections** — Each lead's project is a collapsible group with the project name as header
- **Task dedup detection** — When delegating, `findSimilarActiveDelegation()` checks for overlapping work using word-overlap similarity (>50% match). The lead receives a warning if a similar delegation is already active.
- **Project filtering** — Filter tasks by project to focus on one workstream

## Sidebar Unread Badges

The sidebar navigation shows unread indicators for group chats:

- **Blue dot/number badge** — Appears next to the "Groups" navigation item when unread group messages exist
- **Per-group tracking** — `lastSeen` timestamp per group stored in `localStorage`
- **Auto-reset** — Visiting a group resets its unread count
- **Overflow** — Shows `99+` when count exceeds 99

## Mission Control

The Mission Control page (`/mission-control`) provides a single-screen project overview — answering "how's the project?" in 3 seconds.

### 8 Configurable Panels

| Panel | Content |
|-------|---------|
| **HealthSummary** | DAG completion %, active/idle/completed agent counts, task status breakdown |
| **AgentFleet** | All team agents with status badges (running/idle/creating), context pressure bars, model badges |
| **TokenEconomics** | Per-agent token breakdown (input/output/total), context pressure bars (80% yellow, 90% red), % of total usage |
| **AlertsPanel** | Proactive alerts derived from store data: context overflow, stuck agents, pending decisions >3min, failures, idle+ready mismatch, blocked tasks. Zero height when no alerts. Color-coded by severity. |
| **ActivityFeed** | Merged activity + comms feed, last 30 events, live via WebSocket |
| **DagMinimap** | Stacked horizontal status bar (done=green, running=blue, pending=gray, failed=red), recent completions, running tasks |
| **CommHeatmap** | Communication frequency heatmap showing inter-agent message volume |
| **Performance** | Agent performance scorecards: throughput, first-pass rate, velocity, cost efficiency |

### Panel Customization

Panels are configurable via the Settings → Dashboard Customizer:
- **Toggle visibility** — Show/hide individual panels
- **Drag-and-drop reorder** — HTML5 DnD API to rearrange panel order
- **Layout persistence** — Panel config stored in `localStorage` via `useDashboardLayout` hook
- **New panel auto-merge** — When new panels are added in code, they automatically appear in existing users' layouts

### Auto-Discovery

Mission Control automatically discovers lead agents from the app store and registers them in the lead store. This means:
- No manual navigation to the Lead Dashboard is needed first
- On app startup, both active leads (from `/api/lead`) and persisted projects (from `/api/projects`) are loaded into the store
- Chat history for active leads is pre-fetched from `/api/agents/:id/messages`

### Data Sources

All panels read from existing Zustand stores — no new API endpoints needed. WebSocket events provide real-time updates.

## Token Economics

The Token Economics panel (also available as a tab in the Lead Dashboard) visualizes context window usage:

- **Per-agent breakdown** — Input tokens, output tokens, total, percentage of overall usage
- **Context pressure bars** — Visual bars showing context window utilization per agent
  - **80–90%** — Yellow warning ("consider wrapping up")
  - **90%+** — Red critical ("nearing limit, may lose context")
- **Totals** — Formatted as M/k (e.g., "1.2M tokens")
- **Sorted** by total tokens descending

## Queued Message Visibility

When the user sends a message while an agent is busy:

- Messages are marked `queued: true` and shown in a distinct section at the bottom of the chat
- **Blue bubbles** with a clock icon and "Queued" label distinguish them from delivered messages
- Right-aligned to match user-message styling
- Promoted to normal display when the agent responds (next agent message after queued user messages)

## Agent Chat Reply Highlighting

In the agent chat view (`AcpOutput.tsx`), agent responses to user messages receive subtle visual emphasis:

- When the previous timeline item is a user message, the agent's reply gets `bg-blue-500/[0.06]` background + `border-l-2 border-l-blue-400/30` left border
- Creates a visual connection between user input and agent response
- Applied to both rich content (images, code) and text messages

## Theme System

The theme system supports three modes: **Light**, **Dark**, and **Follow System**.

### Implementation

- **CSS custom properties** — 10 semantic tokens (`--th-bg`, `--th-text`, `--th-border`, etc.) defined on `:root, .light` and `.dark` selectors
- **Tailwind `th.*` namespace** — Semantic color tokens referencing CSS variables with `<alpha-value>` opacity support
- **Zustand `settingsStore`** — Theme state persists to `localStorage` via shared store (not component-local state)
- **Follow System mode** — Listens to `prefers-color-scheme` media query changes via `matchMedia` and auto-applies the corresponding theme
- **No FOWT** — An inline `<head>` script reads `localStorage` and sets the `dark` class before React renders, avoiding flash-of-wrong-theme
- **Accent color contrast** — `dark:` variants used for accent colors (e.g., `text-yellow-600 dark:text-yellow-300`) to ensure WCAG contrast in both themes

### Theme Toggle Locations

- **Settings panel** — Three radio buttons (Light / Dark / System)
- **Command palette** — Toggle Dark Mode action (Cmd+K → type "theme")

## Command Palette

A global command palette accessible via **Cmd+K** (or Ctrl+K on Windows/Linux).

- **12 navigation/action commands** — Navigate to any page, toggle theme, create project, search
- **Fuzzy matching** — Type to filter commands
- **Keyboard navigation** — Arrow keys to select, Enter to execute, Escape to dismiss
- **Extensible** — Commands registered as a simple array of `{label, action, shortcut?}` objects

## Settings

The Settings panel (`/settings`) provides configuration for:

| Setting | Description |
|---------|-------------|
| **Max Concurrent Agents** | Slider from 1–50 (server default is 50) |
| **Theme** | Light / Dark / Follow System with persistence |
| **Sound** | Toggle notification sounds |
| **Dashboard Panels** | Drag-and-drop reorder, toggle visibility of Mission Control panels |
| **Custom Roles** | Create roles with custom system prompts, colors, icons, and default models |

## Onboarding Wizard

An 8-step guided tour for new users, rendered as a modal overlay:

1. Welcome — Overview of AI Crew
2. Create Project — How to start a project
3. Lead Dashboard — Understanding the chat + sidebar layout
4. Team Management — Agent roles and models
5. Communication — Messaging, groups, broadcasts
6. Task DAG — Understanding dependency graphs
7. Mission Control — Monitoring dashboard overview
8. Settings — Customization options

## Search Dialog

A global search dialog that searches across:
- **Messages** — Agent and user messages
- **Tasks** — DAG tasks and delegations
- **Decisions** — Architectural decisions
- **Activity** — Activity log entries

Powered by the server-side `SearchEngine` which provides full-text search with relevance scoring.

## Zustand Store Patterns

Critical patterns for zustand v5 stores used throughout the frontend:

### Anti-Patterns (cause infinite re-renders)

| Pattern | Problem | Fix |
|---------|---------|-----|
| `useStore()` without selector | Subscribes to entire state; any `set()` triggers re-render | Use `useShallow` or specific field selectors |
| `useStore((s) => Object.keys(s.x))` | `Object.keys()` returns new array every call | Select `s.x` directly, derive keys outside |
| `useStore((s) => s.foo ?? [])` | `[]` is a new reference when `foo` is undefined | Use module-level constant: `const EMPTY: T[] = []` |
| `useStore((s) => s.items.filter(...))` | `.filter()` / `.map()` always returns new array | Use `useShallow` or memoize outside selector |

### Correct Patterns

```tsx
// Good: specific field selector
const projects = useLeadStore((s) => s.projects);
const projectIds = Object.keys(projects);

// Good: useShallow for multiple fields
const { messages, decisions } = useLeadStore(useShallow((s) => ({
  messages: s.projects[id]?.messages,
  decisions: s.projects[id]?.decisions,
})));

// Good: module-level empty constant
const EMPTY_ACTIVITIES: Activity[] = [];
const activities = useLeadStore((s) => s.projects[id]?.activities ?? EMPTY_ACTIVITIES);
```
