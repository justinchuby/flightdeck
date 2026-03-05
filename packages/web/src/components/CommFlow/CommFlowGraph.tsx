import { useMemo, useState, useCallback } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useLeadStore, type AgentComm } from '../../stores/leadStore';
import type { AgentInfo } from '../../types';
import type { AgentComm } from '../../stores/leadStore';

const EMPTY_COMMS: AgentComm[] = [];

// ── Layout ───────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  icon: string;
  status: string;
  x: number;
  y: number;
  messageCount: number;
}

interface GraphEdge {
  fromId: string;
  toId: string;
  count: number;
  types: Set<string>;
}

function layoutNodes(agents: AgentInfo[], width: number, height: number): GraphNode[] {
  if (agents.length === 0) return [];
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(cx, cy) * 0.7;

  return agents.map((agent, i) => {
    const angle = (2 * Math.PI * i) / agents.length - Math.PI / 2;
    const roleName = typeof agent.role === 'object' ? agent.role.name : String(agent.role);
    const icon = typeof agent.role === 'object' ? agent.role.icon : '🤖';
    return {
      id: agent.id,
      label: `${roleName} (${agent.id.slice(0, 8)})`,
      icon,
      status: agent.status,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      messageCount: 0,
    };
  });
}

function buildEdges(comms: AgentComm[]): GraphEdge[] {
  const edgeMap = new Map<string, GraphEdge>();
  for (const comm of comms) {
    if (!comm.fromId || !comm.toId) continue;
    const key = `${comm.fromId}->${comm.toId}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.count++;
      if (comm.type) existing.types.add(comm.type);
    } else {
      edgeMap.set(key, {
        fromId: comm.fromId,
        toId: comm.toId,
        count: 1,
        types: new Set(comm.type ? [comm.type] : []),
      });
    }
  }
  return [...edgeMap.values()];
}

// ── Status colors ────────────────────────────────────────────────────

const STATUS_FILL: Record<string, string> = {
  running: '#22c55e',
  idle: '#94a3b8',
  completed: '#3b82f6',
  failed: '#ef4444',
  creating: '#f59e0b',
  terminated: '#6b7280',
};

const EDGE_COLORS: Record<string, string> = {
  delegation: '#3b82f6',
  message: '#a855f7',
  agent_message: '#a855f7',
  message_sent: '#a855f7',
  group_message: '#f97316',
  broadcast: '#22d3ee',
  report: '#10b981',
};

function edgeColor(types: Set<string>): string {
  for (const [type, color] of Object.entries(EDGE_COLORS)) {
    if (types.has(type)) return color;
  }
  return '#64748b';
}

// ── SVG Components ───────────────────────────────────────────────────

interface EdgePathProps {
  from: GraphNode;
  to: GraphNode;
  edge: GraphEdge;
  selected: boolean;
  onSelect: () => void;
}

function EdgePath({ from, to, edge, selected, onSelect }: EdgePathProps) {
  // Offset for bidirectional edges
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const offset = 4;
  const mx = (from.x + to.x) / 2 + nx * offset * 8;
  const my = (from.y + to.y) / 2 + ny * offset * 8;
  const color = edgeColor(edge.types);
  const strokeWidth = Math.min(1 + edge.count * 0.3, 4);

  return (
    <g onClick={onSelect} className="cursor-pointer">
      <path
        d={`M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`}
        fill="none"
        stroke={color}
        strokeWidth={selected ? strokeWidth + 1 : strokeWidth}
        strokeOpacity={selected ? 0.9 : 0.4}
        markerEnd="url(#arrowhead)"
        className="transition-all duration-150"
      />
      {/* Count label at midpoint */}
      {edge.count > 1 && (
        <text
          x={(from.x + mx + to.x) / 3}
          y={(from.y + my + to.y) / 3}
          textAnchor="middle"
          className="text-[9px] fill-current"
          style={{ fill: color }}
        >
          {edge.count}
        </text>
      )}
    </g>
  );
}

interface NodeCircleProps {
  node: GraphNode;
  selected: boolean;
  onSelect: () => void;
}

function NodeCircle({ node, selected, onSelect }: NodeCircleProps) {
  const fill = STATUS_FILL[node.status] ?? '#64748b';
  return (
    <g onClick={onSelect} className="cursor-pointer">
      {/* Glow ring for selected */}
      {selected && (
        <circle cx={node.x} cy={node.y} r={24} fill="none" stroke={fill} strokeWidth={2} strokeOpacity={0.4} />
      )}
      {/* Main circle */}
      <circle cx={node.x} cy={node.y} r={18} fill={fill} fillOpacity={0.15} stroke={fill} strokeWidth={1.5} />
      {/* Icon */}
      <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="central" className="text-sm select-none">
        {node.icon}
      </text>
      {/* Label */}
      <text
        x={node.x}
        y={node.y + 30}
        textAnchor="middle"
        className="text-[10px] fill-current text-th-text-muted select-none"
      >
        {node.label}
      </text>
    </g>
  );
}

// ── Main Component ───────────────────────────────────────────────────

interface CommFlowGraphProps {
  leadId: string;
  width?: number;
  height?: number;
}

export function CommFlowGraph({ leadId, width = 500, height = 400 }: CommFlowGraphProps) {
  const agents = useAppStore((s) => s.agents);
  const comms = useLeadStore((s) => s.projects[leadId]?.comms ?? EMPTY_COMMS);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);

  const teamAgents = useMemo(
    () => agents.filter((a) => a.parentId === leadId || a.id === leadId),
    [agents, leadId],
  );

  const nodes = useMemo(() => layoutNodes(teamAgents, width, height), [teamAgents, width, height]);
  const edges = useMemo(() => buildEdges(comms), [comms]);
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const selectNode = useCallback((id: string) => {
    setSelectedNodeId((prev) => (prev === id ? null : id));
    setSelectedEdgeKey(null);
  }, []);

  const selectEdge = useCallback((key: string) => {
    setSelectedEdgeKey((prev) => (prev === key ? null : key));
    setSelectedNodeId(null);
  }, []);

  // Filter edges to show for selected node
  const visibleEdges = useMemo(() => {
    if (!selectedNodeId) return edges;
    return edges.filter((e) => e.fromId === selectedNodeId || e.toId === selectedNodeId);
  }, [edges, selectedNodeId]);

  if (teamAgents.length === 0) {
    return (
      <div className="flex items-center justify-center text-th-text-muted text-xs" style={{ width, height }}>
        No agents in this session
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="select-none"
      data-testid="comm-flow-graph"
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="8"
          markerHeight="6"
          refX="22"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="#64748b" fillOpacity={0.6} />
        </marker>
      </defs>

      {/* Edges */}
      {visibleEdges.map((edge) => {
        const from = nodeMap.get(edge.fromId);
        const to = nodeMap.get(edge.toId);
        if (!from || !to) return null;
        const key = `${edge.fromId}->${edge.toId}`;
        return (
          <EdgePath
            key={key}
            from={from}
            to={to}
            edge={edge}
            selected={selectedEdgeKey === key}
            onSelect={() => selectEdge(key)}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map((node) => (
        <NodeCircle
          key={node.id}
          node={node}
          selected={selectedNodeId === node.id}
          onSelect={() => selectNode(node.id)}
        />
      ))}

      {/* Legend */}
      <g transform={`translate(8, ${height - 60})`}>
        <text className="text-[9px] fill-current text-th-text-muted font-medium" y={0}>Messages</text>
        {[
          ['Delegation', '#3b82f6'],
          ['Direct', '#a855f7'],
          ['Group', '#f97316'],
          ['Broadcast', '#22d3ee'],
        ].map(([label, color], i) => (
          <g key={label} transform={`translate(0, ${12 + i * 11})`}>
            <line x1={0} y1={0} x2={14} y2={0} stroke={color} strokeWidth={2} />
            <text x={18} y={3} className="text-[8px] fill-current text-th-text-muted">{label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
