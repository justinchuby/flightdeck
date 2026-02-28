export interface TokenBudget {
  agentId: string;
  allocated: number;
  used: number;
  priority: number; // 1–10
  efficiency: number; // useful output per token; higher → more allocation on rebalance
}

/**
 * Allocates context-window token budgets across multiple agents proportional to
 * their priority and efficiency scores, then rebalances whenever the pool changes.
 */
export class TokenBudgetOptimizer {
  private budgets: Map<string, TokenBudget> = new Map();
  private totalBudget: number;

  constructor(totalBudget: number = 1_000_000) {
    this.totalBudget = totalBudget;
  }

  /**
   * Register an agent and give it an initial allocation.
   * Triggers a full rebalance so existing agents are adjusted too.
   */
  allocate(agentId: string, priority: number = 5): TokenBudget {
    const clampedPriority = Math.max(1, Math.min(10, priority));

    const budget: TokenBudget = {
      agentId,
      allocated: this.calculateAllocation(clampedPriority),
      used: 0,
      priority: clampedPriority,
      efficiency: 1.0,
    };

    this.budgets.set(agentId, budget);
    this.rebalance();
    return budget;
  }

  /** Accumulate token usage for an agent. */
  recordUsage(agentId: string, tokensUsed: number): void {
    const budget = this.budgets.get(agentId);
    if (budget) budget.used += tokensUsed;
  }

  /**
   * Update the efficiency score for an agent (clamped to [0.1, 2.0]).
   * Higher efficiency means the agent will receive a larger share on the next rebalance.
   */
  updateEfficiency(agentId: string, efficiency: number): void {
    const budget = this.budgets.get(agentId);
    if (budget) {
      budget.efficiency = Math.max(0.1, Math.min(2.0, efficiency));
    }
  }

  /**
   * Pre-rebalance estimate: what fraction of the total budget a new agent
   * with `priority` would receive if inserted now.
   */
  private calculateAllocation(priority: number): number {
    const totalPriority =
      [...this.budgets.values()].reduce((sum, b) => sum + b.priority, 0) +
      priority;
    return Math.floor(this.totalBudget * (priority / totalPriority));
  }

  /**
   * Redistribute the total budget across all registered agents weighted by
   * `priority × efficiency`.
   */
  private rebalance(): void {
    const totalWeight = [...this.budgets.values()].reduce(
      (sum, b) => sum + b.priority * b.efficiency,
      0,
    );

    if (totalWeight === 0) return;

    for (const budget of this.budgets.values()) {
      budget.allocated = Math.floor(
        (this.totalBudget * (budget.priority * budget.efficiency)) / totalWeight,
      );
    }
  }

  /** Deregister an agent and rebalance the remaining pool. */
  release(agentId: string): void {
    this.budgets.delete(agentId);
    this.rebalance();
  }

  /** Return the budget record for a single agent, or undefined. */
  getBudget(agentId: string): TokenBudget | undefined {
    return this.budgets.get(agentId);
  }

  /** Return all budget records. */
  getAllBudgets(): TokenBudget[] {
    return [...this.budgets.values()];
  }

  /** Sum of tokens used across all registered agents. */
  getTotalUsed(): number {
    return [...this.budgets.values()].reduce((s, b) => s + b.used, 0);
  }

  getTotalBudget(): number {
    return this.totalBudget;
  }

  /** Resize the total pool and rebalance immediately. */
  setTotalBudget(budget: number): void {
    this.totalBudget = budget;
    this.rebalance();
  }

  /** Fraction of total budget consumed (0–1+). */
  getUtilization(): number {
    return this.getTotalUsed() / this.totalBudget;
  }
}
