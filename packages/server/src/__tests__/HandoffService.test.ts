import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HandoffService, type HandoffRecord } from '../coordination/HandoffService.js';
import { Database } from '../db/database.js';
import { FileLockRegistry } from '../coordination/FileLockRegistry.js';
import { DecisionLog } from '../coordination/DecisionLog.js';

describe('HandoffService', () => {
  let db: Database;
  let lockRegistry: FileLockRegistry;
  let decisionLog: DecisionLog;
  let service: HandoffService;

  beforeEach(() => {
    db = new Database(':memory:');
    lockRegistry = new FileLockRegistry(db);
    decisionLog = new DecisionLog(db);
    service = new HandoffService(db, lockRegistry, decisionLog);
  });

  describe('generate briefing', () => {
    it('generates a handoff briefing for manual termination', () => {
      const record = service.generateBriefing({
        agentId: 'agent-1',
        agentRole: 'Developer',
        trigger: 'manual_termination',
        currentTask: { id: 'task-1', title: 'Build API', progress: '60%' },
        contextUsage: 85,
      });
      expect(record.id).toMatch(/^handoff-/);
      expect(record.trigger).toBe('manual_termination');
      expect(record.status).toBe('draft');
      expect(record.briefing.narrative).toContain('Build API');
      expect(record.briefing.narrative).toContain('85%');
      expect(record.qualityScore).not.toBeNull();
    });

    it('generates briefing for model swap', () => {
      const record = service.generateBriefing({
        agentId: 'agent-1',
        agentRole: 'Architect',
        agentModel: 'claude-sonnet',
        trigger: 'model_swap',
        lastMessages: [
          { role: 'user', content: 'Design the API' },
          { role: 'assistant', content: 'Working on it...' },
        ],
        discoveries: ['Pagination needs cursor-based approach'],
      });
      expect(record.sourceModel).toBe('claude-sonnet');
      expect(record.briefing.lastMessages).toHaveLength(2);
      expect(record.briefing.discoveries).toContain('Pagination needs cursor-based approach');
    });

    it('includes file locks in briefing', () => {
      lockRegistry.acquire('agent-1', 'Developer', 'src/api.ts');
      lockRegistry.acquire('agent-1', 'Developer', 'src/api.test.ts');
      const record = service.generateBriefing({
        agentId: 'agent-1',
        agentRole: 'Developer',
        trigger: 'context_compaction',
      });
      expect(record.briefing.uncommittedChanges).toHaveLength(2);
      expect(record.briefing.narrative).toContain('2 file(s)');
    });

    it('respects section toggles', () => {
      const record = service.generateBriefing({
        agentId: 'agent-1',
        agentRole: 'Dev',
        trigger: 'manual_termination',
        lastMessages: [{ role: 'user', content: 'test' }],
        discoveries: ['finding 1'],
        sections: { lastMessages: false, discoveries: false },
      });
      expect(record.briefing.lastMessages).toEqual([]);
      expect(record.briefing.discoveries).toEqual([]);
    });

    it('includes active intent rules', () => {
      decisionLog.addIntentRule('style', 'manual', {
        name: 'Allow style from devs',
        enabled: true,
      });
      const record = service.generateBriefing({
        agentId: 'a',
        agentRole: 'Dev',
        trigger: 'crash',
      });
      expect(record.briefing.activeIntentRules).toContain('Allow style from devs');
    });
  });

  describe('quality scoring', () => {
    it('scores higher with more information', () => {
      lockRegistry.acquire('agent-1', 'Dev', 'src/api.ts');
      const rich = service.generateBriefing({
        agentId: 'agent-1',
        agentRole: 'Dev',
        trigger: 'manual_termination',
        currentTask: { id: 't', title: 'Build API', progress: '80%' },
        lastMessages: Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: `msg ${i}` })),
        discoveries: ['d1', 'd2', 'd3'],
      });

      const sparse = service.generateBriefing({
        agentId: 'agent-2',
        agentRole: 'Dev',
        trigger: 'manual_termination',
      });

      expect(rich.qualityScore!).toBeGreaterThan(sparse.qualityScore!);
    });

    it('getQuality returns factor breakdown', () => {
      const record = service.generateBriefing({
        agentId: 'a',
        agentRole: 'Dev',
        trigger: 'crash',
        discoveries: ['d1', 'd2', 'd3'],
      });
      const quality = service.getQuality(record.id);
      expect(quality).not.toBeNull();
      expect(quality!.factors).toHaveLength(4);
      expect(quality!.factors.map(f => f.name)).toContain('task_coverage');
      expect(quality!.factors.map(f => f.name)).toContain('discovery_count');
    });
  });

  describe('edit and deliver', () => {
    it('updates briefing narrative', () => {
      const record = service.generateBriefing({ agentId: 'a', agentRole: 'Dev', trigger: 'crash' });
      const updated = service.updateBriefing(record.id, 'Custom edited briefing');
      expect(updated!.briefing.narrative).toBe('Custom edited briefing');
      expect(updated!.status).toBe('reviewed');
      expect(updated!.reviewedBy).toBe('user');
      expect(updated!.userEdits).not.toBeNull();
    });

    it('delivers briefing to target agent', () => {
      const record = service.generateBriefing({ agentId: 'a', agentRole: 'Dev', trigger: 'model_swap' });
      const delivered = service.deliver(record.id, 'agent-new');
      expect(delivered!.status).toBe('delivered');
      expect(delivered!.targetAgentId).toBe('agent-new');
      expect(delivered!.deliveredAt).not.toBeNull();
    });

    it('cannot edit a delivered briefing', () => {
      const record = service.generateBriefing({ agentId: 'a', agentRole: 'Dev', trigger: 'crash' });
      service.deliver(record.id);
      expect(service.updateBriefing(record.id, 'too late')).toBeNull();
    });

    it('cannot deliver twice', () => {
      const record = service.generateBriefing({ agentId: 'a', agentRole: 'Dev', trigger: 'crash' });
      service.deliver(record.id);
      expect(service.deliver(record.id)).toBeNull();
    });
  });

  describe('archive session', () => {
    it('archives briefings for multiple agents', () => {
      const records = service.archiveSession([
        { agentId: 'a1', agentRole: 'Lead' },
        { agentId: 'a2', agentRole: 'Developer', discoveries: ['d1'] },
        { agentId: 'a3', agentRole: 'Architect' },
      ], 'session-1');

      expect(records).toHaveLength(3);
      for (const r of records) {
        expect(r.trigger).toBe('session_end');
        expect(r.status).toBe('archived');
        expect(r.sessionId).toBe('session-1');
      }
    });
  });

  describe('events', () => {
    it('emits handoff:started and handoff:generated', () => {
      const started = vi.fn();
      const generated = vi.fn();
      service.on('handoff:started', started);
      service.on('handoff:generated', generated);

      service.generateBriefing({ agentId: 'a', agentRole: 'Dev', trigger: 'crash' });

      expect(started).toHaveBeenCalledTimes(1);
      expect(generated).toHaveBeenCalledTimes(1);
      expect(generated).toHaveBeenCalledWith(expect.objectContaining({ qualityScore: expect.any(Number) }));
    });

    it('emits handoff:delivered on delivery', () => {
      const handler = vi.fn();
      service.on('handoff:delivered', handler);
      const record = service.generateBriefing({ agentId: 'a', agentRole: 'Dev', trigger: 'crash' });
      service.deliver(record.id, 'b');
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ targetAgentId: 'b' }));
    });
  });

  describe('persistence', () => {
    it('persists records across instances', () => {
      service.generateBriefing({ agentId: 'a', agentRole: 'Dev', trigger: 'crash' });
      const service2 = new HandoffService(db, lockRegistry, decisionLog);
      expect(service2.getAll()).toHaveLength(1);
    });
  });
});
