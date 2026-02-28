import { describe, it, expect, vi } from 'vitest';
import { EventPipeline, taskCompletedHandler, commitQualityGateHandler, delegationTracker, type PipelineEvent } from '../coordination/EventPipeline.js';
import type { ActivityEntry } from '../coordination/ActivityLedger.js';

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 0,
    agentId: 'agent-0001',
    agentRole: 'developer',
    actionType: 'task_completed',
    summary: 'Task done',
    details: {},
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('EventPipeline', () => {
  it('dispatches events to matching handlers', async () => {
    const pipeline = new EventPipeline();
    const handler = vi.fn();
    pipeline.register({ eventTypes: ['task_completed'], name: 'test', handle: handler });

    pipeline.emit(makeEntry({ actionType: 'task_completed' }));
    // Allow async processing
    await new Promise(r => setTimeout(r, 10));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0].entry.actionType).toBe('task_completed');
  });

  it('does not dispatch to non-matching handlers', async () => {
    const pipeline = new EventPipeline();
    const handler = vi.fn();
    pipeline.register({ eventTypes: ['delegated'], name: 'test', handle: handler });

    pipeline.emit(makeEntry({ actionType: 'task_completed' }));
    await new Promise(r => setTimeout(r, 10));

    expect(handler).not.toHaveBeenCalled();
  });

  it('wildcard handler receives all events', async () => {
    const pipeline = new EventPipeline();
    const handler = vi.fn();
    pipeline.register({ eventTypes: '*', name: 'catch-all', handle: handler });

    pipeline.emit(makeEntry({ actionType: 'task_completed' }));
    pipeline.emit(makeEntry({ actionType: 'delegated' }));
    await new Promise(r => setTimeout(r, 10));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('catches handler errors without crashing', async () => {
    const pipeline = new EventPipeline();
    const failing = vi.fn().mockRejectedValue(new Error('boom'));
    const passing = vi.fn();
    pipeline.register({ eventTypes: '*', name: 'failing', handle: failing });
    pipeline.register({ eventTypes: '*', name: 'passing', handle: passing });

    pipeline.emit(makeEntry());
    await new Promise(r => setTimeout(r, 10));

    expect(failing).toHaveBeenCalledOnce();
    expect(passing).toHaveBeenCalledOnce();
  });

  it('getHandlers returns registered handler info', () => {
    const pipeline = new EventPipeline();
    pipeline.register({ eventTypes: ['delegated', 'task_completed'], name: 'multi', handle: vi.fn() });
    pipeline.register({ eventTypes: '*', name: 'all', handle: vi.fn() });

    const handlers = pipeline.getHandlers();
    expect(handlers).toHaveLength(2);
    expect(handlers[0]).toEqual({ name: 'multi', eventTypes: 'delegated, task_completed' });
    expect(handlers[1]).toEqual({ name: 'all', eventTypes: '*' });
  });

  it('built-in taskCompletedHandler logs without error', async () => {
    const pipeline = new EventPipeline();
    pipeline.register(taskCompletedHandler);
    pipeline.emit(makeEntry({ actionType: 'task_completed', summary: 'Built the feature' }));
    await new Promise(r => setTimeout(r, 10));
    // No throw = pass
  });

  it('built-in delegationTracker logs without error', async () => {
    const pipeline = new EventPipeline();
    pipeline.register(delegationTracker);
    pipeline.emit(makeEntry({
      actionType: 'delegated',
      details: { toRole: 'architect', toAgentId: 'agent-0002' },
    }));
    await new Promise(r => setTimeout(r, 10));
  });

  it('processes events in order', async () => {
    const pipeline = new EventPipeline();
    const order: string[] = [];
    pipeline.register({
      eventTypes: '*',
      name: 'order-tracker',
      handle: (e: PipelineEvent) => { order.push(e.entry.actionType); },
    });

    pipeline.emit(makeEntry({ actionType: 'delegated' }));
    pipeline.emit(makeEntry({ actionType: 'task_completed' }));
    pipeline.emit(makeEntry({ actionType: 'file_edit' }));
    await new Promise(r => setTimeout(r, 20));

    expect(order).toEqual(['delegated', 'task_completed', 'file_edit']);
  });
});
