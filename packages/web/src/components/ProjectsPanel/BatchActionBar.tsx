interface BatchActionBarProps {
  selectedCount: number;
  allSelectedArchived: boolean;
  onSelectAll: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}

/** Toolbar shown when one or more projects are selected. */
export function BatchActionBar({ selectedCount, allSelectedArchived, onSelectAll, onArchive, onDelete, onClear }: BatchActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
      <span className="text-xs font-medium text-th-text-alt">{selectedCount} selected</span>
      <button onClick={onSelectAll} className="text-xs text-blue-400 hover:underline">Select all</button>
      <div className="flex-1" />
      <button
        onClick={onArchive}
        className="text-xs px-2 py-1 rounded bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
      >
        Archive selected
      </button>
      <button
        onClick={onDelete}
        disabled={!allSelectedArchived}
        className="text-xs px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title={allSelectedArchived ? 'Delete selected projects' : 'Only archived projects can be deleted'}
      >
        Delete selected
      </button>
      <button onClick={onClear} className="text-xs text-th-text-muted hover:text-th-text transition-colors">
        ✕
      </button>
    </div>
  );
}
