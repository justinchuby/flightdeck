# Chat Groups

Agents can create focused group chats for coordinating on shared work — a middle ground between 1-to-1 messages and broadcasts to everyone.

## Why Groups?

Direct messages (`AGENT_MESSAGE`) are 1-to-1. Broadcasts (`BROADCAST`) go to everyone. Groups let a subset of agents — say, three developers working on related features — discuss and coordinate without routing through the lead or spamming the whole team.

## Creating and Using Groups

Any agent can create groups. The lead is auto-included for visibility. Groups support both explicit member IDs and **role-based membership**.

### Commands

**Group creation (any agent):**
```
⟦ CREATE_GROUP {"name": "config-team", "members": ["agent-id-1", "agent-id-2"]} ⟧
```
Creates a named group. Members are agent IDs (short 8-char prefixes work). The lead is automatically added. Responds with a confirmation including the group name and resolved member list.

**Role-based membership:**
```
⟦ CREATE_GROUP {"name": "frontend-team", "roles": ["developer", "designer"]} ⟧
```
Auto-adds all active agents with matching roles. Terminated/completed agents are excluded via `isTerminalStatus()` filter. Can be combined with explicit `members`.

```
⟦ ADD_TO_GROUP {"group": "config-team", "members": ["agent-id-3"]} ⟧
```
Adds members to an existing group. The new member receives the group's recent message history (last 20 messages) so they have context.

```
⟦ REMOVE_FROM_GROUP {"group": "config-team", "members": ["agent-id-2"]} ⟧
```
Removes members. The lead cannot be removed.

**Any group member:**
```
⟦ GROUP_MESSAGE {"group": "config-team", "content": "I found a pattern we should all follow..."} ⟧
```
Sends a message to all other group members. The sender sees a delivery confirmation. Each recipient receives the message with the sender's role and ID.

**Any agent — discover groups:**
```
⟦ QUERY_GROUPS ⟧
```
Lists all groups the agent belongs to, with member names/roles, message count, and last message preview (first 100 chars). Also aliased as `LIST_GROUPS`.

### Message Format (Delivery to Recipients)

When an agent receives a group message:
```
[Group "config-team" — Developer (abc12345)]: I found a pattern we should all follow...
```

When a new member is added:
```
[System] You've been added to group "config-team". Members: Developer (abc12345), Architect (def67890), Code Reviewer (ghi11111).
```

### Data Model

#### Server: `ChatGroup` (in-memory, backed by `MessageBus`)

```typescript
interface ChatGroup {
  name: string;           // unique group name (kebab-case)
  leadId: string;         // lead who created the group
  memberIds: Set<string>; // agent IDs (always includes leadId)
  createdAt: string;      // ISO timestamp
  archived: boolean;      // true when all members have terminated
}

interface GroupMessage {
  id: string;             // unique message ID
  group: string;          // group name
  from: string;           // sender agent ID
  fromRole: string;       // sender role name
  content: string;        // message text
  timestamp: string;      // ISO timestamp
}
```

#### Database Table (persistent across restarts)

```sql
CREATE TABLE IF NOT EXISTS chat_groups (
  name TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (name, lead_id)
);

CREATE TABLE IF NOT EXISTS chat_group_members (
  group_name TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  added_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (group_name, lead_id, agent_id)
);

CREATE TABLE IF NOT EXISTS chat_group_messages (
  id TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  from_agent_id TEXT NOT NULL,
  from_role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_group_messages_group ON chat_group_messages(group_name, lead_id);
```

### Server Architecture

#### New File: `packages/server/src/comms/ChatGroupRegistry.ts`

```typescript
export class ChatGroupRegistry extends EventEmitter {
  constructor(db: Database) { ... }

  create(leadId: string, name: string, memberIds: string[]): ChatGroup
  addMembers(leadId: string, name: string, memberIds: string[]): void
  removeMembers(leadId: string, name: string, memberIds: string[]): void
  archiveGroup(leadId: string, name: string): void
  sendMessage(group: string, leadId: string, fromId: string, fromRole: string, content: string): GroupMessage
  getGroups(leadId: string): ChatGroup[]           // excludes archived
  getGroupsForAgent(agentId: string): ChatGroup[]  // excludes archived
  getMessages(group: string, leadId: string, limit?: number): GroupMessage[]
  getMembers(group: string, leadId: string): string[]

  // Events emitted:
  // 'group:created' — { group: ChatGroup }
  // 'group:message' — { message: GroupMessage, recipientIds: string[] }
  // 'group:member_added' — { group: string, agentId: string }
  // 'group:member_removed' — { group: string, agentId: string }
  // 'group:archived' — { group: string, leadId: string }
}
```

