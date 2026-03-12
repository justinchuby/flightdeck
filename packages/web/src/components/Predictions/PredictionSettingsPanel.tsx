import { useState, useEffect } from 'react';
import { usePredictionConfig, usePredictionAccuracy } from '../../hooks/usePredictions';
import { apiFetch } from '../../hooks/useApi';
import { PREDICTION_TYPE_LABELS, type Prediction, type PredictionType } from './types';

const OUTCOME_ICONS: Record<string, string> = {
  correct: '✅',
  avoided: '🟢',
  wrong: '❌',
  expired: '⏰',
};

const ALL_TYPES: PredictionType[] = [
  'context_exhaustion',
  'cost_overrun',
  'agent_stall',
  'task_duration',
  'completion_estimate',
];

export function PredictionSettingsPanel() {
  const { config, saveConfig } = usePredictionConfig();
  const accuracy = usePredictionAccuracy();
  const [history, setHistory] = useState<Prediction[]>([]);

  useEffect(() => {
    apiFetch<Prediction[]>('/predictions/history')
      .then(data => setHistory(Array.isArray(data) ? data : []))
      .catch(() => { /* initial fetch — will retry */ });
  }, []);

  if (!config) {
    return <div className="text-xs text-th-text-muted animate-pulse">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-th-text flex items-center gap-2">
        <span>🔮</span> Prediction Settings
      </h3>

      {/* Enable toggle */}
      <label className="flex items-center justify-between">
        <span className="text-xs text-th-text">Predictions</span>
        <button
          onClick={() => saveConfig({ enabled: !config.enabled })}
          className={`w-10 h-5 rounded-full transition-colors ${config.enabled ? 'bg-accent' : 'bg-th-bg-muted'}`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white shadow transform transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-0.5'}`}
          />
        </button>
      </label>

      {/* Refresh interval */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-th-text">Refresh interval</span>
        <select
          value={config.refreshIntervalMs}
          onChange={e => saveConfig({ refreshIntervalMs: parseInt(e.target.value) })}
          className="text-xs bg-th-bg-alt border border-th-border rounded px-2 py-1 text-th-text"
        >
          <option value={15000}>15s</option>
          <option value={30000}>30s</option>
          <option value={60000}>60s</option>
        </select>
      </div>

      {/* Min confidence */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-th-text">Min confidence to show</span>
        <select
          value={config.minConfidence}
          onChange={e => saveConfig({ minConfidence: parseInt(e.target.value) })}
          className="text-xs bg-th-bg-alt border border-th-border rounded px-2 py-1 text-th-text"
        >
          <option value={20}>20%</option>
          <option value={40}>40%</option>
          <option value={60}>60%</option>
          <option value={80}>80%</option>
        </select>
      </div>

      {/* Type toggles */}
      <div>
        <div className="text-xs text-th-text mb-2">Enable/disable by type:</div>
        <div className="grid grid-cols-2 gap-2">
          {ALL_TYPES.map(type => (
            <label key={type} className="flex items-center gap-2 text-xs text-th-text-muted">
              <input
                type="checkbox"
                checked={config.enabledTypes?.[type] !== false}
                onChange={e =>
                  saveConfig({
                    enabledTypes: { ...config.enabledTypes, [type]: e.target.checked },
                  })
                }
                className="rounded border-th-border"
              />
              {PREDICTION_TYPE_LABELS[type]}
            </label>
          ))}
        </div>
      </div>

      {/* Accuracy stats */}
      {accuracy && accuracy.total > 0 && (
        <div className="border-t border-th-border-muted pt-3">
          <div className="text-xs font-semibold text-th-text mb-2">Accuracy (this session)</div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Accuracy', value: `${Math.round(accuracy.accuracy)}%` },
              { label: 'Total', value: String(accuracy.total) },
              { label: 'Correct', value: String(accuracy.correct) },
              { label: 'Avoided', value: String(accuracy.avoided) },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className="text-lg font-bold text-th-text">{s.value}</div>
                <div className="text-[10px] text-th-text-muted">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="border-t border-th-border-muted pt-3">
          <div className="text-xs font-semibold text-th-text mb-2">Recent</div>
          <div className="space-y-1.5">
            {history.slice(0, 5).map(p => (
              <div key={p.id} className="text-[11px] text-th-text-muted">
                {OUTCOME_ICONS[p.outcome ?? 'expired'] ?? '⏰'} &ldquo;{p.title}&rdquo; —{' '}
                {p.outcome ?? 'expired'}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
