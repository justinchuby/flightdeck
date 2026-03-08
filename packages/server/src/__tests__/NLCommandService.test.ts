import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NLCommandService } from '../coordination/commands/NLCommandService.js';

// ── Mocks ─────────────────────────────────────────────────────────

function createMockAgentManager() {
  const agents = [
    { id: 'agent-1', role: { id: 'developer', name: 'Developer' }, status: 'running' },
    { id: 'agent-2', role: { id: 'architect', name: 'Architect' }, status: 'running' },
    { id: 'agent-3', role: { id: 'developer', name: 'Developer' }, status: 'idle' },
  ];
  return {
    getAll: vi.fn(() => agents),
    get: vi.fn((id: string) => agents.find(a => a.id === id) || null),
    pauseSystem: vi.fn(),
    resumeSystem: vi.fn(),
  };
}

function createMockDecisionLog() {
  return {
    getNeedingConfirmation: vi.fn(() => [
      { id: 'd1', title: 'Style choice', agentId: 'agent-1', timestamp: new Date().toISOString() },
      { id: 'd2', title: 'Dependency update', agentId: 'agent-2', timestamp: new Date().toISOString() },
    ]),
    confirmBatch: vi.fn((ids: string[]) => ({ updated: ids.length, skipped: 0 })),
    rejectBatch: vi.fn((ids: string[]) => ({ updated: ids.length, skipped: 0 })),
  };
}

function createMockActivityLedger() {
  return {
    getSince: vi.fn(() => []),
    getRecent: vi.fn(() => []),
  };
}

