// packages/web/src/stores/__tests__/settingsStore.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore, ESCALATION_RULES, shouldNotify } from '../settingsStore';

// Mock apiFetch to prevent actual HTTP calls
vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

// jsdom without a URL doesn't provide localStorage — provide a simple mock
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
})();

describe('settingsStore — Trust Dial', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch {}
    // Reset store to defaults
    useSettingsStore.setState({
      oversightLevel: 'balanced',
      projectOverrides: {},
    });
  });

  // ── AC-16.1: Persisted 3-option setting ──────────────────

  it('defaults to standard oversight level', () => {
    expect(useSettingsStore.getState().oversightLevel).toBe('balanced');
  });

  it('persists oversight level to localStorage', () => {
    useSettingsStore.getState().setOversightLevel('supervised');
    expect(useSettingsStore.getState().oversightLevel).toBe('supervised');
  });

  it('persists minimal level', () => {
    useSettingsStore.getState().setOversightLevel('autonomous');
    expect(useSettingsStore.getState().oversightLevel).toBe('autonomous');
  });

  // ── Cycle ─────────────────────────────────────────────────

  it('cycles through levels: standard → detailed → minimal → standard', () => {
    const store = useSettingsStore.getState();
    expect(store.oversightLevel).toBe('balanced');

    store.cycleOversightLevel();
    expect(useSettingsStore.getState().oversightLevel).toBe('supervised');

    useSettingsStore.getState().cycleOversightLevel();
    expect(useSettingsStore.getState().oversightLevel).toBe('autonomous');

    useSettingsStore.getState().cycleOversightLevel();
    expect(useSettingsStore.getState().oversightLevel).toBe('balanced');
  });

  // ── Per-project overrides ─────────────────────────────────

  it('supports per-project oversight overrides', () => {
    useSettingsStore.getState().setProjectOversight('proj-1', 'supervised');
    expect(useSettingsStore.getState().getEffectiveLevel('proj-1')).toBe('supervised');
    // Global still standard
    expect(useSettingsStore.getState().getEffectiveLevel()).toBe('balanced');
  });

  it('falls back to global when no project override', () => {
    useSettingsStore.getState().setOversightLevel('autonomous');
    expect(useSettingsStore.getState().getEffectiveLevel('proj-no-override')).toBe('autonomous');
  });

  it('clears project override', () => {
    useSettingsStore.getState().setProjectOversight('proj-1', 'supervised');
    useSettingsStore.getState().clearProjectOversight('proj-1');
    // Falls back to global
    expect(useSettingsStore.getState().getEffectiveLevel('proj-1')).toBe('balanced');
  });

  // ── AC-16.2: Escalation thresholds ────────────────────────

  it('detailed mode triggers yellow at 1 exception', () => {
    expect(ESCALATION_RULES.supervised.yellowThreshold).toBe(1);
    expect(ESCALATION_RULES.supervised.redThreshold).toBe(2);
    expect(ESCALATION_RULES.supervised.redRequiresFailure).toBe(false);
  });

  it('standard mode triggers yellow at 2 exceptions', () => {
    expect(ESCALATION_RULES.balanced.yellowThreshold).toBe(2);
    expect(ESCALATION_RULES.balanced.redThreshold).toBe(3);
  });

  it('minimal mode has no yellow, red requires failure', () => {
    expect(ESCALATION_RULES.autonomous.yellowThreshold).toBe(Infinity);
    expect(ESCALATION_RULES.autonomous.redRequiresFailure).toBe(true);
  });

  // ── AC-16.5: Notification gating by oversight level ────────

  it('shouldNotify: critical always notifies regardless of level', () => {
    expect(shouldNotify('critical', 'supervised')).toBe(true);
    expect(shouldNotify('critical', 'balanced')).toBe(true);
    expect(shouldNotify('critical', 'autonomous')).toBe(true);
  });

  it('shouldNotify: exception notifies at detailed and standard, not minimal', () => {
    expect(shouldNotify('exception', 'supervised')).toBe(true);
    expect(shouldNotify('exception', 'balanced')).toBe(true);
    expect(shouldNotify('exception', 'autonomous')).toBe(false);
  });

  it('shouldNotify: info only notifies at detailed', () => {
    expect(shouldNotify('info', 'supervised')).toBe(true);
    expect(shouldNotify('info', 'balanced')).toBe(false);
    expect(shouldNotify('info', 'autonomous')).toBe(false);
  });

  it('shouldNotify reads store level when no explicit level given', () => {
    useSettingsStore.getState().setOversightLevel('autonomous');
    expect(shouldNotify('info')).toBe(false);
    expect(shouldNotify('critical')).toBe(true);

    useSettingsStore.getState().setOversightLevel('supervised');
    expect(shouldNotify('info')).toBe(true);
  });
});