#### AgentManager Integration

New regex patterns in `AgentManager.ts`:
```typescript
const CREATE_GROUP_REGEX = /<!--\s*CREATE_GROUP\s*(\{.*?\})\s*-->/s;
const ADD_TO_GROUP_REGEX = /<!--\s*ADD_TO_GROUP\s*(\{.*?\})\s*-->/s;
const REMOVE_FROM_GROUP_REGEX = /<!--\s*REMOVE_FROM_GROUP\s*(\{.*?\})\s*-->/s;
const GROUP_MESSAGE_REGEX = /<!--\s*GROUP_MESSAGE\s*(\{.*?\})\s*-->/s;
const LIST_GROUPS_REGEX = /<!--\s*LIST_GROUPS\s*-->/s;
```

New handlers:
- `detectCreateGroup(agent, data)` — lead-only, creates group, sends confirmation
- `detectAddToGroup(agent, data)` — lead-only, adds members, sends history to new member
- `detectRemoveFromGroup(agent, data)` — lead-only, removes members
- `detectGroupMessage(agent, data)` — any member, delivers to all other members
- `detectListGroups(agent, data)` — returns groups the agent belongs to

#### Agent Context Updates

In `buildContextManifest()`, if the agent belongs to groups, show them:
```
== YOUR GROUPS ==
- "config-team" (3 members: Developer, Architect, Code Reviewer)
- "testing" (2 members: Developer, Critical Reviewer)
Send messages: <!-- GROUP_MESSAGE {"group": "config-team", "content": "..."} -->
```

In the lead's prompt, add to AVAILABLE COMMANDS:
```
Create a chat group for agents working on related tasks:
`<!-- CREATE_GROUP {"name": "config-team", "members": ["agent-id-1", "agent-id-2"]} -->`

Send a message to a group:
`<!-- GROUP_MESSAGE {"group": "config-team", "content": "Use factory pattern for services"} -->`
```

### WebSocket Events (UI)

| Event | Payload | Description |
|-------|---------|-------------|
| `group:created` | `{ group, leadId }` | New group created |
| `group:message` | `{ message, groupName, leadId }` | Message sent in a group |
| `group:member_added` | `{ group, agentId, leadId }` | Member added to group |
| `group:member_removed` | `{ group, agentId, leadId }` | Member removed from group |
| `group:archived` | `{ group, leadId }` | Group archived (all members terminated) |

### Auto-Group-Creation for Parallel Delegations

When the lead delegates tasks to multiple agents, the system automatically creates coordination groups:

1. After each delegation, `maybeAutoCreateGroup()` checks all active delegations from the same lead
2. It extracts the first significant keyword (>3 characters) from each task description
3. When 3+ active delegations share a keyword, it creates a `{keyword}-team` group
4. All matching agents + the lead are added to the group
5. A system message is sent: "Auto-created coordination group for parallel {keyword} work"

The creation is idempotent — if the group already exists, new agents are simply added. This reduces the lead's coordination overhead for parallel work.

### Auto-Archive Lifecycle

Groups are automatically archived when they are no longer active:

1. When an agent is terminated, the system checks all groups the agent belongs to
2. For each group, if all remaining members (excluding the lead) are in terminal status (completed/failed/terminated), the group is archived
3. Archived groups are excluded from `QUERY_GROUPS` results
4. Message history is preserved and remains queryable via the API
5. The `archived` column is stored as an INTEGER (0/1) in SQLite

### Unread Badges

The frontend tracks unread messages per group:

1. Each group chat tab maintains a `lastSeen` timestamp (persisted to `localStorage`)
2. Unread count = messages with timestamp > `lastSeen`
3. A blue badge appears on the Groups sidebar item showing total unread count
4. Badge shows `99+` for overflow
5. Visiting a group resets its `lastSeen` to now

### Frontend: Group Messages Panel

In the LeadDashboard, add a "Groups" tab/section alongside the existing Activity, Comms, and Reports panels. This panel shows:

1. **Group list** — all groups under the current lead, with member counts
2. **Group chat view** — click a group to see its message history
   - Messages shown chronologically with sender role/ID and timestamp
   - Color-coded by sender role (reuse role colors from RoleRegistry)
   - Auto-scrolls to latest message
3. **Group creation** — lead can create groups from the UI (not just via commands)

### API Endpoints

```
GET  /api/lead/:id/groups                — list groups for a lead
GET  /api/lead/:id/groups/:name          — get group details + members
GET  /api/lead/:id/groups/:name/messages — get group message history (with pagination)
POST /api/lead/:id/groups                — create a group { name, memberIds }
POST /api/lead/:id/groups/:name/members  — add members { memberIds }
DELETE /api/lead/:id/groups/:name/members/:agentId — remove a member
```

### Design Decisions

1. **Groups are scoped to a lead** — each lead has its own namespace of groups. This avoids conflicts when multiple leads run simultaneously.

2. **Lead auto-included** — the lead always sees all group messages for coordination visibility. The lead cannot be removed from a group.

3. **Persistence** — groups and messages are stored in SQLite so they survive server restarts. In-flight agents can re-discover their groups via `QUERY_GROUPS`.

4. **History on join** — when a new member is added, they receive the last 20 messages so they have context. This mirrors how real chat tools work.

5. **No external dependencies** — extends the existing `MessageBus` EventEmitter pattern. At current scale (5-20 agents), in-process messaging is sufficient. If we ever need 100+ agents, consider NATS or Redis pub/sub.

6. **Sub-agents can message groups** — not just the lead. This enables peer coordination (e.g., two developers discussing a shared interface) without lead involvement.

7. **Auto-group-creation** — When 3+ agents are delegated tasks sharing a keyword, a coordination group is auto-created. This reduces lead overhead and ensures agents working on the same feature can communicate directly.

8. **Auto-archive lifecycle** — When all non-lead members of a group reach terminal status, the group is automatically archived. This keeps `QUERY_GROUPS` clean without losing history.

9. **Unread badges** — The frontend tracks per-group `lastSeen` timestamps to show unread counts. This ensures users notice new group messages even when focused on another view.

### Example Usage

```
Lead: I'll create a team for the config work.
<!-- CREATE_GROUP {"name": "config-team", "members": ["abc12345", "def67890"]} -->

[System] Group "config-team" created with 3 members (you + Developer abc12345 + Architect def67890).

Lead: Let the team know about the constraint.
<!-- GROUP_MESSAGE {"group": "config-team", "content": "Important: _configs.py has breaking changes in progress. Coordinate before editing."} -->

[System] Message delivered to 2 group members.

Developer abc12345 (in their context):
[Group "config-team" — Project Lead (lead1234)]: Important: _configs.py has breaking changes in progress. Coordinate before editing.

Developer abc12345 responds:
<!-- GROUP_MESSAGE {"group": "config-team", "content": "Understood. I'll wait for Architect to finish the RoPEConfig extraction before I touch _configs.py."} -->

Architect def67890 (in their context):
[Group "config-team" — Developer (abc12345)]: Understood. I'll wait for Architect to finish the RoPEConfig extraction before I touch _configs.py.
```

## Auto-Creation for Parallel Work

When the lead delegates the same feature to 3+ agents, groups are automatically created based on keyword extraction from task descriptions.

**How it works:**
1. After each delegation, `maybeAutoCreateGroup()` scans all active delegations from the same lead
2. Extracts the first significant keyword (>3 chars, excluding stop words) from each task
3. If 3+ agents share a keyword, a `{keyword}-team` group is created
4. Stop words include: `the`, `and`, `implement`, `create`, `build`, `fix`, `add`, `review`, `update`, `check`, `test`, `run`, `verify`, `ensure`, `handle`, `process`, `manage`
5. Only newly added members receive notification messages (dedup guard)

**Example:** If the lead delegates "implement timeline filtering", "implement timeline brush", and "implement timeline keyboard nav" to three devs, a `timeline-team` group is auto-created.

## Auto-Archive (Lifecycle Cleanup)

Groups are automatically archived when all members reach terminal status (completed, failed, or terminated).

- Archived groups are excluded from `QUERY_GROUPS` results
- Message history is preserved in the database for audit
- The `archived` column on `chat_groups` table tracks this state
- `AgentManager` triggers archive checks after each agent termination
