import { useState, useEffect, useCallback } from 'react';
import { Brain, Trash2, RefreshCw } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────

interface MemoryEntry {
  id: number;
  key: string;
  value: string;
  agentId?: string;
  leadId?: string;
  createdAt?: string;
}

interface MemoryStats {
  memory: number;
}

async function dbFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api/db${path}`, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── MemoryBrowser ─────────────────────────────────────────
// Displays memory entries from the database — a filtered view
// of the DataBrowser showing only knowledge/memory-related data.

export function MemoryBrowser() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, stats] = await Promise.all([
        dbFetch<MemoryEntry[]>('/memory'),
        dbFetch<MemoryStats>('/stats'),
      ]);
      setEntries(rows);
      setCount(stats.memory);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: number) => {
    try {
      await dbFetch(`/memory/${id}`, { method: 'DELETE' });
      setEntries(prev => prev.filter(e => e.id !== id));
      setCount(prev => prev != null ? prev - 1 : null);
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-5 h-5 border-2 border-th-text-muted/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-medium text-th-text-alt">
          {count ?? entries.length} memory {(count ?? entries.length) === 1 ? 'entry' : 'entries'}
        </span>
        <button
          onClick={load}
          className="ml-auto p-1 text-th-text-muted hover:text-th-text rounded hover:bg-th-bg-muted transition-colors"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="bg-surface-raised border border-th-border rounded-lg p-12 text-center">
          <Brain className="w-12 h-12 text-th-text-muted/30 mx-auto mb-3" />
          <p className="text-sm text-th-text-muted">No memory entries yet.</p>
          <p className="text-xs text-th-text-muted/60 mt-1">Memory entries are stored when agents save learned information.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(entry => (
            <div key={entry.id} className="bg-surface-raised border border-th-border rounded-lg p-3 flex items-start gap-3 group">
              <Brain size={14} className="text-purple-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-th-text-alt">{entry.key}</span>
                  {entry.agentId && (
                    <span className="text-[10px] text-th-text-muted font-mono">{entry.agentId.slice(0, 8)}</span>
                  )}
                  {entry.createdAt && (
                    <span className="text-[10px] text-th-text-muted">{entry.createdAt}</span>
                  )}
                </div>
                <div className="text-xs text-th-text-muted whitespace-pre-wrap break-words">{entry.value}</div>
              </div>
              <button
                onClick={() => handleDelete(entry.id)}
                className="p-1 text-th-text-muted hover:text-red-400 rounded opacity-0 group-hover:opacity-100 transition-all shrink-0"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
