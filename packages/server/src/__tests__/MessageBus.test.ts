import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageBus } from '../comms/MessageBus.js';

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('send creates a message with auto-generated id and timestamp', () => {
    const result = bus.send({ from: 'a', to: 'b', type: 'request', content: 'hi' });
    expect(result.id).toMatch(/^msg-/);
    expect(result.timestamp).toBeTruthy();
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });

  it('send emits "message" event with the full message', () => {
    const listener = vi.fn();
    bus.on('message', listener);
    const result = bus.send({ from: 'a', to: 'b', type: 'request', content: 'hi' });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(result);
  });

  it('getHistory() returns all messages', () => {
    bus.send({ from: 'a', to: 'b', type: 'request', content: '1' });
    bus.send({ from: 'b', to: 'a', type: 'response', content: '2' });
    bus.send({ from: 'c', to: 'd', type: 'broadcast', content: '3' });
    expect(bus.getHistory()).toHaveLength(3);
  });

  it('getHistory(agentId) returns messages where from/to matches or to is "*"', () => {
    bus.send({ from: 'a', to: 'b', type: 'request', content: '1' });
    bus.send({ from: 'b', to: 'a', type: 'response', content: '2' });
    bus.send({ from: 'c', to: 'd', type: 'request', content: '3' });

    const historyA = bus.getHistory('a');
    expect(historyA).toHaveLength(2); // from:'a' + to:'a'

    const historyD = bus.getHistory('d');
    expect(historyD).toHaveLength(1); // to:'d'
  });

  it('broadcast messages (to: "*") appear in all agent history queries', () => {
    bus.send({ from: 'a', to: '*', type: 'broadcast', content: 'hello all' });
    bus.send({ from: 'b', to: 'c', type: 'request', content: 'private' });

    expect(bus.getHistory('a')).toHaveLength(1); // from:'a'
    expect(bus.getHistory('b')).toHaveLength(2); // from:'b' + to:'*'
    expect(bus.getHistory('c')).toHaveLength(2); // to:'c' + to:'*'
    expect(bus.getHistory('x')).toHaveLength(1); // only to:'*'
  });

  it('history is bounded — trims to 5000 when exceeding 10000', () => {
    for (let i = 0; i < 10001; i++) {
      bus.send({ from: 'a', to: 'b', type: 'request', content: `msg-${i}` });
    }
    const history = bus.getHistory();
    expect(history.length).toBe(5000);
    // Last message should be the most recent one
    expect(history[history.length - 1].content).toBe('msg-10000');
  });

  it('message types are preserved correctly', () => {
    const types = ['request', 'response', 'broadcast', 'spawn_request'] as const;
    for (const type of types) {
      const result = bus.send({ from: 'a', to: 'b', type, content: type });
      expect(result.type).toBe(type);
    }
    const history = bus.getHistory();
    expect(history.map((m) => m.type)).toEqual([
      'request',
      'response',
      'broadcast',
      'spawn_request',
    ]);
  });
});
