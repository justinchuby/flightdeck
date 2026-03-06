import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsService } from '../coordination/AnalyticsService.js';
import { Database } from '../db/database.js';

describe('AnalyticsService', () => {
  let db: Database;
  let service: AnalyticsService;

  beforeEach(() => {
    db = new Database(':memory:');
    service = new AnalyticsService(db);
  });

  it('returns empty overview with no data', () => {
    const overview = service.getOverview();
    expect(overview.totalSessions).toBe(0);
    expect(overview.sessions).toEqual([]);
    expect(overview.roleContributions).toEqual([]);
  });

  it('getOverview returns session summaries from project_sessions', () => {
    db.run(`INSERT INTO projects (id, name, created_at) VALUES ('proj-1', 'Test', datetime('now'))`);
    db.run(`INSERT INTO project_sessions (project_id, lead_id, status, started_at) VALUES ('proj-1', 'lead-1', 'completed', datetime('now'))`);

    const overview = service.getOverview();
    expect(overview.totalSessions).toBe(1);
    expect(overview.sessions[0].leadId).toBe('lead-1');
    expect(overview.sessions[0].status).toBe('completed');
  });

  it('getOverview filters by projectId', () => {
    db.run(`INSERT INTO projects (id, name, created_at) VALUES ('proj-1', 'Test1', datetime('now'))`);
    db.run(`INSERT INTO projects (id, name, created_at) VALUES ('proj-2', 'Test2', datetime('now'))`);
    db.run(`INSERT INTO project_sessions (project_id, lead_id, status, started_at) VALUES ('proj-1', 'lead-1', 'completed', datetime('now'))`);
    db.run(`INSERT INTO project_sessions (project_id, lead_id, status, started_at) VALUES ('proj-2', 'lead-2', 'active', datetime('now'))`);

    expect(service.getOverview('proj-1').totalSessions).toBe(1);
    expect(service.getOverview('proj-2').totalSessions).toBe(1);
    expect(service.getOverview().totalSessions).toBe(2);
  });

  it('compare returns deltas between two sessions', () => {
    db.run(`INSERT INTO projects (id, name, created_at) VALUES ('proj-1', 'Test', datetime('now'))`);
    db.run(`INSERT INTO project_sessions (project_id, lead_id, status, started_at) VALUES ('proj-1', 'lead-1', 'completed', datetime('now'))`);
    db.run(`INSERT INTO project_sessions (project_id, lead_id, status, started_at) VALUES ('proj-1', 'lead-2', 'completed', datetime('now'))`);

    const comparison = service.compare(['lead-1', 'lead-2']);
    expect(comparison.sessions).toHaveLength(2);
    expect(comparison.deltas).not.toBeNull();
    expect(comparison.deltas!.tokenDelta).toBe(0);
  });

  it('compare returns null deltas for 3+ sessions', () => {
    const comparison = service.compare(['lead-1', 'lead-2', 'lead-3']);
    expect(comparison.sessions).toHaveLength(3);
    expect(comparison.deltas).toBeNull();
  });

  describe('getSessions', () => {
    it('returns empty list with no data', () => {
      const sessions = service.getSessions();
      expect(sessions).toEqual([]);
    });

    it('returns sessions with summary data', () => {
      db.run(`INSERT INTO projects (id, name, created_at) VALUES ('proj-1', 'Test', datetime('now'))`);
      db.run(`INSERT INTO project_sessions (project_id, lead_id, status, started_at, ended_at) VALUES ('proj-1', 'lead-1', 'completed', '2025-01-01T10:00:00Z', '2025-01-01T11:30:00Z')`);

      const sessions = service.getSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('lead-1');
      expect(sessions[0].leadId).toBe('lead-1');
      expect(sessions[0].status).toBe('completed');
      expect(sessions[0].durationMs).toBe(90 * 60 * 1000); // 1.5 hours
      expect(sessions[0].taskCount).toBe(0);
      expect(sessions[0].agentCount).toBe(0);
    });

    it('returns null durationMs for active sessions', () => {
      db.run(`INSERT INTO projects (id, name, created_at) VALUES ('proj-1', 'Test', datetime('now'))`);
      db.run(`INSERT INTO project_sessions (project_id, lead_id, status, started_at) VALUES ('proj-1', 'lead-1', 'active', '2025-01-01T10:00:00Z')`);

      const sessions = service.getSessions();
      expect(sessions[0].durationMs).toBeNull();
    });

    it('filters by projectId', () => {
      db.run(`INSERT INTO projects (id, name, created_at) VALUES ('proj-1', 'P1', datetime('now'))`);
      db.run(`INSERT INTO projects (id, name, created_at) VALUES ('proj-2', 'P2', datetime('now'))`);
      db.run(`INSERT INTO project_sessions (project_id, lead_id, status, started_at) VALUES ('proj-1', 'lead-1', 'completed', datetime('now'))`);
      db.run(`INSERT INTO project_sessions (project_id, lead_id, status, started_at) VALUES ('proj-2', 'lead-2', 'active', datetime('now'))`);

      expect(service.getSessions('proj-1')).toHaveLength(1);
      expect(service.getSessions('proj-2')).toHaveLength(1);
      expect(service.getSessions()).toHaveLength(2);
    });
  });
});
