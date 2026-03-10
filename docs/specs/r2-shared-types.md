# R2: Shared Types Package — Implementation Spec

**Author:** Architect Agent (a77e1782)
**Status:** ✅ **Implemented** (2026-03-07)
**Priority:** Priority 1 (from synthesis report)
**Estimated Effort:** 2-3 days

---

## 1. Current State Analysis

### 1.1 Type Duplication Inventory

The server (`packages/server/src/`) defines **212 types across 70+ files**. The web frontend (`packages/web/src/`) defines **100+ types across 45+ files**. There is no shared code between them — they communicate exclusively via HTTP and WebSocket.

#### Duplicated Types (defined independently in both packages)

| Type | Server Location | Web Location | Drift Status |
|------|----------------|--------------|--------------|
| `Role` | `agents/RoleRegistry.ts` (8 fields) | `types/index.ts` (8 fields) | ✅ Exact match |
| `DagTask` | `tasks/TaskDAG.ts` (15 fields) | `types/index.ts` (14 fields) | ⚠️ Web missing `projectId` field |
| `DagTaskStatus` | `tasks/TaskDAG.ts` (7 values) | `types/index.ts` (8 values) | ⚠️ Web has extra `'skipped'` value |
| `ChatGroup` | `comms/ChatGroupRegistry.ts` (5 fields) | `types/index.ts` (5 fields) | ⚠️ Web missing `archived` field |
| `GroupMessage` | `comms/ChatGroupRegistry.ts` (8 fields) | `types/index.ts` (8 fields) | ✅ Functionally equivalent |
| `Decision` | `coordination/DecisionLog.ts` (13 fields) | `types/index.ts` (12 fields) | ⚠️ Web missing `leadId`, optionality differs |
| `TimerInfo` | `coordination/TimerRegistry.ts` (11 fields) | `types/index.ts` (11 fields) | ⚠️ Web adds `remainingMs`, missing `leadId` |
| `Delegation` | `agents/commands/types.ts` (10 fields) | `types/index.ts` (10 fields) | ❌ **Web missing `'cancelled'` and `'terminated'` statuses** |
| `AgentStatus` | `agents/Agent.ts` (6 values) | `types/index.ts` (6 values) | ✅ Match |
| `ActionType` | `coordination/ActivityLedger.ts` (21 values) | Not defined | ❌ Web uses untyped strings |

**Active drift bugs:**
1. `Delegation.status` — web frontend cannot represent `'cancelled'` or `'terminated'` delegations → UI silently drops these or shows wrong status
2. `DagTask.projectId` — web cannot filter tasks by project
3. `ChatGroup.archived` — web cannot show/hide archived groups

### 1.2 WebSocket Protocol — Zero Type Safety

**Server sends 45 unique event types** to clients. The web frontend's `WsMessage` type is:

```typescript
export interface WsMessage {
  type: 'agent:output' | 'agent:status' | /* ...10 more... */ | string;  // ← accepts ANY string
  [key: string]: any;  // ← completely untyped payload
}
```

This means:
- **No compile-time validation** of event names (typos silently accepted)
- **No payload type checking** (`msg.agentId` vs `msg.agent_id` caught only at runtime)
- **No exhaustiveness checking** (new events added on server are silently ignored)

**Incoming client messages (7 types)** are also untyped string literals.

### 1.3 API Response Types — 12+ Untyped Endpoints

The web frontend has **120+ instances of `: any`** in component code. At least 12 API fetch calls return untyped responses:

| Endpoint | Current Typing |
|----------|---------------|
| `GET /api/lead` | `any[]` |
| `GET /api/lead/start` | untyped |
| `GET /api/coordination/status` | untyped |
| `DELETE /api/agents/:id` | untyped |
| `POST /api/agents/:id/interrupt` | untyped |
| `POST /api/agents/:id/restart` | untyped |
| `GET /api/lead/:id/groups` | untyped |
| `GET /api/lead/:id/groups/:name/messages` | untyped |
| `GET /api/lead/:id/dag` | untyped |
| `PATCH /api/agents/:id` | untyped |
| `POST /api/agents/:id/permission` | untyped |
| `POST /api/sessions/:id/resume` | untyped |

### 1.4 Existing Zod Usage

The server already uses **Zod v4.3.6** extensively:
- `packages/server/src/validation/schemas.ts` — 11 API request validation schemas
- `packages/server/src/agents/commands/commandSchemas.ts` — 15+ ACP command schemas

**This is a major advantage**: we can define Zod schemas in `@flightdeck/shared` that serve triple duty as runtime validators, TypeScript types (via `z.infer<>`), and documentation.

### 1.5 Build System Context

