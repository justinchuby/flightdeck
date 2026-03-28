import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { Database } from '../db/database.js';
import { dataRoutes } from '../routes/data.js';
import { apiErrorHandler } from '../middleware/errorHandler.js';
import {
  projects,
  projectSessions,
  activityLog,
  dagTasks,
  chatGroups,
  chatGroupMembers,
  chatGroupMessages,
  conversations,
  messages,
  agentMemory,
  decisions,
  fileLocks,
  agentFileHistory,
  collectiveMemory,
  taskCostRecords,
  sessionRetros,
  timers,
  agentPlans,
} from '../db/schema.js';
import { sql } from 'drizzle-orm';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

function countTable(db: Database, tableName: string): number {
  const rows = db.drizzle.all<{ cnt: number }>(sql.raw(`SELECT count(*) as cnt FROM ${tableName}`));
  return Number(rows[0]?.cnt ?? 0);
}

const LEAD_ID = 'lead-001';
const SUB_AGENT_ID = 'dev-sub-001';
const PROJECT_ID = 'proj-001';

function seedTestData(db: Database) {
  const d = db.drizzle;
  const now = new Date().toISOString();
  const pastDate = new Date(Date.now() - 30 * 86_400_000).toISOString();

  // Project
  d.insert(projects).values({ id: PROJECT_ID, name: 'Test Project' }).run();

  // Session (ended in the past)
  d.insert(projectSessions).values({
    projectId: PROJECT_ID,
    leadId: LEAD_ID,
    sessionId: 'sess-001',
    task: 'test task',
    status: 'completed',
    startedAt: pastDate,
    endedAt: pastDate,
  }).run();

  // Activity log — both lead and sub-agent
  d.insert(activityLog).values({ agentId: LEAD_ID, agentRole: 'Lead', actionType: 'start', summary: 'Started', projectId: PROJECT_ID }).run();
  d.insert(activityLog).values({ agentId: SUB_AGENT_ID, agentRole: 'Developer', actionType: 'code', summary: 'Coded', projectId: PROJECT_ID }).run();

  // Conversations — lead and sub-agent
  d.insert(conversations).values({ id: 'conv-lead', agentId: LEAD_ID, taskId: 'task-1' }).run();
  d.insert(conversations).values({ id: 'conv-sub', agentId: SUB_AGENT_ID, taskId: 'task-2' }).run();

  // Messages in both conversations
  d.insert(messages).values({ conversationId: 'conv-lead', sender: 'user', content: 'hello lead' }).run();
  d.insert(messages).values({ conversationId: 'conv-sub', sender: 'user', content: 'hello sub' }).run();
  d.insert(messages).values({ conversationId: 'conv-sub', sender: 'assistant', content: 'reply from sub' }).run();

  // Chat groups
  d.insert(chatGroups).values({ name: 'group-1', leadId: LEAD_ID, projectId: PROJECT_ID }).run();
  d.insert(chatGroupMembers).values({ groupName: 'group-1', leadId: LEAD_ID, agentId: SUB_AGENT_ID }).run();
  d.insert(chatGroupMessages).values({ id: 'gmsg-1', groupName: 'group-1', leadId: LEAD_ID, fromAgentId: SUB_AGENT_ID, fromRole: 'Developer', content: 'hi group' }).run();

  // DAG tasks
  d.insert(dagTasks).values({ id: 'dtask-1', leadId: LEAD_ID, role: 'Developer', description: 'Build feature', projectId: PROJECT_ID }).run();

  // Agent file history
  d.insert(agentFileHistory).values({ agentId: SUB_AGENT_ID, agentRole: 'Developer', leadId: LEAD_ID, filePath: 'src/index.ts' }).run();

  // Task cost records
  d.insert(taskCostRecords).values({ agentId: SUB_AGENT_ID, dagTaskId: 'dtask-1', leadId: LEAD_ID, inputTokens: 1000, outputTokens: 500 }).run();

  // Session retros
  d.insert(sessionRetros).values({ leadId: LEAD_ID, data: '{"score": 8}' }).run();

  // === Previously missing tables ===

  // Decisions
  d.insert(decisions).values({ id: 'dec-1', agentId: SUB_AGENT_ID, agentRole: 'Developer', leadId: LEAD_ID, projectId: PROJECT_ID, title: 'Use TypeScript' }).run();

  // Agent memory
  d.insert(agentMemory).values({ leadId: LEAD_ID, agentId: SUB_AGENT_ID, key: 'pref', value: 'typescript' }).run();

  // Agent plans
  d.insert(agentPlans).values({ agentId: SUB_AGENT_ID, leadId: LEAD_ID, planJson: '[{"step":"code"}]' }).run();

  // Timers
  d.insert(timers).values({ id: 'timer-1', agentId: SUB_AGENT_ID, agentRole: 'Developer', leadId: LEAD_ID, label: 'check', message: 'Check build', delaySeconds: 300, fireAt: now }).run();

  // File locks
  d.insert(fileLocks).values({ filePath: 'src/app.ts', agentId: SUB_AGENT_ID, agentRole: 'Developer', expiresAt: now, projectId: PROJECT_ID }).run();

  // Collective memory
  d.insert(collectiveMemory).values({ category: 'conventions', key: 'style', value: 'prettier', source: SUB_AGENT_ID, projectId: PROJECT_ID }).run();
}

