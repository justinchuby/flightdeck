import { describe, it, expect } from 'vitest';
import type { ProjectModelConfig } from '../projects/ModelConfigDefaults.js';
import { DEFAULT_MODEL_CONFIG } from '../projects/ModelConfigDefaults.js';
import { AgentManager } from '../agents/AgentManager.js';

/**
 * Standalone mirror of AgentManager.resolveModelForRole for focused unit testing.
 *
 * Priority:
 *   1. If the requested model is in the allowed list → use it
 *   2. If the requested model is NOT in the allowed list → fall back to role default, log warning
 *   3. If no model requested → use the first allowed model from project config (role default)
 *   4. If no project config or no restrictions for role → return requestedModel unchanged
 */
function resolveModelForRole(
  roleId: string,
  requestedModel: string | undefined,
  projectId: string | undefined,
  projectConfig: ProjectModelConfig | undefined,
): { model: string | undefined; overridden: boolean; reason?: string } {
  if (!projectId || !projectConfig) {
    return { model: requestedModel, overridden: false };
  }

  const allowedModels = projectConfig[roleId];

  if (!allowedModels || allowedModels.length === 0) {
    return { model: requestedModel, overridden: false };
  }

  const roleDefault = allowedModels[0];

  if (!requestedModel) {
    return { model: roleDefault, overridden: false, reason: `Using project default model for role "${roleId}"` };
  }

  if (allowedModels.includes(requestedModel)) {
    return { model: requestedModel, overridden: false };
  }

  // Requested model is not in the allowed list — enforce config
  return {
    model: roleDefault,
    overridden: true,
    reason: `Model "${requestedModel}" is not in the allowed list for role "${roleId}". Using "${roleDefault}" instead. Allowed: [${allowedModels.join(', ')}]`,
  };
}

// ── Test data ────────────────────────────────────────────────────────

const sampleConfig: ProjectModelConfig = {
  developer: ['claude-opus-4.6'],
  architect: ['claude-sonnet-4.6', 'claude-opus-4.6'],
  'code-reviewer': ['gemini-3-pro-preview', 'claude-sonnet-4.6'],
  secretary: ['gpt-4.1'],
};

// ── Tests ────────────────────────────────────────────────────────────

