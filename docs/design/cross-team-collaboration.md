# Cross-Team Collaboration Design

> **Status:** Exploratory Design (not for implementation)
> **Author:** Architect (cc29bb0d)
> **Depends on:** [Agent Server Architecture](agent-server-architecture.md) — multi-team model
> **Context:** Teams are independent by default. This document explores how teams COULD collaborate on a shared project, from zero awareness to full integration.

## Collaboration Modes

Teams can operate at five levels of collaboration, each building on the previous:

```
┌───────────────────────────────────────────────────────────────────────┐
│  Level 0: Isolated (default)                                          │
│  Teams are completely independent. No awareness of each other.        │
│  ─────────────────────────────────────────────────────────────────── │
│  Level 1: Aware                                                       │
│  Teams can see each other's existence and high-level status.          │
│  ─────────────────────────────────────────────────────────────────── │
│  Level 2: Coordinated                                                 │
│  Secretary-to-secretary relay, shared file locks, coordination log.   │
│  ─────────────────────────────────────────────────────────────────── │
│  Level 3: Collaborative                                               │
│  Cross-team knowledge flow, shared review cycles, joint planning.     │
│  ─────────────────────────────────────────────────────────────────── │
│  Level 4: Integrated                                                  │
│  Shared agents, cross-team delegation, unified DAG.                   │
└───────────────────────────────────────────────────────────────────────┘
```

### Level 0: Isolated (Default)

Teams are fully independent. No awareness of each other.

```
Team A ─── Agent Server ─── Team B
  (no link between A and B)
```

**What each team sees:**
- Own agents, own DAG, own delegations, own activity log
- Project-scoped knowledge (writes are team-attributed via `teamId` column)
- File locks from ALL teams (the only cross-team visibility at this level — necessary to prevent filesystem conflicts)

**When to use:** Single developer, early project phase, teams working on non-overlapping areas.

**Implementation:** This is the current design. No additional work needed.

### Level 1: Aware

Teams can see each other's existence and high-level status but cannot interact.

```
Team A ─── Agent Server ─── Team B
  │                           │
  └─── shared status board ───┘
```

**What's added:**
- Team roster visible to project admins (team name, agent count, high-level status)
- "Other teams on this project" indicator in the UI
- No agent details (PIDs, tasks, session IDs are NOT shared — just "Team B has 4 agents, 3 active")

**New API:**
```typescript
interface ProjectTeamSummary {
  teamId: string;
  teamName: string;
  agentCount: number;
  activeCount: number;
  lastActivityAt: string;
  // Deliberately minimal — no agent details, no tasks, no PIDs
}

// New message type: request project-level team summaries
interface ListProjectTeamsMessage {
  type: 'list_project_teams';
  requestId: string;
  projectId: string;
  // Requires project_admin permission
}
```

**When to use:** Multiple developers on the same project, need basic awareness but no coordination.

**Implementation effort:** Low. Add one API endpoint, one UI card.

### Level 2: Coordinated

Active coordination through secretaries, without direct agent-to-agent interaction.

```
Team A                                    Team B
  Lead ──→ Secretary A ─────────────→ Secretary B ←── Lead
               │                           │
               └──── Coordination Log ─────┘
                    (project-scoped)
```

#### Secretary-to-Secretary Relay

Cross-team messaging goes through **secretaries**, NOT direct lead-to-lead communication. Secretaries are the diplomatic channel:

1. Team A's lead tells its secretary: "We're about to refactor the auth module"
2. Secretary A summarizes the intent and sends to the coordination log
3. Secretary B reads the log entry and evaluates relevance for Team B
4. If relevant, Secretary B distills it further and notifies Team B's lead

**Why secretaries, not leads?**
- **Noise reduction:** Leads are busy managing their own crew. Secretaries filter and summarize.
- **Context preservation:** Secretaries maintain a running summary of cross-team interactions.
- **Interrupt protection:** Messages are async (queued), not interrupt-driven.
- **Structured communication:** Secretaries enforce a standard format for cross-team messages.

