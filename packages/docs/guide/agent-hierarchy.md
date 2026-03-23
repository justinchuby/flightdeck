# Agent Hierarchy Architecture

> **How projects, sessions, leads, and agents relate to each other in Flightdeck.**

## Overview

Flightdeck organizes work into a four-level hierarchy:

```mermaid
graph TD
    P[🗂️ Project<br/><i>projectId</i>]
    S1[📋 Session 1<br/><i>leadId = Lead's agentId</i>]
    S2[📋 Session 2<br/><i>leadId = Lead's agentId</i>]
    L1[👑 Lead Agent<br/><i>agentId, role=lead</i><br/><i>parentId=undefined</i>]
    A1[🔧 Developer<br/><i>agentId, parentId→L1</i>]
    A2[🏛️ Architect<br/><i>agentId, parentId→L1</i>]
    A3[🔍 Reviewer<br/><i>agentId, parentId→L1</i>]
    SL[👑 Sub-Lead<br/><i>agentId, role=lead</i><br/><i>parentId→L1, isSubLead=true</i>]
    SA1[🔧 Sub-Developer<br/><i>agentId, parentId→SL</i>]
    SA2[🎨 Sub-Designer<br/><i>agentId, parentId→SL</i>]

    P --> S1
    P --> S2
    S1 --> L1
    L1 --> A1
    L1 --> A2
    L1 --> A3
    L1 --> SL
    SL --> SA1
    SL --> SA2

    style P fill:#4a90d9,stroke:#2c5f8a,color:#fff
    style S1 fill:#6b5b95,stroke:#4a3d6e,color:#fff
    style S2 fill:#6b5b95,stroke:#4a3d6e,color:#fff
    style L1 fill:#d4a017,stroke:#a07d12,color:#fff
    style SL fill:#d4a017,stroke:#a07d12,color:#fff
    style A1 fill:#2ecc71,stroke:#1a9c54,color:#fff
    style A2 fill:#2ecc71,stroke:#1a9c54,color:#fff
    style A3 fill:#2ecc71,stroke:#1a9c54,color:#fff
    style SA1 fill:#27ae60,stroke:#1e8449,color:#fff
    style SA2 fill:#27ae60,stroke:#1e8449,color:#fff
```

Each level has a unique identifier and specific relationships to the levels above and below it.

## Concepts

### Project

A **project** represents a long-lived workspace (e.g., a GitHub repo, a product). Projects persist across sessions.

- **ID:** `projectId` — a slugified identifier derived from the project name (e.g., `flightdeck-3ef095`)
- **Storage:** `projects` table in SQLite, managed by `ProjectRegistry`
- **Relationship:** One project → many sessions

### Session

A **session** is a single run of an agent crew within a project. Each session has a lead agent that orchestrates the work.

- **ID:** The lead agent's `agentId` serves as the session identifier (called `leadId` throughout the codebase)
- **Important distinction:** This is the *Flightdeck session ID*, which is the lead agent's UUID. It is NOT the same as the *provider session ID* (the ID assigned by the AI provider like Claude or GPT)
- **Storage:** `project_sessions` table, keyed by `(projectId, leadId)`
- **Relationship:** One session → one lead + many agents

### Lead Agent

The **lead** is the root agent of a session. It orchestrates the crew, makes decisions, delegates tasks, and manages the session lifecycle.

- **Properties:** `role.id === 'lead'`, `parentId === undefined`, `hierarchyLevel === 0`
- **Capabilities:** Can create agents (via `CREATE_AGENT`), delegate tasks, manage the DAG
- **Session binding:** The lead's `agentId` IS the session ID

### Agent

An **agent** is a worker within a session, created by the lead. Agents have specific roles (developer, architect, reviewer, etc.) and execute delegated tasks.

- **Properties:** `parentId === leadId`, `projectId` inherited from lead
- **Capabilities:** Determined by role. Only leads can create agents by default (other roles can acquire the capability via `ACQUIRE_CAPABILITY`)

### Sub-Lead

A **sub-lead** is a lead agent created by another lead. It manages its own sub-crew for a delegated sub-project.

- **Properties:** `role.id === 'lead'`, `parentId === parentLeadId`, `hierarchyLevel === parentLevel + 1`
- **Detection:** `isSubLead = (role === 'lead') && (parentId !== undefined)`
- **Budget:** Shares the global concurrency budget with the root lead (not a separate budget)

