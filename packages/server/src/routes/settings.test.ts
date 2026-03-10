/**
 * Settings route tests.
 *
 * Covers: provider listing, single provider details, connection test,
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
const mockGetAllStatuses = vi.fn();
const mockGetStatus = vi.fn();
const mockDetectInstalled = vi.fn();
const mockCheckAuth = vi.fn();
const mockGetModelPrefs = vi.fn();
const mockSetModelPrefs = vi.fn();
const mockSetEnabled = vi.fn();

vi.mock('../providers/ProviderManager.js', () => ({
  ProviderManager: class MockProviderManager {
    getAllProviderStatuses() { return mockGetAllStatuses(); }
    getProviderStatus(id: string) { return mockGetStatus(id); }
    detectInstalled(id: string) { return mockDetectInstalled(id); }
    checkAuthenticated(id: string) { return mockCheckAuth(id); }
    getModelPreferences(id: string) { return mockGetModelPrefs(id); }
    setModelPreferences(id: string, prefs: any) { return mockSetModelPrefs(id, prefs); }
    setProviderEnabled(id: string, enabled: boolean) { return mockSetEnabled(id, enabled); }
    isProviderEnabled() { return true; }
  },
}));

import { settingsRoutes } from './settings.js';
import type { AppContext } from './context.js';

// ── Fixtures ────────────────────────────────────────────────────────

const MOCK_STATUSES = [
  { id: 'copilot', name: 'GitHub Copilot SDK', installed: true, authenticated: true, enabled: true, binaryPath: '/usr/bin/copilot' },
  { id: 'claude', name: 'Claude Code', installed: true, authenticated: true, enabled: true, binaryPath: '/usr/bin/claude' },
  { id: 'gemini', name: 'Google Gemini CLI', installed: false, authenticated: null, enabled: true, binaryPath: null },
  { id: 'opencode', name: 'OpenCode', installed: false, authenticated: null, enabled: true, binaryPath: null },
  { id: 'cursor', name: 'Cursor', installed: false, authenticated: null, enabled: false, binaryPath: null },
  { id: 'codex', name: 'Codex CLI', installed: true, authenticated: false, enabled: true, binaryPath: '/usr/bin/codex' },
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
    mockGetAllStatuses.mockReturnValue(MOCK_STATUSES);
    mockGetStatus.mockImplementation((id: string) =>
      MOCK_STATUSES.find((s) => s.id === id) ?? (() => { throw new Error('Unknown'); })(),
    );
    mockGetModelPrefs.mockReturnValue({});
    baseUrl = await srv.start();
  });

  afterEach(async () => {
    await srv.stop();
  });

  describe('GET /settings/providers', () => {
    it('returns all 6 providers', async () => {
      const res = await fetch(`${baseUrl}/settings/providers`);
      expect(res.status).toBe(200);
      const providers = await res.json();
      expect(providers).toHaveLength(6);
    });

    it('includes installed/authenticated/enabled fields', async () => {
      const res = await fetch(`${baseUrl}/settings/providers`);
      const providers = await res.json();
      for (const p of providers) {
        expect(p).toHaveProperty('id');
        expect(p).toHaveProperty('name');
        expect(p).toHaveProperty('installed');
        expect(p).toHaveProperty('authenticated');
        expect(p).toHaveProperty('enabled');
      }
    });

    it('never returns API key fields', async () => {
      const res = await fetch(`${baseUrl}/settings/providers`);
      const raw = await res.text();
      expect(raw).not.toContain('maskedKey');
      expect(raw).not.toContain('apiKey');
      expect(raw).not.toContain('requiredEnvVars');
    });

    it('shows correct installed/auth status per provider', async () => {
      const res = await fetch(`${baseUrl}/settings/providers`);
      const providers = await res.json();
      const copilot = providers.find((p: any) => p.id === 'copilot');
      expect(copilot.installed).toBe(true);
      expect(copilot.authenticated).toBe(true);
      const gemini = providers.find((p: any) => p.id === 'gemini');
      expect(gemini.installed).toBe(false);
      expect(gemini.authenticated).toBeNull();
    });
  });

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

  describe('POST /settings/providers/:provider/test', () => {
    it('returns success when installed and authenticated', async () => {
      mockDetectInstalled.mockReturnValue({ installed: true, binaryPath: '/usr/bin/claude' });
      mockCheckAuth.mockReturnValue({ authenticated: true });
      const res = await fetch(`${baseUrl}/settings/providers/claude/test`, { method: 'POST' });
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.message).toContain('installed and responsive');
    });

    it('returns failure when not installed', async () => {
      mockDetectInstalled.mockReturnValue({ installed: false, binaryPath: null });
      const res = await fetch(`${baseUrl}/settings/providers/gemini/test`, { method: 'POST' });
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('not found');
    });

    it('returns failure when auth check fails', async () => {
      mockDetectInstalled.mockReturnValue({ installed: true, binaryPath: '/usr/bin/codex' });
      mockCheckAuth.mockReturnValue({ authenticated: false, error: 'not logged in' });
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

  describe('PUT /settings/providers/:provider', () => {
    it('updates enabled state', async () => {
      mockGetStatus.mockReturnValue(MOCK_STATUSES[0]);
      const res = await fetch(`${baseUrl}/settings/providers/copilot`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(200);
      expect(mockSetEnabled).toHaveBeenCalledWith('copilot', false);
    });

    it('updates model preferences', async () => {
      mockGetStatus.mockReturnValue(MOCK_STATUSES[1]);
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
      mockGetStatus.mockReturnValue({ ...MOCK_STATUSES[0], enabled: false });
      mockGetModelPrefs.mockReturnValue({ defaultModel: 'gpt-5' });
      const res = await fetch(`${baseUrl}/settings/providers/copilot`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      const body = await res.json();
      expect(body.enabled).toBe(false);
      expect(body.modelPreferences).toEqual({ defaultModel: 'gpt-5' });
    });

    it('returns 404 for unknown provider', async () => {
      const res = await fetch(`${baseUrl}/settings/providers/fake`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      expect(res.status).toBe(404);
    });
  });
});

