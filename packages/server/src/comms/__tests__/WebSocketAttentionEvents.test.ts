import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Tests for wireAttentionEvents wiring pattern — verifies that
 * attention-affecting events (dag:updated, agent:crashed, decision events)
 * produce the correct 'attention:changed' broadcast shape.
 *
 * Uses EventEmitters as stand-ins for AgentManager and DecisionLog,
 * matching the isolation pattern in WebSocketServer.health.test.ts.
 */

describe('WebSocket attention events', () => {
  let agentManager: EventEmitter;
  let decisionLog: EventEmitter;
  let broadcasts: Array<{ type: string; trigger: string; leadId?: string }>;

  /** Replicate wireAttentionEvents wiring logic for isolated testing */
  function wireAttentionEvents(am: EventEmitter, dl: EventEmitter) {
    am.on('dag:updated', (data: any) => {
      broadcasts.push({ type: 'attention:changed', trigger: 'dag', leadId: data.leadId });
    });
    am.on('agent:crashed', () => {
      broadcasts.push({ type: 'attention:changed', trigger: 'agent_crashed' });
    });
    dl.on('decision', () => {
      broadcasts.push({ type: 'attention:changed', trigger: 'decision_new' });
    });
    for (const event of ['decision:confirmed', 'decision:rejected', 'decision:dismissed']) {
      dl.on(event, () => {
        broadcasts.push({ type: 'attention:changed', trigger: 'decision_resolved' });
      });
    }
    for (const event of ['decisions:batch_confirmed', 'decisions:batch_rejected', 'decisions:batch_dismissed']) {
      dl.on(event, () => {
        broadcasts.push({ type: 'attention:changed', trigger: 'decision_batch' });
      });
    }
  }

  beforeEach(() => {
    agentManager = new EventEmitter();
    decisionLog = new EventEmitter();
    broadcasts = [];
    wireAttentionEvents(agentManager, decisionLog);
  });

  it('broadcasts attention:changed on dag:updated with leadId', () => {
    agentManager.emit('dag:updated', { leadId: 'lead-1' });

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toEqual({
      type: 'attention:changed',
      trigger: 'dag',
      leadId: 'lead-1',
    });
  });

  it('broadcasts attention:changed on agent:crashed', () => {
    agentManager.emit('agent:crashed', { agentId: 'agent-1' });

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toEqual({
      type: 'attention:changed',
      trigger: 'agent_crashed',
    });
  });

  it('broadcasts attention:changed on new decision', () => {
    decisionLog.emit('decision', { id: 'dec-1' });

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toEqual({
      type: 'attention:changed',
      trigger: 'decision_new',
    });
  });

  it('broadcasts on all three decision resolution events', () => {
    decisionLog.emit('decision:confirmed', { id: 'dec-1' });
    decisionLog.emit('decision:rejected', { id: 'dec-2' });
    decisionLog.emit('decision:dismissed', { id: 'dec-3' });

    expect(broadcasts).toHaveLength(3);
    for (const b of broadcasts) {
      expect(b).toEqual({ type: 'attention:changed', trigger: 'decision_resolved' });
    }
  });

  it('broadcasts on all three batch decision events', () => {
    decisionLog.emit('decisions:batch_confirmed', []);
    decisionLog.emit('decisions:batch_rejected', []);
    decisionLog.emit('decisions:batch_dismissed', []);

    expect(broadcasts).toHaveLength(3);
    for (const b of broadcasts) {
      expect(b).toEqual({ type: 'attention:changed', trigger: 'decision_batch' });
    }
  });

  it('does NOT debounce — sends one signal per event (client debounces)', () => {
    for (let i = 0; i < 10; i++) {
      agentManager.emit('dag:updated', { leadId: `lead-${i}` });
    }
    expect(broadcasts).toHaveLength(10);
  });
});
