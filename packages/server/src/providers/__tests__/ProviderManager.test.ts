import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import type { Database } from '../../db/database.js';

// ── Mock DB ──────────────────────────────────────────────────────

function createMockDb(): Database {
  const store = new Map<string, string>();
  return {
    getSetting: vi.fn((key: string) => store.get(key)),
    setSetting: vi.fn((key: string, value: string) => { store.set(key, value); }),
  } as unknown as Database;
}

// ── Tests ────────────────────────────────────────────────────────

describe('ProviderManager', () => {
  let db: Database;
  let exec: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createMockDb();
    exec = vi.fn().mockReturnValue('');
  });

  function createManager() {
    return new ProviderManager({ db, execCommand: exec as any });
  }

  // ── detectInstalled ──────────────────────────────────────

  describe('detectInstalled', () => {
    it('detects installed CLI binary', () => {
      exec.mockReturnValue('/usr/local/bin/claude');
      const result = createManager().detectInstalled('claude');

      expect(result.installed).toBe(true);
      expect(result.binaryPath).toBe('/usr/local/bin/claude');
    });

    it('detects missing CLI binary', () => {
      exec.mockImplementation(() => { throw new Error('not found'); });
      const result = createManager().detectInstalled('gemini');

      expect(result.installed).toBe(false);
      expect(result.binaryPath).toBeNull();
    });

    it('throws for unknown provider', () => {
      expect(() => createManager().detectInstalled('unknown' as any)).toThrow('Unknown provider');
    });

    it('uses correct binary name from preset', () => {
      exec.mockReturnValue('/usr/bin/agent');
      createManager().detectInstalled('cursor');
      expect(exec).toHaveBeenCalledWith('which agent');
    });
  });

  // ── checkAuthenticated ───────────────────────────────────

  describe('checkAuthenticated', () => {
    it('reports authenticated when command succeeds', () => {
      exec.mockReturnValue('Logged in to github.com');
      const result = createManager().checkAuthenticated('copilot');

      expect(result.authenticated).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('reports unauthenticated when command fails', () => {
      exec.mockImplementation(() => { throw new Error('not logged in'); });
      const result = createManager().checkAuthenticated('copilot');

      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('not logged in');
    });

    it('runs gh auth status for copilot', () => {
      exec.mockReturnValue('ok');
      createManager().checkAuthenticated('copilot');
      expect(exec).toHaveBeenCalledWith('gh auth status');
    });

    it('assumes authenticated for providers without auth command (e.g., claude)', () => {
      const result = createManager().checkAuthenticated('claude');
      expect(result.authenticated).toBe(true);
      expect(exec).not.toHaveBeenCalled();
    });
  });

  // ── getProviderStatus ────────────────────────────────────

  describe('getProviderStatus', () => {
    it('returns full status for installed+authenticated provider', () => {
      exec.mockReturnValue('/usr/local/bin/claude');
      const status = createManager().getProviderStatus('claude');

      expect(status.id).toBe('claude');
      expect(status.name).toBe('Claude Agent (ACP)');
      expect(status.installed).toBe(true);
      expect(status.authenticated).toBe(true);
      expect(status.enabled).toBe(true);
      expect(status.binaryPath).toBe('/usr/local/bin/claude');
    });

    it('skips auth check for uninstalled provider', () => {
      exec.mockImplementation(() => { throw new Error('not found'); });
      const status = createManager().getProviderStatus('gemini');

      expect(status.installed).toBe(false);
      expect(status.authenticated).toBeNull();
    });

    it('throws for unknown provider', () => {
      expect(() => createManager().getProviderStatus('unknown' as any)).toThrow('Unknown provider');
    });
  });

  // ── getAllProviderStatuses ────────────────────────────────

  describe('getAllProviderStatuses', () => {
    it('returns status for all 6 providers', () => {
      const statuses = createManager().getAllProviderStatuses();
      expect(statuses).toHaveLength(6);
      expect(statuses.map((s) => s.id).sort()).toEqual(
        ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'opencode'],
      );
    });
  });

  // ── enabled/disabled ─────────────────────────────────────

  describe('enabled/disabled', () => {
    it('defaults to enabled', () => {
      expect(createManager().isProviderEnabled('claude')).toBe(true);
    });

    it('persists disabled state', () => {
      const mgr = createManager();
      mgr.setProviderEnabled('gemini', false);
      expect(mgr.isProviderEnabled('gemini')).toBe(false);
    });

    it('persists re-enabled state', () => {
      const mgr = createManager();
      mgr.setProviderEnabled('gemini', false);
      mgr.setProviderEnabled('gemini', true);
      expect(mgr.isProviderEnabled('gemini')).toBe(true);
    });

    it('works without db (always enabled)', () => {
      const mgr = new ProviderManager({ execCommand: exec as any });
      expect(mgr.isProviderEnabled('claude')).toBe(true);
    });
  });

  // ── model preferences ────────────────────────────────────

  describe('model preferences', () => {
    it('returns empty prefs when none set', () => {
      expect(createManager().getModelPreferences('claude')).toEqual({});
    });

    it('persists and retrieves model preferences', () => {
      const mgr = createManager();
      mgr.setModelPreferences('claude', {
        defaultModel: 'claude-sonnet-4',
        preferredModels: ['claude-sonnet-4', 'claude-haiku-4'],
      });

      const prefs = mgr.getModelPreferences('claude');
      expect(prefs.defaultModel).toBe('claude-sonnet-4');
      expect(prefs.preferredModels).toEqual(['claude-sonnet-4', 'claude-haiku-4']);
    });

    it('handles corrupted JSON gracefully', () => {
      (db.setSetting as any)('provider:claude:models', 'not-json');
      // Force the mock to return corrupted data
      (db.getSetting as ReturnType<typeof vi.fn>).mockReturnValueOnce('not-json');
      const mgr = createManager();
      expect(mgr.getModelPreferences('claude')).toEqual({});
    });

    it('works without db (empty prefs)', () => {
      const mgr = new ProviderManager({ execCommand: exec as any });
      expect(mgr.getModelPreferences('claude')).toEqual({});
    });
  });
});
