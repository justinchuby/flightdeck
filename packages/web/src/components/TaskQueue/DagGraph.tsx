import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import type { DagStatus, DagTask } from '../../types';
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const NODE_W = 160;
const NODE_H = 60;
const NODE_RX = 8;
const H_GAP = 220;
const V_GAP = 80;
const PAD = 40;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.1;
const ARROW_SIZE = 8;

// ---------------------------------------------------------------------------
// Status → visual config
// ---------------------------------------------------------------------------
type DagTaskStatus = DagTask['dagStatus'];

interface StatusStyle {
  bg: string;
  border: string;
  icon: string;
  opacity: number;
  pulse: boolean;
}

const STATUS_STYLES: Record<DagTaskStatus, StatusStyle> = {
  pending:  { bg: '#374151', border: '#6b7280', icon: '⏳', opacity: 1,   pulse: false },
  ready:    { bg: '#065f46', border: '#10b981', icon: '🟢', opacity: 1,   pulse: false },
  running:  { bg: '#1e3a5f', border: '#3b82f6', icon: '🔵', opacity: 1,   pulse: true  },
  done:     { bg: '#064e3b', border: '#34d399', icon: '✅', opacity: 0.7, pulse: false },
  failed:   { bg: '#7f1d1d', border: '#ef4444', icon: '❌', opacity: 1,   pulse: false },
  blocked:  { bg: '#78350f', border: '#f59e0b', icon: '🟠', opacity: 1,   pulse: false },
  paused:   { bg: '#713f12', border: '#eab308', icon: '⏸️', opacity: 1,   pulse: false },
  skipped:  { bg: '#1f2937', border: '#4b5563', icon: '⏭️', opacity: 0.5, pulse: false },
};

// ---------------------------------------------------------------------------
// Layout: layered topological sort
// ---------------------------------------------------------------------------
interface LayoutNode {
  task: DagTask;
  layer: number;
  order: number;
  x: number;
  y: number;
}

interface LayoutEdge {
  from: string;
  to: string;
  status: DagTaskStatus;
}

interface GraphLayout {
  nodes: Map<string, LayoutNode>;
  edges: LayoutEdge[];
  width: number;
  height: number;
}

