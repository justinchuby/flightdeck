// packages/web/src/stores/__tests__/settingsStore.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, STALE_THRESHOLDS, ESCALATION_RULES } from '../settingsStore';
import type { OversightLevel } from '../settingsStore';

describe('settingsStore — Trust Dial', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch {}
    // Reset store to defaults
    useSettingsStore.setState({
      oversightLevel: 'standard',
      projectOverrides: {},
    });
  });

  // ── AC-16.1: Persisted 3-option setting ──────────────────

  it('defaults to standard oversight level', () => {
    expect(useSettingsStore.getState().oversightLevel).toBe('standard');
  });

  it('persists oversight level to localStorage', () => {
    useSettingsStore.getState().setOversightLevel('detailed');
    expect(useSettingsStore.getState().oversightLevel).toBe('detailed');
  });

  it('persists minimal level', () => {
    useSettingsStore.getState().setOversightLevel('minimal');
    expect(useSettingsStore.getState().oversightLevel).toBe('minimal');
  });

  // ── Cycle ─────────────────────────────────────────────────

  it('cycles through levels: standard → detailed → minimal → standard', () => {
    const store = useSettingsStore.getState();
    expect(store.oversightLevel).toBe('standard');

    store.cycleOversightLevel();
    expect(useSettingsStore.getState().oversightLevel).toBe('detailed');

    useSettingsStore.getState().cycleOversightLevel();
    expect(useSettingsStore.getState().oversightLevel).toBe('minimal');

    useSettingsStore.getState().cycleOversightLevel();
    expect(useSettingsStore.getState().oversightLevel).toBe('standard');
  });

  // ── Per-project overrides ─────────────────────────────────

  it('supports per-project oversight overrides', () => {
    useSettingsStore.getState().setProjectOversight('proj-1', 'detailed');
    expect(useSettingsStore.getState().getEffectiveLevel('proj-1')).toBe('detailed');
    // Global still standard
    expect(useSettingsStore.getState().getEffectiveLevel()).toBe('standard');
  });

  it('falls back to global when no project override', () => {
    useSettingsStore.getState().setOversightLevel('minimal');
    expect(useSettingsStore.getState().getEffectiveLevel('proj-no-override')).toBe('minimal');
  });

  it('clears project override', () => {
    useSettingsStore.getState().setProjectOversight('proj-1', 'detailed');
    useSettingsStore.getState().clearProjectOversight('proj-1');
    // Falls back to global
    expect(useSettingsStore.getState().getEffectiveLevel('proj-1')).toBe('standard');
  });

  // ── AC-16.2: Escalation thresholds ────────────────────────

  it('detailed mode triggers yellow at 1 exception', () => {
    expect(ESCALATION_RULES.detailed.yellowThreshold).toBe(1);
    expect(ESCALATION_RULES.detailed.redThreshold).toBe(2);
    expect(ESCALATION_RULES.detailed.redRequiresFailure).toBe(false);
  });

  it('standard mode triggers yellow at 2 exceptions', () => {
    expect(ESCALATION_RULES.standard.yellowThreshold).toBe(2);
    expect(ESCALATION_RULES.standard.redThreshold).toBe(3);
  });

  it('minimal mode has no yellow, red requires failure', () => {
    expect(ESCALATION_RULES.minimal.yellowThreshold).toBe(Infinity);
    expect(ESCALATION_RULES.minimal.redRequiresFailure).toBe(true);
  });

  // ── AC-16.3: Stale thresholds ─────────────────────────────

  it('maps correct stale thresholds per level', () => {
    expect(STALE_THRESHOLDS.detailed).toBe(10 * 60 * 1000);
    expect(STALE_THRESHOLDS.standard).toBe(15 * 60 * 1000);
    expect(STALE_THRESHOLDS.minimal).toBe(30 * 60 * 1000);
  });
});
