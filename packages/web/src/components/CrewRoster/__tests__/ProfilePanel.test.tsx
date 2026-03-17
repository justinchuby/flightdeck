// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/* ── mocks ─────────────────────────────────────────────────── */

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockAddToast = vi.fn();
vi.mock('../../Toast', () => ({
  useToastStore: (sel: (s: { add: typeof mockAddToast }) => unknown) => sel({ add: mockAddToast }),
}));

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({ models: ['gpt-4', 'claude-3-opus'] }),
  deriveModelName: (id: string) => id,
}));

vi.mock('../../../utils/getRoleIcon', () => ({
  getRoleIcon: (_role: string) => '🤖',
}));

vi.mock('../../ui/Tabs', () => ({
  Tabs: ({ tabs, activeTab, onTabChange }: { tabs: { id: string; label: string }[]; activeTab: string; onTabChange: (id: string) => void }) => (
    <div data-testid="tabs">
      {tabs.map((t: { id: string; label: string }) => (
        <button
          key={t.id}
          data-testid={`tab-${t.id}`}
          onClick={() => onTabChange(t.id)}
          className={activeTab === t.id ? 'active' : ''}
        >
          {t.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../utils', () => ({
  statusBadge: () => ({ bg: 'bg-green-400', label: 'Running' }),
}));

import { ProfilePanel } from '../ProfilePanel';
import type { AgentProfile } from '../types';

/* ── helpers ───────────────────────────────────────────────── */

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    agentId: 'agent-123abcdef',
    role: 'developer',
    model: 'gpt-4',
    status: 'running',
    liveStatus: 'running',
    teamId: 'crew-1',
    projectId: 'proj-1',
    lastTaskSummary: 'Completed feature X',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    knowledgeCount: 5,
    live: {
      task: 'Implementing Y',
      outputPreview: 'Code output...',
      model: 'gpt-4',
      sessionId: 'sess-abc123def456',
      provider: 'copilot',
      backend: 'acp',
      exitError: null,
    },
    ...overrides,
  };
}

/** Render and wait for profile to finish loading */
async function renderLoaded(props: { agentId?: string; crewId?: string; onClose?: () => void } = {}) {
  const result = render(
    <ProfilePanel
      agentId={props.agentId ?? 'agent-123abcdef'}
      crewId={props.crewId ?? 'crew-1'}
      onClose={props.onClose ?? vi.fn()}
    />,
  );
  await waitFor(() => {
    expect(screen.queryByText(/Loading profile/)).not.toBeInTheDocument();
  });
  return result;
}

/* ── tests ─────────────────────────────────────────────────── */

describe('ProfilePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(makeProfile());
  });

  afterEach(cleanup);

  /* ── Loading / Error states ──────────────────────────────── */

  describe('loading and error states', () => {
    it('shows loading spinner initially', () => {
      mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
      render(<ProfilePanel agentId="agent-1" crewId="crew-1" onClose={vi.fn()} />);
      expect(screen.getByText(/Loading profile/)).toBeInTheDocument();
    });

    it('shows "Profile not found" when apiFetch rejects', async () => {
      mockApiFetch.mockRejectedValue(new Error('Not found'));
      render(<ProfilePanel agentId="agent-1" crewId="crew-1" onClose={vi.fn()} />);
      await waitFor(() => {
        expect(screen.getByText(/Profile not found/)).toBeInTheDocument();
      });
    });
  });

  /* ── Profile header ──────────────────────────────────────── */

  describe('profile header', () => {
    it('renders role name and status badge', async () => {
      await renderLoaded();
      expect(screen.getByText('developer')).toBeInTheDocument();
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('renders close button that calls onClose', async () => {
      const onClose = vi.fn();
      await renderLoaded({ onClose });
      // The close button is the last button in the header — uses the X icon
      // Find by accessible role; it's the one without visible text inside the header row
      const buttons = screen.getAllByRole('button');
      // Close button is the one that wraps the X icon in the header
      const closeBtn = buttons.find(b => b.classList.contains('text-th-text-alt') && b.classList.contains('hover:bg-th-bg-alt'));
      expect(closeBtn).toBeDefined();
      fireEvent.click(closeBtn!);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows truncated agent ID (first 12 chars)', async () => {
      await renderLoaded();
      // agentId is 'agent-123abcdef', first 12 chars = 'agent-123abc'
      expect(screen.getByText('agent-123abc')).toBeInTheDocument();
    });

    it('renders role icon emoji', async () => {
      await renderLoaded();
      expect(screen.getByText('🤖')).toBeInTheDocument();
    });
  });

  /* ── Action buttons (when alive) ─────────────────────────── */

  describe('action buttons', () => {
    it('shows Message, Interrupt, Stop buttons when agent is alive (running)', async () => {
      await renderLoaded();
      expect(screen.getByText('Message')).toBeInTheDocument();
      expect(screen.getByText('Interrupt')).toBeInTheDocument();
      expect(screen.getByText('Stop')).toBeInTheDocument();
    });

    it('shows action buttons when agent liveStatus is "creating"', async () => {
      mockApiFetch.mockResolvedValue(makeProfile({ liveStatus: 'creating' }));
      await renderLoaded();
      expect(screen.getByText('Message')).toBeInTheDocument();
      expect(screen.getByText('Interrupt')).toBeInTheDocument();
    });

    it('shows action buttons when agent liveStatus is "idle"', async () => {
      mockApiFetch.mockResolvedValue(makeProfile({ liveStatus: 'idle' }));
      await renderLoaded();
      expect(screen.getByText('Message')).toBeInTheDocument();
    });

    it('does NOT show action buttons when agent is terminated', async () => {
      mockApiFetch.mockResolvedValue(makeProfile({ status: 'terminated', liveStatus: 'terminated' }));
      await renderLoaded();
      expect(screen.queryByText('Message')).not.toBeInTheDocument();
      expect(screen.queryByText('Interrupt')).not.toBeInTheDocument();
      expect(screen.queryByText('Stop')).not.toBeInTheDocument();
    });

    it('does NOT show action buttons when agent is completed', async () => {
      mockApiFetch.mockResolvedValue(makeProfile({ liveStatus: 'completed' }));
      await renderLoaded();
      expect(screen.queryByText('Message')).not.toBeInTheDocument();
    });

    it('Interrupt button calls apiFetch POST and shows success toast', async () => {
      mockApiFetch
        .mockResolvedValueOnce(makeProfile()) // initial fetch
        .mockResolvedValueOnce(undefined);     // interrupt POST
      await renderLoaded();
      fireEvent.click(screen.getByText('Interrupt'));
      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-123abcdef/interrupt', { method: 'POST' });
      });
      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('success', 'Interrupt sent');
      });
    });

    it('Interrupt button shows error toast on failure', async () => {
      mockApiFetch
        .mockResolvedValueOnce(makeProfile())
        .mockRejectedValueOnce(new Error('Network error'));
      await renderLoaded();
      fireEvent.click(screen.getByText('Interrupt'));
      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('error', 'Failed to interrupt agent: Network error');
      });
    });

    it('Stop button shows confirm dialog, then confirm calls terminate', async () => {
      const updatedProfile = makeProfile({ status: 'terminated', liveStatus: 'terminated' });
      mockApiFetch
        .mockResolvedValueOnce(makeProfile()) // initial fetch
        .mockResolvedValueOnce(undefined)      // terminate POST
        .mockResolvedValueOnce(updatedProfile); // re-fetch after terminate
      await renderLoaded();

      // Click Stop to show confirm dialog
      fireEvent.click(screen.getByText('Stop'));
      expect(screen.getByText(/Are you sure you want to terminate/)).toBeInTheDocument();
      expect(screen.getByText('Confirm Stop')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();

      // Click Confirm Stop
      fireEvent.click(screen.getByText('Confirm Stop'));
      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-123abcdef/terminate', { method: 'POST' });
      });
      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('success', 'Agent terminated');
      });
    });

    it('Stop confirm Cancel button dismisses dialog', async () => {
      await renderLoaded();
      fireEvent.click(screen.getByText('Stop'));
      expect(screen.getByText(/Are you sure/)).toBeInTheDocument();
      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByText(/Are you sure/)).not.toBeInTheDocument();
    });

    it('Message button toggles input field', async () => {
      await renderLoaded();
      expect(screen.queryByPlaceholderText(/Type a message/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('Message'));
      expect(screen.getByPlaceholderText(/Type a message/)).toBeInTheDocument();
      // Toggle off
      fireEvent.click(screen.getByText('Message'));
      expect(screen.queryByPlaceholderText(/Type a message/)).not.toBeInTheDocument();
    });
  });

  /* ── Tabs ────────────────────────────────────────────────── */

  describe('tabs', () => {
    it('renders all three tabs', async () => {
      await renderLoaded();
      expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
      expect(screen.getByTestId('tab-history')).toBeInTheDocument();
      expect(screen.getByTestId('tab-settings')).toBeInTheDocument();
    });
  });

  /* ── Overview tab ────────────────────────────────────────── */

  describe('overview tab', () => {
    it('shows model, project, knowledge count, and dates', async () => {
      await renderLoaded();
      const body = document.body.textContent || '';
      expect(body).toContain('gpt-4');
      expect(body).toContain('proj-1');
      expect(body).toContain('5 entries');
      // Dates rendered via toLocaleDateString
      expect(body).toContain(new Date('2024-01-01T00:00:00Z').toLocaleDateString());
      expect(body).toContain(new Date('2024-01-02T00:00:00Z').toLocaleDateString());
    });

    it('shows last task summary', async () => {
      await renderLoaded();
      expect(screen.getByText('Completed feature X')).toBeInTheDocument();
    });

    it('does not show last task section when summary is null', async () => {
      mockApiFetch.mockResolvedValue(makeProfile({ lastTaskSummary: null }));
      await renderLoaded();
      expect(screen.queryByText('Last Task:')).not.toBeInTheDocument();
    });

    it('shows exit error when present', async () => {
      mockApiFetch.mockResolvedValue(
        makeProfile({
          live: {
            task: null,
            outputPreview: null,
            model: 'gpt-4',
            sessionId: null,
            provider: null,
            backend: null,
            exitError: 'Process crashed unexpectedly',
          },
        }),
      );
      await renderLoaded();
      expect(screen.getByText('Exit Error')).toBeInTheDocument();
      expect(screen.getByText('Process crashed unexpectedly')).toBeInTheDocument();
    });

    it('shows live session info when live object exists', async () => {
      await renderLoaded();
      expect(screen.getByText('Live Session')).toBeInTheDocument();
      expect(screen.getByText('Implementing Y')).toBeInTheDocument();
    });

    it('does not show live session section when live is null', async () => {
      mockApiFetch.mockResolvedValue(makeProfile({ live: null }));
      await renderLoaded();
      expect(screen.queryByText('Live Session')).not.toBeInTheDocument();
    });

    it('shows CLI provider info', async () => {
      await renderLoaded();
      const body = document.body.textContent || '';
      expect(body).toContain('copilot');
    });

    it('shows truncated session ID', async () => {
      await renderLoaded();
      // 'sess-abc123def456'.slice(0, 12) = 'sess-abc123d'
      expect(screen.getByText(/sess-abc123d/)).toBeInTheDocument();
    });

    it('shows project as dash when projectId is null', async () => {
      mockApiFetch.mockResolvedValue(makeProfile({ projectId: null }));
      await renderLoaded();
      const body = document.body.textContent || '';
      expect(body).toContain('—');
    });
  });

  /* ── History tab ─────────────────────────────────────────── */

  describe('history tab', () => {
    it('shows placeholder text', async () => {
      await renderLoaded();
      fireEvent.click(screen.getByTestId('tab-history'));
      await waitFor(() => {
        expect(screen.getByText(/Task history will be available/)).toBeInTheDocument();
      });
    });
  });

  /* ── Settings tab ────────────────────────────────────────── */

  describe('settings tab', () => {
    it('shows model dropdown when agent is alive', async () => {
      await renderLoaded();
      fireEvent.click(screen.getByTestId('tab-settings'));
      await waitFor(() => {
        const select = screen.getByRole('combobox');
        expect(select).toBeInTheDocument();
        expect(select).toHaveValue('gpt-4');
      });
    });

    it('dropdown includes all available models', async () => {
      await renderLoaded();
      fireEvent.click(screen.getByTestId('tab-settings'));
      await waitFor(() => {
        const options = screen.getAllByRole('option');
        const values = options.map(o => o.textContent);
        expect(values).toContain('gpt-4');
        expect(values).toContain('claude-3-opus');
      });
    });

    it('shows static model text when agent is not alive', async () => {
      mockApiFetch.mockResolvedValue(makeProfile({ status: 'terminated', liveStatus: 'terminated' }));
      await renderLoaded();
      fireEvent.click(screen.getByTestId('tab-settings'));
      await waitFor(() => {
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        // Static text shows the model name
        const body = document.body.textContent || '';
        expect(body).toContain('gpt-4');
      });
    });

    it('shows CLI provider and backend in settings tab', async () => {
      await renderLoaded();
      fireEvent.click(screen.getByTestId('tab-settings'));
      await waitFor(() => {
        const body = document.body.textContent || '';
        expect(body).toContain('copilot');
        expect(body).toContain('acp');
      });
    });

    it('changing model calls apiFetch PATCH and shows toast', async () => {
      mockApiFetch
        .mockResolvedValueOnce(makeProfile()) // initial fetch
        .mockResolvedValueOnce(undefined);     // PATCH
      await renderLoaded();
      fireEvent.click(screen.getByTestId('tab-settings'));
      await waitFor(() => screen.getByRole('combobox'));

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'claude-3-opus' } });
      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith(
          '/agents/agent-123abcdef',
          { method: 'PATCH', body: JSON.stringify({ model: 'claude-3-opus' }) },
        );
      });
      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('success', 'Model updated');
      });
    });
  });

  /* ── Message flow ────────────────────────────────────────── */

  describe('message flow', () => {
    it('send message calls apiFetch with message content', async () => {
      mockApiFetch
        .mockResolvedValueOnce(makeProfile()) // initial fetch
        .mockResolvedValueOnce(undefined);     // message POST
      await renderLoaded();

      fireEvent.click(screen.getByText('Message'));
      const input = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(input, { target: { value: 'Hello agent!' } });
      fireEvent.click(screen.getByText('Send'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-123abcdef/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'Hello agent!' }),
        });
      });
      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('success', 'Message sent');
      });
    });

    it('empty message send button is disabled', async () => {
      await renderLoaded();
      fireEvent.click(screen.getByText('Message'));
      const sendBtn = screen.getByText('Send').closest('button')!;
      expect(sendBtn).toBeDisabled();
    });

    it('whitespace-only message send button is disabled', async () => {
      await renderLoaded();
      fireEvent.click(screen.getByText('Message'));
      const input = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(input, { target: { value: '   ' } });
      const sendBtn = screen.getByText('Send').closest('button')!;
      expect(sendBtn).toBeDisabled();
    });

    it('message input closes after successful send', async () => {
      mockApiFetch
        .mockResolvedValueOnce(makeProfile())
        .mockResolvedValueOnce(undefined);
      await renderLoaded();

      fireEvent.click(screen.getByText('Message'));
      fireEvent.change(screen.getByPlaceholderText(/Type a message/), { target: { value: 'Hi' } });
      fireEvent.click(screen.getByText('Send'));

      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/Type a message/)).not.toBeInTheDocument();
      });
    });

    it('Enter key in message input triggers send', async () => {
      mockApiFetch
        .mockResolvedValueOnce(makeProfile())
        .mockResolvedValueOnce(undefined);
      await renderLoaded();

      fireEvent.click(screen.getByText('Message'));
      const input = screen.getByPlaceholderText(/Type a message/);
      fireEvent.change(input, { target: { value: 'Enter test' } });
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/agents/agent-123abcdef/message', expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ content: 'Enter test' }),
        }));
      });
    });

    it('shows error toast when message send fails', async () => {
      mockApiFetch
        .mockResolvedValueOnce(makeProfile())
        .mockRejectedValueOnce(new Error('Send failed'));
      await renderLoaded();

      fireEvent.click(screen.getByText('Message'));
      fireEvent.change(screen.getByPlaceholderText(/Type a message/), { target: { value: 'Hello' } });
      fireEvent.click(screen.getByText('Send'));

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('error', 'Failed to send message: Send failed');
      });
    });
  });

  /* ── API call correctness ────────────────────────────────── */

  describe('API calls', () => {
    it('fetches profile with correct crew and agent path', async () => {
      await renderLoaded({ agentId: 'a-99', crewId: 'c-42' });
      expect(mockApiFetch).toHaveBeenCalledWith('/crews/c-42/agents/a-99/profile');
    });
  });
});
