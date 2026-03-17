import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { undoStack } from '../UndoStack';

describe('UndoStack', () => {
  beforeEach(() => { undoStack.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('subscribe/notify', () => {
    it('notifies listener on push', () => {
      const listener = vi.fn();
      undoStack.subscribe(listener);
      undoStack.push('cmd-1', 'Action 1');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('notifies listener on pop', () => {
      undoStack.push('cmd-1', 'Action 1');
      const listener = vi.fn();
      undoStack.subscribe(listener);
      undoStack.pop();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('notifies listener on clear', () => {
      undoStack.push('cmd-1', 'Action 1');
      const listener = vi.fn();
      undoStack.subscribe(listener);
      undoStack.clear();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('unsubscribe removes listener', () => {
      const listener = vi.fn();
      const unsub = undoStack.subscribe(listener);
      unsub();
      undoStack.push('cmd-1', 'Action 1');
      expect(listener).not.toHaveBeenCalled();
    });

    it('multiple listeners are all notified', () => {
      const l1 = vi.fn(), l2 = vi.fn();
      undoStack.subscribe(l1);
      undoStack.subscribe(l2);
      undoStack.push('cmd-1', 'Action 1');
      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
    });

    it('does not notify after unsubscribe', () => {
      const listener = vi.fn();
      const unsub = undoStack.subscribe(listener);
      undoStack.push('cmd-1', 'Action 1');
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
      undoStack.push('cmd-2', 'Action 2');
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('TTL expiration', () => {
    it('prunes entries older than 5 minutes', () => {
      undoStack.push('cmd-1', 'Old action');
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      expect(undoStack.length).toBe(0);
    });

    it('keeps entries within 5 minutes', () => {
      undoStack.push('cmd-1', 'Recent');
      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(undoStack.length).toBe(1);
    });
  });

  describe('stack operations', () => {
    it('push and peek', () => {
      undoStack.push('cmd-1', 'First');
      undoStack.push('cmd-2', 'Second');
      expect(undoStack.peek()).toEqual(expect.objectContaining({ commandId: 'cmd-2' }));
    });

    it('pop removes last entry', () => {
      undoStack.push('cmd-1', 'First');
      undoStack.push('cmd-2', 'Second');
      const popped = undoStack.pop();
      expect(popped?.commandId).toBe('cmd-2');
      expect(undoStack.length).toBe(1);
    });

    it('pop returns null on empty', () => { expect(undoStack.pop()).toBeNull(); });
    it('peek returns null on empty', () => { expect(undoStack.peek()).toBeNull(); });

    it('clear empties the stack', () => {
      undoStack.push('cmd-1', 'First');
      undoStack.clear();
      expect(undoStack.length).toBe(0);
    });

    it('length reflects stack size', () => {
      expect(undoStack.length).toBe(0);
      undoStack.push('cmd-1', 'First');
      expect(undoStack.length).toBe(1);
      undoStack.push('cmd-2', 'Second');
      expect(undoStack.length).toBe(2);
      undoStack.pop();
      expect(undoStack.length).toBe(1);
    });
  });
});
