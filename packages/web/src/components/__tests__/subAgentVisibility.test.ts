// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getCrewMembers, isCrewDescendant } from '@flightdeck/shared';

// ── Mock stores & utils (must be before module import) ──────────

const mockStore = {
  selectedLeadId: 'lead-1',
  projects: { 'lead-1': {} },
  addDecision: vi.fn(),
  addActivity: vi.fn(),
  addComm: vi.fn(),
  addAgentReport: vi.fn(),
  setProgressSummary: vi.fn(),
  addProgressSnapshot: vi.fn(),
  setGroups: vi.fn(),
  addGroupMessage: vi.fn(),
  setDagStatus: vi.fn(),
};

vi.mock('../../stores/leadStore', () => ({
  useLeadStore: { getState: () => mockStore },
}));

const mockMessageStore = {
  appendToLastAgentMessage: vi.fn(),
  appendToThinkingMessage: vi.fn(),
  addMessage: vi.fn(),
  promoteQueuedMessages: vi.fn(),
  ensureChannel: vi.fn(),
};

vi.mock('../../stores/messageStore', () => ({
  useMessageStore: { getState: () => mockMessageStore },
}));

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
}));

import { useLeadWebSocket } from '../LeadDashboard/useLeadWebSocket';
import type { AgentInfo } from '../../types';

// ── Helpers ─────────────────────────────────────────────────────

function emitWsMessage(data: Record<string, unknown>) {
  const event = new MessageEvent('ws-message', { data: JSON.stringify(data) });
  window.dispatchEvent(event);
}

// ── Shared hierarchy (reused across all tests) ──────────────────
//
//  lead-1 (lead, running)
//  ├── dev-1 (developer, running, parentId: lead-1)
//  ├── sub-lead-1 (lead, running, parentId: lead-1)
//  │   ├── reviewer-1 (code-reviewer, idle, parentId: sub-lead-1)   ← depth 2
//  │   └── writer-1 (tech-writer, running, parentId: sub-lead-1)    ← depth 2
//  └── arch-1 (architect, idle, parentId: lead-1)
//      └── deep-dev-1 (developer, running, parentId: arch-1)         ← depth 2

const allAgents: AgentInfo[] = [
  { id: 'lead-1', status: 'running', role: { id: 'lead', name: 'Lead' }, childIds: [] } as AgentInfo,
  { id: 'dev-1', status: 'running', parentId: 'lead-1', role: { id: 'developer', name: 'Developer' }, childIds: [] } as AgentInfo,
  { id: 'sub-lead-1', status: 'running', parentId: 'lead-1', role: { id: 'lead', name: 'Lead' }, childIds: [] } as AgentInfo,
  { id: 'reviewer-1', status: 'idle', parentId: 'sub-lead-1', role: { id: 'code-reviewer', name: 'Code Reviewer' }, childIds: [] } as AgentInfo,
  { id: 'writer-1', status: 'running', parentId: 'sub-lead-1', role: { id: 'tech-writer', name: 'Tech Writer' }, childIds: [] } as AgentInfo,
  { id: 'arch-1', status: 'idle', parentId: 'lead-1', role: { id: 'architect', name: 'Architect' }, childIds: [] } as AgentInfo,
  { id: 'deep-dev-1', status: 'running', parentId: 'arch-1', role: { id: 'developer', name: 'Developer' }, childIds: [] } as AgentInfo,
];

// ── Tests ────────────────────────────────────────────────────────

