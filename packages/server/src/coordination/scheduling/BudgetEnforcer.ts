import { EventEmitter } from 'events';
import type { Database } from '../../db/database.js';
import type { CostTracker } from '../../agents/CostTracker.js';
import { logger } from '../../utils/logger.js';
import { INPUT_COST_PER_TOKEN, OUTPUT_COST_PER_TOKEN } from '../../constants/pricing.js';

// ── Types ─────────────────────────────────────────────────────────

export interface BudgetConfig {
  /** Budget limit in USD. null = unlimited */
  limit: number | null;
  /** Threshold ratios for escalation */
  thresholds: {
    warn: number;   // default 0.70
    alert: number;  // default 0.90
    pause: number;  // default 1.00
  };
}

export interface BudgetStatus {
  limit: number | null;
  currency: 'USD';
  currentSpend: number;
  utilization: number;
  thresholds: BudgetConfig['thresholds'];
  paused: boolean;
}

// ── BudgetEnforcer ────────────────────────────────────────────────

const SETTINGS_KEY = 'budget_config';

/** Construct a per-project or global settings key */
function budgetKey(projectId?: string): string {
  return projectId ? `${SETTINGS_KEY}:${projectId}` : SETTINGS_KEY;
}

export class BudgetEnforcer extends EventEmitter {
  private config: BudgetConfig;
  private pauseTriggered = false;
  private lastEmittedLevel: 'ok' | 'warn' | 'alert' | 'pause' = 'ok';
  private activeProjectId?: string;

  constructor(
    private db: Database,
    private costTracker: CostTracker,
  ) {
    super();
    this.config = this.loadConfig();
  }

  private loadConfig(projectId?: string): BudgetConfig {
    try {
      // Try project-specific first, then global fallback
      const raw = this.db.getSetting(budgetKey(projectId));
      if (raw) return JSON.parse(raw);
      if (projectId) {
        const global = this.db.getSetting(budgetKey());
        if (global) return JSON.parse(global);
      }
    } catch { /* use defaults */ }
    return { limit: null, thresholds: { warn: 0.70, alert: 0.90, pause: 1.00 } };
  }

  private saveConfig(projectId?: string): void {
    this.db.setSetting(budgetKey(projectId), JSON.stringify(this.config));
  }

  /** Get current budget configuration */
  getConfig(): BudgetConfig {
    return { ...this.config, thresholds: { ...this.config.thresholds } };
  }

  /** Set the active project for budget operations */
  setProject(projectId?: string): void {
    if (this.activeProjectId !== projectId) {
      this.activeProjectId = projectId;
      this.config = this.loadConfig(projectId);
      this.pauseTriggered = false;
      this.lastEmittedLevel = 'ok';
    }
  }

  /** Update budget configuration */
  setConfig(updates: { limit?: number | null; thresholds?: Partial<BudgetConfig['thresholds']> }, projectId?: string): void {
    // Load project-specific config if switching context
    if (projectId && projectId !== this.activeProjectId) {
      this.config = this.loadConfig(projectId);
      this.activeProjectId = projectId;
    }
    if (updates.limit !== undefined) this.config.limit = updates.limit;
    if (updates.thresholds) {
      Object.assign(this.config.thresholds, updates.thresholds);
    }
    this.pauseTriggered = false;
    this.lastEmittedLevel = 'ok';
    this.saveConfig(projectId ?? this.activeProjectId);
  }

  /** Calculate current total spend in USD from CostTracker data */
  getCurrentSpend(): number {
    const costs = this.costTracker.getAgentCosts();
    let totalInput = 0;
    let totalOutput = 0;
    for (const c of costs) {
      totalInput += c.totalInputTokens;
      totalOutput += c.totalOutputTokens;
    }
    return totalInput * INPUT_COST_PER_TOKEN + totalOutput * OUTPUT_COST_PER_TOKEN;
  }

  /** Get full budget status */
  getStatus(): BudgetStatus {
    const currentSpend = this.getCurrentSpend();
    const utilization = this.config.limit ? currentSpend / this.config.limit : 0;
    return {
      limit: this.config.limit,
      currency: 'USD',
      currentSpend: Math.round(currentSpend * 100) / 100,
      utilization: Math.round(utilization * 1000) / 1000,
      thresholds: { ...this.config.thresholds },
      paused: this.pauseTriggered,
    };
  }

  /**
   * Check budget and emit escalation events.
   * Call this periodically (e.g., from AlertEngine check loop).
   */
  check(): { level: 'ok' | 'warn' | 'alert' | 'pause'; utilization: number } {
    if (!this.config.limit) return { level: 'ok', utilization: 0 };

    const currentSpend = this.getCurrentSpend();
    const utilization = currentSpend / this.config.limit;

    if (utilization >= this.config.thresholds.pause) {
      if (!this.pauseTriggered) {
        this.pauseTriggered = true;
        logger.warn('budget', `Budget limit reached: $${currentSpend.toFixed(2)} / $${this.config.limit} (${Math.round(utilization * 100)}%)`);
        this.emit('budget:pause', { currentSpend, limit: this.config.limit, utilization });
      }
      return { level: 'pause', utilization };
    }

    if (utilization >= this.config.thresholds.alert) {
      if (this.lastEmittedLevel !== 'alert') {
        this.lastEmittedLevel = 'alert';
        this.emit('budget:alert', { currentSpend, limit: this.config.limit, utilization });
      }
      return { level: 'alert', utilization };
    }

    if (utilization >= this.config.thresholds.warn) {
      if (this.lastEmittedLevel !== 'warn') {
        this.lastEmittedLevel = 'warn';
        this.emit('budget:warning', { currentSpend, limit: this.config.limit, utilization });
      }
      return { level: 'warn', utilization };
    }

    this.lastEmittedLevel = 'ok';
    return { level: 'ok', utilization };
  }
}
