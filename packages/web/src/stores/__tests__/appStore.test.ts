// packages/web/src/stores/__tests__/appStore.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';
import type { AgentInfo, Decision, Role, ServerConfig } from '../../types';

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    role: { id: 'developer', name: 'Developer', systemPrompt: '' },
    status: 'running',
    model: 'gpt-4',
    provider: 'copilot',
    backend: 'acp',
    inputTokens: 0,
    outputTokens: 0,
    contextWindowSize: 200000,
    contextWindowUsed: 0,
    contextBurnRate: 0,
    estimatedExhaustionMinutes: null,
    pendingMessages: 0,
    createdAt: new Date().toISOString(),
    childIds: [],
    toolCalls: [],
    messages: [],
    isSubLead: false,
    hierarchyLevel: 0,
    ...overrides,
  } as AgentInfo;
}

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-1',
    agentId: 'agent-1',
    agentRole: 'Developer',
    leadId: 'lead-1',
    projectId: null,
    title: 'Use tabs',
    rationale: 'Consistency',
    needsConfirmation: true,
    status: 'recorded',
    autoApproved: false,
    confirmedAt: null,
    timestamp: new Date().toISOString(),
    category: 'style',
    ...overrides,
  };
}

function resetStore() {
  useAppStore.setState({
    agents: [],
    roles: [],
    config: null,
    selectedAgentId: null,
    connected: false,
    loading: true,
    systemPaused: false,
    pendingDecisions: [],
    approvalQueueOpen: false,
  });
}

