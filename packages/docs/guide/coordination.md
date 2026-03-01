# Coordination

AI Crew provides several mechanisms to keep multiple agents working together without conflicts.

## File Locking

Agents acquire locks on files before editing them. This prevents two agents from modifying the same file simultaneously.

- Locks are tracked in the `file_locks` SQLite table
- The **Scheduler** cleans up expired locks every minute
- Agents see locked files in the crew manifest via `crew_query_crew`
- The lead avoids delegating conflicting file edits

## Activity Ledger

Every significant agent action is logged:
- Task delegations and completions
- Messages sent and received
- File locks acquired and released
- Decisions recorded
- Errors and crashes

The ledger uses **batched writes** (flushes every 250ms or 64 entries) to reduce database contention with many concurrent agents.

## Decision Log

Architectural decisions are recorded with:
- **Title** and **rationale**
- **Alternatives** considered
- **Impact** level
- Optional **user confirmation** flag

Pending decisions appear in the sidebar's always-visible Decisions panel. Users can confirm or reject asynchronously.

## Context Refresh

When an agent's context window is compacted (old messages pruned by the LLM), the `ContextRefresher` detects the `agent:context_compacted` event and re-injects:

- Current team roster with roles and status
- Active delegations and their progress
- Coordination rules (file locking, messaging protocols)
- The agent's own role instructions

## Task DAG

The lead can structure work as a **directed acyclic graph** of tasks with dependencies. The DAG is visualized in the dashboard using ReactFlow.

Each task node tracks:
- Title, description, status
- Assigned agent
- Dependencies (must-complete-before relationships)
- File associations

## Group Chats

Agents can create focused discussion groups:

```
crew_create_group({ "name": "api-design", "members": ["a1b2c3", "d4e5f6"] })
```

Group messages are visible to all members and displayed in the Groups tab of the sidebar.

## Agent Memory

Agents can store and retrieve key-value pairs that persist across restarts. This enables agents to remember discoveries and share knowledge with the team.
