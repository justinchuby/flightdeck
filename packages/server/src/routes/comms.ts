import { Router } from 'express';
import { shortAgentId } from '@flightdeck/shared';
import type { AppContext } from './context.js';
import type { ActivityEntry } from '../coordination/activity/ActivityLedger.js';

// ── Types ─────────────────────────────────────────────────────────

interface FlowNode {
  id: string;
  role: string;
  shortId: string;
  status: string;
}

interface FlowEdge {
  from: string;
  to: string | null;
  type: 'message' | 'broadcast' | 'group_message' | 'delegation';
  count: number;
  lastTimestamp: string;
  groupName?: string;
}

interface FlowTimelineEntry {
  timestamp: string;
  from: string;
  to: string | null;
  type: string;
  summary: string;
}

// ── Comm type mapping ─────────────────────────────────────────────

const ACTION_TO_COMM_TYPE: Record<string, FlowEdge['type']> = {
  message_sent: 'message',
  delegated: 'delegation',
  group_message: 'group_message',
};

const COMM_ACTION_TYPES = ['message_sent', 'delegated', 'group_message'];

// ── Routes ────────────────────────────────────────────────────────

export function commsRoutes(ctx: AppContext): Router {
  const { agentManager, activityLedger } = ctx;
  const router = Router();

  /** Resolve crew agent IDs for a lead */
  function getCrewIds(leadId: string): Set<string> {
    const ids = new Set<string>();
    ids.add(leadId);
    for (const agent of agentManager.getAll()) {
      if (agent.parentId === leadId || agent.id === leadId || agent.projectId === leadId) {
        ids.add(agent.id);
      }
    }
    return ids;
  }

  /** Filter activity entries to comm events for a crew */
  function getCommEvents(leadId: string, since?: string, types?: string[]): ActivityEntry[] {
    const crewIds = getCrewIds(leadId);
    const events = since
      ? activityLedger.getSince(since)
      : activityLedger.getRecent(10_000);

    return events.filter(e => {
      if (!crewIds.has(e.agentId)) return false;
      if (!COMM_ACTION_TYPES.includes(e.actionType)) return false;
      if (types && types.length > 0) {
        const commType = ACTION_TO_COMM_TYPE[e.actionType];
        if (!commType || !types.includes(commType)) return false;
      }
      return true;
    });
  }

  // GET /api/comms/:leadId/flows
  router.get('/comms/:leadId/flows', (req, res) => {
    try {
      const { leadId } = req.params;
      const since = req.query.since as string | undefined;
      const types = req.query.types
        ? (req.query.types as string).split(',').map(t => t.trim())
        : undefined;

      const events = getCommEvents(leadId, since, types);

      // Build nodes from crew agents
      const crewIds = getCrewIds(leadId);
      const nodes: FlowNode[] = [];
      for (const agent of agentManager.getAll()) {
        if (crewIds.has(agent.id)) {
          nodes.push({
            id: agent.id,
            role: agent.role?.name ?? agent.role?.id ?? 'unknown',
            shortId: shortAgentId(agent.id),
            status: agent.status,
          });
        }
      }

      // Build edges by aggregating comm events
      const edgeMap = new Map<string, FlowEdge>();
      const timeline: FlowTimelineEntry[] = [];

      for (const event of events) {
        const details = event.details as Record<string, string>;
        const commType = ACTION_TO_COMM_TYPE[event.actionType];
        if (!commType) continue;

        const from = event.agentId;
        const to = details.toAgentId === 'all' ? null : (details.toAgentId ?? null);
        const groupName = details.groupName ?? undefined;

        // Edge key: from→to→type
        const edgeKey = `${from}→${to ?? 'all'}→${commType}`;
        const existing = edgeMap.get(edgeKey);
        if (existing) {
          existing.count++;
          if (event.timestamp > existing.lastTimestamp) {
            existing.lastTimestamp = event.timestamp;
          }
        } else {
          edgeMap.set(edgeKey, {
            from,
            to,
            type: commType,
            count: 1,
            lastTimestamp: event.timestamp,
            groupName,
          });
        }

        timeline.push({
          timestamp: event.timestamp,
          from,
          to,
          type: commType,
          summary: event.summary.slice(0, 120),
        });
      }

      res.json({
        nodes,
        edges: [...edgeMap.values()],
        timeline,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to build comm flows', detail: (err as Error).message });
    }
  });

  // GET /api/comms/:leadId/stats
  router.get('/comms/:leadId/stats', (req, res) => {
    try {
      const { leadId } = req.params;
      const events = getCommEvents(leadId);

    const byType: Record<string, number> = {};
    const sentCount = new Map<string, number>();
    const receivedCount = new Map<string, number>();

    for (const event of events) {
      const commType = ACTION_TO_COMM_TYPE[event.actionType] ?? event.actionType;
      byType[commType] = (byType[commType] ?? 0) + 1;

      // Track sent
      sentCount.set(event.agentId, (sentCount.get(event.agentId) ?? 0) + 1);

      // Track received
      const details = event.details as Record<string, string>;
      const to = details.toAgentId;
      if (to && to !== 'all') {
        receivedCount.set(to, (receivedCount.get(to) ?? 0) + 1);
      }
    }

    // Find most active agent
    let mostActive = { agentId: '', sent: 0, received: 0 };
    const allAgentIds = new Set([...sentCount.keys(), ...receivedCount.keys()]);
    for (const id of allAgentIds) {
      const sent = sentCount.get(id) ?? 0;
      const received = receivedCount.get(id) ?? 0;
      if (sent + received > mostActive.sent + mostActive.received) {
        mostActive = { agentId: id, sent, received };
      }
    }

    res.json({
      totalMessages: events.length,
      byType,
      mostActive: mostActive.agentId ? mostActive : null,
    });
    } catch (err) {
      res.status(500).json({ error: 'Failed to compute comm stats', detail: (err as Error).message });
    }
  });

  return router;
}