describe('Sub-agent visibility (depth-2+ agents)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.selectedLeadId = 'lead-1';
    mockStore.projects = { 'lead-1': {} };
  });

  /* ================================================================
   *  useLeadWebSocket — tool_call events for depth-2 agents
   * ================================================================ */

  describe('useLeadWebSocket — tool_call with depth-2 agents', () => {
    it('accepts tool_call from depth-2 agent (reviewer-1 under sub-lead-1)', () => {
      renderHook(() => useLeadWebSocket(allAgents, 'proj-1'));
      emitWsMessage({
        type: 'agent:tool_call',
        agentId: 'reviewer-1',
        toolCall: { toolCallId: 'tc-depth2', title: 'Reviewing code' },
      });
      expect(mockStore.addActivity).toHaveBeenCalledWith(
        'lead-1',
        expect.objectContaining({ agentId: 'reviewer-1', summary: 'Reviewing code' }),
      );
    });

    it('accepts tool_call from depth-2 agent (deep-dev-1 under arch-1)', () => {
      renderHook(() => useLeadWebSocket(allAgents, 'proj-1'));
      emitWsMessage({
        type: 'agent:tool_call',
        agentId: 'deep-dev-1',
        toolCall: { toolCallId: 'tc-deep', kind: 'bash' },
      });
      expect(mockStore.addActivity).toHaveBeenCalledWith(
        'lead-1',
        expect.objectContaining({ agentId: 'deep-dev-1', summary: 'bash' }),
      );
    });

    it('still rejects tool_call from agents outside the crew', () => {
      renderHook(() => useLeadWebSocket(allAgents, 'proj-1'));
      emitWsMessage({
        type: 'agent:tool_call',
        agentId: 'totally-unrelated',
        toolCall: { toolCallId: 'tc-nope', title: 'ignored' },
      });
      expect(mockStore.addActivity).not.toHaveBeenCalled();
    });
  });

  /* ================================================================
   *  useLeadWebSocket — message_sent events for depth-2 agents
   * ================================================================ */

  describe('useLeadWebSocket — message_sent with depth-2 agents', () => {
    it('accepts message between two depth-2 agents (reviewer-1 → writer-1)', () => {
      renderHook(() => useLeadWebSocket(allAgents, 'proj-1'));
      emitWsMessage({
        type: 'agent:message_sent',
        from: 'reviewer-1',
        to: 'writer-1',
        fromRole: 'Code Reviewer',
        toRole: 'Tech Writer',
        content: 'Please update the docs',
      });
      expect(mockStore.addComm).toHaveBeenCalledWith(
        'lead-1',
        expect.objectContaining({ fromId: 'reviewer-1', toId: 'writer-1', type: 'message' }),
      );
    });

    it('accepts message from depth-2 agent to lead (deep-dev-1 → lead-1)', () => {
      renderHook(() => useLeadWebSocket(allAgents, 'proj-1'));
      emitWsMessage({
        type: 'agent:message_sent',
        from: 'deep-dev-1',
        to: 'lead-1',
        fromRole: 'Developer',
        content: 'Build complete',
      });
      expect(mockStore.addAgentReport).toHaveBeenCalledWith(
        'lead-1',
        expect.objectContaining({ fromId: 'deep-dev-1', content: 'Build complete' }),
      );
    });

    it('rejects message between agents outside the crew', () => {
      renderHook(() => useLeadWebSocket(allAgents, 'proj-1'));
      emitWsMessage({
        type: 'agent:message_sent',
        from: 'external-1',
        to: 'external-2',
        content: 'private',
      });
      expect(mockStore.addComm).not.toHaveBeenCalled();
    });
  });

  /* ================================================================
   *  getCrewMembers — FleetOverview / LeadDashboard filtering
   * ================================================================ */

  describe('getCrewMembers for FleetOverview filtering', () => {
    it('returns all 7 agents including depth-2 members', () => {
      const members = getCrewMembers('lead-1', allAgents);
      expect(members).toHaveLength(7);
      const ids = members.map((a) => a.id).sort();
      expect(ids).toEqual([
        'arch-1', 'deep-dev-1', 'dev-1', 'lead-1', 'reviewer-1', 'sub-lead-1', 'writer-1',
      ]);
    });

    it('includes the lead itself as the first member', () => {
      const members = getCrewMembers('lead-1', allAgents);
      expect(members[0].id).toBe('lead-1');
    });
  });

  describe('getCrewMembers for LeadDashboard teamAgents', () => {
    it('returns depth-2 agents under sub-lead-1', () => {
      const members = getCrewMembers('lead-1', allAgents);
      const memberIds = new Set(members.map((a) => a.id));
      expect(memberIds.has('reviewer-1')).toBe(true);
      expect(memberIds.has('writer-1')).toBe(true);
    });

    it('returns depth-2 agent under arch-1', () => {
      const members = getCrewMembers('lead-1', allAgents);
      const memberIds = new Set(members.map((a) => a.id));
      expect(memberIds.has('deep-dev-1')).toBe(true);
    });

    it('scoping to sub-lead-1 returns only its subtree', () => {
      const subMembers = getCrewMembers('sub-lead-1', allAgents);
      const ids = subMembers.map((a) => a.id).sort();
      expect(ids).toEqual(['reviewer-1', 'sub-lead-1', 'writer-1']);
    });
  });

  /* ================================================================
   *  isCrewDescendant — edge cases
   * ================================================================ */

  describe('isCrewDescendant edge cases', () => {
    it('returns true for depth-2 agent (reviewer-1 under lead-1)', () => {
      expect(isCrewDescendant('reviewer-1', 'lead-1', allAgents)).toBe(true);
    });

    it('returns true for depth-2 agent via different intermediate (deep-dev-1)', () => {
      expect(isCrewDescendant('deep-dev-1', 'lead-1', allAgents)).toBe(true);
    });

    it('returns true for depth-3 agent', () => {
      const depth3Agents: AgentInfo[] = [
        ...allAgents,
        { id: 'depth-3-agent', status: 'running', parentId: 'deep-dev-1', role: { id: 'developer', name: 'Developer' }, childIds: [] } as AgentInfo,
      ];
      expect(isCrewDescendant('depth-3-agent', 'lead-1', depth3Agents)).toBe(true);
    });

    it('returns false for agent from a different crew', () => {
      const otherCrewAgents: AgentInfo[] = [
        ...allAgents,
        { id: 'other-lead', status: 'running', role: { id: 'lead', name: 'Lead' }, childIds: [] } as AgentInfo,
        { id: 'other-dev', status: 'running', parentId: 'other-lead', role: { id: 'developer', name: 'Developer' }, childIds: [] } as AgentInfo,
      ];
      expect(isCrewDescendant('other-dev', 'lead-1', otherCrewAgents)).toBe(false);
    });

    it('returns false for the lead itself', () => {
      expect(isCrewDescendant('lead-1', 'lead-1', allAgents)).toBe(false);
    });
  });
});