```typescript
// Cross-team message format (written to coordination log)
interface CrossTeamMessage {
  id: string;
  fromTeamId: string;
  fromSecretaryId: string;
  timestamp: string;
  category: 'announcement' | 'conflict_alert' | 'question' | 'sync_point' | 'decision';
  summary: string;           // One-paragraph summary
  details?: string;          // Full context (if the other secretary wants to drill down)
  affectedFiles?: string[];  // Files being modified (for conflict detection)
  urgency: 'low' | 'medium' | 'high';
  acknowledged?: boolean;    // Whether the receiving team's secretary acknowledged
}
```

#### Shared Coordination Log

A project-scoped append-only log that secretaries write to. Contains cross-team decisions, conflict alerts, and sync points.

```sql
CREATE TABLE coordination_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_team_id TEXT NOT NULL,
  from_agent_id TEXT NOT NULL,    -- Always a secretary
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT,
  affected_files TEXT,            -- JSON array
  urgency TEXT NOT NULL DEFAULT 'low',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_by TEXT,           -- JSON array of teamIds that acknowledged
  resolved_at TEXT
);

CREATE INDEX idx_coordination_log_project ON coordination_log(project_id);
CREATE INDEX idx_coordination_log_unresolved
  ON coordination_log(project_id) WHERE resolved_at IS NULL;
```

#### Cross-Team File Locking

The existing file lock system is already project-scoped (visible to all teams). At Level 2, we add **proactive conflict detection:**

```typescript
class ConflictDetector {
  // Secretary monitors file locks and flags potential conflicts
  async checkForConflicts(teamId: string, projectId: string): Promise<Conflict[]> {
    // 1. Get our team's locked files
    const ourLocks = await getFileLocks(projectId, teamId);
    // 2. Get other teams' locked files
    const otherLocks = await getFileLocks(projectId, /* exclude */ teamId);

    // 3. Check for overlapping directories (not just exact file matches)
    const conflicts: Conflict[] = [];
    for (const ourLock of ourLocks) {
      for (const otherLock of otherLocks) {
        if (pathsOverlap(ourLock.filePath, otherLock.filePath)) {
          conflicts.push({
            ourFile: ourLock.filePath,
            theirFile: otherLock.filePath,
            theirTeam: otherLock.teamId,
            severity: ourLock.filePath === otherLock.filePath ? 'exact' : 'directory',
          });
        }
      }
    }
    return conflicts;
  }
}
```

The secretary writes a `conflict_alert` to the coordination log when it detects overlapping work.

**When to use:** Two or more teams actively developing on the same codebase, needing to avoid merge conflicts and duplicated work.

**Implementation effort:** Medium. New coordination_log table, secretary relay logic, conflict detection, UI for coordination log.

### Level 3: Collaborative

Active knowledge sharing and joint planning across teams.

```
Team A                                    Team B
  Lead ←──→ Secretary A ←──────────→ Secretary B ←──→ Lead
               │                           │
               ├──── Coordination Log ─────┤
               ├──── Shared Knowledge ─────┤
               └──── Review Requests ──────┘
```

**What's added over Level 2:**

#### Cross-Team Knowledge Flow

Knowledge created by one team becomes visible to others (this is already the case via project-scoped knowledge). At Level 3, we add:

- **Knowledge notifications:** When Team A writes significant knowledge (high confidence, core category), Team B's secretary is notified and can evaluate whether Team B's agents should incorporate it.
- **Knowledge endorsement:** Teams can "endorse" another team's knowledge entry, increasing its confidence score.
- **Knowledge disputes:** Teams can flag entries they disagree with (see dispute mechanism in main design doc).

```typescript
interface KnowledgeNotification {
  type: 'knowledge_created' | 'knowledge_updated';
  entry: { id: number; category: string; key: string; summary: string; confidence: number };
  sourceTeamId: string;
  sourceAgentName: string;
}

// Secretary evaluates: "Is this relevant to our team's current work?"
// If yes, surfaces to the lead. If no, acknowledges silently.
```

