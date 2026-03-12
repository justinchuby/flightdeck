/**
 * AdapterFactory tests.
 *
 * Covers: backend resolution, adapter creation,
 * start options building, and configuration handling.
 *
 * All providers now resolve to ACP backend (no SDK adapters active).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveBackend,
  createAdapterForProvider,
  buildStartOptions,
} from './AdapterFactory.js';
import type { AdapterConfig } from './AdapterFactory.js';

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('AdapterFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── resolveBackend() ─────────────────────────────────────

  describe('resolveBackend()', () => {
    it('returns acp for copilot', () => {
      expect(resolveBackend('copilot')).toBe('acp');
    });

    it('returns acp for claude', () => {
      expect(resolveBackend('claude')).toBe('acp');
    });

    it('returns acp for gemini', () => {
      expect(resolveBackend('gemini')).toBe('acp');
    });

    it('returns acp for opencode', () => {
      expect(resolveBackend('opencode')).toBe('acp');
    });

    it('returns acp for cursor', () => {
      expect(resolveBackend('cursor')).toBe('acp');
    });

    it('returns acp for codex', () => {
      expect(resolveBackend('codex')).toBe('acp');
    });

    it('returns mock for mock provider', () => {
      expect(resolveBackend('mock')).toBe('mock');
    });

    it('returns acp for unknown providers', () => {
      expect(resolveBackend('unknown-cli')).toBe('acp');
    });

  });

  // ── createAdapterForProvider() ───────────────────────────

  describe('createAdapterForProvider()', () => {
    it('creates AcpAdapter for copilot', async () => {
      const result = await createAdapterForProvider({ provider: 'copilot' });
      expect(result.adapter.type).toBe('acp');
      expect(result.backend).toBe('acp');
      expect(result.fallback).toBe(false);
    });

    it('creates AcpAdapter for claude', async () => {
      const result = await createAdapterForProvider({ provider: 'claude' });
      expect(result.adapter.type).toBe('acp');
      expect(result.backend).toBe('acp');
      expect(result.fallback).toBe(false);
    });

    it('creates AcpAdapter for gemini', async () => {
      const result = await createAdapterForProvider({ provider: 'gemini' });
      expect(result.adapter.type).toBe('acp');
      expect(result.backend).toBe('acp');
    });

    it('creates AcpAdapter for opencode', async () => {
      const result = await createAdapterForProvider({ provider: 'opencode' });
      expect(result.backend).toBe('acp');
    });

    it('creates AcpAdapter for cursor', async () => {
      const result = await createAdapterForProvider({ provider: 'cursor' });
      expect(result.backend).toBe('acp');
    });

    it('creates AcpAdapter for codex', async () => {
      const result = await createAdapterForProvider({ provider: 'codex' });
      expect(result.backend).toBe('acp');
    });

    it('creates MockAdapter for mock provider', async () => {
      const result = await createAdapterForProvider({ provider: 'mock' });
      expect(result.adapter.type).toBe('mock');
      expect(result.backend).toBe('mock');
    });

    it('handles unknown provider gracefully (defaults to ACP)', async () => {
      const result = await createAdapterForProvider({ provider: 'unknown-new-cli' });
      expect(result.backend).toBe('acp');
      expect(result.adapter.type).toBe('acp');
    });
  });

  // ── buildStartOptions() ──────────────────────────────────

  describe('buildStartOptions()', () => {
    const baseConfig: AdapterConfig = {
      provider: 'copilot',
      cliCommand: 'copilot',
      cliArgs: [],
    };

    it('resolves binary from preset when no override', () => {
      const { options: opts } = buildStartOptions(
        { ...baseConfig, provider: 'gemini' },
        { cwd: '/test' },
      );
      // Gemini preset binary is 'gemini'
      expect(opts.cliCommand).toBe('gemini');
    });

    it('uses binaryOverride when provided', () => {
      const { options: opts } = buildStartOptions(
        { ...baseConfig, binaryOverride: '/usr/local/bin/my-copilot' },
        { cwd: '/test' },
      );
      expect(opts.cliCommand).toBe('/usr/local/bin/my-copilot');
    });

    it('includes --agent flag from agentFlag', () => {
      const { options: opts } = buildStartOptions(
        baseConfig,
        { cwd: '/test', agentFlag: 'developer' },
      );
      expect(opts.cliArgs).toContain('--agent=developer');
    });

    it.each(['gemini', 'claude', 'codex', 'opencode', 'cursor'] as const)(
      'skips --agent flag for %s provider (unsupported)',
      (provider) => {
        const { options: opts } = buildStartOptions(
          { ...baseConfig, provider },
          { cwd: '/test', agentFlag: 'flightdeck-developer' },
        );
        const agentArgs = (opts.cliArgs ?? []).filter((a: string) => a.startsWith('--agent='));
        expect(agentArgs).toHaveLength(0);
      },
    );

    it('includes --model flag when model provided', () => {
      const { options: opts } = buildStartOptions(
        { ...baseConfig, model: 'claude-sonnet-4' },
        { cwd: '/test' },
      );
      expect(opts.cliArgs).toContain('--model');
      expect(opts.cliArgs).toContain('claude-sonnet-4');
    });

    it('passes sessionId through opts without --resume CLI flag', () => {
      const { options: opts } = buildStartOptions(
        baseConfig,
        { cwd: '/test', sessionId: 'session-abc-123' },
      );
      // sessionId is passed via opts for ACP's session/load protocol, not as a CLI flag
      expect(opts.sessionId).toBe('session-abc-123');
      expect(opts.cliArgs).not.toContain('--resume');
    });

    it('uses argsOverride when provided', () => {
      const { options: opts } = buildStartOptions(
        { ...baseConfig, argsOverride: ['--custom-flag'] },
        { cwd: '/test' },
      );
      expect(opts.baseArgs).toEqual(['--custom-flag']);
    });

    it('merges env from preset and envOverride, filtering empty values', () => {
      const { options: opts } = buildStartOptions(
        {
          ...baseConfig,
          provider: 'gemini',
          envOverride: { EXTRA_KEY: 'value', EMPTY_KEY: '' },
        },
        { cwd: '/test' },
      );
      // Should include EXTRA_KEY but not EMPTY_KEY
      if (opts.env) {
        expect(opts.env.EXTRA_KEY).toBe('value');
        expect(opts.env.EMPTY_KEY).toBeUndefined();
      }
    });

    it('returns undefined env when all values are empty', () => {
      const { options: opts } = buildStartOptions(
        { ...baseConfig, envOverride: { EMPTY: '' } },
        { cwd: '/test' },
      );
      expect(opts.env).toBeUndefined();
    });

    it('sets cwd from agentOpts', () => {
      const { options: opts } = buildStartOptions(baseConfig, { cwd: '/custom/path' });
      expect(opts.cwd).toBe('/custom/path');
    });

    it('falls back to cliCommand config when no preset binary', () => {
      const { options: opts } = buildStartOptions(
        { ...baseConfig, provider: 'unknown-provider', cliCommand: 'my-binary' },
        { cwd: '/test' },
      );
      expect(opts.cliCommand).toBe('my-binary');
    });

    it('passes through maxTurns', () => {
      const { options: opts } = buildStartOptions(
        baseConfig,
        { cwd: '/test', maxTurns: 10 },
      );
      expect(opts.maxTurns).toBe(10);
    });

    it('resolves model via ModelResolver', () => {
      // 'standard' tier alias for copilot should resolve to a specific model
      const { options: opts } = buildStartOptions(
        { ...baseConfig, model: 'standard' },
        { cwd: '/test' },
      );
      expect(opts.cliArgs).toContain('--model');
      // The resolved model should be in the args (exact model depends on ModelResolver)
      expect(opts.model).toBeTruthy();
    });

    it('passes through base cliArgs from config', () => {
      const { options: opts } = buildStartOptions(
        { ...baseConfig, cliArgs: ['--verbose', '--no-color'] },
        { cwd: '/test', agentFlag: 'lead' },
      );
      expect(opts.cliArgs).toContain('--verbose');
      expect(opts.cliArgs).toContain('--no-color');
      expect(opts.cliArgs).toContain('--agent=lead');
    });

    it('resolves claude preset with claude-agent-acp binary', () => {
      const { options: opts } = buildStartOptions(
        { ...baseConfig, provider: 'claude' },
        { cwd: '/test' },
      );
      expect(opts.cliCommand).toBe('claude-agent-acp');
    });

    it('resolves codex preset with codex-acp binary and empty args', () => {
      const { options: opts } = buildStartOptions(
        { ...baseConfig, provider: 'codex' },
        { cwd: '/test' },
      );
      expect(opts.cliCommand).toBe('codex-acp');
      expect(opts.baseArgs).toEqual([]);
    });

    it('uses -c model=X for codex instead of --model', () => {
      const { options: opts } = buildStartOptions(
        { ...baseConfig, provider: 'codex', model: 'gpt-5' },
        { cwd: '/test' },
      );
      expect(opts.cliArgs).toContain('-c');
      expect(opts.cliArgs).toContain('model=gpt-5');
      expect(opts.cliArgs).not.toContain('--model');
    });

    it('returns modelResolution metadata when model is translated', () => {
      // claude-opus-4.6 on gemini should translate to a gemini-native model
      const result = buildStartOptions(
        { ...baseConfig, provider: 'gemini', model: 'claude-opus-4.6' },
        { cwd: '/test' },
      );
      expect(result.modelResolution).toBeDefined();
      expect(result.modelResolution!.translated).toBe(true);
      expect(result.modelResolution!.original).toBe('claude-opus-4.6');
      expect(result.modelResolution!.model).not.toBe('claude-opus-4.6');
    });

    it('returns non-translated modelResolution for native models', () => {
      const result = buildStartOptions(
        { ...baseConfig, provider: 'copilot', model: 'claude-sonnet-4' },
        { cwd: '/test' },
      );
      expect(result.modelResolution).toBeDefined();
      expect(result.modelResolution!.translated).toBe(false);
      expect(result.modelResolution!.model).toBe('claude-sonnet-4');
    });

    it('returns undefined modelResolution when no model specified', () => {
      const result = buildStartOptions(baseConfig, { cwd: '/test' });
      expect(result.modelResolution).toBeUndefined();
    });
  });

  // ── Integration: Factory + Start Options ──────────────────

  describe('integration', () => {
    it('copilot: creates AcpAdapter', async () => {
      const config: AdapterConfig = {
        provider: 'copilot',
        cliCommand: 'copilot',
        cliArgs: [],
      };

      const { adapter, backend } = await createAdapterForProvider(config);

      expect(backend).toBe('acp');
      expect(adapter.type).toBe('acp');
    });

    it('claude: creates AcpAdapter', async () => {
      const config: AdapterConfig = {
        provider: 'claude',
      };

      const result = await createAdapterForProvider(config);
      expect(result.backend).toBe('acp');
      expect(result.adapter.type).toBe('acp');
    });

    it('config overrides take precedence over presets', () => {
      const config: AdapterConfig = {
        provider: 'copilot',
        binaryOverride: '/custom/copilot',
        argsOverride: ['--custom-arg'],
        cliCommand: 'copilot',
        cliArgs: [],
      };

      const { options: startOpts } = buildStartOptions(config, { cwd: '/project' });

      expect(startOpts.cliCommand).toBe('/custom/copilot');
      expect(startOpts.baseArgs).toEqual(['--custom-arg']);
    });
  });
});
