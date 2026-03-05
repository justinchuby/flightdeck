import { EventEmitter } from 'events';
import type { Database } from '../db/database.js';
import type { CostTracker } from '../agents/CostTracker.js';
import { logger } from '../utils/logger.js';

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

// ── Approximate token-to-USD pricing ──────────────────────────────

const INPUT_COST_PER_TOKEN = 3.0 / 1_000_000;   // ~$3/MTok (Sonnet-class)
const OUTPUT_COST_PER_TOKEN = 15.0 / 1_000_000;  // ~$15/MTok (Sonnet-class)

// ── BudgetEnforcer ────────────────────────────────────────────────

const SETTINGS_KEY = 'budget_config';

export class BudgetEnforcer extends EventEmitter {
  private config: BudgetConfig;
  private pauseTriggered = false;
  private lastEmittedLevel: 'ok' | 'warn' | 'alert' | 'pause' = 'ok';

  constructor(
    private db: Database,
    private costTracker: CostTracker,
  ) {
    super();
    this.config = this.loadConfig();
  }

  private loadConfig(): BudgetConfig {
    try {
      const raw = this.db.getSetting(SETTINGS_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* use defaults */ }
    return { limit: null, thresholds: { warn: 0.70, alert: 0.90, pause: 1.00 } };
  }

  private saveConfig(): void {
    this.db.setSetting(SETTINGS_KEY, JSON.stringify(this.config));
  }

  /** Get current budget configuration */
  getConfig(): BudgetConfig {
    return { ...this.config, thresholds: { ...this.config.thresholds } };
  }

  /** Update budget configuration */
  setConfig(updates: { limit?: number | null; thresholds?: Partial<BudgetConfig['thresholds']> }): void {
    if (updates.limit !== undefined) this.config.limit = updates.limit;
    if (updates.thresholds) {
      Object.assign(this.config.thresholds, updates.thresholds);
    }
    this.pauseTriggered = false; // Reset pause trigger on config change
    this.lastEmittedLevel = 'ok'; // Reset dedup tracking
    this.saveConfig();
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