| Property | Value |
|----------|-------|
| Monorepo tool | npm workspaces |
| Module system | ESM (`"type": "module"`) |
| TypeScript | 5.9.3 |
| Server build | `tsc` (emits to `dist/`) |
| Web build | `tsc -b && vite build` |
| Web bundler | Vite 7.3.1 |
| Server tsconfig | extends `tsconfig.base.json`, module: `NodeNext` |
| Web tsconfig | extends `tsconfig.base.json`, module: `ESNext`, moduleResolution: `bundler` |
| Existing workspaces | `packages/server`, `packages/web`, `packages/docs` |
| Zod in server | ✅ v4.3.6 |
| Zod in web | ❌ Not a direct dependency (available via root) |

---

## 2. Proposed `packages/shared` Structure

```
packages/shared/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Barrel export — all types
│   ├── domain/
│   │   ├── agent.ts                # AgentStatus, AgentInfo (shared subset)
│   │   ├── role.ts                 # Role
│   │   ├── task.ts                 # DagTask, DagTaskStatus, DagTaskInput
│   │   ├── decision.ts            # Decision, DecisionStatus, DecisionCategory
│   │   ├── delegation.ts          # Delegation, DelegationStatus
│   │   ├── group.ts               # ChatGroup, GroupMessage
│   │   ├── timer.ts               # Timer, TimerInput
│   │   ├── project.ts             # Project, ProjectSession
│   │   ├── activity.ts            # ActionType, ActivityEntry
│   │   ├── alert.ts               # Alert, AlertSeverity, AlertAction
│   │   └── lock.ts                # FileLock
│   ├── protocol/
│   │   ├── ws-incoming.ts         # WsServerMessage — all server→client events
│   │   ├── ws-outgoing.ts         # WsClientMessage — all client→server events
│   │   └── index.ts               # Re-exports both
│   ├── api/
│   │   ├── requests.ts            # API request body types (Zod schemas)
│   │   ├── responses.ts           # API response types
│   │   └── index.ts               # Re-exports both
│   └── enums.ts                   # Shared string literal unions / constants
```

### Design Principles

1. **Zod-first**: Define Zod schemas, derive TypeScript types with `z.infer<>`. This gives us runtime validation AND compile-time types from a single source.
2. **No runtime dependencies besides Zod**: The shared package must be lightweight — no Express, no React, no Node.js APIs.
3. **Tree-shakeable**: Each domain file is independently importable. The barrel export is for convenience but doesn't force bundling everything.
4. **Additive, not breaking**: Types are designed to be a superset of what both packages currently use. No field removals until migration is complete.

---

## 3. Exact Types to Extract and Share

### 3.1 Domain Types

#### `domain/agent.ts`
```typescript
import { z } from 'zod';

export const AgentStatusSchema = z.enum([
  'idle', 'running', 'waiting', 'paused', 'completed', 'failed'
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

// Shared subset — fields that both server and web need
export const AgentInfoSchema = z.object({
  id: z.string(),
  role: z.string(),       // role ID, not the full Role object
  roleName: z.string().optional(),
  status: AgentStatusSchema,
  task: z.string().optional(),
  dagTaskId: z.string().optional(),
  parentId: z.string().optional(),
  childIds: z.array(z.string()).default([]),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  model: z.string().optional(),
  autopilot: z.boolean().default(true),
  createdAt: z.string(),  // ISO 8601
  // Token tracking
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  contextWindowSize: z.number().optional(),
  contextWindowUsed: z.number().optional(),
  contextBurnRate: z.number().optional(),
  estimatedExhaustionMinutes: z.number().optional(),
});
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
```

#### `domain/role.ts`
```typescript
import { z } from 'zod';

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  color: z.string().optional(),
  icon: z.string().optional(),
  builtIn: z.boolean().default(false),
  model: z.string().optional(),
});
export type Role = z.infer<typeof RoleSchema>;

export const BUILT_IN_ROLES = [
  'architect', 'code-reviewer', 'critical-reviewer', 'designer',
  'developer', 'generalist', 'lead', 'product-manager', 'qa-tester',
  'radical-thinker', 'readability-reviewer', 'secretary', 'tech-writer',
] as const;
export type BuiltInRole = typeof BUILT_IN_ROLES[number];
```

#### `domain/task.ts`
```typescript
import { z } from 'zod';

export const DagTaskStatusSchema = z.enum([
  'pending', 'ready', 'running', 'done', 'failed', 'blocked', 'paused', 'skipped'
]);
export type DagTaskStatus = z.infer<typeof DagTaskStatusSchema>;

export const DagTaskSchema = z.object({
  id: z.string(),
  leadId: z.string(),
  projectId: z.string().optional(),
  role: z.string(),
  title: z.string().optional(),
  description: z.string(),
  files: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  dagStatus: DagTaskStatusSchema,
  priority: z.number().default(0),
  model: z.string().optional(),
  assignedAgentId: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});
export type DagTask = z.infer<typeof DagTaskSchema>;

export const DagTaskInputSchema = z.object({
  id: z.string().optional(),
  role: z.string(),
  title: z.string().optional(),
  description: z.string(),
  files: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  priority: z.number().optional(),
  model: z.string().optional(),
});
export type DagTaskInput = z.infer<typeof DagTaskInputSchema>;
```

