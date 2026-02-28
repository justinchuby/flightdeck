import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ── Conversations & Messages ─────────────────────────────────────────

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  taskId: text('task_id'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_conversations_agent').on(table.agentId),
]);

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  sender: text('sender').notNull(),
  content: text('content').notNull(),
  timestamp: text('timestamp').default(sql`(datetime('now'))`),
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
  acquiredAt: text('acquired_at').default(sql`(datetime('now'))`),
  expiresAt: text('expires_at').notNull(),
}, (table) => [
  index('idx_file_locks_agent').on(table.agentId),
]);

// ── Activity Log ─────────────────────────────────────────────────────

export const activityLog = sqliteTable('activity_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id').notNull(),
  agentRole: text('agent_role').notNull(),
  actionType: text('action_type').notNull(),
  summary: text('summary').notNull(),
  details: text('details').default('{}'),
  timestamp: text('timestamp').default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_activity_agent').on(table.agentId),
  index('idx_activity_type').on(table.actionType),
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
  createdAt: text('created_at').default(sql`(datetime('now'))`),
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
  createdAt: text('created_at').default(sql`(datetime('now'))`),
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
  createdAt: text('created_at').default(sql`(datetime('now'))`),
}, (table) => [
  primaryKey({ columns: [table.name, table.leadId] }),
]);

export const chatGroupMembers = sqliteTable('chat_group_members', {
  groupName: text('group_name').notNull(),
  leadId: text('lead_id').notNull(),
  agentId: text('agent_id').notNull(),
  addedAt: text('added_at').default(sql`(datetime('now'))`),
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
  timestamp: text('timestamp').default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_group_messages_group').on(table.groupName, table.leadId),
]);

// ── DAG Tasks ────────────────────────────────────────────────────────

export const dagTasks = sqliteTable('dag_tasks', {
  id: text('id').notNull(),
  leadId: text('lead_id').notNull(),
  role: text('role').notNull(),
  description: text('description').notNull().default(''),
  files: text('files').default('[]'),
  dependsOn: text('depends_on').default('[]'),
  dagStatus: text('dag_status').default('pending'),
  priority: integer('priority').default(0),
  model: text('model'),
  assignedAgentId: text('assigned_agent_id'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
}, (table) => [
  primaryKey({ columns: [table.id, table.leadId] }),
  index('idx_dag_tasks_lead').on(table.leadId),
  index('idx_dag_tasks_status').on(table.dagStatus),
]);

// ── Deferred Issues ──────────────────────────────────────────────

export const deferredIssues = sqliteTable('deferred_issues', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  leadId: text('lead_id').notNull(),
  reviewerAgentId: text('reviewer_agent_id').notNull(),
  reviewerRole: text('reviewer_role').notNull(),
  severity: text('severity').notNull().default('P1'),
  description: text('description').notNull(),
  sourceFile: text('source_file').default(''),
  status: text('status').notNull().default('open'),       // open | resolved | dismissed
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  resolvedAt: text('resolved_at'),
}, (table) => [
  index('idx_deferred_issues_lead').on(table.leadId),
  index('idx_deferred_issues_status').on(table.status),
]);

// ── Agent Plans ──────────────────────────────────────────────────────

export const agentPlans = sqliteTable('agent_plans', {
  agentId: text('agent_id').primaryKey(),
  leadId: text('lead_id'),
  planJson: text('plan_json').notNull().default('[]'),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

// ── Projects (persistent, survive lead sessions) ────────────────────

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').default(''),
  cwd: text('cwd'),
  status: text('status').default('active'),       // active | archived | completed
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_projects_status').on(table.status),
]);

export const projectSessions = sqliteTable('project_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: text('project_id').notNull().references(() => projects.id),
  leadId: text('lead_id').notNull(),
  sessionId: text('session_id'),
  task: text('task'),
  status: text('status').default('active'),        // active | completed | crashed
  startedAt: text('started_at').default(sql`(datetime('now'))`),
  endedAt: text('ended_at'),
}, (table) => [
  index('idx_project_sessions_project').on(table.projectId),
  index('idx_project_sessions_lead').on(table.leadId),
]);
