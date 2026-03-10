// packages/web/src/stores/__tests__/settingsStore.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, ESCALATION_RULES, shouldNotify } from '../settingsStore';
import type { OversightLevel } from '../settingsStore';

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
