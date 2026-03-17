import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useAppStore } from '../../../stores/appStore';
import { useLeadStore } from '../../../stores/leadStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useToastStore } from '../../Toast';
import type { Decision } from '../../../types';

// Mock apiFetch
const mockApiFetch = vi.fn();
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

// Import component after mocks
import { ApprovalQueue } from '../ApprovalQueue';

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-1',
    agentId: 'agent-1',
    agentRole: 'Developer',
    leadId: 'lead-1',
    projectId: null,
    title: 'Use tabs for indentation',
    rationale: 'Consistency with existing codebase',
    needsConfirmation: true,
    status: 'recorded',
    autoApproved: false,
    confirmedAt: null,
    timestamp: new Date().toISOString(),
    category: 'style',
    ...overrides,
  };
}

function resetStores() {
  useAppStore.setState({
    agents: [],
    pendingDecisions: [],
    approvalQueueOpen: false,
    selectedAgentId: null,
    connected: false,
    loading: false,
    systemPaused: false,
  });
  useLeadStore.setState({
    projects: {},
    selectedLeadId: null,
    drafts: {},
  });
  useSettingsStore.setState({
    oversightLevel: 'balanced',
  });
  useToastStore.setState({ toasts: [] });
}

describe('ApprovalQueue', () => {
  beforeEach(() => {
    resetStores();
    mockApiFetch.mockReset();
  });

  // ── Empty state ──────────────────────────────────────────────────

  it('renders empty state when no pending decisions', () => {
    render(<ApprovalQueue />);
    expect(screen.getByText('All clear')).toBeInTheDocument();
    expect(screen.getByText('No decisions waiting for approval.')).toBeInTheDocument();
  });

  // ── With pending decisions ───────────────────────────────────────

  it('renders decision cards when pending decisions exist', () => {
    useAppStore.setState({
      pendingDecisions: [
        makeDecision({ id: 'dec-1', title: 'Use tabs', category: 'style' }),
        makeDecision({ id: 'dec-2', title: 'Add ESLint', category: 'testing' }),
      ],
    });

    render(<ApprovalQueue />);
    expect(screen.getByText('Use tabs')).toBeInTheDocument();
    expect(screen.getByText('Add ESLint')).toBeInTheDocument();
  });

  it('groups decisions by category', () => {
    useAppStore.setState({
      pendingDecisions: [
        makeDecision({ id: 'dec-1', title: 'Use tabs', category: 'style' }),
        makeDecision({ id: 'dec-2', title: 'Semicolons', category: 'style' }),
        makeDecision({ id: 'dec-3', title: 'Add ESLint', category: 'testing' }),
      ],
    });

    render(<ApprovalQueue />);
    // Style category should show count
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('shows agent role for each decision', () => {
    useAppStore.setState({
      pendingDecisions: [makeDecision({ agentRole: 'Backend Dev' })],
    });

    render(<ApprovalQueue />);
    expect(screen.getByText('Backend Dev')).toBeInTheDocument();
  });

  // ── Oversight hint section ───────────────────────────────────────

  it('shows oversight hint when decisions are pending', () => {
    useAppStore.setState({
      pendingDecisions: [makeDecision()],
    });

    render(<ApprovalQueue />);
    expect(screen.getByText('Seeing too many approvals?')).toBeInTheDocument();
    expect(screen.getByText('Change oversight level')).toBeInTheDocument();
  });

  it('opens oversight picker on click', () => {
    useAppStore.setState({
      pendingDecisions: [makeDecision()],
    });

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('Change oversight level'));
    expect(screen.getByText('🔍 Supervised')).toBeInTheDocument();
    expect(screen.getByText('⚖️ Balanced')).toBeInTheDocument();
    expect(screen.getByText('🚀 Autonomous')).toBeInTheDocument();
  });

  it('changes oversight level when option is clicked', async () => {
    // setOversightLevel internally calls apiFetch to sync to server
    mockApiFetch.mockResolvedValue({});
    useAppStore.setState({
      pendingDecisions: [makeDecision()],
    });

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('Change oversight level'));
    fireEvent.click(screen.getByText('🚀 Autonomous'));

    expect(useSettingsStore.getState().oversightLevel).toBe('autonomous');
  });

  // ── Approve / Reject / Dismiss single ────────────────────────────

  it('calls apiFetch on approve button click', async () => {
    mockApiFetch.mockResolvedValue({});
    useAppStore.setState({
      pendingDecisions: [makeDecision({ id: 'dec-1' })],
    });

    render(<ApprovalQueue />);
    const approveBtn = screen.getByTitle('Approve (a)');
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/decisions/dec-1/confirm', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    });
  });

  it('removes decision from store after approve', async () => {
    mockApiFetch.mockResolvedValue({});
    useAppStore.setState({
      pendingDecisions: [
        makeDecision({ id: 'dec-1', title: 'Use tabs' }),
        makeDecision({ id: 'dec-2', title: 'Add ESLint', category: 'testing' }),
      ],
    });

    render(<ApprovalQueue />);
    const approveBtns = screen.getAllByTitle('Approve (a)');
    fireEvent.click(approveBtns[0]);

    await waitFor(() => {
      expect(useAppStore.getState().pendingDecisions).toHaveLength(1);
      expect(useAppStore.getState().pendingDecisions[0].id).toBe('dec-2');
    });
  });

  it('calls apiFetch on reject button click', async () => {
    mockApiFetch.mockResolvedValue({});
    useAppStore.setState({
      pendingDecisions: [makeDecision({ id: 'dec-1' })],
    });

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByTitle('Reject (r)'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/decisions/dec-1/reject', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    });
  });

  it('calls apiFetch on dismiss button click', async () => {
    mockApiFetch.mockResolvedValue({});
    useAppStore.setState({
      pendingDecisions: [makeDecision({ id: 'dec-1' })],
    });

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByTitle('Dismiss (d)'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/decisions/dec-1/dismiss', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    });
  });

  it('shows error toast when resolve fails', async () => {
    mockApiFetch.mockRejectedValue(new Error('Network error'));
    useAppStore.setState({
      pendingDecisions: [makeDecision({ id: 'dec-1' })],
    });

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByTitle('Approve (a)'));

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.some((t) => t.type === 'error' && t.message.includes('Network error'))).toBe(true);
    });
  });

  // ── Selection and batch actions ──────────────────────────────────

  it('shows batch action bar when decisions are selected', () => {
    useAppStore.setState({
      pendingDecisions: [makeDecision({ id: 'dec-1' })],
    });

    render(<ApprovalQueue />);
    // No batch bar initially
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();

    // Select a decision via checkbox
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByText('Approve Selected')).toBeInTheDocument();
    expect(screen.getByText('Reject Selected')).toBeInTheDocument();
    expect(screen.getByText('Dismiss Selected')).toBeInTheDocument();
  });

  it('batch approve calls apiFetch with all selected IDs', async () => {
    mockApiFetch.mockResolvedValue({ updated: 2 });
    useAppStore.setState({
      pendingDecisions: [
        makeDecision({ id: 'dec-1', title: 'Decision 1' }),
        makeDecision({ id: 'dec-2', title: 'Decision 2' }),
      ],
    });

    render(<ApprovalQueue />);

    // Select both
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    expect(screen.getByText('2 selected')).toBeInTheDocument();

    // Click batch approve
    fireEvent.click(screen.getByText('Approve Selected'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith('/decisions/batch', {
        method: 'POST',
        body: JSON.stringify({ ids: ['dec-1', 'dec-2'], action: 'confirm' }),
      });
    });
  });

  it('"Select all" selects all decisions in a category', () => {
    useAppStore.setState({
      pendingDecisions: [
        makeDecision({ id: 'dec-1', category: 'style' }),
        makeDecision({ id: 'dec-2', category: 'style' }),
      ],
    });

    render(<ApprovalQueue />);
    fireEvent.click(screen.getByText('Select all'));

    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  // ── Expand / Collapse ────────────────────────────────────────────

  it('expands decision to show rationale on click', () => {
    useAppStore.setState({
      pendingDecisions: [makeDecision({ rationale: 'Detailed reasoning here' })],
    });

    render(<ApprovalQueue />);
    // Rationale not shown initially
    expect(screen.queryByText('Detailed reasoning here')).not.toBeInTheDocument();

    // Click the decision title to expand
    fireEvent.click(screen.getByText('Use tabs for indentation'));
    expect(screen.getByText('Detailed reasoning here')).toBeInTheDocument();
  });

  it('collapses category to hide its decisions', () => {
    useAppStore.setState({
      pendingDecisions: [
        makeDecision({ id: 'dec-1', title: 'Use tabs', category: 'style' }),
      ],
    });

    render(<ApprovalQueue />);
    expect(screen.getByText('Use tabs')).toBeInTheDocument();

    // Click category header to collapse (the button contains the category label text)
    const categoryBtn = screen.getByText('🎨 Style & Formatting').closest('button')!;
    fireEvent.click(categoryBtn);

    // Decision should be hidden now
    expect(screen.queryByText('Use tabs')).not.toBeInTheDocument();

    // Click again to expand
    fireEvent.click(categoryBtn);
    expect(screen.getByText('Use tabs')).toBeInTheDocument();
  });
});
