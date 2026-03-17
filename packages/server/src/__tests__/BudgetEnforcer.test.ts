import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BudgetEnforcer } from '../coordination/scheduling/BudgetEnforcer.js';

// Minimal mocks
function createMockDb() {
  const settings = new Map<string, string>();
  return {
    getSetting: vi.fn((key: string) => settings.get(key) ?? null),
    setSetting: vi.fn((key: string, val: string) => { settings.set(key, val); }),
    drizzle: {} as any,
    raw: {} as any,
  };
}

function createMockCostTracker(inputTokens = 0, outputTokens = 0) {
  return {
    getAgentCosts: vi.fn(() => [
      { agentId: 'a1', totalInputTokens: inputTokens, totalOutputTokens: outputTokens, taskCount: 1 },
    ]),
  };
}

describe('BudgetEnforcer', () => {
  let db: ReturnType<typeof createMockDb>;
  let costTracker: ReturnType<typeof createMockCostTracker>;

  beforeEach(() => {
    db = createMockDb();
    costTracker = createMockCostTracker();
  });

  it('returns unlimited status with no config', () => {
    const enforcer = new BudgetEnforcer(db as any, costTracker as any);
    const status = enforcer.getStatus();
    expect(status.limit).toBeNull();
    expect(status.utilization).toBe(0);
    expect(status.paused).toBe(false);
  });

  it('setConfig persists to settings', () => {
    const enforcer = new BudgetEnforcer(db as any, costTracker as any);
    enforcer.setConfig({ limit: 50 });
    expect(db.setSetting).toHaveBeenCalledWith('budget_config', expect.any(String));
    const saved = JSON.parse(db.setSetting.mock.calls[0][1]) as { limit: number };
    expect(saved.limit).toBe(50);
  });

  it('check returns ok when no limit set', () => {
    const enforcer = new BudgetEnforcer(db as any, costTracker as any);
    expect(enforcer.check().level).toBe('ok');
  });

  it('check returns warn at 70% utilization', () => {
    // Set limit to $1, spend ~$0.75
    // INPUT_COST_PER_TOKEN = 3/1M, so 250k tokens = $0.75
    costTracker = createMockCostTracker(250_000, 0);
    const enforcer = new BudgetEnforcer(db as any, costTracker as any);
    enforcer.setConfig({ limit: 1.0 });

    const warnHandler = vi.fn();
    enforcer.on('budget:warning', warnHandler);

    const result = enforcer.check();
    expect(result.level).toBe('warn');
    expect(warnHandler).toHaveBeenCalled();
  });

  it('check returns alert at 90% utilization', () => {
    // 300k input tokens = $0.90
    costTracker = createMockCostTracker(300_000, 0);
    const enforcer = new BudgetEnforcer(db as any, costTracker as any);
    enforcer.setConfig({ limit: 1.0 });

    const alertHandler = vi.fn();
    enforcer.on('budget:alert', alertHandler);

    const result = enforcer.check();
    expect(result.level).toBe('alert');
    expect(alertHandler).toHaveBeenCalled();
  });

  it('check returns pause at 100% and is idempotent', () => {
    // 400k input tokens = $1.20 > $1.00 limit
    costTracker = createMockCostTracker(400_000, 0);
    const enforcer = new BudgetEnforcer(db as any, costTracker as any);
    enforcer.setConfig({ limit: 1.0 });

    const pauseHandler = vi.fn();
    enforcer.on('budget:pause', pauseHandler);

    const r1 = enforcer.check();
    expect(r1.level).toBe('pause');
    expect(pauseHandler).toHaveBeenCalledTimes(1);

    // Second check should NOT re-emit pause (idempotent)
    const r2 = enforcer.check();
    expect(r2.level).toBe('pause');
    expect(pauseHandler).toHaveBeenCalledTimes(1);
  });

  it('resetting config clears pause trigger', () => {
    costTracker = createMockCostTracker(400_000, 0);
    const enforcer = new BudgetEnforcer(db as any, costTracker as any);
    enforcer.setConfig({ limit: 1.0 });
    enforcer.check(); // triggers pause

    const pauseHandler = vi.fn();
    enforcer.on('budget:pause', pauseHandler);

    // Raise limit → reset
    enforcer.setConfig({ limit: 5.0 });
    enforcer.check(); // should not pause again — spend is now well under
    expect(pauseHandler).not.toHaveBeenCalled();
  });

  it('loads config from settings on construction', () => {
    const config = { limit: 10, thresholds: { warn: 0.5, alert: 0.8, pause: 0.95 } };
    db.getSetting.mockReturnValue(JSON.stringify(config));
    const enforcer = new BudgetEnforcer(db as any, costTracker as any);
    expect(enforcer.getConfig().limit).toBe(10);
    expect(enforcer.getConfig().thresholds.warn).toBe(0.5);
  });

  it('getCurrentSpend aggregates input + output costs', () => {
    // 100k input @ $3/MTok = $0.30, 10k output @ $15/MTok = $0.15 → $0.45
    costTracker = createMockCostTracker(100_000, 10_000);
    const enforcer = new BudgetEnforcer(db as any, costTracker as any);
    const spend = enforcer.getCurrentSpend();
    expect(spend).toBeCloseTo(0.45, 2);
  });
});
