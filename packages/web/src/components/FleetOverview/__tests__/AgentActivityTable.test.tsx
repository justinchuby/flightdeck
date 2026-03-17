// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ── Mocks (before imports) ───────────────────────────────────
const mockSetSelectedAgent = vi.fn();
vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: any) =>
      selector({
        setSelectedAgent: mockSetSelectedAgent,
      }),
    {
      getState: () => ({
        setSelectedAgent: mockSetSelectedAgent,
      }),
    },
  ),
}));

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({ models: ['claude-sonnet-4-20250514', 'gpt-4'], filteredModels: ['claude-sonnet-4-20250514', 'gpt-4'] }),
}));

vi.mock('../../../utils/format', () => ({
  formatTokens: (n?: number) => n != null ? `${n}tok` : '0tok',
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

const mockUpdateAgent = vi.fn();
const mockInterruptAgent = vi.fn();
const mockTerminateAgent = vi.fn();
const mockRestartAgent = vi.fn();
vi.mock('../../../contexts/ApiContext', () => ({
  useApiContext: () => ({
    updateAgent: mockUpdateAgent,
    interruptAgent: mockInterruptAgent,
    terminateAgent: mockTerminateAgent,
    restartAgent: mockRestartAgent,
  }),
}));

vi.mock('../../Shared', () => ({
  EmptyState: ({ title }: { title: string }) =>
    React.createElement('div', { 'data-testid': 'empty-state' }, title),
}));

vi.mock('../../ProviderBadge', () => ({
  ProviderBadge: ({ provider }: { provider?: string }) =>
    React.createElement('span', { 'data-testid': 'provider-badge' }, provider ?? ''),
}));

// ── Imports ──────────────────────────────────────────────────
import { AgentActivityTable } from '../AgentActivityTable';
import type { AgentInfo } from '../../../types';

// ── Helpers ──────────────────────────────────────────────────
function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-001',
    role: { name: 'Developer', icon: '👨‍💻' },
    status: 'running',
    task: 'Fix tests',
    childIds: [],
    createdAt: new Date(Date.now() - 120000).toISOString(), // 2 mins ago
    outputPreview: '',
    model: 'claude-sonnet-4-20250514',
    provider: 'copilot',
    inputTokens: 1500,
    outputTokens: 500,
    ...overrides,
  } as AgentInfo;
}

function makeLock(agentId: string, filePath: string) {
  return { agentId, agentRole: 'Developer', filePath, acquiredAt: new Date().toISOString() };
}

// ── Tests ────────────────────────────────────────────────────
describe('AgentActivityTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  // ── Empty state ────────────────────────────────────────────
  describe('empty state', () => {
    it('renders empty state when no agents', () => {
      render(React.createElement(AgentActivityTable, { agents: [], locks: [] }));
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByText('No agents to display')).toBeInTheDocument();
    });
  });

  // ── Agent rows ─────────────────────────────────────────────
  describe('agent row rendering', () => {
    it('renders an agent row with status and task', () => {
      render(React.createElement(AgentActivityTable, { agents: [makeAgent()], locks: [] }));
      expect(screen.getByText('Developer')).toBeInTheDocument();
      expect(screen.getByText('running')).toBeInTheDocument();
      expect(screen.getByText('Fix tests')).toBeInTheDocument();
    });

    it('renders provider badge and model', () => {
      render(React.createElement(AgentActivityTable, { agents: [makeAgent()], locks: [] }));
      expect(screen.getByTestId('provider-badge')).toBeInTheDocument();
    });

    it('renders short agent id', () => {
      render(React.createElement(AgentActivityTable, { agents: [makeAgent()], locks: [] }));
      expect(screen.getByText('(agent-00)')).toBeInTheDocument();
    });

    it('shows dash for agent without task', () => {
      render(React.createElement(AgentActivityTable, { agents: [makeAgent({ task: undefined })], locks: [] }));
      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBeGreaterThan(0);
    });
  });

  // ── flattenHierarchy (parent/child) ────────────────────────
  describe('hierarchy rendering', () => {
    it('renders parent and child agents with indentation', () => {
      const parent = makeAgent({ id: 'parent-1', childIds: ['child-1'] });
      const child = makeAgent({
        id: 'child-1',
        parentId: 'parent-1',
        role: { name: 'Researcher', icon: '🔬' },
        childIds: [],
      });

      render(React.createElement(AgentActivityTable, { agents: [parent, child], locks: [] }));

      expect(screen.getByText('Developer')).toBeInTheDocument();
      expect(screen.getByText('Researcher')).toBeInTheDocument();
      expect(screen.getByText('└─')).toBeInTheDocument();
    });

    it('renders multiple children with correct tree lines', () => {
      const parent = makeAgent({ id: 'parent-1', childIds: ['child-1', 'child-2'] });
      const child1 = makeAgent({
        id: 'child-1',
        parentId: 'parent-1',
        role: { name: 'Writer', icon: '✍️' },
        childIds: [],
      });
      const child2 = makeAgent({
        id: 'child-2',
        parentId: 'parent-1',
        role: { name: 'Tester', icon: '🧪' },
        childIds: [],
      });

      render(React.createElement(AgentActivityTable, {
        agents: [parent, child1, child2],
        locks: [],
      }));

      expect(screen.getByText('├─')).toBeInTheDocument();
      expect(screen.getByText('└─')).toBeInTheDocument();
    });
  });

  // ── getCurrentActivity ─────────────────────────────────────
  describe('current activity display', () => {
    it('shows active tool call', () => {
      const agent = makeAgent({
        toolCalls: [
          { toolCallId: 'tc-1', title: 'Reading file', kind: 'read', status: 'in_progress' },
        ],
      });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('🔧 Reading file')).toBeInTheDocument();
    });

    it('shows completed tool call with checkmark', () => {
      const agent = makeAgent({
        toolCalls: [
          { toolCallId: 'tc-1', title: 'Wrote file', kind: 'write', status: 'completed' },
        ],
      });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('✅ Wrote file')).toBeInTheDocument();
    });

    it('shows plan progress for in-progress plan item', () => {
      const agent = makeAgent({
        plan: [
          { content: 'Step 1: Setup', priority: 'high' as const, status: 'completed' as const },
          { content: 'Step 2: Implement', priority: 'high' as const, status: 'in_progress' as const },
        ],
      });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('📋 Step 2: Implement')).toBeInTheDocument();
    });

    it('shows pending plan item', () => {
      const agent = makeAgent({
        plan: [
          { content: 'Step 1: Setup', priority: 'high' as const, status: 'pending' as const },
        ],
      });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('⏳ Step 1: Setup')).toBeInTheDocument();
    });

    it('shows plan complete when all done', () => {
      const agent = makeAgent({
        plan: [
          { content: 'Step 1', priority: 'high' as const, status: 'completed' as const },
        ],
      });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('📋 Plan complete')).toBeInTheDocument();
    });

    it('shows output preview as fallback', () => {
      const agent = makeAgent({
        outputPreview: 'Building project...\nCompiling sources',
        toolCalls: undefined,
        plan: undefined,
      });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('Compiling sources')).toBeInTheDocument();
    });

    it('shows status-specific messages for creating/completed/failed/terminated', () => {
      const creating = makeAgent({ status: 'creating', outputPreview: '', toolCalls: undefined, plan: undefined });
      const { unmount } = render(React.createElement(AgentActivityTable, { agents: [creating], locks: [] }));
      expect(screen.getByText('Starting up...')).toBeInTheDocument();
      unmount();

      const completed = makeAgent({ status: 'completed', outputPreview: '', toolCalls: undefined, plan: undefined });
      const { unmount: u2 } = render(React.createElement(AgentActivityTable, { agents: [completed], locks: [] }));
      expect(screen.getByText('Finished')).toBeInTheDocument();
      u2();

      const failed = makeAgent({ status: 'failed', outputPreview: '', toolCalls: undefined, plan: undefined });
      const { unmount: u3 } = render(React.createElement(AgentActivityTable, { agents: [failed], locks: [] }));
      expect(screen.getByText('Crashed')).toBeInTheDocument();
      u3();

      const terminated = makeAgent({ status: 'terminated', outputPreview: '', toolCalls: undefined, plan: undefined });
      render(React.createElement(AgentActivityTable, { agents: [terminated], locks: [] }));
      expect(screen.getByText('Terminated')).toBeInTheDocument();
    });

    it('shows Idle for running agent with no activity', () => {
      const agent = makeAgent({ outputPreview: '', toolCalls: undefined, plan: undefined });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('Idle')).toBeInTheDocument();
    });
  });

  // ── elapsed function ───────────────────────────────────────
  describe('uptime display', () => {
    it('shows seconds for <60s agents', () => {
      const agent = makeAgent({ createdAt: new Date(Date.now() - 30000).toISOString() });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('30s')).toBeInTheDocument();
    });

    it('shows minutes for agents created minutes ago', () => {
      const agent = makeAgent({ createdAt: new Date(Date.now() - 300000).toISOString() });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('5m')).toBeInTheDocument();
    });

    it('shows hours and minutes for long-running agents', () => {
      const agent = makeAgent({ createdAt: new Date(Date.now() - 5400000).toISOString() });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('1h 30m')).toBeInTheDocument();
    });
  });

  // ── Tokens / context window ────────────────────────────────
  describe('token display', () => {
    it('shows token counts for agents with tokens', () => {
      render(React.createElement(AgentActivityTable, { agents: [makeAgent()], locks: [] }));
      expect(screen.getByText('↓1500tok')).toBeInTheDocument();
      expect(screen.getByText('↑500tok')).toBeInTheDocument();
    });

    it('shows context window bar when context data present', () => {
      const agent = makeAgent({ contextWindowSize: 200000, contextWindowUsed: 170000 });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('85%')).toBeInTheDocument();
    });

    it('shows cache read tokens when present', () => {
      const agent = makeAgent({ cacheReadTokens: 5000 });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('⚡5000tok')).toBeInTheDocument();
    });
  });

  // ── Locks display ──────────────────────────────────────────
  describe('locks display', () => {
    it('shows file locks for agent', () => {
      const locks = [makeLock('agent-001', '/src/auth.ts'), makeLock('agent-001', '/src/db.ts')];
      render(React.createElement(AgentActivityTable, { agents: [makeAgent()], locks }));
      expect(screen.getByText('🔒 2')).toBeInTheDocument();
      expect(screen.getByText('auth.ts')).toBeInTheDocument();
      expect(screen.getByText('db.ts')).toBeInTheDocument();
    });
  });

  // ── Action buttons ─────────────────────────────────────────
  describe('action buttons', () => {
    it('clicking terminal button selects agent via onSelectAgent', () => {
      const onSelect = vi.fn();
      render(React.createElement(AgentActivityTable, {
        agents: [makeAgent()],
        locks: [],
        onSelectAgent: onSelect,
      }));

      const buttons = screen.getAllByTitle('Open terminal');
      fireEvent.click(buttons[0]);

      expect(onSelect).toHaveBeenCalledWith('agent-001');
    });

    it('shows restart button for completed agents', () => {
      const agent = makeAgent({ status: 'completed' });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));

      const restartBtn = screen.getByTitle('Restart agent');
      fireEvent.click(restartBtn);

      expect(mockRestartAgent).toHaveBeenCalledWith('agent-001');
    });

    it('shows interrupt button for active agents', () => {
      render(React.createElement(AgentActivityTable, { agents: [makeAgent()], locks: [] }));

      const interruptBtn = screen.getByTitle('Interrupt agent');
      fireEvent.click(interruptBtn);

      expect(mockInterruptAgent).toHaveBeenCalledWith('agent-001');
    });

    it('shows stop button for active agents', () => {
      render(React.createElement(AgentActivityTable, { agents: [makeAgent()], locks: [] }));
      expect(screen.getByTitle('Stop agent')).toBeInTheDocument();
    });

    it('does not show interrupt/stop for completed agents', () => {
      const agent = makeAgent({ status: 'completed' });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.queryByTitle('Interrupt agent')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Stop agent')).not.toBeInTheDocument();
    });
  });

  // ── Confirm-to-terminate flow ──────────────────────────────
  describe('confirm-to-terminate flow', () => {
    it('shows confirm button after clicking stop', () => {
      render(React.createElement(AgentActivityTable, { agents: [makeAgent()], locks: [] }));

      fireEvent.click(screen.getByTitle('Stop agent'));

      expect(screen.getByTitle('Confirm stop')).toBeInTheDocument();
    });

    it('terminates agent on confirm click', () => {
      render(React.createElement(AgentActivityTable, { agents: [makeAgent()], locks: [] }));

      fireEvent.click(screen.getByTitle('Stop agent'));
      fireEvent.click(screen.getByTitle('Confirm stop'));

      expect(mockTerminateAgent).toHaveBeenCalledWith('agent-001');
    });

    it('cancels confirm on blur', () => {
      render(React.createElement(AgentActivityTable, { agents: [makeAgent()], locks: [] }));

      fireEvent.click(screen.getByTitle('Stop agent'));
      expect(screen.getByTitle('Confirm stop')).toBeInTheDocument();

      fireEvent.blur(screen.getByTitle('Confirm stop'));

      expect(screen.queryByTitle('Confirm stop')).not.toBeInTheDocument();
      expect(screen.getByTitle('Stop agent')).toBeInTheDocument();
    });
  });

  // ── Select handler fallback ────────────────────────────────
  describe('select handler', () => {
    it('uses appStore setSelectedAgent when no onSelectAgent provided', () => {
      render(React.createElement(AgentActivityTable, { agents: [makeAgent()], locks: [] }));

      const buttons = screen.getAllByTitle('Open terminal');
      fireEvent.click(buttons[0]);

      expect(mockSetSelectedAgent).toHaveBeenCalledWith('agent-001');
    });
  });

  // ── Failed agent with exit error ───────────────────────────
  describe('failed agent rendering', () => {
    it('shows exit error for failed agents', () => {
      const agent = makeAgent({
        status: 'failed',
        exitError: 'Process crashed',
      });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('Process crashed')).toBeInTheDocument();
    });
  });

  // ── Sub-agent badge ────────────────────────────────────────
  describe('sub-agent count badge', () => {
    it('shows sub-agent count badge when agent has children', () => {
      const agent = makeAgent({ childIds: ['child-1', 'child-2'] });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('2 sub-agents')).toBeInTheDocument();
    });

    it('shows singular form for 1 sub-agent', () => {
      const agent = makeAgent({ childIds: ['child-1'] });
      render(React.createElement(AgentActivityTable, { agents: [agent], locks: [] }));
      expect(screen.getByText('1 sub-agent')).toBeInTheDocument();
    });
  });
});
