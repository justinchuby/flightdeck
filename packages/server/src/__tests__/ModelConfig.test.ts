import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '../db/database.js';
import { ProjectRegistry } from '../projects/ProjectRegistry.js';
import {
  DEFAULT_MODEL_CONFIG,
  KNOWN_MODEL_IDS,
  validateModelConfig,
  validateModelConfigShape,
  type ProjectModelConfig,
} from '../projects/ModelConfigDefaults.js';

describe('ModelConfigDefaults', () => {
  describe('validateModelConfigShape', () => {
    it('accepts valid config', () => {
      expect(validateModelConfigShape({ developer: ['claude-opus-4.6'] })).toBeNull();
    });

    it('accepts empty object', () => {
      expect(validateModelConfigShape({})).toBeNull();
    });

    it('rejects null', () => {
      expect(validateModelConfigShape(null)).toBeTruthy();
    });

    it('rejects arrays', () => {
      expect(validateModelConfigShape([])).toBeTruthy();
    });

    it('rejects non-object', () => {
      expect(validateModelConfigShape('string')).toBeTruthy();
    });

    it('rejects non-array values', () => {
      const err = validateModelConfigShape({ developer: 'claude-opus-4.6' });
      expect(err).toContain('developer');
      expect(err).toContain('array');
    });

    it('rejects non-string elements in arrays', () => {
      const err = validateModelConfigShape({ developer: [123] });
      expect(err).toContain('developer');
      expect(err).toContain('non-string');
    });

    it('rejects empty model arrays', () => {
      const err = validateModelConfigShape({ developer: [] });
      expect(err).toBe('Each role must have at least one model selected.');
    });

    it('rejects config where one role has empty array among valid ones', () => {
      const err = validateModelConfigShape({
        developer: ['claude-opus-4.6'],
        architect: [],
      });
      expect(err).toBe('Each role must have at least one model selected.');
    });
  });

  describe('validateModelConfig', () => {
    it('returns empty for valid config', () => {
      expect(validateModelConfig({ developer: ['claude-opus-4.6'] })).toEqual([]);
    });

    it('returns unknown model IDs', () => {
      const unknown = validateModelConfig({
        developer: ['claude-opus-4.6', 'fake-model'],
        architect: ['also-fake'],
      });
      expect(unknown).toContain('fake-model');
      expect(unknown).toContain('also-fake');
      expect(unknown).toHaveLength(2);
    });

    it('validates all default config model IDs are known', () => {
      const unknown = validateModelConfig(DEFAULT_MODEL_CONFIG);
      expect(unknown).toEqual([]);
    });
  });

  describe('KNOWN_MODEL_IDS', () => {
    it('includes all AVAILABLE_MODELS IDs', () => {
      const available = ['claude-haiku-4.5', 'claude-sonnet-4.6', 'claude-opus-4.6', 'gemini-3-pro-preview', 'gpt-5.1-codex'];
      for (const id of available) {
        expect(KNOWN_MODEL_IDS).toContain(id);
      }
    });

    it('includes models used in RoleRegistry', () => {
      const roleModels = ['gpt-4.1', 'gpt-5.2', 'gpt-5.3-codex'];
      for (const id of roleModels) {
        expect(KNOWN_MODEL_IDS).toContain(id);
      }
    });
  });

  describe('DEFAULT_MODEL_CONFIG', () => {
    it('has developer defaults', () => {
      expect(DEFAULT_MODEL_CONFIG.developer).toEqual(['claude-opus-4.6']);
    });

    it('has architect defaults', () => {
      expect(DEFAULT_MODEL_CONFIG.architect).toEqual(['claude-opus-4.6']);
    });

    it('has code-reviewer defaults', () => {
      expect(DEFAULT_MODEL_CONFIG['code-reviewer']).toEqual(['gemini-3-pro-preview', 'claude-opus-4.6']);
    });

    it('has critical-reviewer defaults', () => {
      expect(DEFAULT_MODEL_CONFIG['critical-reviewer']).toEqual(['gemini-3-pro-preview']);
    });

    it('has readability-reviewer defaults', () => {
      expect(DEFAULT_MODEL_CONFIG['readability-reviewer']).toEqual(['gemini-3-pro-preview']);
    });

    it('has tech-writer defaults', () => {
      expect(DEFAULT_MODEL_CONFIG['tech-writer']).toEqual(['claude-sonnet-4.6', 'gpt-5.2', 'claude-opus-4.6']);
    });

    it('has secretary defaults', () => {
      expect(DEFAULT_MODEL_CONFIG.secretary).toEqual(['gpt-4.1', 'gpt-5.2', 'gpt-5.1']);
    });
  });
});

