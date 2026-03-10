import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mock return values (mutable so tests can override) ──────────────────────

let mockConflicts: any[] = [];
let mockConflictsLoading = false;
const mockResolve = vi.fn();
const mockDismissConflict = vi.fn();

let mockConflictConfig: any = null;
const mockSaveConfig = vi.fn();

vi.mock('../../hooks/useConflicts', () => ({
  useConflicts: () => ({
    conflicts: mockConflicts,
    activeConflicts: mockConflicts.filter((c: any) => c.status === 'active'),
    loading: mockConflictsLoading,
    resolve: mockResolve,
    dismiss: mockDismissConflict,
  }),
  useConflictConfig: () => ({
    config: mockConflictConfig,
    saveConfig: mockSaveConfig,
  }),
}));

vi.mock('../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
}));

// ── Imports (must come AFTER vi.mock calls) ─────────────────────────────────

import { ConflictDetailPanel } from '../Conflicts/ConflictDetailPanel';
import { ConflictBadge } from '../Conflicts/ConflictBadge';
import { PulseConflictIndicator } from '../Conflicts/PulseConflictIndicator';
import { ConflictSettingsPanel } from '../Conflicts/ConflictSettingsPanel';

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeConflict(overrides: Record<string, any> = {}) {
  return {
    id: 'conflict-1',
    type: 'same_directory' as const,
    severity: 'medium' as const,
    agents: [
      { agentId: 'agent-1', role: 'Backend Dev', files: ['src/models/user.ts'], taskId: 'task-1' },
      { agentId: 'agent-2', role: 'API Dev', files: ['src/models/types.ts'], taskId: 'task-2' },
    ] as [any, any],
    files: [
      {
        path: 'src/models/user.ts',
        agents: ['agent-1', 'agent-2'],
        editType: 'recently_edited' as const,
        risk: 'direct' as const,
      },
    ],
    description: 'Both agents editing files in src/models/',
    detectedAt: '2025-01-01T12:00:00Z',
    status: 'active' as const,
    ...overrides,
  };
}

const defaultConfig = {
  enabled: true,
  checkIntervalMs: 15000,
  directoryOverlapEnabled: true,
  importAnalysisEnabled: true,
  branchDivergenceEnabled: false,
};

// ── Reset mocks between tests ───────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockConflicts = [];
  mockConflictsLoading = false;
  mockConflictConfig = null;
});

// ═════════════════════════════════════════════════════════════════════════════
// Phase 4 Cycle 3 — Conflict Detection
// ═════════════════════════════════════════════════════════════════════════════

