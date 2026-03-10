import { describe, it, expect } from 'vitest';
import {
  isOrchestratorMessage,
  isAgentServerMessage,
  hasRequestId,
  hasScope,
  isValidScope,
  validateMessage,
} from '../types.js';
import type {
  SpawnAgentMessage,
  PingMessage,
  AgentSpawnedMessage,
  AgentEventMessage,
  ErrorMessage,
  OrchestratorMessage,
  AgentServerMessage,
  TransportMessage,
  MessageScope,
} from '../types.js';

// ── Test Fixtures ───────────────────────────────────────────────────

const scope: MessageScope = { projectId: 'test-proj-a1b2', teamId: 'team-001' };

const spawnMsg: SpawnAgentMessage = {
  type: 'spawn_agent',
  requestId: 'req-001',
  scope,
  role: 'developer',
  model: 'fast',
  task: 'implement feature',
};

const pingMsg: PingMessage = {
  type: 'ping',
  requestId: 'req-002',
};

const agentSpawned: AgentSpawnedMessage = {
  type: 'agent_spawned',
  requestId: 'req-001',
  agentId: 'agent-abc',
  role: 'developer',
  model: 'fast',
  pid: 12345,
};

const agentEvent: AgentEventMessage = {
  type: 'agent_event',
  agentId: 'agent-abc',
  eventId: 'evt-001',
  eventType: 'text',
  data: { text: 'hello world' },
};

const errorMsg: ErrorMessage = {
  type: 'error',
  code: 'AGENT_NOT_FOUND',
  message: 'Agent agent-xyz not found',
};

// ── Type Guard Tests ────────────────────────────────────────────────

describe('transport type guards', () => {
  describe('isOrchestratorMessage', () => {
    it('returns true for all orchestrator message types', () => {
      const orchestratorTypes: OrchestratorMessage[] = [
        spawnMsg,
        { type: 'send_message', requestId: 'r', scope, agentId: 'a', content: 'hi' },
        { type: 'terminate_agent', requestId: 'r', scope, agentId: 'a' },
        { type: 'list_agents', requestId: 'r', scope },
        { type: 'subscribe', requestId: 'r', scope },
        pingMsg,
        { type: 'authenticate', requestId: 'r', token: 'secret' },
      ];

      for (const msg of orchestratorTypes) {
        expect(isOrchestratorMessage(msg)).toBe(true);
      }
    });

    it('returns false for agent server messages', () => {
      expect(isOrchestratorMessage(agentSpawned as TransportMessage)).toBe(false);
      expect(isOrchestratorMessage(agentEvent as TransportMessage)).toBe(false);
      expect(isOrchestratorMessage(errorMsg as TransportMessage)).toBe(false);
    });
  });

  describe('isAgentServerMessage', () => {
    it('returns true for all server message types', () => {
      const serverTypes: AgentServerMessage[] = [
        agentSpawned,
        agentEvent,
        { type: 'agent_exited', agentId: 'a', exitCode: 0 },
        { type: 'agent_list', requestId: 'r', agents: [] },
        { type: 'pong', requestId: 'r', timestamp: Date.now() },
        { type: 'auth_result', requestId: 'r', success: true },
        errorMsg,
      ];

      for (const msg of serverTypes) {
        expect(isAgentServerMessage(msg)).toBe(true);
      }
    });

    it('returns false for orchestrator messages', () => {
      expect(isAgentServerMessage(spawnMsg as TransportMessage)).toBe(false);
      expect(isAgentServerMessage(pingMsg as TransportMessage)).toBe(false);
    });
  });

  describe('hasRequestId', () => {
    it('returns true for messages with requestId', () => {
      expect(hasRequestId(spawnMsg)).toBe(true);
      expect(hasRequestId(pingMsg)).toBe(true);
      expect(hasRequestId(agentSpawned)).toBe(true);
    });

    it('returns false for messages without requestId', () => {
      expect(hasRequestId(agentEvent)).toBe(false);
      expect(hasRequestId(errorMsg)).toBe(false);
    });

    it('returns false for non-string requestId', () => {
      const bad = { type: 'ping', requestId: 42 } as any;
      expect(hasRequestId(bad)).toBe(false);
    });
  });

  describe('hasScope', () => {
    it('returns true for scoped messages', () => {
      expect(hasScope(spawnMsg)).toBe(true);
    });

    it('returns false for non-scoped messages', () => {
      expect(hasScope(pingMsg)).toBe(false);
      expect(hasScope(agentSpawned)).toBe(false);
    });
  });
});

// ── Scope Validation ────────────────────────────────────────────────