### Sub-Agent

A **sub-agent** is an agent created by a sub-lead. Its `parentId` points to the sub-lead, NOT the root lead.

- **Properties:** `parentId === subLeadId`, `projectId` inherited from sub-lead (which inherited from root lead)
- **Team assignment:** `teamId` is set to the root lead's ID (via `getRootLeadId()` recursive walk)

## ID Relationships

```mermaid
graph LR
    subgraph "Project: flightdeck-3ef095"
        subgraph "Session: leadId = a1b2c3d4"
            L1["👑 Root Lead (L1)<br/>agentId: a1b2c3d4<br/>parentId: —<br/>projectId: flightdeck-3ef095<br/>teamId: a1b2c3d4 (self)<br/>hierarchyLevel: 0"]
            D1["🔧 Developer (D1)<br/>agentId: e5f6a7b8<br/>parentId: a1b2c3d4 → L1<br/>projectId: flightdeck-3ef095<br/>teamId: a1b2c3d4 → L1"]
            L2["👑 Sub-Lead (L2)<br/>agentId: c9d0e1f2<br/>parentId: a1b2c3d4 → L1<br/>projectId: flightdeck-3ef095<br/>teamId: a1b2c3d4 → L1<br/>hierarchyLevel: 1<br/>isSubLead: true"]
            S1["🎨 Sub-Agent (S1)<br/>agentId: a3b4c5d6<br/>parentId: c9d0e1f2 → L2 ⚠️<br/>projectId: flightdeck-3ef095<br/>teamId: a1b2c3d4 → L1"]

            L1 -->|parentId| D1
            L1 -->|parentId| L2
            L2 -->|parentId| S1
        end
    end

    style L1 fill:#d4a017,stroke:#a07d12,color:#fff
    style L2 fill:#d4a017,stroke:#a07d12,color:#fff
    style D1 fill:#2ecc71,stroke:#1a9c54,color:#fff
    style S1 fill:#27ae60,stroke:#1e8449,color:#fff
```

> ⚠️ Note that S1's `parentId` points to L2 (the sub-lead), **not** L1 (the root lead). This is the source of the shallow filtering bug — code checking `parentId === L1` will miss S1.

## How IDs Propagate

### projectId

Resolved at spawn time via a three-stage fallback:

1. **Explicit:** If `options.projectId` is provided, use it
2. **Inherited:** Walk the parent chain via `getProjectIdForAgent(parentId)` — recursive, no depth limit
3. **Generated:** Root agents with no projectId auto-generate one from the task name

```mermaid
flowchart TD
    Start([Agent Spawned]) --> Check1{options.projectId<br/>provided?}
    Check1 -->|Yes| Use1[Use explicit projectId]
    Check1 -->|No| Check2{Has parentId?}
    Check2 -->|Yes| Walk[Walk parent chain:<br/>getProjectIdForAgent‹parentId›]
    Walk --> Found{Parent has<br/>projectId?}
    Found -->|Yes| Use2[Inherit parent's projectId]
    Found -->|No| WalkUp[Continue walking up<br/>parent chain]
    WalkUp --> Found
    Check2 -->|No| Check3{Is root agent?}
    Check3 -->|Yes| Gen[Auto-generate projectId<br/>from task name]
    Check3 -->|No| None[projectId = undefined]

    Use1 --> Done([projectId Set ✅])
    Use2 --> Done
    Gen --> Done
    None --> Done

    style Start fill:#6b5b95,stroke:#4a3d6e,color:#fff
    style Done fill:#2ecc71,stroke:#1a9c54,color:#fff
    style Use1 fill:#3498db,stroke:#2471a3,color:#fff
    style Use2 fill:#3498db,stroke:#2471a3,color:#fff
    style Gen fill:#e67e22,stroke:#c0651b,color:#fff
    style None fill:#e74c3c,stroke:#c0392b,color:#fff
```

**Implementation:** `AgentManager.spawn()` at `packages/server/src/agents/AgentManager.ts:390-492`

### teamId (Crew Roster)

The `teamId` determines which crew an agent belongs to in the roster database. It is always the **root lead's ID**, resolved by walking the parent chain to the top.