describe('ProjectRegistry model config', () => {
  let db: Database;
  let registry: ProjectRegistry;

  beforeEach(() => {
    db = new Database(':memory:');
    registry = new ProjectRegistry(db);
  });

  describe('getModelConfig', () => {
    it('returns defaults when no custom config is set', () => {
      const project = registry.create('Test');
      const result = registry.getModelConfig(project.id);
      expect(result.defaults).toEqual(DEFAULT_MODEL_CONFIG);
      expect(result.config).toEqual(DEFAULT_MODEL_CONFIG);
    });

    it('merges custom config over defaults', () => {
      const project = registry.create('Test');
      const custom: ProjectModelConfig = { developer: ['claude-sonnet-4.6'] };
      registry.setModelConfig(project.id, custom);

      const result = registry.getModelConfig(project.id);
      expect(result.config.developer).toEqual(['claude-sonnet-4.6']);
      // Other roles still use defaults
      expect(result.config.architect).toEqual(DEFAULT_MODEL_CONFIG.architect);
      expect(result.config.secretary).toEqual(DEFAULT_MODEL_CONFIG.secretary);
    });

    it('custom config fully overrides a role', () => {
      const project = registry.create('Test');
      const custom: ProjectModelConfig = {
        architect: ['claude-haiku-4.5'],
      };
      registry.setModelConfig(project.id, custom);

      const result = registry.getModelConfig(project.id);
      expect(result.config.architect).toEqual(['claude-haiku-4.5']);
    });

    it('supports adding custom roles not in defaults', () => {
      const project = registry.create('Test');
      const custom: ProjectModelConfig = {
        'my-custom-role': ['claude-opus-4.6'],
      };
      registry.setModelConfig(project.id, custom);

      const result = registry.getModelConfig(project.id);
      expect(result.config['my-custom-role']).toEqual(['claude-opus-4.6']);
      // Defaults still present
      expect(result.config.developer).toEqual(DEFAULT_MODEL_CONFIG.developer);
    });
  });

  describe('setModelConfig', () => {
    it('persists config across reads', () => {
      const project = registry.create('Test');
      const custom: ProjectModelConfig = {
        developer: ['gemini-3-pro-preview'],
        secretary: ['claude-haiku-4.5'],
      };
      registry.setModelConfig(project.id, custom);

      // Read from a fresh registry instance to confirm DB persistence
      const registry2 = new ProjectRegistry(db);
      const result = registry2.getModelConfig(project.id);
      expect(result.config.developer).toEqual(['gemini-3-pro-preview']);
      expect(result.config.secretary).toEqual(['claude-haiku-4.5']);
    });

    it('replaces previous config entirely', () => {
      const project = registry.create('Test');
      registry.setModelConfig(project.id, { developer: ['claude-haiku-4.5'] });
      registry.setModelConfig(project.id, { architect: ['gpt-4.1'] });

      const result = registry.getModelConfig(project.id);
      // developer goes back to default since second set didn't include it
      expect(result.config.developer).toEqual(DEFAULT_MODEL_CONFIG.developer);
      expect(result.config.architect).toEqual(['gpt-4.1']);
    });

    it('can set empty config to restore all defaults', () => {
      const project = registry.create('Test');
      registry.setModelConfig(project.id, { developer: ['claude-haiku-4.5'] });
      registry.setModelConfig(project.id, {});

      const result = registry.getModelConfig(project.id);
      expect(result.config).toEqual(DEFAULT_MODEL_CONFIG);
    });
  });
});
