/**
 * AcpAdapter unit tests.
 *
 * Tests the ACP protocol adapter that serves 5 of 8 providers
 * (Copilot, Gemini, OpenCode, Cursor, Codex) via subprocess stdio.
 *
 * Mock pattern: child_process.spawn/execFileSync + @agentclientprotocol/sdk
 * are fully mocked so tests run without any external CLI binaries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

// ── Mock child_process ────────────────────────────────────────────
const mockSpawn = vi.fn();
const mockExecFileSync = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
  ChildProcess: EventEmitter,
}));

// ── Mock @agentclientprotocol/sdk ─────────────────────────────────
const mockInitialize = vi.fn();
const mockNewSession = vi.fn();
const mockLoadSession = vi.fn();
const mockPrompt = vi.fn();
const mockCancel = vi.fn();

let capturedClientFactory: ((agent: any) => any) | null = null;

vi.mock('@agentclientprotocol/sdk', () => ({
  PROTOCOL_VERSION: '1.0',
  ndJsonStream: vi.fn(() => ({ readable: new ReadableStream(), writable: new WritableStream() })),
  ClientSideConnection: vi.fn().mockImplementation(function (this: any, clientFactory: any) {
    capturedClientFactory = clientFactory;
    this.initialize = mockInitialize;
    this.newSession = mockNewSession;
    this.loadSession = mockLoadSession;
    this.prompt = mockPrompt;
    this.cancel = mockCancel;
  }),
}));

// ── Mock logger ───────────────────────────────────────────────────
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import AFTER mocking
import { AcpAdapter } from './AcpAdapter.js';
import { logger } from '../utils/logger.js';

// ── Helpers ───────────────────────────────────────────────────────

/** Create a fake child process with piped stdin/stdout as real streams */
function createFakeProcess() {
  const proc = new EventEmitter() as any;
  const stdin = new PassThrough();
  // Simulate CLI exiting after stdin closes (flushes session state)
  stdin.on('finish', () => { setTimeout(() => proc.emit('exit', 0, null), 10); });
  proc.stdin = stdin;
  proc.stdout = new PassThrough();
  proc.stderr = null;
  proc.kill = vi.fn(() => { proc.emit('exit', 0, null); });
  proc.pid = 12345;
  proc.exitCode = null;
  proc.signalCode = null;
  // Track exit state like a real ChildProcess
  proc.on('exit', (code: number | null, signal: string | null) => {
    proc.exitCode = code;
    proc.signalCode = signal;
  });
  return proc;
}

/** Set up mocks so that start() completes successfully */
function setupSuccessfulStart(sessionId = 'test-session-123') {
  mockExecFileSync.mockReturnValue('');
  const fakeProc = createFakeProcess();
  mockSpawn.mockReturnValue(fakeProc);
  mockInitialize.mockResolvedValue({ agentCapabilities: { promptCapabilities: { image: true } } });
  mockNewSession.mockResolvedValue({ sessionId });
  return fakeProc;
}

const DEFAULT_START_OPTS = {
  cliCommand: 'copilot',
  cwd: '/tmp/test-workspace',
};

// ──────────────────────────────────────────────────────────────────

