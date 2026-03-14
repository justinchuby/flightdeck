/**
 * AnalyticsService tests.
 *
 * Verifies: session listing, overview aggregation, agent/task counts,
 * comparison, and correct projectId-based agent count lookups.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../../../db/database.js';
import { AnalyticsService } from '../AnalyticsService.js';
import { projects, projectSessions, dagTasks, activityLog } from '../../../db/schema.js';
import { unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

let TEST_DB: string;

function seedTestData(db: Database) {
  // Insert projects first (FK target for project_sessions)
  db.drizzle.insert(projects).values([
    { id: 'proj-A', name: 'Project Alpha' },
    { id: 'proj-B', name: 'Project Beta' },
  ]).run();

  // Insert sessions
  db.drizzle.insert(projectSessions).values([
    { leadId: 'lead-1', projectId: 'proj-A', status: 'active', startedAt: '2026-03-07T10:00:00Z' },
    { leadId: 'lead-2', projectId: 'proj-A', status: 'completed', startedAt: '2026-03-06T10:00:00Z', endedAt: '2026-03-06T12:00:00Z' },
    { leadId: 'lead-3', projectId: 'proj-B', status: 'active', startedAt: '2026-03-05T10:00:00Z' },
  ]).run();

  // Insert dag_tasks (keyed by leadId)
  db.drizzle.insert(dagTasks).values([
    { id: 't1', leadId: 'lead-1', role: 'developer', description: 'Build feature' },
    { id: 't2', leadId: 'lead-1', role: 'reviewer', description: 'Review PR' },
    { id: 't3', leadId: 'lead-2', role: 'developer', description: 'Fix bug' },
    { id: 't4', leadId: 'lead-3', role: 'architect', description: 'Design system' },
    { id: 't5', leadId: 'lead-3', role: 'developer', description: 'Implement design' },
    { id: 't6', leadId: 'lead-3', role: 'developer', description: 'Write tests' },
  ]).run();

  // Insert activity_log (keyed by projectId, NOT leadId)
  db.drizzle.insert(activityLog).values([
    { agentId: 'agent-1', agentRole: 'developer', actionType: 'commit', summary: 'Fix bug', projectId: 'proj-A' },
    { agentId: 'agent-2', agentRole: 'reviewer', actionType: 'review', summary: 'LGTM', projectId: 'proj-A' },
    { agentId: 'agent-3', agentRole: 'architect', actionType: 'design', summary: 'Schema', projectId: 'proj-A' },
    { agentId: 'agent-4', agentRole: 'developer', actionType: 'commit', summary: 'Feature', projectId: 'proj-B' },
  ]).run();
}

describe('AnalyticsService', () => {
  let db: Database;
  let service: AnalyticsService;

  beforeEach(() => {
    TEST_DB = join(tmpdir(), `analytics-service-test-${randomUUID()}.db`);
    db = new Database(TEST_DB);
    service = new AnalyticsService(db);
    seedTestData(db);
  });

  afterEach(() => {
    if (db) db.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + '-wal'); } catch {}
    try { unlinkSync(TEST_DB + '-shm'); } catch {}
  });

  describe('getSessions', () => {
    it('returns all sessions', () => {
      const sessions = service.getSessions();
      expect(sessions).toHaveLength(3);
    });

    it('includes task counts from dag_tasks', () => {
      const sessions = service.getSessions();
      const lead1 = sessions.find(s => s.leadId === 'lead-1');
      const lead3 = sessions.find(s => s.leadId === 'lead-3');
      expect(lead1?.taskCount).toBe(2);
      expect(lead3?.taskCount).toBe(3);
    });

    it('includes agent counts from activity_log keyed by projectId', () => {
      const sessions = service.getSessions();
      // proj-A has 3 distinct agents in activity_log
      const lead1 = sessions.find(s => s.leadId === 'lead-1');
      expect(lead1?.agentCount).toBe(3);
      // lead-2 also belongs to proj-A → same 3 agents
      const lead2 = sessions.find(s => s.leadId === 'lead-2');
      expect(lead2?.agentCount).toBe(3);
      // proj-B has 1 agent
      const lead3 = sessions.find(s => s.leadId === 'lead-3');
      expect(lead3?.agentCount).toBe(1);
    });

    it('filters by projectId', () => {
      const sessions = service.getSessions('proj-B');
      expect(sessions).toHaveLength(1);
      expect(sessions[0].leadId).toBe('lead-3');
    });
  });

  describe('getOverview', () => {
    it('returns correct total session count', () => {
      const overview = service.getOverview();
      expect(overview.totalSessions).toBe(3);
    });

    it('aggregates task counts correctly', () => {
      const overview = service.getOverview();
      const totalTasks = overview.sessions.reduce((sum, s) => sum + s.taskCount, 0);
      expect(totalTasks).toBe(6); // 2 + 1 + 3
    });

    it('returns role contributions from activity_log', () => {
      const overview = service.getOverview();
      expect(overview.roleContributions.length).toBeGreaterThan(0);
      const devRole = overview.roleContributions.find(r => r.role === 'developer');
      expect(devRole).toBeDefined();
      expect(devRole!.taskCount).toBe(2); // 2 developer actions
    });

    it('matches agent counts by projectId not leadId', () => {
      const overview = service.getOverview();
      // All proj-A sessions should have 3 agents
      const projASessions = overview.sessions.filter(s => s.projectId === 'proj-A');
      for (const s of projASessions) {
        expect(s.agentCount).toBe(3);
      }
    });
  });

  describe('compare', () => {
    it('compares two sessions', () => {
      const result = service.compare(['lead-1', 'lead-3']);
      expect(result.sessions).toHaveLength(2);
      expect(result.deltas).not.toBeNull();
    });

    it('includes correct task counts in comparison', () => {
      const result = service.compare(['lead-1', 'lead-3']);
      const s1 = result.sessions.find(s => s.leadId === 'lead-1');
      const s3 = result.sessions.find(s => s.leadId === 'lead-3');
      expect(s1?.taskCount).toBe(2);
      expect(s3?.taskCount).toBe(3);
    });

    it('includes correct agent counts in comparison', () => {
      const result = service.compare(['lead-1', 'lead-3']);
      const s1 = result.sessions.find(s => s.leadId === 'lead-1');
      const s3 = result.sessions.find(s => s.leadId === 'lead-3');
      expect(s1?.agentCount).toBe(3); // proj-A has 3 agents
      expect(s3?.agentCount).toBe(1); // proj-B has 1 agent
    });

    it('computes deltas correctly', () => {
      const result = service.compare(['lead-1', 'lead-3']);
      expect(result.deltas?.agentCountDelta).toBe(1 - 3); // -2
    });
  });
});