function createService() {
  const agentManager = createMockAgentManager();
  const decisionLog = createMockDecisionLog();
  const activityLedger = createMockActivityLedger();
  const service = new NLCommandService(
    agentManager as any,
    decisionLog as any,
    activityLedger as any,
  );
  return { service, agentManager, decisionLog, activityLedger };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('NLCommandService', () => {
  describe('getPatterns', () => {
    it('returns 30 command patterns', () => {
      const { service } = createService();
      expect(service.getPatterns()).toHaveLength(30);
    });

    it('covers all 4 categories', () => {
      const { service } = createService();
      const categories = new Set(service.getPatterns().map(p => p.category));
      expect(categories).toEqual(new Set(['control', 'query', 'navigate', 'create']));
    });
  });

  describe('match', () => {
    it('matches exact phrases', () => {
      const { service } = createService();
      const result = service.match('pause everything');
      expect(result).not.toBeNull();
      expect(result!.pattern.id).toBe('pause-all');
    });

    it('matches case-insensitively', () => {
      const { service } = createService();
      const result = service.match('Pause Everything');
      expect(result).not.toBeNull();
      expect(result!.pattern.id).toBe('pause-all');
    });

    it('extracts entity from starts-with match', () => {
      const { service } = createService();
      const result = service.match('restart the architect');
      expect(result).not.toBeNull();
      expect(result!.pattern.id).toBe('restart-agent');
      expect(result!.entity).toBe('the architect');
    });

    it('matches via keyword overlap', () => {
      const { service } = createService();
      // "pause all now" → 2/3 words overlap = 67% >= 60%
      const result = service.match('pause all now');
      expect(result).not.toBeNull();
    });

    it('returns null for no match', () => {
      const { service } = createService();
      expect(service.match('hello world how are you today')).toBeNull();
    });

    it('returns null for empty string', () => {
      const { service } = createService();
      expect(service.match('')).toBeNull();
    });
  });

  describe('preview', () => {
    it('returns action plan without executing', () => {
      const { service, agentManager } = createService();
      const plan = service.preview('pause everything', 'lead-1');
      expect(plan).not.toBeNull();
      expect(plan!.patternId).toBe('pause-all');
      expect(plan!.steps).toHaveLength(1);
      expect(plan!.steps[0].action).toBe('pause_system');
      // Verify nothing was actually executed
      expect(agentManager.pauseSystem).not.toHaveBeenCalled();
    });

    it('returns null for unmatched commands', () => {
      const { service } = createService();
      expect(service.preview('this is nonsense', 'lead-1')).toBeNull();
    });

    it('builds plan for approve all with pending count', () => {
      const { service } = createService();
      const plan = service.preview('approve everything', 'lead-1');
      expect(plan).not.toBeNull();
      expect(plan!.summary).toContain('2');
    });
  });

  describe('execute', () => {
    it('executes pause_system', () => {
      const { service, agentManager } = createService();
      const result = service.execute('pause everything', 'lead-1');
      expect(result).not.toBeNull();
      expect(result!.executed).toBe(true);
      expect(agentManager.pauseSystem).toHaveBeenCalled();
    });

    it('executes resume_system', () => {
      const { service, agentManager } = createService();
      const result = service.execute('resume', 'lead-1');
      expect(result).not.toBeNull();
      expect(result!.executed).toBe(true);
      expect(agentManager.resumeSystem).toHaveBeenCalled();
    });

    it('executes batch approve', () => {
      const { service, decisionLog } = createService();
      const result = service.execute('approve all', 'lead-1');
      expect(result).not.toBeNull();
      expect(result!.executed).toBe(true);
      expect(decisionLog.confirmBatch).toHaveBeenCalledWith(['d1', 'd2']);
    });

    it('executes batch reject', () => {
      const { service, decisionLog } = createService();
      const result = service.execute('reject all pending', 'lead-1');
      expect(result).not.toBeNull();
      expect(result!.executed).toBe(true);
      expect(decisionLog.rejectBatch).toHaveBeenCalledWith(['d1', 'd2']);
    });

    it('returns null for unmatched commands', () => {
      const { service } = createService();
      expect(service.execute('please juggle some balls', 'lead-1')).toBeNull();
    });

    it('wraps up all agents', () => {
      const { service } = createService();
      const result = service.execute('wrap it up', 'lead-1');
      expect(result).not.toBeNull();
      expect(result!.plan.steps).toHaveLength(3); // 3 agents
      expect(result!.plan.steps.every(s => s.action === 'wrap_up')).toBe(true);
    });

    it('handles navigate commands', () => {
      const { service } = createService();
      const result = service.execute('open canvas', 'lead-1');
      expect(result).not.toBeNull();
      expect(result!.plan.steps[0].action).toBe('navigate');
      expect(result!.plan.steps[0].target).toBe('/canvas');
    });

    it('handles query commands', () => {
      const { service } = createService();
      const result = service.execute('status', 'lead-1');
      expect(result).not.toBeNull();
      expect(result!.plan.steps[0].action).toBe('query_status');
    });
  });

  describe('undo', () => {
    it('undoes a reversible command', () => {
      const { service, agentManager } = createService();
      const result = service.execute('pause everything', 'lead-1')!;
      const commandId = result.plan.commandId;

      const undoResult = service.undo(commandId);
      expect(undoResult.status).toBe('ok');
      expect(agentManager.resumeSystem).toHaveBeenCalled();
    });

    it('returns not_found for unknown commandId', () => {
      const { service } = createService();
      expect(service.undo('nonexistent')).toEqual({ status: 'not_found' });
    });

    it('returns expired for old commands', () => {
      const { service } = createService();
      const result = service.execute('pause everything', 'lead-1')!;
      const commandId = result.plan.commandId;

      // Fast-forward time past TTL
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 400_000); // > 5 min

      const undoResult = service.undo(commandId);
      expect(undoResult.status).toBe('expired');

      vi.restoreAllMocks();
    });

    it('does not push undo for non-reversible commands', () => {
      const { service } = createService();
      const result = service.execute('restart the architect', 'lead-1')!;
      expect(result.plan.reversible).toBe(false);
      const undoResult = service.undo(result.plan.commandId);
      expect(undoResult.status).toBe('not_found');
    });
  });

  describe('entity extraction', () => {
    it('extracts role from pause-except', () => {
      const { service } = createService();
      const plan = service.preview('pause everyone except architect', 'lead-1');
      expect(plan).not.toBeNull();
      expect(plan!.patternId).toBe('pause-except');
      // Should pause all agents except architect (2 non-architect agents)
      expect(plan!.steps.length).toBe(2);
    });

    it('extracts topic from focus command', () => {
      const { service } = createService();
      const plan = service.preview('focus on authentication', 'lead-1');
      expect(plan).not.toBeNull();
      expect(plan!.patternId).toBe('focus-topic');
      expect(plan!.steps[0].params?.topic).toBe('authentication');
    });
  });

  describe('getSuggestions', () => {
    it('suggests reviewing pending decisions', () => {
      const { service } = createService();
      const suggestions = service.getSuggestions('lead-1');
      const reviewSuggestion = suggestions.find(s => s.id === 'suggest-review-decisions');
      expect(reviewSuggestion).toBeDefined();
      expect(reviewSuggestion!.label).toContain('2');
      expect(reviewSuggestion!.score).toBe(0.9);
    });

    it('returns empty suggestions when nothing to suggest', () => {
      const { service, decisionLog } = createService();
      decisionLog.getNeedingConfirmation.mockReturnValue([]);
      const suggestions = service.getSuggestions('lead-1');
      // May have idle agent suggestion but no decision suggestion
      expect(suggestions.find(s => s.id === 'suggest-review-decisions')).toBeUndefined();
    });

    it('suggests idle agent reassignment', () => {
      const { service } = createService();
      const suggestions = service.getSuggestions('lead-1');
      // Only 1 idle agent (agent-3), need >= 2 for suggestion → not present
      expect(suggestions.find(s => s.id === 'suggest-idle-agents')).toBeUndefined();
    });

    it('caps at 5 suggestions sorted by score', () => {
      const { service } = createService();
      const suggestions = service.getSuggestions('lead-1');
      expect(suggestions.length).toBeLessThanOrEqual(5);
      for (let i = 1; i < suggestions.length; i++) {
        expect(suggestions[i - 1].score).toBeGreaterThanOrEqual(suggestions[i].score);
      }
    });
  });
});
