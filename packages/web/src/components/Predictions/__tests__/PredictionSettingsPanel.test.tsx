import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { PredictionConfig, PredictionAccuracy } from '../types';

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

  it('shows loading state when config is null', async () => {
    mockConfig = null;
    render(<PredictionSettingsPanel />);
    await act(async () => {});
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders heading and toggle when config loaded', async () => {
    render(<PredictionSettingsPanel />);
    await act(async () => {});
    expect(screen.getByText('Prediction Settings')).toBeInTheDocument();
    expect(screen.getByText('Predictions')).toBeInTheDocument();
  });

  it('toggles predictions enabled', async () => {
    render(<PredictionSettingsPanel />);
    await act(async () => {});
    // The toggle button is next to the "Predictions" label
    const toggle = screen.getByText('Predictions').closest('label')!.querySelector('button')!;
    await act(async () => { fireEvent.click(toggle); });
    expect(mockSaveConfig).toHaveBeenCalledWith({ enabled: false });
  });

  it('changes refresh interval via dropdown', async () => {
    render(<PredictionSettingsPanel />);
    await act(async () => {});
    const select = screen.getByDisplayValue('30s');
    await act(async () => { fireEvent.change(select, { target: { value: '60000' } }); });
    expect(mockSaveConfig).toHaveBeenCalledWith({ refreshIntervalMs: 60000 });
  });

  it('changes min confidence via dropdown', async () => {
    render(<PredictionSettingsPanel />);
    await act(async () => {});
    const select = screen.getByDisplayValue('40%');
    await act(async () => { fireEvent.change(select, { target: { value: '80' } }); });
    expect(mockSaveConfig).toHaveBeenCalledWith({ minConfidence: 80 });
  });

  it('renders all prediction type checkboxes', async () => {
    render(<PredictionSettingsPanel />);
    await act(async () => {});
    expect(screen.getByText('Context Exhaustion')).toBeInTheDocument();
    expect(screen.getByText('Cost Overrun')).toBeInTheDocument();
    expect(screen.getByText('Agent Stall')).toBeInTheDocument();
    expect(screen.getByText('Task Duration')).toBeInTheDocument();
    expect(screen.getByText('Completion Estimate')).toBeInTheDocument();
  });

  it('toggles a prediction type checkbox', async () => {
    render(<PredictionSettingsPanel />);
    await act(async () => {});
    const checkbox = screen.getByText('Cost Overrun').closest('label')!.querySelector('input')!;
    await act(async () => { fireEvent.click(checkbox); });
    expect(mockSaveConfig).toHaveBeenCalledWith({
      enabledTypes: expect.objectContaining({ cost_overrun: false }),
    });
  });

  it('shows accuracy stats when available', async () => {
    mockAccuracy = { total: 10, correct: 7, avoided: 2, wrong: 1, accuracy: 70 };
    render(<PredictionSettingsPanel />);
    await act(async () => {});
    expect(screen.getByText('Accuracy (this session)')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('hides accuracy stats when total is 0', async () => {
    mockAccuracy = { total: 0, correct: 0, avoided: 0, wrong: 0, accuracy: 0 };
    render(<PredictionSettingsPanel />);
    await act(async () => {});
    expect(screen.queryByText('Accuracy (this session)')).not.toBeInTheDocument();
  });

  it('hides accuracy stats when null', async () => {
    mockAccuracy = null;
    render(<PredictionSettingsPanel />);
    await act(async () => {});
    expect(screen.queryByText('Accuracy (this session)')).not.toBeInTheDocument();
  });
});
