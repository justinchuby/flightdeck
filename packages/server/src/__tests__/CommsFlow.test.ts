import { describe, it, expect } from 'vitest';

/**
 * Tests for the comms flow API logic.
 * Since the route handlers are Express callbacks, we test the data transformation
 * patterns they use: edge aggregation, comm type mapping, and stats computation.
 */

// ── Edge aggregation logic (mirrors commsRoutes internals) ────────

const ACTION_TO_COMM_TYPE: Record<string, string> = {
  message_sent: 'message',
  delegated: 'delegation',
  group_message: 'group_message',
};

interface MockEvent {
  agentId: string;
  actionType: string;
  details: Record<string, string>;
  timestamp: string;
  summary: string;
}

function buildEdges(events: MockEvent[]) {
  const edgeMap = new Map<string, { from: string; to: string | null; type: string; count: number; lastTimestamp: string }>();

  for (const event of events) {
    const commType = ACTION_TO_COMM_TYPE[event.actionType];
    if (!commType) continue;

    const from = event.agentId;
    const to = event.details.toAgentId === 'all' ? null : (event.details.toAgentId ?? null);
    const edgeKey = `${from}→${to ?? 'all'}→${commType}`;

    const existing = edgeMap.get(edgeKey);
    if (existing) {
      existing.count++;
      if (event.timestamp > existing.lastTimestamp) existing.lastTimestamp = event.timestamp;
    } else {
      edgeMap.set(edgeKey, { from, to, type: commType, count: 1, lastTimestamp: event.timestamp });
    }
  }
  return [...edgeMap.values()];
}

function buildStats(events: MockEvent[]) {
  const byType: Record<string, number> = {};
  const sentCount = new Map<string, number>();
  const receivedCount = new Map<string, number>();

  for (const event of events) {
    const commType = ACTION_TO_COMM_TYPE[event.actionType] ?? event.actionType;
    byType[commType] = (byType[commType] ?? 0) + 1;
    sentCount.set(event.agentId, (sentCount.get(event.agentId) ?? 0) + 1);
    const to = event.details.toAgentId;
    if (to && to !== 'all') {
      receivedCount.set(to, (receivedCount.get(to) ?? 0) + 1);
    }
  }

  let mostActive = { agentId: '', sent: 0, received: 0 };
  for (const id of new Set([...sentCount.keys(), ...receivedCount.keys()])) {
    const sent = sentCount.get(id) ?? 0;
    const received = receivedCount.get(id) ?? 0;
    if (sent + received > mostActive.sent + mostActive.received) {
      mostActive = { agentId: id, sent, received };
    }
  }

  return { totalMessages: events.length, byType, mostActive: mostActive.agentId ? mostActive : null };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('Comms Flow — Edge Aggregation', () => {
  it('aggregates direct messages into edges with counts', () => {
    const events: MockEvent[] = [
      { agentId: 'a1', actionType: 'message_sent', details: { toAgentId: 'a2', toRole: 'dev' }, timestamp: '2026-03-05T10:00:00Z', summary: 'msg1' },
      { agentId: 'a1', actionType: 'message_sent', details: { toAgentId: 'a2', toRole: 'dev' }, timestamp: '2026-03-05T10:01:00Z', summary: 'msg2' },
      { agentId: 'a2', actionType: 'message_sent', details: { toAgentId: 'a1', toRole: 'lead' }, timestamp: '2026-03-05T10:02:00Z', summary: 'reply' },
    ];

    const edges = buildEdges(events);
    expect(edges).toHaveLength(2);

    const a1ToA2 = edges.find(e => e.from === 'a1' && e.to === 'a2');
    expect(a1ToA2!.count).toBe(2);
    expect(a1ToA2!.lastTimestamp).toBe('2026-03-05T10:01:00Z');
    expect(a1ToA2!.type).toBe('message');

    const a2ToA1 = edges.find(e => e.from === 'a2' && e.to === 'a1');
    expect(a2ToA1!.count).toBe(1);
  });

  it('handles broadcasts as edges with null to', () => {
    const events: MockEvent[] = [
      { agentId: 'a1', actionType: 'message_sent', details: { toAgentId: 'all', toRole: 'broadcast' }, timestamp: '2026-03-05T10:00:00Z', summary: 'broadcast msg' },
    ];

    const edges = buildEdges(events);
    expect(edges).toHaveLength(1);
    expect(edges[0].to).toBeNull();
    expect(edges[0].type).toBe('message');
  });

  it('separates delegation edges from message edges', () => {
    const events: MockEvent[] = [
      { agentId: 'a1', actionType: 'message_sent', details: { toAgentId: 'a2' }, timestamp: '2026-03-05T10:00:00Z', summary: 'msg' },
      { agentId: 'a1', actionType: 'delegated', details: { toAgentId: 'a2', childId: 'a2' }, timestamp: '2026-03-05T10:01:00Z', summary: 'delegated task' },
    ];

    const edges = buildEdges(events);
    expect(edges).toHaveLength(2);
    expect(edges.find(e => e.type === 'message')).toBeDefined();
    expect(edges.find(e => e.type === 'delegation')).toBeDefined();
  });

  it('returns empty edges for empty events', () => {
    expect(buildEdges([])).toEqual([]);
  });
});

describe('Comms Flow — Stats', () => {
  it('computes total messages and breakdown by type', () => {
    const events: MockEvent[] = [
      { agentId: 'a1', actionType: 'message_sent', details: { toAgentId: 'a2' }, timestamp: '2026-03-05T10:00:00Z', summary: '' },
      { agentId: 'a1', actionType: 'message_sent', details: { toAgentId: 'a3' }, timestamp: '2026-03-05T10:00:00Z', summary: '' },
      { agentId: 'a2', actionType: 'delegated', details: { toAgentId: 'a3' }, timestamp: '2026-03-05T10:00:00Z', summary: '' },
    ];

    const stats = buildStats(events);
    expect(stats.totalMessages).toBe(3);
    expect(stats.byType.message).toBe(2);
    expect(stats.byType.delegation).toBe(1);
  });

  it('identifies most active agent by total sent + received', () => {
    const events: MockEvent[] = [
      { agentId: 'a1', actionType: 'message_sent', details: { toAgentId: 'a2' }, timestamp: '2026-03-05T10:00:00Z', summary: '' },
      { agentId: 'a2', actionType: 'message_sent', details: { toAgentId: 'a1' }, timestamp: '2026-03-05T10:00:00Z', summary: '' },
      { agentId: 'a2', actionType: 'message_sent', details: { toAgentId: 'a1' }, timestamp: '2026-03-05T10:00:00Z', summary: '' },
      { agentId: 'a3', actionType: 'message_sent', details: { toAgentId: 'a2' }, timestamp: '2026-03-05T10:00:00Z', summary: '' },
    ];

    const stats = buildStats(events);
    // a1: sent=1, received=2 = 3 total
    // a2: sent=2, received=2 = 4 total
    // a3: sent=1, received=0 = 1 total
    expect(stats.mostActive!.agentId).toBe('a2');
    expect(stats.mostActive!.sent).toBe(2);
    expect(stats.mostActive!.received).toBe(2);
  });

  it('returns null mostActive when no events', () => {
    const stats = buildStats([]);
    expect(stats.totalMessages).toBe(0);
    expect(stats.mostActive).toBeNull();
  });
});
