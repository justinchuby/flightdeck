import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { NLPattern } from '../../../services/NLCommandRegistry';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

vi.mock('../../../stores/leadStore', () => ({
  useLeadStore: (selector: (s: { selectedLeadId: string | null }) => unknown) =>
    selector({ selectedLeadId: 'session-123' }),
}));

vi.mock('../../../services/UndoStack', () => ({
  undoStack: { push: vi.fn() },
}));

import { NLActionPreview } from '../NLActionPreview';
import { undoStack } from '../../../services/UndoStack';

// ── Fixtures ──────────────────────────────────────────────────────────────

const pattern: NLPattern = {
  id: 'nl-pause-all',
  phrases: ['pause all'],
  category: 'control',
  destructive: false,
  description: 'Pause all running agents',
  icon: '⏸',
};

const destructivePattern: NLPattern = {
  ...pattern,
  id: 'nl-wrap-up',
  destructive: true,
  description: 'Set 10-min deadline',
  icon: '⏱',
};

const actionPlan = {
  plan: {
    steps: [
      { action: 'pause_agent', target: 'agent-1' },
      { action: 'pause_agent', target: 'agent-2' },
    ],
    summary: 'Pause 2 agents',
    estimatedImpact: '2 agents',
    reversible: true,
  },
  matched: true,
};

function renderPreview(overrides: Partial<{ pattern: NLPattern; query: string }> = {}) {
  const onClose = vi.fn();
  const onExecuted = vi.fn();
  return {
    onClose,
    onExecuted,
    ...render(
      <NLActionPreview
        pattern={overrides.pattern ?? pattern}
        query={overrides.query ?? 'pause all'}
        onClose={onClose}
        onExecuted={onExecuted}
      />,
    ),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('NLActionPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockReset();
  });

  it('renders header with pattern icon and description', () => {
    mockApiFetch.mockResolvedValue(actionPlan);
    renderPreview();
    expect(screen.getByText('⏸')).toBeInTheDocument();
    expect(screen.getByText('Pause all running agents')).toBeInTheDocument();
  });

  it('renders the query text', () => {
    mockApiFetch.mockResolvedValue(actionPlan);
    renderPreview({ query: 'pause everything' });
    expect(screen.getByText(/pause everything/)).toBeInTheDocument();
  });

  it('has complementary role with aria-label', () => {
    mockApiFetch.mockResolvedValue(actionPlan);
    renderPreview();
    expect(screen.getByRole('complementary')).toHaveAttribute('aria-label', 'Action preview');
  });

  it('shows loading state initially', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // never resolves
    renderPreview();
    expect(screen.getByText('Loading preview…')).toBeInTheDocument();
  });

  it('shows plan steps after loading', async () => {
    mockApiFetch.mockResolvedValue(actionPlan);
    renderPreview();
    await waitFor(() => {
      expect(screen.getByText('This will:')).toBeInTheDocument();
    });
    const steps = screen.getAllByRole('listitem');
    expect(steps.length).toBe(2);
    expect(steps[0]).toHaveTextContent(/pause agent.*agent-1/);
    expect(steps[1]).toHaveTextContent(/pause agent.*agent-2/);
  });

  it('shows estimated impact', async () => {
    mockApiFetch.mockResolvedValue(actionPlan);
    renderPreview();
    await waitFor(() => {
      expect(screen.getByText(/Affects: 2 agents/)).toBeInTheDocument();
    });
  });

  it('shows reversible status', async () => {
    mockApiFetch.mockResolvedValue(actionPlan);
    renderPreview();
    await waitFor(() => {
      expect(screen.getByText(/Reversible: Yes/)).toBeInTheDocument();
    });
  });

  it('shows error on preview failure', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByText('Could not preview command')).toBeInTheDocument();
    });
  });

  it('disables Execute button when loading', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    renderPreview();
    expect(screen.getByText('Execute →')).toBeDisabled();
  });

  it('disables Execute button on error', async () => {
    mockApiFetch.mockRejectedValue(new Error('fail'));
    renderPreview();
    await waitFor(() => {
      expect(screen.getByText('Execute →')).toBeDisabled();
    });
  });

  it('calls onClose when Cancel is clicked', () => {
    mockApiFetch.mockResolvedValue(actionPlan);
    const { onClose } = renderPreview();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('executes command and calls onExecuted', async () => {
    mockApiFetch
      .mockResolvedValueOnce(actionPlan) // preview
      .mockResolvedValueOnce({ commandId: 'cmd-1', plan: actionPlan.plan }); // execute

    const { onExecuted } = renderPreview();
    await waitFor(() => screen.getByText('Execute →'));
    fireEvent.click(screen.getByText('Execute →'));
    await waitFor(() => {
      expect(onExecuted).toHaveBeenCalled();
    });
  });

  it('pushes to undo stack for reversible commands', async () => {
    mockApiFetch
      .mockResolvedValueOnce(actionPlan)
      .mockResolvedValueOnce({ commandId: 'cmd-1', plan: actionPlan.plan });

    renderPreview();
    await waitFor(() => screen.getByText('Execute →'));
    fireEvent.click(screen.getByText('Execute →'));
    await waitFor(() => {
      expect(undoStack.push).toHaveBeenCalledWith('cmd-1', 'Pause 2 agents');
    });
  });

  it('shows error on execution failure', async () => {
    mockApiFetch
      .mockResolvedValueOnce(actionPlan)
      .mockRejectedValueOnce(new Error('exec fail'));

    renderPreview();
    await waitFor(() => screen.getByText('Execute →'));
    fireEvent.click(screen.getByText('Execute →'));
    await waitFor(() => {
      expect(screen.getByText('Command execution failed')).toBeInTheDocument();
    });
  });

  it('shows destructive warning for destructive patterns', async () => {
    mockApiFetch.mockResolvedValue(actionPlan);
    renderPreview({ pattern: destructivePattern });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByText(/destructive action/)).toBeInTheDocument();
  });

  it('does not show destructive warning for non-destructive patterns', async () => {
    mockApiFetch.mockResolvedValue(actionPlan);
    renderPreview();
    await waitFor(() => screen.getByText('This will:'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('fetches preview with correct endpoint and body', () => {
    mockApiFetch.mockResolvedValue(actionPlan);
    renderPreview({ query: 'pause all' });
    expect(mockApiFetch).toHaveBeenCalledWith('/nl/preview', {
      method: 'POST',
      body: JSON.stringify({ command: 'pause all', sessionId: 'session-123' }),
    });
  });
});