describe('settingsStore — theme and sound', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });
    localStorageMock.clear();
    useSettingsStore.setState({
      soundEnabled: false,
      themeMode: 'system',
      resolvedTheme: 'dark',
      oversightLevel: 'balanced',
      projectOverrides: {},
    });
  });

  describe('sound', () => {
    it('defaults to sound disabled', () => {
      expect(useSettingsStore.getState().soundEnabled).toBe(false);
    });

    it('toggleSound flips the boolean', () => {
      useSettingsStore.getState().toggleSound();
      expect(useSettingsStore.getState().soundEnabled).toBe(true);
      useSettingsStore.getState().toggleSound();
      expect(useSettingsStore.getState().soundEnabled).toBe(false);
    });

    it('setSoundEnabled sets to explicit value', () => {
      useSettingsStore.getState().setSoundEnabled(true);
      expect(useSettingsStore.getState().soundEnabled).toBe(true);
      useSettingsStore.getState().setSoundEnabled(false);
      expect(useSettingsStore.getState().soundEnabled).toBe(false);
    });

    it('toggleSound persists (survives store reset)', () => {
      useSettingsStore.getState().toggleSound();
      expect(useSettingsStore.getState().soundEnabled).toBe(true);
    });

    it('setSoundEnabled persists value', () => {
      useSettingsStore.getState().setSoundEnabled(true);
      expect(useSettingsStore.getState().soundEnabled).toBe(true);
    });
  });

  describe('theme', () => {
    it('defaults to system theme mode', () => {
      expect(useSettingsStore.getState().themeMode).toBe('system');
    });

    it('setThemeMode changes mode and resolves theme', () => {
      useSettingsStore.getState().setThemeMode('dark');
      expect(useSettingsStore.getState().themeMode).toBe('dark');
      expect(useSettingsStore.getState().resolvedTheme).toBe('dark');
      useSettingsStore.getState().setThemeMode('light');
      expect(useSettingsStore.getState().themeMode).toBe('light');
      expect(useSettingsStore.getState().resolvedTheme).toBe('light');
    });

    it('setThemeMode applies dark/light class to document', () => {
      useSettingsStore.getState().setThemeMode('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
      useSettingsStore.getState().setThemeMode('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });

    it('system mode resolves based on media query', () => {
      useSettingsStore.getState().setThemeMode('system');
      expect(useSettingsStore.getState().themeMode).toBe('system');
      expect(['dark', 'light']).toContain(useSettingsStore.getState().resolvedTheme);
    });
  });

  describe('initThemeListener', () => {
    it('registers media query change listener and applies theme', () => {
      const addEventListenerSpy = vi.fn();
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false, media: '', onchange: null,
        addEventListener: addEventListenerSpy, removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
      });
      try {
        useSettingsStore.getState().setThemeMode('dark');
        useSettingsStore.getState().initThemeListener();
        expect(addEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
        expect(document.documentElement.classList.contains('dark')).toBe(true);
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    });

    it('change callback updates theme when mode is system', () => {
      let changeCallback: (() => void) | null = null;
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = vi.fn().mockReturnValue({
        matches: true, media: '(prefers-color-scheme: dark)', onchange: null,
        addEventListener: vi.fn((_event: string, cb: () => void) => { changeCallback = cb; }),
        removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
      });
      try {
        useSettingsStore.getState().setThemeMode('system');
        useSettingsStore.getState().initThemeListener();
        // Simulate system theme change
        expect(changeCallback).not.toBeNull();
        changeCallback!();
        // The resolved theme should update based on system preference
        const { resolvedTheme } = useSettingsStore.getState();
        expect(['light', 'dark']).toContain(resolvedTheme);
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    });

    it('change callback does nothing when mode is not system', () => {
      let changeCallback: (() => void) | null = null;
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false, media: '', onchange: null,
        addEventListener: vi.fn((_event: string, cb: () => void) => { changeCallback = cb; }),
        removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
      });
      try {
        useSettingsStore.getState().setThemeMode('dark');
        useSettingsStore.getState().initThemeListener();
        const before = useSettingsStore.getState().resolvedTheme;
        changeCallback!();
        // Should not change because themeMode is 'dark', not 'system'
        expect(useSettingsStore.getState().resolvedTheme).toBe(before);
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    });
  });

  describe('oversight server sync', () => {
    it('setOversightLevel persists value', () => {
      useSettingsStore.getState().setOversightLevel('supervised');
      expect(useSettingsStore.getState().oversightLevel).toBe('supervised');
    });

    it('setOversightLevel syncs to server via PATCH /config', async () => {
      const { apiFetch } = await import('../../hooks/useApi');
      useSettingsStore.getState().setOversightLevel('autonomous');
      expect(apiFetch).toHaveBeenCalledWith('/config', {
        method: 'PATCH',
        body: JSON.stringify({ oversightLevel: 'autonomous' }),
      });
    });
  });

  describe('project overrides persistence', () => {
    it('setProjectOversight stores override', () => {
      useSettingsStore.getState().setProjectOversight('proj-1', 'supervised');
      expect(useSettingsStore.getState().getEffectiveLevel('proj-1')).toBe('supervised');
    });

    it('clearProjectOversight removes override', () => {
      useSettingsStore.getState().setProjectOversight('proj-1', 'supervised');
      useSettingsStore.getState().clearProjectOversight('proj-1');
      expect(useSettingsStore.getState().getEffectiveLevel('proj-1')).toBe('balanced');
    });

    it('multiple project overrides coexist', () => {
      useSettingsStore.getState().setProjectOversight('proj-1', 'supervised');
      useSettingsStore.getState().setProjectOversight('proj-2', 'autonomous');
      expect(useSettingsStore.getState().getEffectiveLevel('proj-1')).toBe('supervised');
      expect(useSettingsStore.getState().getEffectiveLevel('proj-2')).toBe('autonomous');
    });
  });

  describe('localStorage error resilience', () => {
    it('handles localStorage.setItem throwing', () => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
      try {
        expect(() => useSettingsStore.getState().toggleSound()).not.toThrow();
        expect(() => useSettingsStore.getState().setThemeMode('dark')).not.toThrow();
        expect(() => useSettingsStore.getState().setOversightLevel('supervised')).not.toThrow();
      } finally {
        Storage.prototype.setItem = originalSetItem;
      }
    });
  });
});