#### `domain/decision.ts`
```typescript
import { z } from 'zod';

export const DecisionStatusSchema = z.enum([
  'recorded', 'confirmed', 'rejected', 'dismissed'
]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const DecisionCategorySchema = z.enum([
  'architecture', 'implementation', 'delegation', 'process',
  'tooling', 'communication', 'other'
]);
export type DecisionCategory = z.infer<typeof DecisionCategorySchema>;

export const DecisionSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentRole: z.string(),
  leadId: z.string().optional(),
  projectId: z.string().optional(),
  title: z.string(),
  rationale: z.string(),
  needsConfirmation: z.boolean().default(false),
  status: DecisionStatusSchema.default('recorded'),
  autoApproved: z.boolean().default(false),
  confirmedAt: z.string().optional(),
  timestamp: z.string(),
  category: DecisionCategorySchema.optional(),
});
export type Decision = z.infer<typeof DecisionSchema>;
```

#### `domain/delegation.ts`
```typescript
import { z } from 'zod';

export const DelegationStatusSchema = z.enum([
  'active', 'completed', 'failed', 'cancelled', 'terminated'
]);
export type DelegationStatus = z.infer<typeof DelegationStatusSchema>;

export const DelegationSchema = z.object({
  id: z.string(),
  fromAgentId: z.string(),
  toAgentId: z.string(),
  toRole: z.string(),
  task: z.string(),
  context: z.string().optional(),
  status: DelegationStatusSchema,
  createdAt: z.string(),
  completedAt: z.string().optional(),
  result: z.string().optional(),
});
export type Delegation = z.infer<typeof DelegationStatusSchema>;
```

#### `domain/group.ts`
```typescript
import { z } from 'zod';

export const ChatGroupSchema = z.object({
  name: z.string(),
  leadId: z.string(),
  projectId: z.string().optional(),
  archived: z.boolean().default(false),
  memberIds: z.array(z.string()),
  createdAt: z.string(),
});
export type ChatGroup = z.infer<typeof ChatGroupSchema>;

export const GroupMessageSchema = z.object({
  id: z.string(),
  groupName: z.string(),
  leadId: z.string(),
  projectId: z.string().optional(),
  fromAgentId: z.string(),
  fromRole: z.string(),
  content: z.string(),
  reactions: z.record(z.string(), z.array(z.string())).default({}),
  timestamp: z.string(),
});
export type GroupMessage = z.infer<typeof GroupMessageSchema>;
```

#### `domain/timer.ts`
```typescript
import { z } from 'zod';

export const TimerStatusSchema = z.enum(['pending', 'fired', 'cancelled']);
export type TimerStatus = z.infer<typeof TimerStatusSchema>;

export const TimerSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  agentRole: z.string().optional(),
  leadId: z.string().optional(),
  label: z.string(),
  message: z.string(),
  delaySeconds: z.number(),
  fireAt: z.string(),
  createdAt: z.string(),
  status: TimerStatusSchema,
  repeat: z.boolean().default(false),
});
export type Timer = z.infer<typeof TimerSchema>;

// Frontend-specific: adds computed fields
export const TimerInfoSchema = TimerSchema.extend({
  remainingMs: z.number().optional(),
});
export type TimerInfo = z.infer<typeof TimerInfoSchema>;
```

#### `domain/project.ts`
```typescript
import { z } from 'zod';

export const ProjectStatusSchema = z.enum(['active', 'paused', 'completed', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  cwd: z.string(),
  status: ProjectStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  activeLeadId: z.string().optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectSessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  leadId: z.string(),
  sessionId: z.string().optional(),
  task: z.string().optional(),
  status: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
});
export type ProjectSession = z.infer<typeof ProjectSessionSchema>;
```

#### `domain/activity.ts`
```typescript
import { z } from 'zod';

export const ActionTypeSchema = z.enum([
  'task_started', 'task_completed', 'task_failed',
  'agent_spawned', 'agent_terminated', 'agent_crashed',
  'decision_made', 'decision_confirmed', 'decision_rejected',
  'file_locked', 'file_unlocked', 'file_conflict',
  'delegation_created', 'delegation_completed', 'delegation_failed',
  'message_sent', 'broadcast_sent', 'group_message_sent',
  'commit_created', 'build_failed', 'test_failed',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActivityEntrySchema = z.object({
  id: z.string(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  agentRole: z.string().optional(),
  projectId: z.string().optional(),
  action: ActionTypeSchema,
  summary: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string(),
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
```

