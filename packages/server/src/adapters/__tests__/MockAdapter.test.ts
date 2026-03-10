import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockAdapter } from '../MockAdapter.js';
import type { ToolCallInfo, PlanEntry } from '../types.js';

describe('MockAdapter', () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it('has type "mock"', () => {
    expect(adapter.type).toBe('mock');
  });

  it('starts and becomes connected', async () => {
    const sessionId = await adapter.start({ cliCommand: 'test', cwd: '/tmp' });
    expect(adapter.isConnected).toBe(true);
    expect(adapter.currentSessionId).toBe(sessionId);
    expect(sessionId).toMatch(/^mock-session-/);
  });

  it('emits connected event on start', async () => {
    const handler = vi.fn();
    adapter.on('connected', handler);
    await adapter.start({ cliCommand: 'test' });
    expect(handler).toHaveBeenCalledWith(expect.stringMatching(/^mock-session-/));
  });

  it('prompts with default empty response', async () => {
    await adapter.start({ cliCommand: 'test' });
    const result = await adapter.prompt('hello');
    expect(result.stopReason).toBe('end_turn');
    expect(adapter.promptHistory).toEqual(['hello']);
  });

  it('returns queued responses in order', async () => {
    await adapter.start({ cliCommand: 'test' });
    adapter.queueResponse({ text: 'first', stopReason: 'end_turn' });
    adapter.queueResponse({ text: 'second', stopReason: 'tool_use' });

    const r1 = await adapter.prompt('q1');
    expect(r1.stopReason).toBe('end_turn');

    const r2 = await adapter.prompt('q2');
    expect(r2.stopReason).toBe('tool_use');

    expect(adapter.promptHistory).toEqual(['q1', 'q2']);
  });

  it('emits text from queued response', async () => {
    await adapter.start({ cliCommand: 'test' });
    adapter.queueResponse({ text: 'hello world' });

    const texts: string[] = [];
    adapter.on('text', (t) => texts.push(t));

    await adapter.prompt('test');
    expect(texts).toEqual(['hello world']);
  });

  it('emits prompting lifecycle events', async () => {
    await adapter.start({ cliCommand: 'test' });
    const events: Array<{ event: string; value?: unknown }> = [];

    adapter.on('prompting', (v) => events.push({ event: 'prompting', value: v }));
    adapter.on('response_start', () => events.push({ event: 'response_start' }));
    adapter.on('prompt_complete', (r) => events.push({ event: 'prompt_complete', value: r }));
    adapter.on('idle', () => events.push({ event: 'idle' }));

    await adapter.prompt('test');

    expect(events).toEqual([
      { event: 'prompting', value: true },
      { event: 'response_start' },
      { event: 'prompting', value: false },
      { event: 'prompt_complete', value: 'end_turn' },
      { event: 'idle' },
    ]);
  });

  it('emits usage when response includes it', async () => {
    await adapter.start({ cliCommand: 'test' });
    adapter.queueResponse({ usage: { inputTokens: 100, outputTokens: 50 } });

    const handler = vi.fn();
    adapter.on('usage', handler);

    await adapter.prompt('test');
    expect(handler).toHaveBeenCalledWith({ inputTokens: 100, outputTokens: 50 });
  });

  it('throws when prompting without start', async () => {
    await expect(adapter.prompt('test')).rejects.toThrow('not connected');
  });

  it('cancel stops prompting state', async () => {
    await adapter.start({ cliCommand: 'test' });
    await adapter.cancel();
    expect(adapter.isPrompting).toBe(false);
  });

  it('terminate disconnects and emits exit', async () => {
    await adapter.start({ cliCommand: 'test' });
    const handler = vi.fn();
    adapter.on('exit', handler);

    adapter.terminate();
    expect(adapter.isConnected).toBe(false);
    expect(handler).toHaveBeenCalledWith(0);
  });

  it('simulateText emits text event', () => {
    const handler = vi.fn();
    adapter.on('text', handler);
    adapter.simulateText('hello');
    expect(handler).toHaveBeenCalledWith('hello');
  });

  it('simulateToolCall emits tool_call event', () => {
    const handler = vi.fn();
    adapter.on('tool_call', handler);
    const info: ToolCallInfo = {
      toolCallId: 'tc-1',
      title: 'bash',
      kind: 'bash',
      status: 'running',
    };
    adapter.simulateToolCall(info);
    expect(handler).toHaveBeenCalledWith(info);
  });

  it('simulatePlan emits plan event', () => {
    const handler = vi.fn();
    adapter.on('plan', handler);
    const entries: PlanEntry[] = [
      { content: 'Step 1', priority: 'high', status: 'pending' },
    ];
    adapter.simulatePlan(entries);
    expect(handler).toHaveBeenCalledWith(entries);
  });

  it('simulateExit disconnects and emits exit', () => {
    const handler = vi.fn();
    adapter.on('exit', handler);
    adapter.simulateExit(1);
    expect(adapter.isConnected).toBe(false);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it('reset clears all state', async () => {
    await adapter.start({ cliCommand: 'test' });
    adapter.queueResponse({ text: 'queued' });
    await adapter.prompt('test');

    adapter.reset();
    expect(adapter.isConnected).toBe(false);
    expect(adapter.currentSessionId).toBeNull();
    expect(adapter.promptHistory).toHaveLength(0);
  });

  it('supportsImages returns true', () => {
    expect(adapter.supportsImages).toBe(true);
  });

  it('queueResponses adds multiple responses', async () => {
    await adapter.start({ cliCommand: 'test' });
    adapter.queueResponses([
      { text: 'a' },
      { text: 'b' },
      { text: 'c' },
    ]);

    const texts: string[] = [];
    adapter.on('text', (t) => texts.push(t));

    await adapter.prompt('1');
    await adapter.prompt('2');
    await adapter.prompt('3');

    expect(texts).toEqual(['a', 'b', 'c']);
  });
});
