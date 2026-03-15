import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PredictionConfig, PredictionAccuracy, Prediction } from '../types';

// ── Mocks ────────────────────────────────────────────────────────────

const mockSaveConfig = vi.fn();
let mockConfig: PredictionConfig | null = null;
let mockAccuracy: PredictionAccuracy | null = null;

vi.mock('../../../hooks/usePredictions', () => ({
  usePredictionConfig: () => ({ config: mockConfig, saveConfig: mockSaveConfig }),
  usePredictionAccuracy: () => mockAccuracy,
}));

vi.mock('../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
}));

// Import after mocks
import { PredictionSettingsPanel } from '../PredictionSettingsPanel';

const DEFAULT_CONFIG: PredictionConfig = {
  enabled: true,
  refreshIntervalMs: 30000,
  minConfidence: 40,
  minDataPoints: 3,
  enabledTypes: {
    context_exhaustion: true,
    cost_overrun: true,
    agent_stall: true,
    task_duration: true,
    completion_estimate: true,
  },
};

describe('PredictionSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = { ...DEFAULT_CONFIG };
    mockAccuracy = null;
  });

  it('shows loading state when config is null', () => {
    mockConfig = null;
    render(<PredictionSettingsPanel />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders heading and toggle when config loaded', () => {
    render(<PredictionSettingsPanel />);
    expect(screen.getByText('Prediction Settings')).toBeInTheDocument();
    expect(screen.getByText('Predictions')).toBeInTheDocument();
  });

  it('toggles predictions enabled', () => {
    render(<PredictionSettingsPanel />);
    // The toggle button is next to the "Predictions" label
    const toggle = screen.getByText('Predictions').closest('label')!.querySelector('button')!;
    fireEvent.click(toggle);
    expect(mockSaveConfig).toHaveBeenCalledWith({ enabled: false });
  });

  it('changes refresh interval via dropdown', () => {
    render(<PredictionSettingsPanel />);
    const select = screen.getByDisplayValue('30s');
    fireEvent.change(select, { target: { value: '60000' } });
    expect(mockSaveConfig).toHaveBeenCalledWith({ refreshIntervalMs: 60000 });
  });

  it('changes min confidence via dropdown', () => {
    render(<PredictionSettingsPanel />);
    const select = screen.getByDisplayValue('40%');
    fireEvent.change(select, { target: { value: '80' } });
    expect(mockSaveConfig).toHaveBeenCalledWith({ minConfidence: 80 });
  });

  it('renders all prediction type checkboxes', () => {
    render(<PredictionSettingsPanel />);
    expect(screen.getByText('Context Exhaustion')).toBeInTheDocument();
    expect(screen.getByText('Cost Overrun')).toBeInTheDocument();
    expect(screen.getByText('Agent Stall')).toBeInTheDocument();
    expect(screen.getByText('Task Duration')).toBeInTheDocument();
    expect(screen.getByText('Completion Estimate')).toBeInTheDocument();
  });

  it('toggles a prediction type checkbox', () => {
    render(<PredictionSettingsPanel />);
    const checkbox = screen.getByText('Cost Overrun').closest('label')!.querySelector('input')!;
    fireEvent.click(checkbox);
    expect(mockSaveConfig).toHaveBeenCalledWith({
      enabledTypes: expect.objectContaining({ cost_overrun: false }),
    });
  });

  it('shows accuracy stats when available', () => {
    mockAccuracy = { total: 10, correct: 7, avoided: 2, wrong: 1, accuracy: 70 };
    render(<PredictionSettingsPanel />);
    expect(screen.getByText('Accuracy (this session)')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('hides accuracy stats when total is 0', () => {
    mockAccuracy = { total: 0, correct: 0, avoided: 0, wrong: 0, accuracy: 0 };
    render(<PredictionSettingsPanel />);
    expect(screen.queryByText('Accuracy (this session)')).not.toBeInTheDocument();
  });

  it('hides accuracy stats when null', () => {
    mockAccuracy = null;
    render(<PredictionSettingsPanel />);
    expect(screen.queryByText('Accuracy (this session)')).not.toBeInTheDocument();
  });
});