describe('POST /data/cleanup', () => {
  let db: Database;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    const app = express();
    app.use(express.json());
    const ctx = { db, config: { dbPath: ':memory:' } } as any;
    app.use(dataRoutes(ctx));
    app.use(apiErrorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });

  async function cleanup(body: { olderThanDays: number; dryRun?: boolean }) {
    const res = await fetch(`${baseUrl}/data/cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() as any };
  }

  // ── Purge All (olderThanDays === 0) ────────────────────────────────

  describe('purge all (olderThanDays = 0)', () => {
    it('dry run counts all records in all 19 data tables', async () => {
      seedTestData(db);
      const { status, body } = await cleanup({ olderThanDays: 0, dryRun: true });

      expect(status).toBe(200);
      expect(body.dryRun).toBe(true);
      expect(body.totalDeleted).toBeGreaterThan(0);

      // Verify all 19 tables are counted
      expect(body.deleted.projects).toBe(1);
      expect(body.deleted.project_sessions).toBe(1);
      expect(body.deleted.decisions).toBe(1);
      expect(body.deleted.agent_memory).toBe(1);
      expect(body.deleted.agent_plans).toBe(1);
      expect(body.deleted.timers).toBe(1);
      expect(body.deleted.file_locks).toBe(1);
      expect(body.deleted.collective_memory).toBe(1);
      expect(body.deleted.conversations).toBe(2);
      expect(body.deleted.messages).toBe(3);
    });

    it('actually deletes all records from all tables', async () => {
      seedTestData(db);
      const { status, body } = await cleanup({ olderThanDays: 0 });

      expect(status).toBe(200);
      expect(body.dryRun).toBe(false);
      expect(body.totalDeleted).toBeGreaterThan(0);

      // Verify all tables are empty
      for (const tableName of [
        'projects', 'project_sessions', 'activity_log', 'dag_tasks',
        'chat_groups', 'chat_group_members', 'chat_group_messages',
        'conversations', 'messages', 'agent_memory', 'decisions',
        'file_locks', 'agent_file_history', 'collective_memory',
        'task_cost_records', 'session_retros', 'timers',
        'agent_plans',
      ]) {
        expect(countTable(db, tableName)).toBe(0);
      }
    });

    it('works even with no project sessions (orphaned data)', async () => {
      // Insert data into tables WITHOUT any project sessions
      const d = db.drizzle;
      d.insert(agentMemory).values({ leadId: 'orphan-lead', agentId: 'orphan-agent', key: 'k', value: 'v' }).run();
      d.insert(decisions).values({ id: 'dec-orphan', agentId: 'a', agentRole: 'Dev', leadId: 'orphan-lead', title: 'Orphan' }).run();
      d.insert(collectiveMemory).values({ category: 'test', key: 'k', value: 'v', source: 'agent', projectId: 'orphan-proj' }).run();

      const { status, body } = await cleanup({ olderThanDays: 0, dryRun: true });

      expect(status).toBe(200);
      expect(body.totalDeleted).toBe(3);
      expect(body.deleted.agent_memory).toBe(1);
      expect(body.deleted.decisions).toBe(1);
      expect(body.deleted.collective_memory).toBe(1);
    });
  });

  // ── Selective Purge (olderThanDays > 0) ─────────────────────────────

  describe('selective purge (olderThanDays > 0)', () => {
    it('deletes records from all 19 data tables including previously missing 7', async () => {
      seedTestData(db);
      const { status, body } = await cleanup({ olderThanDays: 7 });

      expect(status).toBe(200);
      expect(body.dryRun).toBe(false);

      // Previously missing tables should now be deleted
      expect(countTable(db, 'decisions')).toBe(0);
      expect(countTable(db, 'agent_memory')).toBe(0);
      expect(countTable(db, 'agent_plans')).toBe(0);
      expect(countTable(db, 'timers')).toBe(0);
      expect(countTable(db, 'file_locks')).toBe(0);
      expect(countTable(db, 'collective_memory')).toBe(0);

      // Original tables also deleted
      expect(countTable(db, 'dag_tasks')).toBe(0);
      expect(countTable(db, 'chat_groups')).toBe(0);
      expect(countTable(db, 'session_retros')).toBe(0);
    });

    it('dry-run counts include all 7 previously missing tables', async () => {
      seedTestData(db);
      const { status, body } = await cleanup({ olderThanDays: 7, dryRun: true });

      expect(status).toBe(200);
      expect(body.dryRun).toBe(true);

      // These were previously not counted in dry run
      expect(body.deleted.decisions).toBe(1);
      expect(body.deleted.agent_memory).toBe(1);
      expect(body.deleted.agent_plans).toBe(1);
      expect(body.deleted.timers).toBe(1);
      expect(body.deleted.file_locks).toBe(1);
      expect(body.deleted.collective_memory).toBe(1);
    });

    it('deletes sub-agent conversations via activityLog cross-reference', async () => {
      seedTestData(db);

      // Before cleanup: 2 conversations (lead + sub-agent), 3 messages
      expect(countTable(db, 'conversations')).toBe(2);
      expect(countTable(db, 'messages')).toBe(3);

      const { body } = await cleanup({ olderThanDays: 7 });

      // Both lead AND sub-agent conversations should be deleted
      expect(body.deleted.conversations).toBe(2);
      expect(body.deleted.messages).toBe(3);
      expect(countTable(db, 'conversations')).toBe(0);
      expect(countTable(db, 'messages')).toBe(0);
    });

    it('dry-run counts sub-agent conversations correctly', async () => {
      seedTestData(db);
      const { body } = await cleanup({ olderThanDays: 7, dryRun: true });

      // Should count BOTH lead and sub-agent conversations
      expect(body.deleted.conversations).toBe(2);
      expect(body.deleted.messages).toBe(3);
    });

    it('returns empty result when no old sessions found', async () => {
      seedTestData(db);
      // Session ended 30 days ago, so asking for 90 days should find nothing
      const { body } = await cleanup({ olderThanDays: 90 });

      expect(body.totalDeleted).toBe(0);
      expect(body.sessionsDeleted).toBe(0);
    });

    it('skips active sessions (no endedAt)', async () => {
      const d = db.drizzle;
      d.insert(projects).values({ id: 'proj-active', name: 'Active' }).run();
      d.insert(projectSessions).values({
        projectId: 'proj-active',
        leadId: 'lead-active',
        status: 'active',
        startedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
        // No endedAt — session is still active
      }).run();
      d.insert(decisions).values({ id: 'dec-active', agentId: 'a', agentRole: 'Dev', leadId: 'lead-active', title: 'Active decision' }).run();

      const { body } = await cleanup({ olderThanDays: 7 });

      // Active session should not be purged
      expect(body.sessionsDeleted).toBe(0);
      expect(countTable(db, 'decisions')).toBe(1);
    });
  });

  // ── Validation ─────────────────────────────────────────────────────

  describe('validation', () => {
    it('rejects missing olderThanDays', async () => {
      const res = await fetch(`${baseUrl}/data/cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('rejects negative olderThanDays', async () => {
      const { status } = await cleanup({ olderThanDays: -1 });
      expect(status).toBe(400);
    });
  });

  // ── Nullable leadId handling ──────────────────────────────────────

  describe('nullable leadId columns', () => {
    it('selective purge deletes rows with NULL leadId (decisions, agentPlans, timers)', async () => {
      const d = db.drizzle;
      const pastDate = new Date(Date.now() - 30 * 86_400_000).toISOString();

      // Set up a session so selective purge has something to work with
      d.insert(projects).values({ id: PROJECT_ID, name: 'Test' }).run();
      d.insert(projectSessions).values({
        projectId: PROJECT_ID, leadId: LEAD_ID,
        status: 'completed', startedAt: pastDate, endedAt: pastDate,
      }).run();
      d.insert(activityLog).values({
        agentId: LEAD_ID, agentRole: 'Lead', actionType: 'start',
        summary: 'Started', projectId: PROJECT_ID,
      }).run();

      // Insert rows with NULL leadId — these should still be cleaned up
      d.insert(decisions).values({ id: 'dec-null', agentId: 'agent-x', agentRole: 'Dev', title: 'Null lead decision' }).run();
      d.insert(agentPlans).values({ agentId: 'agent-x', planJson: '[]' }).run();
      d.insert(timers).values({
        id: 'timer-null', agentId: 'agent-x', agentRole: 'Dev',
        label: 'check', message: 'msg', delaySeconds: 60, fireAt: pastDate,
      }).run();

      // Also insert rows WITH leadId for comparison
      d.insert(decisions).values({ id: 'dec-lead', agentId: 'agent-y', agentRole: 'Dev', leadId: LEAD_ID, title: 'Has lead' }).run();

      expect(countTable(db, 'decisions')).toBe(2);
      expect(countTable(db, 'agent_plans')).toBe(1);
      expect(countTable(db, 'timers')).toBe(1);

      const { body } = await cleanup({ olderThanDays: 7 });

      // Both NULL and matching leadId rows should be deleted
      expect(countTable(db, 'decisions')).toBe(0);
      expect(countTable(db, 'agent_plans')).toBe(0);
      expect(countTable(db, 'timers')).toBe(0);
      expect(body.deleted.decisions).toBe(2);
      expect(body.deleted.agent_plans).toBe(1);
      expect(body.deleted.timers).toBe(1);
    });

    it('dry-run counts include NULL leadId rows', async () => {
      const d = db.drizzle;
      const pastDate = new Date(Date.now() - 30 * 86_400_000).toISOString();

      d.insert(projects).values({ id: PROJECT_ID, name: 'Test' }).run();
      d.insert(projectSessions).values({
        projectId: PROJECT_ID, leadId: LEAD_ID,
        status: 'completed', startedAt: pastDate, endedAt: pastDate,
      }).run();
      d.insert(activityLog).values({
        agentId: LEAD_ID, agentRole: 'Lead', actionType: 'start',
        summary: 'Started', projectId: PROJECT_ID,
      }).run();

      // NULL leadId rows
      d.insert(decisions).values({ id: 'dec-null', agentId: 'a', agentRole: 'Dev', title: 'Orphan' }).run();
      d.insert(timers).values({
        id: 'timer-null', agentId: 'a', agentRole: 'Dev',
        label: 'x', message: 'm', delaySeconds: 60, fireAt: pastDate,
      }).run();

      const { body } = await cleanup({ olderThanDays: 7, dryRun: true });

      expect(body.deleted.decisions).toBe(1);
      expect(body.deleted.timers).toBe(1);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('purge-all on empty database returns zero counts', async () => {
      const { status, body } = await cleanup({ olderThanDays: 0, dryRun: true });

      expect(status).toBe(200);
      expect(body.totalDeleted).toBe(0);
      expect(body.sessionsDeleted).toBe(0);

      // All table counts should be 0
      for (const count of Object.values(body.deleted)) {
        expect(count).toBe(0);
      }
    });

    it('purge-all on empty database actually runs without error', async () => {
      const { status, body } = await cleanup({ olderThanDays: 0 });

      expect(status).toBe(200);
      expect(body.dryRun).toBe(false);
      expect(body.totalDeleted).toBe(0);
    });
  });
});
