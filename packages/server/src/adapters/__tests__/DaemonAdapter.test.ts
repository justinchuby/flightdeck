import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { DaemonAdapter } from '../DaemonAdapter.js';
import type { DaemonAdapterOptions } from '../DaemonAdapter.js';
import type { DaemonEvent, SpawnResult, ListResult, SubscribeResult } from '../../daemon/DaemonProtocol.js';

// ── Mock DaemonClient ───────────────────────────────────────────────

class MockDaemonClient extends EventEmitter {
  isConnected = true;
  spawnAgent = vi.fn<any>();
  terminateAgent = vi.fn<any>();
  sendMessage = vi.fn<any>();
  listAgents = vi.fn<any>();
  subscribe = vi.fn<any>();
}

function createAdapter(overrides?: Partial<DaemonAdapterOptions>) {
  const client = new MockDaemonClient();
  const adapter = new DaemonAdapter({
    client: client as any,
    agentId: 'test-agent-001',
    role: 'developer',
    ...overrides,
    ...(overrides?.client ? {} : { client: client as any }),
  });
  return { adapter, client };
}

function makeEvent(type: string, data: Record<string, unknown> = {}, agentId = 'test-agent-001'): DaemonEvent {
  return {
    eventId: `evt-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: type as DaemonEvent['type'],
    agentId,
    data,
  };
}

const START_OPTS = {
  cliCommand: 'copilot',
  baseArgs: ['--acp', '--stdio'],
  cliArgs: ['--agent=developer'],
  cwd: '/tmp/test',
  model: 'fast',
};

describe('DaemonAdapter', () => {
  let adapter: DaemonAdapter;
  let client: MockDaemonClient;

  beforeEach(() => {
    ({ adapter, client } = createAdapter());
    client.spawnAgent.mockResolvedValue({ agentId: 'test-agent-001', pid: 12345 } satisfies SpawnResult);
    client.terminateAgent.mockResolvedValue({ terminated: true });
    client.sendMessage.mockResolvedValue({ sent: true });
  });

  afterEach(() => {
    adapter.dispose();
  });

  // ── Constructor & Properties ────────────────────────────────────

  describe('constructor', () => {
    it('sets type to daemon', () => {
      expect(adapter.type).toBe('daemon');
    });

    it('starts disconnected', () => {
      expect(adapter.isConnected).toBe(false);
      expect(adapter.isPrompting).toBe(false);
      expect(adapter.promptingStartedAt).toBeNull();
      expect(adapter.currentSessionId).toBeNull();
      expect(adapter.agentPid).toBeNull();
    });

    it('reports supportsImages as false', () => {
      expect(adapter.supportsImages).toBe(false);
    });

    it('accepts custom role', () => {
      const { adapter: a, client: c } = createAdapter({ role: 'reviewer' });
      c.terminateAgent.mockResolvedValue({ terminated: true });
      // Role is internal, but we can verify via spawn params
      a.dispose();
    });
  });

  // ── start() ────────────────────────────────────────────────────

  describe('start', () => {
    it('spawns an agent via daemon client', async () => {
      const sessionId = await adapter.start(START_OPTS);

      expect(client.spawnAgent).toHaveBeenCalledOnce();
      expect(client.spawnAgent).toHaveBeenCalledWith({
        agentId: 'test-agent-001',
        role: 'developer',
        model: 'fast',
        cliCommand: 'copilot',
        cliArgs: ['--acp', '--stdio', '--agent=developer'],
        cwd: '/tmp/test',
        env: undefined,
        sessionId: undefined,
      });
      expect(sessionId).toContain('test-agent-001');
    });

    it('emits connected event', async () => {
      const connectedSpy = vi.fn();
      adapter.on('connected', connectedSpy);

      await adapter.start(START_OPTS);

      expect(connectedSpy).toHaveBeenCalledOnce();
    });

    it('sets isConnected to true after start', async () => {
      await adapter.start(START_OPTS);
      expect(adapter.isConnected).toBe(true);
      expect(adapter.agentPid).toBe(12345);
    });

    it('uses sessionId from options when provided', async () => {
      const sessionId = await adapter.start({ ...START_OPTS, sessionId: 'resume-123' });
      expect(sessionId).toBe('resume-123');
      expect(client.spawnAgent).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'resume-123' }),
      );
    });

    it('uses default model when not specified', async () => {
      await adapter.start({ cliCommand: 'copilot' });
      expect(client.spawnAgent).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'default' }),
      );
    });

    it('throws if already started', async () => {
      await adapter.start(START_OPTS);
      await expect(adapter.start(START_OPTS)).rejects.toThrow('already started');
    });

    it('throws if terminated', async () => {
      adapter.terminate();
      await expect(adapter.start(START_OPTS)).rejects.toThrow('terminated');
    });

    it('throws if daemon client not connected', async () => {
      client.isConnected = false;
      await expect(adapter.start(START_OPTS)).rejects.toThrow('not connected');
    });

    it('propagates spawn errors', async () => {
      client.spawnAgent.mockRejectedValue(new Error('Spawning paused'));
      await expect(adapter.start(START_OPTS)).rejects.toThrow('Spawning paused');
      expect(adapter.isConnected).toBe(false);
    });

    it('merges env from options', async () => {
      await adapter.start({ ...START_OPTS, env: { API_KEY: 'secret' } });
      expect(client.spawnAgent).toHaveBeenCalledWith(
        expect.objectContaining({ env: { API_KEY: 'secret' } }),
      );
    });
  });

  // ── prompt() ───────────────────────────────────────────────────

  describe('prompt', () => {
    beforeEach(async () => {
      await adapter.start(START_OPTS);
    });

    it('sends string message to daemon', async () => {
      const promptPromise = adapter.prompt('Hello agent');

      // Simulate prompt_complete via event
      setTimeout(() => {
        client.emit('event', makeEvent('agent:output', { type: 'text', text: 'Hello back' }));
        client.emit('event', makeEvent('agent:output', { type: 'prompt_complete', reason: 'end_turn' }));
      }, 10);

      const result = await promptPromise;
      expect(client.sendMessage).toHaveBeenCalledWith('test-agent-001', 'Hello agent');
      expect(result.stopReason).toBe('end_turn');
    });

    it('serializes ContentBlock array to JSON', async () => {
      const content = [{ type: 'text' as const, text: 'structured' }];
      const promptPromise = adapter.prompt(content);

      setTimeout(() => {
        client.emit('event', makeEvent('agent:output', { type: 'prompt_complete', reason: 'end_turn' }));
      }, 10);

      await promptPromise;
      expect(client.sendMessage).toHaveBeenCalledWith('test-agent-001', JSON.stringify(content));
    });

    it('emits prompting events', async () => {
      const promptingSpy = vi.fn();
      adapter.on('prompting', promptingSpy);

      const promptPromise = adapter.prompt('test');
      expect(adapter.isPrompting).toBe(true);
      expect(adapter.promptingStartedAt).not.toBeNull();

      setTimeout(() => {
        client.emit('event', makeEvent('agent:output', { type: 'prompt_complete', reason: 'end_turn' }));
      }, 10);

      await promptPromise;
      expect(adapter.isPrompting).toBe(false);
      expect(promptingSpy).toHaveBeenCalledWith(true);
      expect(promptingSpy).toHaveBeenCalledWith(false);
    });

    it('emits response_start on prompt', async () => {
      const startSpy = vi.fn();
      adapter.on('response_start', startSpy);

      const promptPromise = adapter.prompt('test');

      setTimeout(() => {
        client.emit('event', makeEvent('agent:output', { type: 'prompt_complete', reason: 'end_turn' }));
      }, 10);

      await promptPromise;
      expect(startSpy).toHaveBeenCalledOnce();
    });

    it('rejects if not connected', async () => {
      const { adapter: fresh, client: freshClient } = createAdapter();
      freshClient.terminateAgent.mockResolvedValue({ terminated: true });
      await expect(fresh.prompt('hello')).rejects.toThrow('not connected');
      fresh.dispose();
    });

    it('rejects if already prompting', async () => {
      const p1 = adapter.prompt('first');
      await expect(adapter.prompt('second')).rejects.toThrow('already prompting');

      // Cleanup
      client.emit('event', makeEvent('agent:output', { type: 'prompt_complete', reason: 'end_turn' }));
      await p1;
    });

    it('rejects if agent exits during prompt', async () => {
      const promptPromise = adapter.prompt('test');

      setTimeout(() => {
        client.emit('event', makeEvent('agent:exit', { exitCode: 1 }));
      }, 10);

      await expect(promptPromise).rejects.toThrow('exited with code 1');
    });

    it('rejects if sendMessage fails', async () => {
      client.sendMessage.mockRejectedValue(new Error('Agent not found'));
      await expect(adapter.prompt('test')).rejects.toThrow('Agent not found');
      expect(adapter.isPrompting).toBe(false);
    });
  });

  // ── cancel() ───────────────────────────────────────────────────

  describe('cancel', () => {
    it('sends Ctrl+C to agent via daemon', async () => {
      await adapter.start(START_OPTS);

      // Start a prompt
      const promptPromise = adapter.prompt('test');
      await adapter.cancel();

      expect(client.sendMessage).toHaveBeenCalledWith('test-agent-001', '\x03');
      expect(adapter.isPrompting).toBe(false);

      // The prompt will hang since we cancelled — clean up
      client.emit('event', makeEvent('agent:output', { type: 'prompt_complete', reason: 'end_turn' }));
      // Ignore rejection since we cancelled
      await promptPromise.catch(() => {});
    });

    it('is a no-op if not prompting', async () => {
      await adapter.cancel();
      expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('ignores errors from cancel message', async () => {
      await adapter.start(START_OPTS);
      adapter.prompt('test').catch(() => {}); // ignore — will never resolve in this test

      client.sendMessage.mockRejectedValueOnce(new Error('cancelled')).mockResolvedValue({ sent: true });
      await adapter.cancel(); // should not throw
    });
  });

  // ── terminate() ────────────────────────────────────────────────

  describe('terminate', () => {
    it('sends terminate to daemon', async () => {
      await adapter.start(START_OPTS);
      adapter.terminate();

      expect(client.terminateAgent).toHaveBeenCalledWith('test-agent-001', 15_000);
      expect(adapter.isConnected).toBe(false);
    });

    it('is idempotent', async () => {
      await adapter.start(START_OPTS);
      adapter.terminate();
      adapter.terminate();

      expect(client.terminateAgent).toHaveBeenCalledOnce();
    });

    it('cleans up daemon event listeners', async () => {
      await adapter.start(START_OPTS);
      adapter.terminate();

      // Events should no longer reach the adapter
      const textSpy = vi.fn();
      adapter.on('text', textSpy);
      client.emit('event', makeEvent('agent:output', { type: 'text', text: 'after terminate' }));
      expect(textSpy).not.toHaveBeenCalled();
    });

    it('handles terminate errors gracefully', async () => {
      await adapter.start(START_OPTS);
      client.terminateAgent.mockRejectedValue(new Error('timeout'));
      adapter.terminate(); // should not throw
    });

    it('uses custom terminate timeout', async () => {
      const { adapter: customAdapter, client: customClient } = createAdapter({ terminateTimeoutMs: 5000 });
      customClient.spawnAgent.mockResolvedValue({ agentId: 'test-agent-001', pid: 99 });
      customClient.terminateAgent.mockResolvedValue({ terminated: true });

      await customAdapter.start(START_OPTS);
      customAdapter.terminate();

      expect(customClient.terminateAgent).toHaveBeenCalledWith('test-agent-001', 5000);
      customAdapter.dispose();
    });
  });

  // ── resolvePermission() ────────────────────────────────────────

  describe('resolvePermission', () => {
    it('sends permission response to daemon', async () => {
      await adapter.start(START_OPTS);
      adapter.resolvePermission(true);

      expect(client.sendMessage).toHaveBeenCalledWith(
        'test-agent-001',
        JSON.stringify({ type: 'permission_response', approved: true }),
      );
    });

    it('sends rejection', async () => {
      await adapter.start(START_OPTS);
      adapter.resolvePermission(false);

      expect(client.sendMessage).toHaveBeenCalledWith(
        'test-agent-001',
        JSON.stringify({ type: 'permission_response', approved: false }),
      );
    });
  });

  // ── Event Mapping ──────────────────────────────────────────────

  describe('event mapping', () => {
    beforeEach(async () => {
      await adapter.start(START_OPTS);
    });

    it('maps agent:output text to text event', () => {
      const spy = vi.fn();
      adapter.on('text', spy);

      client.emit('event', makeEvent('agent:output', { type: 'text', text: 'hello world' }));
      expect(spy).toHaveBeenCalledWith('hello world');
    });

    it('maps agent:output thinking to thinking event', () => {
      const spy = vi.fn();
      adapter.on('thinking', spy);

      client.emit('event', makeEvent('agent:output', { type: 'thinking', text: 'analyzing...' }));
      expect(spy).toHaveBeenCalledWith('analyzing...');
    });

    it('maps agent:output tool_call to tool_call event', () => {
      const spy = vi.fn();
      adapter.on('tool_call', spy);

      const info = { toolCallId: 'tc-1', title: 'bash', kind: 'tool', status: 'running' };
      client.emit('event', makeEvent('agent:output', { type: 'tool_call', info }));
      expect(spy).toHaveBeenCalledWith(info);
    });

    it('maps agent:output tool_call_update to tool_call_update event', () => {
      const spy = vi.fn();
      adapter.on('tool_call_update', spy);

      const info = { toolCallId: 'tc-1', status: 'complete' };
      client.emit('event', makeEvent('agent:output', { type: 'tool_call_update', info }));
      expect(spy).toHaveBeenCalledWith(info);
    });

    it('maps agent:output plan to plan event', () => {
      const spy = vi.fn();
      adapter.on('plan', spy);

      const entries = [{ content: 'step 1', priority: 'high', status: 'pending' }];
      client.emit('event', makeEvent('agent:output', { type: 'plan', entries }));
      expect(spy).toHaveBeenCalledWith(entries);
    });

    it('maps agent:output content to content event', () => {
      const spy = vi.fn();
      adapter.on('content', spy);

      const block = { type: 'image', data: 'base64...', mimeType: 'image/png' };
      client.emit('event', makeEvent('agent:output', { type: 'content', block }));
      expect(spy).toHaveBeenCalledWith(block);
    });

    it('maps agent:output usage to usage event', () => {
      const spy = vi.fn();
      adapter.on('usage', spy);

      const usage = { inputTokens: 100, outputTokens: 50 };
      client.emit('event', makeEvent('agent:output', { type: 'usage', usage }));
      expect(spy).toHaveBeenCalledWith(usage);
    });

    it('maps agent:output usage_update to usage_update event', () => {
      const spy = vi.fn();
      adapter.on('usage_update', spy);

      const usage = { inputTokens: 200, outputTokens: 100 };
      client.emit('event', makeEvent('agent:output', { type: 'usage_update', usage }));
      expect(spy).toHaveBeenCalledWith(usage);
    });

    it('maps agent:output permission_request to permission_request event', () => {
      const spy = vi.fn();
      adapter.on('permission_request', spy);

      const request = { id: 'perm-1', toolName: 'bash', arguments: { cmd: 'rm' }, timestamp: 'now' };
      client.emit('event', makeEvent('agent:output', { type: 'permission_request', request }));
      expect(spy).toHaveBeenCalledWith(request);
    });

    it('maps agent:exit to exit event', () => {
      const spy = vi.fn();
      adapter.on('exit', spy);

      client.emit('event', makeEvent('agent:exit', { exitCode: 0 }));
      expect(spy).toHaveBeenCalledWith(0);
      expect(adapter.isConnected).toBe(false);
    });

    it('defaults to exit code 1 when exitCode not provided', () => {
      const spy = vi.fn();
      adapter.on('exit', spy);

      client.emit('event', makeEvent('agent:exit', {}));
      expect(spy).toHaveBeenCalledWith(1);
    });

    it('ignores events for other agents', () => {
      const spy = vi.fn();
      adapter.on('text', spy);

      client.emit('event', makeEvent('agent:output', { type: 'text', text: 'other' }, 'other-agent'));
      expect(spy).not.toHaveBeenCalled();
    });

    it('handles agent:status running', () => {
      adapter['_isConnected'] = false; // simulate disconnected
      client.emit('event', makeEvent('agent:status', { status: 'running' }));
      expect(adapter.isConnected).toBe(true);
      expect(adapter.lastDaemonStatus).toBe('running');
    });

    it('handles agent:status idle resets prompting', () => {
      adapter['_isPrompting'] = true;
      const spy = vi.fn();
      adapter.on('prompting', spy);

      client.emit('event', makeEvent('agent:status', { status: 'idle' }));
      expect(adapter.isPrompting).toBe(false);
      expect(spy).toHaveBeenCalledWith(false);
    });

    it('handles agent:status exited disconnects', () => {
      client.emit('event', makeEvent('agent:status', { status: 'exited' }));
      expect(adapter.isConnected).toBe(false);
      expect(adapter.lastDaemonStatus).toBe('exited');
    });

    it('handles agent:status crashed disconnects', () => {
      client.emit('event', makeEvent('agent:status', { status: 'crashed' }));
      expect(adapter.isConnected).toBe(false);
    });

    it('handles agent:spawned updates pid and sessionId', () => {
      client.emit('event', makeEvent('agent:spawned', { pid: 99999, sessionId: 'new-session' }));
      expect(adapter.agentPid).toBe(99999);
      expect(adapter.currentSessionId).toBe('new-session');
      expect(adapter.isConnected).toBe(true);
    });

    it('handles daemon:shutting_down emits exit', () => {
      const spy = vi.fn();
      adapter.on('exit', spy);

      client.emit('event', makeEvent('daemon:shutting_down', {}, undefined as any));
      expect(spy).toHaveBeenCalledWith(0);
      expect(adapter.isConnected).toBe(false);
    });
  });

  // ── Daemon Connection Events ───────────────────────────────────

  describe('daemon connection events', () => {
    it('emits daemon_error on disconnected', async () => {
      await adapter.start(START_OPTS);

      const spy = vi.fn();
      adapter.on('daemon_error', spy);

      client.emit('disconnected', { reason: 'socket closed' });
      expect(spy).toHaveBeenCalledWith({ reason: 'socket closed' });
    });

    it('emits daemon_error on daemon-lost', async () => {
      await adapter.start(START_OPTS);

      const spy = vi.fn();
      adapter.on('daemon_error', spy);

      client.emit('daemon-lost', { missedHeartbeats: 3 });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: expect.stringContaining('heartbeat') }),
      );
    });
  });

  // ── reconnect() ────────────────────────────────────────────────

  describe('reconnect', () => {
    it('recovers state from daemon', async () => {
      client.listAgents.mockResolvedValue({
        agents: [{
          agentId: 'test-agent-001',
          pid: 54321,
          role: 'developer',
          model: 'fast',
          status: 'running',
          sessionId: 'existing-session',
          taskSummary: null,
          spawnedAt: '2026-01-01',
          lastEventId: 'evt-100',
        }],
      } satisfies ListResult);
      client.subscribe.mockResolvedValue({ bufferedEvents: [] } satisfies SubscribeResult);

      const connectedSpy = vi.fn();
      adapter.on('connected', connectedSpy);

      await adapter.reconnect('evt-99');

      expect(adapter.isConnected).toBe(true);
      expect(adapter.agentPid).toBe(54321);
      expect(adapter.currentSessionId).toBe('existing-session');
      expect(connectedSpy).toHaveBeenCalledOnce();
      expect(client.subscribe).toHaveBeenCalledWith({
        agentId: 'test-agent-001',
        lastSeenEventId: 'evt-99',
      });
    });

    it('replays buffered events', async () => {
      client.listAgents.mockResolvedValue({
        agents: [{
          agentId: 'test-agent-001',
          pid: 54321,
          role: 'developer',
          model: 'fast',
          status: 'running',
          sessionId: 'existing',
          taskSummary: null,
          spawnedAt: '2026-01-01',
          lastEventId: 'evt-102',
        }],
      });
      client.subscribe.mockResolvedValue({
        bufferedEvents: [
          makeEvent('agent:output', { type: 'text', text: 'buffered text' }),
          makeEvent('agent:output', { type: 'text', text: 'more text' }),
        ],
      });

      const textSpy = vi.fn();
      adapter.on('text', textSpy);

      await adapter.reconnect();

      expect(textSpy).toHaveBeenCalledTimes(2);
      expect(textSpy).toHaveBeenCalledWith('buffered text');
      expect(textSpy).toHaveBeenCalledWith('more text');
    });

    it('throws if agent not found in daemon', async () => {
      client.listAgents.mockResolvedValue({ agents: [] });
      await expect(adapter.reconnect()).rejects.toThrow('not found in daemon');
    });

    it('throws if daemon client not connected', async () => {
      client.isConnected = false;
      await expect(adapter.reconnect()).rejects.toThrow('not connected');
    });

    it('does not emit connected for exited agent', async () => {
      client.listAgents.mockResolvedValue({
        agents: [{
          agentId: 'test-agent-001',
          pid: null,
          role: 'developer',
          model: 'fast',
          status: 'exited',
          sessionId: null,
          taskSummary: null,
          spawnedAt: '2026-01-01',
          lastEventId: null,
        }],
      });
      client.subscribe.mockResolvedValue({ bufferedEvents: [] });

      const connectedSpy = vi.fn();
      adapter.on('connected', connectedSpy);

      await adapter.reconnect();

      expect(adapter.isConnected).toBe(false);
      expect(connectedSpy).not.toHaveBeenCalled();
    });
  });

  // ── dispose() ──────────────────────────────────────────────────

  describe('dispose', () => {
    it('terminates and removes all listeners', async () => {
      await adapter.start(START_OPTS);

      adapter.dispose();

      expect(client.terminateAgent).toHaveBeenCalled();
      expect(adapter.listenerCount('text')).toBe(0);
    });

    it('is safe to call multiple times', () => {
      adapter.dispose();
      adapter.dispose(); // should not throw
    });

    it('cleans up without terminate if already terminated', async () => {
      await adapter.start(START_OPTS);
      adapter.terminate();
      client.terminateAgent.mockClear();

      adapter.dispose();
      expect(client.terminateAgent).not.toHaveBeenCalled();
    });
  });
});
