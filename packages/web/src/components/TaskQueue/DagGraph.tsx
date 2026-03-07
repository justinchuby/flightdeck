import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { DagStatus, DagTask } from '../../types';
import { computeCriticalPath, formatElapsed, type CriticalPathTask } from './dagCriticalPath';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const NODE_W = 180;
const NODE_H = 100;
const H_GAP = 240;
const V_GAP = 90;
const PAD = 40;

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
  pending:  { bg: 'var(--st-pending-bg)', border: 'var(--st-pending)', icon: '⏳', opacity: 1,   pulse: false },
  ready:    { bg: 'var(--st-ready-bg)', border: 'var(--st-ready)', icon: '🟢', opacity: 1,   pulse: false },
  running:  { bg: 'var(--st-running-bg)', border: 'var(--st-running)', icon: '🔵', opacity: 1,   pulse: true  },
  done:     { bg: 'var(--st-done-bg)', border: 'var(--st-done)', icon: '✅', opacity: 0.7, pulse: false },
  failed:   { bg: 'var(--st-failed-bg)', border: 'var(--st-failed)', icon: '❌', opacity: 1,   pulse: false },
  blocked:  { bg: 'var(--st-blocked-bg)', border: 'var(--st-blocked)', icon: '🟠', opacity: 1,   pulse: false },
  paused:   { bg: 'var(--st-paused-bg)', border: 'var(--st-paused)', icon: '⏸️', opacity: 1,   pulse: false },
  skipped:  { bg: 'var(--st-skipped-bg)', border: 'var(--st-skipped)', icon: '⏭️', opacity: 0.5, pulse: false },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

function edgeColor(status: DagTaskStatus): string {
  if (status === 'done') return 'var(--st-done)';
  if (status === 'failed') return 'var(--st-failed)';
  return 'var(--st-skipped)';
}

