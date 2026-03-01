import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '../db/database.js';
import { ProjectRegistry } from '../projects/ProjectRegistry.js';

describe('ProjectRegistry', () => {
  let db: Database;
  let registry: ProjectRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    registry = new ProjectRegistry(db);
  });

  describe('create', () => {
    it('creates a project with default values', () => {
      const project = registry.create('Test Project');
      expect(project.id).toBeTruthy();
      expect(project.name).toBe('Test Project');
      expect(project.description).toBe('');
      expect(project.status).toBe('active');
    });

    it('creates a project with description and cwd', () => {
      const project = registry.create('My Project', 'Build a thing', '/home/user/code');
      expect(project.description).toBe('Build a thing');
      expect(project.cwd).toBe('/home/user/code');
    });
  });

  describe('get', () => {
    it('returns the project by ID', () => {
      const created = registry.create('Lookup Test');
      const found = registry.get(created.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Lookup Test');
    });

    it('returns undefined for unknown ID', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('list', () => {
    it('lists all projects', () => {
      registry.create('First');
      registry.create('Second');
      const all = registry.list();
      expect(all).toHaveLength(2);
      const names = all.map(p => p.name).sort();
      expect(names).toEqual(['First', 'Second']);
    });

    it('filters by status', () => {
      const p1 = registry.create('Active');
      const p2 = registry.create('Archived');
      registry.update(p2.id, { status: 'archived' });

      expect(registry.list('active')).toHaveLength(1);
      expect(registry.list('active')[0].name).toBe('Active');
      expect(registry.list('archived')).toHaveLength(1);
      expect(registry.list('archived')[0].name).toBe('Archived');
    });
  });

  describe('update', () => {
    it('updates project fields', () => {
      const project = registry.create('Original');
      registry.update(project.id, { name: 'Renamed', description: 'Updated desc' });
      const updated = registry.get(project.id);
      expect(updated!.name).toBe('Renamed');
      expect(updated!.description).toBe('Updated desc');
    });
  });

  describe('sessions', () => {
    it('starts and ends a session', () => {
      const project = registry.create('Session Test');
      registry.startSession(project.id, 'lead-1', 'Do something');

      const sessions = registry.getSessions(project.id);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].leadId).toBe('lead-1');
      expect(sessions[0].status).toBe('active');

      registry.endSession('lead-1', 'completed');
      const ended = registry.getSessions(project.id);
      expect(ended[0].status).toBe('completed');
      expect(ended[0].endedAt).toBeTruthy();
    });

    it('tracks session ID', () => {
      const project = registry.create('SessionId Test');
      registry.startSession(project.id, 'lead-2');
      registry.setSessionId('lead-2', 'copilot-session-abc');

      const sessions = registry.getSessions(project.id);
      expect(sessions[0].sessionId).toBe('copilot-session-abc');
    });

    it('finds project by lead ID', () => {
      const project = registry.create('Find Test');
      registry.startSession(project.id, 'lead-3');

      const found = registry.findProjectByLeadId('lead-3');
      expect(found).toBeDefined();
      expect(found!.id).toBe(project.id);
    });

    it('returns undefined for unknown lead ID', () => {
      expect(registry.findProjectByLeadId('unknown')).toBeUndefined();
    });

    it('gets active lead ID', () => {
      const project = registry.create('Active Lead Test');
      registry.startSession(project.id, 'lead-4');
      expect(registry.getActiveLeadId(project.id)).toBe('lead-4');

      registry.endSession('lead-4');
      expect(registry.getActiveLeadId(project.id)).toBeUndefined();
    });
  });

  describe('buildBriefing', () => {
    it('returns undefined for unknown project', () => {
      expect(registry.buildBriefing('nonexistent')).toBeUndefined();
    });

    it('builds a briefing with session history', () => {
      const project = registry.create('Briefing Test', 'Test description', '/tmp');
      registry.startSession(project.id, 'lead-a', 'First task');
      registry.endSession('lead-a', 'completed');
      registry.startSession(project.id, 'lead-b', 'Second task');
      registry.endSession('lead-b', 'completed');

      const briefing = registry.buildBriefing(project.id);
      expect(briefing).toBeDefined();
      expect(briefing!.project.name).toBe('Briefing Test');
      expect(briefing!.sessions).toHaveLength(2);
      expect(briefing!.taskSummary.total).toBe(0); // No DAG tasks created
    });

    it('formats briefing as readable text', () => {
      const project = registry.create('Format Test', 'A test project');
      registry.startSession(project.id, 'lead-x');
      registry.endSession('lead-x');

      const briefing = registry.buildBriefing(project.id)!;
      const text = registry.formatBriefing(briefing);
      expect(text).toContain('# Project Briefing: Format Test');
      expect(text).toContain('**Description:** A test project');
      expect(text).toContain('1 prior session(s)');
    });
  });

  describe('getResumableSessions', () => {
    it('returns empty when no sessions exist', () => {
      expect(registry.getResumableSessions()).toEqual([]);
    });

    it('excludes active sessions', () => {
      const project = registry.create('Active Test');
      registry.startSession(project.id, 'lead-r1', 'Some task');
      registry.setSessionId('lead-r1', 'copilot-session-1');
      // Session is still active → not resumable
      expect(registry.getResumableSessions()).toEqual([]);
    });

    it('excludes sessions without a Copilot sessionId', () => {
      const project = registry.create('No SessionId');
      registry.startSession(project.id, 'lead-r2', 'Some task');
      registry.endSession('lead-r2', 'completed');
      // Session ended but has no sessionId → not resumable
      expect(registry.getResumableSessions()).toEqual([]);
    });

    it('returns completed sessions with sessionId', () => {
      const project = registry.create('Resumable Test');
      registry.startSession(project.id, 'lead-r3', 'Build feature X');
      registry.setSessionId('lead-r3', 'copilot-session-abc');
      registry.endSession('lead-r3', 'completed');

      const resumable = registry.getResumableSessions();
      expect(resumable).toHaveLength(1);
      expect(resumable[0].sessionId).toBe('copilot-session-abc');
      expect(resumable[0].task).toBe('Build feature X');
      expect(resumable[0].status).toBe('completed');
      expect(resumable[0].projectName).toBe('Resumable Test');
    });

    it('returns crashed sessions with sessionId', () => {
      const project = registry.create('Crashed Test');
      registry.startSession(project.id, 'lead-r4', 'Risky task');
      registry.setSessionId('lead-r4', 'copilot-session-def');
      registry.endSession('lead-r4', 'crashed');

      const resumable = registry.getResumableSessions();
      expect(resumable).toHaveLength(1);
      expect(resumable[0].status).toBe('crashed');
    });

    it('orders by most recent first', () => {
      const project = registry.create('Order Test');
      registry.startSession(project.id, 'lead-r5', 'First');
      registry.setSessionId('lead-r5', 'session-1');
      registry.endSession('lead-r5', 'completed');

      registry.startSession(project.id, 'lead-r6', 'Second');
      registry.setSessionId('lead-r6', 'session-2');
      registry.endSession('lead-r6', 'completed');

      const resumable = registry.getResumableSessions();
      expect(resumable).toHaveLength(2);
      const ids = resumable.map((s) => s.sessionId);
      expect(ids).toContain('session-1');
      expect(ids).toContain('session-2');
    });
  });

  describe('getSessionById', () => {
    it('returns a session by row ID', () => {
      const project = registry.create('Row ID Test');
      registry.startSession(project.id, 'lead-s1', 'Find me');
      const sessions = registry.getSessions(project.id);
      expect(sessions).toHaveLength(1);

      const found = registry.getSessionById(sessions[0].id);
      expect(found).toBeDefined();
      expect(found!.leadId).toBe('lead-s1');
      expect(found!.task).toBe('Find me');
    });

    it('returns undefined for unknown row ID', () => {
      expect(registry.getSessionById(999)).toBeUndefined();
    });
  });
});
