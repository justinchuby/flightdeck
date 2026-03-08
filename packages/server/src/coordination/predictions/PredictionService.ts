import type { Database } from '../../db/database.js';
import { logger } from '../../utils/logger.js';

// ── Types ─────────────────────────────────────────────────────────

export type PredictionType =
  | 'context_exhaustion'
  | 'cost_overrun'
  | 'agent_stall'
  | 'task_duration'
  | 'completion_estimate'
  | 'file_conflict';

export interface PredictionAction {
  label: string;
  description: string;
  actionType: 'api_call' | 'dismiss';
  endpoint: string;
  method: 'POST' | 'DELETE';
  body?: Record<string, unknown>;
  route?: string;
  confidence?: number;
}

export interface Prediction {
  id: string;
  type: PredictionType;
  severity: 'info' | 'warning' | 'critical';
  confidence: number;          // 0-100
  title: string;
  detail: string;
  timeHorizon: number;         // minutes until predicted event
  dataPoints: number;
  agentId?: string;
  taskId?: string;
  actions: PredictionAction[];
  createdAt: string;
  expiresAt: string;
  outcome?: 'correct' | 'avoided' | 'wrong' | 'expired' | null;
}

export interface PredictionConfig {
  enabled: boolean;
  intervalMs: number;
  types: Record<PredictionType, { enabled: boolean; thresholds?: Record<string, number> }>;
}

export interface AccuracyStats {
  total: number;
  correct: number;
  avoided: number;
  wrong: number;
  expired: number;
  accuracy: number;            // (correct + avoided) / total * 100
}

/** Snapshot of agent state used for generating predictions */
export interface AgentSnapshot {
  id: string;
  role: string;
  status: string;
  contextWindowUsed: number;
  contextWindowSize: number;
  contextBurnRate: number;     // tokens per minute
  estimatedExhaustionMinutes: number | null;
  lastActivityAt: string;
}

/** Snapshot of budget state used for cost predictions */
export interface BudgetSnapshot {
  currentSpend: number;
  limit: number | null;
  utilization: number;         // 0-1
  burnRatePerMinute: number;
}

// ── Constants ─────────────────────────────────────────────────────

const SETTINGS_KEY_PREDICTIONS = 'predictions';
const SETTINGS_KEY_CONFIG = 'prediction_config';
const MAX_PREDICTIONS = 200;

const CONTEXT_EXPIRY_MINUTES = 15;
const STALL_EXPIRY_MINUTES = 15;
const COST_EXPIRY_MINUTES = 30;

const STALL_THRESHOLD_MINUTES = 10;

const DEFAULT_CONFIG: PredictionConfig = {
  enabled: true,
  intervalMs: 60_000,
  types: {
    context_exhaustion: { enabled: true },
    cost_overrun: { enabled: true },
    agent_stall: { enabled: true },
    task_duration: { enabled: true },
    completion_estimate: { enabled: true },
    file_conflict: { enabled: true },
  },
};

// ── Helpers ───────────────────────────────────────────────────────