describe('appStore', () => {
  beforeEach(resetStore);

  // ── Agents ─────────────────────────────────────────────────

  describe('setAgents', () => {
    it('replaces all agents', () => {
      useAppStore.getState().setAgents([makeAgent({ id: 'a1' }), makeAgent({ id: 'a2' })]);
      expect(useAppStore.getState().agents).toHaveLength(2);
    });

    it('preserves messages from existing agents across init replacement', () => {
      const msgs = [
        { type: 'text' as const, text: 'thinking...', sender: 'thinking' as const, timestamp: 1000 },
        { type: 'text' as const, text: 'hello', sender: 'agent' as const, timestamp: 2000 },
      ];
      useAppStore.getState().addAgent(makeAgent({ id: 'a1', messages: msgs }));
      // Simulate WS init with toJSON()-style agents (no messages)
      useAppStore.getState().setAgents([makeAgent({ id: 'a1', status: 'idle', messages: undefined })]);
      const agent = useAppStore.getState().agents.find((a) => a.id === 'a1')!;
      expect(agent.status).toBe('idle');
      expect(agent.messages).toHaveLength(2);
      expect(agent.messages![0].sender).toBe('thinking');
    });

    it('does not carry messages to agents with different ids', () => {
      useAppStore.getState().addAgent(makeAgent({ id: 'a1', messages: [{ type: 'text', text: 'hi', sender: 'agent', timestamp: 1 }] }));
      useAppStore.getState().setAgents([makeAgent({ id: 'a2', messages: undefined })]);
      const agent = useAppStore.getState().agents.find((a) => a.id === 'a2')!;
      expect(agent.messages).toBeUndefined();
    });
  });

  describe('addAgent', () => {
    it('adds a new agent', () => {
      useAppStore.getState().addAgent(makeAgent({ id: 'a1' }));
      expect(useAppStore.getState().agents).toHaveLength(1);
    });

    it('replaces existing agent with same id', () => {
      useAppStore.getState().addAgent(makeAgent({ id: 'a1', status: 'running' }));
      useAppStore.getState().addAgent(makeAgent({ id: 'a1', status: 'terminated' }));
      expect(useAppStore.getState().agents).toHaveLength(1);
      expect(useAppStore.getState().agents[0].status).toBe('terminated');
    });

    it('preserves messages when replacing an existing agent', () => {
      const thinkingMsg = { type: 'text' as const, text: 'pondering...', sender: 'thinking' as const, timestamp: 1000 };
      useAppStore.getState().addAgent(makeAgent({ id: 'a1', messages: [thinkingMsg] }));
      // Simulate agent:spawned with toJSON()-style data (no messages)
      useAppStore.getState().addAgent(makeAgent({ id: 'a1', status: 'idle', messages: undefined }));
      const agent = useAppStore.getState().agents.find((a) => a.id === 'a1')!;
      expect(agent.status).toBe('idle');
      expect(agent.messages).toHaveLength(1);
      expect(agent.messages![0].sender).toBe('thinking');
    });

    it('preserves plan when replacing an existing agent', () => {
      const plan = [{ id: '1', title: 'task', status: 'in_progress' as const, priority: 'high' as const }];
      useAppStore.getState().addAgent(makeAgent({ id: 'a1', plan }));
      useAppStore.getState().addAgent(makeAgent({ id: 'a1', plan: undefined }));
      const agent = useAppStore.getState().agents.find((a) => a.id === 'a1')!;
      expect(agent.plan).toHaveLength(1);
    });
  });

  describe('updateAgent', () => {
    it('preserves provider when status changes to terminated', () => {
      const agent = makeAgent({ id: 'a1', provider: 'copilot' });
      useAppStore.getState().addAgent(agent);
      useAppStore.getState().updateAgent('a1', { status: 'terminated' });
      const updated = useAppStore.getState().agents.find((a) => a.id === 'a1');
      expect(updated!.status).toBe('terminated');
      expect(updated!.provider).toBe('copilot');
    });

    it('preserves all fields on partial update', () => {
      useAppStore.getState().addAgent(makeAgent({ id: 'a1', provider: 'claude', task: 'write tests' }));
      useAppStore.getState().updateAgent('a1', { status: 'terminated' });
      const updated = useAppStore.getState().agents.find((a) => a.id === 'a1')!;
      expect(updated.provider).toBe('claude');
      expect(updated.task).toBe('write tests');
    });
  });

  describe('removeAgent', () => {
    it('removes the agent', () => {
      useAppStore.getState().addAgent(makeAgent({ id: 'a1' }));
      useAppStore.getState().removeAgent('a1');
      expect(useAppStore.getState().agents).toHaveLength(0);
    });

    it('resets selectedAgentId when removed agent was selected', () => {
      useAppStore.getState().addAgent(makeAgent({ id: 'a1' }));
      useAppStore.getState().setSelectedAgent('a1');
      useAppStore.getState().removeAgent('a1');
      expect(useAppStore.getState().selectedAgentId).toBeNull();
    });

    it('preserves selectedAgentId when different agent removed', () => {
      useAppStore.getState().addAgent(makeAgent({ id: 'a1' }));
      useAppStore.getState().addAgent(makeAgent({ id: 'a2' }));
      useAppStore.getState().setSelectedAgent('a1');
      useAppStore.getState().removeAgent('a2');
      expect(useAppStore.getState().selectedAgentId).toBe('a1');
    });
  });

  // ── Simple setters ─────────────────────────────────────────

  describe('setRoles', () => {
    it('sets roles', () => {
      const roles: Role[] = [{ id: 'dev', name: 'Developer', systemPrompt: 'code stuff' }];
      useAppStore.getState().setRoles(roles);
      expect(useAppStore.getState().roles).toHaveLength(1);
    });
  });

  describe('setConfig', () => {
    it('sets server config', () => {
      const config: ServerConfig = { port: 3000, host: 'localhost', cliCommand: 'node', cliArgs: [], maxConcurrentAgents: 5, dbPath: '/tmp/db' };
      useAppStore.getState().setConfig(config);
      expect(useAppStore.getState().config?.port).toBe(3000);
    });
  });

  describe('setSelectedAgent', () => {
    it('sets selected agent id', () => {
      useAppStore.getState().setSelectedAgent('a1');
      expect(useAppStore.getState().selectedAgentId).toBe('a1');
    });

    it('clears with null', () => {
      useAppStore.getState().setSelectedAgent('a1');
      useAppStore.getState().setSelectedAgent(null);
      expect(useAppStore.getState().selectedAgentId).toBeNull();
    });
  });

  describe('setConnected', () => {
    it('sets connected flag', () => {
      useAppStore.getState().setConnected(true);
      expect(useAppStore.getState().connected).toBe(true);
    });
  });

  describe('setLoading', () => {
    it('sets loading flag', () => {
      useAppStore.getState().setLoading(false);
      expect(useAppStore.getState().loading).toBe(false);
    });
  });

  describe('setSystemPaused', () => {
    it('sets system paused flag', () => {
      useAppStore.getState().setSystemPaused(true);
      expect(useAppStore.getState().systemPaused).toBe(true);
    });
  });

  // ── Approval Queue ─────────────────────────────────────────

  describe('addPendingDecision', () => {
    it('adds a decision', () => {
      useAppStore.getState().addPendingDecision(makeDecision({ id: 'd1' }));
      expect(useAppStore.getState().pendingDecisions).toHaveLength(1);
    });

    it('deduplicates by id', () => {
      useAppStore.getState().addPendingDecision(makeDecision({ id: 'd1' }));
      useAppStore.getState().addPendingDecision(makeDecision({ id: 'd1' }));
      expect(useAppStore.getState().pendingDecisions).toHaveLength(1);
    });

    it('allows different ids', () => {
      useAppStore.getState().addPendingDecision(makeDecision({ id: 'd1' }));
      useAppStore.getState().addPendingDecision(makeDecision({ id: 'd2' }));
      expect(useAppStore.getState().pendingDecisions).toHaveLength(2);
    });
  });

  describe('removePendingDecision', () => {
    it('removes by id', () => {
      useAppStore.getState().addPendingDecision(makeDecision({ id: 'd1' }));
      useAppStore.getState().addPendingDecision(makeDecision({ id: 'd2' }));
      useAppStore.getState().removePendingDecision('d1');
      expect(useAppStore.getState().pendingDecisions).toHaveLength(1);
      expect(useAppStore.getState().pendingDecisions[0].id).toBe('d2');
    });
  });

  describe('updatePendingDecision', () => {
    it('updates a specific decision', () => {
      useAppStore.getState().addPendingDecision(makeDecision({ id: 'd1', status: 'recorded' }));
      useAppStore.getState().updatePendingDecision('d1', { status: 'confirmed' });
      expect(useAppStore.getState().pendingDecisions[0].status).toBe('confirmed');
    });

    it('does not affect other decisions', () => {
      useAppStore.getState().addPendingDecision(makeDecision({ id: 'd1' }));
      useAppStore.getState().addPendingDecision(makeDecision({ id: 'd2', title: 'Use spaces' }));
      useAppStore.getState().updatePendingDecision('d1', { status: 'rejected' });
      expect(useAppStore.getState().pendingDecisions[1].title).toBe('Use spaces');
    });
  });

  describe('setPendingDecisions', () => {
    it('replaces all decisions', () => {
      useAppStore.getState().addPendingDecision(makeDecision({ id: 'd1' }));
      useAppStore.getState().setPendingDecisions([makeDecision({ id: 'd2' }), makeDecision({ id: 'd3' })]);
      expect(useAppStore.getState().pendingDecisions).toHaveLength(2);
    });
  });

  describe('setApprovalQueueOpen', () => {
    it('toggles approval queue visibility', () => {
      useAppStore.getState().setApprovalQueueOpen(true);
      expect(useAppStore.getState().approvalQueueOpen).toBe(true);
      useAppStore.getState().setApprovalQueueOpen(false);
      expect(useAppStore.getState().approvalQueueOpen).toBe(false);
    });
  });
});