describe('AcpAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedClientFactory = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Construction ─────────────────────────────────────────────

  describe('construction', () => {
    it('has type "acp"', () => {
      const adapter = new AcpAdapter();
      expect(adapter.type).toBe('acp');
    });

    it('starts in disconnected state', () => {
      const adapter = new AcpAdapter();
      expect(adapter.isConnected).toBe(false);
      expect(adapter.isPrompting).toBe(false);
      expect(adapter.promptingStartedAt).toBeNull();
      expect(adapter.currentSessionId).toBeNull();
    });

    it('defaults supportsImages to false before start', () => {
      const adapter = new AcpAdapter();
      expect(adapter.supportsImages).toBe(false);
    });

  });

  // ── 2. start() ──────────────────────────────────────────────────

  describe('start()', () => {
    it('validates CLI binary exists before spawning', async () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });

      const adapter = new AcpAdapter();
      await expect(adapter.start(DEFAULT_START_OPTS))
        .rejects.toThrow(/CLI binary "copilot" not found in PATH/);

      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('spawns process with correct args and cwd', async () => {
      setupSuccessfulStart();

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      expect(mockSpawn).toHaveBeenCalledWith(
        'copilot',
        ['--acp', '--stdio'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'inherit'],
          cwd: '/tmp/test-workspace',
        }),
      );
    });

    it('passes custom baseArgs and cliArgs', async () => {
      setupSuccessfulStart();

      const adapter = new AcpAdapter();
      await adapter.start({
        ...DEFAULT_START_OPTS,
        cliCommand: 'gemini',
        baseArgs: ['--acp'],
        cliArgs: ['--model', 'gemini-pro'],
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'gemini',
        ['--acp', '--model', 'gemini-pro'],
        expect.any(Object),
      );
    });

    it('passes environment variables to spawned process', async () => {
      setupSuccessfulStart();

      const adapter = new AcpAdapter();
      await adapter.start({
        ...DEFAULT_START_OPTS,
        env: { GEMINI_API_KEY: 'test-key' },
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({ GEMINI_API_KEY: 'test-key' }),
        }),
      );
    });

    it('creates new session and returns session ID', async () => {
      setupSuccessfulStart('session-abc');

      const adapter = new AcpAdapter();
      const sessionId = await adapter.start(DEFAULT_START_OPTS);

      expect(sessionId).toBe('session-abc');
      expect(adapter.currentSessionId).toBe('session-abc');
      expect(adapter.isConnected).toBe(true);
    });

    it('emits connected event with session ID', async () => {
      setupSuccessfulStart('session-xyz');

      const adapter = new AcpAdapter();
      const connectedSessions: string[] = [];
      adapter.on('connected', (id: string) => connectedSessions.push(id));

      await adapter.start(DEFAULT_START_OPTS);

      expect(connectedSessions).toEqual(['session-xyz']);
    });

    it('resumes existing session when sessionId is provided', async () => {
      setupSuccessfulStart();
      mockLoadSession.mockResolvedValue({});

      const adapter = new AcpAdapter();
      const sessionId = await adapter.start({
        ...DEFAULT_START_OPTS,
        sessionId: 'previous-session-id',
      });

      expect(mockLoadSession).toHaveBeenCalledWith({
        sessionId: 'previous-session-id',
        cwd: DEFAULT_START_OPTS.cwd,
        mcpServers: [],
      });
      // Session ID comes from the request, not the response (LoadSessionResponse has no sessionId)
      expect(sessionId).toBe('previous-session-id');
    });

    it('throws when resume fails instead of falling back', async () => {
      setupSuccessfulStart();
      mockLoadSession.mockRejectedValue(new Error('session/load not supported'));

      const adapter = new AcpAdapter();
      const resumeFailedHandler = vi.fn();
      adapter.on('session_resume_failed', resumeFailedHandler);

      await expect(adapter.start({
        ...DEFAULT_START_OPTS,
        sessionId: 'dead-session',
      })).rejects.toThrow('Session resume failed: session/load not supported');

      expect(mockNewSession).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({
        module: 'acp',
        msg: 'Session resume failed',
        requestedSessionId: 'dead-session',
        error: 'session/load not supported',
      }));
      expect(resumeFailedHandler).toHaveBeenCalledWith({
        requestedSessionId: 'dead-session',
        error: 'session/load not supported',
      });
    });

    it('reads agent capabilities from initialize result', async () => {
      setupSuccessfulStart();
      mockInitialize.mockResolvedValue({
        agentCapabilities: { promptCapabilities: { image: true } },
      });

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      expect(adapter.supportsImages).toBe(true);
    });

    it('handles missing capabilities gracefully', async () => {
      setupSuccessfulStart();
      mockInitialize.mockResolvedValue({});

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      expect(adapter.supportsImages).toBe(false);
    });
  });

  // ── 3. prompt() ─────────────────────────────────────────────────

  describe('prompt()', () => {
    it('throws when connection is not established', async () => {
      const adapter = new AcpAdapter();
      await expect(adapter.prompt('hello')).rejects.toThrow('ACP connection not established');
    });

    it('sends string prompt as text content block', async () => {
      setupSuccessfulStart('prompt-session');
      mockPrompt.mockResolvedValue({ stopReason: 'end_turn' });

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);
      await adapter.prompt('Tell me about TypeScript');

      expect(mockPrompt).toHaveBeenCalledWith({
        sessionId: 'prompt-session',
        prompt: [{ type: 'text', text: 'Tell me about TypeScript' }],
      });
    });

    it('sends ContentBlock[] prompts directly', async () => {
      setupSuccessfulStart('block-session');
      mockPrompt.mockResolvedValue({ stopReason: 'end_turn' });

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      const blocks = [
        { type: 'text' as const, text: 'Look at this image:' },
        { type: 'image' as const, data: 'base64...', mimeType: 'image/png' },
      ];
      await adapter.prompt(blocks);

      expect(mockPrompt).toHaveBeenCalledWith({
        sessionId: 'block-session',
        prompt: blocks,
      });
    });

    it('returns translated stop reason', async () => {
      setupSuccessfulStart();
      mockPrompt.mockResolvedValue({ stopReason: 'tool_use' });

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);
      const result = await adapter.prompt('test');

      expect(result.stopReason).toBe('tool_use');
    });

    it('returns usage info when available', async () => {
      setupSuccessfulStart();
      mockPrompt.mockResolvedValue({
        stopReason: 'end_turn',
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);
      const result = await adapter.prompt('test');

      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it('emits prompting state changes and response_start', async () => {
      setupSuccessfulStart();
      mockPrompt.mockResolvedValue({ stopReason: 'end_turn' });

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      const events: string[] = [];
      adapter.on('prompting', (active: boolean) => events.push(`prompting:${active}`));
      adapter.on('response_start', () => events.push('response_start'));
      adapter.on('prompt_complete', (reason: string) => events.push(`complete:${reason}`));

      await adapter.prompt('test');

      expect(events).toEqual([
        'prompting:true',
        'response_start',
        'prompting:false',
        'complete:end_turn',
      ]);
    });

    it('emits usage event when prompt returns usage', async () => {
      setupSuccessfulStart();
      mockPrompt.mockResolvedValue({
        stopReason: 'end_turn',
        usage: { inputTokens: 200, outputTokens: 100 },
      });

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      const usages: any[] = [];
      adapter.on('usage', (u: any) => usages.push(u));

      await adapter.prompt('test');

      expect(usages).toEqual([{ inputTokens: 200, outputTokens: 100 }]);
    });

    it('queues prompts when already prompting', async () => {
      setupSuccessfulStart();

      let resolveFirst: (val: any) => void;
      const firstPromptPromise = new Promise((resolve) => { resolveFirst = resolve; });
      mockPrompt.mockReturnValueOnce(firstPromptPromise);

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      // Start first prompt (will hang)
      const p1 = adapter.prompt('first');

      // Queue second prompt
      mockPrompt.mockResolvedValueOnce({ stopReason: 'end_turn' });
      const p2 = adapter.prompt('second');

      // Second prompt should return immediately with end_turn (queued)
      const result2 = await p2;
      expect(result2.stopReason).toBe('end_turn');

      // Resolve first prompt so it drains the queue
      resolveFirst!({ stopReason: 'end_turn' });
      await p1;
    });

    it('inserts priority prompts at the front of the queue', async () => {
      setupSuccessfulStart();

      let resolveFirst: (val: any) => void;
      const firstPromptPromise = new Promise((resolve) => { resolveFirst = resolve; });
      mockPrompt.mockReturnValueOnce(firstPromptPromise);

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      // Start first prompt (will hang)
      const p1 = adapter.prompt('first');

      // Queue normal and priority prompts
      adapter.prompt('normal');
      adapter.prompt('urgent', { priority: true });

      // Let first complete — drainQueue should process urgent before normal
      mockPrompt.mockResolvedValue({ stopReason: 'end_turn' });
      resolveFirst!({ stopReason: 'end_turn' });
      await p1;

      // The drain should have merged: priority first, then normal
      // mockPrompt is called with a merged content block array
      // We verify it was called (drain happened)
      expect(mockPrompt).toHaveBeenCalledTimes(2); // first + drain
    });

    it('emits prompt_complete with "error" and rethrows on failure', async () => {
      setupSuccessfulStart();
      mockPrompt.mockRejectedValue(new Error('SDK error'));

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      const events: string[] = [];
      adapter.on('prompt_complete', (reason: string) => events.push(reason));

      await expect(adapter.prompt('test')).rejects.toThrow('SDK error');
      expect(events).toContain('error');
      expect(adapter.isPrompting).toBe(false);
    });

    it('emits idle when queue is empty after prompt completes', async () => {
      setupSuccessfulStart();
      mockPrompt.mockResolvedValue({ stopReason: 'end_turn' });

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      const events: string[] = [];
      adapter.on('idle', () => events.push('idle'));

      await adapter.prompt('test');

      expect(events).toContain('idle');
    });
  });

  // ── 4. cancel() ─────────────────────────────────────────────────

  describe('cancel()', () => {
    it('calls connection.cancel with current session ID', async () => {
      setupSuccessfulStart('cancel-session');

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);
      await adapter.cancel();

      expect(mockCancel).toHaveBeenCalledWith({ sessionId: 'cancel-session' });
    });

    it('does nothing when not connected', async () => {
      const adapter = new AcpAdapter();
      await adapter.cancel(); // Should not throw
      expect(mockCancel).not.toHaveBeenCalled();
    });
  });

  // ── 5. terminate() ──────────────────────────────────────────────

  describe('terminate()', () => {
    it('closes stdin and waits for process exit', async () => {
      const fakeProc = setupSuccessfulStart();

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      expect(adapter.isConnected).toBe(true);

      await adapter.terminate();

      expect(adapter.isConnected).toBe(false);
      expect(adapter.isPrompting).toBe(false);
      expect(adapter.promptingStartedAt).toBeNull();
      // Process exited naturally via stdin close — kill() not needed
      expect(fakeProc.kill).not.toHaveBeenCalled();
    });

    it('is safe to call when not started', async () => {
      const adapter = new AcpAdapter();
      await adapter.terminate(); // Should not throw
    });

    it('is safe to call twice', async () => {
      setupSuccessfulStart();

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      await adapter.terminate();
      await adapter.terminate(); // Should not throw
    });
  });

  // ── 6. Process error handling ───────────────────────────────────

  describe('process error handling', () => {
    it('emits exit(1) on spawn error (ENOENT)', async () => {
      mockExecFileSync.mockReturnValue('');
      const fakeProc = createFakeProcess();
      mockSpawn.mockReturnValue(fakeProc);
      // Let initialize hang — we fire the error event before it resolves
      mockInitialize.mockReturnValue(new Promise(() => {}));

      const adapter = new AcpAdapter();
      const exitCodes: number[] = [];
      adapter.on('exit', (code: number) => exitCodes.push(code));

      // Don't await — it will hang due to mockInitialize
      const _startPromise = adapter.start(DEFAULT_START_OPTS).catch(() => {});

      // Allow microtask to execute spawn
      await new Promise((r) => setTimeout(r, 50));

      const spawnError = Object.assign(new Error('spawn copilot ENOENT'), { code: 'ENOENT' });
      fakeProc.emit('error', spawnError);

      // Allow event handlers to fire
      await new Promise((r) => setTimeout(r, 50));

      expect(exitCodes).toContain(1);
      expect(adapter.isConnected).toBe(false);

      // Clean up hanging promise
      await adapter.terminate();
    });

    it('normalizes null exit code to 1 on signal kill', async () => {
      mockExecFileSync.mockReturnValue('');
      const fakeProc = createFakeProcess();
      mockSpawn.mockReturnValue(fakeProc);
      mockInitialize.mockReturnValue(new Promise(() => {}));

      const adapter = new AcpAdapter();
      const exitCodes: number[] = [];
      adapter.on('exit', (code: number) => exitCodes.push(code));

      adapter.start(DEFAULT_START_OPTS).catch(() => {});
      await new Promise((r) => setTimeout(r, 50));

      fakeProc.emit('exit', null, 'SIGKILL');
      await new Promise((r) => setTimeout(r, 50));

      expect(exitCodes).toEqual([1]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ signal: 'SIGKILL' }),
      );

      await adapter.terminate();
    });

    it('emits exit only once when both error and exit fire', async () => {
      mockExecFileSync.mockReturnValue('');
      const fakeProc = createFakeProcess();
      mockSpawn.mockReturnValue(fakeProc);
      mockInitialize.mockReturnValue(new Promise(() => {}));

      const adapter = new AcpAdapter();
      const exitCodes: number[] = [];
      adapter.on('exit', (code: number) => exitCodes.push(code));

      adapter.start(DEFAULT_START_OPTS).catch(() => {});
      await new Promise((r) => setTimeout(r, 50));

      fakeProc.emit('error', new Error('spawn ENOENT'));
      fakeProc.emit('exit', null);
      await new Promise((r) => setTimeout(r, 50));

      expect(exitCodes).toHaveLength(1);

      await adapter.terminate();
    });

    it('preserves numeric exit code on normal exit', async () => {
      mockExecFileSync.mockReturnValue('');
      const fakeProc = createFakeProcess();
      mockSpawn.mockReturnValue(fakeProc);
      mockInitialize.mockReturnValue(new Promise(() => {}));

      const adapter = new AcpAdapter();
      const exitCodes: number[] = [];
      adapter.on('exit', (code: number) => exitCodes.push(code));

      adapter.start(DEFAULT_START_OPTS).catch(() => {});
      await new Promise((r) => setTimeout(r, 50));

      fakeProc.emit('exit', 42, null);
      await new Promise((r) => setTimeout(r, 50));

      expect(exitCodes).toEqual([42]);

      await adapter.terminate();
    });
  });

  // ── 7. Event translation (sessionUpdate) ────────────────────────

  describe('event translation', () => {
    /** Helper: start adapter and get the sessionUpdate callback */
    async function startAndGetClient() {
      setupSuccessfulStart();

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      // ClientSideConnection was constructed with a client factory
      expect(capturedClientFactory).not.toBeNull();
      const client = capturedClientFactory!(null);
      return { adapter, client };
    }

    it('translates agent_message_chunk text to "text" event', async () => {
      const { adapter, client } = await startAndGetClient();

      const texts: string[] = [];
      adapter.on('text', (t: string) => texts.push(t));

      await client.sessionUpdate({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello world' },
        },
      });

      expect(texts).toEqual(['Hello world']);
    });

    it('translates agent_message_chunk resource to "content" event', async () => {
      const { adapter, client } = await startAndGetClient();

      const contents: any[] = [];
      adapter.on('content', (c: any) => contents.push(c));

      await client.sessionUpdate({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'resource',
            resource: { uri: 'file:///src/main.ts', text: 'const x = 1;', mimeType: 'text/typescript' },
          },
        },
      });

      expect(contents).toHaveLength(1);
      expect(contents[0].contentType).toBe('resource');
      expect(contents[0].uri).toBe('file:///src/main.ts');
    });

    it('translates agent_message_chunk image to "content" event', async () => {
      const { adapter, client } = await startAndGetClient();

      const contents: any[] = [];
      adapter.on('content', (c: any) => contents.push(c));

      await client.sessionUpdate({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'image', data: 'base64data', mimeType: 'image/jpeg' },
        },
      });

      expect(contents).toHaveLength(1);
      expect(contents[0].contentType).toBe('image');
      expect(contents[0].mimeType).toBe('image/jpeg');
    });

    it('translates agent_message_chunk audio to "content" event', async () => {
      const { adapter, client } = await startAndGetClient();

      const contents: any[] = [];
      adapter.on('content', (c: any) => contents.push(c));

      await client.sessionUpdate({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'audio', data: 'audiodata' },
        },
      });

      expect(contents).toHaveLength(1);
      expect(contents[0].contentType).toBe('audio');
      expect(contents[0].mimeType).toBe('audio/wav'); // default
    });

    it('translates unknown content type to text fallback', async () => {
      const { adapter, client } = await startAndGetClient();

      const texts: string[] = [];
      adapter.on('text', (t: string) => texts.push(t));

      await client.sessionUpdate({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'custom_widget' },
        },
      });

      expect(texts).toHaveLength(1);
      expect(texts[0]).toContain('[custom_widget content]');
    });

    it('translates agent_thought_chunk to "thinking" event', async () => {
      const { adapter, client } = await startAndGetClient();

      const thoughts: string[] = [];
      adapter.on('thinking', (t: string) => thoughts.push(t));

      await client.sessionUpdate({
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Let me think about this...' },
        },
      });

      expect(thoughts).toEqual(['Let me think about this...']);
    });

    it('translates tool_call to "tool_call" event', async () => {
      const { adapter, client } = await startAndGetClient();

      const calls: any[] = [];
      adapter.on('tool_call', (info: any) => calls.push(info));

      await client.sessionUpdate({
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-001',
          title: 'Read file',
          kind: 'bash',
          status: 'running',
          content: [{ type: 'text', text: 'cat src/main.ts' }],
        },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0].toolCallId).toBe('tc-001');
      expect(calls[0].title).toBe('Read file');
      expect(calls[0].kind).toBe('bash');
      expect(calls[0].status).toBe('running');
    });

    it('translates tool_call_update to "tool_call_update" event', async () => {
      const { adapter, client } = await startAndGetClient();

      const updates: any[] = [];
      adapter.on('tool_call_update', (info: any) => updates.push(info));

      await client.sessionUpdate({
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc-001',
          status: 'completed',
          content: 'File read successfully',
        },
      });

      expect(updates).toHaveLength(1);
      expect(updates[0].toolCallId).toBe('tc-001');
      expect(updates[0].status).toBe('completed');
    });

    it('translates plan to "plan" event', async () => {
      const { adapter, client } = await startAndGetClient();

      const plans: any[] = [];
      adapter.on('plan', (entries: any) => plans.push(entries));

      await client.sessionUpdate({
        update: {
          sessionUpdate: 'plan',
          entries: [
            { content: 'Read files', priority: 'high', status: 'done' },
            { content: 'Write tests', priority: 'high', status: 'pending' },
          ],
        },
      });

      expect(plans).toHaveLength(1);
      expect(plans[0]).toHaveLength(2);
    });

    it('translates usage_update to "usage_update" event', async () => {
      const { adapter, client } = await startAndGetClient();

      const usages: any[] = [];
      adapter.on('usage_update', (u: any) => usages.push(u));

      await client.sessionUpdate({
        update: {
          sessionUpdate: 'usage_update',
          size: 200000,
          used: 15000,
          cost: 0.05,
        },
      });

      expect(usages).toHaveLength(1);
      expect(usages[0]).toEqual({ size: 200000, used: 15000, cost: 0.05 });
    });

    it('handles usage_update with null cost', async () => {
      const { adapter, client } = await startAndGetClient();

      const usages: any[] = [];
      adapter.on('usage_update', (u: any) => usages.push(u));

      await client.sessionUpdate({
        update: {
          sessionUpdate: 'usage_update',
          size: 200000,
          used: 5000,
        },
      });

      expect(usages[0].cost).toBeNull();
    });
  });

  // ── 8. Permission handling ──────────────────────────────────────

  describe('permission handling', () => {
    it('requestPermission always auto-approves with allow_once', async () => {
      setupSuccessfulStart();

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      const client = capturedClientFactory!(null);
      const result = await client.requestPermission({
        title: 'Run bash command',
        description: 'Execute ls -la',
        options: [
          { optionId: 'allow-1', kind: 'allow_once', label: 'Allow' },
          { optionId: 'deny-1', kind: 'deny', label: 'Deny' },
        ],
      });

      expect(result.outcome.outcome).toBe('selected');
      expect(result.outcome.optionId).toBe('allow-1');
    });
  });

  // ── 9. extractContentText helper (via tool_call events) ─────────

  describe('extractContentText', () => {
    it('extracts text from string content', async () => {
      setupSuccessfulStart();

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      const calls: any[] = [];
      adapter.on('tool_call', (info: any) => calls.push(info));

      const client = capturedClientFactory!(null);
      await client.sessionUpdate({
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-str',
          title: 'test',
          kind: 'bash',
          status: 'done',
          content: 'simple string content',
        },
      });

      expect(calls[0].content).toBe('simple string content');
    });

    it('extracts text from array of content blocks', async () => {
      setupSuccessfulStart();

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      const calls: any[] = [];
      adapter.on('tool_call', (info: any) => calls.push(info));

      const client = capturedClientFactory!(null);
      await client.sessionUpdate({
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-arr',
          title: 'test',
          kind: 'bash',
          status: 'done',
          content: [
            { type: 'text', text: 'line 1' },
            { type: 'text', text: 'line 2' },
          ],
        },
      });

      expect(calls[0].content).toContain('line 1');
      expect(calls[0].content).toContain('line 2');
    });

    it('handles null/undefined content', async () => {
      setupSuccessfulStart();

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      const calls: any[] = [];
      adapter.on('tool_call', (info: any) => calls.push(info));

      const client = capturedClientFactory!(null);
      await client.sessionUpdate({
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-null',
          title: 'test',
          kind: 'bash',
          status: 'done',
          content: null,
        },
      });

      expect(calls[0].content).toBeUndefined();
    });

    it('extracts text from resource content blocks', async () => {
      setupSuccessfulStart();

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      const calls: any[] = [];
      adapter.on('tool_call', (info: any) => calls.push(info));

      const client = capturedClientFactory!(null);
      await client.sessionUpdate({
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc-res',
          title: 'test',
          kind: 'view',
          status: 'done',
          content: [
            { type: 'resource', resource: { uri: 'file:///test.ts', text: 'export {}' } },
          ],
        },
      });

      expect(calls[0].content).toContain('file:///test.ts');
      expect(calls[0].content).toContain('export {}');
    });
  });

  // ── 10. Stop reason translation ─────────────────────────────────

  describe('stop reason translation', () => {
    const stopReasons = [
      { sdk: 'end_turn', expected: 'end_turn' },
      { sdk: 'tool_use', expected: 'tool_use' },
      { sdk: 'max_tokens', expected: 'max_tokens' },
      { sdk: 'stop_sequence', expected: 'stop_sequence' },
      { sdk: 'unknown_reason', expected: 'end_turn' }, // fallback
    ];

    for (const { sdk, expected } of stopReasons) {
      it(`maps "${sdk}" to "${expected}"`, async () => {
        setupSuccessfulStart();
        mockPrompt.mockResolvedValue({ stopReason: sdk });

        const adapter = new AcpAdapter();
        await adapter.start(DEFAULT_START_OPTS);
        const result = await adapter.prompt('test');

        expect(result.stopReason).toBe(expected);
      });
    }
  });

  // ── 9. System note buffer ───────────────────────────────────────

  describe('system note buffer', () => {
    it('appendSystemNote + flushSystemNotes returns merged string', () => {
      const adapter = new AcpAdapter();
      adapter.appendSystemNote('[System] Lock acquired');
      adapter.appendSystemNote('[System] DAG updated');

      const merged = adapter.flushSystemNotes();
      expect(merged).toBe('[System] Lock acquired\n[System] DAG updated');
    });

    it('flushSystemNotes returns null when buffer is empty', () => {
      const adapter = new AcpAdapter();
      expect(adapter.flushSystemNotes()).toBeNull();
    });

    it('flushSystemNotes clears the buffer', () => {
      const adapter = new AcpAdapter();
      adapter.appendSystemNote('note1');
      adapter.flushSystemNotes();
      expect(adapter.flushSystemNotes()).toBeNull();
    });

    it('terminate clears the system note buffer', async () => {
      setupSuccessfulStart();
      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      adapter.appendSystemNote('buffered note');
      await adapter.terminate();
      expect(adapter.flushSystemNotes()).toBeNull();
    });

    it('caps buffer at 50 entries, dropping oldest', () => {
      const adapter = new AcpAdapter();
      for (let i = 0; i < 60; i++) {
        adapter.appendSystemNote(`note-${i}`);
      }
      const merged = adapter.flushSystemNotes()!;
      const lines = merged.split('\n');
      expect(lines).toHaveLength(50);
      expect(lines[0]).toBe('note-10');
      expect(lines[49]).toBe('note-59');
    });
  });

  // ── 10. Prompt timeout (removed) ─────────────────────────────────
  // The 10-minute prompt timeout was removed because it killed agents
  // working on complex tasks. AlertEngine.checkLongRunningPrompts()
  // provides observability for long-running prompts without hard-killing.

  // ── 11. Drain order (drainQueue before prompt_complete) ─────────

  describe('drain order', () => {
    it('fires idle before prompt_complete when queue is empty', async () => {
      setupSuccessfulStart();
      mockPrompt.mockResolvedValue({ stopReason: 'end_turn' });

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      const events: string[] = [];
      adapter.on('idle', () => events.push('idle'));
      adapter.on('prompt_complete', (reason: string) => events.push(`complete:${reason}`));

      await adapter.prompt('test');

      expect(events).toEqual(['idle', 'complete:end_turn']);
    });

    it('starts draining queued items before emitting prompt_complete', async () => {
      setupSuccessfulStart();

      let resolveFirst: (val: any) => void;
      const firstPromptPromise = new Promise((resolve) => { resolveFirst = resolve; });
      mockPrompt.mockReturnValueOnce(firstPromptPromise);

      const adapter = new AcpAdapter();
      await adapter.start(DEFAULT_START_OPTS);

      // Start first prompt (will hang)
      const p1 = adapter.prompt('first');

      // Queue a second prompt while first is active
      adapter.prompt('second');

      const events: string[] = [];
      adapter.on('prompting', (active: boolean) => events.push(`prompting:${active}`));
      adapter.on('prompt_complete', () => events.push('prompt_complete'));

      // Resolve first prompt — drain should start before prompt_complete fires
      mockPrompt.mockResolvedValue({ stopReason: 'end_turn' });
      resolveFirst!({ stopReason: 'end_turn' });
      await p1;

      // prompt_complete fires AFTER drainQueue starts the second prompt
      // (drainQueue calls prompt() which emits prompting:true)
      expect(events.indexOf('prompting:true')).toBeLessThan(events.indexOf('prompt_complete'));
    });
  });
});