#### Cross-Team Review Requests

A team can request another team to review their changes:

```typescript
interface ReviewRequest {
  id: string;
  fromTeamId: string;
  toTeamId: string;
  description: string;
  files: string[];
  commitSha?: string;
  urgency: 'low' | 'medium' | 'high';
  status: 'pending' | 'accepted' | 'completed' | 'declined';
}
```

Secretaries manage the lifecycle — Team A's secretary posts the review request, Team B's secretary evaluates whether to accept (based on team capacity and relevance), and routes to the appropriate reviewer agent.

#### Joint Planning Sessions

Leads can propose a "sync point" — a coordination moment where both teams align on upcoming work:

1. Team A's secretary posts a `sync_point` to the coordination log
2. Team B's secretary acknowledges and prepares a status summary
3. Both secretaries exchange summaries
4. Leads review and adjust their DAGs if needed

This is the cross-team equivalent of a standup meeting, but async and mediated by secretaries.

**When to use:** Teams working on tightly coupled features, shared API boundaries, or approaching an integration milestone.

**Implementation effort:** Medium-High. Knowledge notifications, review request workflow, sync point protocol.

### Level 4: Integrated

Full integration — shared agents, cross-team delegation, and unified DAG.

```
Team A                                    Team B
  Lead ←──────────────────────────────→ Lead
    │           Shared DAG               │
    └──── Shared Agent Pool ─────────────┘
         Cross-team delegation
```

**What's added over Level 3:**

#### Shared Agent Pool

Agents can be explicitly shared between teams. A shared agent serves requests from multiple teams:

```typescript
interface SharedAgentConfig {
  agentId: string;
  ownerTeamId: string;          // Who created/manages the agent
  sharedWithTeamIds: string[];  // Who can send work to it
  permissions: 'prompt_only' | 'full';  // What shared teams can do
}
```

Use case: A specialized code reviewer agent that's expensive to train. Rather than each team training their own, one team trains it and shares read access.

#### Cross-Team Delegation

A lead can delegate a task to an agent on another team (with permission):

```typescript
interface CrossTeamDelegation {
  delegationId: string;
  fromTeamId: string;
  fromLeadId: string;
  toTeamId: string;
  toAgentId: string;
  task: string;
  status: 'requested' | 'accepted' | 'in_progress' | 'completed' | 'rejected';
}
```

The receiving team's lead must accept the delegation (no unsolicited work injection).

#### Unified DAG View

A project-level DAG view that shows tasks from ALL teams, with cross-team dependencies:

```
Project DAG:
  Team A: [Design API] → [Implement API] → [Test API]
                              ↓
  Team B:              [Implement Client] → [Integration Test]
                                                ↑
  Team A:                             [Deploy Staging]
```

Cross-team dependencies create synchronization points — one team's task blocks until the other team's dependency completes.

**When to use:** Large projects with multiple teams working on a shared deliverable with hard dependencies.

**Implementation effort:** High. Requires cross-team auth model, delegation protocol, unified DAG engine, shared agent permissions.

### Level 5: Autonomous (Speculative)

Teams self-organize based on project needs. No human configuration of collaboration level.

- Agent server detects that two teams are modifying overlapping files and automatically escalates to Level 2
- Secretaries autonomously negotiate collaboration level based on work overlap
- Agents self-nominate for cross-team review based on expertise matching
- The system suggests team composition changes ("Team B needs a database specialist — Team A's DBA agent has relevant expertise")

This is highly speculative and would require significant AI reasoning capabilities. Included for completeness.

## Underlying Mechanisms

### Secretary Relay Pattern

The secretary is the **diplomatic interface** between teams. All cross-team communication is mediated:

```
Team A internals ←→ Secretary A ←→ Coordination Log ←→ Secretary B ←→ Team B internals
```

**Secretary responsibilities:**
1. **Outbound:** Summarize team activities into cross-team messages. Reduce noise — only forward what's relevant to other teams.
2. **Inbound:** Read coordination log entries from other teams. Evaluate relevance. Distill for the lead.
3. **Conflict monitoring:** Watch file locks for overlapping work. Alert proactively.
4. **Status reporting:** Maintain a concise status summary for other secretaries to query.

