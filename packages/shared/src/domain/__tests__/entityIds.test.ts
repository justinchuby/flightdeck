import { describe, it, expect } from 'vitest';
import {
  AgentId, ProjectId, SessionId, TaskId, MessageId, DelegationId, DecisionId,
  isValidId,
} from '../entityIds.js';

describe('entityIds', () => {
  describe('factory functions', () => {
    it('creates branded IDs that are still strings at runtime', () => {
      const agentId = AgentId('agent-abc');
      const projectId = ProjectId('proj-123');
      const sessionId = SessionId('sess-456');
      const taskId = TaskId('task-789');
      const messageId = MessageId('msg-000');
      const delegationId = DelegationId('del-111');
      const decisionId = DecisionId('dec-222');

      expect(typeof agentId).toBe('string');
      expect(typeof projectId).toBe('string');
      expect(typeof sessionId).toBe('string');
      expect(typeof taskId).toBe('string');
      expect(typeof messageId).toBe('string');
      expect(typeof delegationId).toBe('string');
      expect(typeof decisionId).toBe('string');
    });

    it('preserves the original string value', () => {
      expect(AgentId('abc-123')).toBe('abc-123');
      expect(ProjectId('proj-456')).toBe('proj-456');
      expect(SessionId('')).toBe('');
      expect(TaskId('task-with-dashes-and-123')).toBe('task-with-dashes-and-123');
    });

    it('supports all standard string operations', () => {
      const id = AgentId('agent-abc');
      expect(id.startsWith('agent-')).toBe(true);
      expect(id.length).toBe(9);
      expect(id.toUpperCase()).toBe('AGENT-ABC');
      expect(`prefix-${id}`).toBe('prefix-agent-abc');
    });

    it('supports equality comparisons', () => {
      const a = AgentId('same-id');
      const b = AgentId('same-id');
      expect(a).toBe(b);
      expect(a === b).toBe(true);
    });

    it('supports use as Map keys', () => {
      const map = new Map<string, number>();
      const id = AgentId('agent-1');
      map.set(id, 42);
      expect(map.get(id)).toBe(42);
      expect(map.get('agent-1')).toBe(42);
    });

    it('supports JSON serialization', () => {
      const id = AgentId('agent-abc');
      expect(JSON.stringify(id)).toBe('"agent-abc"');
      expect(JSON.stringify({ agentId: id })).toBe('{"agentId":"agent-abc"}');
    });
  });

  describe('isValidId', () => {
    it('returns true for non-empty strings', () => {
      expect(isValidId('abc')).toBe(true);
      expect(isValidId('a')).toBe(true);
      expect(isValidId('123-456-789')).toBe(true);
    });

    it('returns false for empty strings', () => {
      expect(isValidId('')).toBe(false);
    });

    it('returns false for non-string values', () => {
      expect(isValidId(null)).toBe(false);
      expect(isValidId(undefined)).toBe(false);
      expect(isValidId(42)).toBe(false);
      expect(isValidId({})).toBe(false);
      expect(isValidId([])).toBe(false);
      expect(isValidId(true)).toBe(false);
    });
  });

  describe('type safety (compile-time checks)', () => {
    // These tests verify runtime behavior that mirrors the type system.
    // The real value of branded types is at compile time — if you try
    // to pass an AgentId where a ProjectId is expected, TypeScript errors.

    it('different branded IDs with same value are equal at runtime', () => {
      const agentId = AgentId('same-value');
      const projectId = ProjectId('same-value');
      // At runtime they're identical strings
      expect(agentId === (projectId as unknown as string)).toBe(true);
      // But TypeScript would prevent: fn(agentId) where fn expects ProjectId
    });
  });
});
