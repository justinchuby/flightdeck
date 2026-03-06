import { memo } from 'react';
import { BaseEdge, getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import type { CanvasEdgeData } from '../../hooks/useCanvasGraph';

function CommEdgeInner(props: EdgeProps & { data?: CanvasEdgeData }) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const count = data?.messageCount ?? 0;
  const isActive = data?.isActive ?? false;
  const isBroadcast = data?.types?.includes('broadcast');

  // Stroke width by volume (minimum 1.5 for visibility)
  const strokeWidth = count > 25 ? 4 : count > 10 ? 3 : count > 3 ? 2 : 1.5;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
  });

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: isActive ? 'var(--color-indigo-400, #818cf8)' : 'var(--chart-axis, #6b7280)',
          strokeWidth,
          strokeDasharray: isBroadcast ? '6 4' : undefined,
          opacity: count === 0 ? 0.35 : isActive ? 1 : 0.65,
          transition: 'stroke 0.3s, opacity 0.3s',
        }}
      />

      {/* Message count label */}
      {count > 0 && (
        <foreignObject
          x={labelX - 10}
          y={labelY - 10}
          width={20}
          height={20}
          className="pointer-events-none"
        >
          <div className="w-5 h-5 flex items-center justify-center rounded-full bg-th-bg-alt border border-th-border text-[9px] font-medium text-th-text-muted">
            {count}
          </div>
        </foreignObject>
      )}
    </>
  );
}

export const CommEdge = memo(CommEdgeInner);