**Message routing through agent server:**

Cross-team messages don't travel directly between orchestration servers. They go through the agent server's coordination log (SQLite table), which both orchestration servers can read:

```
Orchestration A → Agent Server → coordination_log (DB) → Agent Server → Orchestration B
                     (write)                                  (read/notify)
```

The agent server can push notifications via WebSocket events when new coordination log entries are written, so Secretary B doesn't need to poll.

### Knowledge Sharing Boundaries

At each collaboration level, knowledge flows differently:

| Level | Write | Read | Notification |
|-------|-------|------|-------------|
| 0 (Isolated) | Team-scoped (teamId column) | Project-scoped (all teams) | None |
| 1 (Aware) | Same | Same | None |
| 2 (Coordinated) | Same | Same | Secretary monitors for conflicts |
| 3 (Collaborative) | Same | Same + endorsement/dispute | Secretary notified on high-value entries |
| 4 (Integrated) | Same | Same + cross-team search | Direct agent-to-agent knowledge queries |

**Key principle:** Knowledge writes are ALWAYS team-scoped (enforced by `teamId` DB column). The collaboration level only changes visibility, notification, and interaction patterns — never write permissions.

### Conflict Detection and Resolution

**Detection hierarchy:**
1. **File lock collision** (Level 0+): Two teams lock the same file → immediate block
2. **Directory overlap** (Level 2+): Teams modifying files in the same directory → secretary alert
3. **Semantic overlap** (Level 3+): Teams working on related features → secretary cross-references DAG tasks
4. **Knowledge conflict** (Level 3+): Teams write contradicting knowledge entries → dispute mechanism

**Resolution strategies:**
- **Automatic:** File locks prevent simultaneous modification (Level 0+)
- **Secretary-mediated:** Secretaries negotiate file ownership or work scheduling (Level 2+)
- **Lead-escalated:** Leads discuss via coordination log sync point (Level 2+)
- **Human-escalated:** Surface unresolvable conflicts in the UI for human decision (all levels)

## System Impact

### Agent Server Changes

| Level | Agent Server Changes |
|-------|---------------------|
| 0 | None (current design) |
| 1 | Add `ListProjectTeamsMessage` handler with minimal summary response |
| 2 | Add `coordination_log` table writes + WebSocket notification routing + conflict detection queries |
| 3 | Add knowledge notification events + review request routing + sync point lifecycle |
| 4 | Add cross-team delegation protocol + shared agent permission model + multi-team event routing |

**Core principle:** The agent server is the routing layer. It doesn't understand collaboration semantics — it routes messages and enforces access control. The collaboration logic lives in the secretaries (orchestration server).

### Orchestration Server Changes

| Level | Orchestration Server Changes |
|-------|------------------------------|
| 0 | None (current design) |
| 1 | Add team summary API endpoint + UI card |
| 2 | Add secretary relay module + conflict detector + coordination log UI panel |
| 3 | Add knowledge notification handler + review request workflow + sync point protocol |
| 4 | Add cross-team delegation UI + unified DAG renderer + shared agent management |

### Database Schema Implications

**New tables (Level 2+):**

