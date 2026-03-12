// packages/web/src/stores/__tests__/appStore.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';
import type { AgentInfo } from '../../types';

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

describe('appStore — agent lifecycle', () => {
  beforeEach(() => {
    useAppStore.setState({ agents: [], selectedAgentId: null });
  });

  it('updateAgent preserves provider when status changes to terminated', () => {
    const agent = makeAgent({ id: 'a1', provider: 'copilot' });
    useAppStore.getState().addAgent(agent);

    // Simulate WebSocket agent:terminated → updateAgent with status only
    useAppStore.getState().updateAgent('a1', { status: 'terminated' });

    const updated = useAppStore.getState().agents.find((a) => a.id === 'a1');
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('terminated');
    expect(updated!.provider).toBe('copilot');
    expect(updated!.model).toBe('gpt-4');
  });

  it('removeAgent deletes the agent from the store entirely', () => {
    const agent = makeAgent({ id: 'a1' });
    useAppStore.getState().addAgent(agent);
    expect(useAppStore.getState().agents).toHaveLength(1);

    useAppStore.getState().removeAgent('a1');
    expect(useAppStore.getState().agents).toHaveLength(0);
  });

  it('updateAgent preserves all fields on partial status update', () => {
    const agent = makeAgent({
      id: 'a1',
      provider: 'claude',
      backend: 'acp',
      task: 'write tests',
    });
    useAppStore.getState().addAgent(agent);

    useAppStore.getState().updateAgent('a1', { status: 'terminated' });

    const updated = useAppStore.getState().agents.find((a) => a.id === 'a1')!;
    expect(updated.provider).toBe('claude');
    expect(updated.backend).toBe('acp');
    expect(updated.task).toBe('write tests');
    expect(updated.status).toBe('terminated');
  });

  it('agent:exit should not overwrite terminated status with failed', () => {
    const agent = makeAgent({ id: 'a1', provider: 'copilot', status: 'terminated' });
    useAppStore.getState().addAgent(agent);

    // Simulate the guard: check status before overwriting
    const existing = useAppStore.getState().agents.find((a) => a.id === 'a1');
    if (existing?.status !== 'terminated') {
      useAppStore.getState().updateAgent('a1', { status: 'failed', exitError: 'signal' });
    }

    const result = useAppStore.getState().agents.find((a) => a.id === 'a1')!;
    expect(result.status).toBe('terminated');
    expect(result.provider).toBe('copilot');
  });
});
