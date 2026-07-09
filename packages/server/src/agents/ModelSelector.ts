export type ModelTier = 'fast' | 'standard' | 'premium';

export interface ModelConfig {
  id: string;
  name: string;
  tier: ModelTier;
  contextWindow: number;
  costPer1kTokens: number;
  bestFor: string[];
}

export const AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    tier: 'fast',
    contextWindow: 200000,
    costPer1kTokens: 0.25,
    bestFor: ['simple-tasks', 'code-review', 'formatting', 'docs'],
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    tier: 'standard',
    contextWindow: 200000,
    costPer1kTokens: 3.0,
    bestFor: ['implementation', 'debugging', 'testing', 'analysis'],
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    tier: 'standard',
    contextWindow: 200000,
    costPer1kTokens: 3.0,
    bestFor: ['implementation', 'debugging', 'testing', 'analysis'],
  },
  {
    id: 'claude-opus-4.8',
    name: 'Claude Opus 4.8',
    tier: 'premium',
    contextWindow: 200000,
    costPer1kTokens: 15.0,
    bestFor: ['architecture', 'complex-debugging', 'design', 'critical-review'],
  },
  {
    id: 'claude-opus-4.7',
    name: 'Claude Opus 4.7',
    tier: 'premium',
    contextWindow: 200000,
    costPer1kTokens: 15.0,
    bestFor: ['architecture', 'complex-debugging', 'design', 'critical-review'],
  },
  {
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6',
    tier: 'premium',
    contextWindow: 200000,
    costPer1kTokens: 15.0,
    bestFor: ['architecture', 'complex-debugging', 'design', 'critical-review'],
  },
  {
    id: 'gemini-3-pro-preview',
    name: 'Gemini 3 Pro',
    tier: 'premium',
    contextWindow: 1000000,
    costPer1kTokens: 1.25,
    bestFor: ['large-context', 'multi-file', 'research'],
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash',
    tier: 'standard',
    contextWindow: 1000000,
    costPer1kTokens: 0.6,
    bestFor: ['large-context', 'fast-iteration', 'multi-file'],
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    tier: 'premium',
    contextWindow: 200000,
    costPer1kTokens: 5.0,
    bestFor: ['code-generation', 'implementation', 'testing', 'critical-review'],
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    tier: 'standard',
    contextWindow: 200000,
    costPer1kTokens: 2.5,
    bestFor: ['implementation', 'testing', 'analysis'],
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    tier: 'fast',
    contextWindow: 200000,
    costPer1kTokens: 1.0,
    bestFor: ['simple-tasks', 'formatting', 'docs'],
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    tier: 'standard',
    contextWindow: 200000,
    costPer1kTokens: 2.5,
    bestFor: ['code-generation', 'implementation', 'testing'],
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    tier: 'premium',
    contextWindow: 200000,
    costPer1kTokens: 2.5,
    bestFor: ['code-generation', 'implementation', 'testing', 'critical-review'],
  },
];

/**
 * Tier-by-id lookup derived from {@link AVAILABLE_MODELS}, keyed by lowercased
 * model id (the model "class"). Used by the availability selector to infer the
 * intended tier of an arbitrary requested model — independent of any single
 * provider's tier-triple — without creating an import-boundary/circular-dep
 * problem (this module imports nothing from `adapters/`).
 */
export const MODEL_TIERS: Record<string, ModelTier> = Object.fromEntries(
  AVAILABLE_MODELS.map((m) => [m.id.toLowerCase(), m.tier]),
);

export interface TaskProfile {
  role: string;
  description: string;
  estimatedComplexity?: 'low' | 'medium' | 'high' | 'critical';
  requiresLargeContext?: boolean;
  budgetConstraint?: ModelTier;
}

export class ModelSelector {
  private models: ModelConfig[] = [...AVAILABLE_MODELS];
  private roleModelOverrides: Map<string, string> = new Map();

  /**
   * Selects the best model for a given task profile.
   *
   * Priority order:
   *   1. Role-level override (explicit model pinning)
   *   2. Budget constraint tier
   *   3. Complexity-based tier selection
   */
  selectModel(task: TaskProfile): ModelConfig {
    // 1. Check role override
    if (this.roleModelOverrides.has(task.role)) {
      const override = this.models.find(
        (m) => m.id === this.roleModelOverrides.get(task.role),
      );
      if (override) return override;
    }

    // 2. Budget constraint
    if (task.budgetConstraint) {
      return this.bestInTier(task.budgetConstraint, task);
    }

    // 3. Complexity-based selection
    switch (task.estimatedComplexity) {
      case 'critical':
        return this.bestInTier('premium', task);
      case 'high':
        return this.bestInTier('standard', task);
      case 'low':
        return this.bestInTier('fast', task);
      default:
        return this.bestInTier('standard', task);
    }
  }

  /**
   * Returns the best-matching model within the given tier.
   *
   * If `requiresLargeContext` is set, prefers models with contextWindow >= 500 000.
   * Keyword matching against `bestFor` tags breaks ties.
   */
  private bestInTier(tier: ModelTier, task: TaskProfile): ModelConfig {
    const candidates = this.models.filter((m) => m.tier === tier);

    if (candidates.length === 0) {
      // Fall back to the first available model if the tier is empty
      return this.models[0];
    }

    if (task.requiresLargeContext) {
      const large = candidates.filter((m) => m.contextWindow >= 500_000);
      if (large.length > 0) return large[0];
    }

    // Keyword match against description words
    const keywords = task.description.toLowerCase().split(/\s+/);
    let best = candidates[0];
    let bestScore = 0;

    for (const model of candidates) {
      const score = model.bestFor.filter((bf) =>
        keywords.some((kw) => bf.includes(kw) || kw.includes(bf)),
      ).length;
      if (score > bestScore) {
        best = model;
        bestScore = score;
      }
    }

    return best;
  }

  /** Pin a specific model for all tasks assigned to a role. */
  setRoleOverride(role: string, modelId: string): void {
    this.roleModelOverrides.set(role, modelId);
  }

  /** Remove a previously set role override. */
  removeRoleOverride(role: string): void {
    this.roleModelOverrides.delete(role);
  }

  /** Return all active role → model overrides. */
  getRoleOverrides(): Record<string, string> {
    return Object.fromEntries(this.roleModelOverrides);
  }

  /** Return a copy of the available model list. */
  getModels(): ModelConfig[] {
    return [...this.models];
  }
}
