// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

// ── Mocks (before imports) ───────────────────────────────────
const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockAddToast = vi.fn();
vi.mock('../../Toast', () => ({
  useToastStore: Object.assign(
    (selector: any) => selector({ add: mockAddToast }),
    { getState: () => ({ add: mockAddToast }) },
  ),
}));

let mockAgents: any[] = [];
const mockSetSelectedAgent = vi.fn();
vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: any) =>
      selector({
        agents: mockAgents,
        setSelectedAgent: mockSetSelectedAgent,
      }),
    {
      getState: () => ({
        agents: mockAgents,
        setSelectedAgent: mockSetSelectedAgent,
      }),
    },
  ),
}));

let mockSelectedLeadId: string | null = null;
let mockLeadProjects: Record<string, any> = {};
vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: Object.assign(
    (sel: any) => sel({
      selectedLeadId: mockSelectedLeadId,
      projects: mockLeadProjects,
    }),
    {
      getState: () => ({
        selectedLeadId: mockSelectedLeadId,
        projects: mockLeadProjects,
      }),
    },
  ),
}));

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({ models: ['claude-sonnet-4-20250514', 'gpt-4'], filteredModels: ['claude-sonnet-4-20250514', 'gpt-4'] }),
  deriveModelName: (m: string) => m,
}));

vi.mock('../../../utils/statusColors', () => ({
  agentStatusText: (s: string) => `status-${s}`,
}));

vi.mock('../../../utils/format', () => ({
  formatTokens: (n?: number) => n != null ? `${n}` : '0',
}));

vi.mock('../../../utils/formatRelativeTime', () => ({
  formatRelativeTime: () => '5m ago',
}));

vi.mock('../../../utils/getRoleIcon', () => ({
  getRoleIcon: () => '🤖',
}));

vi.mock('../../../utils/markdown', () => ({
  MentionText: ({ text }: { text: string }) => React.createElement('span', { 'data-testid': 'mention-text' }, text),
}));

vi.mock('../../../utils/providerColors', () => ({
  getProviderColors: () => ({ bg: 'bg-blue', text: 'text-blue' }),
}));

vi.mock('../../../utils/agentLabel', () => ({
  shortAgentId: (id: string) => id.slice(0, 8),
}));

vi.mock('../../ProvideFeedback', () => ({
  buildFeedbackUrl: () => 'https://github.com/test/issue',
}));

vi.mock('../../ui/Tabs', () => ({
  Tabs: ({ tabs, activeTab, onTabChange }: any) =>
    React.createElement('div', { 'data-testid': 'tabs' },
      tabs.map((t: any) =>
        React.createElement('button', {
          key: t.id,
          'data-testid': `tab-${t.id}`,
          onClick: () => onTabChange(t.id),
          'aria-selected': activeTab === t.id,
        }, t.label)
      )
    ),
}));

vi.mock('../../AgentChatPanel', () => ({
  AgentChatPanel: ({ agentId }: { agentId: string }) =>
    React.createElement('div', { 'data-testid': 'agent-chat-panel' }, `Chat: ${agentId}`),
}));

vi.mock('../../LeadDashboard/AgentReportBlock', () => ({
  AgentReportBlock: ({ content }: { content: string }) =>
    React.createElement('div', { 'data-testid': 'agent-report-block' }, content),
}));

// ── Imports ──────────────────────────────────────────────────
import { AgentDetailPanel } from '../AgentDetailPanel';