#### `domain/alert.ts`
```typescript
import { z } from 'zod';

export const AlertSeveritySchema = z.enum(['info', 'warning', 'error', 'critical']);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const AlertSchema = z.object({
  id: z.string(),
  agentId: z.string().optional(),
  projectId: z.string().optional(),
  severity: AlertSeveritySchema,
  title: z.string(),
  message: z.string(),
  timestamp: z.string(),
  acknowledged: z.boolean().default(false),
});
export type Alert = z.infer<typeof AlertSchema>;
```

#### `domain/lock.ts`
```typescript
import { z } from 'zod';

export const FileLockSchema = z.object({
  filePath: z.string(),
  agentId: z.string(),
  agentRole: z.string().optional(),
  leadId: z.string().optional(),
  projectId: z.string().optional(),
  reason: z.string().optional(),
  acquiredAt: z.string(),
  expiresAt: z.string().optional(),
});
export type FileLock = z.infer<typeof FileLockSchema>;
```

### 3.2 WebSocket Protocol Types

#### `protocol/ws-incoming.ts` (Server → Client)

```typescript
import { z } from 'zod';
import type { AgentInfo, AgentStatus, DagTask, Decision, Timer, ChatGroup, GroupMessage, Alert, FileLock } from '../domain/index.js';

// Discriminated union of ALL server→client WebSocket messages.
// Adding a new event type here will cause compile errors in any
// unhandled switch/case, ensuring exhaustive handling.

// === Agent Lifecycle Events ===
export type AgentSpawnedEvent = { type: 'agent:spawned'; agent: AgentInfo };
export type AgentTerminatedEvent = { type: 'agent:terminated'; agentId: string; reason?: string };
export type AgentExitEvent = { type: 'agent:exit'; agentId: string; code: number };
export type AgentCrashedEvent = { type: 'agent:crashed'; agentId: string; error: string };
export type AgentAutoRestartedEvent = { type: 'agent:auto_restarted'; agentId: string; newAgentId: string };
export type AgentSubSpawnedEvent = { type: 'agent:sub_spawned'; parentId: string; child: AgentInfo };

// === Agent I/O Events ===
export type AgentStatusEvent = { type: 'agent:status'; agentId: string; status: AgentStatus };
export type AgentTextEvent = { type: 'agent:text'; agentId: string; text: string };
export type AgentContentEvent = { type: 'agent:content'; agentId: string; content: unknown };
export type AgentThinkingEvent = { type: 'agent:thinking'; agentId: string; text: string };
export type AgentToolCallEvent = { type: 'agent:tool_call'; agentId: string; toolCall: unknown };
export type AgentPlanEvent = { type: 'agent:plan'; agentId: string; plan: unknown };
export type AgentResponseStartEvent = { type: 'agent:response_start'; agentId: string };
export type AgentSessionReadyEvent = { type: 'agent:session_ready'; agentId: string; sessionId: string };
export type AgentContextCompactedEvent = { type: 'agent:context_compacted'; agentId: string };
export type AgentCompletionReportedEvent = { type: 'agent:completion_reported'; agentId: string; summary: string };

// === Agent Communication Events ===
export type AgentMessageSentEvent = { type: 'agent:message_sent'; from: string; to: string; content: string };
export type AgentDelegatedEvent = { type: 'agent:delegated'; agentId: string; delegationId: string };
export type AgentPermissionRequestEvent = { type: 'agent:permission_request'; agentId: string; request: unknown };
export type AgentPermissionResponseEvent = { type: 'agent:permission_response'; agentId: string; approved: boolean };

// === Decision Events ===
export type LeadDecisionEvent = { type: 'lead:decision'; id: string; agentId: string; title: string; rationale: string; category?: string };
export type DecisionConfirmedEvent = { type: 'decision:confirmed'; decisionId: string };
export type DecisionRejectedEvent = { type: 'decision:rejected'; decisionId: string };
export type DecisionDismissedEvent = { type: 'decision:dismissed'; decisionId: string };
export type DecisionsBatchEvent = { type: 'decisions:batch'; decisions: Array<{ id: string; action: string }> };
export type IntentAlertEvent = { type: 'intent:alert'; agentId: string; intent: string };

// === Task/DAG Events ===
export type DagUpdatedEvent = { type: 'dag:updated'; leadId: string; tasks: DagTask[] };
export type LeadProgressEvent = { type: 'lead:progress'; leadId: string; progress: unknown };

// === File Coordination Events ===
export type LockAcquiredEvent = { type: 'lock:acquired'; lock: FileLock };
export type LockReleasedEvent = { type: 'lock:released'; filePath: string; agentId: string };
export type ActivityEvent = { type: 'activity'; entry: unknown };

// === Group Chat Events ===
export type GroupCreatedEvent = { type: 'group:created'; name: string; leadId: string; memberIds: string[] };
export type GroupMessageEvent = { type: 'group:message'; message: GroupMessage };
export type GroupMemberAddedEvent = { type: 'group:member_added'; leadId: string; group: string; agentId: string };
export type GroupMemberRemovedEvent = { type: 'group:member_removed'; leadId: string; group: string; agentId: string };
export type GroupReactionEvent = { type: 'group:reaction'; groupName: string; messageId: string; agentId: string; emoji: string; action: 'add' | 'remove' };

// === System Events ===
export type SystemPausedEvent = { type: 'system:paused'; paused: boolean };
export type AlertNewEvent = { type: 'alert:new'; alert: Alert };
export type TimerCreatedEvent = { type: 'timer:created'; timer: Timer };
export type TimerFiredEvent = { type: 'timer:fired'; timerId: string };
export type TimerCancelledEvent = { type: 'timer:cancelled'; timerId: string };

// === Initialization ===
export type InitEvent = { type: 'init'; agents: AgentInfo[]; systemPaused?: boolean };

// === Error ===
export type ErrorEvent = { type: 'error'; message: string };

// === The Union ===
export type WsServerMessage =
  | AgentSpawnedEvent
  | AgentTerminatedEvent
  | AgentExitEvent
  | AgentCrashedEvent
  | AgentAutoRestartedEvent
  | AgentSubSpawnedEvent
  | AgentStatusEvent
  | AgentTextEvent
  | AgentContentEvent
  | AgentThinkingEvent
  | AgentToolCallEvent
  | AgentPlanEvent
  | AgentResponseStartEvent
  | AgentSessionReadyEvent
  | AgentContextCompactedEvent
  | AgentCompletionReportedEvent
  | AgentMessageSentEvent
  | AgentDelegatedEvent
  | AgentPermissionRequestEvent
  | AgentPermissionResponseEvent
  | LeadDecisionEvent
  | DecisionConfirmedEvent
  | DecisionRejectedEvent
  | DecisionDismissedEvent
  | DecisionsBatchEvent
  | IntentAlertEvent
  | DagUpdatedEvent
  | LeadProgressEvent
  | LockAcquiredEvent
  | LockReleasedEvent
  | ActivityEvent
  | GroupCreatedEvent
  | GroupMessageEvent
  | GroupMemberAddedEvent
  | GroupMemberRemovedEvent
  | GroupReactionEvent
  | SystemPausedEvent
  | AlertNewEvent
  | TimerCreatedEvent
  | TimerFiredEvent
  | TimerCancelledEvent
  | InitEvent
  | ErrorEvent;

// Helper: extract message by type
export type WsServerMessageOf<T extends WsServerMessage['type']> =
  Extract<WsServerMessage, { type: T }>;
```

