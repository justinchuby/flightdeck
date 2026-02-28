import { describe, it, expect, beforeEach } from 'vitest';
import { TokenBudgetOptimizer } from '../agents/TokenBudgetOptimizer.js';

describe('TokenBudgetOptimizer', () => {
  let optimizer: TokenBudgetOptimizer;

  beforeEach(() => {
    optimizer = new TokenBudgetOptimizer(1_000_000);
  });

  // ── 1. allocate creates a budget record ──────────────────────────────

  it('allocate creates a budget record with correct defaults', () => {
    const budget = optimizer.allocate('agent-1', 5);
    expect(budget.agentId).toBe('agent-1');
    expect(budget.priority).toBe(5);
    expect(budget.used).toBe(0);
    expect(budget.efficiency).toBe(1.0);
    expect(budget.allocated).toBeGreaterThan(0);
  });

  it('clamps priority to [1, 10]', () => {
    const low = optimizer.allocate('a1', 0);
    expect(low.priority).toBe(1);

    const optimizer2 = new TokenBudgetOptimizer(1_000_000);
    const high = optimizer2.allocate('a2', 99);
    expect(high.priority).toBe(10);
  });

  // ── 2. rebalance distributes total budget ────────────────────────────

  it('allocations sum to at most totalBudget after rebalance', () => {
    optimizer.allocate('a1', 5);
    optimizer.allocate('a2', 5);
    optimizer.allocate('a3', 5);

    const total = optimizer
      .getAllBudgets()
      .reduce((s, b) => s + b.allocated, 0);
    // floor() rounding means sum may be slightly below totalBudget
    expect(total).toBeLessThanOrEqual(1_000_000);
    expect(total).toBeGreaterThan(990_000);
  });

  it('higher priority gets proportionally more allocation', () => {
    optimizer.allocate('low', 2);
    optimizer.allocate('high', 8);

    const low = optimizer.getBudget('low')!;
    const high = optimizer.getBudget('high')!;
    expect(high.allocated).toBeGreaterThan(low.allocated);
  });

  it('equal-priority agents share the budget equally', () => {
    optimizer.allocate('a', 5);
    optimizer.allocate('b', 5);

    const a = optimizer.getBudget('a')!;
    const b = optimizer.getBudget('b')!;
    expect(a.allocated).toBe(b.allocated);
  });

  // ── 3. recordUsage accumulates correctly ─────────────────────────────

  it('recordUsage accumulates token usage', () => {
    optimizer.allocate('agent-x', 5);
    optimizer.recordUsage('agent-x', 10_000);
    optimizer.recordUsage('agent-x', 5_000);
    expect(optimizer.getBudget('agent-x')!.used).toBe(15_000);
  });

  it('recordUsage is a no-op for unknown agentId', () => {
    expect(() => optimizer.recordUsage('ghost', 1000)).not.toThrow();
  });

  // ── 4. updateEfficiency affects allocation on next rebalance ─────────

  it('updateEfficiency clamps to [0.1, 2.0]', () => {
    optimizer.allocate('e1', 5);
    optimizer.updateEfficiency('e1', -5);
    expect(optimizer.getBudget('e1')!.efficiency).toBe(0.1);

    optimizer.updateEfficiency('e1', 100);
    expect(optimizer.getBudget('e1')!.efficiency).toBe(2.0);
  });

  it('higher efficiency agent gets a larger share after rebalance', () => {
    optimizer.allocate('efficient', 5);
    optimizer.allocate('inefficient', 5);

    optimizer.updateEfficiency('efficient', 2.0);
    optimizer.updateEfficiency('inefficient', 0.5);

    // Trigger rebalance by adding another agent then removing it
    optimizer.allocate('temp', 5);
    optimizer.release('temp');

    const eff = optimizer.getBudget('efficient')!;
    const ineff = optimizer.getBudget('inefficient')!;
    expect(eff.allocated).toBeGreaterThan(ineff.allocated);
  });

  // ── 5. release removes agent and rebalances ──────────────────────────

  it('release removes the agent', () => {
    optimizer.allocate('a1', 5);
    optimizer.allocate('a2', 5);
    optimizer.release('a1');

    expect(optimizer.getBudget('a1')).toBeUndefined();
    expect(optimizer.getAllBudgets()).toHaveLength(1);
  });

  it('release rebalances the remaining agents', () => {
    optimizer.allocate('a1', 5);
    optimizer.allocate('a2', 5);
    optimizer.release('a1');

    // a2 should now own the entire budget
    const a2 = optimizer.getBudget('a2')!;
    expect(a2.allocated).toBe(1_000_000);
  });

  it('release is a no-op for unknown agentId', () => {
    optimizer.allocate('a1', 5);
    expect(() => optimizer.release('ghost')).not.toThrow();
    expect(optimizer.getAllBudgets()).toHaveLength(1);
  });

  // ── 6. getTotalUsed / getUtilization ─────────────────────────────────

  it('getTotalUsed sums usage across all agents', () => {
    optimizer.allocate('a1', 5);
    optimizer.allocate('a2', 5);
    optimizer.recordUsage('a1', 100_000);
    optimizer.recordUsage('a2', 200_000);
    expect(optimizer.getTotalUsed()).toBe(300_000);
  });

  it('getUtilization returns the correct fraction', () => {
    optimizer.allocate('a1', 5);
    optimizer.recordUsage('a1', 250_000);
    expect(optimizer.getUtilization()).toBeCloseTo(0.25);
  });

  // ── 7. setTotalBudget resizes and rebalances ─────────────────────────

  it('setTotalBudget resizes the pool and rebalances', () => {
    optimizer.allocate('a1', 5);
    optimizer.allocate('a2', 5);
    optimizer.setTotalBudget(500_000);

    expect(optimizer.getTotalBudget()).toBe(500_000);
    const total = optimizer
      .getAllBudgets()
      .reduce((s, b) => s + b.allocated, 0);
    expect(total).toBeLessThanOrEqual(500_000);
    expect(total).toBeGreaterThan(490_000);
  });

  // ── 8. empty pool edge cases ─────────────────────────────────────────

  it('returns empty arrays and zero usage when no agents registered', () => {
    expect(optimizer.getAllBudgets()).toHaveLength(0);
    expect(optimizer.getTotalUsed()).toBe(0);
    expect(optimizer.getUtilization()).toBe(0);
  });

  it('single agent receives the full budget', () => {
    optimizer.allocate('solo', 7);
    expect(optimizer.getBudget('solo')!.allocated).toBe(1_000_000);
  });
});
