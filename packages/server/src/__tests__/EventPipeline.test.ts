import { describe, it, expect, vi } from 'vitest';
import { EventPipeline, taskCompletedHandler, delegationTracker, type PipelineEvent } from '../coordination/events/EventPipeline.js';
import type { ActivityEntry } from '../coordination/activity/ActivityLedger.js';

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 0,
    agentId: 'agent-0001',
    agentRole: 'developer',
    actionType: 'task_completed',
    summary: 'Task done',
    details: {},
    timestamp: new Date().toISOString(),
    projectId: '',
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

  it('invokes onEventDropped callback and increments dropCount on queue overflow', async () => {
    const droppedEvents: PipelineEvent[] = [];
    const pipeline = new EventPipeline({
      onEventDropped: (ev) => droppedEvents.push(ev),
    });
    // Slow handler to keep queue from draining
    pipeline.register({
      eventTypes: '*',
      name: 'slow',
      handle: async () => { await new Promise(r => setTimeout(r, 5000)); },
    });

    // Emit enough to fill the queue — the first event starts processing so the queue
    // holds MAX_QUEUE_SIZE-1 before overflowing. We fill the queue and push one more.
    // For a smaller test, we just verify the mechanism with a tight loop.
    // Emit the first event (it enters processing immediately)
    pipeline.emit(makeEntry({ actionType: 'task_started', agentId: 'first', timestamp: '2000-01-01T00:00:00Z' }));
    await new Promise(r => setTimeout(r, 5)); // let it start processing

    // Now the handler is blocking on the slow promise. Queue is empty.
    // Fill the queue to MAX_QUEUE_SIZE
    for (let i = 0; i < 10_000; i++) {
      pipeline.emit(makeEntry({ actionType: 'file_edit', agentId: `fill-${i}`, timestamp: `2001-01-01T00:00:${String(i).padStart(5, '0')}Z` }));
    }

    // Next emit should cause a drop
    pipeline.emit(makeEntry({ actionType: 'error', agentId: 'overflow', timestamp: '2099-01-01T00:00:00Z' }));

    expect(pipeline.dropCount).toBeGreaterThanOrEqual(1);
    expect(droppedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('deduplicates events with same agentId+actionType+timestamp', async () => {
    const pipeline = new EventPipeline();
    const received: PipelineEvent[] = [];
    pipeline.register({
      eventTypes: '*',
      name: 'collector',
      handle: (e) => { received.push(e); },
    });

    const entry = makeEntry({ id: 1, actionType: 'task_completed', agentId: 'agent-dup', timestamp: '2025-01-01T00:00:00Z' });
    pipeline.emit(entry);
    pipeline.emit(entry); // duplicate
    pipeline.emit(entry); // duplicate
    await new Promise(r => setTimeout(r, 20));

    expect(received).toHaveLength(1);
  });

  it('allows synthetic id:0 events through (not deduped against each other by id)', async () => {
    const pipeline = new EventPipeline();
    const received: PipelineEvent[] = [];
    pipeline.register({
      eventTypes: '*',
      name: 'collector',
      handle: (e) => { received.push(e); },
    });

    // Two different id:0 events with different timestamps should both pass
    pipeline.emit(makeEntry({ id: 0, actionType: 'file_edit', timestamp: '2025-01-01T00:00:01Z' }));
    pipeline.emit(makeEntry({ id: 0, actionType: 'file_read', timestamp: '2025-01-01T00:00:02Z' }));
    await new Promise(r => setTimeout(r, 20));

    expect(received).toHaveLength(2);
  });

  it('caps seenEventIds set to prevent unbounded memory growth', async () => {
    const pipeline = new EventPipeline();
    pipeline.register({
      eventTypes: '*',
      name: 'noop',
      handle: () => {},
    });

    // Emit 2×MAX_QUEUE_SIZE + 1 unique events to trigger the cap
    for (let i = 0; i <= 20_000; i++) {
      pipeline.emit(makeEntry({ id: i + 1, actionType: 'file_edit', agentId: `cap-${i}`, timestamp: `2025-01-01T00:00:00.${String(i).padStart(5, '0')}Z` }));
    }
    await new Promise(r => setTimeout(r, 50));

    // After cap: set should have been pruned to ~MAX_QUEUE_SIZE + new entries
    // The key point: it should NOT be 20_001 (unbounded)
    // Access via any: seenEventIds is private
    const seenSize = (pipeline as any).seenEventIds.size;
    expect(seenSize).toBeLessThanOrEqual(10_001); // MAX_QUEUE_SIZE + 1
  });
});