#### `protocol/ws-outgoing.ts` (Client → Server)

```typescript
// Discriminated union of ALL client→server WebSocket messages.

export type SubscribeMessage = { type: 'subscribe'; agentId: string };
export type UnsubscribeMessage = { type: 'unsubscribe'; agentId: string };
export type SubscribeProjectMessage = { type: 'subscribe-project'; projectId: string | null };
export type InputMessage = { type: 'input'; agentId: string; text: string };
export type ResizeMessage = { type: 'resize'; agentId: string; cols: number; rows: number };
export type PermissionResponseMessage = { type: 'permission_response'; agentId: string; approved: boolean; reason?: string };
export type QueueOpenMessage = { type: 'queue_open' };
export type QueueClosedMessage = { type: 'queue_closed' };

export type WsClientMessage =
  | SubscribeMessage
  | UnsubscribeMessage
  | SubscribeProjectMessage
  | InputMessage
  | ResizeMessage
  | PermissionResponseMessage
  | QueueOpenMessage
  | QueueClosedMessage;

// Helper: extract message by type
export type WsClientMessageOf<T extends WsClientMessage['type']> =
  Extract<WsClientMessage, { type: T }>;
```

### 3.3 API Types

#### `api/responses.ts`
```typescript
import type { AgentInfo, Role, DagTask, Decision, ChatGroup, GroupMessage, Project, ProjectSession, Timer, Alert, FileLock, ActivityEntry } from '../domain/index.js';

// GET /api/lead
export interface GetLeadsResponse {
  leads: Array<{
    id: string;
    projectId?: string;
    projectName?: string;
    agentCount: number;
    status: string;
  }>;
}

// GET /api/roles
export type GetRolesResponse = Role[];

// GET /api/config
export interface ServerConfig {
  maxAgents: number;
  defaultModel: string;
  autopilot: boolean;
  autoApproveThreshold?: number;
  models: Array<{ id: string; name: string; provider: string }>;
}

// GET /api/lead/:id/dag
export interface GetDagResponse {
  tasks: DagTask[];
  edges: Array<{ from: string; to: string }>;
}

// GET /api/lead/:id/groups
export type GetGroupsResponse = ChatGroup[];

// GET /api/lead/:id/groups/:name/messages
export type GetGroupMessagesResponse = GroupMessage[];

// GET /api/coordination/status
export interface CoordinationStatusResponse {
  locks: FileLock[];
  activity: ActivityEntry[];
  decisions: Decision[];
}

// POST /api/agents — response
export type SpawnAgentResponse = AgentInfo;

// GET /api/projects
export type GetProjectsResponse = Project[];

// GET /api/projects/:id/sessions
export type GetProjectSessionsResponse = ProjectSession[];
```

