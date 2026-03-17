// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PulsePredictionIndicator } from '../PulsePredictionIndicator';
import type { Prediction } from '../types';

const mockUsePredictions = vi.fn<[], { predictions: Prediction[] }>();
vi.mock('../../../hooks/usePredictions', () => ({
  usePredictions: (...args: unknown[]) => mockUsePredictions(...(args as [])),
}));

function makePrediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    id: 'pred-1',
    type: 'context_exhaustion',
    severity: 'warning',
    confidence: 80,
    title: 'Test prediction',
    detail: 'Some detail',
    timeHorizon: 5,
    dataPoints: 3,
    actions: [],
    createdAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('PulsePredictionIndicator', () => {
  beforeEach(() => {
    mockUsePredictions.mockReset();
  });

  it('renders null when there are no predictions', () => {
    mockUsePredictions.mockReturnValue({ predictions: [] });
    const { container } = render(<PulsePredictionIndicator />);
    expect(container.innerHTML).toBe('');
  });

  it('renders null when all predictions are completion_estimate', () => {
    mockUsePredictions.mockReturnValue({
      predictions: [makePrediction({ type: 'completion_estimate' })],
    });
    const { container } = render(<PulsePredictionIndicator />);
    expect(container.innerHTML).toBe('');
  });

  it('shows "ctx ~Nm" for context_exhaustion', () => {
    mockUsePredictions.mockReturnValue({
      predictions: [makePrediction({ type: 'context_exhaustion', timeHorizon: 3 })],
    });
    render(<PulsePredictionIndicator />);
    expect(screen.getByText('ctx ~3m')).toBeTruthy();
  });

  it('shows "tokens ~Nm" for cost_overrun', () => {
    mockUsePredictions.mockReturnValue({
      predictions: [makePrediction({ type: 'cost_overrun', timeHorizon: 7 })],
    });
    render(<PulsePredictionIndicator />);
    expect(screen.getByText('tokens ~7m')).toBeTruthy();
  });

  it('shows "stall Nm" for agent_stall', () => {
    mockUsePredictions.mockReturnValue({
      predictions: [makePrediction({ type: 'agent_stall', timeHorizon: 2 })],
    });
    render(<PulsePredictionIndicator />);
    expect(screen.getByText('stall 2m')).toBeTruthy();
  });

  it('shows "task +Nm" for task_duration', () => {
    mockUsePredictions.mockReturnValue({
      predictions: [makePrediction({ type: 'task_duration', timeHorizon: 10 })],
    });
    render(<PulsePredictionIndicator />);
    expect(screen.getByText('task +10m')).toBeTruthy();
  });

  it('shows "~Nm" for unknown type', () => {
    mockUsePredictions.mockReturnValue({
      predictions: [makePrediction({ type: 'something_else' as Prediction['type'], timeHorizon: 4 })],
    });
    render(<PulsePredictionIndicator />);
    expect(screen.getByText('~4m')).toBeTruthy();
  });

  it('renders the crystal ball emoji and title attribute', () => {
    const pred = makePrediction({ title: 'Context running low' });
    mockUsePredictions.mockReturnValue({ predictions: [pred] });
    render(<PulsePredictionIndicator />);
    expect(screen.getByText('🔮')).toBeTruthy();
    expect(screen.getByTitle('Context running low')).toBeTruthy();
  });

  describe('sorting', () => {
    it('picks critical over warning over info', () => {
      mockUsePredictions.mockReturnValue({
        predictions: [
          makePrediction({ severity: 'info', confidence: 90, type: 'agent_stall', timeHorizon: 1 }),
          makePrediction({ severity: 'critical', confidence: 50, type: 'cost_overrun', timeHorizon: 9 }),
          makePrediction({ severity: 'warning', confidence: 80, type: 'context_exhaustion', timeHorizon: 5 }),
        ],
      });
      render(<PulsePredictionIndicator />);
      // critical cost_overrun should win
      expect(screen.getByText('tokens ~9m')).toBeTruthy();
    });

    it('picks higher confidence within same severity', () => {
      mockUsePredictions.mockReturnValue({
        predictions: [
          makePrediction({ severity: 'warning', confidence: 60, type: 'agent_stall', timeHorizon: 2 }),
          makePrediction({ severity: 'warning', confidence: 95, type: 'cost_overrun', timeHorizon: 8 }),
        ],
      });
      render(<PulsePredictionIndicator />);
      // higher confidence cost_overrun should win
      expect(screen.getByText('tokens ~8m')).toBeTruthy();
    });
  });
});
