import { useState, useEffect } from 'react';
import { Folder, FolderOpen, ChevronUp, Loader2 } from 'lucide-react';

interface FolderEntry {
  name: string;
  path: string;
}

interface BrowseResult {
  current: string;
  parent: string;
  folders: FolderEntry[];
  error?: string;
}

interface Props {
  value: string;
  onChange: (path: string) => void;
  onClose: () => void;
}

export function FolderPicker({ value, onChange, onClose }: Props) {
  const [current, setCurrent] = useState(value || '');
  const [parent, setParent] = useState('');
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const browse = async (path?: string) => {
    setLoading(true);
    setError('');
    try {
      const url = path ? `/api/browse?path=${encodeURIComponent(path)}` : '/api/browse';
      const resp = await fetch(url);
      const data: BrowseResult = await resp.json();
      if (data.error) {
        setError(data.error);
      } else {
        setCurrent(data.current);
        setParent(data.parent);
        setFolders(data.folders);
      }
    } catch {
      setError('Failed to browse directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    browse(value || undefined);
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/60 z-modal flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-th-bg-alt border border-th-border rounded-lg shadow-2xl w-full max-w-lg flex flex-col h-[70vh]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-th-border">
          <FolderOpen className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
          <span className="text-sm font-semibold text-th-text">Select Directory</span>
          <span className="flex-1" />
          <button type="button" aria-label="Close folder picker" onClick={onClose} className="text-th-text-muted hover:text-th-text text-lg leading-none p-1">×</button>
        </div>

        {/* Current path */}
        <div className="px-4 py-2 bg-th-bg/50 border-b border-th-border flex items-center gap-2">
          <span className="text-xs font-mono text-th-text-alt truncate flex-1" title={current}>{current}</span>
          {parent && parent !== current && (
            <button
              type="button"
              aria-label="Go to parent directory"
              onClick={() => browse(parent)}
              className="p-1 text-th-text-muted hover:text-th-text shrink-0"
              title="Go up"
            >
              <ChevronUp size={14} />
            </button>
          )}
        </div>

        {/* Folder list */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-th-text-muted" />
            </div>
          ) : error ? (
            <div className="px-4 py-3 text-xs text-red-400">{error}</div>
          ) : folders.length === 0 ? (
            <div className="px-4 py-6 text-xs text-th-text-muted text-center">No subdirectories</div>
          ) : (
            <div className="py-1">
              {folders.map((f) => (
                <button
                  key={f.path}
                  onClick={() => browse(f.path)}
                  className="w-full text-left flex items-center gap-2 px-4 py-1.5 text-sm text-th-text-alt hover:bg-th-bg-muted/60 transition-colors"
                >
                  <Folder className="w-4 h-4 text-yellow-600/70 dark:text-yellow-400/70 shrink-0" />
                  <span className="truncate">{f.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-th-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-th-text-muted hover:text-th-text rounded hover:bg-th-bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={() => { onChange(current); onClose(); }}
            className="px-4 py-1.5 text-xs bg-yellow-600 hover:bg-yellow-500 text-black font-semibold rounded"
          >
            Select "{current.split('/').pop() || current}"
          </button>
        </div>
      </div>
    </div>
  );
}