### 3.4 Shared Enums

#### `enums.ts`
```typescript
// Content types for agent messages
export type MessageSender = 'agent' | 'user' | 'system' | 'thinking' | 'external';
export type ContentType = 'text' | 'image' | 'audio' | 'resource';

// Escalation
export type EscalationCondition = 'stale_decision' | 'blocked_task' | 'agent_stuck' | 'build_failure';
export type EscalationTarget = 'lead' | 'user' | 'architect';

// Knowledge categories
export type KnowledgeCategory = 'pattern' | 'pitfall' | 'tool' | 'architecture' | 'process';
```

---

## 4. Build Configuration

### 4.1 `packages/shared/package.json`

```json
{
  "name": "@flightdeck/shared",
  "version": "0.3.2",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./domain": {
      "types": "./dist/domain/index.d.ts",
      "import": "./dist/domain/index.js"
    },
    "./protocol": {
      "types": "./dist/protocol/index.d.ts",
      "import": "./dist/protocol/index.js"
    },
    "./api": {
      "types": "./dist/api/index.d.ts",
      "import": "./dist/api/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "typescript": "^5.9.3"
  }
}
```

### 4.2 `packages/shared/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src/**/*"]
}
```

**Why `composite: true`:** Enables TypeScript project references. Both server and web can reference `packages/shared` for incremental builds.

### 4.3 Root Configuration Updates

#### `package.json` — add workspace

```jsonc
{
  "workspaces": [
    "packages/shared",   // ← ADD (must be first — built before dependents)
    "packages/server",
    "packages/web",
    "packages/docs"
  ]
}
```

#### `package.json` — update build script

```jsonc
{
  "scripts": {
    "build": "npm run build --workspace=packages/shared && npm run build --workspace=packages/server && npm run build --workspace=packages/web",
    "build:shared": "npm run build --workspace=packages/shared"
  }
}
```

### 4.4 Server `tsconfig.json` Update

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../shared" }
  ]
}
```