function computeLayout(tasks: DagTask[]): GraphLayout {
  const taskMap = new Map<string, DagTask>();
  for (const t of tasks) taskMap.set(t.id, t);

  // 1. Assign layers via longest-path topological layering
  const layers = new Map<string, number>();
  const visited = new Set<string>();

  function assignLayer(id: string): number {
    if (layers.has(id)) return layers.get(id)!;
    if (visited.has(id)) return 0; // cycle guard
    visited.add(id);

    const task = taskMap.get(id);
    if (!task || task.dependsOn.length === 0) {
      layers.set(id, 0);
      return 0;
    }

    let maxDep = 0;
    for (const dep of task.dependsOn) {
      if (taskMap.has(dep)) {
        maxDep = Math.max(maxDep, assignLayer(dep) + 1);
      }
    }
    layers.set(id, maxDep);
    return maxDep;
  }

  for (const t of tasks) assignLayer(t.id);

  // 2. Group by layer
  const layerGroups = new Map<number, string[]>();
  for (const t of tasks) {
    const l = layers.get(t.id) ?? 0;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l)!.push(t.id);
  }

  const layerCount = layerGroups.size === 0 ? 0 : Math.max(...layerGroups.keys()) + 1;

  // 3. Minimize crossings: order nodes within each layer by median of parents in previous layer
  // First pass: initial order (by priority then id)
  const orderMap = new Map<string, number>();

  for (let l = 0; l < layerCount; l++) {
    const group = layerGroups.get(l) ?? [];
    // Sort by priority desc, then id for stability
    group.sort((a, b) => {
      const ta = taskMap.get(a)!;
      const tb = taskMap.get(b)!;
      return tb.priority - ta.priority || a.localeCompare(b);
    });
    group.forEach((id, idx) => orderMap.set(id, idx));
  }

  // Two barycenter sweeps to reduce crossings
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let l = 1; l < layerCount; l++) {
      const group = layerGroups.get(l) ?? [];
      const medians = new Map<string, number>();

      for (const id of group) {
        const task = taskMap.get(id)!;
        const parentOrders: number[] = [];
        for (const dep of task.dependsOn) {
          if (orderMap.has(dep)) parentOrders.push(orderMap.get(dep)!);
        }
        if (parentOrders.length > 0) {
          parentOrders.sort((a, b) => a - b);
          const mid = Math.floor(parentOrders.length / 2);
          medians.set(id, parentOrders[mid]);
        } else {
          medians.set(id, orderMap.get(id) ?? 0);
        }
      }

      group.sort((a, b) => (medians.get(a) ?? 0) - (medians.get(b) ?? 0));
      group.forEach((id, idx) => orderMap.set(id, idx));
    }
  }

  // 4. Compute positions
  const nodes = new Map<string, LayoutNode>();

  for (let l = 0; l < layerCount; l++) {
    const group = layerGroups.get(l) ?? [];
    const layerHeight = group.length * (NODE_H + V_GAP) - V_GAP;
    const startY = -layerHeight / 2; // center vertically around 0

    group.forEach((id, idx) => {
      const task = taskMap.get(id)!;
      nodes.set(id, {
        task,
        layer: l,
        order: idx,
        x: PAD + l * (NODE_W + H_GAP),
        y: startY + idx * (NODE_H + V_GAP),
      });
    });
  }

  // 5. Normalize: shift all nodes so the min y is PAD
  let minY = Infinity;
  let maxY = -Infinity;
  let maxX = 0;
  for (const n of nodes.values()) {
    if (n.y < minY) minY = n.y;
    if (n.y + NODE_H > maxY) maxY = n.y + NODE_H;
    if (n.x + NODE_W > maxX) maxX = n.x + NODE_W;
  }

  const yShift = PAD - minY;
  for (const n of nodes.values()) {
    n.y += yShift;
  }

  // 6. Compute edges
  const edges: LayoutEdge[] = [];
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (taskMap.has(dep)) {
        const depTask = taskMap.get(dep)!;
        edges.push({
          from: dep,
          to: t.id,
          status: depTask.dagStatus,
        });
      }
    }
  }

  const width = maxX + PAD;
  const height = maxY + yShift + PAD;

  return { nodes, edges, width, height };
}

// ---------------------------------------------------------------------------
// Tooltip component
// ---------------------------------------------------------------------------
interface TooltipData {
  task: DagTask;
  x: number;
  y: number;
}

