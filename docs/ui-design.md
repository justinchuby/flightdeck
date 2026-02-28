# UI Design

Layout patterns and interaction modes for the AI Crew frontend (React + Vite + Tailwind).

## Lead Dashboard Layout

The lead dashboard is the primary workspace when managing a team of agents. It's split into a **main chat panel** and a **right sidebar**.

### Sidebar Structure

The sidebar has two zones:

1. **Decisions panel** (always visible, pinned at top) — Shows pending decisions requiring user confirmation. Each decision card has the title, rationale, and Confirm/Reject buttons. This stays visible because decisions are time-sensitive and shouldn't be hidden behind a tab.

2. **Tabbed panel** (bottom section) — Four tabs displayed as reorderable drag-and-drop tabs:
   - **Team** — Compact team cards showing each agent's status and latest activity
   - **Comms** — Inter-agent message bus (direct messages between agents)
   - **Groups** — Chat group list and group message history
   - **DAG** — Task dependency graph visualization

   Tab order is persisted to `localStorage` so the user's preferred arrangement survives page reloads. Tabs are reordered via drag-and-drop on the tab bar.

### Chat Panel (Main Area)

The central panel serves dual purpose:

- **User ↔ Lead conversation** — Messages between the human user and the project lead agent
- **Interleaved activity** — Agent activity events (spawns, task completions, decisions, errors) appear inline in the chat flow, distinguished by styling. This replaces the old separate Activity tab — activity is now contextual within the conversation timeline.

#### Thinking/Reasoning Text

When an agent emits `agent_thought_chunk` ACP events (thinking/reasoning text), these are:
- Streamed and accumulated like regular text chunks
- Displayed in the chat panel as **italic text in lighter gray** (`text-gray-400 italic`)
- Visually distinct from the agent's actual output, making it easy to distinguish reasoning from responses
- Rendered inline in the agent's message bubble as it streams

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