/** Apply visual highlighting to edges connected to the given node, dimming the rest. */
function applyEdgeHighlighting(edges: Edge[], highlightedNodeId: string | null): Edge[] {
  if (!highlightedNodeId) return edges;
  return edges.map(edge => {
    const isConnected = edge.source === highlightedNodeId || edge.target === highlightedNodeId;
    if (isConnected) {
      return {
        ...edge,
        style: { ...edge.style, strokeWidth: 3, opacity: 1 },
        zIndex: 10,
      };
    }
    return {
      ...edge,
      style: { ...edge.style, opacity: 0.15 },
      zIndex: 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Custom node component
// ---------------------------------------------------------------------------
type DagTaskNodeData = { task: DagTask; onCriticalPath?: boolean };

function DagTaskNode({ data }: NodeProps<Node<DagTaskNodeData>>) {
  const task = data.task;
  const style = STATUS_STYLES[task.dagStatus];
  const onCritical = data.onCriticalPath ?? false;

  const borderColor = onCritical ? 'var(--graph-critical)' : style.border;
  const borderWidth = onCritical ? 2 : 1.5;

  return (
    <div
      style={{
        width: NODE_W,
        height: NODE_H,
        background: style.bg,
        border: `${borderWidth}px solid ${borderColor}`,
        borderRadius: 8,
        opacity: style.opacity,
        padding: '6px 10px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
        cursor: 'pointer',
      }}
      className={style.pulse ? 'dag-node-pulse' : undefined}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: borderColor, width: 6, height: 6, border: 'none' }}
      />

      {/* Row 1: icon + task ID + critical path star */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 18 }}>
        <span style={{ fontSize: 13, lineHeight: 1 }}>{style.icon}</span>
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 11,
            color: 'var(--graph-text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: 1,
          }}
        >
          {truncate(task.title || task.id, 14)}
        </span>
        {onCritical && <span style={{ fontSize: 10, color: 'var(--graph-critical)', lineHeight: 1 }} title="Critical path">★</span>}
      </div>

      {/* Row 2: role + elapsed time */}
      <div
        style={{
          fontSize: 10,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <span style={{ color: 'var(--graph-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {task.role}
        </span>
        {(task.dagStatus === 'running' || task.dagStatus === 'done') && (
          <span style={{ color: task.dagStatus === 'running' ? 'var(--graph-text-accent)' : 'var(--st-pending)', fontSize: 9, flexShrink: 0, marginLeft: 4 }}>
            ⏱ {formatElapsed(task.createdAt, task.completedAt)}
          </span>
        )}
      </div>

      {/* Row 3: description (2 lines max) */}
      {task.description && (
        <div
          style={{
            fontSize: 9,
            color: 'var(--st-pending)',
            lineHeight: '1.2',
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {task.description}
        </div>
      )}

      {/* Agent badge */}
      {task.assignedAgentId && (
        <div
          style={{
            fontSize: 8,
            color: 'var(--graph-text-accent)',
            background: 'var(--st-running-bg)',
            borderRadius: 3,
            padding: '1px 4px',
            alignSelf: 'flex-start',
            marginTop: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          }}
        >
          🤖 {task.assignedAgentId.slice(0, 8)}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: borderColor, width: 6, height: 6, border: 'none' }}
      />
    </div>
  );
}

// Register at module level to avoid re-renders
const nodeTypes = { dagTask: DagTaskNode };

// ---------------------------------------------------------------------------
// Tooltip status colors (top border accent)
// ---------------------------------------------------------------------------
const TOOLTIP_STATUS_COLORS: Record<DagTaskStatus, string> = {
  pending: 'var(--st-pending)',
  ready:   'var(--st-ready)',
  running: 'var(--st-running)',
  done:    'var(--st-done)',
  failed:  'var(--st-failed)',
  blocked: 'var(--st-blocked)',
  paused:  'var(--st-paused)',
  skipped: 'var(--st-skipped)',
};

function formatTooltipDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// ---------------------------------------------------------------------------
// Tooltip types & component
// ---------------------------------------------------------------------------
interface TooltipState {
  task: DagTask;
  x: number;
  y: number;
}

function DagNodeTooltip({
  tooltip,
  pinned,
  taskMap,
  allTasks,
  containerHeight,
  onClose,
}: {
  tooltip: TooltipState;
  pinned: boolean;
  taskMap: Map<string, DagTask>;
  allTasks: DagTask[];
  containerHeight: number;
  onClose: () => void;
}) {
  const { task, x, y } = tooltip;
  const statusColor = TOOLTIP_STATUS_COLORS[task.dagStatus];
  const tooltipRef = useRef<HTMLDivElement>(null);

  const downstream = useMemo(
    () => allTasks.filter((t) => t.dependsOn.includes(task.id)),
    [allTasks, task.id],
  );

  const duration = useMemo(() => {
    if (task.completedAt && task.createdAt) {
      return formatTooltipDuration(
        new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime(),
      );
    }
    if (task.dagStatus === 'running' && task.createdAt) {
      return formatTooltipDuration(Date.now() - new Date(task.createdAt).getTime()) + ' (running)';
    }
    return null;
  }, [task]);

  const flipAbove = y + NODE_H + 8 + 200 > containerHeight;
  const top = flipAbove ? y - 8 : y + NODE_H + 8;

  return (
    <div
      ref={tooltipRef}
      role="tooltip"
      aria-label={`Details for task ${task.id}`}
      data-testid="dag-tooltip"
      style={{
        position: 'absolute',
        left: x + NODE_W / 2,
        top,
        transform: flipAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
        zIndex: 50,
        minWidth: 240,
        maxWidth: 360,
        borderRadius: 8,
        borderTop: `4px solid ${statusColor}`,
        background: 'var(--graph-bg)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        color: 'var(--graph-text)',
        fontSize: 12,
        pointerEvents: pinned ? 'auto' : 'none',
      }}
    >
      {/* Header */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--graph-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {task.title && (
            <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--graph-text)' }}>
              {task.title}
            </span>
          )}
          <span style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: task.title ? 'var(--graph-text-muted)' : undefined }}>
            {task.id}
          </span>
          <span
            data-testid="dag-tooltip-status"
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              padding: '1px 6px',
              borderRadius: 9999,
              background: statusColor + '33',
              color: statusColor,
              whiteSpace: 'nowrap',
            }}
          >
            {task.dagStatus}
          </span>
        </div>
        {pinned && (
          <button
            aria-label="Close tooltip"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--graph-text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Agent section */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--graph-border)' }}>
        <div style={{ color: 'var(--graph-text-muted)', fontSize: 10, marginBottom: 2 }}>Agent</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span>{task.role}</span>
          {task.model && <span style={{ color: 'var(--graph-text-muted)' }}>· {task.model}</span>}
          {task.assignedAgentId && (
            <span style={{ color: 'var(--graph-text-accent)', fontSize: 11 }}>🤖 {task.assignedAgentId.slice(0, 8)}</span>
          )}
        </div>
      </div>

      {/* Dependencies section */}
      {(task.dependsOn.length > 0 || downstream.length > 0) && (
        <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--graph-border)' }}>
          <div style={{ color: 'var(--graph-text-muted)', fontSize: 10, marginBottom: 2 }}>Dependencies</div>
          {task.dependsOn.length > 0 && (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: 'var(--graph-text-muted)', fontSize: 10 }}>↑ Upstream: </span>
              {task.dependsOn.map((depId) => {
                const dep = taskMap.get(depId);
                return (
                  <span key={depId} style={{ marginRight: 6, fontSize: 11 }}>
                    {dep ? truncate(dep.description || dep.id, 24) : depId}
                  </span>
                );
              })}
            </div>
          )}
          {downstream.length > 0 && (
            <div>
              <span style={{ color: 'var(--graph-text-muted)', fontSize: 10 }}>↓ Downstream: </span>
              {downstream.map((d) => (
                <span key={d.id} style={{ marginRight: 6, fontSize: 11 }}>
                  {truncate(d.description || d.id, 24)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detail section */}
      <div style={{ padding: '6px 12px', maxHeight: 160, overflowY: 'auto' }}>
        <div style={{ color: 'var(--graph-text-muted)', fontSize: 10, marginBottom: 2 }}>Detail</div>
        {task.description && (
          <div style={{ marginBottom: 4, lineHeight: 1.4 }}>{task.description}</div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 11, color: 'var(--graph-text-muted)' }}>
          {task.priority > 0 && <span>Priority: {task.priority}</span>}
          {duration && <span>Duration: {duration}</span>}
          {task.createdAt && <span>Created: {new Date(task.createdAt).toLocaleTimeString()}</span>}
          {task.completedAt && <span>Completed: {new Date(task.completedAt).toLocaleTimeString()}</span>}
        </div>
        {task.files.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <span style={{ color: 'var(--graph-text-muted)', fontSize: 10 }}>Files: </span>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--graph-text-accent)' }}>
              {task.files.map((f) => truncate(f, 30)).join(', ')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout: layered topological sort → React Flow nodes & edges
// ---------------------------------------------------------------------------
function dagToFlow(tasks: DagTask[]): { nodes: Node<DagTaskNodeData>[]; edges: Edge[]; criticalPath: Set<string> } {
  const taskMap = new Map<string, DagTask>();
  for (const t of tasks) taskMap.set(t.id, t);

  // Compute critical path
  const now = Date.now();
  const cpTasks: CriticalPathTask[] = tasks.map(t => ({
    id: t.id,
    dependsOn: t.dependsOn,
    createdAt: new Date(t.createdAt).getTime(),
    completedAt: t.completedAt ? new Date(t.completedAt).getTime() : undefined,
  }));
  const criticalPath = computeCriticalPath(cpTasks, now);

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

  // 3. Minimize crossings via barycenter heuristic
  const orderMap = new Map<string, number>();

  for (let l = 0; l < layerCount; l++) {
    const group = layerGroups.get(l) ?? [];
    group.sort((a, b) => {
      const ta = taskMap.get(a)!;
      const tb = taskMap.get(b)!;
      return tb.priority - ta.priority || a.localeCompare(b);
    });
    group.forEach((id, idx) => orderMap.set(id, idx));
  }

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
          medians.set(id, parentOrders[Math.floor(parentOrders.length / 2)]);
        } else {
          medians.set(id, orderMap.get(id) ?? 0);
        }
      }

      group.sort((a, b) => (medians.get(a) ?? 0) - (medians.get(b) ?? 0));
      group.forEach((id, idx) => orderMap.set(id, idx));
    }
  }

  // 4. Compute positions & normalize
  const positions = new Map<string, { x: number; y: number }>();

  for (let l = 0; l < layerCount; l++) {
    const group = layerGroups.get(l) ?? [];
    const layerHeight = group.length * (NODE_H + V_GAP) - V_GAP;
    const startY = -layerHeight / 2;

    group.forEach((id, idx) => {
      positions.set(id, {
        x: PAD + l * (NODE_W + H_GAP),
        y: startY + idx * (NODE_H + V_GAP),
      });
    });
  }

  // Shift so min y = PAD
  let minY = Infinity;
  for (const pos of positions.values()) {
    if (pos.y < minY) minY = pos.y;
  }
  const yShift = PAD - minY;
  for (const pos of positions.values()) {
    pos.y += yShift;
  }

  // 5. Build React Flow nodes
  const flowNodes: Node<DagTaskNodeData>[] = tasks.map((task) => {
    const pos = positions.get(task.id) ?? { x: 0, y: 0 };
    return {
      id: task.id,
      type: 'dagTask',
      position: pos,
      data: { task, onCriticalPath: criticalPath.has(task.id) },
      width: NODE_W,
      height: NODE_H,
    };
  });

  // 6. Build React Flow edges
  const flowEdges: Edge[] = [];
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (taskMap.has(dep)) {
        const depTask = taskMap.get(dep)!;
        const status = depTask.dagStatus;
        const isCritEdge = criticalPath.has(t.id) && criticalPath.has(dep);
        const color = isCritEdge ? 'var(--graph-critical)' : edgeColor(status);
        flowEdges.push({
          id: `${dep}->${t.id}`,
          source: dep,
          target: t.id,
          type: 'default',
          animated: status === 'running',
          style: {
            stroke: color,
            strokeWidth: isCritEdge ? 2.5 : 1.5,
            opacity: isCritEdge ? 1 : 0.8,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color,
            width: 16,
            height: 16,
          },
        });
      }
    }
  }

  return { nodes: flowNodes, edges: flowEdges, criticalPath };
}

// ---------------------------------------------------------------------------
// Inner component (needs ReactFlowProvider above it to use useReactFlow)
// ---------------------------------------------------------------------------
function DagGraphInner({ dagStatus, containerRef }: { dagStatus: DagStatus; containerRef: React.RefObject<HTMLDivElement | null> }) {
  const { fitView, flowToScreenPosition } = useReactFlow();
  const prevTaskKeyRef = useRef('');

  const { initialNodes, initialEdges, criticalPath } = useMemo(() => {
    const { nodes, edges, criticalPath } = dagToFlow(dagStatus.tasks);
    return { initialNodes: nodes, initialEdges: edges, criticalPath };
  }, [dagStatus]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Task lookup map for dependency resolution
  const taskMap = useMemo(() => {
    const m = new Map<string, DagTask>();
    for (const t of dagStatus.tasks) m.set(t.id, t);
    return m;
  }, [dagStatus.tasks]);

  // ── Tooltip state ──────────────────────────────────────────────────
  const [hoverTooltip, setHoverTooltip] = useState<TooltipState | null>(null);
  const [pinnedTooltip, setPinnedTooltip] = useState<TooltipState | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Edge highlighting state ────────────────────────────────────────
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const highlightedNodeId = pinnedTooltip?.task.id ?? hoveredNodeId;

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const getTooltipPosition = useCallback(
    (node: Node<DagTaskNodeData>) => {
      const screenPos = flowToScreenPosition({ x: node.position.x, y: node.position.y });
      const containerRect = containerRef.current?.getBoundingClientRect();
      return {
        x: screenPos.x - (containerRect?.left ?? 0),
        y: screenPos.y - (containerRect?.top ?? 0),
      };
    },
    [flowToScreenPosition, containerRef],
  );

  const onNodeMouseEnter: NodeMouseHandler<Node<DagTaskNodeData>> = useCallback(
    (_event, node) => {
      setHoveredNodeId(node.id);
      if (pinnedTooltip) return;
      clearHoverTimer();
      hoverTimerRef.current = setTimeout(() => {
        const pos = getTooltipPosition(node);
        setHoverTooltip({ task: node.data.task, x: pos.x, y: pos.y });
      }, 200);
    },
    [pinnedTooltip, clearHoverTimer, getTooltipPosition],
  );

  const onNodeMouseLeave: NodeMouseHandler<Node<DagTaskNodeData>> = useCallback(() => {
    setHoveredNodeId(null);
    clearHoverTimer();
    setHoverTooltip(null);
  }, [clearHoverTimer]);

  const onNodeClick: NodeMouseHandler<Node<DagTaskNodeData>> = useCallback(
    (_event, node) => {
      const pos = getTooltipPosition(node);
      setPinnedTooltip((prev) =>
        prev && prev.task.id === node.data.task.id ? null : { task: node.data.task, x: pos.x, y: pos.y },
      );
      setHoverTooltip(null);
      clearHoverTimer();
    },
    [getTooltipPosition, clearHoverTimer],
  );

  // Escape to unpin
  useEffect(() => {
    if (!pinnedTooltip) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPinnedTooltip(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [pinnedTooltip]);

  // Dismiss hover tooltip on zoom/pan
  const onMoveStart = useCallback(() => {
    setHoverTooltip(null);
    setHoveredNodeId(null);
    clearHoverTimer();
  }, [clearHoverTimer]);

  // Sync nodes when data changes
  useEffect(() => {
    setNodes(initialNodes);

    const structKey = dagStatus.tasks.map((t) => t.id).sort().join(',');
    const prevStructKey = prevTaskKeyRef.current;
    prevTaskKeyRef.current = structKey;
    if (prevStructKey !== structKey || prevStructKey === '') {
      requestAnimationFrame(() => {
        fitView({ padding: 0.15, duration: 200 });
      });
    }
  }, [initialNodes, dagStatus.tasks, setNodes, fitView]);

  // Sync edges with highlighting whenever data or highlighted node changes
  useEffect(() => {
    setEdges(applyEdgeHighlighting(initialEdges, highlightedNodeId));
  }, [initialEdges, highlightedNodeId, setEdges]);

  // Update pinned tooltip data when tasks change
  useEffect(() => {
    if (!pinnedTooltip) return;
    const updated = taskMap.get(pinnedTooltip.task.id);
    if (updated) {
      setPinnedTooltip((prev) => prev ? { ...prev, task: updated } : null);
    } else {
      setPinnedTooltip(null);
    }
  }, [dagStatus.tasks, taskMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTooltip = pinnedTooltip ?? hoverTooltip;
  const containerHeight = containerRef.current?.clientHeight ?? 500;

  // Progress stats
  const totalTasks = dagStatus.tasks.length;
  const doneTasks = dagStatus.tasks.filter(t => t.dagStatus === 'done').length;
  const runningTasks = dagStatus.tasks.filter(t => t.dagStatus === 'running').length;
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const criticalCount = criticalPath.size;

  return (
    <>
      {/* Progress header overlay */}
      <div
        data-testid="dag-progress-header"
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 20,
          background: 'rgba(17, 24, 39, 0.9)',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 11,
          color: 'var(--graph-text)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          pointerEvents: 'none',
        }}
      >
        <span style={{ fontWeight: 600 }}>{progressPct}%</span>
        <span style={{ color: 'var(--graph-text-muted)' }}>{doneTasks}/{totalTasks} done</span>
        {runningTasks > 0 && <span style={{ color: 'var(--graph-text-accent)' }}>🔵 {runningTasks} running</span>}
        {criticalCount > 0 && (
          <span style={{ color: 'var(--graph-critical)', display: 'flex', alignItems: 'center', gap: 3 }}>
            ★ {criticalCount} critical
          </span>
        )}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onNodeClick={onNodeClick}
        onMoveStart={onMoveStart}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent' }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
      >
        <Background color="var(--graph-border)" gap={20} size={1} />
        <Controls
          showInteractive={false}
          style={{ background: 'var(--graph-bg)', borderColor: 'var(--graph-border)' }}
        />
        <MiniMap
          nodeColor={(node) => {
            const task = (node.data as DagTaskNodeData).task;
            return STATUS_STYLES[task.dagStatus].border;
          }}
          maskColor="rgba(0, 0, 0, 0.7)"
          style={{ background: 'var(--graph-bg-alt)', borderColor: 'var(--graph-border)' }}
          position="bottom-right"
        />
      </ReactFlow>
      {activeTooltip && (
        <DagNodeTooltip
          tooltip={activeTooltip}
          pinned={!!pinnedTooltip}
          taskMap={taskMap}
          allTasks={dagStatus.tasks}
          containerHeight={containerHeight}
          onClose={() => setPinnedTooltip(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dark theme overrides + pulse animation
// ---------------------------------------------------------------------------
const darkStyles = `
  .dag-flow-container .react-flow__controls button {
    background: var(--graph-bg);
    border-color: var(--graph-border);
    color: var(--graph-text-muted);
    fill: var(--graph-text-muted);
  }
  .dag-flow-container .react-flow__controls button:hover {
    background: var(--graph-border);
    color: var(--graph-text);
    fill: var(--graph-text);
  }
  .dag-flow-container .react-flow__minimap {
    background: var(--graph-bg-alt);
    border: 1px solid var(--graph-border);
  }
  .dag-node-pulse {
    animation: glow-pulse 2s ease-in-out infinite;
  }
`;

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------
interface DagGraphProps {
  dagStatus: DagStatus | null;
}

export function DagGraph({ dagStatus }: DagGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  if (!dagStatus || dagStatus.tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-th-text-muted text-sm">
        No DAG tasks to visualize
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="dag-flow-container relative w-full overflow-hidden bg-th-bg/50 rounded-lg"
      style={{ height: 500 }}
    >
      <style>{darkStyles}</style>
      <ReactFlowProvider>
        <DagGraphInner dagStatus={dagStatus} containerRef={containerRef} />
      </ReactFlowProvider>
    </div>
  );
}
