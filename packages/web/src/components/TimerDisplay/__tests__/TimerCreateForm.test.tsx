import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TimerCreateForm } from '../TimerCreateForm';
import { useTimerStore } from '../../../stores/timerStore';
import { useAppStore } from '../../../stores/appStore';

// Mock apiFetch
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue({}),
  getAuthToken: vi.fn().mockReturnValue(null),
}));

function setupAgents() {
  useAppStore.setState({
    agents: [
      {
        id: 'agent-1',
        role: { id: 'developer', name: 'Developer', model: 'test' },
        status: 'running',
      },
      {
        id: 'agent-2',
        role: { id: 'lead', name: 'Project Lead', model: 'test' },
        status: 'running',
      },
      {
        id: 'agent-3',
        role: { id: 'qa', name: 'QA', model: 'test' },
        status: 'completed',
      },
    ] as any,
  });
}

describe('TimerCreateForm', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useTimerStore.setState({ timers: [], recentlyFiredIds: [] });
    setupAgents();
  });

  it('renders the form with all fields', () => {
    render(<TimerCreateForm onClose={mockOnClose} />);

    expect(screen.getByTestId('timer-create-form')).toBeInTheDocument();
    expect(screen.getByTestId('timer-agent-select')).toBeInTheDocument();
    expect(screen.getByTestId('timer-label-input')).toBeInTheDocument();
    expect(screen.getByTestId('timer-delay-input')).toBeInTheDocument();
    expect(screen.getByTestId('timer-message-input')).toBeInTheDocument();
    expect(screen.getByTestId('timer-repeat-checkbox')).toBeInTheDocument();
    expect(screen.getByTestId('timer-create-submit')).toBeInTheDocument();
    expect(screen.getByTestId('timer-create-cancel')).toBeInTheDocument();
  });

  it('only shows running/idle agents in the selector', () => {
    render(<TimerCreateForm onClose={mockOnClose} />);

    const select = screen.getByTestId('timer-agent-select');
    const options = select.querySelectorAll('option');
    // agent-3 is 'completed', should not appear
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain('Developer');
    expect(options[1].textContent).toContain('Project Lead');
  });

  it('shows error when label is empty', async () => {
    render(<TimerCreateForm onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId('timer-delay-input'), { target: { value: '5m' } });
    fireEvent.click(screen.getByTestId('timer-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('timer-create-error')).toHaveTextContent('Label is required');
    });
  });

  it('shows error when delay is invalid', async () => {
    render(<TimerCreateForm onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId('timer-label-input'), { target: { value: 'test' } });
    fireEvent.change(screen.getByTestId('timer-delay-input'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByTestId('timer-create-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('timer-create-error')).toHaveTextContent('valid delay');
    });
  });

  it('calls onClose when cancel button is clicked', () => {
    render(<TimerCreateForm onClose={mockOnClose} />);

    fireEvent.click(screen.getByTestId('timer-create-cancel'));
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('submits form with correct values and calls onClose on success', async () => {
    const { apiFetch } = await import('../../../hooks/useApi');
    const mockApi = vi.mocked(apiFetch);
    mockApi.mockResolvedValueOnce({
      id: 'tmr-new',
      agentId: 'agent-1',
      label: 'check-build',
      message: 'Check it',
      fireAt: Date.now() + 300000,
      createdAt: new Date().toISOString(),
      status: 'pending',
      repeat: false,
      delaySeconds: 300,
      remainingMs: 300000,
    });

    render(<TimerCreateForm onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId('timer-label-input'), { target: { value: 'check-build' } });
    fireEvent.change(screen.getByTestId('timer-delay-input'), { target: { value: '5m' } });
    fireEvent.change(screen.getByTestId('timer-message-input'), { target: { value: 'Check it' } });
    fireEvent.click(screen.getByTestId('timer-create-submit'));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith('/timers', expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"delaySeconds":300'),
      }));
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  it('parses various delay formats correctly', async () => {
    const { apiFetch } = await import('../../../hooks/useApi');
    const mockApi = vi.mocked(apiFetch);

    // Test "30s" format
    mockApi.mockResolvedValueOnce({ id: 'tmr-1' });

    render(<TimerCreateForm onClose={mockOnClose} />);

    fireEvent.change(screen.getByTestId('timer-label-input'), { target: { value: 'test' } });
    fireEvent.change(screen.getByTestId('timer-delay-input'), { target: { value: '30s' } });
    fireEvent.click(screen.getByTestId('timer-create-submit'));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith('/timers', expect.objectContaining({
        body: expect.stringContaining('"delaySeconds":30'),
      }));
    });
  });
});