// ── Helpers ──────────────────────────────────────────────────
function makeAgent(overrides: Partial<any> = {}) {
  return {
    id: 'agent-001',
    role: { name: 'Developer', icon: '👨‍💻' },
    status: 'running',
    task: 'Fix bug #42',
    outputPreview: 'Working on fix...',
    model: 'claude-sonnet-4-20250514',
    provider: 'copilot',
    sessionId: 'sess-abc',
    childIds: [],
    createdAt: new Date().toISOString(),
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 200,
    cacheWriteTokens: 100,
    contextWindowSize: 200000,
    contextWindowUsed: 50000,
    exitError: undefined,
    exitCode: undefined,
    modelResolution: undefined,
    parentId: undefined,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────
describe('AgentDetailPanel', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAgents = [makeAgent()];
    mockSelectedLeadId = null;
    mockLeadProjects = {};
    mockApiFetch.mockReset();
  });

  afterEach(cleanup);

  // ── Mode rendering ─────────────────────────────────────────
  describe('mode rendering', () => {
    it('renders inline mode with agent name', () => {
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));
      expect(screen.getByText('Developer')).toBeInTheDocument();
    });

    it('renders modal mode with overlay', () => {
      const { container } = render(
        React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'modal', onClose })
      );
      const overlay = container.querySelector('.fixed.inset-0');
      expect(overlay).not.toBeNull();
    });

    it('returns null when agent not found and no crewId', () => {
      mockAgents = [];
      const { container } = render(
        React.createElement(AgentDetailPanel, { agentId: 'nonexistent', mode: 'inline', onClose })
      );
      expect(container.innerHTML).toBe('');
    });
  });

  // ── Escape key ─────────────────────────────────────────────
  describe('escape key', () => {
    it('closes modal on Escape key', () => {
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'modal', onClose }));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });

    it('does not close inline mode on Escape key', () => {
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // ── Profile data merging ───────────────────────────────────
  describe('profile data merging', () => {
    it('fetches profile when crewId is provided', async () => {
      mockApiFetch.mockResolvedValueOnce({
        agentId: 'agent-001',
        role: 'Designer',
        model: 'gpt-4',
        status: 'active',
        liveStatus: 'running',
        crewId: 'crew-1',
        projectId: 'proj-1',
        lastTaskSummary: 'Previous task',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        knowledgeCount: 3,
        live: null,
      });

      render(React.createElement(AgentDetailPanel, {
        agentId: 'agent-001',
        crewId: 'crew-1',
        mode: 'inline',
        onClose,
      }));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/crews/crew-1/agents/agent-001/profile');
      });
    });

    it('shows loading spinner when profile is loading and no agent', async () => {
      mockAgents = [];
      let resolveProfile!: (v: any) => void;
      mockApiFetch.mockReturnValueOnce(new Promise((r) => { resolveProfile = r; }));

      render(React.createElement(AgentDetailPanel, {
        agentId: 'agent-missing',
        crewId: 'crew-1',
        mode: 'inline',
        onClose,
      }));

      expect(screen.getByText('Loading…')).toBeInTheDocument();

      await act(async () => {
        resolveProfile({
          agentId: 'agent-missing',
          role: 'Designer',
          model: 'gpt-4',
          status: 'active',
          liveStatus: null,
          crewId: 'crew-1',
          projectId: null,
          lastTaskSummary: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          knowledgeCount: 0,
          live: null,
        });
      });
    });
  });

  // ── Tab switching ──────────────────────────────────────────
  describe('tab switching', () => {
    it('shows details tab by default', () => {
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));
      expect(screen.getByText('Fix bug #42')).toBeInTheDocument();
    });

    it('switches to chat tab', async () => {
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));
      fireEvent.click(screen.getByTestId('tab-chat'));
      expect(screen.getByTestId('agent-chat-panel')).toBeInTheDocument();
      expect(screen.getByText('Chat: agent-001')).toBeInTheDocument();
    });

    it('switches to settings tab', async () => {
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));
      fireEvent.click(screen.getByTestId('tab-settings'));
      expect(screen.getByText('Model')).toBeInTheDocument();
    });
  });

  // ── Token / context window display ─────────────────────────
  describe('token and context display', () => {
    it('displays token usage when present', () => {
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));
      expect(screen.getByText('Token Usage')).toBeInTheDocument();
      expect(screen.getByText(/Input: 1000/)).toBeInTheDocument();
      expect(screen.getByText(/Output: 500/)).toBeInTheDocument();
    });

    it('displays context window when present', () => {
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));
      expect(screen.getByText('Context Window')).toBeInTheDocument();
      expect(screen.getByText(/25%/)).toBeInTheDocument();
    });

    it('hides token section when no tokens', () => {
      mockAgents = [makeAgent({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })];
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));
      expect(screen.queryByText('Token Usage')).not.toBeInTheDocument();
    });
  });

  // ── Interrupt / Stop buttons ───────────────────────────────
  describe('interrupt and stop buttons', () => {
    it('shows interrupt and stop buttons for alive agents', () => {
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));
      expect(screen.getByText('Interrupt')).toBeInTheDocument();
      expect(screen.getByText('Stop')).toBeInTheDocument();
    });

    it('hides action buttons for completed agents', () => {
      mockAgents = [makeAgent({ status: 'completed' })];
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));
      expect(screen.queryByText('Interrupt')).not.toBeInTheDocument();
      expect(screen.queryByText('Stop')).not.toBeInTheDocument();
    });

    it('calls interrupt API when interrupt clicked', async () => {
      mockApiFetch.mockResolvedValueOnce({});
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));

      fireEvent.click(screen.getByText('Interrupt'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-001/interrupt', { method: 'POST' });
        expect(mockAddToast).toHaveBeenCalledWith('success', 'Interrupt sent');
      });
    });

    it('shows confirm stop dialog and terminates on confirm', async () => {
      mockApiFetch.mockResolvedValue({});
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));

      fireEvent.click(screen.getByText('Stop'));
      expect(screen.getByText('Terminate this agent? This cannot be undone.')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Confirm'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-001/terminate', { method: 'POST' });
        expect(mockAddToast).toHaveBeenCalledWith('success', 'Agent terminated');
      });
    });

    it('cancels stop confirmation', () => {
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));

      fireEvent.click(screen.getByText('Stop'));
      expect(screen.getByText('Terminate this agent? This cannot be undone.')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByText('Terminate this agent? This cannot be undone.')).not.toBeInTheDocument();
    });
  });

  // ── Error state ────────────────────────────────────────────
  describe('failed agent display', () => {
    it('shows error banner for failed agent', () => {
      mockAgents = [makeAgent({ status: 'failed', exitError: 'OOM killed', exitCode: 137 })];
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));

      expect(screen.getByText('Agent Failed')).toBeInTheDocument();
      expect(screen.getByText('OOM killed')).toBeInTheDocument();
      expect(screen.getByText('Submit GitHub Issue')).toBeInTheDocument();
    });

    it('shows exit error inline when agent is alive', () => {
      mockAgents = [makeAgent({ status: 'running', exitError: 'soft warning' })];
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));

      expect(screen.getByText('Exit Error')).toBeInTheDocument();
      expect(screen.getByText('soft warning')).toBeInTheDocument();
    });
  });

  // ── Modal click-outside closes ─────────────────────────────
  describe('modal backdrop', () => {
    it('closes on backdrop click', () => {
      const { container } = render(
        React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'modal', onClose })
      );

      const overlay = container.querySelector('.fixed.inset-0') as HTMLElement;
      fireEvent.mouseDown(overlay, { target: overlay, currentTarget: overlay });

      expect(onClose).toHaveBeenCalled();
    });
  });

  // ── handleAction error handling ────────────────────────────
  describe('action error handling', () => {
    it('shows error toast when action fails', async () => {
      mockApiFetch.mockRejectedValueOnce(new Error('Server down'));
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));

      fireEvent.click(screen.getByText('Interrupt'));

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('error', 'Failed: Server down');
      });
    });
  });

  // ── Settings tab model display ─────────────────────────────
  describe('settings tab', () => {
    it('shows model select for alive agents', () => {
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));
      fireEvent.click(screen.getByTestId('tab-settings'));
      // Should have a select element for model
      const selects = screen.getAllByRole('combobox');
      expect(selects.length).toBeGreaterThan(0);
    });

    it('shows static model text for dead agents', () => {
      mockAgents = [makeAgent({ status: 'completed' })];
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));
      fireEvent.click(screen.getByTestId('tab-settings'));
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      // Model text appears in both header and settings; just verify at least one is present
      const modelTexts = screen.getAllByText(/claude-sonnet-4-20250514/);
      expect(modelTexts.length).toBeGreaterThan(0);
    });
  });

  // ── Output preview ─────────────────────────────────────────
  describe('output preview', () => {
    it('displays output preview when available', () => {
      render(React.createElement(AgentDetailPanel, { agentId: 'agent-001', mode: 'inline', onClose }));
      expect(screen.getByText('Latest Output')).toBeInTheDocument();
      expect(screen.getByText('Working on fix...')).toBeInTheDocument();
    });
  });
});
