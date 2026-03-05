import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import type { RecoverySettings } from './types';

const DEFAULTS: RecoverySettings = {
  autoRestart: true,
  reviewHandoffs: false,
  autoCompact: false,
  maxAttempts: 3,
};

export function RecoverySettingsPanel() {
  const [settings, setSettings] = useState<RecoverySettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<RecoverySettings>('/settings/recovery')
      .then(setSettings)
      .catch(() => setSettings(DEFAULTS))
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (update: Partial<RecoverySettings>) => {
    const next = { ...settings, ...update };
    setSettings(next);
    setSaving(true);
    try {
      await apiFetch('/settings/recovery', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
    } catch { /* settings will revert on next load */ }
    finally { setSaving(false); }
  }, [settings]);

  if (loading) {
    return <div className="text-xs text-th-text-muted p-4">Loading recovery settings...</div>;
  }

  return (
    <div className="space-y-4" data-testid="recovery-settings">
      <h3 className="text-sm font-semibold text-th-text-alt flex items-center gap-2">
        🔄 Recovery Settings
        {saving && <span className="text-[10px] text-th-text-muted">(saving...)</span>}
      </h3>

      <Toggle
        label="Auto-restart on crash"
        description="Automatically restart crashed agents with context handoff"
        checked={settings.autoRestart}
        onChange={(v) => save({ autoRestart: v })}
      />

      <Toggle
        label="Review handoffs before restart"
        description="Show handoff briefings in approval queue before restarting"
        checked={settings.reviewHandoffs}
        onChange={(v) => save({ reviewHandoffs: v })}
      />

      <Toggle
        label="Auto-compact on critical pressure"
        description="Restart agents at 95% context with compressed briefing"
        checked={settings.autoCompact}
        onChange={(v) => save({ autoCompact: v })}
      />

      <div>
        <label className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-th-text-alt">Max restart attempts</p>
            <p className="text-[10px] text-th-text-muted">Stop retrying after N failed attempts</p>
          </div>
          <select
            value={settings.maxAttempts}
            onChange={(e) => save({ maxAttempts: Number(e.target.value) })}
            className="text-xs bg-th-bg-alt border border-th-border rounded-md px-2 py-1"
          >
            {[1, 2, 3, 5].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="bg-th-bg-alt border border-th-border rounded-md p-3 text-[10px] text-th-text-muted">
        ℹ️ Auto-restart is on by default. Handoff review and auto-compact require explicit opt-in.
        You can always review handoffs retroactively in the Timeline.
      </div>
    </div>
  );
}

// ── Toggle sub-component ───────────────────────────────────────────

function Toggle({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <div className="flex-1 mr-3">
        <p className="text-xs font-medium text-th-text-alt">{label}</p>
        <p className="text-[10px] text-th-text-muted">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-th-bg-muted'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );
}