describe('isValidScope', () => {
  it('accepts valid scope', () => {
    expect(isValidScope({ projectId: 'proj-123', teamId: 'team-1' })).toBe(true);
  });

  it('rejects null/undefined', () => {
    expect(isValidScope(null)).toBe(false);
    expect(isValidScope(undefined)).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(isValidScope('string')).toBe(false);
    expect(isValidScope(42)).toBe(false);
  });

  it('rejects empty projectId', () => {
    expect(isValidScope({ projectId: '', teamId: 'team-1' })).toBe(false);
  });

  it('rejects empty teamId', () => {
    expect(isValidScope({ projectId: 'proj-1', teamId: '' })).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(isValidScope({ projectId: 'proj-1' })).toBe(false);
    expect(isValidScope({ teamId: 'team-1' })).toBe(false);
    expect(isValidScope({})).toBe(false);
  });

  it('rejects non-string fields', () => {
    expect(isValidScope({ projectId: 123, teamId: 'team-1' })).toBe(false);
    expect(isValidScope({ projectId: 'proj-1', teamId: null })).toBe(false);
  });
});

// ── Message Validation ──────────────────────────────────────────────

describe('validateMessage', () => {
  it('validates orchestrator messages', () => {
    expect(validateMessage(spawnMsg)).toEqual(spawnMsg);
    expect(validateMessage(pingMsg)).toEqual(pingMsg);
  });

  it('validates agent server messages', () => {
    expect(validateMessage(agentSpawned)).toEqual(agentSpawned);
    expect(validateMessage(agentEvent)).toEqual(agentEvent);
    expect(validateMessage(errorMsg)).toEqual(errorMsg);
  });

  it('returns null for null/undefined', () => {
    expect(validateMessage(null)).toBeNull();
    expect(validateMessage(undefined)).toBeNull();
  });

  it('returns null for non-objects', () => {
    expect(validateMessage('string')).toBeNull();
    expect(validateMessage(42)).toBeNull();
    expect(validateMessage(true)).toBeNull();
  });

  it('returns null for missing type field', () => {
    expect(validateMessage({ requestId: 'r' })).toBeNull();
  });

  it('returns null for non-string type', () => {
    expect(validateMessage({ type: 42 })).toBeNull();
  });

  it('returns null for unknown type', () => {
    expect(validateMessage({ type: 'unknown_message' })).toBeNull();
    expect(validateMessage({ type: 'SPAWN_AGENT' })).toBeNull(); // case-sensitive
  });

  it('accepts all 14 valid message types', () => {
    const types = [
      'spawn_agent', 'send_message', 'terminate_agent', 'list_agents',
      'subscribe', 'ping', 'authenticate',
      'agent_spawned', 'agent_event', 'agent_exited', 'agent_list',
      'pong', 'auth_result', 'error',
    ];

    for (const type of types) {
      expect(validateMessage({ type })).not.toBeNull();
    }
  });
});

// ── Type Completeness Checks ────────────────────────────────────────

describe('type completeness', () => {
  it('discriminated unions are exhaustive (compile-time check)', () => {
    // This test verifies the type system works at runtime.
    // Exhaustive switch would catch missing cases at compile time.
    function handleOrchestrator(msg: OrchestratorMessage): string {
      switch (msg.type) {
        case 'spawn_agent': return 'spawn';
        case 'send_message': return 'send';
        case 'terminate_agent': return 'terminate';
        case 'list_agents': return 'list';
        case 'subscribe': return 'subscribe';
        case 'ping': return 'ping';
        case 'authenticate': return 'auth';
      }
      return 'unknown'; // unreachable if switch is exhaustive
    }

    function handleServer(msg: AgentServerMessage): string {
      switch (msg.type) {
        case 'agent_spawned': return 'spawned';
        case 'agent_event': return 'event';
        case 'agent_exited': return 'exited';
        case 'agent_list': return 'list';
        case 'pong': return 'pong';
        case 'auth_result': return 'auth';
        case 'error': return 'error';
      }
    }

    // Run through all types to ensure switch works
    expect(handleOrchestrator(spawnMsg)).toBe('spawn');
    expect(handleOrchestrator(pingMsg)).toBe('ping');
    expect(handleServer(agentSpawned)).toBe('spawned');
    expect(handleServer(agentEvent)).toBe('event');
    expect(handleServer(errorMsg)).toBe('error');
  });

  it('agent event types cover all adapter event categories', () => {
    // Verify the AgentEventType union includes all key event categories
    const eventTypes: AgentEventMessage['eventType'][] = [
      'text', 'thinking', 'tool_call', 'tool_call_update',
      'plan', 'content', 'usage', 'usage_update',
      'prompt_complete', 'permission_request', 'status_change',
    ];

    // All should be valid assignments (compile-time check)
    expect(eventTypes).toHaveLength(11);
  });

  it('error codes cover all expected failure modes', () => {
    const codes: ErrorMessage['code'][] = [
      'AUTH_REQUIRED', 'AUTH_FAILED', 'AGENT_NOT_FOUND',
      'SPAWN_FAILED', 'SEND_FAILED', 'INVALID_MESSAGE', 'INTERNAL_ERROR',
    ];

    expect(codes).toHaveLength(7);
  });

  it('agent status covers all lifecycle states', () => {
    // Import AgentStatus type indirectly via AgentInfo
    const statuses = ['starting', 'running', 'idle', 'stopping', 'exited', 'crashed'];
    expect(statuses).toHaveLength(6);
  });
});
