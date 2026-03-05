import { RotateCcw, Maximize2, Tag, Zap } from 'lucide-react';

interface CanvasToolbarProps {
  onAutoLayout: () => void;
  onFitView: () => void;
  onToggleLabels: () => void;
  onToggleAnimations: () => void;
  showLabels: boolean;
  showAnimations: boolean;
}

export function CanvasToolbar({
  onAutoLayout,
  onFitView,
  onToggleLabels,
  onToggleAnimations,
  showLabels,
  showAnimations,
}: CanvasToolbarProps) {
  return (
    <div
      className="absolute top-3 right-3 z-10 flex gap-1 bg-th-bg/90 backdrop-blur-sm border border-th-border rounded-lg p-1"
      data-testid="canvas-toolbar"
    >
      <button
        onClick={onAutoLayout}
        className="w-8 h-8 flex items-center justify-center rounded-md text-th-text-muted hover:text-th-text hover:bg-th-bg-hover transition-colors"
        title="Auto-layout"
      >
        <RotateCcw size={16} />
      </button>
      <button
        onClick={onFitView}
        className="w-8 h-8 flex items-center justify-center rounded-md text-th-text-muted hover:text-th-text hover:bg-th-bg-hover transition-colors"
        title="Fit view"
      >
        <Maximize2 size={16} />
      </button>
      <button
        onClick={onToggleLabels}
        className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
          showLabels ? 'text-accent bg-accent/10' : 'text-th-text-muted hover:text-th-text hover:bg-th-bg-hover'
        }`}
        title={showLabels ? 'Hide labels' : 'Show labels'}
      >
        <Tag size={16} />
      </button>
      <button
        onClick={onToggleAnimations}
        className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
          showAnimations ? 'text-accent bg-accent/10' : 'text-th-text-muted hover:text-th-text hover:bg-th-bg-hover'
        }`}
        title={showAnimations ? 'Disable animations' : 'Enable animations'}
      >
        <Zap size={16} />
      </button>
    </div>
  );
}
