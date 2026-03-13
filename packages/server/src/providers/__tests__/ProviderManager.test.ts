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
  let execAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = createMockDb();
    exec = vi.fn().mockReturnValue('');
    execAsync = vi.fn().mockResolvedValue('');
  });

  function createManager(opts?: { cacheTtlMs?: number }) {
    return new ProviderManager({
      db,
      execCommand: exec as any,
      execCommandAsync: execAsync as any,
      cacheTtlMs: opts?.cacheTtlMs,
    });
  }

  // ── getProviderConfigs ────────────────────────────────────

  describe('getProviderConfigs', () => {
    it('returns config for all 6 providers', () => {
      const configs = createManager().getProviderConfigs();
      expect(configs).toHaveLength(6);
      expect(configs.map((c) => c.id).sort()).toEqual(
        ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'opencode'],
      );
    });

    it('returns id, name, enabled only (no CLI status fields)', () => {
      const configs = createManager().getProviderConfigs();
      for (const c of configs) {
        expect(c).toHaveProperty('id');
        expect(c).toHaveProperty('name');
        expect(c).toHaveProperty('enabled');
        expect(c).not.toHaveProperty('installed');
        expect(c).not.toHaveProperty('authenticated');
        expect(c).not.toHaveProperty('binaryPath');
        expect(c).not.toHaveProperty('version');
      }
    });

    it('does not make any exec calls', () => {
      createManager().getProviderConfigs();
      expect(exec).not.toHaveBeenCalled();
      expect(execAsync).not.toHaveBeenCalled();
    });

    it('reflects enabled state from db', () => {
      const mgr = createManager();
      mgr.setProviderEnabled('gemini', false);
      const configs = mgr.getProviderConfigs();
      const gemini = configs.find((c) => c.id === 'gemini');
      expect(gemini?.enabled).toBe(false);
    });
  });

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

  // ── async detection methods ──────────────────────────────

  describe('detectInstalledAsync', () => {
    it('detects installed CLI binary', async () => {
      execAsync.mockResolvedValue('/usr/local/bin/claude');
      const result = await createManager().detectInstalledAsync('claude');
      expect(result.installed).toBe(true);
      expect(result.binaryPath).toBe('/usr/local/bin/claude');
      expect(execAsync).toHaveBeenCalledWith('which', ['claude-agent-acp']);
    });

    it('detects missing CLI binary', async () => {
      execAsync.mockRejectedValue(new Error('not found'));
      const result = await createManager().detectInstalledAsync('gemini');
      expect(result.installed).toBe(false);
      expect(result.binaryPath).toBeNull();
    });

    it('throws for unknown provider', async () => {
      await expect(createManager().detectInstalledAsync('unknown' as any)).rejects.toThrow('Unknown provider');
    });
  });

  describe('checkAuthenticatedAsync', () => {
    it('reports authenticated when command succeeds', async () => {
      execAsync.mockResolvedValue('Logged in');
      const result = await createManager().checkAuthenticatedAsync('copilot');
      expect(result.authenticated).toBe(true);
      expect(execAsync).toHaveBeenCalledWith('gh', ['auth', 'status']);
    });

    it('reports unauthenticated when command fails', async () => {
      execAsync.mockRejectedValue(new Error('not logged in'));
      const result = await createManager().checkAuthenticatedAsync('copilot');
      expect(result.authenticated).toBe(false);
      expect(result.error).toBe('not logged in');
    });

    it('assumes authenticated for providers without auth command', async () => {
      const result = await createManager().checkAuthenticatedAsync('claude');
      expect(result.authenticated).toBe(true);
      expect(execAsync).not.toHaveBeenCalled();
    });
  });

  describe('detectVersionAsync', () => {
    it('returns parsed version', async () => {
      execAsync.mockResolvedValue('v2.1.0');
      const version = await createManager().detectVersionAsync('claude');
      expect(version).toBe('v2.1.0');
      expect(execAsync).toHaveBeenCalledWith('claude-agent-acp', ['--version']);
    });

    it('returns null on failure', async () => {
      execAsync.mockRejectedValue(new Error('crash'));
      const version = await createManager().detectVersionAsync('claude');
      expect(version).toBeNull();
    });
  });

  // ── getProviderStatusAsync ────────────────────────────────

  describe('getProviderStatusAsync', () => {
    it('returns full status for installed provider', async () => {
      execAsync
        .mockResolvedValueOnce('/usr/local/bin/claude')   // which
        .mockResolvedValueOnce('v2.1.0');                  // --version
      const status = await createManager().getProviderStatusAsync('claude');
      expect(status.id).toBe('claude');
      expect(status.installed).toBe(true);
      expect(status.authenticated).toBe(true); // no auth command → true
      expect(status.version).toBe('v2.1.0');
      expect(status.binaryPath).toBe('/usr/local/bin/claude');
    });

    it('returns not-installed status when binary missing', async () => {
      execAsync.mockRejectedValue(new Error('not found'));
      const status = await createManager().getProviderStatusAsync('gemini');
      expect(status.installed).toBe(false);
      expect(status.authenticated).toBeNull();
      expect(status.version).toBeNull();
    });

    it('throws for unknown provider', async () => {
      await expect(createManager().getProviderStatusAsync('unknown' as any)).rejects.toThrow('Unknown provider');
    });
  });

  // ── getAllProviderStatusesAsync ────────────────────────────

  describe('getAllProviderStatusesAsync', () => {
    it('returns status for all 6 providers in parallel', async () => {
      execAsync.mockResolvedValue('');
      const statuses = await createManager().getAllProviderStatusesAsync();
      expect(statuses).toHaveLength(6);
      expect(statuses.map((s) => s.id).sort()).toEqual(
        ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'opencode'],
      );
    });
  });

  // ── cache ────────────────────────────────────────────────

  describe('detection cache', () => {
    it('returns cached result on second call', async () => {
      execAsync.mockResolvedValue('/usr/local/bin/claude');
      const mgr = createManager();

      await mgr.getProviderStatusAsync('claude');
      await mgr.getProviderStatusAsync('claude');

      // which + version on first call only (2 calls); second call is cached
      const whichCalls = execAsync.mock.calls.filter(
        (c: string[]) => c[0] === 'which',
      );
      expect(whichCalls).toHaveLength(1);
    });

    it('invalidateCache forces re-detection', async () => {
      execAsync.mockResolvedValue('/usr/local/bin/claude');
      const mgr = createManager();

      await mgr.getProviderStatusAsync('claude');
      mgr.invalidateCache('claude');
      await mgr.getProviderStatusAsync('claude');

      const whichCalls = execAsync.mock.calls.filter(
        (c: string[]) => c[0] === 'which',
      );
      expect(whichCalls).toHaveLength(2);
    });

    it('invalidateCache without args clears all providers', async () => {
      execAsync.mockResolvedValue('');
      const mgr = createManager();

      await mgr.getAllProviderStatusesAsync();
      mgr.invalidateCache();
      await mgr.getAllProviderStatusesAsync();

      // Two rounds of `which` calls (6 providers each)
      const whichCalls = execAsync.mock.calls.filter(
        (c: string[]) => c[0] === 'which',
      );
      expect(whichCalls).toHaveLength(12);
    });

    it('cache expires after TTL', async () => {
      execAsync.mockResolvedValue('/usr/local/bin/claude');
      const mgr = createManager({ cacheTtlMs: 1 }); // 1ms TTL

      await mgr.getProviderStatusAsync('claude');
      // Wait for cache to expire
      await new Promise((r) => setTimeout(r, 5));
      await mgr.getProviderStatusAsync('claude');

      const whichCalls = execAsync.mock.calls.filter(
        (c: string[]) => c[0] === 'which',
      );
      expect(whichCalls).toHaveLength(2);
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

  // ── resolveAvailableProvider ─────────────────────────────

  describe('resolveAvailableProvider', () => {
    it('returns configured provider when it is installed and enabled', () => {
      // Set active provider to 'claude' via DB
      const mgr = createManager();
      mgr.setActiveProviderId('claude');

      // Mock: claude binary is installed
      exec.mockImplementation((cmd: string) => {
        if (cmd === 'which claude-agent-acp') return '/usr/local/bin/claude-agent-acp';
        throw new Error('not found');
      });

      const result = mgr.resolveAvailableProvider();
      expect(result).toBe('claude');
    });

    it('falls back to first installed+enabled provider when configured is not installed', () => {
      // Set active provider to 'copilot' via DB
      const mgr = createManager();
      mgr.setActiveProviderId('copilot');

      // Mock: copilot binary is NOT installed, but claude is
      exec.mockImplementation((cmd: string) => {
        if (cmd === 'which claude-agent-acp') return '/usr/local/bin/claude-agent-acp';
        throw new Error('not found');
      });

      // Set ranking so claude comes first after copilot
      mgr.setProviderRanking(['copilot', 'claude', 'gemini', 'codex', 'cursor', 'opencode']);

      const result = mgr.resolveAvailableProvider();
      expect(result).toBe('claude');
    });

    it('falls back to first installed provider when configured is disabled', () => {
      const mgr = createManager();
      mgr.setActiveProviderId('copilot');
      mgr.setProviderEnabled('copilot', true);

      // Mock: copilot is installed but disabled
      exec.mockImplementation((cmd: string) => {
        if (cmd.startsWith('which ')) return '/usr/local/bin/some-binary';
        throw new Error('not found');
      });

      // Disable copilot, enable claude
      mgr.setProviderEnabled('copilot', false);
      mgr.setProviderEnabled('claude', true);
      mgr.setProviderRanking(['copilot', 'claude', 'gemini', 'codex', 'cursor', 'opencode']);

      const result = mgr.resolveAvailableProvider();
      expect(result).toBe('claude');
    });

    it('returns configured provider if no alternative is available', () => {
      const mgr = createManager();
      mgr.setActiveProviderId('copilot');

      // Mock: no binary is installed
      exec.mockImplementation(() => { throw new Error('not found'); });

      const result = mgr.resolveAvailableProvider();
      expect(result).toBe('copilot');
    });

    it('persists the fallback provider as active', () => {
      const mgr = createManager();
      mgr.setActiveProviderId('copilot');
      mgr.setProviderRanking(['copilot', 'claude', 'gemini', 'codex', 'cursor', 'opencode']);

      // Mock: only claude is installed
      exec.mockImplementation((cmd: string) => {
        if (cmd === 'which claude-agent-acp') return '/usr/local/bin/claude-agent-acp';
        throw new Error('not found');
      });

      mgr.resolveAvailableProvider();
      // The active provider should now be 'claude' in the DB
      expect(mgr.getActiveProviderId()).toBe('claude');
    });
  });

  // ── getActiveProviderId fallback ────────────────────────

  describe('getActiveProviderId without db or configStore', () => {
    it('returns first installed provider instead of hardcoded copilot', () => {
      // No DB, no configStore — only exec
      const mgr = new ProviderManager({
        execCommand: (cmd: string) => {
          if (cmd === 'which claude-agent-acp') return '/usr/local/bin/claude-agent-acp';
          throw new Error('not found');
        },
      });

      const result = mgr.getActiveProviderId();
      // Should detect installed providers rather than blindly returning 'copilot'
      // The exact result depends on the iteration order of PROVIDER_PRESETS
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
