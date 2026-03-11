/**
 * Default model configuration for project roles and validation utilities.
 *
 * Each project can override which models are allowed per role.
 * When no custom config exists, these defaults are used.
 */

/** Maps role names to arrays of allowed model IDs (ordered by preference). */
export type ProjectModelConfig = Record<string, string[]>;

/**
 * All model IDs known to the system.
 * Sourced from AVAILABLE_MODELS (ModelSelector) + RoleRegistry documented list.
 */
export const KNOWN_MODEL_IDS: readonly string[] = [
  // Anthropic
  'claude-opus-4.6',
  'claude-opus-4.5',
  'claude-sonnet-4.6',
  'claude-sonnet-4.5',
  'claude-sonnet-4',
  'claude-haiku-4.5',
  // Google
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  // OpenAI
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex',
  'gpt-5.1',
  'gpt-5.1-codex-mini',
  'gpt-5-mini',
  'gpt-4.1',
] as const;

const knownSet = new Set<string>(KNOWN_MODEL_IDS);

/** Fallback model when no project config or role default is available. */
export const DEFAULT_MODEL = 'claude-sonnet-4.6';

/** Default model config used when a project has no custom config. */
export const DEFAULT_MODEL_CONFIG: ProjectModelConfig = {
  developer: ['claude-opus-4.6'],
  architect: ['claude-opus-4.6'],
  'code-reviewer': ['gemini-3-pro-preview', 'claude-opus-4.6'],
  'critical-reviewer': ['gemini-3-pro-preview'],
  'readability-reviewer': ['gemini-3-pro-preview'],
  'tech-writer': ['claude-sonnet-4.6', 'gpt-5.2', 'claude-opus-4.6'],
  secretary: ['gpt-4.1', 'gpt-5.2', 'gpt-5.1'],
  'qa-tester': ['claude-sonnet-4.6'],
  designer: ['claude-opus-4.6'],
  'product-manager': ['gpt-5.3-codex'],
  generalist: ['claude-opus-4.6'],
  'radical-thinker': ['gemini-3-pro-preview'],
  agent: ['claude-sonnet-4.6'],
  lead: ['claude-opus-4.6'],
};

/** Validate that all model IDs in a config are known. Returns unknown IDs. */
export function validateModelConfig(config: ProjectModelConfig): string[] {
  const unknown: string[] = [];
  for (const models of Object.values(config)) {
    for (const id of models) {
      if (!knownSet.has(id)) {
        unknown.push(id);
      }
    }
  }
  return unknown;
}

/** Validate the shape of a model config object. Returns error message or null. */
export function validateModelConfigShape(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'config must be a JSON object mapping role names to arrays of model IDs';
  }

  const obj = value as Record<string, unknown>;
  for (const [role, models] of Object.entries(obj)) {
    if (!Array.isArray(models)) {
      return `config["${role}"] must be an array of model IDs`;
    }
    if (models.length === 0) {
      return 'Each role must have at least one model selected.';
    }
    for (const m of models) {
      if (typeof m !== 'string') {
        return `config["${role}"] contains a non-string value`;
      }
    }
  }

  return null;
}
