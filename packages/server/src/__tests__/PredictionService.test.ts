import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PredictionService,
  type AgentSnapshot,
  type BudgetSnapshot,
  type PredictionConfig,
} from '../coordination/predictions/PredictionService.js';

// ── Mock Database ─────────────────────────────────────────────────

function createMockDb() {
  const settings = new Map<string, string>();
  return {
    getSetting: vi.fn((key: string) => settings.get(key) ?? undefined),
    setSetting: vi.fn((key: string, val: string) => { settings.set(key, val); }),
    drizzle: {} as any,
    raw: {} as any,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: 'agent-001',
    role: 'developer',
    status: 'running',
    contextWindowUsed: 50_000,
    contextWindowSize: 200_000,
    contextBurnRate: 0,
    estimatedExhaustionMinutes: null,
    lastActivityAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeBudget(overrides: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    currentSpend: 0,
    limit: null,
    utilization: 0,
    burnRatePerMinute: 0,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('PredictionService', () => {
  let db: ReturnType<typeof createMockDb>;
  let service: PredictionService;

  beforeEach(() => {
    db = createMockDb();
    service = new PredictionService(db as any);
  });

  // ── Core API ────────────────────────────────────────────────

  describe('getActive / getHistory', () => {
    it('starts with no predictions', () => {
      expect(service.getActive()).toEqual([]);
      expect(service.getHistory()).toEqual([]);
    });
  });

  describe('getAccuracy', () => {
    it('returns zero stats when no predictions', () => {
      const stats = service.getAccuracy();
      expect(stats.total).toBe(0);
      expect(stats.accuracy).toBe(0);
    });

    it('computes accuracy from resolved predictions', () => {
      // Generate some predictions
      const agent = makeAgent({
        contextBurnRate: 10_000,
        contextWindowUsed: 180_000,
        contextWindowSize: 200_000,
      });
      service.generatePredictions([agent]);

      const active = service.getActive();
      expect(active.length).toBeGreaterThan(0);

      // Resolve the prediction
      service.resolve(active[0].id, 'correct');
      const stats = service.getAccuracy();
      expect(stats.total).toBe(1);
      expect(stats.correct).toBe(1);
      expect(stats.accuracy).toBe(100);
    });
  });

  describe('getConfig / updateConfig', () => {
    it('returns default config', () => {
      const config = service.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.intervalMs).toBe(60_000);
      expect(config.types.context_exhaustion.enabled).toBe(true);
    });

    it('persists config updates', () => {
      service.updateConfig({ enabled: false, intervalMs: 30_000 });
      expect(db.setSetting).toHaveBeenCalled();

      // Reconstruct from DB to verify persistence
      const service2 = new PredictionService(db as any);
      const config = service2.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.intervalMs).toBe(30_000);
    });

    it('merges type-level updates', () => {
      service.updateConfig({
        types: {
          context_exhaustion: { enabled: false },
        } as any,
      });
      const config = service.getConfig();
      expect(config.types.context_exhaustion.enabled).toBe(false);
      expect(config.types.cost_overrun.enabled).toBe(true); // untouched
    });
  });

  describe('dismiss', () => {
    it('removes an active prediction', () => {
      const agent = makeAgent({
        contextBurnRate: 10_000,
        contextWindowUsed: 195_000,
        contextWindowSize: 200_000,
      });
      service.generatePredictions([agent]);
      const active = service.getActive();
      expect(active.length).toBe(1);

      const dismissed = service.dismiss(active[0].id);
      expect(dismissed).toBe(true);
      expect(service.getActive()).toEqual([]);
    });

    it('returns false for unknown id', () => {
      expect(service.dismiss('nonexistent')).toBe(false);
    });
  });

  describe('resolve', () => {
    it('sets outcome on a prediction', () => {
      const agent = makeAgent({
        contextBurnRate: 10_000,
        contextWindowUsed: 195_000,
        contextWindowSize: 200_000,
      });
      service.generatePredictions([agent]);
      const active = service.getActive();
      const resolved = service.resolve(active[0].id, 'avoided');
      expect(resolved).toBe(true);

      expect(service.getActive()).toEqual([]);
      expect(service.getHistory().length).toBe(1);
      expect(service.getHistory()[0].outcome).toBe('avoided');
    });

    it('returns false for unknown id', () => {
      expect(service.resolve('nonexistent', 'wrong')).toBe(false);
    });
  });

  // ── Prediction Generation ───────────────────────────────────

  describe('generatePredictions', () => {
    it('returns empty when disabled', () => {
      service.updateConfig({ enabled: false });
      const agent = makeAgent({ contextBurnRate: 10_000, contextWindowUsed: 195_000, contextWindowSize: 200_000 });
      const result = service.generatePredictions([agent]);
      expect(result).toEqual([]);
    });

    it('deduplicates predictions for the same agent and type', () => {
      const agent = makeAgent({
        id: 'agent-dup',
        contextBurnRate: 10_000,
        contextWindowUsed: 190_000,
        contextWindowSize: 200_000,
      });

      // Generate twice
      service.generatePredictions([agent]);
      service.generatePredictions([agent]);

      // Should still be 1 active prediction, not 2
      const active = service.getActive();
      expect(active.filter(p => p.type === 'context_exhaustion' && p.agentId === 'agent-dup')).toHaveLength(1);
    });
  });

  // ── Context Exhaustion ──────────────────────────────────────

  describe('predictContextExhaustion', () => {
    it('predicts exhaustion when burn rate is high', () => {
      const agent = makeAgent({
        status: 'running',
        contextBurnRate: 10_000,       // 10k tokens/min
        contextWindowUsed: 180_000,    // 90% used
        contextWindowSize: 200_000,
      });

      const predictions = service.generatePredictions([agent]);
      const ctx = predictions.find(p => p.type === 'context_exhaustion');
      expect(ctx).toBeDefined();
      expect(ctx!.agentId).toBe('agent-001');
      expect(ctx!.timeHorizon).toBe(2); // 20k remaining / 10k per min = 2 min
      expect(ctx!.severity).toBe('critical');
      expect(ctx!.confidence).toBeGreaterThan(0);
      expect(ctx!.actions.length).toBeGreaterThan(0);
    });

    it('does not predict if burn rate is zero', () => {
      const agent = makeAgent({
        contextBurnRate: 0,
        contextWindowUsed: 195_000,
        contextWindowSize: 200_000,
      });

      const predictions = service.generatePredictions([agent]);
      expect(predictions.find(p => p.type === 'context_exhaustion')).toBeUndefined();
    });

    it('does not predict if exhaustion is > 30 min away', () => {
      const agent = makeAgent({
        contextBurnRate: 100,          // slow burn
        contextWindowUsed: 50_000,
        contextWindowSize: 200_000,
      });

      const predictions = service.generatePredictions([agent]);
      expect(predictions.find(p => p.type === 'context_exhaustion')).toBeUndefined();
    });

    it('skips non-running agents', () => {
      const agent = makeAgent({
        status: 'stopped',
        contextBurnRate: 10_000,
        contextWindowUsed: 195_000,
        contextWindowSize: 200_000,
      });

      const predictions = service.generatePredictions([agent]);
      expect(predictions.find(p => p.type === 'context_exhaustion')).toBeUndefined();
    });

    it('sets severity based on time horizon', () => {
      // Critical: < 5 min
      const agentCrit = makeAgent({
        id: 'a-crit',
        contextBurnRate: 10_000,
        contextWindowUsed: 198_000,
        contextWindowSize: 200_000,
      });
      // Warning: 5-15 min
      const agentWarn = makeAgent({
        id: 'a-warn',
        contextBurnRate: 5_000,
        contextWindowUsed: 150_000,
        contextWindowSize: 200_000,
      });

      const predictions = service.generatePredictions([agentCrit, agentWarn]);
      const crit = predictions.find(p => p.agentId === 'a-crit');
      const warn = predictions.find(p => p.agentId === 'a-warn');

      expect(crit).toBeDefined();
      expect(crit!.severity).toBe('critical'); // 2k/10k = 0.2 min
      expect(warn).toBeDefined();
      expect(warn!.severity).toBe('warning'); // 50k/5k = 10 min
    });
  });

  // ── Cost Overrun ────────────────────────────────────────────

  describe('predictCostOverrun', () => {
    it('predicts overrun when utilization > 50% and burn rate positive', () => {
      const budget = makeBudget({
        currentSpend: 8,
        limit: 10,
        utilization: 0.8,
        burnRatePerMinute: 0.1,
      });

      const predictions = service.generatePredictions([], budget);
      const cost = predictions.find(p => p.type === 'cost_overrun');
      expect(cost).toBeDefined();
      expect(cost!.timeHorizon).toBe(20); // $2 remaining / $0.1/min = 20 min
      expect(cost!.severity).toBe('warning');
    });

    it('does not predict when no budget limit', () => {
      const budget = makeBudget({ limit: null, utilization: 0.8, burnRatePerMinute: 0.1 });
      const predictions = service.generatePredictions([], budget);
      expect(predictions.find(p => p.type === 'cost_overrun')).toBeUndefined();
    });

    it('does not predict when utilization is low', () => {
      const budget = makeBudget({ currentSpend: 2, limit: 10, utilization: 0.2, burnRatePerMinute: 0.05 });
      const predictions = service.generatePredictions([], budget);
      expect(predictions.find(p => p.type === 'cost_overrun')).toBeUndefined();
    });

    it('does not predict when burn rate is zero', () => {
      const budget = makeBudget({ currentSpend: 8, limit: 10, utilization: 0.8, burnRatePerMinute: 0 });
      const predictions = service.generatePredictions([], budget);
      expect(predictions.find(p => p.type === 'cost_overrun')).toBeUndefined();
    });

    it('marks critical when overrun is imminent', () => {
      const budget = makeBudget({
        currentSpend: 9.5,
        limit: 10,
        utilization: 0.95,
        burnRatePerMinute: 0.1,
      });

      const predictions = service.generatePredictions([], budget);
      const cost = predictions.find(p => p.type === 'cost_overrun');
      expect(cost).toBeDefined();
      expect(cost!.timeHorizon).toBe(5); // $0.5 / $0.1/min = 5 min
      expect(cost!.severity).toBe('critical');
    });
  });

  // ── Agent Stall ─────────────────────────────────────────────

  describe('predictAgentStall', () => {
    it('predicts stall when agent inactive for > 10 min', () => {
      const agent = makeAgent({
        status: 'running',
        lastActivityAt: new Date(Date.now() - 15 * 60_000).toISOString(), // 15 min ago
      });

      const predictions = service.generatePredictions([agent]);
      const stall = predictions.find(p => p.type === 'agent_stall');
      expect(stall).toBeDefined();
      expect(stall!.agentId).toBe('agent-001');
      expect(stall!.confidence).toBeLessThanOrEqual(80);
      expect(stall!.timeHorizon).toBe(0);
    });

    it('does not predict stall for recently active agents', () => {
      const agent = makeAgent({
        status: 'running',
        lastActivityAt: new Date(Date.now() - 2 * 60_000).toISOString(), // 2 min ago
      });

      const predictions = service.generatePredictions([agent]);
      expect(predictions.find(p => p.type === 'agent_stall')).toBeUndefined();
    });

    it('does not predict stall for stopped agents', () => {
      const agent = makeAgent({
        status: 'stopped',
        lastActivityAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      });

      const predictions = service.generatePredictions([agent]);
      expect(predictions.find(p => p.type === 'agent_stall')).toBeUndefined();
    });

    it('skips prompting agents', () => {
      const agent = makeAgent({
        status: 'prompting',
        lastActivityAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      });

      const predictions = service.generatePredictions([agent]);
      expect(predictions.find(p => p.type === 'agent_stall')).toBeUndefined();
    });

    it('increases confidence with longer stall duration', () => {
      const agent15 = makeAgent({
        id: 'a-15',
        status: 'running',
        lastActivityAt: new Date(Date.now() - 15 * 60_000).toISOString(),
      });
      const agent30 = makeAgent({
        id: 'a-30',
        status: 'running',
        lastActivityAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      });

      const predictions = service.generatePredictions([agent15, agent30]);
      const stall15 = predictions.find(p => p.agentId === 'a-15' && p.type === 'agent_stall');
      const stall30 = predictions.find(p => p.agentId === 'a-30' && p.type === 'agent_stall');

      expect(stall15).toBeDefined();
      expect(stall30).toBeDefined();
      expect(stall30!.confidence).toBeGreaterThan(stall15!.confidence);
    });
  });

  // ── Persistence ─────────────────────────────────────────────

  describe('persistence', () => {
    it('survives reconstruction from DB', () => {
      const agent = makeAgent({
        contextBurnRate: 10_000,
        contextWindowUsed: 195_000,
        contextWindowSize: 200_000,
      });
      service.generatePredictions([agent]);

      // Reconstruct
      const service2 = new PredictionService(db as any);
      const active = service2.getActive();
      expect(active.length).toBe(1);
      expect(active[0].type).toBe('context_exhaustion');
    });

    it('handles corrupt data gracefully', () => {
      db.getSetting.mockReturnValueOnce('NOT VALID JSON');
      // Should not throw
      const service2 = new PredictionService(db as any);
      expect(service2.getActive()).toEqual([]);
    });
  });

  // ── Expiry ──────────────────────────────────────────────────

  describe('expiry', () => {
    it('marks expired predictions with outcome expired', () => {
      const agent = makeAgent({
        contextBurnRate: 10_000,
        contextWindowUsed: 195_000,
        contextWindowSize: 200_000,
      });
      service.generatePredictions([agent]);
      expect(service.getActive().length).toBe(1);

      // Manually set expiresAt to the past
      const active = service.getActive();
      (active[0] as any).expiresAt = new Date(Date.now() - 1000).toISOString();

      // Force save with the modified expiry
      (service as any).savePredictions();

      // Reconstruct to pick up the expired prediction
      const service2 = new PredictionService(db as any);
      expect(service2.getActive()).toEqual([]);
      // Expired prediction should be in history with outcome 'expired'
      const history = service2.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].outcome).toBe('expired');
    });

    it('counts expired predictions in accuracy stats', () => {
      const agent = makeAgent({
        contextBurnRate: 10_000,
        contextWindowUsed: 195_000,
        contextWindowSize: 200_000,
      });
      service.generatePredictions([agent]);

      // Expire the prediction
      const active = service.getActive();
      (active[0] as any).expiresAt = new Date(Date.now() - 1000).toISOString();
      (service as any).savePredictions();

      const service2 = new PredictionService(db as any);
      const stats = service2.getAccuracy();
      expect(stats.expired).toBe(1);
      expect(stats.total).toBe(1);
    });
  });

  // ── Pruning ─────────────────────────────────────────────────

  describe('pruning', () => {
    it('limits predictions to max 200', () => {
      // Generate many predictions by using many agents
      const agents: AgentSnapshot[] = [];
      for (let i = 0; i < 250; i++) {
        agents.push(makeAgent({
          id: `agent-${i}`,
          contextBurnRate: 10_000,
          contextWindowUsed: 195_000,
          contextWindowSize: 200_000,
        }));
      }

      service.generatePredictions(agents);
      // Total predictions should be capped
      const all = (service as any).predictions as any[];
      expect(all.length).toBeLessThanOrEqual(200);
    });
  });
});
