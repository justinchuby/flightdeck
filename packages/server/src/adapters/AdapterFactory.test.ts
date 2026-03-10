/**
 * AdapterFactory tests.
 *
 * Covers: backend resolution, adapter creation, SDK fallback,
 * start options building, and configuration handling.
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

// Mock Claude SDK (for ClaudeSdkAdapter's dynamic import)
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  listSessions: vi.fn(),
}));

describe('AdapterFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── resolveBackend() ─────────────────────────────────────

  describe('resolveBackend()', () => {
    it('returns copilot-sdk for copilot', () => {
      expect(resolveBackend('copilot')).toBe('copilot-sdk');
    });

    it('returns claude-sdk for claude', () => {
      expect(resolveBackend('claude')).toBe('claude-sdk');
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
    it('creates CopilotSdkAdapter for copilot (always SDK)', async () => {
      const result = await createAdapterForProvider({ provider: 'copilot' });
      expect(result.adapter.type).toBe('copilot-sdk');
      expect(result.backend).toBe('copilot-sdk');
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

    it('creates ClaudeSdkAdapter for claude', async () => {
      const result = await createAdapterForProvider({ provider: 'claude' });
      expect(result.adapter.type).toBe('claude-sdk');
      expect(result.backend).toBe('claude-sdk');
      expect(result.fallback).toBe(false);
    });

    it('creates MockAdapter for mock provider', async () => {
      const result = await createAdapterForProvider({ provider: 'mock' });
      expect(result.adapter.type).toBe('mock');
      expect(result.backend).toBe('mock');
    });

    it('passes autopilot to CopilotSdkAdapter', async () => {
      const result = await createAdapterForProvider({
        provider: 'copilot',
        autopilot: true,
      });
      expect(result.adapter.type).toBe('copilot-sdk');
      expect(result.backend).toBe('copilot-sdk');
    });

    it('passes autopilot and model to ClaudeSdkAdapter', async () => {
      const result = await createAdapterForProvider({
        provider: 'claude',
        autopilot: true,
        model: 'claude-opus-4',
      });
      expect(result.adapter.type).toBe('claude-sdk');
      expect(result.backend).toBe('claude-sdk');
    });

    it('falls back to ACP when ClaudeSdkAdapter constructor throws', async () => {
      // Clear module cache so doMock takes effect on re-import
      vi.resetModules();

      // Re-mock logger (cleared by resetModules)
      vi.doMock('../utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      }));

      // Mock a broken ClaudeSdkAdapter
      vi.doMock('./ClaudeSdkAdapter.js', () => ({
        ClaudeSdkAdapter: class {
          constructor() {
            throw new Error('SDK package not installed');
          }
        },
      }));

      // Re-import factory to pick up the mock
      const { createAdapterForProvider: createWithBrokenSdk } = await import('./AdapterFactory.js');
      const result = await createWithBrokenSdk({
        provider: 'claude',
      });

      expect(result.backend).toBe('acp');
      expect(result.fallback).toBe(true);
      expect(result.fallbackReason).toContain('SDK package not installed');
      expect(result.adapter.type).toBe('acp');

      // Clean up: reset modules and remove doMock so subsequent dynamic imports get real modules
      vi.resetModules();
      vi.unmock('./ClaudeSdkAdapter.js');
      vi.unmock('../utils/logger.js');
    });

    it('falls back to ACP when CopilotSdkAdapter constructor throws', async () => {
      vi.resetModules();

      vi.doMock('../utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      }));

      vi.doMock('./CopilotSdkAdapter.js', () => ({
        CopilotSdkAdapter: class {
          constructor() {
            throw new Error('Copilot SDK not installed');
          }
        },
      }));

      const { createAdapterForProvider: createWithBrokenSdk } = await import('./AdapterFactory.js');
      const result = await createWithBrokenSdk({ provider: 'copilot' });

      expect(result.backend).toBe('acp');
      expect(result.fallback).toBe(true);
      expect(result.fallbackReason).toContain('Copilot SDK not installed');
      expect(result.adapter.type).toBe('acp');

      vi.resetModules();
      vi.unmock('./CopilotSdkAdapter.js');
      vi.unmock('../utils/logger.js');
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
      const opts = buildStartOptions(
        { ...baseConfig, provider: 'gemini' },
        { cwd: '/test' },
      );
      // Gemini preset binary is 'gemini'
      expect(opts.cliCommand).toBe('gemini');
    });

    it('uses binaryOverride when provided', () => {
      const opts = buildStartOptions(
        { ...baseConfig, binaryOverride: '/usr/local/bin/my-copilot' },
        { cwd: '/test' },
      );
      expect(opts.cliCommand).toBe('/usr/local/bin/my-copilot');
    });

    it('includes --agent flag from agentFlag', () => {
      const opts = buildStartOptions(
        baseConfig,
        { cwd: '/test', agentFlag: 'developer' },
      );
      expect(opts.cliArgs).toContain('--agent=developer');
    });

    it('includes --model flag when model provided', () => {
      const opts = buildStartOptions(
        { ...baseConfig, model: 'claude-sonnet-4' },
        { cwd: '/test' },
      );
      expect(opts.cliArgs).toContain('--model');
      expect(opts.cliArgs).toContain('claude-sonnet-4');
    });

    it('passes sessionId through opts without --resume CLI flag', () => {
      const opts = buildStartOptions(
        baseConfig,
        { cwd: '/test', sessionId: 'session-abc-123' },
      );
      // sessionId is passed via opts for ACP's session/load protocol, not as a CLI flag
      expect(opts.sessionId).toBe('session-abc-123');
      expect(opts.cliArgs).not.toContain('--resume');
    });

    it('uses argsOverride when provided', () => {
      const opts = buildStartOptions(
        { ...baseConfig, argsOverride: ['--custom-flag'] },
        { cwd: '/test' },
      );
      expect(opts.baseArgs).toEqual(['--custom-flag']);
    });

    it('merges env from preset and envOverride, filtering empty values', () => {
      const opts = buildStartOptions(
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
      const opts = buildStartOptions(
        { ...baseConfig, envOverride: { EMPTY: '' } },
        { cwd: '/test' },
      );
      expect(opts.env).toBeUndefined();
    });

    it('sets cwd from agentOpts', () => {
      const opts = buildStartOptions(baseConfig, { cwd: '/custom/path' });
      expect(opts.cwd).toBe('/custom/path');
    });

    it('falls back to cliCommand config when no preset binary', () => {
      const opts = buildStartOptions(
        { ...baseConfig, provider: 'unknown-provider', cliCommand: 'my-binary' },
        { cwd: '/test' },
      );
      expect(opts.cliCommand).toBe('my-binary');
    });

    it('passes through maxTurns and systemPrompt', () => {
      const opts = buildStartOptions(
        baseConfig,
        { cwd: '/test', maxTurns: 10, systemPrompt: 'You are a helper.' },
      );
      expect(opts.maxTurns).toBe(10);
      expect(opts.systemPrompt).toBe('You are a helper.');
    });

    it('resolves model via ModelResolver', () => {
      // 'standard' tier alias for copilot should resolve to a specific model
      const opts = buildStartOptions(
        { ...baseConfig, model: 'standard' },
        { cwd: '/test' },
      );
      expect(opts.cliArgs).toContain('--model');
      // The resolved model should be in the args (exact model depends on ModelResolver)
      expect(opts.model).toBeTruthy();
    });

    it('passes through base cliArgs from config', () => {
      const opts = buildStartOptions(
        { ...baseConfig, cliArgs: ['--verbose', '--no-color'] },
        { cwd: '/test', agentFlag: 'lead' },
      );
      expect(opts.cliArgs).toContain('--verbose');
      expect(opts.cliArgs).toContain('--no-color');
      expect(opts.cliArgs).toContain('--agent=lead');
    });
  });

  // ── Integration: Factory + Start Options ──────────────────

  describe('integration', () => {
    it('copilot: always creates CopilotSdkAdapter (never ACP)', async () => {
      // Fresh import needed since earlier fallback tests reset modules
      vi.resetModules();
      vi.doMock('../utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      }));
      // Restore real CopilotSdkAdapter (may have been broken-mocked by fallback test)
      vi.doMock('./CopilotSdkAdapter.js', () => vi.importActual('./CopilotSdkAdapter.js'));
      const { createAdapterForProvider: freshFactory } = await import('./AdapterFactory.js');

      const config: AdapterConfig = {
        provider: 'copilot',
        cliCommand: 'copilot',
        cliArgs: [],
      };

      const { adapter, backend } = await freshFactory(config);

      expect(backend).toBe('copilot-sdk');
      expect(adapter.type).toBe('copilot-sdk');

      vi.resetModules();
      vi.unmock('./CopilotSdkAdapter.js');
      vi.unmock('../utils/logger.js');
    });

    it('claude SDK mode: creates SDK adapter', async () => {
      // Reset and re-import to ensure clean module state after fallback test's doMock
      vi.resetModules();
      vi.doMock('../utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      }));
      vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
        query: vi.fn(),
        listSessions: vi.fn(),
      }));
      // Restore real ClaudeSdkAdapter (overrides the broken mock from fallback test)
      vi.doMock('./ClaudeSdkAdapter.js', () => vi.importActual('./ClaudeSdkAdapter.js'));
      const { createAdapterForProvider: freshFactory } = await import('./AdapterFactory.js');

      const config: AdapterConfig = {
        provider: 'claude',
        model: 'claude-opus-4',
      };

      const result = await freshFactory(config);
      expect(result.backend).toBe('claude-sdk');
      expect(result.adapter.type).toBe('claude-sdk');
    });

    it('claude falls back to ACP if SDK unavailable', async () => {
      vi.resetModules();
      vi.doMock('../utils/logger.js', () => ({
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      }));
      vi.doMock('./ClaudeSdkAdapter.js', () => ({
        ClaudeSdkAdapter: class {
          constructor() { throw new Error('SDK not installed'); }
        },
      }));
      const { createAdapterForProvider: freshFactory } = await import('./AdapterFactory.js');

      const config: AdapterConfig = {
        provider: 'claude',
        cliCommand: 'claude',
        cliArgs: [],
      };

      const { adapter, backend, fallback } = await freshFactory(config);
      expect(backend).toBe('acp');
      expect(adapter.type).toBe('acp');
      expect(fallback).toBe(true);
    });

    it('config overrides take precedence over presets', () => {
      const config: AdapterConfig = {
        provider: 'copilot',
        binaryOverride: '/custom/copilot',
        argsOverride: ['--custom-arg'],
        cliCommand: 'copilot',
        cliArgs: [],
      };

      const startOpts = buildStartOptions(config, { cwd: '/project' });

      expect(startOpts.cliCommand).toBe('/custom/copilot');
      expect(startOpts.baseArgs).toEqual(['--custom-arg']);
    });
  });
});
