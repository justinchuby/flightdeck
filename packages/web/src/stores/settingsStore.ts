import { create } from 'zustand';
import { apiFetch } from '../hooks/useApi';

export type ThemeMode = 'dark' | 'light' | 'system';

/**
 * Oversight level for the Trust Dial (AC-16.1).
 * - supervised: Yellow@1 exception, all notifications, standard density
 * - balanced: Yellow@2, exceptions only (default)
 * - autonomous:  Red-only@3+, compact cards, critical only
 */
export type OversightLevel = 'supervised' | 'balanced' | 'autonomous';

interface SettingsState {
  soundEnabled: boolean;
  themeMode: ThemeMode;
  /** The resolved theme actually applied (dark or light) */
  resolvedTheme: 'dark' | 'light';
  /** Global oversight level (Trust Dial) */
  oversightLevel: OversightLevel;
  /** Per-project override (optional) */
  projectOverrides: Record<string, OversightLevel>;
  toggleSound: () => void;
  setSoundEnabled: (enabled: boolean) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setOversightLevel: (level: OversightLevel) => void;
  setProjectOversight: (projectId: string, level: OversightLevel) => void;
  clearProjectOversight: (projectId: string) => void;
  /** Resolve effective oversight level (project override → global) */
  getEffectiveLevel: (projectId?: string) => OversightLevel;
  /** Cycle to next oversight level (for quick toggle) */
  cycleOversightLevel: () => void;
  /** Call once on app start to listen for system preference changes */
  initThemeListener: () => void;
}

const SOUND_KEY = 'flightdeck-sound-enabled';
const THEME_KEY = 'theme';
const OVERSIGHT_KEY = 'flightdeck-oversight-level';
const OVERRIDES_KEY = 'flightdeck-project-overrides';

function loadSoundPreference(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {}
  return 'system';
}

function loadOversightLevel(): OversightLevel {
  try {
    const saved = localStorage.getItem(OVERSIGHT_KEY);
    if (saved === 'supervised' || saved === 'balanced' || saved === 'autonomous') return saved;
  } catch {}
  return 'balanced';
}

function loadProjectOverrides(): Record<string, OversightLevel> {
  try {
    const saved = localStorage.getItem(OVERRIDES_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return {};
}

const OVERSIGHT_CYCLE: OversightLevel[] = ['autonomous', 'balanced', 'supervised'];

function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'dark';
    }
  }
  return mode;
}

function applyTheme(resolved: 'dark' | 'light') {
  try {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.classList.toggle('light', resolved === 'light');
  } catch {}
}

/** Fire-and-forget sync of oversight level to server YAML config */
function syncOversightToServer(level: OversightLevel): void {
  apiFetch('/config', {
    method: 'PATCH',
    body: JSON.stringify({ oversightLevel: level }),
  }).catch(() => {
    // Best effort — localStorage is the primary store, server is secondary
  });
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  soundEnabled: loadSoundPreference(),
  themeMode: loadThemeMode(),
  resolvedTheme: resolveTheme(loadThemeMode()),
  oversightLevel: loadOversightLevel(),
  projectOverrides: loadProjectOverrides(),

  toggleSound: () =>
    set((s) => {
      const next = !s.soundEnabled;
      try { localStorage.setItem(SOUND_KEY, String(next)); } catch {}
      return { soundEnabled: next };
    }),

  setSoundEnabled: (enabled) => {
    try { localStorage.setItem(SOUND_KEY, String(enabled)); } catch {}
    set({ soundEnabled: enabled });
  },

  setThemeMode: (mode) => {
    try { localStorage.setItem(THEME_KEY, mode); } catch {}
    const resolved = resolveTheme(mode);
    applyTheme(resolved);
    set({ themeMode: mode, resolvedTheme: resolved });
  },

  setOversightLevel: (level) => {
    try { localStorage.setItem(OVERSIGHT_KEY, level); } catch {}
    set({ oversightLevel: level });
    // Persist to YAML config via server
    syncOversightToServer(level);
  },

  setProjectOversight: (projectId, level) => {
    const overrides = { ...get().projectOverrides, [projectId]: level };
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides)); } catch {}
    set({ projectOverrides: overrides });
  },

  clearProjectOversight: (projectId) => {
    const { [projectId]: _, ...rest } = get().projectOverrides;
    try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(rest)); } catch {}
    set({ projectOverrides: rest });
  },

  getEffectiveLevel: (projectId) => {
    if (projectId) {
      const override = get().projectOverrides[projectId];
      if (override) return override;
    }
    return get().oversightLevel;
  },

  cycleOversightLevel: () => {
    const current = get().oversightLevel;
    const idx = OVERSIGHT_CYCLE.indexOf(current);
    const next = OVERSIGHT_CYCLE[(idx + 1) % OVERSIGHT_CYCLE.length];
    get().setOversightLevel(next);
  },

  initThemeListener: () => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', () => {
      const { themeMode } = get();
      if (themeMode === 'system') {
        const resolved = resolveTheme('system');
        applyTheme(resolved);
        set({ resolvedTheme: resolved });
      }
    });
    // Apply initial theme
    applyTheme(get().resolvedTheme);
  },
}));

// ── Trust Dial notification gating (AC-16.5) ────────────────────────

/**
 * Notification severity used by the toast system.
 * - critical: failures, crashes → ALWAYS shown regardless of oversight level
 * - exception: permission requests, heartbeat halted, alerts → balanced + supervised
 * - info: spawned, completed, sub-spawned, context compacted → supervised only
 */
export type NotificationSeverity = 'critical' | 'exception' | 'info';

/**
 * Returns true if a notification of the given severity should be shown
 * at the current oversight level. Failures (critical) ALWAYS notify.
 */
export function shouldNotify(severity: NotificationSeverity, level?: OversightLevel): boolean {
  const effective = level ?? useSettingsStore.getState().oversightLevel;
  if (severity === 'critical') return true;
  if (severity === 'exception') return effective !== 'autonomous';
  // severity === 'info'
  return effective === 'supervised';
}


/** Escalation rules per oversight level (AC-16.2) */
export const ESCALATION_RULES: Record<OversightLevel, {
  yellowThreshold: number;
  redThreshold: number;
  redRequiresFailure: boolean;
}> = {
  supervised: { yellowThreshold: 1, redThreshold: 2, redRequiresFailure: false },
  balanced: { yellowThreshold: 2, redThreshold: 3, redRequiresFailure: false },
  autonomous:  { yellowThreshold: Infinity, redThreshold: 3, redRequiresFailure: true },
};
