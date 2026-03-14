import { Upload } from 'lucide-react';

interface ImportProjectDialogProps {
  importPath: string;
  onPathChange: (value: string) => void;
  onImport: () => void;
  onClose: () => void;
  loading: boolean;
}

/** Modal dialog for importing an existing project from a directory path. */
export function ImportProjectDialog({ importPath, onPathChange, onImport, onClose, loading }: ImportProjectDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-surface-raised border border-th-border rounded-xl shadow-xl w-full max-w-md mx-4 p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-th-text mb-1">Import Project</h3>
        <p className="text-xs text-th-text-muted mb-4">
          Enter the path to a directory containing a <code className="bg-th-bg-alt px-1 rounded">.flightdeck/</code> folder.
          Shared artifacts will be available. Knowledge and memory from a previous database are not included.
        </p>
        <input
          type="text"
          value={importPath}
          onChange={e => onPathChange(e.target.value)}
          placeholder="/path/to/your/project"
          className="w-full bg-th-bg border border-th-border rounded-md px-3 py-2 text-sm font-mono text-th-text-alt focus:outline-none focus:border-accent mb-4"
          autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && importPath.trim()) onImport(); }}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={() => { onClose(); onPathChange(''); }}
            className="px-3 py-1.5 text-xs text-th-text-muted rounded-md hover:bg-th-bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onImport}
            disabled={!importPath.trim() || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent text-black rounded-md hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