```sql
-- Coordination log (Level 2)
CREATE TABLE coordination_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_team_id TEXT NOT NULL,
  from_agent_id TEXT NOT NULL,
  category TEXT NOT NULL,        -- 'announcement' | 'conflict_alert' | 'question' | 'sync_point' | 'decision'
  summary TEXT NOT NULL,
  details TEXT,
  affected_files TEXT,           -- JSON array
  urgency TEXT NOT NULL DEFAULT 'low',
  created_at TEXT NOT NULL,
  acknowledged_by TEXT,          -- JSON array of teamIds
  resolved_at TEXT
);

-- Review requests (Level 3)
CREATE TABLE review_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_team_id TEXT NOT NULL,
  to_team_id TEXT NOT NULL,
  description TEXT NOT NULL,
  files TEXT,                    -- JSON array
  commit_sha TEXT,
  urgency TEXT NOT NULL DEFAULT 'low',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  completed_at TEXT
);

-- Cross-team delegations (Level 4)
CREATE TABLE cross_team_delegations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_team_id TEXT NOT NULL,
  from_lead_id TEXT NOT NULL,
  to_team_id TEXT NOT NULL,
  to_agent_id TEXT,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  created_at TEXT NOT NULL,
  completed_at TEXT
);

-- Shared agent permissions (Level 4)
CREATE TABLE shared_agents (
  agent_id TEXT NOT NULL,
  owner_team_id TEXT NOT NULL,
  shared_with_team_id TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT 'prompt_only',
  created_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, shared_with_team_id)
);
```

### UI Changes

| Level | UI Changes |
|-------|-----------|
| 0 | None |
| 1 | "Other teams" badge on project header |
| 2 | Coordination Log panel (append-only feed), conflict alerts in file lock view, secretary status indicator |
| 3 | Knowledge attribution badges ("from Team B"), review request inbox, sync point calendar/timeline |
| 4 | Unified project DAG view, shared agent indicators, cross-team delegation workflow |

### Security Model Changes

| Level | Security Changes |
|-------|-----------------|
| 0 | Team isolation enforced by connection scope (current) |
| 1 | `project_admin` permission to see team summaries |
| 2 | Secretary agents get `coordination_writer` permission for the coordination log |
| 3 | Knowledge endorsement/dispute requires `project_member` permission |
| 4 | Cross-team delegation requires explicit `delegation_target` permission grant |

**Key invariant across all levels:** No team can **modify** another team's agents, DAG, or team-scoped data. Cross-team interaction is always through designated channels (coordination log, review requests, delegation protocol) — never through direct DB manipulation.

### Performance Implications

| Level | Performance Impact |
|-------|-------------------|
| 0 | None (baseline) |
| 1 | +1 query per project load (team summary) — negligible |
| 2 | Secretary polling or WebSocket notifications for coordination log — ~1 event/minute typical |
| 3 | Knowledge notifications on write — filtered by relevance before delivery — low overhead |
| 4 | Cross-team event routing doubles the agent server's event fan-out — needs benchmarking |

**Level 4 is the performance cliff.** With N teams of M agents each, cross-team event routing creates O(N×M) fan-out. The agent server's event routing must be efficient (indexed by scope, not linear scan).

## Implementation Priority

If cross-team collaboration were prioritized, the recommended order:

1. **Level 0 + 1** — ship independently with multi-team support + basic awareness
2. **Level 2** — coordination log + secretary relay (biggest bang for buck)
3. **Level 3** — knowledge flow + review requests (builds on Level 2 infrastructure)
4. **Level 4** — full integration (only when enterprise demand justifies it)
5. **Level 5** — research project (not a product feature)

Each level is independently useful and doesn't require the next. Teams can opt in to higher levels per-project.

## Open Questions

1. **Should collaboration level be per-project or per-team-pair?** Per-project is simpler (all teams on acme-app are at Level 2). Per-team-pair is more flexible (Team A and Team B at Level 3, Team A and Team C at Level 1). Recommendation: per-project for simplicity.

2. **Secretary agent — built-in or configurable?** The secretary relay pattern assumes every team has a secretary agent. Should this be a built-in role (always present) or configurable? Recommendation: built-in at Level 2+ — the secretary is infrastructure, not optional.

3. **Coordination log retention?** How long to keep coordination log entries? Options: per-session, per-sprint (time-based), or indefinite. Recommendation: time-based with configurable retention (default 30 days).

4. **Cross-team trust model?** At Level 4, teams must trust each other's agents with work. How is trust established? Options: admin-configured, reputation-based (task success rate), or mutual consent. Recommendation: admin-configured for v1.

5. **Can teams change collaboration level mid-session?** Or only at session/project configuration time? Recommendation: configurable at any time, effective immediately — secretaries adapt their behavior based on the current level.
