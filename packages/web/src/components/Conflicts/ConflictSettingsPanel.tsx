import { AlertTriangle } from 'lucide-react';
import { useConflictConfig } from '../../hooks/useConflicts';

export function ConflictSettingsPanel() {
  const { config, saveConfig } = useConflictConfig();

  if (!config) {
    return <div className="text-xs text-th-text-muted animate-pulse">Loading…</div>;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5" />
        Conflict Detection
      </h3>

      <label className="flex items-center justify-between">
        <span className="text-xs text-th-text">Conflict detection</span>
        <button
          onClick={() => saveConfig({ enabled: !config.enabled })}
          aria-label={config.enabled ? 'Disable conflict detection' : 'Enable conflict detection'}
          className={`w-10 h-5 rounded-full transition-colors ${config.enabled ? 'bg-accent' : 'bg-th-bg-muted'}`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white shadow transform transition-transform ${config.enabled ? 'translate-x-5' : 'translate-x-0.5'}`}
          />
        </button>
      </label>

      <div className="flex items-center justify-between">
        <span className="text-xs text-th-text">Check interval</span>
        <select
          value={config.checkIntervalMs}
          onChange={e => saveConfig({ checkIntervalMs: parseInt(e.target.value) })}
          className="text-xs bg-th-bg-alt border border-th-border rounded px-2 py-1 text-th-text"
        >
          <option value={10000}>10s</option>
          <option value={15000}>15s</option>
          <option value={30000}>30s</option>
        </select>
      </div>

      <div>
        <div className="text-xs text-th-text mb-2">Detection levels:</div>
        <div className="space-y-2">
          {([
            { key: 'directoryOverlapEnabled' as const, label: 'Same directory overlap' },
            { key: 'importAnalysisEnabled' as const, label: 'Import/dependency overlap' },
            {
              key: 'branchDivergenceEnabled' as const,
              label: 'Branch divergence (requires GitHub)',
            },
          ] as const).map(item => (
            <label key={item.key} className="flex items-center gap-2 text-xs text-th-text-muted">
              <input
                type="checkbox"
                checked={config[item.key]}
                onChange={e => saveConfig({ [item.key]: e.target.checked })}
                aria-label={item.label}
                className="rounded border-th-border"
              />
              {item.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