**Implementation:** `AgentManager.getRootLeadId()` at `packages/server/src/agents/AgentManager.ts:1006-1011`

```typescript
private getRootLeadId(agentId: string, visited = new Set<string>()): string {
  if (visited.has(agentId)) return agentId; // cycle guard
  visited.add(agentId);
  const agent = this.agents.get(agentId);
  if (!agent || !agent.parentId) return agentId;
  return this.getRootLeadId(agent.parentId, visited);
}
```

### parentId

Set once at spawn time to the creating agent's ID. Never changes.

- Lead creates Developer → `developer.parentId = lead.id`
- Lead creates Sub-Lead → `subLead.parentId = lead.id`
- Sub-Lead creates Sub-Agent → `subAgent.parentId = subLead.id` (NOT lead.id)

## Provider Session ID vs Flightdeck Session ID

These are two different concepts:

| Concept | What It Is | Where It Lives |
|---------|-----------|---------------|
| **Flightdeck Session ID** | The root lead agent's UUID (`leadId`) | `project_sessions.lead_id`, URL params |
| **Provider Session ID** | The AI provider's conversation ID (e.g., Claude session) | `agent.sessionId`, set when adapter starts |

```mermaid
graph TB
    subgraph "Flightdeck Session: leadId = a1b2c3d4"
        L["👑 Lead (a1b2c3d4)<br/>Provider Session: ps-001"]
        D["🔧 Developer (e5f6a7b8)<br/>Provider Session: ps-002"]
        A["🏛️ Architect (f9a0b1c2)<br/>Provider Session: ps-003"]
        SL["👑 Sub-Lead (c9d0e1f2)<br/>Provider Session: ps-004"]
        SA["🔧 Sub-Dev (a3b4c5d6)<br/>Provider Session: ps-005"]
    end

    L --> D
    L --> A
    L --> SL
    SL --> SA

    FD["Flightdeck Session ID<br/><b>a1b2c3d4</b><br/>(= Lead's agentId)"]
    PS["Provider Session IDs<br/><b>ps-001 … ps-005</b><br/>(one per agent, from AI provider)"]

    FD -.->|"identifies the crew"| L
    PS -.->|"one per conversation"| D

    style FD fill:#6b5b95,stroke:#4a3d6e,color:#fff
    style PS fill:#e67e22,stroke:#c0651b,color:#fff
    style L fill:#d4a017,stroke:#a07d12,color:#fff
    style SL fill:#d4a017,stroke:#a07d12,color:#fff
    style D fill:#2ecc71,stroke:#1a9c54,color:#fff
    style A fill:#2ecc71,stroke:#1a9c54,color:#fff
    style SA fill:#27ae60,stroke:#1e8449,color:#fff
```

- The root lead's provider session ID may be reused as the Flightdeck session ID in some contexts
- Each agent has its own provider session ID, independent of other agents
- Sub-leads get their own provider session ID, independent of the root lead

## Key Implementation Files

| File | Role |
|------|------|
| `packages/server/src/agents/Agent.ts` | Agent class with parentId, projectId, hierarchyLevel |
| `packages/server/src/agents/AgentManager.ts` | spawn(), getProjectIdForAgent(), getRootLeadId() |
| `packages/server/src/agents/commands/AgentLifecycle.ts` | CREATE_AGENT command, sub-lead spawning |
| `packages/server/src/db/AgentRosterRepository.ts` | Crew roster persistence with teamId |
| `packages/server/src/routes/crew.ts` | Crew roster API endpoints |
| `packages/server/src/routes/lead.ts` | Lead/session API endpoints |
| `packages/shared/src/domain/agent.ts` | Shared AgentStatus, AgentPhase types |
| `packages/web/src/components/CrewRoster/` | Crew roster UI |
| `packages/web/src/components/OrgChart/` | Visual hierarchy display |

## Known Issue: Shallow parentId Filtering

> ⚠️ **Bug:** Many code paths filter agents using `parentId === leadId` (direct children only), which misses sub-agents under sub-leads. See [hierarchy-audit-findings.md](./hierarchy-audit-findings.md) for the full list of affected locations.

The crew roster API (`/crews/:crewId/agents`) correctly uses `teamId` to include ALL descendants. But most other code paths — including the LeadDashboard, WebSocket handlers, coordination views, and comms routing — only check one level deep.
