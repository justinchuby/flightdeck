import { useMemo } from 'react';
import type { AgentInfo } from '../types';
import type { AgentComm } from '../stores/leadStore';
import type { CanvasLayout } from './useCanvasLayout';

// ── Types ──────────────────────────────────────────────────────────

export interface CanvasNodeData {
  agent: AgentInfo;
  commVolume: number;
  isUserPositioned: boolean;
  [key: string]: unknown;
}

export interface CanvasEdgeData {
  messageCount: number;
  lastMessageAt: number;
  types: string[];
  isActive: boolean;
  [key: string]: unknown;
}

export interface CanvasNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: CanvasNodeData;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  data: CanvasEdgeData;
}

// ── Auto-layout (circular) ─────────────────────────────────────────

const RADIUS = 300;

function autoPosition(
  agents: AgentInfo[],
  layout: CanvasLayout | null,
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};

  // Lead agent at center
  const lead = agents.find((a) => a.role?.id === 'lead' && !a.parentId);
  const others = agents.filter((a) => a !== lead);

  if (lead) {
    positions[lead.id] = layout?.positions?.[lead.id] ?? { x: 0, y: 0 };
  }

  // Role priority for ordering
  const rolePriority: Record<string, number> = {
    architect: 1, developer: 2, 'code-reviewer': 3, 'qa-tester': 4,
    designer: 5, 'tech-writer': 6, secretary: 7,
  };

  const sorted = [...others].sort((a, b) => {
    const pa = rolePriority[a.role?.id ?? ''] ?? 10;
    const pb = rolePriority[b.role?.id ?? ''] ?? 10;
    return pa - pb;
  });

  sorted.forEach((agent, i) => {
    if (layout?.positions?.[agent.id]) {
      positions[agent.id] = layout.positions[agent.id];
    } else {
      const angle = (2 * Math.PI * i) / Math.max(sorted.length, 1);
      positions[agent.id] = {
        x: Math.cos(angle) * RADIUS,
        y: Math.sin(angle) * RADIUS,
      };
    }
  });

  return positions;
}

// ── Hook ───────────────────────────────────────────────────────────

export function useCanvasGraph(
  agents: AgentInfo[],
  comms: AgentComm[],
  layout: CanvasLayout | null,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return useMemo(() => {
    // Filter out terminated agents
    const visible = agents.filter((a) => a.status !== 'terminated');
    const positions = autoPosition(visible, layout);

    // Build comm volume per agent
    const commVolume = new Map<string, number>();
    for (const c of comms) {
      commVolume.set(c.fromId, (commVolume.get(c.fromId) ?? 0) + 1);
      commVolume.set(c.toId, (commVolume.get(c.toId) ?? 0) + 1);
    }

    // Nodes
    const nodes: CanvasNode[] = visible.map((agent) => ({
      id: agent.id,
      type: 'agent',
      position: positions[agent.id] ?? { x: 0, y: 0 },
      data: {
        agent,
        commVolume: commVolume.get(agent.id) ?? 0,
        isUserPositioned: !!layout?.positions?.[agent.id],
      },
    }));

    // Aggregate comms into edges (bidirectional key)
    const edgeMap = new Map<string, {
      source: string; target: string;
      count: number; lastAt: number; types: Set<string>;
    }>();

    const now = Date.now();
    for (const c of comms) {
      const key = [c.fromId, c.toId].sort().join('-');
      const existing = edgeMap.get(key);
      if (existing) {
        existing.count++;
        existing.lastAt = Math.max(existing.lastAt, c.timestamp);
        if (c.type) existing.types.add(c.type);
      } else {
        edgeMap.set(key, {
          source: c.fromId,
          target: c.toId,
          count: 1,
          lastAt: c.timestamp,
          types: new Set(c.type ? [c.type] : []),
        });
      }
    }

    const edges: CanvasEdge[] = Array.from(edgeMap.entries()).map(([key, data]) => ({
      id: key,
      source: data.source,
      target: data.target,
      type: 'comm',
      data: {
        messageCount: data.count,
        lastMessageAt: data.lastAt,
        types: Array.from(data.types),
        isActive: now - data.lastAt < 10_000,
      },
    }));

    return { nodes, edges };
  }, [agents, comms, layout]);
}
