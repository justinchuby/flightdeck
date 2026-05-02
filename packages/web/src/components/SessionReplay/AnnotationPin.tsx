import type { ReplayAnnotation } from './types';
import { formatTime } from '../../utils/format';

interface AnnotationPinProps {
  annotation: ReplayAnnotation;
  position: number; // percentage 0-100 on timeline
  onClick: () => void;
}

const TYPE_STYLES: Record<ReplayAnnotation['type'], { icon: string; color: string }> = {
  comment: { icon: '💬', color: 'bg-gray-400' },
  flag: { icon: '🚩', color: 'bg-red-400' },
  bookmark: { icon: '🔖', color: 'bg-blue-400' },
};

export function AnnotationPin({ annotation, position, onClick }: AnnotationPinProps) {
  const style = TYPE_STYLES[annotation.type];

  return (
    <div
      className="absolute top-0 -translate-x-1/2 cursor-pointer group z-10"
      style={{ left: `${position}%` }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      data-testid="annotation-pin"
    >
      {/* Pin marker */}
      <div className={`w-2 h-5 rounded-full ${style.color} opacity-70 group-hover:opacity-100 transition-opacity`} />

      {/* Tooltip on hover */}
      <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block w-48 z-50">
        <div className="bg-surface-raised border border-th-border rounded-md shadow-lg px-2.5 py-1.5">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-xs">{style.icon}</span>
            <span className="text-[10px] text-th-text-muted capitalize">{annotation.type}</span>
            <span className="text-[9px] text-th-text-muted ml-auto">
              {formatTime(annotation.timestamp)}
            </span>
          </div>
          <p className="text-[11px] text-th-text-alt line-clamp-2">{annotation.text}</p>
          <p className="text-[9px] text-th-text-muted mt-0.5">by {annotation.author}</p>
        </div>
      </div>
    </div>
  );
}
