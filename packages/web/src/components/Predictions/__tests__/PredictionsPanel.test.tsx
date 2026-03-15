// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../hooks/usePredictions', () => ({
  usePredictions: () => ({
    predictions: [
      { id: 'p1', text: 'Will complete on time', confidence: 0.85, resolved: true, correct: true, createdAt: new Date().toISOString() },
      { id: 'p2', text: 'Need more agents', confidence: 0.6, resolved: false, correct: null, createdAt: new Date().toISOString() },
    ],
    loading: false,
    error: null,
  }),
  usePredictionAccuracy: () => ({
    accuracy: 0.75,
    total: 10,
    correct: 7,
    loading: false,
  }),
}));

vi.mock('../PredictionCard', () => ({
  PredictionCard: ({ prediction }: { prediction: { text: string } }) => (
    <div data-testid="prediction-card">{prediction.text}</div>
  ),
}));

vi.mock('../../Shared', () => ({
  EmptyState: ({ message }: { message: string }) => <div data-testid="empty-state">{message}</div>,
}));

import { PredictionsPanel } from '../PredictionsPanel';

describe('PredictionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders predictions list', () => {
    render(<PredictionsPanel />);
    expect(screen.getByText(/Will complete on time/)).toBeInTheDocument();
  });

  it('renders multiple prediction cards', () => {
    render(<PredictionsPanel />);
    const cards = screen.getAllByTestId('prediction-card');
    expect(cards.length).toBe(2);
  });

  it('renders without crashing', () => {
    const { container } = render(<PredictionsPanel />);
    expect(container).toBeTruthy();
  });
});
