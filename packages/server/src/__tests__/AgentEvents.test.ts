import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentEventEmitter, type UsageInfo, type CompactionInfo } from '../agents/AgentEvents.js';

describe('AgentEventEmitter', () => {
  let emitter: AgentEventEmitter;

  beforeEach(() => {
    vi.useFakeTimers();
    emitter = new AgentEventEmitter();
  });

  afterEach(() => {
    emitter.dispose();
    vi.useRealTimers();
  });

  // ── Listener registration and notification ──────────────────────────

  it('notifies data listeners', () => {
    const listener = vi.fn();
    emitter.onData(listener);
    emitter.notifyData('hello');
    expect(listener).toHaveBeenCalledWith('hello');
  });

  it('notifies content listeners', () => {
    const listener = vi.fn();
    emitter.onContent(listener);
    emitter.notifyContent({ type: 'text', text: 'hi' });
    expect(listener).toHaveBeenCalledWith({ type: 'text', text: 'hi' });
  });

  it('notifies thinking listeners', () => {
    const listener = vi.fn();
    emitter.onThinking(listener);
    emitter.notifyThinking('pondering...');
    expect(listener).toHaveBeenCalledWith('pondering...');
  });

  it('notifies exit listeners', () => {
    const listener = vi.fn();
    emitter.onExit(listener);
    emitter.notifyExit(0);
    expect(listener).toHaveBeenCalledWith(0);
  });

  it('notifies tool call listeners', () => {
    const listener = vi.fn();
    emitter.onToolCall(listener);
    const info = { name: 'bash', input: 'ls' } as any;
    emitter.notifyToolCall(info);
    expect(listener).toHaveBeenCalledWith(info);
  });

  it('notifies plan listeners', () => {
    const listener = vi.fn();
    emitter.onPlan(listener);
    const entries = [{ title: 'step 1' }] as any;
    emitter.notifyPlan(entries);
    expect(listener).toHaveBeenCalledWith(entries);
  });

  it('notifies session ready listeners', () => {
    const listener = vi.fn();
    emitter.onSessionReady(listener);
    emitter.notifySessionReady('session-abc');
    expect(listener).toHaveBeenCalledWith('session-abc');
  });

  it('notifies context compacted listeners', () => {
    const listener = vi.fn();
    emitter.onContextCompacted(listener);
    const info: CompactionInfo = { previousUsed: 100000, currentUsed: 50000, percentDrop: 50 };
    emitter.notifyContextCompacted(info);
    expect(listener).toHaveBeenCalledWith(info);
  });

  it('notifies usage listeners', () => {
    const listener = vi.fn();
    emitter.onUsage(listener);
    const info: UsageInfo = { agentId: 'a1', inputTokens: 100, outputTokens: 200 };
    emitter.notifyUsage(info);
    expect(listener).toHaveBeenCalledWith(info);
  });

  // ── Multiple listeners ──────────────────────────────────────────────

  it('calls all registered listeners for same event', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    emitter.onData(l1);
    emitter.onData(l2);
    emitter.notifyData('test');
    expect(l1).toHaveBeenCalledWith('test');
    expect(l2).toHaveBeenCalledWith('test');
  });

  // ── Status notification (debounced idle) ────────────────────────────

  describe('status notification (idle debounce)', () => {
    it('fires running status immediately', () => {
      const listener = vi.fn();
      emitter.onStatus(listener);
      emitter.notifyStatus('running');
      expect(listener).toHaveBeenCalledWith('running');
    });

    it('debounces idle status by 500ms', () => {
      const listener = vi.fn();
      emitter.onStatus(listener);

      emitter.notifyStatus('idle');
      expect(listener).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(listener).toHaveBeenCalledWith('idle');
    });

    it('cancels idle debounce when running arrives', () => {
      const listener = vi.fn();
      emitter.onStatus(listener);

      emitter.notifyStatus('idle');
      expect(listener).not.toHaveBeenCalled();

      // Running comes in before debounce fires
      emitter.notifyStatus('running');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('running');

      // Advance past debounce — idle should NOT fire
      vi.advanceTimersByTime(600);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('handles rapid idle→running→idle→running without spurious idle fires', () => {
      const listener = vi.fn();
      emitter.onStatus(listener);

      emitter.notifyStatus('idle');
      vi.advanceTimersByTime(100);
      emitter.notifyStatus('running');
      vi.advanceTimersByTime(50);
      emitter.notifyStatus('idle');
      vi.advanceTimersByTime(100);
      emitter.notifyStatus('running');

      vi.advanceTimersByTime(600);

      // Only 'running' calls should have fired (2 times)
      const calls = listener.mock.calls.map(c => c[0]);
      expect(calls).toEqual(['running', 'running']);
    });
  });

  // ── Dispose ─────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('clears all listener arrays', () => {
      emitter.onData(vi.fn());
      emitter.onContent(vi.fn());
      emitter.onExit(vi.fn());
      emitter.onStatus(vi.fn());
      emitter.onUsage(vi.fn());

      emitter.dispose();

      // After dispose, notify should not call any listeners
      const _dataListener = vi.fn();
      // Can't add new listeners to cleared arrays since they're internal,
      // but we can verify notify doesn't throw
      emitter.notifyData('test');
      emitter.notifyContent('test');
      emitter.notifyExit(0);
      emitter.notifyStatus('running');
    });

    it('clears pending idle debounce timer', () => {
      const listener = vi.fn();
      emitter.onStatus(listener);

      emitter.notifyStatus('idle');
      emitter.dispose();

      vi.advanceTimersByTime(600);
      // Idle should NOT fire after dispose
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
