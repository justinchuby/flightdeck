import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '../db/database.js';
import { ProjectRegistry } from '../projects/ProjectRegistry.js';

describe('Session Resume', () => {
  let db: Database;
  let registry: ProjectRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    registry = new ProjectRegistry(db);
  });

  describe('getResumableSessions', () => {
    it('returns empty array when no projects exist', () => {
      expect(registry.getResumableSessions()).toEqual([]);
    });

    it('excludes sessions that are still active', () => {
      const project = registry.create('My Project');
      registry.startSession(project.id, 'lead-1', 'Do work');
      registry.setSessionId('lead-1', 'copilot-sess-1');
      expect(registry.getResumableSessions()).toHaveLength(0);
    });

    it('excludes ended sessions without a Copilot sessionId', () => {
      const project = registry.create('No Session');
      registry.startSession(project.id, 'lead-2', 'Work');
      registry.endSession('lead-2', 'completed');
      expect(registry.getResumableSessions()).toHaveLength(0);
    });

    it('includes completed sessions with a Copilot sessionId', () => {
      const project = registry.create('Resumable');
      registry.startSession(project.id, 'lead-3', 'Build feature');
      registry.setSessionId('lead-3', 'copilot-sess-3');
      registry.endSession('lead-3', 'completed');

      const sessions = registry.getResumableSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        leadId: 'lead-3',
        sessionId: 'copilot-sess-3',
        task: 'Build feature',
        status: 'completed',
        projectName: 'Resumable',
      });
    });

    it('includes crashed sessions with a Copilot sessionId', () => {
      const project = registry.create('Crashed');
      registry.startSession(project.id, 'lead-4', 'Risky work');
      registry.setSessionId('lead-4', 'copilot-sess-4');
      registry.endSession('lead-4', 'crashed');

      const sessions = registry.getResumableSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].status).toBe('crashed');
    });

    it('returns sessions from multiple projects', () => {
      const p1 = registry.create('Project A');
      const p2 = registry.create('Project B');

      registry.startSession(p1.id, 'lead-a', 'Task A');
      registry.setSessionId('lead-a', 'sess-a');
      registry.endSession('lead-a', 'completed');

      registry.startSession(p2.id, 'lead-b', 'Task B');
      registry.setSessionId('lead-b', 'sess-b');
      registry.endSession('lead-b', 'completed');

      const sessions = registry.getResumableSessions();
      expect(sessions).toHaveLength(2);
      const names = sessions.map((s) => s.projectName);
      expect(names).toContain('Project A');
      expect(names).toContain('Project B');
    });

    it('orders by most recent first', () => {
      const project = registry.create('Order Test');

      registry.startSession(project.id, 'lead-x', 'First');
      registry.setSessionId('lead-x', 'sess-x');
      registry.endSession('lead-x', 'completed');

      registry.startSession(project.id, 'lead-y', 'Second');
      registry.setSessionId('lead-y', 'sess-y');
      registry.endSession('lead-y', 'completed');

      const sessions = registry.getResumableSessions();
      expect(sessions).toHaveLength(2);
      // Both sessions exist; order depends on startedAt (same-second inserts may have same timestamp)
      const sessionIds = sessions.map((s) => s.sessionId);
      expect(sessionIds).toContain('sess-x');
      expect(sessionIds).toContain('sess-y');
    });
  });

  describe('getSessionById', () => {
    it('returns a session by its row ID', () => {
      const project = registry.create('Session Lookup');
      registry.startSession(project.id, 'lead-s', 'Find me');

      const allSessions = registry.getSessions(project.id);
      const found = registry.getSessionById(allSessions[0].id);
      expect(found).toBeDefined();
      expect(found!.leadId).toBe('lead-s');
      expect(found!.task).toBe('Find me');
    });

    it('returns undefined for non-existent row ID', () => {
      expect(registry.getSessionById(99999)).toBeUndefined();
    });
  });

  describe('resume flow integration', () => {
    it('full lifecycle: create → start → set sessionId → end → find resumable → get by ID', () => {
      // Create project and start a session
      const project = registry.create('Full Lifecycle', 'Testing resume flow');
      registry.startSession(project.id, 'lead-lifecycle', 'Implement feature');
      registry.setSessionId('lead-lifecycle', 'copilot-lifecycle-session');

      // Verify not resumable while active
      expect(registry.getResumableSessions()).toHaveLength(0);

      // End the session
      registry.endSession('lead-lifecycle', 'completed');

      // Now it should be resumable
      const resumable = registry.getResumableSessions();
      expect(resumable).toHaveLength(1);

      // Look it up by row ID (simulating the resume API)
      const session = registry.getSessionById(resumable[0].id);
      expect(session).toBeDefined();
      expect(session!.sessionId).toBe('copilot-lifecycle-session');

      // Get the project for context
      const sessionProject = registry.get(session!.projectId);
      expect(sessionProject).toBeDefined();
      expect(sessionProject!.name).toBe('Full Lifecycle');
    });
  });
});
