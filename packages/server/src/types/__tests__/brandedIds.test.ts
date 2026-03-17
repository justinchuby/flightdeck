import { describe, it, expect } from 'vitest';
import {
  asAgentId, asProjectId, asSessionId, asTaskId,
  asMessageId, asDelegationId, asDecisionId,
} from '../brandedIds.js';
import type {
  AgentId, ProjectId,
} from '../brandedIds.js';

describe('brandedIds', () => {
  it('factory functions return the same string at runtime', () => {
    expect(asAgentId('agent-1')).toBe('agent-1');
    expect(asProjectId('proj-2')).toBe('proj-2');
    expect(asSessionId('sess-3')).toBe('sess-3');
    expect(asTaskId('task-4')).toBe('task-4');
    expect(asMessageId('msg-5')).toBe('msg-5');
    expect(asDelegationId('del-6')).toBe('del-6');
    expect(asDecisionId('dec-7')).toBe('dec-7');
  });

  it('branded IDs are usable as string keys', () => {
    const map = new Map<AgentId, string>();
    const id = asAgentId('agent-abc');
    map.set(id, 'value');
    expect(map.get(id)).toBe('value');
  });

  it('branded IDs support string operations', () => {
    const id = asAgentId('agent-abc');
    expect(id.startsWith('agent-')).toBe(true);
    expect(id.length).toBe(9);
  });

  it('different branded types with same value are equal at runtime', () => {
    const agentId = asAgentId('same');
    const projectId = asProjectId('same');
    // Runtime equality (strings are the same)
    expect(agentId as string).toBe(projectId as string);
    // TypeScript prevents: fn(agentId) where fn expects ProjectId
  });

  it('compile-time type safety prevents misuse', () => {
    // This test documents the intent — the actual safety is at compile time.
    // If you try:
    //   const agentId: AgentId = asProjectId('x');
    // TypeScript will error because ProjectId is not assignable to AgentId.
    const agentId: AgentId = asAgentId('abc');
    const projectId: ProjectId = asProjectId('abc');
    expect(typeof agentId).toBe('string');
    expect(typeof projectId).toBe('string');
  });
});
