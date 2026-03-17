import { useState, useEffect, useCallback } from 'react';
import { Database, Trash2, RefreshCw, AlertTriangle, CheckCircle, HardDrive, BarChart3 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface DataStats {
  fileSizeBytes: number;
  tableCounts: Record<string, number>;
  totalRecords: number;
  oldestSession: string | null;
}

interface CleanupResult {
  deleted: Record<string, number>;
  totalDeleted: number;
  sessionsDeleted: number;
  dryRun: boolean;
  cutoffDate: string;
}

const PERIOD_OPTIONS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
  { label: 'All data', days: 0 },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Key tables to show (in order). Others are grouped as "other". */
const KEY_TABLES = [
  'projects', 'project_sessions', 'activity_log', 'dag_tasks',
  'chat_groups', 'chat_group_messages', 'conversations', 'messages',
  'agent_memory', 'decisions', 'collective_memory',
];

export function DataManagement() {
  const [stats, setStats] = useState<DataStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDays, setSelectedDays] = useState(30);
  const [preview, setPreview] = useState<CleanupResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<CleanupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<DataStats>('/data/stats');
      setStats(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handlePreview = async () => {
    setPreviewing(true);
    setError(null);
    setPurgeResult(null);
    try {
      const result = await apiFetch<CleanupResult>('/data/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThanDays: selectedDays, dryRun: true }),
      });
      setPreview(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to preview cleanup');
    } finally {
      setPreviewing(false);
    }
  };

  const handlePurge = async () => {
    setPurging(true);
    setError(null);
    try {
      const result = await apiFetch<CleanupResult>('/data/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ olderThanDays: selectedDays, dryRun: false }),
      });
      setPurgeResult(result);
      setPreview(null);
      // Refresh stats after purge
      await fetchStats();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to purge data');
    } finally {
      setPurging(false);
    }
  };

  return (
    <section className="bg-surface-raised border border-th-border rounded-lg p-4 mb-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider flex items-center gap-2">
          <Database className="w-3.5 h-3.5" /> Data Management
        </h3>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="text-xs text-th-text-muted hover:text-th-text flex items-center gap-1 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Database Stats */}
      {stats && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-th-bg-alt/50 rounded-lg p-3 text-center">
              <HardDrive className="w-4 h-4 text-th-text-muted mx-auto mb-1" />
              <div className="text-base font-semibold text-th-text">{formatBytes(stats.fileSizeBytes)}</div>
              <div className="text-[10px] text-th-text-muted">Database Size</div>
            </div>
            <div className="bg-th-bg-alt/50 rounded-lg p-3 text-center">
              <BarChart3 className="w-4 h-4 text-th-text-muted mx-auto mb-1" />
              <div className="text-base font-semibold text-th-text">{stats.totalRecords.toLocaleString()}</div>
              <div className="text-[10px] text-th-text-muted">Total Records</div>
            </div>
            <div className="bg-th-bg-alt/50 rounded-lg p-3 text-center">
              <Database className="w-4 h-4 text-th-text-muted mx-auto mb-1" />
              <div className="text-base font-semibold text-th-text">
                {stats.oldestSession ? formatDate(stats.oldestSession) : '—'}
              </div>
              <div className="text-[10px] text-th-text-muted">Oldest Session</div>
            </div>
          </div>

          {/* Table breakdown */}
          <details className="group">
            <summary className="text-xs text-th-text-muted cursor-pointer hover:text-th-text transition-colors select-none">
              Table breakdown ▾
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {KEY_TABLES.map(name => {
                const count = stats.tableCounts[name] ?? 0;
                if (count === 0) return null;
                return (
                  <div key={name} className="flex justify-between py-0.5">
                    <span className="text-th-text-muted font-mono">{name}</span>
                    <span className="text-th-text tabular-nums">{count.toLocaleString()}</span>
                  </div>
                );
              })}
              {/* Sum of remaining tables */}
              {(() => {
                const other = Object.entries(stats.tableCounts)
                  .filter(([name]) => !KEY_TABLES.includes(name))
                  .reduce((sum, [, count]) => sum + count, 0);
                return other > 0 ? (
                  <div className="flex justify-between py-0.5">
                    <span className="text-th-text-muted font-mono italic">other tables</span>
                    <span className="text-th-text tabular-nums">{other.toLocaleString()}</span>
                  </div>
                ) : null;
              })()}
            </div>
          </details>
        </div>
      )}

      {/* Cleanup Controls */}
      <div className="border-t border-th-border pt-4 space-y-3">
        <h3 className="text-xs font-medium text-th-text-muted uppercase tracking-wider">Purge Old Data</h3>

        <div className="flex items-center gap-3">
          <label className="text-xs text-th-text-alt">
            {selectedDays === 0 ? 'Delete:' : 'Delete data older than:'}
          </label>
          <select
            value={selectedDays}
            onChange={(e) => { setSelectedDays(Number(e.target.value)); setPreview(null); setPurgeResult(null); }}
            className="text-xs bg-th-bg-alt border border-th-border rounded-md px-2 py-1.5 text-th-text focus:outline-none focus:ring-1 focus:ring-th-accent"
          >
            {PERIOD_OPTIONS.map(opt => (
              <option key={opt.days} value={opt.days}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={handlePreview}
            disabled={previewing}
            className="text-xs px-3 py-1.5 rounded-md bg-th-bg-alt border border-th-border text-th-text hover:bg-th-bg-alt/80 transition-colors disabled:opacity-50"
          >
            {previewing ? 'Checking…' : 'Preview'}
          </button>
        </div>

        {selectedDays === 0 && !preview && !purgeResult && (
          <div className="text-[11px] text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            This will delete ALL session data. This cannot be undone.
          </div>
        )}

        {/* Dry-run preview */}
        {preview && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              {preview.totalDeleted === 0
                ? (selectedDays === 0 ? 'No data found.' : 'No sessions found older than the selected period.')
                : selectedDays === 0
                  ? `${preview.totalDeleted.toLocaleString()} total records will be permanently deleted.`
                  : `${preview.sessionsDeleted} session(s) and ${preview.totalDeleted.toLocaleString()} total records will be permanently deleted.`
              }
            </div>
            {preview.totalDeleted > 0 && (
              <>
                <div className="text-[10px] text-th-text-muted">
                  {selectedDays === 0 ? 'All data will be purged.' : `Cutoff: ${formatDate(preview.cutoffDate)} • Only completed sessions are affected.`}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                  {Object.entries(preview.deleted)
                    .filter(([, count]) => count > 0)
                    .map(([table, count]) => (
                      <div key={table} className="flex justify-between">
                        <span className="text-th-text-muted font-mono">{table}</span>
                        <span className="text-amber-400 tabular-nums">{count.toLocaleString()}</span>
                      </div>
                    ))
                  }
                </div>
                <button
                  onClick={handlePurge}
                  disabled={purging}
                  className="mt-1 text-xs px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {purging ? 'Deleting…' : 'Permanently Delete'}
                </button>
              </>
            )}
          </div>
        )}

        {/* Purge result */}
        {purgeResult && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-2 text-xs text-green-400">
            <CheckCircle className="w-3.5 h-3.5 shrink-0" />
            Deleted {purgeResult.totalDeleted.toLocaleString()} records from {purgeResult.sessionsDeleted} session(s).
          </div>
        )}
      </div>
    </section>
  );
}