function generateId(): string {
  return `pred-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function severityFromMinutes(minutes: number): 'info' | 'warning' | 'critical' {
  if (minutes <= 5) return 'critical';
  if (minutes <= 15) return 'warning';
  return 'info';
}

// ── PredictionService ─────────────────────────────────────────────

export class PredictionService {
  private predictions: Prediction[] = [];
  private config: PredictionConfig;

  constructor(private db: Database) {
    this.predictions = this.loadPredictions();
    this.config = this.loadConfig();
  }

  // ── Core API ──────────────────────────────────────────────────

  /** Return active predictions (no outcome, not expired) */
  getActive(): Prediction[] {
    this.expirePredictions();
    return this.predictions.filter(p => p.outcome == null);
  }

  /** Return predictions that have an outcome set */
  getHistory(): Prediction[] {
    return this.predictions.filter(p => p.outcome != null);
  }

  /** Compute accuracy statistics across resolved predictions */
  getAccuracy(): AccuracyStats {
    this.expirePredictions();
    const resolved = this.predictions.filter(p => p.outcome != null);
    const correct = resolved.filter(p => p.outcome === 'correct').length;
    const avoided = resolved.filter(p => p.outcome === 'avoided').length;
    const wrong = resolved.filter(p => p.outcome === 'wrong').length;
    const expired = resolved.filter(p => p.outcome === 'expired').length;
    const total = correct + avoided + wrong + expired;

    return {
      total,
      correct,
      avoided,
      wrong,
      expired,
      accuracy: total > 0 ? Math.round((correct + avoided) / total * 100 * 100) / 100 : 0,
    };
  }

  /** Return the current prediction configuration */
  getConfig(): PredictionConfig {
    return {
      ...this.config,
      types: { ...this.config.types },
    };
  }

  /** Merge partial updates into the prediction configuration */
  updateConfig(updates: Partial<PredictionConfig>): PredictionConfig {
    if (updates.enabled !== undefined) {
      this.config.enabled = updates.enabled;
    }
    if (updates.intervalMs !== undefined) {
      this.config.intervalMs = updates.intervalMs;
    }
    if (updates.types) {
      for (const [key, value] of Object.entries(updates.types)) {
        const typeKey = key as PredictionType;
        this.config.types[typeKey] = { ...this.config.types[typeKey], ...value };
      }
    }
    this.saveConfig();
    logger.info('predictions', 'Config updated');
    return this.getConfig();
  }

  /** Dismiss a prediction (removes it from active, no outcome recorded) */
  dismiss(id: string): boolean {
    const pred = this.predictions.find(p => p.id === id && p.outcome == null);
    if (!pred) return false;
    pred.outcome = null;
    // Remove from active by setting a special dismiss marker — we just remove it entirely
    this.predictions = this.predictions.filter(p => p.id !== id);
    this.savePredictions();
    logger.info('predictions', `Dismissed prediction ${id}`);
    return true;
  }

  /** Resolve a prediction with an outcome */
  resolve(id: string, outcome: 'correct' | 'avoided' | 'wrong'): boolean {
    const pred = this.predictions.find(p => p.id === id);
    if (!pred) return false;
    pred.outcome = outcome;
    this.savePredictions();
    logger.info('predictions', `Resolved prediction ${id} as ${outcome}`);
    return true;
  }

  // ── Prediction Generation ─────────────────────────────────────

  /**
   * Generate predictions based on current agent and budget state.
   * Called periodically (e.g., every 60s from a check loop).
   * Returns newly created or updated predictions.
   */
  generatePredictions(agents: AgentSnapshot[], budget?: BudgetSnapshot): Prediction[] {
    if (!this.config.enabled) return [];

    this.expirePredictions();

    const newPredictions: Prediction[] = [];

    if (this.config.types.context_exhaustion.enabled) {
      newPredictions.push(...this.predictContextExhaustion(agents));
    }
    if (this.config.types.cost_overrun.enabled && budget) {
      newPredictions.push(...this.predictCostOverrun(budget));
    }
    if (this.config.types.agent_stall.enabled) {
      newPredictions.push(...this.predictAgentStall(agents));
    }
    if (this.config.types.file_conflict.enabled) {
      newPredictions.push(...this.predictFileConflict(agents));
    }

    // TODO: task_duration predictions — requires task history data
    // TODO: completion_estimate predictions — requires task history data

    // Dedup: update existing predictions or add new ones
    const added: Prediction[] = [];
    for (const pred of newPredictions) {
      const existing = this.predictions.find(
        p => p.type === pred.type && p.agentId === pred.agentId && p.outcome == null,
      );
      if (existing) {
        // Update existing prediction in-place
        existing.confidence = pred.confidence;
        existing.detail = pred.detail;
        existing.timeHorizon = pred.timeHorizon;
        existing.severity = pred.severity;
        existing.dataPoints = pred.dataPoints;
        existing.expiresAt = pred.expiresAt;
        existing.actions = pred.actions;
        added.push(existing);
      } else {
        this.predictions.push(pred);
        added.push(pred);
      }
    }

    // Prune to MAX_PREDICTIONS, keeping newest
    if (this.predictions.length > MAX_PREDICTIONS) {
      // Sort by createdAt descending and keep only MAX_PREDICTIONS
      this.predictions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      this.predictions = this.predictions.slice(0, MAX_PREDICTIONS);
    }

    this.savePredictions();

    if (added.length > 0) {
      logger.info('predictions', `Generated ${added.length} prediction(s)`);
    }

    return added;
  }

  // ── Private: Prediction Generators ────────────────────────────

  /**
   * Context Exhaustion: for each running agent with contextBurnRate > 0,
   * extrapolate when context will hit 100%. If < 30 min, create prediction.
   * Confidence = min(90, dataPoints * 10).
   */
  private predictContextExhaustion(agents: AgentSnapshot[]): Prediction[] {
    const results: Prediction[] = [];

    for (const agent of agents) {
      if (agent.status !== 'running' && agent.status !== 'active') continue;
      if (agent.contextBurnRate <= 0) continue;
      if (agent.contextWindowSize <= 0) continue;

      const remaining = agent.contextWindowSize - agent.contextWindowUsed;
      if (remaining <= 0) continue;

      const minutesUntilExhaustion = remaining / agent.contextBurnRate;
      if (minutesUntilExhaustion >= 30) continue;

      const utilization = agent.contextWindowUsed / agent.contextWindowSize;
      // Estimate data points from burn rate confidence: more utilization = more data
      const dataPoints = Math.max(1, Math.round(utilization * 10));
      const confidence = Math.min(90, dataPoints * 10);

      results.push({
        id: generateId(),
        type: 'context_exhaustion',
        severity: severityFromMinutes(minutesUntilExhaustion),
        confidence,
        title: `Context window exhaustion for ${agent.role} (${agent.id.slice(0, 8)})`,
        detail: `Agent ${agent.id} is using ${Math.round(utilization * 100)}% of context window. ` +
          `At current burn rate (${Math.round(agent.contextBurnRate)} tokens/min), ` +
          `context will be exhausted in ~${Math.round(minutesUntilExhaustion)} minutes.`,
        timeHorizon: Math.round(minutesUntilExhaustion),
        dataPoints,
        agentId: agent.id,
        actions: [
          {
            label: 'Refresh context',
            description: 'Compact the agent\'s context window to free up space',
            actionType: 'api_call',
            endpoint: `/api/agents/${agent.id}/refresh-context`,
            method: 'POST',
            confidence: 80,
          },
          {
            label: 'Dismiss',
            description: 'Dismiss this prediction',
            actionType: 'dismiss',
            endpoint: '',
            method: 'POST',
          },
        ],
        createdAt: new Date().toISOString(),
        expiresAt: minutesFromNow(CONTEXT_EXPIRY_MINUTES),
        outcome: null,
      });
    }

    return results;
  }

  /**
   * Cost Overrun: if budget.utilization > 0.5 and burnRatePerMinute > 0,
   * extrapolate when budget will hit 100%. Confidence based on utilization
   * (higher utilization = more data points = more confidence in linear trend).
   */
  private predictCostOverrun(budget: BudgetSnapshot): Prediction[] {
    if (budget.limit == null || budget.limit <= 0) return [];
    if (budget.utilization <= 0.5) return [];
    if (budget.burnRatePerMinute <= 0) return [];

    const remainingBudget = budget.limit - budget.currentSpend;
    if (remainingBudget <= 0) return [];

    const minutesUntilOverrun = remainingBudget / budget.burnRatePerMinute;

    // Confidence: more utilization data means more reliable extrapolation
    const dataPoints = Math.max(1, Math.round(budget.utilization * 15));
    const confidence = Math.min(85, dataPoints * 6);

    return [
      {
        id: generateId(),
        type: 'cost_overrun',
        severity: minutesUntilOverrun <= 10 ? 'critical' : minutesUntilOverrun <= 30 ? 'warning' : 'info',
        confidence,
        title: 'Budget overrun predicted',
        detail: `Current spend: $${budget.currentSpend.toFixed(2)} of $${budget.limit.toFixed(2)} ` +
          `(${Math.round(budget.utilization * 100)}%). ` +
          `At $${budget.burnRatePerMinute.toFixed(4)}/min, budget will be exhausted in ~${Math.round(minutesUntilOverrun)} minutes.`,
        timeHorizon: Math.round(minutesUntilOverrun),
        dataPoints,
        actions: [
          {
            label: 'Increase budget',
            description: 'Raise the budget limit to avoid interruption',
            actionType: 'api_call',
            endpoint: '/api/budget',
            method: 'POST',
            body: { limit: Math.round(budget.limit * 1.5 * 100) / 100 },
            confidence: 70,
          },
          {
            label: 'Dismiss',
            description: 'Dismiss this prediction',
            actionType: 'dismiss',
            endpoint: '',
            method: 'POST',
          },
        ],
        createdAt: new Date().toISOString(),
        expiresAt: minutesFromNow(COST_EXPIRY_MINUTES),
        outcome: null,
      },
    ];
  }

  /**
   * Agent Stall: if a running agent's lastActivityAt is > 10 min ago
   * and they're not in 'prompting' status, predict stall.
   * Confidence = min(80, stallMinutes * 5).
   */
  private predictAgentStall(agents: AgentSnapshot[]): Prediction[] {
    const results: Prediction[] = [];
    const now = Date.now();

    for (const agent of agents) {
      // Skip agents that are prompting (waiting for user input is expected)
      if (agent.status === 'prompting') continue;
      if (agent.status !== 'running' && agent.status !== 'active') continue;

      const lastActivity = new Date(agent.lastActivityAt).getTime();
      const stallMinutes = (now - lastActivity) / 60_000;

      if (stallMinutes < STALL_THRESHOLD_MINUTES) continue;

      const confidence = Math.min(80, Math.round(stallMinutes * 5));

      results.push({
        id: generateId(),
        type: 'agent_stall',
        severity: stallMinutes >= 30 ? 'critical' : stallMinutes >= 15 ? 'warning' : 'info',
        confidence,
        title: `Agent ${agent.role} (${agent.id.slice(0, 8)}) may be stalled`,
        detail: `Agent ${agent.id} has not reported activity for ${Math.round(stallMinutes)} minutes. ` +
          `Current status: ${agent.status}. This may indicate a stuck process or lost connection.`,
        timeHorizon: 0, // already happening
        dataPoints: 1,
        agentId: agent.id,
        actions: [
          {
            label: 'Restart agent',
            description: 'Terminate and restart the stalled agent',
            actionType: 'api_call',
            endpoint: `/api/agents/${agent.id}/restart`,
            method: 'POST',
            confidence: 60,
          },
          {
            label: 'Dismiss',
            description: 'Dismiss this prediction',
            actionType: 'dismiss',
            endpoint: '',
            method: 'POST',
          },
        ],
        createdAt: new Date().toISOString(),
        expiresAt: minutesFromNow(STALL_EXPIRY_MINUTES),
        outcome: null,
      });
    }

    return results;
  }

  /**
   * File Conflict: not implemented in V1.
   * Requires FileLockRegistry integration for meaningful predictions.
   */
  private predictFileConflict(_agents: AgentSnapshot[]): Prediction[] {
    // TODO: integrate with FileLockRegistry to detect overlapping file access patterns
    return [];
  }

  // ── Private: Persistence ──────────────────────────────────────

  private loadPredictions(): Prediction[] {
    try {
      const raw = this.db.getSetting(SETTINGS_KEY_PREDICTIONS);
      if (raw) {
        const parsed = JSON.parse(raw) as Prediction[];
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (err) {
      logger.warn('predictions', 'Failed to load predictions, starting fresh');
    }
    return [];
  }

  private savePredictions(): void {
    try {
      this.db.setSetting(SETTINGS_KEY_PREDICTIONS, JSON.stringify(this.predictions));
    } catch (err) {
      logger.error('predictions', 'Failed to save predictions');
    }
  }

  private loadConfig(): PredictionConfig {
    try {
      const raw = this.db.getSetting(SETTINGS_KEY_CONFIG);
      if (raw) {
        const parsed = JSON.parse(raw) as PredictionConfig;
        // Merge with defaults to ensure all type keys exist
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          types: { ...DEFAULT_CONFIG.types, ...parsed.types },
        };
      }
    } catch (err) {
      logger.warn('predictions', 'Failed to load config, using defaults');
    }
    return { ...DEFAULT_CONFIG, types: { ...DEFAULT_CONFIG.types } };
  }

  private saveConfig(): void {
    try {
      this.db.setSetting(SETTINGS_KEY_CONFIG, JSON.stringify(this.config));
    } catch (err) {
      logger.error('predictions', 'Failed to save config');
    }
  }

  /**
   * Expire predictions that are past their expiresAt timestamp.
   * Expired predictions without an outcome are removed (not tracked in accuracy).
   */
  private expirePredictions(): void {
    const now = new Date().toISOString();
    let changed = false;

    for (const p of this.predictions) {
      if (p.outcome == null && p.expiresAt <= now) {
        p.outcome = 'expired';
        changed = true;
      }
    }

    if (changed) {
      this.savePredictions();
    }
  }
}
