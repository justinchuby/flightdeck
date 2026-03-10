/**
 * ClaudeSdkAdapter tests.
 *
 * The Claude Agent SDK is mocked entirely — no real API calls.
 * Tests cover: lifecycle, prompting, event translation, session resume,
 * permission handling, error paths, queue drain, and factory wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeSdkAdapter } from './ClaudeSdkAdapter.js';

import type {
  SdkMessage,
  SdkAssistantMessage,
  SdkUserMessage,
  SdkSystemMessage,
  SdkResultMessage,
} from './claude-sdk-types.js';

// ── Mock SDK ─────────────────────────────────────────────────

function createMockQuery(messages: SdkMessage[]) {
  let interrupted = false;
  let closed = false;

  const query = {
    interrupt: vi.fn(() => { interrupted = true; }),
    close: vi.fn(() => { closed = true; }),
    [Symbol.asyncIterator]: async function* () {
      for (const msg of messages) {
        if (closed) break;
        yield msg;
      }
    },
    get _interrupted() { return interrupted; },
    get _closed() { return closed; },
  };
  return query;
}

const mockQuery = vi.fn();
const mockListSessions = vi.fn();

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  listSessions: (...args: unknown[]) => mockListSessions(...args),
}));

// ── Helpers ──────────────────────────────────────────────────

function makeInitMessage(sessionId: string): SdkSystemMessage {
  return { type: 'system', subtype: 'init', session_id: sessionId };
}

function makeTextMessage(text: string): SdkAssistantMessage {
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  };
}

function makeThinkingMessage(thinking: string): SdkAssistantMessage {
  return {
    type: 'assistant',
    message: { content: [{ type: 'thinking', thinking }] },
  };
}

function makeToolUseMessage(id: string, name: string, input: Record<string, unknown> = {}): SdkAssistantMessage {
  return {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name, input }] },
  };
}

function makeToolResultMessage(toolUseId: string, content: string, isError = false): SdkUserMessage {
  return {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] },
  };
}

function makeResultMessage(subtype: string, sessionId?: string, usage?: { input_tokens: number; output_tokens: number }): SdkResultMessage {
  return {
    type: 'result',
    subtype,
    ...(sessionId ? { session_id: sessionId } : {}),
    ...(usage ? { usage } : {}),
  };
}

function makeCompactMessage(): SdkSystemMessage {
  return { type: 'system', subtype: 'compact_boundary' };
}

// ── Tests ────────────────────────────────────────────────────

describe('ClaudeSdkAdapter', () => {
  let adapter: ClaudeSdkAdapter;

  beforeEach(() => {
    adapter = new ClaudeSdkAdapter({ model: 'claude-sonnet-4-6' });
    mockQuery.mockReset();
    mockListSessions.mockReset();
  });

  afterEach(() => {
    if (adapter.isConnected) {
      adapter.terminate();
    }
  });

  // ── Construction ───────────────────────────────────────────

  describe('construction', () => {
    it('sets type to claude-sdk', () => {
      expect(adapter.type).toBe('claude-sdk');
    });

    it('starts disconnected', () => {
      expect(adapter.isConnected).toBe(false);
      expect(adapter.isPrompting).toBe(false);
      expect(adapter.currentSessionId).toBeNull();
    });

    it('reports supportsImages = false (images not yet wired in prompt())', () => {
      expect(adapter.supportsImages).toBe(false);
    });

    it('uses default model when not provided', () => {
      const a = new ClaudeSdkAdapter();
      expect(a.type).toBe('claude-sdk');
    });
  });

  // ── Start / Connect ────────────────────────────────────────

  describe('start()', () => {
    it('generates a session ID and connects', async () => {
      const events: string[] = [];
      adapter.on('connected', (id: string) => events.push(`connected:${id}`));

      const sessionId = await adapter.start({ cliCommand: 'claude' });

      expect(sessionId).toBeTruthy();
      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(adapter.isConnected).toBe(true);
      expect(adapter.currentSessionId).toBe(sessionId);
      expect(events).toHaveLength(1);
      expect(events[0]).toContain('connected:');
    });

    it('resumes an existing session', async () => {
      const sessionId = await adapter.start({
        cliCommand: 'claude',
        sessionId: 'existing-session-abc',
      });

      expect(sessionId).toBe('existing-session-abc');
      expect(adapter.currentSessionId).toBe('existing-session-abc');
      expect(adapter.sdkSession).toBe('existing-session-abc');
    });

    it('accepts model, maxTurns, and systemPrompt overrides', async () => {
      const id = await adapter.start({
        cliCommand: 'claude',
        model: 'claude-opus-4',
        maxTurns: 10,
        systemPrompt: 'You are a test agent.',
      });

      expect(id).toBeTruthy();
      expect(adapter.isConnected).toBe(true);
    });

    it('sets cwd from options', async () => {
      await adapter.start({ cliCommand: 'claude', cwd: '/tmp/test' });
      expect(adapter.isConnected).toBe(true);
    });
  });

  // ── Prompt ─────────────────────────────────────────────────

  describe('prompt()', () => {
    it('sends a string prompt and returns result', async () => {
      const sdkSessionId = 'sdk-session-123';
      mockQuery.mockReturnValue(createMockQuery([
        makeInitMessage(sdkSessionId),
        makeTextMessage('Hello world'),
        makeResultMessage('success', sdkSessionId, { input_tokens: 10, output_tokens: 20 }),
      ]));

      await adapter.start({ cliCommand: 'claude' });
      const result = await adapter.prompt('test prompt');

      expect(result.stopReason).toBe('end_turn');
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
      expect(adapter.sdkSession).toBe(sdkSessionId);
    });

    it('sends ContentBlock[] prompt', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        makeResultMessage('success', 'sess-1', { input_tokens: 5, output_tokens: 15 }),
      ]));

      await adapter.start({ cliCommand: 'claude' });
      const result = await adapter.prompt([
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ]);

      expect(result.stopReason).toBe('end_turn');
      // Verify prompt text was joined
      expect(mockQuery).toHaveBeenCalledWith(
        'first\nsecond',
        expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      );
    });

    it('throws if not started', async () => {
      await expect(adapter.prompt('test')).rejects.toThrow('Claude SDK adapter not started');
    });

    it('emits prompting events', async () => {
      const events: Array<{ event: string; data: unknown }> = [];
      adapter.on('prompting', (v: boolean) => events.push({ event: 'prompting', data: v }));
      adapter.on('response_start', () => events.push({ event: 'response_start', data: null }));
      adapter.on('prompt_complete', (r: string) => events.push({ event: 'prompt_complete', data: r }));

      mockQuery.mockReturnValue(createMockQuery([
        makeResultMessage('success'),
      ]));

      await adapter.start({ cliCommand: 'claude' });
      await adapter.prompt('test');

      const eventNames = events.map(e => e.event);
      expect(eventNames).toContain('prompting');
      expect(eventNames).toContain('response_start');
      expect(eventNames).toContain('prompt_complete');
    });

    it('emits usage event with token counts', async () => {
      const usages: unknown[] = [];
      adapter.on('usage', (u: unknown) => usages.push(u));

      mockQuery.mockReturnValue(createMockQuery([
        makeResultMessage('success', 'sess', { input_tokens: 100, output_tokens: 200 }),
      ]));

      await adapter.start({ cliCommand: 'claude' });
      await adapter.prompt('test');

      expect(usages).toHaveLength(1);
      expect(usages[0]).toEqual({ inputTokens: 100, outputTokens: 200 });
    });

    it('passes resume session ID to query options', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        makeResultMessage('success', 'sdk-sess-xyz'),
      ]));

      await adapter.start({ cliCommand: 'claude', sessionId: 'sdk-sess-xyz' });
      await adapter.prompt('test');

      expect(mockQuery).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ resume: 'sdk-sess-xyz' }),
      );
    });

    it('uses acceptEdits permission mode', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        makeResultMessage('success'),
      ]));

      await adapter.start({ cliCommand: 'claude' });
      await adapter.prompt('test');

      expect(mockQuery).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ permissionMode: 'acceptEdits' }),
      );
    });
  });

  // ── Session Mapping ────────────────────────────────────────

  describe('session mapping', () => {
    it('emits session_mapped on init message', async () => {
      const mappings: Array<{ flightdeckSessionId: string; sdkSessionId: string }> = [];
      adapter.on('session_mapped', (m: { flightdeckSessionId: string; sdkSessionId: string }) => mappings.push(m));

      mockQuery.mockReturnValue(createMockQuery([
        makeInitMessage('real-sdk-session-id'),
        makeResultMessage('success', 'real-sdk-session-id'),
      ]));

      const flightdeckId = await adapter.start({ cliCommand: 'claude' });
      await adapter.prompt('test');

      expect(mappings).toHaveLength(1);
      expect(mappings[0]).toEqual({
        flightdeckSessionId: flightdeckId,
        sdkSessionId: 'real-sdk-session-id',
      });
      expect(adapter.sdkSession).toBe('real-sdk-session-id');
    });

    it('updates SDK session from result message', async () => {
      mockQuery.mockReturnValue(createMockQuery([
        makeResultMessage('success', 'updated-session-id'),
      ]));

      await adapter.start({ cliCommand: 'claude' });
      await adapter.prompt('test');

      expect(adapter.sdkSession).toBe('updated-session-id');
    });
  });

  // ── Event Translation ──────────────────────────────────────

  describe('event translation', () => {
    beforeEach(async () => {
      await adapter.start({ cliCommand: 'claude' });
    });

    it('emits text events from assistant messages', async () => {
      const texts: string[] = [];
      adapter.on('text', (t: string) => texts.push(t));

      mockQuery.mockReturnValue(createMockQuery([
        makeTextMessage('Hello'),
        makeTextMessage('World'),
        makeResultMessage('success'),
      ]));

      await adapter.prompt('test');
      expect(texts).toEqual(['Hello', 'World']);
    });

    it('emits thinking events', async () => {
      const thoughts: string[] = [];
      adapter.on('thinking', (t: string) => thoughts.push(t));

      mockQuery.mockReturnValue(createMockQuery([
        makeThinkingMessage('Let me analyze this...'),
        makeResultMessage('success'),
      ]));

      await adapter.prompt('test');
      expect(thoughts).toEqual(['Let me analyze this...']);
    });

    it('emits tool_call events from tool_use blocks', async () => {
      const calls: unknown[] = [];
      adapter.on('tool_call', (c: unknown) => calls.push(c));

      mockQuery.mockReturnValue(createMockQuery([
        makeToolUseMessage('tc-1', 'bash', { command: 'ls' }),
        makeResultMessage('success'),
      ]));

      await adapter.prompt('test');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        toolCallId: 'tc-1',
        title: 'bash',
        kind: 'bash',
        status: 'running',
        content: '{"command":"ls"}',
      });
    });

    it('emits tool_call_update events from tool_result blocks', async () => {
      const updates: unknown[] = [];
      adapter.on('tool_call_update', (u: unknown) => updates.push(u));

      mockQuery.mockReturnValue(createMockQuery([
        makeToolResultMessage('tc-1', 'file.txt\ntest.ts', false),
        makeResultMessage('success'),
      ]));

      await adapter.prompt('test');
      expect(updates).toHaveLength(1);
      expect(updates[0]).toEqual({
        toolCallId: 'tc-1',
        status: 'completed',
        content: 'file.txt\ntest.ts',
      });
    });

    it('marks errored tool results', async () => {
      const updates: unknown[] = [];
      adapter.on('tool_call_update', (u: unknown) => updates.push(u));

      mockQuery.mockReturnValue(createMockQuery([
        makeToolResultMessage('tc-2', 'command failed', true),
        makeResultMessage('success'),
      ]));

      await adapter.prompt('test');
      expect(updates[0]).toEqual(expect.objectContaining({
        toolCallId: 'tc-2',
        status: 'error',
        content: 'command failed',
      }));
    });

    it('emits text for compact_boundary system message', async () => {
      const texts: string[] = [];
      adapter.on('text', (t: string) => texts.push(t));

      mockQuery.mockReturnValue(createMockQuery([
        makeCompactMessage(),
        makeResultMessage('success'),
      ]));

      await adapter.prompt('test');
      expect(texts).toContainEqual(expect.stringContaining('Context compacted'));
    });

    it('handles mixed content blocks in one assistant message', async () => {
      const texts: string[] = [];
      const thoughts: string[] = [];
      const calls: unknown[] = [];

      adapter.on('text', (t: string) => texts.push(t));
      adapter.on('thinking', (t: string) => thoughts.push(t));
      adapter.on('tool_call', (c: unknown) => calls.push(c));

      const mixed: SdkAssistantMessage = {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'Hmm...' },
            { type: 'text', text: 'I will run a command' },
            { type: 'tool_use', id: 'tc-3', name: 'bash', input: { cmd: 'echo hi' } },
          ],
        },
      };

      mockQuery.mockReturnValue(createMockQuery([
        mixed,
        makeResultMessage('success'),
      ]));

      await adapter.prompt('test');
      expect(thoughts).toEqual(['Hmm...']);
      expect(texts).toEqual(['I will run a command']);
      expect(calls).toHaveLength(1);
    });
  });

  // ── Stop Reason Translation ────────────────────────────────

  describe('stop reason translation', () => {
    beforeEach(async () => {
      await adapter.start({ cliCommand: 'claude' });
    });

    it('translates success to end_turn', async () => {
      mockQuery.mockReturnValue(createMockQuery([makeResultMessage('success')]));
      const result = await adapter.prompt('test');
      expect(result.stopReason).toBe('end_turn');
    });

    it('translates end_turn to end_turn', async () => {
      mockQuery.mockReturnValue(createMockQuery([makeResultMessage('end_turn')]));
      const result = await adapter.prompt('test');
      expect(result.stopReason).toBe('end_turn');
    });

    it('translates error_max_turns to max_tokens', async () => {
      mockQuery.mockReturnValue(createMockQuery([makeResultMessage('error_max_turns')]));
      const result = await adapter.prompt('test');
      expect(result.stopReason).toBe('max_tokens');
    });

    it('translates error_max_budget_usd to max_tokens', async () => {
      mockQuery.mockReturnValue(createMockQuery([makeResultMessage('error_max_budget_usd')]));
      const result = await adapter.prompt('test');
      expect(result.stopReason).toBe('max_tokens');
    });

    it('translates tool_use to tool_use', async () => {
      mockQuery.mockReturnValue(createMockQuery([makeResultMessage('tool_use')]));
      const result = await adapter.prompt('test');
      expect(result.stopReason).toBe('tool_use');
    });

    it('translates unknown to error', async () => {
      mockQuery.mockReturnValue(createMockQuery([makeResultMessage('unknown_reason')]));
      const result = await adapter.prompt('test');
      expect(result.stopReason).toBe('error');
    });
  });

  // ── Permission Handling ────────────────────────────────────

  describe('permission handling', () => {
    it('auto-allows all permissions (oversight is prompt-only)', async () => {
      await adapter.start({ cliCommand: 'claude' });

      const result = await adapter.handlePermission(
        { tool_name: 'bash', tool_input: {} },
        'perm-1',
        { signal: { aborted: false, addEventListener: () => {} } },
      );

      expect(result).toEqual({ result: 'allow' });
    });
  });

  // ── Cancel / Terminate ─────────────────────────────────────

  describe('cancel()', () => {
    it('interrupts the active query', async () => {
      // Use a controllable generator that we can release
      let release: () => void;
      const blocker = new Promise<void>(r => { release = r; });

      const hangingQuery = {
        interrupt: vi.fn(() => { release(); }),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          yield makeTextMessage('start');
          await blocker;
          // After interrupt releases the blocker, throw to exit loop
          throw new Error('aborted');
        },
      };
      mockQuery.mockReturnValue(hangingQuery);

      await adapter.start({ cliCommand: 'claude' });
      const promptPromise = adapter.prompt('test');

      // Give prompt() time to start iterating
      await new Promise(r => setTimeout(r, 10));

      await adapter.cancel();
      expect(hangingQuery.interrupt).toHaveBeenCalled();

      // Prompt should finish (with error from abort)
      await promptPromise.catch(() => {});
    });

    it('is a no-op when no active query', async () => {
      await adapter.start({ cliCommand: 'claude' });
      // Should not throw
      await adapter.cancel();
    });
  });

  describe('terminate()', () => {
    it('cleans up state and emits exit', async () => {
      const exits: number[] = [];
      adapter.on('exit', (code: number) => exits.push(code));

      await adapter.start({ cliCommand: 'claude' });
      adapter.terminate();

      expect(adapter.isConnected).toBe(false);
      expect(adapter.isPrompting).toBe(false);
      expect(exits).toEqual([0]);
    });

    it('closes active query on terminate', async () => {
      let release: () => void;
      const blocker = new Promise<void>(r => { release = r; });

      const slowQuery = {
        interrupt: vi.fn(),
        close: vi.fn(() => { release(); }),
        [Symbol.asyncIterator]: async function* () {
          await blocker;
          throw new Error('closed');
        },
      };
      mockQuery.mockReturnValue(slowQuery);

      await adapter.start({ cliCommand: 'claude' });
      const promptPromise = adapter.prompt('test');

      await new Promise(r => setTimeout(r, 10));
      adapter.terminate();

      expect(slowQuery.close).toHaveBeenCalled();
      await promptPromise.catch(() => {});
    });
  });

  // ── Error Handling ─────────────────────────────────────────

  describe('error handling', () => {
    it('rethrows SDK errors from prompt()', async () => {
      const errorQuery = {
        interrupt: vi.fn(),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          throw new Error('Rate limit exceeded');
        },
      };
      mockQuery.mockReturnValue(errorQuery);

      await adapter.start({ cliCommand: 'claude' });
      await expect(adapter.prompt('test')).rejects.toThrow('Rate limit exceeded');

      // Adapter should recover — not stuck in prompting state
      expect(adapter.isPrompting).toBe(false);
    });

    it('emits prompt_complete with error on failure', async () => {
      const completions: string[] = [];
      adapter.on('prompt_complete', (r: string) => completions.push(r));

      const errorQuery = {
        interrupt: vi.fn(),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          throw new Error('API error');
        },
      };
      mockQuery.mockReturnValue(errorQuery);

      await adapter.start({ cliCommand: 'claude' });
      await adapter.prompt('test').catch(() => {});

      expect(completions).toContain('error');
    });
  });

  // ── Queue Drain ────────────────────────────────────────────

  describe('queue drain', () => {
    it('queues prompts while already prompting', async () => {
      let resolveFirst!: () => void;
      const firstDone = new Promise<void>(r => { resolveFirst = r; });

      const slowQuery = {
        interrupt: vi.fn(),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          await firstDone;
          yield makeResultMessage('success');
        },
      };

      // First call returns slow query, second returns fast query
      mockQuery
        .mockReturnValueOnce(slowQuery)
        .mockReturnValueOnce(createMockQuery([makeResultMessage('success')]));

      await adapter.start({ cliCommand: 'claude' });
      const firstPromise = adapter.prompt('first');

      // Queue a second prompt while first is running
      const queueResult = await adapter.prompt('second');
      expect(queueResult.stopReason).toBe('end_turn'); // Immediate return

      // Let the first complete — should drain queue
      resolveFirst();
      await firstPromise;

      // Give drain time to execute
      await new Promise(r => setTimeout(r, 50));

      // The drained prompt should have called query a second time
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('priority queued prompts inserted before normal prompts', async () => {
      let resolveFirst!: () => void;
      const firstDone = new Promise<void>(r => { resolveFirst = r; });

      const slowQuery = {
        interrupt: vi.fn(),
        close: vi.fn(),
        [Symbol.asyncIterator]: async function* () {
          await firstDone;
          yield makeResultMessage('success');
        },
      };

      // Use mockReturnValue so all subsequent calls get a valid query
      mockQuery.mockReturnValue(createMockQuery([makeResultMessage('success')]));
      mockQuery.mockReturnValueOnce(slowQuery);

      await adapter.start({ cliCommand: 'claude' });
      const firstPromise = adapter.prompt('first');

      // Queue normal then priority — priority should be inserted before normal
      await adapter.prompt('normal-msg');
      await adapter.prompt('priority-msg', { priority: true });

      // Resolve the first prompt so drain fires
      resolveFirst();
      await firstPromise;

      // Wait for drain to execute (async prompt)
      await vi.waitFor(() => {
        // The drain should have called mockQuery a second time
        expect(mockQuery.mock.calls.length).toBeGreaterThanOrEqual(2);
      }, { timeout: 1000 });

      // Find the drain call (last call to mockQuery)
      const lastCallIdx = mockQuery.mock.calls.length - 1;
      const drainText = mockQuery.mock.calls[lastCallIdx][0] as string;
      // Priority text should come before normal text
      expect(drainText).toContain('priority-msg');
      expect(drainText).toContain('normal-msg');
      expect(drainText.indexOf('priority-msg')).toBeLessThan(drainText.indexOf('normal-msg'));
    });

    it('emits idle when queue is empty after prompt', async () => {
      const idles: boolean[] = [];
      adapter.on('idle', () => idles.push(true));

      mockQuery.mockReturnValue(createMockQuery([
        makeResultMessage('success'),
      ]));

      await adapter.start({ cliCommand: 'claude' });
      await adapter.prompt('test');

      expect(idles).toHaveLength(1);
    });
  });

  // ── Session Listing ────────────────────────────────────────

  describe('listSdkSessions()', () => {
    it('returns SDK sessions', async () => {
      mockListSessions.mockResolvedValue([
        { sessionId: 's1', summary: 'First', lastModified: 1000 },
        { sessionId: 's2', summary: 'Second', lastModified: 2000 },
      ]);

      await adapter.start({ cliCommand: 'claude' });
      const sessions = await adapter.listSdkSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionId).toBe('s1');
      expect(mockListSessions).toHaveBeenCalledWith(expect.objectContaining({ dir: expect.any(String) }));
    });
  });


});