function Tooltip({ data }: { data: TooltipData }) {
  const { task, x, y } = data;
  return (
    <div
      className="fixed z-[9999] pointer-events-none bg-gray-900 border border-gray-600 rounded-lg shadow-xl px-3 py-2 text-xs text-gray-200 max-w-xs"
      style={{ left: x + 12, top: y - 8 }}
    >
      <div className="font-mono font-bold text-white mb-1 break-all">{task.id}</div>
      <div className="text-gray-300 mb-1">{task.description || '(no description)'}</div>
      <div className="space-y-0.5 text-[10px] text-gray-400">
        <div><span className="text-gray-500">Role:</span> {task.role}</div>
        <div><span className="text-gray-500">Status:</span> {STATUS_STYLES[task.dagStatus].icon} {task.dagStatus}</div>
        {task.assignedAgentId && (
          <div><span className="text-gray-500">Agent:</span> {task.assignedAgentId}</div>
        )}
        {task.files.length > 0 && (
          <div><span className="text-gray-500">Files:</span> {task.files.join(', ')}</div>
        )}
        {task.dependsOn.length > 0 && (
          <div><span className="text-gray-500">Depends on:</span> {task.dependsOn.join(', ')}</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edge path builder: cubic bezier from right side of source to left side of target
// ---------------------------------------------------------------------------
function buildEdgePath(from: LayoutNode, to: LayoutNode): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const dx = (x2 - x1) * 0.5;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function edgeColor(status: DagTaskStatus): string {
  if (status === 'done') return '#34d399';
  if (status === 'failed') return '#ef4444';
  return '#4b5563';
}

// ---------------------------------------------------------------------------
// Truncate long text
// ---------------------------------------------------------------------------
function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

// ---------------------------------------------------------------------------
// DagGraph component
// ---------------------------------------------------------------------------
interface DagGraphProps {
  dagStatus: DagStatus | null;
}

export function DagGraph({ dagStatus }: DagGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Pan/zoom state stored in refs to avoid re-renders during drag
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const layout = useMemo(() => {
    if (!dagStatus || dagStatus.tasks.length === 0) return null;
    return computeLayout(dagStatus.tasks);
  }, [dagStatus]);

  // Reset view: center the graph
  const resetView = useCallback(() => {
    const t = { x: 0, y: 0, scale: 1 };
    transformRef.current = t;
    setTransform(t);
  }, []);

  // Auto-reset when layout changes
  useEffect(() => {
    resetView();
  }, [layout, resetView]);

  // Mouse handlers for pan
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX - transformRef.current.x, y: e.clientY - transformRef.current.y };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const x = e.clientX - dragStart.current.x;
    const y = e.clientY - dragStart.current.y;
    transformRef.current = { ...transformRef.current, x, y };
    setTransform({ ...transformRef.current });
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  // Wheel handler for zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, transformRef.current.scale + delta));

    // Zoom toward cursor position
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const scaleChange = newScale / transformRef.current.scale;
      const newX = cx - scaleChange * (cx - transformRef.current.x);
      const newY = cy - scaleChange * (cy - transformRef.current.y);
      transformRef.current = { x: newX, y: newY, scale: newScale };
    } else {
      transformRef.current = { ...transformRef.current, scale: newScale };
    }

    setTransform({ ...transformRef.current });
  }, []);

  const zoomIn = useCallback(() => {
    const newScale = Math.min(MAX_ZOOM, transformRef.current.scale + ZOOM_STEP * 2);
    transformRef.current = { ...transformRef.current, scale: newScale };
    setTransform({ ...transformRef.current });
  }, []);

  const zoomOut = useCallback(() => {
    const newScale = Math.max(MIN_ZOOM, transformRef.current.scale - ZOOM_STEP * 2);
    transformRef.current = { ...transformRef.current, scale: newScale };
    setTransform({ ...transformRef.current });
  }, []);

  // Node hover handlers
  const handleNodeEnter = useCallback((task: DagTask, e: React.MouseEvent) => {
    setTooltip({ task, x: e.clientX, y: e.clientY });
  }, []);

  const handleNodeMove = useCallback((task: DagTask, e: React.MouseEvent) => {
    setTooltip({ task, x: e.clientX, y: e.clientY });
  }, []);

  const handleNodeLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  if (!dagStatus || dagStatus.tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        No DAG tasks to visualize
      </div>
    );
  }

  if (!layout) return null;

  const { nodes, edges, width, height } = layout;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-gray-900/50 rounded-lg"
      style={{ minHeight: 400 }}
    >
      {/* Controls */}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <button
          onClick={zoomIn}
          className="p-1.5 bg-gray-800 border border-gray-600 rounded text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
          title="Zoom in"
        >
          <ZoomIn size={14} />
        </button>
        <button
          onClick={zoomOut}
          className="p-1.5 bg-gray-800 border border-gray-600 rounded text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
          title="Zoom out"
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={resetView}
          className="p-1.5 bg-gray-800 border border-gray-600 rounded text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
          title="Reset view"
        >
          <RotateCcw size={14} />
        </button>
        <span className="flex items-center px-2 text-[10px] text-gray-500 font-mono">
          {Math.round(transform.scale * 100)}%
        </span>
      </div>

      {/* SVG canvas */}
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className="cursor-grab active:cursor-grabbing select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* Defs: arrow markers + pulse animation */}
        <defs>
          <marker
            id="arrow-gray"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth={ARROW_SIZE}
            markerHeight={ARROW_SIZE}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5563" />
          </marker>
          <marker
            id="arrow-green"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth={ARROW_SIZE}
            markerHeight={ARROW_SIZE}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#34d399" />
          </marker>
          <marker
            id="arrow-red"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth={ARROW_SIZE}
            markerHeight={ARROW_SIZE}
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
          </marker>
        </defs>

        {/* Pan/zoom group */}
        <g
          transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}
          style={{ transition: isDragging.current ? 'none' : 'transform 0.1s ease-out' }}
        >
          {/* Edges */}
          {edges.map((edge) => {
            const fromNode = nodes.get(edge.from);
            const toNode = nodes.get(edge.to);
            if (!fromNode || !toNode) return null;
            const color = edgeColor(edge.status);
            const markerId = edge.status === 'done' ? 'arrow-green' : edge.status === 'failed' ? 'arrow-red' : 'arrow-gray';
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={buildEdgePath(fromNode, toNode)}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
                markerEnd={`url(#${markerId})`}
                opacity={0.8}
              />
            );
          })}

          {/* Nodes */}
          {Array.from(nodes.values()).map((node) => {
            const style = STATUS_STYLES[node.task.dagStatus];
            return (
              <g
                key={node.task.id}
                transform={`translate(${node.x}, ${node.y})`}
                opacity={style.opacity}
                onMouseEnter={(e) => handleNodeEnter(node.task, e)}
                onMouseMove={(e) => handleNodeMove(node.task, e)}
                onMouseLeave={handleNodeLeave}
                className="cursor-pointer"
              >
                {/* Node background */}
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={NODE_RX}
                  ry={NODE_RX}
                  fill={style.bg}
                  stroke={style.border}
                  strokeWidth={1.5}
                >
                  {style.pulse && (
                    <animate
                      attributeName="stroke-opacity"
                      values="1;0.4;1"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                  )}
                </rect>

                {/* Hover highlight */}
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={NODE_RX}
                  ry={NODE_RX}
                  fill="white"
                  opacity={0}
                  className="transition-opacity duration-150"
                  onMouseEnter={(e) => {
                    (e.target as SVGRectElement).setAttribute('opacity', '0.08');
                  }}
                  onMouseLeave={(e) => {
                    (e.target as SVGRectElement).setAttribute('opacity', '0');
                  }}
                />

                {/* Status icon */}
                <text
                  x={12}
                  y={NODE_H / 2 - 6}
                  fontSize="14"
                  textAnchor="start"
                  dominantBaseline="central"
                >
                  {style.icon}
                </text>

                {/* Task ID */}
                <text
                  x={32}
                  y={NODE_H / 2 - 6}
                  fontSize="11"
                  fontFamily="monospace"
                  fill="#e5e7eb"
                  textAnchor="start"
                  dominantBaseline="central"
                >
                  {truncate(node.task.id, 14)}
                </text>

                {/* Role */}
                <text
                  x={NODE_W / 2}
                  y={NODE_H / 2 + 12}
                  fontSize="10"
                  fill="#9ca3af"
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {truncate(node.task.role, 18)}
                </text>
              </g>
            );
          })}
        </g>

        {/* Hidden rect to capture background mouse events for viewBox sizing */}
        <rect width="100%" height="100%" fill="transparent" pointerEvents="none" />
      </svg>

      {/* Tooltip overlay */}
      {tooltip && <Tooltip data={tooltip} />}
    </div>
  );
}