describe('resolveModelForRole (model config enforcement)', () => {
  describe('no project context', () => {
    it('returns requestedModel unchanged when no projectId', () => {
      const result = resolveModelForRole('developer', 'claude-sonnet-4.6', undefined, sampleConfig);
      expect(result.model).toBe('claude-sonnet-4.6');
      expect(result.overridden).toBe(false);
    });

    it('returns requestedModel unchanged when no projectConfig', () => {
      const result = resolveModelForRole('developer', 'claude-sonnet-4.6', 'proj-1', undefined);
      expect(result.model).toBe('claude-sonnet-4.6');
      expect(result.overridden).toBe(false);
    });

    it('returns undefined model when no projectId and no requestedModel', () => {
      const result = resolveModelForRole('developer', undefined, undefined, undefined);
      expect(result.model).toBeUndefined();
      expect(result.overridden).toBe(false);
    });
  });

  describe('no restrictions for role', () => {
    it('returns requestedModel when role has no entry in config', () => {
      const result = resolveModelForRole('qa-tester', 'claude-opus-4.6', 'proj-1', sampleConfig);
      expect(result.model).toBe('claude-opus-4.6');
      expect(result.overridden).toBe(false);
    });

    it('returns requestedModel when role has empty allowed list', () => {
      const configWithEmpty: ProjectModelConfig = { ...sampleConfig, 'qa-tester': [] };
      const result = resolveModelForRole('qa-tester', 'claude-opus-4.6', 'proj-1', configWithEmpty);
      expect(result.model).toBe('claude-opus-4.6');
      expect(result.overridden).toBe(false);
    });
  });

  describe('model in allowed list', () => {
    it('allows the requested model when it is in the allowed list', () => {
      const result = resolveModelForRole('architect', 'claude-opus-4.6', 'proj-1', sampleConfig);
      expect(result.model).toBe('claude-opus-4.6');
      expect(result.overridden).toBe(false);
    });

    it('allows the first model in the allowed list', () => {
      const result = resolveModelForRole('architect', 'claude-sonnet-4.6', 'proj-1', sampleConfig);
      expect(result.model).toBe('claude-sonnet-4.6');
      expect(result.overridden).toBe(false);
    });
  });

  describe('model NOT in allowed list (enforcement)', () => {
    it('overrides to role default when requested model is not allowed', () => {
      const result = resolveModelForRole('developer', 'claude-haiku-4.5', 'proj-1', sampleConfig);
      expect(result.model).toBe('claude-opus-4.6'); // developer default
      expect(result.overridden).toBe(true);
      expect(result.reason).toContain('claude-haiku-4.5');
      expect(result.reason).toContain('not in the allowed list');
      expect(result.reason).toContain('developer');
    });

    it('overrides to role default for multi-model allowed list', () => {
      // architect allows sonnet and opus — requesting haiku should fall back to sonnet (first)
      const result = resolveModelForRole('architect', 'claude-haiku-4.5', 'proj-1', sampleConfig);
      expect(result.model).toBe('claude-sonnet-4.6');
      expect(result.overridden).toBe(true);
    });

    it('includes allowed models in the reason message', () => {
      const result = resolveModelForRole('code-reviewer', 'claude-opus-4.6', 'proj-1', sampleConfig);
      expect(result.model).toBe('gemini-3-pro-preview');
      expect(result.overridden).toBe(true);
      expect(result.reason).toContain('gemini-3-pro-preview');
      expect(result.reason).toContain('claude-sonnet-4.6');
    });
  });

  describe('no model requested (auto-assign from config)', () => {
    it('assigns role default when no model requested and config exists', () => {
      const result = resolveModelForRole('developer', undefined, 'proj-1', sampleConfig);
      expect(result.model).toBe('claude-opus-4.6');
      expect(result.overridden).toBe(false);
      expect(result.reason).toContain('project default');
    });

    it('assigns first allowed model for secretary role', () => {
      const result = resolveModelForRole('secretary', undefined, 'proj-1', sampleConfig);
      expect(result.model).toBe('gpt-4.1');
      expect(result.overridden).toBe(false);
    });

    it('returns undefined when role has no config entry and no model requested', () => {
      const result = resolveModelForRole('qa-tester', undefined, 'proj-1', sampleConfig);
      expect(result.model).toBeUndefined();
      expect(result.overridden).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('handles single-model allowed list correctly', () => {
      const result = resolveModelForRole('secretary', 'claude-opus-4.6', 'proj-1', sampleConfig);
      expect(result.model).toBe('gpt-4.1'); // only allowed model
      expect(result.overridden).toBe(true);
    });

    it('works with custom role names', () => {
      const customConfig: ProjectModelConfig = {
        'my-custom-role': ['gpt-5.1-codex', 'claude-sonnet-4.6'],
      };
      const result = resolveModelForRole('my-custom-role', 'gpt-5.1-codex', 'proj-1', customConfig);
      expect(result.model).toBe('gpt-5.1-codex');
      expect(result.overridden).toBe(false);
    });

    it('is case-sensitive on model IDs', () => {
      const result = resolveModelForRole('developer', 'Claude-Opus-4.6', 'proj-1', sampleConfig);
      // Model IDs are case-sensitive — "Claude-Opus-4.6" !== "claude-opus-4.6"
      expect(result.overridden).toBe(true);
      expect(result.model).toBe('claude-opus-4.6');
    });
  });
});

// ── Integration tests: real AgentManager.resolveModelForRole() ───────

describe('AgentManager.resolveModelForRole (integration)', () => {
  function createMockProjectRegistry(configMap: Record<string, ProjectModelConfig>) {
    return {
      getModelConfig(projectId: string) {
        const stored = configMap[projectId] ?? {};
        const merged = { ...DEFAULT_MODEL_CONFIG, ...stored };
        return { config: merged, defaults: DEFAULT_MODEL_CONFIG };
      },
    };
  }

  function callResolve(
    projectRegistry: ReturnType<typeof createMockProjectRegistry> | undefined,
    roleId: string,
    requestedModel: string | undefined,
    projectId: string | undefined,
  ) {
    // Call the real AgentManager method via prototype with a minimal context
    return AgentManager.prototype.resolveModelForRole.call(
      { projectRegistry },
      roleId,
      requestedModel,
      projectId,
    );
  }

  it('enforces allowed models from a mocked ProjectRegistry', () => {
    const registry = createMockProjectRegistry({
      'proj-1': { developer: ['claude-opus-4.6'], architect: ['claude-sonnet-4.6'] },
    });
    // Developer requesting haiku — should be overridden to opus
    const result = callResolve(registry, 'developer', 'claude-haiku-4.5', 'proj-1');
    expect(result.model).toBe('claude-opus-4.6');
    expect(result.overridden).toBe(true);
    expect(result.reason).toContain('claude-haiku-4.5');
  });

  it('allows a model that is in the configured allowed list', () => {
    const registry = createMockProjectRegistry({
      'proj-1': { architect: ['claude-sonnet-4.6', 'claude-opus-4.6'] },
    });
    const result = callResolve(registry, 'architect', 'claude-opus-4.6', 'proj-1');
    expect(result.model).toBe('claude-opus-4.6');
    expect(result.overridden).toBe(false);
  });

  it('uses role default when no model is requested', () => {
    const registry = createMockProjectRegistry({
      'proj-1': { secretary: ['gpt-4.1'] },
    });
    const result = callResolve(registry, 'secretary', undefined, 'proj-1');
    expect(result.model).toBe('gpt-4.1');
    expect(result.overridden).toBe(false);
  });

  it('passes through when no projectRegistry is set', () => {
    const result = callResolve(undefined, 'developer', 'claude-haiku-4.5', 'proj-1');
    expect(result.model).toBe('claude-haiku-4.5');
    expect(result.overridden).toBe(false);
  });

  it('falls back to DEFAULT_MODEL_CONFIG for roles not in stored config', () => {
    const registry = createMockProjectRegistry({
      'proj-1': {}, // empty stored config — defaults apply
    });
    // developer defaults to ['claude-opus-4.6'] in DEFAULT_MODEL_CONFIG
    const result = callResolve(registry, 'developer', undefined, 'proj-1');
    expect(result.model).toBe(DEFAULT_MODEL_CONFIG['developer']?.[0]);
    expect(result.overridden).toBe(false);
  });
});