### 4.5 Web `tsconfig.json` Update

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/__tests__/**"],
  "references": [
    { "path": "../shared" }
  ]
}
```

### 4.6 Web Vite Configuration

Vite with `moduleResolution: "bundler"` should resolve `@flightdeck/shared` from the workspace automatically. If not, add a Vite alias:

```typescript
// vite.config.ts (only if workspace resolution fails)
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@flightdeck/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
});
```

### 4.7 Dependency Declarations

Both consuming packages add `@flightdeck/shared` as a workspace dependency:

```jsonc
// packages/server/package.json
{
  "dependencies": {
    "@flightdeck/shared": "workspace:*"
    // ... other deps
  }
}

// packages/web/package.json
{
  "dependencies": {
    "@flightdeck/shared": "workspace:*",
    "zod": "^4.3.6"  // ← ADD (needed for runtime validation in web)
    // ... other deps
  }
}
```

---

## 5. Migration Strategy

### Phase 1: Create Package and Domain Types (Day 1)

**Goal:** Ship `@flightdeck/shared` with domain types. Both packages can import from it but don't have to yet.

1. Create `packages/shared/` directory structure
2. Write all domain type files (agent, role, task, decision, delegation, group, timer, project, activity, alert, lock)
3. Write barrel exports (`index.ts` files at each level)
4. Add to root workspaces, run `npm install`
5. Build shared: `npm run build --workspace=packages/shared`
6. **Verify:** `tsc --noEmit` passes in shared package

**Validation:** The shared package builds independently and exports all planned types.

### Phase 2: Migrate Server Imports (Day 1-2)

**Goal:** Server imports shared types instead of defining its own. The server's local types become re-exports or thin wrappers.

Migration order (least risk first):

| Step | Type | Server File to Update | Change |
|------|------|----------------------|--------|
| 1 | `DagTaskStatus` | `tasks/TaskDAG.ts` | Import from `@flightdeck/shared/domain` |
| 2 | `DagTask` | `tasks/TaskDAG.ts` | Import from shared, extend if server needs extra fields |
| 3 | `AgentStatus` | `agents/Agent.ts` | Import from shared |
| 4 | `Role` | `agents/RoleRegistry.ts` | Import from shared |
| 5 | `DecisionStatus`, `DecisionCategory` | `coordination/DecisionLog.ts` | Import from shared |
| 6 | `Decision` | `coordination/DecisionLog.ts` | Import from shared |
| 7 | `DelegationStatus` | `agents/commands/types.ts` | Import from shared |
| 8 | `ChatGroup`, `GroupMessage` | `comms/ChatGroupRegistry.ts` | Import from shared |
| 9 | `Timer` | `coordination/TimerRegistry.ts` | Import from shared |
| 10 | `ActionType` | `coordination/ActivityLedger.ts` | Import from shared |
| 11 | `FileLock` | `coordination/FileLockRegistry.ts` | Import from shared |

**Pattern for each migration:**

```typescript
// BEFORE (in server file):
export type AgentStatus = 'idle' | 'running' | 'waiting' | 'paused' | 'completed' | 'failed';

// AFTER (in server file):
export { type AgentStatus } from '@flightdeck/shared/domain';
// OR if the server needs to extend:
import { type AgentStatus as SharedAgentStatus } from '@flightdeck/shared/domain';
export type AgentStatus = SharedAgentStatus;  // re-export for backward compat
```

**Critical rule:** Keep re-exports in the original server files so that server-internal imports (`import { AgentStatus } from '../agents/Agent.js'`) don't break. These re-exports can be removed in a follow-up PR.

**Validation per step:**
- `npm run build --workspace=packages/server` passes
- `npm run test --workspace=packages/server` passes (all 125+ test files)

### Phase 3: Migrate Web Imports (Day 2)

**Goal:** Web frontend imports shared types, replacing its local `types/index.ts` definitions.

1. Add `@flightdeck/shared` and `zod` as web dependencies
2. Update `packages/web/src/types/index.ts`:

```typescript
// BEFORE: 267 lines of hand-written interfaces
export interface DagTask { ... }
export type AgentStatus = '...' | '...';

// AFTER: Re-export from shared + web-specific extensions
export {
  type AgentStatus,
  type AgentInfo,
  type Role,
  type DagTask,
  type DagTaskStatus,
  type Decision,
  type DecisionStatus,
  type Delegation,
  type DelegationStatus,
  type ChatGroup,
  type GroupMessage,
  type Timer,
  type TimerInfo,
  type Project,
  type ProjectSession,
  type Alert,
  type FileLock,
  type ActionType,
  type ActivityEntry,
} from '@flightdeck/shared';

// Web-specific types that DON'T belong in shared:
export interface AcpTextChunk { ... }     // Protocol rendering model
export interface AcpToolCall { ... }       // Protocol rendering model
export interface AcpPlanEntry { ... }      // Protocol rendering model
export interface AcpPermissionRequest { ... }
export interface AcpSessionInfo { ... }
export interface LeadProgress { ... }      // Computed aggregate
export interface ServerConfig { ... }      // → move to shared/api in follow-up
```

3. Fix the `WsMessage` type:

```typescript
// BEFORE:
export interface WsMessage {
  type: 'agent:output' | string;
  [key: string]: any;
}

// AFTER:
import { type WsServerMessage } from '@flightdeck/shared/protocol';
export type { WsServerMessage };  // re-export for backward compat

// In useWebSocket.ts:
import { type WsServerMessage, type WsServerMessageOf } from '@flightdeck/shared/protocol';

function handleMessage(msg: WsServerMessage) {
  switch (msg.type) {
    case 'agent:spawned':
      // msg is narrowed to AgentSpawnedEvent — msg.agent is typed!
      addAgent(msg.agent);
      break;
    case 'agent:status':
      // msg is narrowed to AgentStatusEvent — msg.status is AgentStatus!
      updateAgentStatus(msg.agentId, msg.status);
      break;
    // ... TypeScript enforces exhaustive handling
  }
}
```

4. Fix the outgoing messages:

```typescript
// In useWebSocket.ts:
import { type WsClientMessage } from '@flightdeck/shared/protocol';

function send(msg: WsClientMessage) {
  ws.send(JSON.stringify(msg));
}

// Now: send({ type: 'subscribe', agentId: '123' }) — type-checked!
// Now: send({ type: 'subscribee', agentId: '123' }) — COMPILE ERROR (typo caught)
```

**Validation:**
- `npm run build --workspace=packages/web` passes (tsc + vite)
- `npm run test --workspace=packages/web` passes
- Manual smoke test: start dev server, verify WS communication works

### Phase 4: Wire WebSocket Protocol Types on Server (Day 2-3)

**Goal:** Server also uses the shared WS protocol types when broadcasting.

```typescript
// BEFORE (in WebSocketServer.ts):
broadcastToProject({
  type: 'agent:spawned',
  agent: agent.toJSON(),
}, agent.projectId);

// AFTER:
import { type WsServerMessage } from '@flightdeck/shared/protocol';

broadcastToProject({
  type: 'agent:spawned',
  agent: agent.toJSON(),
} satisfies WsServerMessage, agent.projectId);
// ^ TypeScript verifies the shape matches the protocol spec
```

**Pattern:** Use `satisfies WsServerMessage` at broadcast call sites. This validates without changing runtime behavior.

**Validation:**
- `npm run build --workspace=packages/server` passes
- `npm run test --workspace=packages/server` passes

### Phase 5: Add API Response Types (Day 3, optional stretch)

**Goal:** Type the API layer. Lower priority than WS protocol.

1. Move `ServerConfig` to `@flightdeck/shared/api`
2. Add response types to shared package
3. Update web API hooks to use typed responses:

```typescript
// In useApi.ts:
import type { GetRolesResponse, SpawnAgentResponse, ServerConfig } from '@flightdeck/shared/api';

async function fetchRoles(): Promise<GetRolesResponse> {
  const res = await fetch('/api/roles');
  return res.json();
}
```

---

## 6. CI/Build Verification

### 6.1 Build Order Enforcement

The root `build` script must build shared first:

```bash
npm run build --workspace=packages/shared && \
npm run build --workspace=packages/server && \
npm run build --workspace=packages/web
```

### 6.2 CI Checks to Add

```yaml
# In existing CI workflow, add before server/web builds:
- name: Build shared types
  run: npm run build --workspace=packages/shared

- name: Typecheck shared
  run: npm run typecheck --workspace=packages/shared
```

### 6.3 Type Drift Prevention

Add a CI step that ensures the shared package is always built before dependents:

```yaml
- name: Verify no import drift
  run: |
    # Ensure no server file directly defines types that should come from shared
    ! grep -r "export type AgentStatus" packages/server/src/ --include="*.ts" | grep -v "from '@flightdeck/shared"
    ! grep -r "export type DagTaskStatus" packages/server/src/ --include="*.ts" | grep -v "from '@flightdeck/shared"
    ! grep -r "export type DelegationStatus" packages/server/src/ --include="*.ts" | grep -v "from '@flightdeck/shared"
```

This grep-based check catches regressions where someone re-defines a shared type locally instead of importing it.

### 6.4 Dev Workflow

For development, `packages/shared` should build in watch mode:

```json
// Root package.json
{
  "scripts": {
    "dev": "npm run build:watch --workspace=packages/shared & node scripts/dev.mjs"
  }
}
```

Alternatively, both server (`tsx watch`) and web (Vite) can resolve directly to the TypeScript source in development:

```typescript
// vite.config.ts — resolve to source in dev
export default defineConfig({
  resolve: {
    alias: process.env.NODE_ENV === 'development' ? {
      '@flightdeck/shared': path.resolve(__dirname, '../shared/src'),
    } : {},
  },
});
```

For the server with `tsx`, TypeScript source resolution works automatically via workspace resolution + `declarationMap`.

---

## 7. What NOT to Share

Some types should remain package-specific:

| Type | Package | Why Not Shared |
|------|---------|---------------|
| `AcpTextChunk`, `AcpToolCall`, `AcpPlanEntry` | web | Frontend-only rendering models for ACP protocol display |
| `AcpPermissionRequest`, `AcpSessionInfo` | web | Frontend-only protocol models |
| `LeadProgress` | web | Computed aggregate from multiple sources |
| Drizzle table types (`conversations`, `roles`, etc.) | server | Database implementation detail |
| Express middleware types | server | Server framework detail |
| Zustand store types (`AppState`, `GroupState`) | web | Frontend state management detail |
| Component prop types (11 files) | web | UI-specific, not domain models |
| React hook return types | web | UI-specific |

**Rule of thumb:** If a type describes **what data looks like on the wire** (WS, HTTP) or **what a domain concept means**, it belongs in shared. If it describes **how a specific package handles that data internally**, it stays local.

---

## 8. Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Build order issues in CI | Medium | Explicit `--workspace` ordering in build script |
| Circular dependency between shared and server | Low | Shared has zero internal dependencies; only Zod |
| Vite can't resolve workspace package | Low | Fallback alias in vite.config.ts |
| Breaking existing server imports | Medium | Re-export pattern preserves all existing import paths |
| Large PR scope | High | Split into 5 phases, each independently mergeable |
| Zod version mismatch | Low | Pin exact version in shared; both packages already on v4 |

---

## 9. Success Criteria

1. **Zero duplicate type definitions**: `AgentStatus`, `DagTaskStatus`, `DelegationStatus`, `Role`, `DagTask`, `Decision`, `ChatGroup`, `GroupMessage`, `Timer` each defined exactly once (in shared)
2. **WsMessage fully typed**: The catch-all `[key: string]: any` replaced by discriminated union. TypeScript catches missing event handlers at compile time.
3. **Delegation status drift fixed**: Frontend correctly handles `'cancelled'` and `'terminated'` delegations
4. **Build passes**: `npm run build` from root builds all three packages in order without errors
5. **All tests pass**: Server (125+ test files) and web tests continue to pass
6. **No runtime behavior changes**: This is a type-only refactor. No logic changes, no new features.

---

*This spec can be implemented as 3-5 PRs corresponding to the migration phases. Each phase is independently testable and mergeable. The recommended critical path is Phase 1 → Phase 2 → Phase 3 (domain types + server + web), with Phases 4-5 as follow-ups.*
