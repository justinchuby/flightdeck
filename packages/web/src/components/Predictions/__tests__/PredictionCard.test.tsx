import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PredictionCard } from '../PredictionCard';
import type { Prediction } from '../types';

// ── Mocks ─────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args),
}));

// ── Fixtures ──────────────────────────────────────────────────────

function makePrediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    id: 'pred-1',
    type: 'context_exhaustion',
    severity: 'warning',
    confidence: 85,
    title: 'Context window nearly full',
    detail: 'Agent dev-001 at 92% context usage',
    timeHorizon: 15,
    dataPoints: 5,
    actions: [],
    createdAt: '2025-01-01T00:00:00Z',
    expiresAt: '2025-01-01T01:00:00Z',
    outcome: null,
    ...overrides,
  };
}

const defaultProps = () => ({
  prediction: makePrediction(),
  onDismiss: vi.fn(),
});

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockNavigate.mockReset();
  mockApiFetch.mockReset();
});

describe('PredictionCard', () => {
  it('renders prediction title and detail', () => {
    render(<PredictionCard {...defaultProps()} />);
    expect(screen.getByText('Context window nearly full')).toBeTruthy();
    expect(screen.getByText('Agent dev-001 at 92% context usage')).toBeTruthy();
  });

  it('shows prediction icon for type', () => {
    render(<PredictionCard {...defaultProps()} />);
    expect(screen.getByText('⚠')).toBeTruthy(); // context_exhaustion icon
  });

  it('shows high confidence label', () => {
    render(<PredictionCard prediction={makePrediction({ confidence: 90 })} onDismiss={vi.fn()} />);
    expect(screen.getByText('High')).toBeTruthy();
  });

  it('shows percentage for medium confidence', () => {
    render(<PredictionCard prediction={makePrediction({ confidence: 65 })} onDismiss={vi.fn()} />);
    expect(screen.getByText('65%')).toBeTruthy();
  });

  it('shows percentage for low confidence', () => {
    render(<PredictionCard prediction={makePrediction({ confidence: 40 })} onDismiss={vi.fn()} />);
    expect(screen.getByText('40%')).toBeTruthy();
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const props = defaultProps();
    render(<PredictionCard {...props} />);
    fireEvent.click(screen.getByLabelText('Dismiss prediction'));
    expect(props.onDismiss).toHaveBeenCalledWith('pred-1');
  });

  it('sets aria-label with title and confidence', () => {
    render(<PredictionCard {...defaultProps()} />);
    expect(screen.getByRole('article', {
      name: 'Context window nearly full — High confidence',
    })).toBeTruthy();
  });

  describe('compact mode', () => {
    it('renders compact layout', () => {
      render(<PredictionCard {...defaultProps()} compact />);
      // Compact mode shows title but not detail
      expect(screen.getByText('Context window nearly full')).toBeTruthy();
      // Detail is not shown in compact mode
      expect(screen.queryByText('Agent dev-001 at 92% context usage')).toBeNull();
    });

    it('does not show dismiss button in compact mode', () => {
      render(<PredictionCard {...defaultProps()} compact />);
      expect(screen.queryByLabelText('Dismiss prediction')).toBeNull();
    });

    it('does not show action buttons in compact mode', () => {
      const pred = makePrediction({
        actions: [{ label: 'Fix it', actionType: 'navigate', route: '/fix' }],
      });
      render(<PredictionCard prediction={pred} onDismiss={vi.fn()} compact />);
      expect(screen.queryByText('Fix it')).toBeNull();
    });
  });

  describe('actions', () => {
    it('renders action buttons', () => {
      const pred = makePrediction({
        actions: [
          { label: 'View Agent', actionType: 'navigate', route: '/agents/1' },
          { label: 'Restart', actionType: 'api_call', endpoint: '/agents/1/restart' },
        ],
      });
      render(<PredictionCard prediction={pred} onDismiss={vi.fn()} />);
      expect(screen.getByText('View Agent')).toBeTruthy();
      expect(screen.getByText('Restart')).toBeTruthy();
    });

    it('limits to 3 action buttons', () => {
      const pred = makePrediction({
        actions: [
          { label: 'Action 1', actionType: 'dismiss' },
          { label: 'Action 2', actionType: 'dismiss' },
          { label: 'Action 3', actionType: 'dismiss' },
          { label: 'Action 4', actionType: 'dismiss' },
        ],
      });
      render(<PredictionCard prediction={pred} onDismiss={vi.fn()} />);
      expect(screen.queryByText('Action 4')).toBeNull();
    });

    it('navigates when navigate action is clicked', () => {
      const pred = makePrediction({
        actions: [{ label: 'Go', actionType: 'navigate', route: '/agents/1' }],
      });
      render(<PredictionCard prediction={pred} onDismiss={vi.fn()} />);
      fireEvent.click(screen.getByText('Go'));
      expect(mockNavigate).toHaveBeenCalledWith('/agents/1');
    });

    it('calls API when api_call action is clicked', async () => {
      mockApiFetch.mockResolvedValue({});
      const pred = makePrediction({
        actions: [{
          label: 'Restart',
          actionType: 'api_call',
          endpoint: '/agents/1/restart',
          method: 'POST',
        }],
      });
      render(<PredictionCard prediction={pred} onDismiss={vi.fn()} />);
      fireEvent.click(screen.getByText('Restart'));

      await waitFor(() => {
        expect(mockApiFetch).toHaveBeenCalledWith('/agents/1/restart', {
          method: 'POST',
          body: undefined,
        });
      });
    });

    it('calls onDismiss when dismiss action is clicked', () => {
      const onDismiss = vi.fn();
      const pred = makePrediction({
        actions: [{ label: 'Dismiss', actionType: 'dismiss' }],
      });
      render(<PredictionCard prediction={pred} onDismiss={onDismiss} />);
      fireEvent.click(screen.getByText('Dismiss'));
      expect(onDismiss).toHaveBeenCalledWith('pred-1');
    });
  });

  describe('severity', () => {
    it('renders info severity', () => {
      render(<PredictionCard prediction={makePrediction({ severity: 'info' })} onDismiss={vi.fn()} />);
      expect(screen.getByRole('article')).toBeTruthy();
    });

    it('renders critical severity', () => {
      render(<PredictionCard prediction={makePrediction({ severity: 'critical' })} onDismiss={vi.fn()} />);
      expect(screen.getByRole('article')).toBeTruthy();
    });
  });
});
