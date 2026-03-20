import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/** ISO 8601 UTC timestamp with Z suffix — use instead of datetime('now') to avoid timezone ambiguity */
export const utcNow = sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`;

// ── Conversations & Messages ─────────────────────────────────────────

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  taskId: text('task_id'),
  createdAt: text('created_at').default(utcNow),
}, (table) => [
  index('idx_conversations_agent').on(table.agentId),
]);

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  sender: text('sender').notNull(),
  content: text('content').notNull(),
  fromRole: text('from_role'),
  timestamp: text('timestamp').default(utcNow),
}, (table) => [
  index('idx_messages_conversation').on(table.conversationId),
]);

// ── Roles ────────────────────────────────────────────────────────────

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').default(''),
  systemPrompt: text('system_prompt').default(''),
  color: text('color').default('#888'),
  icon: text('icon').default('🤖'),
  builtIn: integer('built_in').default(0),
  model: text('model'),
});

// ── Settings ─────────────────────────────────────────────────────────

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ── File Locks ───────────────────────────────────────────────────────

export const fileLocks = sqliteTable('file_locks', {
  filePath: text('file_path').primaryKey(),
  agentId: text('agent_id').notNull(),
  agentRole: text('agent_role').notNull(),
  reason: text('reason').default(''),
  acquiredAt: text('acquired_at').default(utcNow),
  expiresAt: text('expires_at').notNull(),
  projectId: text('project_id').default(''),
}, (table) => [
  index('idx_file_locks_agent').on(table.agentId),
  index('idx_file_locks_project').on(table.projectId),
]);

// ── Activity Log ─────────────────────────────────────────────────────

export const activityLog = sqliteTable('activity_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id').notNull(),
  agentRole: text('agent_role').notNull(),
  actionType: text('action_type').notNull(),
  summary: text('summary').notNull(),
  details: text('details').default('{}'),
  timestamp: text('timestamp').default(utcNow),
  projectId: text('project_id').default(''),
}, (table) => [
  index('idx_activity_agent').on(table.agentId),
  index('idx_activity_type').on(table.actionType),
  index('idx_activity_project').on(table.projectId),
]);

// ── Decisions ────────────────────────────────────────────────────────

export const decisions = sqliteTable('decisions', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  agentRole: text('agent_role').notNull(),
  leadId: text('lead_id'),
  projectId: text('project_id'),
  title: text('title').notNull(),
  rationale: text('rationale').default(''),
  needsConfirmation: integer('needs_confirmation').default(0),
  status: text('status').default('recorded'),
  autoApproved: integer('auto_approved').default(0),
  confirmedAt: text('confirmed_at'),
  createdAt: text('created_at').default(utcNow),
}, (table) => [
  index('idx_decisions_status').on(table.status),
  index('idx_decisions_needs_confirmation').on(table.needsConfirmation),
  index('idx_decisions_lead_id').on(table.leadId),
  index('idx_decisions_project_id').on(table.projectId),
]);

// ── Agent Memory ─────────────────────────────────────────────────────

export const agentMemory = sqliteTable('agent_memory', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leadId: text('lead_id').notNull(),
  agentId: text('agent_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  createdAt: text('created_at').default(utcNow),
}, (table) => [
  index('idx_agent_memory_lead').on(table.leadId),
  index('idx_agent_memory_agent').on(table.agentId),
  uniqueIndex('idx_agent_memory_unique').on(table.leadId, table.agentId, table.key),
]);

// ── Chat Groups ──────────────────────────────────────────────────────

export const chatGroups = sqliteTable('chat_groups', {
  name: text('name').notNull(),
  leadId: text('lead_id').notNull(),
  projectId: text('project_id'),
  roles: text('roles'),
  archived: integer('archived').default(0),
  createdAt: text('created_at').default(utcNow),
}, (table) => [
  primaryKey({ columns: [table.name, table.leadId] }),
]);

export const chatGroupMembers = sqliteTable('chat_group_members', {
  groupName: text('group_name').notNull(),
  leadId: text('lead_id').notNull(),
  agentId: text('agent_id').notNull(),
  addedAt: text('added_at').default(utcNow),
}, (table) => [
  primaryKey({ columns: [table.groupName, table.leadId, table.agentId] }),
]);

export const chatGroupMessages = sqliteTable('chat_group_messages', {
  id: text('id').primaryKey(),
  groupName: text('group_name').notNull(),
  leadId: text('lead_id').notNull(),
  fromAgentId: text('from_agent_id').notNull(),
  fromRole: text('from_role').notNull(),
  content: text('content').notNull(),
  reactions: text('reactions').default('{}'),
  timestamp: text('timestamp').default(utcNow),
}, (table) => [
  index('idx_group_messages_group').on(table.groupName, table.leadId),
]);

// ── DAG Tasks ────────────────────────────────────────────────────────

export const dagTasks = sqliteTable('dag_tasks', {
  id: text('id').notNull(),
  leadId: text('lead_id').notNull(),
  projectId: text('project_id'),
  teamId: text('team_id').notNull().default('default'),
  role: text('role').notNull(),
  title: text('title'),
  description: text('description').notNull().default(''),
  files: text('files').default('[]'),
  dependsOn: text('depends_on').default('[]'),
  dagStatus: text('dag_status').default('pending'),
  priority: integer('priority').default(0),
  model: text('model'),
  assignedAgentId: text('assigned_agent_id'),
  failureReason: text('failure_reason'),
  createdAt: text('created_at').default(utcNow),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  archivedAt: text('archived_at'),
  overriddenBy: text('overridden_by'),
}, (table) => [
  primaryKey({ columns: [table.id, table.leadId] }),
  index('idx_dag_tasks_lead').on(table.leadId),
  index('idx_dag_tasks_status').on(table.dagStatus),
  index('idx_dag_tasks_project').on(table.projectId),
  index('idx_dag_tasks_team').on(table.teamId),
  index('idx_dag_tasks_id_team').on(table.id, table.teamId),
]);

// ── Agent Plans ──────────────────────────────────────────────────────

export const agentPlans = sqliteTable('agent_plans', {
  agentId: text('agent_id').primaryKey(),
  leadId: text('lead_id'),
  planJson: text('plan_json').notNull().default('[]'),
  updatedAt: text('updated_at').default(utcNow),
});

// ── Projects (persistent, survive lead sessions) ────────────────────

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').default(''),
  cwd: text('cwd'),
  status: text('status').default('active'),       // active | archived | completed
  modelConfig: text('model_config').default('{}'),  // JSON: role → allowed model IDs
  oversightLevel: text('oversight_level'),           // null = inherit global; 'supervised' | 'balanced' | 'autonomous'
  createdAt: text('created_at').default(utcNow),
  updatedAt: text('updated_at').default(utcNow),
}, (table) => [
  index('idx_projects_status').on(table.status),
]);

// INVARIANT: leadId is immutable after creation — session ID + agent ID are a permanent pair.
// On resume, the same agent ID is reused via spawn(). Never update leadId on an existing row.
export const projectSessions = sqliteTable('project_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: text('project_id').notNull().references(() => projects.id),
  leadId: text('lead_id').notNull(),             // immutable after insert — identity of the lead agent
  sessionId: text('session_id'),                 // Copilot SDK session ID, set after session creation
  role: text('role').default('lead'),               // role id used for this session
  task: text('task'),
  status: text('status').default('active'),        // active | completed | crashed | resuming | stopped
  startedAt: text('started_at').default(utcNow),
  endedAt: text('ended_at'),
}, (table) => [
  index('idx_project_sessions_project').on(table.projectId),
  index('idx_project_sessions_lead').on(table.leadId),
]);

// ── Agent File History (capability tracking) ──────────────────────────

export const agentFileHistory = sqliteTable('agent_file_history', {
  agentId: text('agent_id').notNull(),
  agentRole: text('agent_role').notNull(),
  leadId: text('lead_id').notNull(),
  filePath: text('file_path').notNull(),
  firstTouchedAt: text('first_touched_at').default(utcNow),
  lastTouchedAt: text('last_touched_at').default(utcNow),
  touchCount: integer('touch_count').default(1),
}, (table) => [
  primaryKey({ columns: [table.agentId, table.leadId, table.filePath] }),
  index('idx_file_history_file').on(table.filePath, table.leadId),
  index('idx_file_history_agent').on(table.agentId, table.leadId),
]);

// ── Collective Memory (cross-session knowledge persistence) ─────────

export const collectiveMemory = sqliteTable('collective_memory', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  category: text('category').notNull(),  // pattern | decision | expertise | gotcha
  key: text('key').notNull(),
  value: text('value').notNull(),
  source: text('source').notNull(),      // agentId who discovered it
  projectId: text('project_id').default(''),
  createdAt: text('created_at').default(utcNow),
  lastUsedAt: text('last_used_at').default(utcNow),
  useCount: integer('use_count').default(0),
}, (table) => [
  index('idx_collective_memory_category').on(table.category),
  index('idx_collective_memory_key').on(table.key),
  index('idx_collective_memory_project').on(table.projectId),
  uniqueIndex('idx_collective_memory_cat_key').on(table.category, table.key, table.projectId),
]);

// ── Task Cost Records (per-agent per-task token usage) ──────────────

export const taskCostRecords = sqliteTable('task_cost_records', {
  agentId: text('agent_id').notNull(),
  dagTaskId: text('dag_task_id').notNull(),
  leadId: text('lead_id').notNull(),
  projectId: text('project_id'),
  inputTokens: integer('input_tokens').default(0),
  outputTokens: integer('output_tokens').default(0),
  cacheReadTokens: integer('cache_read_tokens').default(0),
  cacheWriteTokens: integer('cache_write_tokens').default(0),
  costUsd: real('cost_usd').default(0),
  createdAt: text('created_at').default(utcNow),
  updatedAt: text('updated_at').default(utcNow),
}, (table) => [
  primaryKey({ columns: [table.agentId, table.dagTaskId, table.leadId] }),
  index('idx_task_cost_agent').on(table.agentId),
  index('idx_task_cost_task').on(table.dagTaskId, table.leadId),
  index('idx_task_cost_project').on(table.projectId),
]);

// ── Session Retrospectives ──────────────────────────────────────────

export const sessionRetros = sqliteTable('session_retros', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leadId: text('lead_id').notNull(),
  data: text('data').notNull(),        // JSON blob with full retro
  createdAt: text('created_at').default(utcNow),
}, (table) => [
  index('idx_session_retros_lead').on(table.leadId),
]);

// ── Timers ──────────────────────────────────────────────────────────

export const timers = sqliteTable('timers', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  agentRole: text('agent_role').notNull(),
  leadId: text('lead_id'),
  projectId: text('project_id'),
  label: text('label').notNull(),
  message: text('message').notNull(),
  delaySeconds: integer('delay_seconds').notNull(),
  fireAt: text('fire_at').notNull(),
  createdAt: text('created_at').default(utcNow),
  status: text('status').notNull().default('pending'),   // pending | fired | cancelled
  repeat: integer('repeat').default(0),
}, (table) => [
  index('idx_timers_agent').on(table.agentId),
  index('idx_timers_status').on(table.status),
]);

// ── Message Queue (crash-safe write-on-enqueue) ─────────────────────

export const messageQueue = sqliteTable('message_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  targetAgentId: text('target_agent_id').notNull(),
  sourceAgentId: text('source_agent_id'),
  messageType: text('message_type').notNull(), // 'agent_message' | 'delegation_result' | 'broadcast' | 'system'
  payload: text('payload').notNull(),           // JSON-encoded PromptContent
  status: text('status').notNull().default('queued'), // 'queued' | 'delivered' | 'expired'
  attempts: integer('attempts').notNull().default(0),
  createdAt: text('created_at').default(utcNow),
  deliveredAt: text('delivered_at'),
  projectId: text('project_id'),
}, (table) => [
  index('idx_mq_target_status').on(table.targetAgentId, table.status),
  index('idx_mq_project').on(table.projectId),
]);

// ── Agent Roster (persisted agent state for restart recovery) ────────

export const agentRoster = sqliteTable('agent_roster', {
  agentId: text('agent_id').primaryKey(),
  role: text('role').notNull(),
  model: text('model').notNull(),
  status: text('status').notNull().default('idle'), // 'idle' | 'running' | 'terminated'
  sessionId: text('session_id'),
  projectId: text('project_id'),
  provider: text('provider'),
  teamId: text('team_id').notNull().default('default'),
  createdAt: text('created_at').notNull().default(utcNow),
  updatedAt: text('updated_at').notNull().default(utcNow),
  lastTaskSummary: text('last_task_summary'),
  metadata: text('metadata'), // JSON blob for extensible data
}, (table) => [
  index('idx_agent_roster_status').on(table.status),
  index('idx_agent_roster_project').on(table.projectId),
  index('idx_agent_roster_project_team').on(table.projectId, table.teamId),
  index('idx_agent_roster_team').on(table.teamId),
  index('idx_agent_roster_session').on(table.sessionId),
]);

// ── Active Delegations (in-flight task assignments) ─────────────────

export const activeDelegations = sqliteTable('active_delegations', {
  delegationId: text('delegation_id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agentRoster.agentId),
  task: text('task').notNull(),
  context: text('context'),
  dagTaskId: text('dag_task_id'),
  teamId: text('team_id').notNull().default('default'),
  status: text('status').notNull().default('active'), // 'active' | 'completed' | 'failed' | 'cancelled'
  createdAt: text('created_at').notNull().default(utcNow),
  completedAt: text('completed_at'),
  result: text('result'), // JSON blob with completion result
}, (table) => [
  index('idx_ad_agent').on(table.agentId, table.status),
  index('idx_ad_status').on(table.status),
  index('idx_ad_dag_task').on(table.dagTaskId),
  index('idx_ad_team').on(table.teamId),
]);

// ── Knowledge (per-project 4-tier memory) ──────────────────────────

export const knowledge = sqliteTable('knowledge', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: text('project_id').notNull(),
  category: text('category').notNull(), // 'core' | 'episodic' | 'procedural' | 'semantic'
  key: text('key').notNull(),
  content: text('content').notNull(),
  metadata: text('metadata'), // JSON: { source, confidence, tags, ... }
  createdAt: text('created_at').notNull().default(utcNow),
  updatedAt: text('updated_at').notNull().default(utcNow),
}, (table) => [
  uniqueIndex('idx_knowledge_project_cat_key').on(table.projectId, table.category, table.key),
  index('idx_knowledge_project_category').on(table.projectId, table.category),
]);
