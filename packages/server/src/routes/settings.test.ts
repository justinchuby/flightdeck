/**
 * Settings route tests.
 *
 * Covers: provider config listing, async status detection, connection test,
 * enable/disable toggle, model preferences, error cases.
 *
 * Uses a mock ProviderManager to avoid real CLI binary checks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

// Bypass rate limiters in tests
vi.mock('../middleware/rateLimit.js', () => ({
  rateLimit: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock ProviderManager so tests don't require real CLI binaries
const mockGetProviderConfigs = vi.fn();
const mockGetAllStatusesAsync = vi.fn();
const mockGetStatusAsync = vi.fn();
const mockDetectInstalledAsync = vi.fn();
const mockCheckAuthAsync = vi.fn();
const mockInvalidateCache = vi.fn();
const mockGetModelPrefs = vi.fn();
const mockSetModelPrefs = vi.fn();
const mockSetEnabled = vi.fn();
const mockSetEnabledPersisted = vi.fn();
const mockResolveAndPersistProvider = vi.fn();
const mockGetActiveProviderId = vi.fn();
const mockSetActiveProviderId = vi.fn();
const mockSetActiveProviderIdPersisted = vi.fn();
const mockGetProviderRanking = vi.fn();
const mockSetProviderRanking = vi.fn();

vi.mock('../providers/ProviderManager.js', () => ({
  ProviderManager: class MockProviderManager {
    getProviderConfigs() { return mockGetProviderConfigs(); }
    getAllProviderStatusesAsync() { return mockGetAllStatusesAsync(); }
    getProviderStatusAsync(id: string) { return mockGetStatusAsync(id); }
    detectInstalledAsync(id: string) { return mockDetectInstalledAsync(id); }
    checkAuthenticatedAsync(id: string) { return mockCheckAuthAsync(id); }
    invalidateCache(id?: string) { return mockInvalidateCache(id); }
    getModelPreferences(id: string) { return mockGetModelPrefs(id); }
    setModelPreferences(id: string, prefs: any) { return mockSetModelPrefs(id, prefs); }
    setProviderEnabled(id: string, enabled: boolean) { return mockSetEnabled(id, enabled); }
    setProviderEnabledPersisted(id: string, enabled: boolean) { return mockSetEnabledPersisted(id, enabled); }
    isProviderEnabled() { return true; }
    resolveAndPersistProvider() { return mockResolveAndPersistProvider(); }
    getActiveProviderId() { return mockGetActiveProviderId(); }
    setActiveProviderId(id: string) { return mockSetActiveProviderId(id); }
    setActiveProviderIdPersisted(id: string) { return mockSetActiveProviderIdPersisted(id); }
    getProviderRanking() { return mockGetProviderRanking(); }
    setProviderRanking(ranking: string[]) { return mockSetProviderRanking(ranking); }
  },
}));

import { settingsRoutes } from './settings.js';
import type { AppContext } from './context.js';

// ── Fixtures ────────────────────────────────────────────────────────

const MOCK_CONFIGS = [
  { id: 'copilot', name: 'GitHub Copilot SDK', enabled: true },
  { id: 'claude', name: 'Claude Code', enabled: true },
  { id: 'gemini', name: 'Google Gemini CLI', enabled: true },
  { id: 'opencode', name: 'OpenCode', enabled: true },
  { id: 'cursor', name: 'Cursor', enabled: false },
  { id: 'codex', name: 'Codex (ACP)', enabled: true },
  { id: 'kimi', name: 'Kimi CLI', enabled: true },
  { id: 'qwen-code', name: 'Qwen Code', enabled: true },
];

const MOCK_STATUSES = [
  { id: 'copilot', name: 'GitHub Copilot SDK', installed: true, authenticated: true, enabled: true, binaryPath: '/usr/bin/copilot', version: '1.0.0' },
  { id: 'claude', name: 'Claude Code', installed: true, authenticated: true, enabled: true, binaryPath: '/usr/bin/claude', version: '2.1.0' },
  { id: 'gemini', name: 'Google Gemini CLI', installed: false, authenticated: null, enabled: true, binaryPath: null, version: null },
  { id: 'opencode', name: 'OpenCode', installed: false, authenticated: null, enabled: true, binaryPath: null, version: null },
  { id: 'cursor', name: 'Cursor', installed: false, authenticated: null, enabled: false, binaryPath: null, version: null },
  { id: 'codex', name: 'Codex (ACP)', installed: true, authenticated: false, enabled: true, binaryPath: '/usr/bin/codex-acp', version: '0.5.0' },
  { id: 'kimi', name: 'Kimi CLI', installed: true, authenticated: true, enabled: true, binaryPath: '/usr/bin/kimi', version: '1.24.0' },
  { id: 'qwen-code', name: 'Qwen Code', installed: true, authenticated: true, enabled: true, binaryPath: '/usr/bin/qwen', version: '0.12.6' },
];

// ── Helpers ─────────────────────────────────────────────────────────

function minimalCtx(): AppContext {
  return {
    agentManager: {} as any,
    roleRegistry: {} as any,
    config: {} as any,
    db: {} as any,
    lockRegistry: {} as any,
    activityLedger: {} as any,
    decisionLog: {} as any,
  } as AppContext;
}

function createTestServer(): {
  start: () => Promise<string>;
  stop: () => Promise<void>;
} {
  const ctx = minimalCtx();
  const app = express();
  app.use(express.json());
  app.use(settingsRoutes(ctx));

  let server: Server;
  return {
    start: () =>
      new Promise<string>((resolve) => {
        server = app.listen(0, '127.0.0.1', () => {
          const { port } = server.address() as AddressInfo;
          resolve(`http://127.0.0.1:${port}`);
        });
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        server?.close(() => resolve());
      }),
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('settings routes', () => {
  let baseUrl: string;
  const srv = createTestServer();

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetProviderConfigs.mockReturnValue(MOCK_CONFIGS);
    mockGetAllStatusesAsync.mockResolvedValue(MOCK_STATUSES);
    mockGetStatusAsync.mockImplementation(async (id: string) =>
      MOCK_STATUSES.find((s) => s.id === id) ?? (() => { throw new Error('Unknown'); })(),
    );
    mockGetModelPrefs.mockReturnValue({});
    mockResolveAndPersistProvider.mockReturnValue('copilot');
    mockGetActiveProviderId.mockReturnValue('copilot');
    mockSetActiveProviderId.mockImplementation(() => {});
    mockSetActiveProviderIdPersisted.mockResolvedValue('copilot');
    mockGetProviderRanking.mockReturnValue(['copilot', 'claude', 'gemini', 'opencode', 'cursor', 'codex']);
    mockSetProviderRanking.mockImplementation(() => {});
    mockSetEnabled.mockImplementation(() => {});
    mockSetEnabledPersisted.mockResolvedValue('copilot');
    baseUrl = await srv.start();
  });

  afterEach(async () => {
    await srv.stop();
  });

  // ── GET /settings/providers (instant config) ──────────────

  describe('GET /settings/providers', () => {
    it('returns all 8 provider configs', async () => {
      const res = await fetch(`${baseUrl}/settings/providers`);
      expect(res.status).toBe(200);
      const configs = await res.json();
      expect(configs).toHaveLength(8);
    });

    it('returns only config fields (id, name, enabled) — no CLI status', async () => {
      const res = await fetch(`${baseUrl}/settings/providers`);
      const configs = await res.json();
      for (const c of configs) {
        expect(c).toHaveProperty('id');
        expect(c).toHaveProperty('name');
        expect(c).toHaveProperty('enabled');
        expect(c).not.toHaveProperty('installed');
        expect(c).not.toHaveProperty('authenticated');
        expect(c).not.toHaveProperty('binaryPath');
      }
    });

    it('never returns API key fields', async () => {
      const res = await fetch(`${baseUrl}/settings/providers`);
      const raw = await res.text();
      expect(raw).not.toContain('maskedKey');
      expect(raw).not.toContain('apiKey');
      expect(raw).not.toContain('requiredEnvVars');
    });

    it('calls getProviderConfigs (not getAllProviderStatuses)', async () => {
      await fetch(`${baseUrl}/settings/providers`);
      expect(mockGetProviderConfigs).toHaveBeenCalledTimes(1);
      expect(mockGetAllStatusesAsync).not.toHaveBeenCalled();
    });
  });

  // ── GET /settings/providers/status (async detection) ──────

  describe('GET /settings/providers/status', () => {
    it('returns all 8 provider statuses', async () => {
      const res = await fetch(`${baseUrl}/settings/providers/status`);
      expect(res.status).toBe(200);
      const statuses = await res.json();
      expect(statuses).toHaveLength(8);
    });

    it('includes installed/authenticated/version fields', async () => {
      const res = await fetch(`${baseUrl}/settings/providers/status`);
      const statuses = await res.json();
      for (const s of statuses) {
        expect(s).toHaveProperty('id');
        expect(s).toHaveProperty('installed');
        expect(s).toHaveProperty('authenticated');
      }
    });

    it('shows correct installed/auth status per provider', async () => {
      const res = await fetch(`${baseUrl}/settings/providers/status`);
      const statuses = await res.json();
      const copilot = statuses.find((s: any) => s.id === 'copilot');
      expect(copilot.installed).toBe(true);
      expect(copilot.authenticated).toBe(true);
      const gemini = statuses.find((s: any) => s.id === 'gemini');
      expect(gemini.installed).toBe(false);
      expect(gemini.authenticated).toBeNull();
    });

    it('returns 500 when async detection throws', async () => {
      mockGetAllStatusesAsync.mockRejectedValue(new Error('detection failed'));
      const res = await fetch(`${baseUrl}/settings/providers/status`);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain('detection failed');
    });
  });

  // ── GET /settings/providers/:provider ─────────────────────

  describe('GET /settings/providers/:provider', () => {
    it('returns single provider status with model prefs', async () => {
      mockGetModelPrefs.mockReturnValue({ defaultModel: 'claude-sonnet-4' });
      const res = await fetch(`${baseUrl}/settings/providers/claude`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe('claude');
      expect(body.modelPreferences).toEqual({ defaultModel: 'claude-sonnet-4' });
    });

    it('returns 404 for unknown provider', async () => {
      const res = await fetch(`${baseUrl}/settings/providers/fake`);
      expect(res.status).toBe(404);
    });
  });

  // ── POST /settings/providers/:provider/test ────────────────

  describe('POST /settings/providers/:provider/test', () => {
    it('returns success when installed and authenticated', async () => {
      mockDetectInstalledAsync.mockResolvedValue({ installed: true, binaryPath: '/usr/bin/claude' });
      mockCheckAuthAsync.mockResolvedValue({ authenticated: true });
      const res = await fetch(`${baseUrl}/settings/providers/claude/test`, { method: 'POST' });
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.message).toContain('installed and responsive');
    });

    it('invalidates cache after successful test', async () => {
      mockDetectInstalledAsync.mockResolvedValue({ installed: true, binaryPath: '/usr/bin/claude' });
      mockCheckAuthAsync.mockResolvedValue({ authenticated: true });
      await fetch(`${baseUrl}/settings/providers/claude/test`, { method: 'POST' });
      expect(mockInvalidateCache).toHaveBeenCalledWith('claude');
    });

    it('returns failure when not installed', async () => {
      mockDetectInstalledAsync.mockResolvedValue({ installed: false, binaryPath: null });
      const res = await fetch(`${baseUrl}/settings/providers/gemini/test`, { method: 'POST' });
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('not found');
    });

    it('returns failure when auth check fails', async () => {
      mockDetectInstalledAsync.mockResolvedValue({ installed: true, binaryPath: '/usr/bin/codex-acp' });
      mockCheckAuthAsync.mockResolvedValue({ authenticated: false, error: 'not logged in' });
      const res = await fetch(`${baseUrl}/settings/providers/codex/test`, { method: 'POST' });
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('not logged in');
    });

    it('returns 404 for unknown provider', async () => {
      const res = await fetch(`${baseUrl}/settings/providers/nope/test`, { method: 'POST' });
      expect(res.status).toBe(404);
    });
  });

  // ── PUT /settings/providers/:provider ──────────────────────

  describe('PUT /settings/providers/:provider', () => {
    it('updates enabled state', async () => {
      mockGetStatusAsync.mockResolvedValue(MOCK_STATUSES[0]);
      mockSetEnabledPersisted.mockResolvedValue('claude');
      const res = await fetch(`${baseUrl}/settings/providers/copilot`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(200);
      expect(mockSetEnabledPersisted).toHaveBeenCalledWith('copilot', false);
    });

    it('updates model preferences', async () => {
      mockGetStatusAsync.mockResolvedValue(MOCK_STATUSES[1]);
      const prefs = { defaultModel: 'claude-opus-4', preferredModels: ['claude-opus-4', 'claude-sonnet-4'] };
      const res = await fetch(`${baseUrl}/settings/providers/claude`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelPreferences: prefs }),
      });
      expect(res.status).toBe(200);
      expect(mockSetModelPrefs).toHaveBeenCalledWith('claude', prefs);
    });

    it('returns updated status in response', async () => {
      mockGetStatusAsync.mockResolvedValue({ ...MOCK_STATUSES[0], enabled: false });
      mockGetModelPrefs.mockReturnValue({ defaultModel: 'gpt-5' });
      mockSetEnabledPersisted.mockResolvedValue('claude');
      const res = await fetch(`${baseUrl}/settings/providers/copilot`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      const body = await res.json();
      expect(body.enabled).toBe(false);
      expect(body.modelPreferences).toEqual({ defaultModel: 'gpt-5' });
      expect(body.activeProvider).toBe('claude');
    });

    it('returns the immediately updated active provider after disabling the current one', async () => {
      mockSetEnabledPersisted.mockResolvedValue('claude');
      mockGetStatusAsync.mockResolvedValue({ ...MOCK_STATUSES[0], enabled: false });

      const res = await fetch(`${baseUrl}/settings/providers/copilot`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.activeProvider).toBe('claude');
    });

    it('returns 404 for unknown provider', async () => {
      const res = await fetch(`${baseUrl}/settings/providers/fake`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 409 when disabling the active provider would leave no fallback', async () => {
      mockSetEnabledPersisted.mockRejectedValue(new Error('Cannot disable active provider'));
      const res = await fetch(`${baseUrl}/settings/providers/copilot`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain('Cannot disable active provider');
    });
  });

  // ── GET/PUT /settings/provider ───────────────────────────

  describe('GET /settings/provider', () => {
    it('returns the resolved active provider', async () => {
      mockResolveAndPersistProvider.mockReturnValue('claude');
      const res = await fetch(`${baseUrl}/settings/provider`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ activeProvider: 'claude' });
    });
  });

  describe('PUT /settings/provider', () => {
    it('sets the active provider when it is usable', async () => {
      mockSetActiveProviderIdPersisted.mockResolvedValue('claude');
      const res = await fetch(`${baseUrl}/settings/provider`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'claude' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ activeProvider: 'claude' });
      expect(mockSetActiveProviderIdPersisted).toHaveBeenCalledWith('claude');
    });

    it('returns 409 when the provider is unusable', async () => {
      mockSetActiveProviderIdPersisted.mockRejectedValue(new Error("Provider 'gemini' is not installed"));
      const res = await fetch(`${baseUrl}/settings/provider`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'gemini' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain("Provider 'gemini' is not installed");
    });

    it('does not report a new active provider when persistence fails', async () => {
      mockSetActiveProviderIdPersisted.mockRejectedValue(new Error('write failed'));
      mockGetActiveProviderId.mockReturnValue('copilot');
      const res = await fetch(`${baseUrl}/settings/provider`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'claude' }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain('write failed');
      expect(mockGetActiveProviderId).not.toHaveBeenCalled();
    });
  });

  // ── GET/PUT /settings/provider-ranking ───────────────────

  describe('GET /settings/provider-ranking', () => {
    it('returns the provider ranking', async () => {
      const res = await fetch(`${baseUrl}/settings/provider-ranking`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ranking).toEqual(['copilot', 'claude', 'gemini', 'opencode', 'cursor', 'codex']);
    });
  });

  describe('PUT /settings/provider-ranking', () => {
    it('persists a valid provider ranking', async () => {
      mockGetProviderRanking.mockReturnValue(['claude', 'copilot']);
      const res = await fetch(`${baseUrl}/settings/provider-ranking`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ranking: ['claude', 'copilot'] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(mockSetProviderRanking).toHaveBeenCalledWith(['claude', 'copilot']);
      expect(body.ranking).toEqual(['claude', 'copilot']);
    });
  });
});
