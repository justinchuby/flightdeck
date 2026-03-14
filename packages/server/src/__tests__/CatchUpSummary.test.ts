import { describe, it, expect, vi } from 'vitest';
import { CatchUpService } from '../coordination/sessions/CatchUpSummary.js';
import type { ActivityEntry, ActionType } from '../coordination/activity/ActivityLedger.js';

function makeEntry(overrides: Partial<ActivityEntry> & { actionType: ActionType }): ActivityEntry {
  return {
    id: Math.floor(Math.random() * 100000),
    agentId: 'agent-1',
    agentRole: 'Developer',
    timestamp: new Date().toISOString(),
    summary: 'test event',
    details: {},
    projectId: 'lead-1',
    ...overrides,
  };
}

function createMockLedger(entries: ActivityEntry[] = []) {
  return {
    getSince: vi.fn(() => entries),
    getUntil: vi.fn(() => entries),
    flush: vi.fn(),
  };
}

function createMockDecisionLog(pendingCount = 0) {
  const pending = Array.from({ length: pendingCount }, (_, i) => ({
    id: `d-${i}`,
    agentId: 'a1',
    agentRole: 'Dev',
    leadId: 'lead-1',
    projectId: null,
    title: `Decision ${i}`,
    rationale: '',
    needsConfirmation: true,
    status: 'pending' as const,
    autoApproved: false,
    confirmedAt: null,
    timestamp: new Date().toISOString(),
    category: 'General' as const,
  }));
  return {
    getNeedingConfirmation: vi.fn(() => pending),
  };
}

describe('CatchUpService', () => {
  it('returns empty summary with no activity', () => {
    const ledger = createMockLedger([]);
    const decisionLog = createMockDecisionLog(0);
    const service = new CatchUpService(ledger as any, null, decisionLog as any);

    const summary = service.getSummary('lead-1', '2025-01-01T00:00:00Z');
    expect(summary.tasksCompleted).toBe(0);
    expect(summary.agentsSpawned).toBe(0);
    expect(summary.errorsOccurred).toBe(0);
    expect(summary.keyEvents).toHaveLength(0);
    expect(summary.since).toBe('2025-01-01T00:00:00Z');
  });

  it('counts tasks completed', () => {
    const entries = [
      makeEntry({ actionType: 'task_completed', summary: 'Task A done' }),
      makeEntry({ actionType: 'task_completed', summary: 'Task B done' }),
    ];
    const service = new CatchUpService(createMockLedger(entries) as any, null, createMockDecisionLog() as any);
    const summary = service.getSummary('lead-1', '2025-01-01T00:00:00Z');
    expect(summary.tasksCompleted).toBe(2);
  });

  it('counts agents spawned and stopped', () => {
    const entries = [
      makeEntry({ actionType: 'sub_agent_spawned', summary: 'Spawned dev' }),
      makeEntry({ actionType: 'sub_agent_spawned', summary: 'Spawned reviewer' }),
      makeEntry({ actionType: 'agent_terminated', summary: 'Dev terminated' }),
    ];
    const service = new CatchUpService(createMockLedger(entries) as any, null, createMockDecisionLog() as any);
    const summary = service.getSummary('lead-1', '2025-01-01T00:00:00Z');
    expect(summary.agentsSpawned).toBe(2);
    expect(summary.agentsStopped).toBe(1);
  });

  it('counts errors', () => {
    const entries = [
      makeEntry({ actionType: 'error', summary: 'Build failed' }),
    ];
    const service = new CatchUpService(createMockLedger(entries) as any, null, createMockDecisionLog() as any);
    const summary = service.getSummary('lead-1', '2025-01-01T00:00:00Z');
    expect(summary.errorsOccurred).toBe(1);
  });

  it('includes pending decisions count from DecisionLog', () => {
    const service = new CatchUpService(createMockLedger() as any, null, createMockDecisionLog(3) as any);
    const summary = service.getSummary('lead-1', '2025-01-01T00:00:00Z');
    expect(summary.decisionsPending).toBe(3);
  });

  it('extracts key events and caps at 50', () => {
    const entries = Array.from({ length: 60 }, (_, i) =>
      makeEntry({ actionType: 'sub_agent_spawned', summary: `Agent ${i}` }),
    );
    const service = new CatchUpService(createMockLedger(entries) as any, null, createMockDecisionLog() as any);
    const summary = service.getSummary('lead-1', '2025-01-01T00:00:00Z');
    expect(summary.keyEvents).toHaveLength(50);
  });

  it('key events include agent metadata', () => {
    const entries = [
      makeEntry({ actionType: 'error', agentId: 'agent-x', agentRole: 'Architect', summary: 'Crash' }),
    ];
    const service = new CatchUpService(createMockLedger(entries) as any, null, createMockDecisionLog() as any);
    const summary = service.getSummary('lead-1', '2025-01-01T00:00:00Z');
    expect(summary.keyEvents[0].agentId).toBe('agent-x');
    expect(summary.keyEvents[0].agentRole).toBe('Architect');
  });

  it('counts decisions resolved from decision_made events', () => {
    const entries = [
      makeEntry({ actionType: 'decision_made', summary: 'Approved design' }),
      makeEntry({ actionType: 'decision_made', summary: 'Approved refactor' }),
    ];
    const service = new CatchUpService(createMockLedger(entries) as any, null, createMockDecisionLog() as any);
    const summary = service.getSummary('lead-1', '2025-01-01T00:00:00Z');
    expect(summary.decisionsResolved).toBe(2);
  });
});