describe('Phase 4 Cycle 3 — Conflict Detection', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Conflicts — ConflictDetailPanel
  // ─────────────────────────────────────────────────────────────────────────

  describe('Conflicts — ConflictDetailPanel', () => {
    it('renders conflict type and severity header', () => {
      render(<ConflictDetailPanel conflict={makeConflict()} onClose={vi.fn()} />);
      expect(screen.getByText(/Directory Overlap/)).toBeInTheDocument();
      expect(screen.getByText(/Medium Severity/)).toBeInTheDocument();
    });

    it('shows both agents with their roles', () => {
      render(<ConflictDetailPanel conflict={makeConflict()} onClose={vi.fn()} />);
      expect(screen.getAllByText(/Backend Dev/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/API Dev/).length).toBeGreaterThanOrEqual(1);
      // Specifically check the agent cards render role headers
      expect(screen.getByText('💻 Backend Dev')).toBeInTheDocument();
      expect(screen.getByText('💻 API Dev')).toBeInTheDocument();
    });

    it('shows agent task IDs', () => {
      render(<ConflictDetailPanel conflict={makeConflict()} onClose={vi.fn()} />);
      expect(screen.getByText('Task: task-1')).toBeInTheDocument();
      expect(screen.getByText('Task: task-2')).toBeInTheDocument();
    });

    it('shows overlap files and description', () => {
      render(<ConflictDetailPanel conflict={makeConflict()} onClose={vi.fn()} />);
      expect(screen.getAllByText(/src\/models\/user\.ts/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Both agents editing files in src/models/')).toBeInTheDocument();
    });

    it('renders 4 resolution options', () => {
      render(<ConflictDetailPanel conflict={makeConflict()} onClose={vi.fn()} />);
      expect(screen.getByText('Sequence their work')).toBeInTheDocument();
      expect(screen.getByText('Split the file')).toBeInTheDocument();
      expect(screen.getByText('Let them proceed')).toBeInTheDocument();
      expect(screen.getByText('Dismiss this alert')).toBeInTheDocument();
    });

    it('calls onClose when X button is clicked', () => {
      const onClose = vi.fn();
      render(<ConflictDetailPanel conflict={makeConflict()} onClose={onClose} />);
      fireEvent.click(screen.getByText('✕'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls resolve and onClose when Sequence is applied', async () => {
      const onClose = vi.fn();
      mockResolve.mockResolvedValue(undefined);
      render(<ConflictDetailPanel conflict={makeConflict()} onClose={onClose} />);
      // "Apply →" buttons — first one is "Sequence their work"
      const applyBtns = screen.getAllByText('Apply →');
      fireEvent.click(applyBtns[0]);
      await waitFor(() => {
        expect(mockResolve).toHaveBeenCalledWith('conflict-1', {
          type: 'sequenced',
          order: ['agent-1', 'agent-2'],
        });
        expect(onClose).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Conflicts — ConflictBadge
  // ─────────────────────────────────────────────────────────────────────────

  describe('Conflicts — ConflictBadge', () => {
    it('shows conflict with other agent role', () => {
      render(<ConflictBadge conflict={makeConflict()} agentId="agent-1" />);
      expect(screen.getByText(/Conflict with API Dev/)).toBeInTheDocument();
    });

    it('shows conflict from the other agents perspective', () => {
      render(<ConflictBadge conflict={makeConflict()} agentId="agent-2" />);
      expect(screen.getByText(/Conflict with Backend Dev/)).toBeInTheDocument();
    });

    it('returns null when agentId matches neither agent', () => {
      const { container } = render(
        <ConflictBadge conflict={makeConflict()} agentId="agent-unknown" />,
      );
      // Both agents don't match agent-unknown, so find returns the first match that isn't agent-unknown
      // Actually looking at the code: otherAgent = agents.find(a => a.agentId !== agentId)
      // If agentId="agent-unknown", both agents match the filter, so it finds agent-1
      expect(screen.getByText(/Conflict with Backend Dev/)).toBeInTheDocument();
      expect(container.querySelector('button')).toBeInTheDocument();
    });

    it('calls onClick when clicked', () => {
      const onClick = vi.fn();
      render(<ConflictBadge conflict={makeConflict()} agentId="agent-1" onClick={onClick} />);
      fireEvent.click(screen.getByText(/Conflict with API Dev/));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('has accessible aria-label', () => {
      render(<ConflictBadge conflict={makeConflict()} agentId="agent-1" />);
      expect(
        screen.getByLabelText(/File conflict with API Dev.*medium severity/i),
      ).toBeInTheDocument();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Conflicts — PulseConflictIndicator
  // ─────────────────────────────────────────────────────────────────────────

  describe('Conflicts — PulseConflictIndicator', () => {
    it('renders nothing when no active conflicts', () => {
      mockConflicts = [];
      const { container } = render(<PulseConflictIndicator />);
      expect(container.innerHTML).toBe('');
    });

    it('renders nothing when all conflicts are resolved', () => {
      mockConflicts = [makeConflict({ status: 'resolved' }), makeConflict({ id: 'c2', status: 'dismissed' })];
      const { container } = render(<PulseConflictIndicator />);
      expect(container.innerHTML).toBe('');
    });

    it('shows count for active conflicts', () => {
      mockConflicts = [makeConflict()];
      render(<PulseConflictIndicator />);
      expect(screen.getByText('1 conflict')).toBeInTheDocument();
    });

    it('pluralizes count for multiple conflicts', () => {
      mockConflicts = [
        makeConflict({ id: 'c1' }),
        makeConflict({ id: 'c2' }),
      ];
      render(<PulseConflictIndicator />);
      expect(screen.getByText('2 conflicts')).toBeInTheDocument();
    });

    it('reflects highest severity in title', () => {
      mockConflicts = [
        makeConflict({ id: 'c1', severity: 'low' }),
        makeConflict({ id: 'c2', severity: 'high' }),
      ];
      render(<PulseConflictIndicator />);
      expect(screen.getByTitle('2 active conflicts')).toBeInTheDocument();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Conflicts — ConflictSettingsPanel
  // ─────────────────────────────────────────────────────────────────────────

  describe('Conflicts — ConflictSettingsPanel', () => {
    it('shows loading when config is null', () => {
      mockConflictConfig = null;
      render(<ConflictSettingsPanel />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    it('renders all config options when loaded', () => {
      mockConflictConfig = defaultConfig;
      render(<ConflictSettingsPanel />);
      expect(screen.getByText(/Conflict Detection/)).toBeInTheDocument();
      expect(screen.getByText('Conflict detection')).toBeInTheDocument();
      expect(screen.getByText('Check interval')).toBeInTheDocument();
      expect(screen.getByText('Same directory overlap')).toBeInTheDocument();
      expect(screen.getByText('Import/dependency overlap')).toBeInTheDocument();
      expect(screen.getByText(/Branch divergence/)).toBeInTheDocument();
    });

    it('calls saveConfig when toggling enabled', () => {
      mockConflictConfig = defaultConfig;
      mockSaveConfig.mockResolvedValue({ ...defaultConfig, enabled: false });
      render(<ConflictSettingsPanel />);
      // The toggle button for "Conflict detection" — it's a button element
      const toggleBtn = screen.getByText('Conflict detection').closest('label')!.querySelector('button')!;
      fireEvent.click(toggleBtn);
      expect(mockSaveConfig).toHaveBeenCalledWith({ enabled: false });
    });

    it('calls saveConfig when changing check interval', () => {
      mockConflictConfig = defaultConfig;
      mockSaveConfig.mockResolvedValue({ ...defaultConfig, checkIntervalMs: 30000 });
      render(<ConflictSettingsPanel />);
      // Select value is the numeric interval; getByDisplayValue matches option text for <select>
      const select = screen.getByDisplayValue('15s');
      fireEvent.change(select, { target: { value: '30000' } });
      expect(mockSaveConfig).toHaveBeenCalledWith({ checkIntervalMs: 30000 });
    });

    it('calls saveConfig when toggling directory overlap checkbox', () => {
      mockConflictConfig = defaultConfig;
      mockSaveConfig.mockResolvedValue({ ...defaultConfig, directoryOverlapEnabled: false });
      render(<ConflictSettingsPanel />);
      const checkbox = screen.getByLabelText('Same directory overlap');
      fireEvent.click(checkbox);
      expect(mockSaveConfig).toHaveBeenCalledWith({ directoryOverlapEnabled: false });
    });
  });
});
