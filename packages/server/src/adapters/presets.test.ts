import { describe, it, expect } from 'vitest';
import {
  PROVIDER_PRESETS,
  getPreset,
  listPresets,
  isValidProviderId,
  detectInstalledProviders,
} from './presets.js';
import type { ProviderPreset, ProviderId } from './presets.js';

describe('Provider Presets', () => {
  describe('PROVIDER_PRESETS', () => {
    it('contains exactly 8 providers', () => {
      expect(Object.keys(PROVIDER_PRESETS)).toHaveLength(8);
    });

    it('contains all expected provider IDs', () => {
      const expectedIds: ProviderId[] = ['copilot', 'gemini', 'opencode', 'cursor', 'codex', 'claude'];
      for (const id of expectedIds) {
        expect(PROVIDER_PRESETS[id]).toBeDefined();
      }
    });

    it('all presets have required fields', () => {
      for (const preset of Object.values(PROVIDER_PRESETS) as ProviderPreset[]) {
        expect(preset.id).toBeTruthy();
        expect(preset.name).toBeTruthy();
        expect(preset.binary).toBeTruthy();
        expect(Array.isArray(preset.args)).toBe(true);
        expect(preset.transport).toBe('stdio');
      }
    });

    it('preset id matches its key in the map', () => {
      for (const [key, preset] of Object.entries(PROVIDER_PRESETS) as [string, ProviderPreset][]) {
        expect(preset.id).toBe(key);
      }
    });

    it('all presets have args array (may be empty for some providers)', () => {
      for (const preset of Object.values(PROVIDER_PRESETS) as ProviderPreset[]) {
        expect(Array.isArray(preset.args)).toBe(true);
      }
    });
  });

  describe('Copilot preset (default)', () => {
    it('uses copilot binary with --acp --stdio', () => {
      const preset = PROVIDER_PRESETS.copilot;
      expect(preset.binary).toBe('copilot');
      expect(preset.args).toEqual(['--acp', '--stdio']);
      expect(preset.supportsLoadSession).toBe(true);
    });
  });

  describe('Gemini preset', () => {
    it('uses gemini binary with --acp', () => {
      const preset = PROVIDER_PRESETS.gemini;
      expect(preset.binary).toBe('gemini');
      expect(preset.args).toEqual(['--acp']);
      expect(preset.supportsLoadSession).toBe(true);
      expect(preset.requiredEnvVars).toContain('GEMINI_API_KEY');
    });
  });

  describe('OpenCode preset', () => {
    it('uses opencode binary with acp subcommand', () => {
      const preset = PROVIDER_PRESETS.opencode;
      expect(preset.binary).toBe('opencode');
      expect(preset.args).toEqual(['acp']);
      expect(preset.supportsLoadSession).toBe(true);
    });
  });

  describe('Cursor preset', () => {
    it('uses agent binary with acp subcommand', () => {
      const preset = PROVIDER_PRESETS.cursor;
      expect(preset.binary).toBe('agent');
      expect(preset.args).toEqual(['acp']);
      expect(preset.supportsLoadSession).toBe(true);
    });
  });

  describe('Codex preset', () => {
    it('uses codex-acp binary', () => {
      const preset = PROVIDER_PRESETS.codex;
      expect(preset.binary).toBe('codex-acp');
      expect(preset.args).toEqual([]);
      expect(preset.supportsLoadSession).toBe(true);
      expect(preset.requiredEnvVars).toContain('OPENAI_API_KEY');
    });
  });

  describe('Claude preset', () => {
    it('uses claude-agent-acp binary', () => {
      const preset = PROVIDER_PRESETS.claude;
      expect(preset.binary).toBe('claude-agent-acp');
      expect(preset.args).toEqual([]);
      expect(preset.supportsLoadSession).toBe(true);
      expect(preset.requiredEnvVars).toContain('ANTHROPIC_API_KEY');
      expect(preset.agentFileFormat).toBe('CLAUDE.md');
    });
  });

  describe('Kimi preset', () => {
    it('uses kimi binary with acp subcommand', () => {
      const preset = PROVIDER_PRESETS.kimi;
      expect(preset.binary).toBe('kimi');
      expect(preset.args).toEqual(['acp']);
      expect(preset.supportsLoadSession).toBe(true);
    });
  });

  describe('Qwen Code preset', () => {
    it('uses qwen binary with --acp flag', () => {
      const preset = PROVIDER_PRESETS['qwen-code'];
      expect(preset.binary).toBe('qwen');
      expect(preset.args).toEqual(['--acp', '--experimental-skills']);
      expect(preset.supportsLoadSession).toBe(true);
    });
  });

  describe('getPreset()', () => {
    it('returns the preset for a valid provider ID', () => {
      const preset = getPreset('copilot');
      expect(preset).toBeDefined();
      expect(preset!.id).toBe('copilot');
      expect(preset!.name).toBe('GitHub Copilot');
    });

    it('returns undefined for an unknown provider ID', () => {
      expect(getPreset('unknown-cli')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(getPreset('')).toBeUndefined();
    });

    it('returns correct preset for each provider', () => {
      for (const [id, expected] of Object.entries(PROVIDER_PRESETS) as [string, ProviderPreset][]) {
        const preset = getPreset(id);
        expect(preset).toBe(expected);
      }
    });
  });

  describe('listPresets()', () => {
    it('returns all 8 presets', () => {
      const presets = listPresets();
      expect(presets).toHaveLength(8);
    });

    it('returns ProviderPreset objects', () => {
      const presets = listPresets();
      for (const preset of presets) {
        expect(preset).toHaveProperty('id');
        expect(preset).toHaveProperty('name');
        expect(preset).toHaveProperty('binary');
        expect(preset).toHaveProperty('args');
        expect(preset).toHaveProperty('transport');
      }
    });

    it('includes all provider IDs', () => {
      const presets = listPresets();
      const ids = presets.map((p: ProviderPreset) => p.id);
      expect(ids).toContain('copilot');
      expect(ids).toContain('gemini');
      expect(ids).toContain('opencode');
      expect(ids).toContain('cursor');
      expect(ids).toContain('codex');
      expect(ids).toContain('claude');
    });
  });

  describe('isValidProviderId()', () => {
    it('returns true for valid provider IDs', () => {
      expect(isValidProviderId('copilot')).toBe(true);
      expect(isValidProviderId('gemini')).toBe(true);
      expect(isValidProviderId('opencode')).toBe(true);
      expect(isValidProviderId('cursor')).toBe(true);
      expect(isValidProviderId('codex')).toBe(true);
      expect(isValidProviderId('claude')).toBe(true);
    });

    it('returns false for invalid provider IDs', () => {
      expect(isValidProviderId('unknown')).toBe(false);
      expect(isValidProviderId('')).toBe(false);
      expect(isValidProviderId('COPILOT')).toBe(false);
    });
  });

  describe('detectInstalledProviders()', () => {
    it('returns presets for binaries found on PATH', async () => {
      const checker = async (binary: string) =>
        binary === 'copilot' || binary === 'claude-agent-acp';

      const installed = await detectInstalledProviders(checker);
      const ids = installed.map((p: ProviderPreset) => p.id);
      expect(ids).toContain('copilot');
      expect(ids).toContain('claude');
      expect(ids).not.toContain('gemini');
      expect(ids).not.toContain('codex');
      expect(ids).not.toContain('opencode');
      expect(ids).not.toContain('cursor');
    });

    it('returns empty array when no providers are installed', async () => {
      const checker = async () => false;
      const installed = await detectInstalledProviders(checker);
      expect(installed).toHaveLength(0);
    });

    it('returns all presets when all binaries are available', async () => {
      const checker = async () => true;
      const installed = await detectInstalledProviders(checker);
      expect(installed).toHaveLength(8);
    });

    it('detects a single provider correctly', async () => {
      const checker = async (binary: string) => binary === 'gemini';
      const installed = await detectInstalledProviders(checker);
      expect(installed).toHaveLength(1);
      expect(installed[0].id).toBe('gemini');
    });
  });
});
