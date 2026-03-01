import { useMemo, useCallback, useEffect, useRef } from 'react';
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
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { DagStatus, DagTask } from '../../types';

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
// Helpers
// ---------------------------------------------------------------------------
function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

function edgeColor(status: DagTaskStatus): string {
  if (status === 'done') return '#34d399';
  if (status === 'failed') return '#ef4444';
  return '#4b5563';
}

// ---------------------------------------------------------------------------
// Custom node component
// ---------------------------------------------------------------------------
type DagTaskNodeData = { task: DagTask };

function DagTaskNode({ data }: NodeProps<Node<DagTaskNodeData>>) {
  const task = data.task;
  const style = STATUS_STYLES[task.dagStatus];

  return (
    <div
      style={{
        width: NODE_W,
        height: NODE_H,
        background: style.bg,
        border: `1.5px solid ${style.border}`,
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
        style={{ background: style.border, width: 6, height: 6, border: 'none' }}
      />

      {/* Row 1: icon + task ID */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 18 }}>
        <span style={{ fontSize: 13, lineHeight: 1 }}>{style.icon}</span>
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 11,
            color: '#e5e7eb',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {truncate(task.id, 16)}
        </span>
      </div>

      {/* Row 2: role */}
      <div
        style={{
          fontSize: 10,
          color: '#9ca3af',
          textAlign: 'center',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {task.role}
      </div>

      {/* Row 3: description (2 lines max) */}
      {task.description && (
        <div
          style={{
            fontSize: 9,
            color: '#6b7280',
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
            color: '#60a5fa',
            background: '#1e3a5f',
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
          🤖 {truncate(task.assignedAgentId, 14)}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: style.border, width: 6, height: 6, border: 'none' }}
      />
    </div>
  );
}

// Register at module level to avoid re-renders
const nodeTypes = { dagTask: DagTaskNode };

// ---------------------------------------------------------------------------
// Layout: layered topological sort → React Flow nodes & edges
// ---------------------------------------------------------------------------
function dagToFlow(tasks: DagTask[]): { nodes: Node<DagTaskNodeData>[]; edges: Edge[] } {
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
      data: { task },
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
        const color = edgeColor(status);
        flowEdges.push({
          id: `${dep}->${t.id}`,
          source: dep,
          target: t.id,
          type: 'smoothstep',
          animated: status === 'running',
          style: { stroke: color, strokeWidth: 1.5, opacity: 0.8 },
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

  return { nodes: flowNodes, edges: flowEdges };
}

// ---------------------------------------------------------------------------
// Inner component (needs ReactFlowProvider above it to use useReactFlow)
// ---------------------------------------------------------------------------
function DagGraphInner({ dagStatus }: { dagStatus: DagStatus }) {
  const { fitView } = useReactFlow();
  const prevTaskKeyRef = useRef('');

  const { initialNodes, initialEdges } = useMemo(() => {
    const { nodes, edges } = dagToFlow(dagStatus.tasks);
    return { initialNodes: nodes, initialEdges: edges };
  }, [dagStatus]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when data changes — update nodes/edges and fit view
  useEffect(() => {
    const taskKey = dagStatus.tasks.map((t) => `${t.id}:${t.dagStatus}`).join('|');
    setNodes(initialNodes);
    setEdges(initialEdges);

    // Fit view on structural changes (new/removed tasks), not just status updates
    const structKey = dagStatus.tasks.map((t) => t.id).sort().join(',');
    const prevStructKey = prevTaskKeyRef.current;
    prevTaskKeyRef.current = structKey;
    if (prevStructKey !== structKey || prevStructKey === '') {
      // Allow React Flow to process the new nodes before fitting
      requestAnimationFrame(() => {
        fitView({ padding: 0.15, duration: 200 });
      });
    }
  }, [initialNodes, initialEdges, dagStatus.tasks, setNodes, setEdges, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
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
      <Background color="#374151" gap={20} size={1} />
      <Controls
        showInteractive={false}
        style={{ background: '#1f2937', borderColor: '#374151' }}
      />
      <MiniMap
        nodeColor={(node) => {
          const task = (node.data as DagTaskNodeData).task;
          return STATUS_STYLES[task.dagStatus].border;
        }}
        maskColor="rgba(0, 0, 0, 0.7)"
        style={{ background: '#111827', borderColor: '#374151' }}
        position="bottom-right"
      />
    </ReactFlow>
  );
}

// ---------------------------------------------------------------------------
// Dark theme overrides + pulse animation
// ---------------------------------------------------------------------------
const darkStyles = `
  .dag-flow-container .react-flow__controls button {
    background: #1f2937;
    border-color: #374151;
    color: #9ca3af;
    fill: #9ca3af;
  }
  .dag-flow-container .react-flow__controls button:hover {
    background: #374151;
    color: #e5e7eb;
    fill: #e5e7eb;
  }
  .dag-flow-container .react-flow__minimap {
    background: #111827;
    border: 1px solid #374151;
  }
  @keyframes dagNodePulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); }
    50% { box-shadow: 0 0 8px 2px rgba(59, 130, 246, 0.4); }
  }
  .dag-node-pulse {
    animation: dagNodePulse 2s ease-in-out infinite;
  }
`;

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------
interface DagGraphProps {
  dagStatus: DagStatus | null;
}

export function DagGraph({ dagStatus }: DagGraphProps) {
  if (!dagStatus || dagStatus.tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-th-text-muted text-sm">
        No DAG tasks to visualize
      </div>
    );
  }

  return (
    <div
      className="dag-flow-container relative w-full overflow-hidden bg-th-bg/50 rounded-lg"
      style={{ height: 500 }}
    >
      <style>{darkStyles}</style>
      <ReactFlowProvider>
        <DagGraphInner dagStatus={dagStatus} />
      </ReactFlowProvider>
    </div>
  );
}
